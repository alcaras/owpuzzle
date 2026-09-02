// The threat map: what the other side could do to one of our units standing
// on a given tile, once the turn is theirs. The mirror of the blow table —
// every enemy is teleported to every tile it could reach with a fresh turn
// and asked, engine-exactly, what it would deal to our unit placed there.
//
// A unit's LOSS on a tile is its strength times the share of its hp the
// enemy could take, every enemy counted once at its best post and summed:
//   loss(u, t) = STR(u) * min(1, threat(u, t) / hp(u))
// The sum ignores the enemy's order pool and that a body can only be hit
// from six sides, so it over-counts a crowded front; it is a price, not a
// prediction. `exposeW` (model.js) charges each blow the loss of its seat
// relative to the unit's home, so a unit is drawn towards seats the enemy
// cannot punish, and a kill is still worth taking from a bad seat when it
// pays for itself. Enemies the plan kills are still counted (their threat
// is gone in fact); the next wave re-plans without them.
//
// Not counted: rout advances (a unit ends on its victim's tile, unpriced in
// the model), pushes the enemy could use, and anything the board does not
// show. Answers are computed on demand and memoised.
//
// Measured once on a real 66-v-33 position against an actual best reply:
// weights 0.5 and 1 cut what was in reach by a fifth and did not move the
// reply. Two reasons, both structural: the price is relative to home and
// the model's only action is a blow, so a unit already exposed where it
// stands cannot be helped (there is no retreat); and an order-limited
// enemy cashes only the CHEAPEST kills, so a sum over all it could hit is
// the wrong price. Both are the next work; the map itself is engine-exact.
'use strict';
const E = require('./engine.js');

const key = (q, r) => q + ',' + r;
const unkey = k => { const [q, r] = k.split(',').map(Number); return { q, r }; };
const STR = u => E.DATA.units[u.type].iStrength || 0;
const info = u => E.DATA.units[u.type];
const rangeMin = u => E.isMelee(u) ? 1 : Math.max(1, info(u).iRangeMin || 0);

// opts: orders (the enemy's pool, for reach; default plenty), fresh (clear
// enemy cooldowns, default true)
// -> { threat(uid, tileKey), loss(uid, tileKey), who(uid, tileKey), lossOf(state) }
function threatMap(state, opts) {
  opts = opts || {};
  const work = E.cloneState(state);
  work.orders = opts.orders == null ? 99 : opts.orders;
  const me = 0;
  const enemies = work.units.filter(u => u.player !== me && u.hp > 0 && E.canDamage(u));
  const posts = new Map();   // enemy id -> [{q,r}] where it could attack from
  for (const e of enemies) {
    if (opts.fresh !== false) e.cooldown = null;
    e.steps = 0;
    if (info(e).bUnlimber) e.unlimbered = true;    // siege fires from where it stands, once set up
    const ps = [{ q: e.q, r: e.r }];
    if (!info(e).bUnlimber) for (const t of E.reachableTiles(work, e)) ps.push({ q: t.q, r: t.r });
    posts.set(e.id, ps);
  }
  const memo = new Map();    // 'uid|tile' -> [{id, dmg}] best per enemy, descending
  function who(uid, t) {
    const k = uid + '|' + t;
    if (memo.has(k)) return memo.get(k);
    const u = E.unitById(work, uid), tq = unkey(t);
    const out = [];
    if (u && u.hp > 0) {
      const q0 = u.q, r0 = u.r; u.q = tq.q; u.r = tq.r;
      for (const e of enemies) {
        const eq = e.q, er = e.r;
        let best = 0;
        for (const p of posts.get(e.id)) {
          const dist = E.hexDistance(p, tq);
          if (E.isMelee(e) ? dist !== 1 : (dist < rangeMin(e) || dist > E.effectiveRange(work, e, p, tq) || E.isShotObstructed(work, p, tq))) continue;
          e.q = p.q; e.r = p.r;
          let d = 0; try { d = E.attackUnitDamage(work, e, p, u); } catch (x) { d = 0; }
          if (d > best) best = d;
        }
        e.q = eq; e.r = er;
        if (best > 0) out.push({ id: e.id, dmg: best });
      }
      u.q = q0; u.r = r0;
      out.sort((a, b) => b.dmg - a.dmg);
    }
    memo.set(k, out);
    return out;
  }
  const threat = (uid, t) => who(uid, t).reduce((a, w) => a + w.dmg, 0);
  const loss = (uid, t, hp) => {
    const u = E.unitById(state, uid); if (!u || u.hp <= 0) return 0;
    return STR(u) * Math.min(1, threat(uid, t) / (hp == null ? u.hp : hp));
  };
  // the loss over a whole position: each of our damaging units where it
  // stands, with the hp it has left there
  const lossOf = s => s.units.filter(u => u.player === me && u.hp > 0 && E.canDamage(u) && E.unitById(state, u.id))
    .reduce((a, u) => a + loss(u.id, key(u.q, u.r), u.hp), 0);
  return { threat, loss, who, lossOf };
}

module.exports = { threatMap, STR };
