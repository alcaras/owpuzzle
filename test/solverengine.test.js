// The ILP position solver (tools/solverengine/): structural checks that run on
// every push, and the solver gauntlet behind OWP_ILP=1 (`npm run test:ilp`),
// which needs the HiGHS package installed under tools/solverengine and a python
// with ortools for CP-SAT.
//
// The planner is a FINDER — a line it reaches is engine-replayed and real; a
// line it misses proves nothing. So the gauntlet asks the finder's question:
// does it still reach the line it was built for? f6ff55's author line (37
// STR: a disarm, a crossbow pierce timed between the disarm and the archer's
// death, the cataphract falling three blows later) is the one no other
// verifier in this repo executes, and the scheduled model exists because the
// kill-order model could not express it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { E, setup } = require('./helpers.js');
const B = require('../tools/solverengine/blowtable.js');
const M = require('../tools/solverengine/model.js');
const S = require('../tools/solverengine/solve.js');
const TH = require('../tools/solverengine/threat.js');
const { hasHighs, hasCpsat } = require('../tools/solverengine/lp.js');

// an elephant (bPush), a horseman (bRout), a swordsman; an archer the
// elephant cannot kill in one blow and a spearman beside it
const BOARD = `
  blue WAR_ELEPHANT 0,0
  blue HORSEMAN 0,1
  blue SWORDSMAN -1,1
  red ARCHER 2,0 hp=14
  red SPEARMAN 2,-1 hp=4
`;

test('blow table: every blow is what the engine deals from that seat', () => {
  const g = setup(BOARD, { orders: 8 });
  const T = B.blowTable(g.state);
  assert.ok(T.blows.length > 10);
  for (const b of T.blows) {
    const s = E.cloneState(g.state);
    const u = E.unitById(s, b.unit); const { q, r } = B.unkey(b.seat);
    u.q = q; u.r = r;
    const t = E.unitById(s, b.target);
    assert.equal(E.attackUnitDamage(s, u, { q, r }, t), b.dmg, `${b.unit}@${b.seat}->${b.target}`);
    assert.equal(E.counterAttackDamage(s, u, { q, r }, t), b.counter);
    assert.equal(b.adj, E.hexDistance({ q, r }, t) === 1);
  }
  // one blow per (unit, seat, target)
  const keys = new Set(T.blows.map(b => b.unit + '|' + b.seat + '|' + b.target));
  assert.equal(keys.size, T.blows.length);
});

test('blow table: a rout chain is a strike from the victim\'s tile, rout-capable units only', () => {
  const g = setup(BOARD, { orders: 8 });
  const T = B.blowTable(g.state);
  const horse = g.blue(1), archer = g.red(0), spear = g.red(1);
  assert.ok(B.canRout(horse) && !B.canRout(g.blue(2)));
  const c = T.chains.find(c => c.unit === horse.id && c.from === archer.id && c.target === spear.id);
  assert.ok(c, 'horseman: kill the archer, advance, strike the spearman');
  const s = E.cloneState(g.state);
  const h = E.unitById(s, horse.id); h.q = archer.q; h.r = archer.r; E.unitById(s, archer.id).hp = 0;
  assert.equal(c.dmg, E.attackUnitDamage(s, h, { q: archer.q, r: archer.r }, E.unitById(s, spear.id)));
  assert.ok(T.chains.every(c => c.unit === horse.id), 'only the horseman routs');
});

test('blow table: a push blow\'s escape tiles are where the engine actually shoves the target', () => {
  const g = setup(BOARD, { orders: 8 });
  const T = B.blowTable(g.state);
  const eleph = g.blue(0), archer = g.red(0);
  const pushes = T.blows.filter(b => b.unit === eleph.id && b.target === archer.id && b.push);
  assert.ok(pushes.length >= 3);
  for (const b of pushes) {
    if (b.seat === B.key(eleph.q, eleph.r) || b.req != null) continue;
    const { q, r } = B.unkey(b.seat);
    let s = E.applyAction(g.state, { type: 'move', unit: eleph.id, q, r });
    s = E.applyAction(s, { type: 'attack', unit: eleph.id, target: archer.id });
    const a = E.unitById(s, archer.id);
    assert.ok(a.hp > 0 && (a.q !== archer.q || a.r !== archer.r), 'the archer survives and is displaced');
    assert.ok(b.escape.includes(B.key(a.q, a.r)), `landed on ${a.q},${a.r}; table says ${b.escape}`);
  }
});

