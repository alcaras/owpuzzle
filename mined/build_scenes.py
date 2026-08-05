#!/usr/bin/env python3
"""Pass 2: turn the ranked loss records into single-battle scene JSON.

A turn's losses are usually several separate fights spread across the map, so
ranking on the turn total picks sprawling non-scenes. Instead each record is
scored by its best radius-4 window: the hex whose surrounding disc contains
the most lost strength. That window is the scene, and it is emitted AT TURN T
- the position before the carnage.

Offset (x, y) -> axial per the agreed convention: q = x + y//2, r = -y,
then recentered on the window so every coordinate is a small int in [-4, 4].
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/Users/dominik/Library/CloudStorage/Dropbox/cc/owdeepanalysis")
from owparse.gamedata import GameData
from owparse.series import Series

HERE = Path(__file__).resolve().parent
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/owpuzzle-cache2")
RADIUS = 4
MAX_PER_GAME = 2
N_SCENES = 10
MAX_FRAC_LOST = 0.9   # above this the "loss" is a resignation / elimination
MIN_ENEMY_UNITS = 3   # a scene with no opposition is attrition, not a battle

# river bitmask (owparse river_w/sw/se) -> axial direction index,
# dirs = E, NE, NW, W, SW, SE = 0..5
RIVER_DIRS = {"w": 3, "sw": 4, "se": 5}


def axial(tile_id: int, w: int) -> tuple[int, int]:
    x, y = tile_id % w, tile_id // w
    return x + y // 2, -y


def hexdist(a, b) -> int:
    dq, dr = a[0] - b[0], a[1] - b[1]
    return (abs(dq) + abs(dq + dr) + abs(dr)) // 2


def disc(center, radius=RADIUS):
    out = []
    for dq in range(-radius, radius + 1):
        for dr in range(max(-radius, -dq - radius), min(radius, -dq + radius) + 1):
            out.append((center[0] + dq, center[1] + dr))
    return out


def best_window(points: list[tuple[tuple[int, int], int]]):
    """Center whose radius-4 disc holds the most lost strength (ties -> the
    center closest to that subset's centroid, so the fight sits mid-frame)."""
    cands = {c for p, _ in points for c in disc(p)}
    scored = []
    for c in cands:
        inside = [i for i, (p, _) in enumerate(points) if hexdist(p, c) <= RADIUS]
        if not inside:
            continue
        s = sum(points[i][1] for i in inside)
        cq = sum(points[i][0][0] for i in inside) / len(inside)
        cr = sum(points[i][0][1] for i in inside) / len(inside)
        scored.append((-s, (c[0] - cq) ** 2 + (c[1] - cr) ** 2, c, inside))
    if not scored:
        return None, 0, []
    _, _, c, inside = min(scored)
    return c, sum(points[i][1] for i in inside), inside


def build_scene(rec: dict, gd: GameData) -> dict | None:
    series = Series(rec["dir"], cache_dir=CACHE)
    snap = series.snapshot(rec["turn"])
    nxt = series.snapshot(rec["turn"] + 1)
    w = snap.map_width
    strength = {z: v["strength"] for z, v in gd.units.items()}

    center = tuple(rec["_center"])
    inside = rec["_inside"]

    units, tiles = [], []
    for t in snap.tiles.values():
        a = axial(t.id, w)
        if hexdist(a, center) > RADIUS:
            continue
        q, r = a[0] - center[0], a[1] - center[1]
        tiles.append({
            "q": q, "r": r,
            "terrain": t.terrain, "height": t.height,
            "vegetation": t.vegetation or None,
            "river": [d for k, d in RIVER_DIRS.items() if getattr(t, "river_" + k)],
            "road": bool(t.road),
        })
        for uid in t.unit_ids:
            u = snap.units[uid]
            hp_max = gd.units.get(u.type, {}).get("hp", 20)
            units.append({
                "type": u.type, "player": u.player,
                "hp": hp_max - u.damage, "q": q, "r": r,
            })

    per_side: dict[int, int] = {}
    for u in units:
        if strength.get(u["type"], 0) > 0:
            per_side[u["player"]] = per_side.get(u["player"], 0) + 1
    enemies = sum(n for p, n in per_side.items() if p != rec["victim_player"])
    if enemies < MIN_ENEMY_UNITS:
        return None

    # The victim owns the save, so the enemy army is only as complete as the
    # victim's vision at T; whatever hit them is in the open at T+1. Record
    # that force so a puzzle author knows the true opposition.
    after = []
    for t in nxt.tiles.values():
        if hexdist(axial(t.id, w), center) > RADIUS:
            continue
        q, r = axial(t.id, w)[0] - center[0], axial(t.id, w)[1] - center[1]
        for uid in t.unit_ids:
            u = nxt.units[uid]
            if u.player == rec["victim_player"] or strength.get(u.type, 0) <= 0:
                continue
            hp_max = gd.units.get(u.type, {}).get("hp", 20)
            after.append({"type": u.type, "player": u.player,
                          "hp": hp_max - u.damage, "q": q, "r": r})

    cities = [c for c in snap.cities.values()
              if hexdist(axial(c.tile_id, w), center) <= RADIUS]
    cy = -center[1]
    cx = center[0] - cy // 2

    return {
        "game": rec["game"],
        "turn": rec["turn"],
        "victim_player": rec["victim_player"],
        "victim_name": rec["victim_name"],
        "strength_lost": rec["_window_strength"],
        "strength_lost_turn_total": rec["strength_lost"],
        "units_lost": [rec["units_lost"][i] for i in inside],
        "units": units,
        "tiles": tiles,
        # provenance / triage, not part of the required schema
        "_meta": {
            "archive": rec["dir"],
            "map_width": w,
            "center_offset_xy": [cx, cy],
            "combat_units_per_player": per_side,
            "cities_in_scene": [{"player": c.player, "name": gd.name(c.name_token),
                                 "capital": c.capital} for c in cities],
            "victim_strength_before": rec["strength_before"],
            "victim_frac_lost": rec["frac_lost"],
            "units_lost_elsewhere": len(rec["units_lost"]) - len(inside),
            "observer": rec["observer"],
            "enemy_units_next_turn": after,
            "log_unit_lost": rec["log_unit_lost"],
            "noncombat_lost": rec["noncombat_lost"],
            "captured": rec["captured"],
            "player_names": {str(p.id): p.name for p in snap.players.values()},
        },
    }


def main():
    recs = json.loads((HERE / "drops.json").read_text())
    gd = GameData()
    strength = {z: v["strength"] for z, v in gd.units.items()}

    for r in recs:
        pts = [(axial(t, r["map_width"]), strength.get(ty, 0))
               for t, ty in zip(r["lost_tiles"], r["units_lost"])]
        c, s, inside = best_window(pts)
        r["_center"], r["_window_strength"], r["_inside"] = c, s, inside

    # the victim's own UNIT_LOST log entries at T+1 corroborate the roster
    # diff; a few archives ship an already-cleared log, so those records are
    # kept but ranked behind the confirmed ones
    for r in recs:
        killed = len(r["units_lost"]) + len(r["noncombat_lost"])
        r["_log_confirmed"] = r["log_unit_lost"] >= max(1, 0.5 * killed)

    recs = [r for r in recs
            if r["_center"] is not None and r["frac_lost"] <= MAX_FRAC_LOST
            and r["_log_confirmed"]]
    recs.sort(key=lambda r: -r["_window_strength"])

    scenes, per_game = [], {}
    for r in recs:
        if len(scenes) >= N_SCENES:
            break
        if per_game.get(r["game"], 0) >= MAX_PER_GAME:
            continue
        try:
            sc = build_scene(r, gd)
        except Exception as e:
            print(f"  !! {r['game']} T{r['turn']}: {e}")
            continue
        finally:
            shutil.rmtree(CACHE, ignore_errors=True)
        if sc is None:
            print(f"  -- skipped {r['game']} T{r['turn']} P{r['victim_player']}: "
                  f"no opposition in frame")
            continue
        per_game[r["game"]] = per_game.get(r["game"], 0) + 1
        scenes.append(sc)
        print(f"  {sc['strength_lost']:4d}/{sc['strength_lost_turn_total']:<4d} str  "
              f"{sc['game'][:34]:34s} T{sc['turn']:<4d} P{sc['victim_player']} "
              f"{sc['victim_name'][:12]:12s} {len(sc['units'])}u "
              f"sides={sc['_meta']['combat_units_per_player']}")

    (HERE / "scenes.json").write_text(json.dumps(scenes, indent=1))
    print(f"\nwrote {HERE / 'scenes.json'} ({len(scenes)} scenes)")


if __name__ == "__main__":
    main()
