#!/usr/bin/env python3
"""Pass 1: sweep every per-turn save archive and record military losses.

For each game folder with >=2 consecutive-turn saves we walk the turns in
order and diff the unit rosters of T and T+1 by unit ID. A unit that has an
ID at T and no ID at T+1 died (or was disbanded); a unit whose ID survives
under a different owner was captured. Only units with iStrength > 0 count
toward the "strength lost" score.

Writes mined/drops.json: one record per (game, turn, victim player) with a
nonzero loss, sorted by strength lost.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, "/Users/dominik/Library/CloudStorage/Dropbox/cc/owdeepanalysis")
from owparse.gamedata import GameData
from owparse.series import Series

ARCHIVE_ROOTS = [
    Path("/Users/dominik/Library/CloudStorage/Dropbox/cc/owsaves/mp-archive"),
    Path("/Users/dominik/Library/CloudStorage/Dropbox/cc/owsaves/mp-archive-junk"),
    Path("/Users/dominik/Library/CloudStorage/Dropbox/cc/owsaves/mp-history"),
    Path("/Users/dominik/Library/CloudStorage/Dropbox/cc/owsaves/from-pc"),
]
CACHE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/owpuzzle-cache")
OUT = Path(__file__).resolve().parent / "drops.json"


def game_dirs() -> list[Path]:
    out = []
    for root in ARCHIVE_ROOTS:
        if not root.is_dir():
            continue
        for d in sorted(root.rglob("*")):
            if d.is_dir() and any(d.glob("*.zip")):
                out.append(d)
    return out


def main():
    gd = GameData()
    strength = {z: v["strength"] for z, v in gd.units.items()}
    records = []
    dirs = game_dirs()
    print(f"{len(dirs)} candidate archive dirs", flush=True)

    for gdir in dirs:
        cache = CACHE / gdir.name.replace("/", "_")
        try:
            series = Series(gdir, cache_dir=cache)
        except Exception as e:
            print(f"  !! {gdir.name}: {e}", flush=True)
            continue
        turns = series.turns
        pairs = [(t, t + 1) for t in turns if t + 1 in series.zips]
        if not pairs:
            shutil.rmtree(cache, ignore_errors=True)
            continue
        n_before = len(records)
        prev_snap = None
        prev_turn = None
        try:
            for t, t1 in pairs:
                a = prev_snap if prev_turn == t else series.snapshot(t)
                b = series.snapshot(t1)
                series._snaps.pop(t, None)
                prev_snap, prev_turn = b, t1

                owner_b = {u.id: u.player for u in b.units.values()}
                by_player: dict[int, dict] = {}
                for u in a.units.values():
                    if u.player < 0:
                        continue
                    st = strength.get(u.type, 0)
                    rec = by_player.setdefault(
                        u.player, {"killed": [], "captured": [], "str_total": 0})
                    rec["str_total"] += st
                    if u.id not in owner_b:
                        rec["killed"].append((u.type, st, u.tile_id, u.damage))
                    elif owner_b[u.id] != u.player:
                        rec["captured"].append((u.type, st, u.tile_id))
                for pid, rec in by_player.items():
                    lost = sum(s for _, s, _, _ in rec["killed"] if s > 0)
                    if lost <= 0:
                        continue
                    records.append({
                        "game": a.game_name or gdir.name,
                        "dir": str(gdir),
                        "turn": t,
                        "victim_player": pid,
                        "victim_name": a.players[pid].name if pid in a.players else "",
                        "strength_lost": lost,
                        "strength_before": rec["str_total"],
                        "frac_lost": round(lost / rec["str_total"], 3) if rec["str_total"] else 0,
                        "units_lost": [u for u, s, _, _ in rec["killed"] if s > 0],
                        "noncombat_lost": [u for u, s, _, _ in rec["killed"] if s <= 0],
                        "captured": [u for u, _, _ in rec["captured"]],
                        "lost_tiles": [tid for _, s, tid, _ in rec["killed"] if s > 0],
                        "map_width": a.map_width,
                    })
        except Exception as e:
            print(f"  !! {gdir.name} @ turn: {e}", flush=True)
        finally:
            shutil.rmtree(cache, ignore_errors=True)
        print(f"  {gdir.name}: {len(turns)} turns, {len(pairs)} pairs, "
              f"{len(records) - n_before} loss records", flush=True)

    records.sort(key=lambda r: -r["strength_lost"])
    OUT.write_text(json.dumps(records, indent=1))
    print(f"\nwrote {OUT} with {len(records)} records")
    for r in records[:25]:
        print(f"  {r['strength_lost']:4d} str  {r['game'][:40]:40s} T{r['turn']:<4d} "
              f"P{r['victim_player']} {r['victim_name'][:12]:12s} {r['units_lost']}")


if __name__ == "__main__":
    main()