test('model: the binary master keeps only binaries, D_r and rk_r, and every row it keeps is closed over them', () => {
  const g = setup(BOARD, { orders: 8 });
  const T = B.blowTable(g.state);
  const m = M.buildModel(g.state, T, 8);
  const rel = S.binaryMaster(m);
  assert.ok(rel.vars.length < m.vars.length && rel.cons.length < m.cons.length);
  for (const v of rel.vars) assert.ok(v.binary || /^(D|rk)\d+$/.test(v.name), v.name);
  for (const c of rel.cons) {
    for (const t of c.terms) assert.ok(rel.byName.has(t[1]), c.name);
    for (const l of c.enf || []) assert.ok(rel.byName.has(l.replace('!', '')), c.name);
  }
  // the timing rows are the ones that went
  assert.ok(m.cons.some(c => c.name.startsWith('tb')) && !rel.cons.some(c => c.name.startsWith('tb')));
  // the cover row, the orders row and the rank rows stayed
  for (const p of ['cov', 'orders', 'rk']) assert.ok(rel.cons.some(c => c.name.startsWith(p)), p);
});

test('model: a kill set fixes y to 0 outside it and drops the blows that only serve those reds', () => {
  const g = setup(BOARD, { orders: 8 });
  const T = B.blowTable(g.state);
  const K = new Set([g.red(1).id]);
  const T2 = S.restrictTable(T, K, true);
  assert.ok(T2.blows.every(b => b.push || K.has(b.target) || b.coll.some(c => K.has(c.id))));
  assert.ok(T2.blows.length < T.blows.length);
  const m = M.buildModel(g.state, T2, 8, { kills: K });
  const y = m.byName.get('y' + g.red(0).id);
  assert.equal(y.ub, 0);
});

test('model: counterW charges each blow the counter it takes [Unit.cs:10614 — counters never kill, they weaken]', () => {
  const g = setup(BOARD, { orders: 8 });
  const T = B.blowTable(g.state);
  const b = T.blows.find(b => b.counter > 0);
  assert.ok(b, 'some melee blow takes a counter');
  const m0 = M.buildModel(g.state, T, 8);
  const m1 = M.buildModel(g.state, T, 8, { counterW: 0.5 });
  assert.equal(m1.byName.get('x' + b.id).obj, m0.byName.get('x' + b.id).obj - 0.5 * b.counter);
  const free = T.blows.find(b => b.counter === 0);
  assert.equal(m1.byName.get('x' + free.id).obj, m0.byName.get('x' + free.id).obj, 'a ranged blow pays nothing');
});

test('threat map: what each enemy could deal to our unit on a tile, from its best post with a fresh turn', () => {
  // a red archer (moves 2, iRangeMax 3 -> reaches five hexes on one order)
  // and a red spearman (moves 2, strikes at three); our horseman asks about a
  // tile in front of them and one beyond their reach. The enemy's pool is an
  // input: with more orders a unit walks again (reachableTiles spends them)
  const g = setup(`
    blue HORSEMAN -2,0
    red ARCHER 4,0
    red SPEARMAN 4,1
  `, { orders: 8, radius: 6 });
  const ho = g.blue(0), ar = g.red(0), sp = g.red(1);
  sp.cooldown = 'ATTACK';       // spent this turn; fresh again on its own
  const TM = TH.threatMap(g.state, { orders: 1 });
  const who = TM.who(ho.id, '2,0');
  assert.ok(who.find(w => w.id === ar.id), 'the archer reaches a tile two hexes off its walk');
  assert.ok(who.find(w => w.id === sp.id), 'the spearman too — its cooldown is gone on its own turn');
  // the archer's figure is the engine's damage from the post it likes best
  const s = E.cloneState(g.state); const a = E.unitById(s, ar.id), h = E.unitById(s, ho.id);
  h.q = 2; h.r = 0;
  let best = 0;
  for (const p of [{ q: 4, r: 0 }].concat(E.reachableTiles(s, a))) {
    a.q = p.q; a.r = p.r;
    if (E.hexDistance(p, h) > E.effectiveRange(s, a, p, h) || E.isShotObstructed(s, p, h)) continue;
    best = Math.max(best, E.attackUnitDamage(s, a, p, h));
  }
  assert.ok(best > 0);
  assert.equal(who.find(w => w.id === ar.id).dmg, best);
  assert.equal(TM.threat(ho.id, '-2,0'), 0, 'nobody reaches the horseman where it stands');
  assert.equal(TM.loss(ho.id, '-2,0'), 0);
  assert.ok(TM.loss(ho.id, '2,0') > 0 && TM.loss(ho.id, '2,0') <= TH.STR(ho), 'loss is at most the unit\'s worth');
});

