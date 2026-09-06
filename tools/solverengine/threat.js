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
const { canRout } = require('./blowtable.js');

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

// ---------------------------------------------------------------- the estimate
// An order-limited reply: what the enemy would actually CASH, not the sum of
// everything it could hit. Each enemy attacks once and its blow costs orders
// (the walk to its post plus one); each pool of theirs is finite; and they
// take the cheapest kills first, strength per order, until the money runs
// out. That greedy pass on a position is the estimate; the margin it stops
// at (orders per strength point of the last kill that fit) prices every
// seat: a kill under the margin is one they will take, one at twice the
// margin is one they cannot afford.
//   killCost(uid, tile, hp)  fewest orders that kill our unit there, or null
//   price(uid, tile, hp)     STR × the chance they afford that kill; a unit
//                            they cannot kill in one turn but can COMMIT —
//                            no way out of the seat, or one they have the
//                            bodies to close, and dead over two turns — is
//                            priced as lost (a slinger in trees beside a
//                            walled city and a Tactician's slingers: safe
//                            for a turn, gone the turn after)
//   committed(uid, tile, hp) that test on its own
//   locked(uid, tile)        no legal step from the seat as the board stands
//   rest(uid)                the cheapest seat the unit can reach without
//                            attacking, priced with its walk: {seat, orders, price}
//   estimate(state2)         the greedy reply on another state of the board:
//                            {str, kills: [{id, cost, blows}], lambda, spent}
// Like the map, the estimate ignores that a melee attacker needs a free
// adjacent tile (capped at six) and that our other bodies block their walk.
// opts: enemyPools ({key: orders} with e.pool on each enemy) or orders (one
// pool; default unlimited), ordW (order price folded into rest()), fresh,
// unseen(uid, tileKey) — true when the enemy cannot see our unit there (a
// scout in cover, a Schemer's scout anywhere): no kill, no price. Also read
// off state.unseenByEnemy, which a board builder may attach
function replyEstimate(state, opts) {
  opts = opts || {};
  const unseen = opts.unseen || state.unseenByEnemy || (() => false);
  const work = E.cloneState(state);
  work.orders = 999;
  const me = 0, ordW = opts.ordW || 0;
  const enemies = work.units.filter(u => u.player !== me && u.hp > 0 && E.canDamage(u));
  const pools0 = opts.enemyPools ? { ...opts.enemyPools } : { all: opts.orders == null ? 1e9 : opts.orders };
  const poolOf = e => opts.enemyPools ? e.pool : 'all';
  // posts: where each enemy could strike from, with the orders the walk
  // costs — the plain walk, and the force march beyond it (a march unlocks
  // the second band of steps at double the order price; the training it
  // costs is theirs to find)
  work.training = 9999;
  const posts = new Map();
  for (const e of enemies) {
    if (opts.fresh !== false) e.cooldown = null;
    e.steps = 0;
    if (info(e).bUnlimber) e.unlimbered = true;
    const ps = new Map([[key(e.q, e.r), { q: e.q, r: e.r, orders: 0 }]]);
    if (!info(e).bUnlimber) {
      for (const t of E.reachableTiles(work, e)) ps.set(key(t.q, t.r), { q: t.q, r: t.r, orders: t.orders });
      let marched = null; try { marched = E.applyAction(work, { type: 'march', unit: e.id }); } catch (x) { marched = null; }
      if (marched) for (const t of E.reachableTiles(marched, E.unitById(marched, e.id))) { const k = key(t.q, t.r); if (!ps.has(k) || ps.get(k).orders > t.orders) ps.set(k, { q: t.q, r: t.r, orders: t.orders }); }
    }
    posts.set(e.id, [...ps.values()]);
  }
  // a unit that routs (canRout) strikes again from its victim's tile: after
  // a kill it is not spent. The estimate gives such a unit LIVES extra
  // strikes at its best damage for one order each — an approximation of the
  // chain (the next victim must stand beside the last), and the piece of
  // every measured reply the one-strike-per-enemy count missed
  const LIVES = opts.routLives == null ? 2 : opts.routLives;
  const routs = e => canRout(e) && E.isMelee(e) ? LIVES : 0;
  // per (our unit, tile): for each enemy the Pareto options {orders, dmg} —
  // more orders only kept when they buy more damage
  const memo = new Map();
  function options(uid, t) {
    const k = uid + '|' + t;
    if (memo.has(k)) return memo.get(k);
    const u = E.unitById(work, uid), tq = unkey(t);
    const out = [];
    if (u && u.hp > 0) {
      const q0 = u.q, r0 = u.r; u.q = tq.q; u.r = tq.r;
      for (const e of enemies) {
        const eq = e.q, er = e.r;
        const byOrders = new Map();
        for (const p of posts.get(e.id)) {
          const dist = E.hexDistance(p, tq);
          if (E.isMelee(e) ? dist !== 1 : (dist < rangeMin(e) || dist > E.effectiveRange(work, e, p, tq) || E.isShotObstructed(work, p, tq))) continue;
          e.q = p.q; e.r = p.r;
          let d = 0; try { d = E.attackUnitDamage(work, e, p, u); } catch (x) { d = 0; }
          if (d > 0 && d > (byOrders.get(p.orders) || 0)) byOrders.set(p.orders, d);
        }
        e.q = eq; e.r = er;
        const ps = [...byOrders].sort((a, b) => a[0] - b[0]);
        const pareto = []; let best = 0;
        for (const [o, d] of ps) if (d > best) { pareto.push({ orders: o + 1, dmg: d }); best = d; }
        if (pareto.length) out.push({ id: e.id, pool: poolOf(e), melee: E.isMelee(e), opts: pareto, lives: routs(e), again: routs(e) ? { orders: 1, dmg: best } : null });
      }
      u.q = q0; u.r = r0;
    }
    memo.set(k, out);
    return out;
  }
  // the cheapest kill of our unit at t with hp, over enemies not in `used`
  // and orders left in `pools` (null: no limit): greedy by damage per order
  // `used` maps enemy id -> strikes spent (a Set is read as one each);
  // `turns` (default 1): over two turns every enemy strikes once more, from
  // where it will already stand
  // `skip`: enemies to leave out — the ones a blow kills cannot strike back
  function killPlan(uid, t, hp, used, pools, turns, skip) {
    if (unseen(uid, t)) return null;
    // a tile answers an attack with its best defender (Tile.defendingUnit):
    // a scout standing under a spearman is nobody's target while it stands
    if (E.tileDefender) { const { q, r } = unkey(t); const d = E.tileDefender(state, q, r, null); if (d && d.id !== uid && d.player === me && E.unitById(state, uid) && (E.unitById(state, uid).q !== q || E.unitById(state, uid).r !== r ? false : true)) return null; }
    turns = turns || 1;
    const spentOf = id => !used ? 0 : used instanceof Map ? (used.get(id) || 0) : (used.has(id) ? 1 : 0);
    const cands = [];
    for (const o of options(uid, t)) {
      if (skip && skip.has(o.id)) continue;
      const n = spentOf(o.id);
      if (n === 0) { for (const x of o.opts) if (!pools || (pools[o.pool] || 0) >= x.orders) cands.push({ id: o.id, pool: o.pool, melee: o.melee, orders: x.orders, dmg: x.dmg }); }
      else if (o.again && n <= o.lives) { if (!pools || (pools[o.pool] || 0) >= 1) cands.push({ id: o.id, pool: o.pool, melee: true, orders: 1, dmg: o.again.dmg, again: true }); }
      if (turns > 1 && n === 0) { const best = o.opts[o.opts.length - 1]; for (let k = 1; k < turns; k++) cands.push({ id: o.id + ':' + k, pool: o.pool, melee: o.melee, orders: 1, dmg: best.dmg, later: true }); }
    }
    cands.sort((a, b) => (b.dmg / b.orders) - (a.dmg / a.orders) || a.orders - b.orders);
    let need = hp, cost = 0, melee = 0; const blows = [], taken = new Set(), spent = {};
    const seats = meleeSeats(uid, t);
    for (const c of cands) {
      if (need <= 0) break;
      if (taken.has(c.id)) continue;
      if (c.melee && melee >= seats) continue;
      if (pools && (pools[c.pool] || 0) - (spent[c.pool] || 0) < c.orders) continue;
      taken.add(c.id); blows.push(c); cost += c.orders; need -= c.dmg; if (c.melee) melee++;
      spent[c.pool] = (spent[c.pool] || 0) + c.orders;
    }
    return need <= 0 ? { cost, blows } : null;
  }
  // a melee striker needs a tile beside the seat: the six neighbours less
  // those our other units hold and those nobody can stand on. Inside our own
  // formation a seat has two or three, not six — a line that packs four
  // units round a kill leaves the chariots nowhere to strike from
  const seatMemo = new Map();
  function meleeSeats(uid, t) {
    if (seatMemo.has(uid + '|' + t)) return seatMemo.get(uid + '|' + t);
    const { q, r } = unkey(t);
    let n = 0;
    for (const d of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const nq = q + d[0], nr = r + d[1];
      const tile = E.tileAt(state, nq, nr); if (!tile) continue;
      if (tile.height === 'HEIGHT_MOUNTAIN' || tile.height === 'HEIGHT_VOLCANO') continue;
      const ours = state.units.find(u => u.player === me && u.hp > 0 && u.id !== uid && u.q === nq && u.r === nr);
      if (ours) continue;
      n++;
    }
    seatMemo.set(uid + '|' + t, n);
    return n;
  }
  const killCost = (uid, t, hp, skip) => { const k = killPlan(uid, t, hp, null, null, 1, skip); return k ? k.cost : null; };

  // ---- committed seats. stepsFrom: where our unit could step from t with a
  // fresh move on the board as it stands; locked: nowhere (a ZOC tile whose
  // every neighbour is ZOC or blocked, Unit.isValidMovementDirection,
  // Unit.cs:7685); lockable: they have the bodies to close every way out
  // next turn. A hex is shut when its six neighbours are all in their zone
  // or occupied; a ZOC unit of theirs standing beside the seat shuts three
  // of them (its own tile and the two it flanks), a walled city beside it
  // does the same, so two such units on opposite sides close an open hex
  // and one closes a hex the city already half-holds. Counted: their ZOC
  // units that can reach a tile beside the seat with the coming turn's
  // walk (posts, marched included), against the exits open now
  const stepMemo = new Map();
  function placed(uid, t) {
    const w = E.cloneState(state); w.orders = 99;
    const u = E.unitById(w, uid), { q, r } = unkey(t);
    u.q = q; u.r = r; u.cooldown = null; u.steps = 0;
    return { w, u };
  }
  function stepsFrom(uid, t) {
    const k = uid + '|' + t;
    if (!stepMemo.has(k)) { const { w, u } = placed(uid, t); stepMemo.set(k, E.reachableTiles(w, u)); }
    return stepMemo.get(k);
  }
  const locked = (uid, t, skip) => {
    const u = E.unitById(state, uid); if (!u || u.hp <= 0) return false;
    if (!skip || !skip.size) return stepsFrom(uid, t).length === 0;
    const { w, u: me } = placed(uid, t);
    for (const e of w.units) if (skip.has(e.id)) e.hp = 0;
    return E.reachableTiles(w, me).length === 0;
  };
  const lockMemo = new Map();
  function lockable(uid, t, skip) {
    const k = uid + '|' + t + (skip && skip.size ? '|' + [...skip].sort().join(',') : '');
    if (lockMemo.has(k)) return lockMemo.get(k);
    let out = false;
    const u0 = E.unitById(state, uid);
    if (u0 && u0.hp > 0 && E.inEnemyZOC) {
      const { w, u } = placed(uid, t), { q, r } = unkey(t);
      const exits = stepsFrom(uid, t).filter(x => E.hexDistance(x, { q, r }) === 1 && !E.inEnemyZOC(w, u, x.q, x.r));
      if (!exits.length) out = E.inEnemyZOC(w, u, q, r);
      else {
        let beside = 0;
        for (const e of enemies) {
          if (!info(e).bZOC || (skip && skip.has(e.id))) continue;
          if (posts.get(e.id).some(p => E.hexDistance(p, { q, r }) === 1 && !(p.q === q && p.r === r))) beside++;
        }
        out = beside >= 1 && 3 * beside >= exits.length;
      }
    }
    lockMemo.set(k, out);
    return out;
  }
  const twoTurnPools = () => { const o = {}; for (const k of Object.keys(pools0)) o[k] = 2 * pools0[k]; return o; };
  function committed(uid, t, hp, skip) {
    const u = E.unitById(state, uid); if (!u || u.hp <= 0) return false;
    if (!(locked(uid, t, skip) || lockable(uid, t, skip))) return false;
    return !!killPlan(uid, t, hp == null ? u.hp : hp, null, twoTurnPools(), 2, skip);
  }
  // the greedy reply on a state: cheapest strength first until the pools run dry
  function estimate(s2) {
    const alive = new Set(s2.units.filter(u => u.hp > 0).map(u => u.id));
    const used = new Map(enemies.filter(e => !alive.has(e.id)).map(e => [e.id, 99]));   // the line killed them
    const pools = { ...pools0 };
    const ours = s2.units.filter(u => u.player === me && u.hp > 0 && STR(u) > 0 && E.unitById(state, u.id));
    const left = new Map(ours.map(u => [u.id, u]));
    const kills = []; let str = 0, lambda = null, spent = 0;
    for (;;) {
      let pick = null;
      for (const u of left.values()) {
        const k = killPlan(u.id, key(u.q, u.r), u.hp, used, pools);
        if (!k) continue;
        const ratio = k.cost / STR(u);
        if (!pick || ratio < pick.ratio) pick = { u, k, ratio };
      }
      if (!pick) break;
      for (const b of pick.k.blows) { used.set(b.id, (used.get(b.id) || 0) + 1); pools[b.pool] -= b.orders; }
      kills.push({ id: pick.u.id, cost: pick.k.cost, blows: pick.k.blows });
      str += STR(pick.u); spent += pick.k.cost; lambda = pick.ratio; left.delete(pick.u.id);
    }
    // what they cannot kill this turn but have committed: no way out, dead
    // over two turns
    const committedList = [...left.values()].filter(u => committed(u.id, key(u.q, u.r), u.hp)).map(u => ({ id: u.id, str: STR(u) }));
    // the margin: the dearest kill bought, orders per strength point. When
    // money was left over the budget never bound, but the margin still says
    // what a dear kill looks like on this board
    const bound = Object.values(pools).some(v => v < 3);
    return { str, kills, lambda, bound, spent, committed: committedList, committedStr: committedList.reduce((a, c) => a + c.str, 0) };
  }
  let base = null;
  const margin = () => { if (!base) base = estimate(state); return base.lambda; };
  // STR × the chance they take that kill: full under the margin, falling
  // with the cost beyond it — to nothing at twice the margin when their
  // money binds, to a quarter when it does not (a dear kill is still the
  // last one they buy, and one they may leave for a nearer one)
  // `skip` (a Set of enemy ids): the enemies this seat's blow kills — they
  // neither strike it nor shut it. A blow is only taken if its target dies
  // (model.js kill rows), so excluding the target is exact, not a guess
  const price = (uid, t, hp, skip) => {
    const u = E.unitById(state, uid); if (!u || u.hp <= 0 || STR(u) <= 0) return 0;
    const c = killCost(uid, t, hp == null ? u.hp : hp, skip);
    if (c == null) return committed(uid, t, hp, skip) ? STR(u) : 0;
    const lam = margin();
    if (lam == null) return STR(u);
    const ratio = c / STR(u);
    const floor = base.bound ? 0 : 0.25;
    return STR(u) * Math.max(floor, Math.min(1, (2 * lam - ratio) / lam));
  };
  const restMemo = new Map();
  function rest(uid) {
    if (restMemo.has(uid)) return restMemo.get(uid);
    const u = E.unitById(state, uid);
    const home = key(u.q, u.r);
    let best = { seat: home, orders: 0, price: price(uid, home, u.hp) };
    if (!u.cooldown && !info(u).bUnlimber) {
      for (const t of E.reachableTiles(state, u)) {
        const k = key(t.q, t.r), p = price(uid, k, u.hp) + ordW * t.orders;
        if (p < best.price - 1e-9) best = { seat: k, orders: t.orders, price: p };
      }
    }
    restMemo.set(uid, best);
    return best;
  }
  return { options, killCost, killPlan, price, rest, estimate, margin, locked, lockable, committed, base: () => { margin(); return base; } };
}

module.exports = { threatMap, replyEstimate, STR };
