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
  const m1 = M.buildModel(g.state, T, 8, { exposeW: 1, enemyOrders: 1 });
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