test('model: exposeW charges a blow the loss of its seat relative to home; attacking from a safe home costs nothing', () => {
  // our horseman (moves 3) sits three hexes from a red spearman that can only
  // strike at three on one order; a seat next to the spearman is in its reach,
  // the horseman's home is not. Our archer shoots it from where it stands.
  const g = setup(`
    blue HORSEMAN -1,0
    blue ARCHER 0,0
    red SPEARMAN 3,0 hp=6
  `, { orders: 8, radius: 5 });
  const T = B.blowTable(g.state, { topSeats: 20 });   // keep the home seat too
  const m0 = M.buildModel(g.state, T, 8);
  const m1 = M.buildModel(g.state, T, 8, { exposeW: 1, enemyOrders: 1, exposeMode: 'threat' });
  assert.ok(T.threat, 'the map is memoised on the table');
  let charged = 0;
  for (const b of T.blows) {
    const u = E.unitById(g.state, b.unit);
    const o0 = m0.byName.get('x' + b.id).obj, o1 = m1.byName.get('x' + b.id).obj;
    const want = o0 - (T.threat.loss(b.unit, b.seat) - T.threat.loss(b.unit, u.q + ',' + u.r));
    assert.ok(Math.abs(o1 - want) < 1e-9, `${b.unit}@${b.seat}`);
    if (o1 < o0 - 1e-9) charged++;
    assert.ok(o1 <= o0 + 1e-9, 'home is out of reach here, so no seat can be safer than it');
  }
  assert.ok(charged > 0, 'a seat next to the spearman is in its reach');
  const ourArcher = g.blue(1);
  const home = T.blows.find(b => b.unit === ourArcher.id && b.seat === '0,0');
  assert.ok(home, 'our archer can shoot the spearman from where it stands');
  assert.equal(m1.byName.get('x' + home.id).obj, m0.byName.get('x' + home.id).obj);
});

// ---- the gauntlet: real solves, real backends
const ILP = !!process.env.OWP_ILP;
const F6 = path.join(__dirname, 'fixtures', 'with-a-little-help-f6ff55.json');

test('gauntlet: both backends are present (a missing backend must fail, not skip)', { skip: !ILP }, () => {
  assert.ok(hasHighs(), 'npm install in tools/solverengine');
  assert.ok(hasCpsat(), 'a python with ortools: $CPSAT_PY, tools/solverengine/.venv, or python3');
});

test('gauntlet: HiGHS finds the twin-swords ceiling', { skip: !ILP }, async () => {
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'twin-swords.json'), 'utf8'));
  const s0 = E.loadPuzzle(P);
  const r = await S.solvePosition(s0, { seconds: 10, quiet: true, branch: false });
  assert.equal(r.str, P.objective.count);
  let s = s0; for (const a of r.line) s = E.applyAction(s, a);
  assert.equal(E.strKilledOf(s), r.str, 'the line replays to its claim');
});

test('gauntlet: CP-SAT reaches f6ff55\'s 37-STR author line', { skip: !ILP, timeout: 600000 }, async () => {
  const P = JSON.parse(fs.readFileSync(F6, 'utf8'));
  const s0 = E.loadPuzzle({ ...P, orders: 45 });
  process.env.SOLVER = 'cpsat';
  const r = await S.solvePosition(s0, { seconds: 30, quiet: true, branchK: 6 });
  assert.ok(r.str >= 370, `found ${r.str / 10} STR, the author's line is 37`);
  let s = s0; for (const a of r.line) s = E.applyAction(s, a);
  assert.equal(E.strKilledOf(s), r.str, 'the line replays to its claim');
});

