// verify2's own invariants, kept cheap enough for the fast suite.
//
// The whole verifier stands on one claim: OPT[b][tile][r] never understates a
// real blow. So brute-force a small board: every seat, every target, every
// engine-legal attack — the engine's damage must not exceed the table's.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../web/engine.js');
const V = require('../tools/verify2.js');

const MINI = {
  name: 'verify2-mini', orders: 8, radius: 2,
  objective: { kind: 'maxKill' },
  units: [
    { player: 0, type: 'UNIT_HORSEMAN', q: -2, r: 0 },
    { player: 0, type: 'UNIT_ARCHER', q: -2, r: 1 },
    { player: 1, type: 'UNIT_SWORDSMAN', q: 1, r: 0, hp: 9 },
    { player: 1, type: 'UNIT_ARCHER', q: 2, r: -1, hp: 12 },
    { player: 1, type: 'UNIT_SPEARMAN', q: 1, r: 1, hp: 10 },
  ],
};

test('OPT table dominates every engine-legal blow (brute force)', () => {
  const POOL = 10;
  const ctx = V.build(MINI, POOL);
  let checked = 0;
  for (const b of ctx.BLUE) {
    const o = ctx.OPT[b.id];
    for (const k of Object.keys(o.tiles)) {
      const [q, r] = k.split(',').map(Number);
      // teleport b to the tile on a fresh state and ask the engine
      const s = E.loadPuzzle({ ...MINI, orders: POOL });
      const u = E.unitById(s, b.id);
      const occupied = s.units.some(x => x.id !== b.id && x.q === q && x.r === r && x.hp > 0);
      if (occupied) continue;
      u.q = q; u.r = r;
      for (const t of E.attackTargets(s, u)) {
        const ri = ctx.ridx[t.id];
        const dmg = E.attackUnitDamage(s, u, { q, r }, t);
        assert.ok(dmg <= o.tiles[k][ri],
          `${b.type} at ${k} deals ${dmg} to red ${t.id}, OPT says ${o.tiles[k][ri]}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 20, `only ${checked} attacks checked — board too small to mean anything`);
});

test('kill-set infeasibility is monotone upward', () => {
  const ctx = V.build(MINI, 10);
  const rows = V.fullRows(ctx, 'walk');
  const masks = V.sortedMasks(ctx);
  for (const m of masks) {
    if (V.feasibleMask(ctx, m.mask, 10, rows, 100000)) continue;
    // every superset of an infeasible mask must be infeasible
    for (const sup of masks) {
      if ((sup.mask & m.mask) === m.mask && sup.mask !== m.mask) {
        assert.equal(V.feasibleMask(ctx, sup.mask, 10, rows, 100000), false,
          `superset ${sup.mask} of infeasible ${m.mask} reported feasible`);
      }
    }
  }
});

test('upper bound is admissible: engine play never beats U', () => {
  // exhaustive play via legalActions (the compute_ceilings method), compared
  // against stage 1's U. A single-blue board keeps the fast suite fast;
  // test:ceilings covers the real boards.
  const TINY = {
    name: 'verify2-tiny', orders: 5, radius: 2, training: 0,
    objective: { kind: 'maxKill' },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: -2, r: 0 },
      { player: 1, type: 'UNIT_SWORDSMAN', q: 1, r: 0, hp: 7 },
      { player: 1, type: 'UNIT_ARCHER', q: 2, r: -1, hp: 8 },
    ],
  };
  const POOL = 5;
  const ctx = V.build(TINY, POOL);
  const masks = V.sortedMasks(ctx);
  const U = V.upperBound(ctx, masks, V.fullRows(ctx, 'walk'), POOL, []).U;

  let best = 0;
  const seen = new Set();
  (function rec(s) {
    best = Math.max(best, E.strKilledOf(s));
    for (const a of E.legalActions(s)) {
      let ns;
      try { ns = E.applyAction(s, a); } catch (e) { continue; }
      const h = ns.orders + '|' + ns.units.map(x =>
        `${x.q},${x.r},${Math.max(0, x.hp)},${x.cooldown || 0},${x.steps}`).join(';');
      if (seen.has(h)) continue;
      seen.add(h);
      rec(ns);
    }
  })(E.loadPuzzle({ ...TINY, orders: POOL }));

  assert.ok(best > 0, 'exhaustive play killed nothing — the check is vacuous');
  assert.ok(best <= U, `exhaustive play reached ${best}, above the "upper bound" ${U}`);
});

test('getAttackDamage replica matches the engine on a real attack', () => {
  const s = E.loadPuzzle({ ...MINI, orders: 8 });
  const att = E.unitById(s, 0);
  att.q = 0; att.r = 0;                    // adjacent to the swordsman
  const def = E.unitById(s, 2);
  const aStr = E.attackStrength(s, att, { q: 0, r: 0 }, { q: def.q, r: def.r }, def);
  const dStr = E.defendStrength(s, def, { q: def.q, r: def.r }, att);
  const viaReplica = Math.min(V.gAD(aStr, dStr, 100), def.hp);
  const viaEngine = E.attackUnitDamage(s, att, { q: 0, r: 0 }, def);
  assert.equal(viaReplica, viaEngine);
});
