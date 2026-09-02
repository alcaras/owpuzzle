// The scheduled ILP model: every blow has its own firing time.
//
// A kill-order model ("a blow fires in its target's group") cannot express
// the author's line on f6ff55: the crossbow fires at the cataphract early
// (after the disarm, before the archer behind dies, so its pierce still
// lands) while the cataphract itself dies three blows later. Here each seat
// blow b has a time t_b, each chain blow t_c, each target a death time tau_r,
// and every "before/after" rule is a row between those times under an
// enforcement literal. The executor then simply sorts.
//
// Times are RANKS, not clocks: only the order of events matters, so integer
// times with a unit gap suffice. The full model is what the sub-problem
// solves; `binaryMaster` (solve.js) keeps only its binary rows — plus the
// death-order RANK integers `rk` — as the timing-free relaxation that picks
// the kill set. Every binary row here that a timing row implies (the `hx`
// hand-over corollaries, the `cy` cycle cuts, the `rk` rank rows) exists so
// that the master cannot promise a kill set the schedule cannot deliver;
// each was found by fixing a master solution in the full model and deleting
// row families until it became feasible.
//
// opts: eps (objective weight per damage point), ordW (per order), kills (a
// Set of red ids: y fixed 0 outside it), damageOnly, exposure(blow) penalty,
// counterW (per hp of counter damage taken; 0 = our hp is free), exposeW
// (per STR of loss the enemy could inflict on the seat; threat.js) with
// enemyOrders (their pool, for the threat map's reach).
'use strict';
const E = require('./engine.js');
const { Model } = require('./lp.js');
const { key, unkey, STR, hasLastStand, isImmune, MARCH_COST } = require('./blowtable.js');
const { threatMap } = require('./threat.js');
const sk = s => s.replace(/-/g, 'm').replace(',', '_');

