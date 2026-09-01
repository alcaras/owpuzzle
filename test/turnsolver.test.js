// The ILP turn planner (tools/turnsolver/): structural checks that run on
// every push, and the solver gauntlet behind OWP_ILP=1 (`npm run test:ilp`),
// which needs the HiGHS package installed under tools/turnsolver and a python
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
const B = require('../tools/turnsolver/blowtable.js');
const M = require('../tools/turnsolver/model.js');
const S = require('../tools/turnsolver/solve.js');
const { hasHighs, hasCpsat } = require('../tools/turnsolver/lp.js');

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

// ---- the gauntlet: real solves, real backends
const ILP = !!process.env.OWP_ILP;
const F6 = path.join(__dirname, 'fixtures', 'with-a-little-help-f6ff55.json');

test('gauntlet: both backends are present (a missing backend must fail, not skip)', { skip: !ILP }, () => {
  assert.ok(hasHighs(), 'npm install in tools/turnsolver');
  assert.ok(hasCpsat(), 'a python with ortools: $CPSAT_PY, tools/turnsolver/.venv, or python3');
});

test('gauntlet: HiGHS finds the twin-swords ceiling', { skip: !ILP }, async () => {
  const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'twin-swords.json'), 'utf8'));
  const s0 = E.loadPuzzle(P);
  const r = await S.planTurn(s0, { seconds: 10, quiet: true, branch: false });
  assert.equal(r.str, P.objective.count);
  let s = s0; for (const a of r.line) s = E.applyAction(s, a);
  assert.equal(E.strKilledOf(s), r.str, 'the line replays to its claim');
});

test('gauntlet: CP-SAT reaches f6ff55\'s 37-STR author line', { skip: !ILP, timeout: 600000 }, async () => {
  const P = JSON.parse(fs.readFileSync(F6, 'utf8'));
  const s0 = E.loadPuzzle({ ...P, orders: 45 });
  process.env.SOLVER = 'cpsat';
  const r = await S.planTurn(s0, { seconds: 30, quiet: true, branchK: 6 });
  assert.ok(r.str >= 370, `found ${r.str / 10} STR, the author's line is 37`);
  let s = s0; for (const a of r.line) s = E.applyAction(s, a);
  assert.equal(E.strKilledOf(s), r.str, 'the line replays to its claim');
});