// several order pools at once (a team turn: each player spends their own).
// The state carries `pools` ({key: orders}) and each acting unit a `pool`
// key; the model keeps every pool within budget on top of the total, and
// chargePools charges a played line back pool by pool.
test('order pools: a unit whose pool is empty never acts; the line charges each pool by its own spend', async () => {
  const g = setup(`
    blue SWORDSMAN 1,0
    blue SWORDSMAN 0,1
    red ARCHER 2,0 hp=6
    red ARCHER 1,1 hp=6
  `, { orders: 4 });
  const st = g.state;
  st.pools = { a: 2, b: 0 };
  st.units[0].pool = 'a'; st.units[1].pool = 'b';
  const T = B.blowTable(st);
  const m = M.buildModel(st, T, st.orders, {});
  const rows = m.cons.filter(c => /^orders_/.test(c.name)).map(c => c.name).sort();
  assert.deepEqual(rows, ['orders_a', 'orders_b']);
  const ub = m.cons.find(c => c.name === 'orders_b');
  assert.ok(ub.terms.every(([, v]) => T.blows.some(b => 'x' + b.id === v && b.unit === 1)), 'pool b only holds unit 1\'s blows');
  assert.equal(ub.rhs, 0);
  if (!hasHighs()) return;
  const r = await S.solvePosition(st, { quiet: true, branch: false, seconds: 5 });
  assert.ok(r.line.every(a => a.unit === 0), 'only the funded unit moves: ' + JSON.stringify(r.line));
  const left = S.chargePools(st, r.line);
  assert.equal(left.b, 0);
  assert.equal(left.a, 2 - r.orders);
  assert.ok(left.a >= 0);
});

test('model: bounty(red) adds to a kill\'s objective on top of its strength', () => {
  const g = setup(`
    blue SWORDSMAN 1,0
    red ARCHER 2,0 hp=6
    red SPEARMAN 2,-1 hp=6
  `, { orders: 4 });
  const T = B.blowTable(g.state);
  const m = M.buildModel(g.state, T, 4, { bounty: r => r.type === 'UNIT_ARCHER' ? 70 : 0 });
  const y = id => m.vars.find(v => v.name === 'y' + id);
  const archer = g.state.units.find(u => u.type === 'UNIT_ARCHER'), spear = g.state.units.find(u => u.type === 'UNIT_SPEARMAN');
  assert.equal(y(archer.id).obj, B.STR(archer) + 70);
  assert.equal(y(spear.id).obj, B.STR(spear));
});


// the order-limited reply estimate (threat.js replyEstimate): the enemy
// cashes the cheapest kills first and stops when its money runs out
test('reply estimate: kill cost is the fewest orders that kill; the greedy reply stops at the pool; a seat out of reach is free', () => {
  const g = setup(`
    blue SWORDSMAN 0,0 hp=6
    blue SWORDSMAN 0,2 hp=6
    red SWORDSMAN 1,0
    red SWORDSMAN 1,2
    red ARCHER 8,0
  `, { orders: 4 });
  const st = g.state;
  const est = TH.replyEstimate(st, { orders: 2 });
  const [a, b] = st.units.filter(u => u.player === 0);
  // a red swordsman beside each of ours kills it for one order (no walk)
  assert.equal(est.killCost(a.id, a.q + ',' + a.r, a.hp), 1);
  const far = TH.replyEstimate(st, { orders: 2 }).killCost(a.id, '-9,0', a.hp);
  assert.equal(far, null, 'nobody reaches (-9,0)');
  assert.equal(est.price(a.id, '-9,0', a.hp), 0);
  const e = est.estimate(st);
  assert.equal(e.kills.length, 2);
  assert.equal(e.str, 2 * TH.STR(a));
  assert.equal(e.spent, 2);
  const poor = TH.replyEstimate(st, { orders: 1 }).estimate(st);
  assert.equal(poor.kills.length, 1, 'one order buys one kill');
  assert.ok(poor.lambda != null, 'the budget bound: a margin exists');
  // per-pool money: the two swordsmen in separate pools of one order each
  st.units.filter(u => u.player === 1).forEach((u, i) => { u.pool = 'p' + i; });
  const split = TH.replyEstimate(st, { enemyPools: { p0: 1, p1: 1, p2: 0 } }).estimate(st);
  assert.equal(split.kills.length, 2);
});