function buildModel(state, T, pool, opts) {
  opts = opts || {};
  const dW = opts.eps == null ? 0.02 : opts.eps;        // objective weight per damage point
  const ordW = opts.ordW == null ? 0.001 : opts.ordW;   // per order spent
  const m = new Model('Maximize'); m.timeScale = 1;   // integer times: cpsat.py scales by this
  const reds = T.reds, NR = reds.length;
  // a schedule with E events fits in E slots; the horizon is generous but a
  // small domain is what CP-SAT wants
  const H = 4 * NR + 8, G = 1;
  const Y = r => 'y' + r.id, X = b => 'x' + b.id, C = c => 'c' + c.id, TAU = r => 'tau' + r.id;
  const TB = b => 't' + b.id, TC = c => 'tc' + c.id, W = b => 'w' + b.id, WC = c => 'wc' + c.id;
  const F = (u, p) => 'f' + u + '_' + p;
  const red = id => T.redById.get(id);
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  const onTarget = new Map();   // red -> [[dmg, var, unit]]
  const hit = (rid, dmg, v, unit) => push(onTarget, rid, [dmg, v, unit]);

  for (const r of reds) {
    m.addVar(Y(r), { binary: true, obj: STR(r), ub: opts.kills && !opts.kills.has(r.id) ? 0 : 1 });
    m.addVar(TAU(r), { lb: 0, ub: H });
    m.addCon('alive' + r.id, [[1, TAU(r)], [H, Y(r)]], '>=', H);   // an unkilled red lives to the horizon
  }
  // EXACT reds are those whose death time must be the moment of the killing
  // hit, because something is built on it: a rout advance (the killer steps
  // in), a PANIC push (last thing that happens to the target), Last Stand.
  // Every other red only needs tau >= each counted hit: a kill counted that
  // way is real (the red is dead by tau at the latest), and dependents that
  // wait for tau merely wait a little longer. That drops the "designated
  // last blow" machinery from most of the model.
  const exact = new Set();
  for (const c of T.chains) exact.add(c.from);
  for (const b of T.blows) if (b.push) exact.add(b.target);
  for (const c of T.chains) if (c.push) exact.add(c.target);
  for (const r of reds) if (hasLastStand(r) && r.hp > 1) exact.add(r.id);
  const perUnit = new Map(), perSeat = new Map();
  const lastOf = new Map();     // red -> [{w, t, x, dmg, unit}]  (exact reds only)
  for (const b of T.blows) {
    m.addVar(X(b), { binary: true, obj: dW * (b.dmg + b.coll.reduce((a, c) => a + c.dmg, 0)) - ordW * (b.mv + 1) });
    m.addVar(TB(b), { lb: 0, ub: H - 1 });
    if (b.push && b.escape) m.addVar('z' + b.id, { binary: true });
    push(perUnit, b.unit, b); push(perSeat, b.seat, b);
    hit(b.target, b.dmg, X(b), b.unit);
    if (exact.has(b.target)) { m.addVar(W(b), { binary: true }); push(lastOf, b.target, { w: W(b), t: TB(b), x: X(b), dmg: b.dmg, unit: b.unit }); }
    m.addCon('tb' + b.id, [[1, TB(b)], [-1, TAU(red(b.target))]], '<=', 0);
    if (b.req != null) m.addCon('req' + b.id, [[1, X(b)], [-1, Y(red(b.req))]], '<=', 0);
  }
  for (const c of T.chains) {
    m.addVar(C(c), { binary: true, obj: dW * (c.dmg + c.coll.reduce((a, x) => a + x.dmg, 0)) - ordW });
    m.addVar(TC(c), { lb: 0, ub: H - 1 });
    hit(c.target, c.dmg, C(c), c.unit);
    if (exact.has(c.target)) { m.addVar(WC(c), { binary: true }); push(lastOf, c.target, { w: WC(c), t: TC(c), x: C(c), dmg: c.dmg, unit: c.unit }); }
    m.addCon('tc' + c.id, [[1, TC(c)], [-1, TAU(red(c.target))]], '<=', 0);
  }
  for (const [uid, list] of perUnit) m.addCon('u' + uid, list.map(b => [1, X(b)]), '<=', 1);
  // kills only: a blow is worth taking only if its target or a splash victim
  // dies (pushes exempt — they disarm). Damage for its own sake is not an
  // objective here, and the row tightens the LP enormously: without it the
  // relaxation spreads fractional blows over every red.
  if (!opts.damageOnly) {
    const ky = (id, t, coll) => { const ys = new Set([t, ...coll.map(c => c.id)].filter(i => red(i))); return [...ys].map(i => [-1, Y(red(i))]); };
    for (const b of T.blows) if (!b.push) m.addCon('ko' + b.id, [[1, X(b)]].concat(ky(b.id, b.target, b.coll)), '<=', 0);
    for (const c of T.chains) m.addCon('kc' + c.id, [[1, C(c)]].concat(ky(c.id, c.target, c.coll)), '<=', 0);
  }

  // collateral lands on v iff the blow fires while v is alive — it is not
  // optional: either cc (fired before v's death, damage counts, may even be
  // the killing hit) or `after` (fired strictly after). Leaving it optional
  // let the solver ignore splash that killed reds early and broke its chains.
  let ncc = 0;
  const ccOf = new Map();   // blow/chain id -> [{victim, v}]
  const collateral = (xv, tv, c, unit, ownerId) => {
    const victim = red(c.id); if (!victim) return;
    if (opts.kills && !opts.kills.has(c.id)) return;   // an unkillable victim: splash lands, nobody cares
    const v = 'cc' + (ncc++);
    m.addVar(v, { binary: true });
    push(ccOf, ownerId, { victim: c.id, v });
    m.addCon('ccx' + v, [[1, v], [-1, xv]], '<=', 0);
    m.addCon('cct' + v, [[1, tv], [-1, TAU(victim)]], '<=', 0, [v]);                  // counted: fired while alive
    m.addCon('caf' + v, [[1, TAU(victim)], [-1, tv]], '<=', -G, [xv, '!' + v]);      // not counted: fired after the death
    hit(c.id, c.dmg, v, unit);
    if (exact.has(c.id)) { const w = 'w' + v; m.addVar(w, { binary: true }); push(lastOf, c.id, { w, t: tv, x: v, dmg: c.dmg, unit, gate: v }); }
  };
  for (const b of T.blows) for (const c of b.coll) collateral(X(b), TB(b), c, b.unit, b.id);
  for (const c of T.chains) for (const x of c.coll) collateral(C(c), TC(c), x, c.unit, c.id);

  // the designated LAST blow on each victim sets its death time; every other
  // blow on it fires strictly earlier
  for (const r of reds) {
    if (!exact.has(r.id)) continue;
    const L = lastOf.get(r.id) || [];
    m.addCon('w1_' + r.id, L.map(l => [1, l.w]).concat([[-1, Y(r)]]), '=', 0);
    for (const l of L) {
      m.addCon('wx' + l.w, [[1, l.w], [-1, l.x]], '<=', 0);
      m.addCon('wt' + l.w, [[1, TAU(r)], [-1, l.t]], '<=', 0, [l.w]);
      m.addCon('wb' + l.w, [[1, l.t], [-1, TAU(r)]], '<=', -G, ['!' + l.w].concat(l.gate ? [l.gate] : []));
    }
  }


  // rout paths. F(u,p): u's LAST blow on p is adjacent, so u advances into p's tile.
  const Fvars = new Map();       // 'u_p' -> {unit, p}
  const chainsFrom = new Map();  // 'u_p' -> chains out of p
  const routUnits = new Set(T.chains.map(c => c.unit));
  const ensureF = (unit, p) => { const k = unit + '_' + p; if (!Fvars.has(k)) { Fvars.set(k, { unit, p }); m.addVar(F(unit, p), { binary: true }); } return k; };
  for (const c of T.chains) push(chainsFrom, ensureF(c.unit, c.from), c);
  for (const b of T.blows) {
    if (!b.adj || !routUnits.has(b.unit) || isImmune(red(b.target), 'EFFECTUNIT_ROUT')) continue;
    if (!chainsFrom.has(b.unit + '_' + b.target)) continue;   // nowhere to go from there: no advance to model
    ensureF(b.unit, b.target);
  }
  for (const [k, fv] of Fvars) {
    const p = red(fv.p), f = F(fv.unit, fv.p);
    const arrivals = (perUnit.get(fv.unit) || []).filter(b => b.adj && b.target === fv.p).map(b => [-1, W(b)])
      .concat(T.chains.filter(c => c.unit === fv.unit && c.target === fv.p).map(c => [-1, WC(c)]));
    m.addCon('fa' + k, [[1, f]].concat(arrivals), '<=', 0);
    for (const c of chainsFrom.get(k) || []) {
      m.addCon('cf' + c.id, [[1, C(c)], [-1, f]], '<=', 0);
      m.addCon('co' + c.id, [[1, TAU(p)], [-1, TC(c)]], '<=', -G, [C(c)]);   // strikes on after arriving
    }
    const cs = chainsFrom.get(k) || [];
    if (cs.length > 1) m.addCon('c1' + k, cs.map(c => [1, C(c)]), '<=', 1);
    // the advance is only modelled when it is used: F implies a chain blow
    m.addCon('fc' + k, [[1, f]].concat(cs.map(c => [-1, C(c)])), '<=', 0);
  }
  // a designated last blow must actually be the killer: everyone else < hp
  // (Last Stand caps every earlier blow at hp-1, so there it is the covering row)
  // D_r: total counted damage on r (defined below, once every hit — flank,
  // same-type, disarm delta — has been registered; rows may name it early)
  const D = r => 'D' + r.id;
  for (const r of reds) {
    if (!exact.has(r.id) || (hasLastStand(r) && r.hp > 1)) continue;
    for (const l of lastOf.get(r.id) || []) m.addCon('ff' + l.w, [[1, D(r)]], '<=', r.hp - 1 + l.dmg, [l.w]);
  }
  // a PANIC push either disarms (no escape) or is the last thing that happens
  // to its target — a displaced target invalidates every later blow's geometry
  for (const b of T.blows) {
    if (!b.push) continue;
    m.addCon('pl' + b.id, [[1, X(b)], [-1, W(b)]].concat(b.escape ? [[-1, 'z' + b.id]] : []), '<=', 0);
  }
  // a rout-advance strike by a pusher shoves too: it must be the killing hit
  // (no escape geometry is computed for chains, so no disarm option here)
  for (const c of T.chains) if (c.push) m.addCon('plc' + c.id, [[1, C(c)], [-1, WC(c)]], '<=', 0);

  // ---- occupancy items: who stands where, from when, until when.
  // item = {occ: [[1,var]...] (sum <= 1), arr: [[1,var]] time expr or null (=0),
  //         deps: [{d: var, at: tau var}], unit, kind}
  const homeKey = new Map(T.blueDamaging.map(u => [u.id, key(u.q, u.r)]));
  const actingIds = new Set(T.acting.map(u => u.id));
  const items = new Map();      // tile -> [item]
  const seatItem = new Map();   // 'u|seat' -> item
  const arrOf = new Map();      // blow id -> arr var name (null = 0)
  for (const [uid, list] of perUnit) {
    const home = homeKey.get(uid);
    const bySeat = new Map();
    for (const b of list) push(bySeat, b.seat, b);
    // stays home: not moving away (idle or attacking from home)
    const hm = 'hm' + uid; m.addVar(hm, { binary: true });
    m.addCon('hm' + uid, [[1, hm]].concat(list.filter(b => b.seat !== home).map(b => [1, X(b)])), '=', 1);
    for (const [seat, bs] of bySeat) {
      const it = { unit: uid, seat, kind: seat === home ? 'home' : 'seat', occ: [], arr: null, deps: [], blows: bs };
      if (seat === home) it.occ = [[1, hm]];
      else {
        const arr = 'ar' + uid + '_' + sk(seat); m.addVar(arr, { lb: 0, ub: H - 1 }); it.arr = [[1, arr]];
        if (bs.length === 1) it.occ = [[1, X(bs[0])]];
        else {   // one occupancy variable per (unit, seat) keeps the tile rows short
          const oc = 'oc' + uid + '_' + sk(seat); m.addVar(oc, { binary: true }); it.occ = [[1, oc]];
          m.addCon('oc' + uid + '_' + sk(seat), [[1, oc]].concat(bs.map(b => [-1, X(b)])), '=', 0);
        }
        for (const b of bs) {
          m.addCon('at' + b.id, [[1, arr], [-1, TB(b)]], '<=', 0, [X(b)]);   // move before firing
          if (b.req != null) m.addCon('ar' + b.id, [[1, TAU(red(b.req))], [-1, arr]], '<=', -G, [X(b)]);   // only once the blocker is dead
        }
      }
      for (const b of bs) {
        arrOf.set(b.id, it.arr ? it.arr[0][1] : null);
        if (!b.adj || !Fvars.has(b.unit + '_' + b.target)) continue;
        const d = 'd' + b.id; m.addVar(d, { binary: true });     // departs by advancing into the victim
        m.addCon('dx' + b.id, [[1, d], [-1, X(b)]], '<=', 0);
        m.addCon('df' + b.id, [[1, d], [-1, F(b.unit, b.target)]], '<=', 0);
        m.addCon('dl' + b.id, [[1, d], [-1, X(b)], [-1, F(b.unit, b.target)]], '>=', -1);
        it.deps.push({ d, at: TAU(red(b.target)), p: b.target });
      }
      push(items, seat, it); seatItem.set(uid + '|' + seat, it);
    }
    if (!bySeat.has(home)) {
      const it = { unit: uid, seat: home, kind: 'home', occ: [[1, hm]], arr: null, deps: [], blows: [] };
      push(items, home, it); seatItem.set(uid + '|' + home, it);
    }
  }
  for (const u of T.blueDamaging) {     // cannot act this turn: a fixed body
    if (actingIds.has(u.id)) continue;
    push(items, key(u.q, u.r), { unit: u.id, seat: key(u.q, u.r), kind: 'fixed', occ: [], arr: null, deps: [], blows: [] });
  }
  const fItem = new Map();      // 'u_p' -> item
  for (const [k, fv] of Fvars) {
    const p = red(fv.p);
    const it = { unit: fv.unit, seat: key(p.q, p.r), kind: 'F', occ: [[1, F(fv.unit, fv.p)]], arr: [[1, TAU(p)]], deps: [], p: fv.p };
    for (const c of chainsFrom.get(k) || []) {
      if (!Fvars.has(c.unit + '_' + c.target)) continue;
      const d = 'dc' + c.id; m.addVar(d, { binary: true });
      m.addCon('dcx' + c.id, [[1, d], [-1, C(c)]], '<=', 0);
      m.addCon('dcf' + c.id, [[1, d], [-1, F(c.unit, c.target)]], '<=', 0);
      m.addCon('dcl' + c.id, [[1, d], [-1, C(c)], [-1, F(c.unit, c.target)]], '>=', -1);
      it.deps.push({ d, at: TAU(red(c.target)), p: c.target });
    }
    push(items, it.seat, it); fItem.set(k, it);
  }
  // precedence edges p -> q (literal true => tau(p) < tau(q)); a directed
  // cycle is infeasible, and the master cannot see that through tau. Cut the
  // 2-cycles explicitly (binary rows, so the master inherits them); longer
  // cycles are handled by the rank integers below (3-cycle cuts were tried:
  // 38k rows on a 43-v-54 board and the 4-cycles still got through).
  {
    const edges = new Map();   // 'p>q' -> [literal]
    const addE = (p, q, l) => { if (p !== q && red(p) && red(q)) push(edges, p + '>' + q, l); };
    for (const c of T.chains) {
      addE(c.from, c.target, C(c));
      for (const cc of ccOf.get(c.id) || []) addE(c.from, cc.victim, cc.v);
    }
    for (const b of T.blows) {
      if (b.req == null) continue;
      addE(b.req, b.target, X(b));
      for (const cc of ccOf.get(b.id) || []) addE(b.req, cc.victim, cc.v);
    }
    const out = new Map();     // p -> Set(q)
    for (const k of edges.keys()) { const [p, q] = k.split('>'); if (!out.has(p)) out.set(p, new Set()); out.get(p).add(q); }
    let n2 = 0;
    for (const [p, qs] of out) for (const q of qs) {
      if (p < q && out.get(q) && out.get(q).has(p))
        for (const a of edges.get(p + '>' + q)) for (const b of edges.get(q + '>' + p)) { m.addCon('cy' + (n2++), [[1, a], [1, b]], '<=', 1); }
    }
    // longer cycles: a death-order rank per red (an integer, so the master —
    // which keeps every `rk` var — sees the full precedence order without
    // any of the timing machinery). Redundant beside tau in the full model.
    let ne = 0;
    const RK = id => 'rk' + id;
    for (const r of reds) m.addVar(RK(r.id), { lb: 0, ub: reds.length });
    for (const [k, ls] of edges) { const [p, q] = k.split('>'); for (const l of ls) m.addCon('rk' + (ne++), [[1, RK(p)], [-1, RK(q)]], '<=', -1, [l]); }
    m.stats = { edges: edges.size, cycleCuts: n2, rankRows: ne };
  }
  // one body per tile at a time
  let no = 0;
  for (const [tile, its] of items) {
    if (its.length < 2) continue;
    if (its.some(it => it.kind === 'fixed')) {   // nobody else may plan to stand here
      for (const it of its) if (it.kind !== 'fixed') m.addCon('fx' + tile.replace(/[-,]/g, '_') + '_' + it.unit, it.occ, '<=', 0);
      continue;
    }
    const sn = 's' + sk(tile);
    m.addCon(sn, its.flatMap(it => it.occ).concat(its.flatMap(it => it.deps.map(d => [-1, d.d]))), '<=', 1);
    // timing-free corollary of the hand-over (binary, so the master sees it):
    // whoever takes the tile after a departure arrives once the victim is
    // dead, so cannot be one of the victim's hitters from here
    for (const a of its) for (const d of a.deps) {
      const p = d.p;
      for (const b of its) {
        if (a === b) continue;
        for (const bl of b.blows || []) {
          if (bl.target === p) m.addCon('hx' + d.d + '_' + bl.id, [[1, X(bl)], [1, d.d]], '<=', 1);
          for (const cc of ccOf.get(bl.id) || []) if (cc.victim === p) m.addCon('hx' + d.d + '_' + cc.v, [[1, cc.v], [1, d.d]], '<=', 1);
        }
        if (b.kind === 'F') for (const c of chainsFrom.get(b.unit + '_' + b.p) || []) {
          if (c.target === p) m.addCon('hxc' + d.d + '_' + c.id, [[1, C(c)], [1, d.d]], '<=', 1);
          for (const cc of ccOf.get(c.id) || []) if (cc.victim === p) m.addCon('hxc' + d.d + '_' + cc.v, [[1, cc.v], [1, d.d]], '<=', 1);
        }
      }
    }
    // a departing occupant hands the tile on: the next arrives after the victim dies
    for (const a of its) {
      if (!a.deps.length) continue;
      for (const b of its) {
        if (a === b) continue;
        if (b.deps.length) {
          const o = 'o' + (no++); m.addVar(o, { binary: true });   // a before b
          // if both present, one of them goes first (the other direction is generated in its own pass)
          if (!b.oPair) b.oPair = new Map();
          if (!a.oPair) a.oPair = new Map();
          a.oPair.set(b, o);
          for (const d of a.deps) m.addCon('r' + o + '_' + d.d, [[1, d.at]].concat(b.arr ? b.arr.map(t => [-t[0], t[1]]) : []), '<=', -G, [o, d.d]);
          m.addCon('od' + o, [[1, o]].concat(a.deps.map(d => [-1, d.d])), '<=', 0);
        } else {
          // b never leaves, so a must be first: for each of b's occupancy terms
          for (const d of a.deps) for (const ob of b.occ) m.addCon('r' + d.d + '_' + ob[1], [[1, d.at]].concat(b.arr ? b.arr.map(t => [-t[0], t[1]]) : []), '<=', -G, [d.d, ob[1]]);
        }
      }
    }
    for (const a of its) if (a.oPair) for (const [b, o] of a.oPair) {
      const ob = b.oPair && b.oPair.get(a);
      if (!ob || a.unit > b.unit) continue;   // once per pair
      m.addCon('o2' + o, [[1, o], [1, ob]].concat(a.occ.map(t => [-1, t[1]])).concat(b.occ.map(t => [-1, t[1]])), '>=', -1);
    }
  }
  // a unit's home tile can be someone else's seat only if it leaves
  for (const [tile, its] of items) {
    const homes = its.filter(it => it.kind === 'home');
    for (const h of homes) for (const it of its) {
      if (it === h || it.kind === 'fixed') continue;
      const away = (perUnit.get(h.unit) || []).filter(b => b.seat !== tile).map(b => [-1, X(b)]);
      m.addCon('hv' + h.unit + '_' + it.unit + '_' + it.kind, it.occ.concat(away), '<=', 0);
    }
  }

  // ---- presence: "a friendly (damaging) body stands on tile o at time t".
  // Returns terms [[1, useVar]] for the disjunction; one use var per item,
  // gated by the item's arrival and departure times.
  let nuse = 0;
  function presence(o, t, exclUnit, opt) {
    opt = opt || {};
    const terms = []; let always = false;
    for (const it of items.get(o) || []) {
      if (it.unit === exclUnit) continue;
      const u = E.unitById(state, it.unit);
      if (opt.type && u.type !== opt.type) continue;
      if (it.kind === 'fixed') { always = true; continue; }
      const use = 'p' + (nuse++); m.addVar(use, { binary: true });
      m.addCon('pu' + use, [[1, use]].concat(it.occ.map(x => [-1, x[1]])), '<=', 0);
      // arrival: for a blocker the victim's own tile is blocked before the rout arrives, so skip
      if (it.arr && !(opt.block && it.kind === 'F')) m.addCon('pa' + use, it.arr.concat([[-1, t]]), '<=', 0, [use]);
      for (const d of it.deps) m.addCon('pd' + use + '_' + d.d, [[1, t], [-1, d.at]], '<=', -G, [use, d.d]);
      terms.push([1, use]);
    }
    return { terms, always };
  }
  // positional coupling: flank partner opposite, same-type friend adjacent
  const couple = (b, name, pres, delta) => {
    const v = name + b.id; m.addVar(v, { binary: true, obj: dW * delta });
    m.addCon(name + 'x' + b.id, [[1, v], [-1, X(b)]], '<=', 0);
    if (!pres.always) m.addCon(name + 'p' + b.id, [[1, v]].concat(pres.terms.map(t => [-t[0], t[1]])), '<=', 0);
    hit(b.target, delta, v, b.unit);
  };
  for (const b of T.blows) {
    if (b.flank) couple(b, 'fl', presence(b.flank.o, TB(b), b.unit), b.flank.dmg - b.dmg);
    if (b.same) {
      const u = E.unitById(state, b.unit), sq = unkey(b.seat);
      const pres = { terms: [], always: false };
      for (let d = 0; d < 6; d++) {
        const pr = presence(key(sq.q + E.DIRS[d].q, sq.r + E.DIRS[d].r), TB(b), b.unit, { type: u.type });
        pres.terms.push(...pr.terms); pres.always = pres.always || pr.always;
      }
      couple(b, 'sm', pres, b.same.dmg - b.dmg);
    }
  }
  // disarm: z_b = the push finds every escape tile blocked when it fires
  const disarmOf = new Map();   // target -> [{z, t}]
  for (const b of T.blows) {
    if (!b.push || !b.escape) continue;
    const z = 'z' + b.id;
    m.addCon('zx' + b.id, [[1, z], [-1, X(b)]], '<=', 0);
    for (const c of b.escape) {
      const terms = [];
      const r = E.unitAt(state, unkey(c).q, unkey(c).r);
      if (r && r.player !== 0 && r.hp > 0) {
        const a = 'a' + r.id + '_' + b.id; m.addVar(a, { binary: true }); terms.push([1, a]);
        m.addCon('al' + a, [[1, TB(b)], [-1, TAU(r)]], '<=', -G, [a]);   // still alive when the push fires
      }
      const pres = presence(c, TB(b), b.unit, { block: true });
      if (pres.always) continue;
      terms.push(...pres.terms);
      m.addCon('zc' + b.id + '_' + sk(c), [[1, z]].concat(terms.map(x => [-x[0], x[1]])), '<=', 0);
    }
    push(disarmOf, b.target, { z, t: TB(b) });
  }
  // td_p = when p was disarmed (lower-bounded by every disarming push on it)
  const tdOf = new Map();
  for (const [p, zs] of disarmOf) {
    const td = 'td' + p; m.addVar(td, { lb: 0, ub: H }); tdOf.set(p, td);
    for (const z of zs) m.addCon('tdz' + z.z, [[1, z.t], [-1, td]], '<=', 0, [z.z]);
  }
  const cash = (v, xv, tv, target, delta, unit) => {
    m.addVar(v, { binary: true, obj: dW * delta });
    m.addCon('zzx' + v, [[1, v], [-1, xv]], '<=', 0);
    const zs = disarmOf.get(target);
    m.addCon('zzz' + v, [[1, v]].concat(zs.map(z => [-1, z.z])), '<=', 0);
    m.addCon('zzt' + v, [[1, tdOf.get(target)], [-1, tv]], '<=', -G, [v]);   // after the push
    hit(target, delta, v, unit);
  };
  for (const b of T.blows) if (b.disarmDelta && disarmOf.has(b.target)) cash('zz' + b.id, X(b), TB(b), b.target, b.disarmDelta, b.unit);
  for (const c of T.chains) if (c.disarmDelta && disarmOf.has(c.target)) cash('zk' + c.id, C(c), TC(c), c.target, c.disarmDelta, c.unit);

  for (const r of reds) {
    const terms = (onTarget.get(r.id) || []).map(h => [h[0], h[1]]);
    m.addVar(D(r), { lb: 0, ub: terms.reduce((a, t) => a + Math.max(0, t[0]), 0) });
    m.addCon('D' + r.id, [[1, D(r)]].concat(terms.map(t => [-t[0], t[1]])), '=', 0);
  }
  // covering
  for (const r of reds) {
    if (hasLastStand(r) && r.hp > 1) {
      m.addCon('cov' + r.id, [[1, D(r)]].concat((lastOf.get(r.id) || []).map(l => [-l.dmg, l.w])).concat([[-(r.hp - 1), Y(r)]]), '>=', 0);
    } else {
      m.addCon('cov' + r.id, [[1, D(r)], [-r.hp, Y(r)]], '>=', 0);
    }
  }
  // orders and training
  m.addCon('orders', T.blows.map(b => [b.mv + 1, X(b)]).concat(T.chains.map(c => [1, C(c)])), '<=', pool);
  const marchBlows = T.blows.filter(b => b.march);
  if (marchBlows.length) {
    const byU = new Map();
    for (const b of marchBlows) push(byU, b.unit, b);
    const mv = [];
    for (const [u, list] of byU) {
      const v = 'mch' + u; m.addVar(v, { binary: true }); mv.push(v);
      for (const b of list) m.addCon('mx' + b.id, [[1, X(b)], [-1, v]], '<=', 0);
    }
    m.addCon('training', mv.map(v => [MARCH_COST, v]), '<=', state.training);
  }
  if (opts.exposure) for (const b of T.blows) { const pen = opts.exposure(b); if (pen) m.addObj(X(b), -pen); }
  // exposure: what the enemy could take from the unit where the blow leaves
  // it, priced against its home (threat.js). A seat safer than home is a
  // small reward, a seat in reach of the whole line costs the unit's worth.
  // The map is memoised on the table: every model built on it shares one.
  const exposeW = opts.exposeW == null ? 0 : opts.exposeW;
  if (exposeW) {
    if (!T.threat) T.threat = threatMap(state, { orders: opts.enemyOrders });
    for (const b of T.blows) {
      const pen = exposeW * (T.threat.loss(b.unit, b.seat) - T.threat.loss(b.unit, homeKey.get(b.unit)));
      if (pen) m.addObj(X(b), -pen);
    }
  }
  // counters never kill (Unit.cs:10614 caps them at hp-1), so nothing here
  // stops a plan on survival grounds. What they do is leave our units weaker
  // for the opponent's reply: counterW prices each point of counter damage
  // a blow takes (0 for a maxKill puzzle, where our hp is worthless once the
  // turn ends). The table's counter is the one the FIRST blow takes; later
  // blows on a worn unit take less, so this over-charges slightly.
  const counterW = opts.counterW == null ? 0 : opts.counterW;
  if (counterW) {
    for (const b of T.blows) if (b.counter) m.addObj(X(b), -counterW * b.counter);
    for (const c of T.chains) if (c.counter) m.addObj(C(c), -counterW * c.counter);
  }
  m.arrOf = arrOf;
  return m;
}