test('retreat pass: an idle unit walks to a seat the estimate prices lower, within its pool; a unit that acted stays', () => {
  const g = setup(`
    blue SWORDSMAN 0,0 hp=6
    blue SWORDSMAN 0,2 hp=6
    red SWORDSMAN 1,0
    red SWORDSMAN 1,2 hp=3
  `, { orders: 6 });
  const st = g.state;
  const [a, b] = st.units.filter(u => u.player === 0);
  const est = TH.replyEstimate(st, { orders: 1 });
  const s1 = E.applyAction(st, { type: 'attack', unit: b.id, target: st.units.find(u => u.player === 1 && u.hp === 3).id });
  const rp = S.retreatPass(s1, est, {});
  assert.ok(rp.line.every(x => x.unit === a.id), 'only the idle unit moves: ' + JSON.stringify(rp.line));
  assert.equal(rp.line.length, 1);
  const a2 = E.unitById(rp.state, a.id);
  assert.ok(est.price(a.id, a2.q + ',' + a2.r, a2.hp) < est.price(a.id, a.q + ',' + a.r, a.hp));
  // with no money in its pool it stays
  const s2 = { ...s1, pools: { p: 0 } }; s2.units = s1.units.map(u => ({ ...u, pool: 'p' }));
  assert.equal(S.retreatPass(s2, est, {}).line.length, 0);
});

test('reply estimate: a routing unit strikes again after a kill (bRout, three strikes), a march extends the posts at its price', () => {
  const g = setup(`
    blue SWORDSMAN 0,0 hp=4
    blue SWORDSMAN 1,0 hp=4
    blue SWORDSMAN 2,0 hp=4
    red HORSEMAN 0,1
    red ARCHER 0,-3 hp=20
  `, { orders: 4 });
  const st = g.state;
  const est = TH.replyEstimate(st, { orders: 20 });
  const a = st.units.find(u => u.player === 0);
  const horse = est.options(a.id, a.q + ',' + a.r).find(o => E.unitById(st, o.id).type === 'UNIT_HORSEMAN');
  assert.ok(horse && horse.again && horse.lives === 2, 'the horseman carries two extra strikes');
  const e = est.estimate(st);
  const byHorse = e.kills.flatMap(k => k.blows).filter(b => E.unitById(st, b.id).type === 'UNIT_HORSEMAN').length;
  assert.ok(byHorse >= 2, 'the horseman is used more than once: ' + byHorse);
  // a post only a force march reaches costs the doubled orders
  const farArcher = st.units.find(u => u.type === 'UNIT_ARCHER');
  const opts = TH.replyEstimate(st, { orders: 20 }).options(a.id, '3,0').find(o => o.id === farArcher.id);
  assert.ok(opts, 'the archer reaches a shot at (3,0) with a march');
});

// The killList question, asked through the hook the core already exposes.
// tools/ilp_fight.js --targets a,b cancels every other red's strength with a
// negative bounty, so "all targets dead" is the objective and the core stays
// ignorant of what it is solving. Needed because a scout-herding submission
// arrived that no verifier could reason about (2026-09-03).
test('a negative bounty cancels a red from the objective [model.js addVar obj = STR + bounty]', () => {
  const g = setup(`
    blue HORSEMAN -1,0
    blue ARCHER 0,0
    red SPEARMAN 3,0 hp=6
    red ARCHER 3,1 hp=6
  `);
  const T = B.blowTable(g.state, { topSeats: 20 });
  const wanted = g.state.units.find((u) => u.player === 1 && u.type === 'UNIT_SPEARMAN');
  const other = g.state.units.find((u) => u.player === 1 && u.type === 'UNIT_ARCHER');
  const m = M.buildModel(g.state, T, 8, {
    bounty: (r) => (r.id === wanted.id ? 0 : -(E.DATA.units[r.type].iStrength || 0)),
  });
  assert.equal(m.byName.get('y' + wanted.id).obj, E.DATA.units[wanted.type].iStrength,
    'the target keeps its full worth');
  assert.equal(m.byName.get('y' + other.id).obj, 0, 'every other red is worth nothing');
});