function extractPlan(T, sol, m) {
  const val = n => sol.values.get(n) || 0;
  const v = n => val(n) > 0.5;
  const blows = T.blows.filter(b => v('x' + b.id));
  for (const b of blows) { b.last = v('w' + b.id); b.t = val('t' + b.id); const a = m.arrOf.get(b.id); b.arr = a ? val(a) : 0; }
  const chains = T.chains.filter(c => v('c' + c.id));
  for (const c of chains) c.t = val('tc' + c.id);
  const kills = T.reds.filter(r => v('y' + r.id));
  const tau = new Map(T.reds.map(r => [r.id, val('tau' + r.id)]));
  return { blows, chains, kills, tau, model: sol.obj };
}

// ---------------------------------------------------------------- execution
// The plan is a schedule: moves at their arrival times, blows at their firing
// times. Sort, play, retry what the crowd blocked.
function executePlan(state, plan, log) {
  let s = state;
  const line = [];
  const act = a => { s = E.applyAction(s, a); line.push(a); };
  const ev = [];
  for (const b of plan.blows) {
    const u = E.unitById(s, b.unit); const { q, r } = unkey(b.seat);
    if (u.q !== q || u.r !== r) ev.push({ t: b.arr, kind: 'move', b, tie: -b.mv });
    ev.push({ t: b.t, kind: 'blow', b, tie: 10 });
  }
  for (const c of plan.chains) ev.push({ t: c.t, kind: 'chain', c, tie: 10 });
  ev.sort((a, b) => (a.t - b.t) || (a.tie - b.tie));
  const doEv = e => {
    if (e.kind === 'move') {
      const u = E.unitById(s, e.b.unit); const { q, r } = unkey(e.b.seat);
      if (u.q === q && u.r === r) return 'ok';
      if (e.b.march && !u.march) { try { act({ type: 'march', unit: u.id }); } catch (x) { return 'nomarch'; } }
      try { act({ type: 'move', unit: u.id, q, r }); } catch (x) { return 'blocked'; }
      return 'ok';
    }
    const uid = e.kind === 'blow' ? e.b.unit : e.c.unit, tid = e.kind === 'blow' ? e.b.target : e.c.target;
    const u = E.unitById(s, uid), t = E.unitById(s, tid);
    if (!u || u.hp <= 0 || !t || t.hp <= 0) return 'dead';
    if (e.kind === 'blow') {
      const { q, r } = unkey(e.b.seat);
      if (u.q !== q || u.r !== r) return 'notthere';
    } else {
      const p = E.unitById(s, e.c.from);
      if (u.q !== p.q || u.r !== p.r) return 'notthere';
    }
    if (!E.canAttack(s, u) || !E.attackTargets(s, u).some(x => x.id === tid)) return 'noattack';
    const hp0 = t.hp;
    act({ type: 'attack', unit: uid, target: tid });
    if (log) {
      const planned = e.kind === 'blow' ? e.b.dmg : e.c.dmg;
      log.push(`t=${e.t.toFixed(2)} ${E.nameOf(u)}#${uid} ${e.kind === 'blow' ? '@' + e.b.seat : 'routing from #' + e.c.from} -> ${E.nameOf(t)}#${tid} (plan ${planned}, actual ${hp0 - E.unitById(s, tid).hp}, hp left ${E.unitById(s, tid).hp})`);
    }
    return 'ok';
  };
  let pending = ev;
  for (let pass = 0; pass < 3 && pending.length; pass++) {
    const next = [];
    for (const e of pending) {
      const res = doEv(e);
      if (res === 'blocked' || res === 'notthere') { next.push(e); if (log && pass === 0) log.push(`${res}: ${e.kind} ${e.kind === 'move' ? e.b.unit + ' -> ' + e.b.seat : ''}`); }
      else if (res !== 'ok' && log) log.push(`${res}: ${e.kind} ${e.kind === 'chain' ? 'c' + e.c.unit + '->' + e.c.target : e.b.unit + '@' + e.b.seat + '->' + e.b.target}`);
    }
    pending = next;
  }
  return { state: s, line };
}

module.exports = { buildModel, extractPlan, executePlan };
