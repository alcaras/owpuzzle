// A teaching puzzle makes one promise: you cannot do this without the
// promotion. That promise is checkable, so it should never be left to trust.
//
// The motivating case is not hypothetical. Bottleneck's horseman carried
// AMPHIBIOUS, HECKLER and RANGER; strip all three and the winning line still
// destroys the same 290 strength with the same five kills. Decorative there,
// harmless. On a puzzle whose lesson text says "this is why you needed the
// promotion", the same situation is a lie told to every player who reads it.
//
// So for each board below: remove the taught promotion and assert the
// objective becomes UNREACHABLE at the order pool the player ACTUALLY GETS —
// poolOrders, par+5 rounded up, so ten on a par-2 board. Checking at par is not
// good enough and this is not theoretical: two of these nine boards passed at
// par and failed at the pool, one because the spare orders bought a rout chain,
// one because they bought a walk around the water. Boards where the promotion belongs to
// the enemy — it is the obstacle, not the tool — neutralise the idea instead,
// and the assertion is the same either way.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const SOLVER = require(path.join(__dirname, '..', 'web', 'solver.js'));
const PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));

// id -> what makes the lesson true, and how to take it away
const LESSONS = {
  'stand-in-the-woods': { strip: 'EFFECTUNIT_RANGER' },
  'the-second-blow': { strip: 'EFFECTUNIT_BLOODTHIRSTY' },
  'the-right-sword': { strip: 'EFFECTUNIT_HORSEBANE' },
  'wounded-and-meaner': { strip: 'EFFECTUNIT_TOUGH' },
  // Seven blue units is far past what an exhaustive search can close, so this
  // one is proved by DAMAGE ACCOUNTING instead: sum each unit's best possible
  // blow (the chariot's three, since two kills rout it onward) and compare
  // against the reds' total hit points. Exact, instant, and indifferent to how
  // big the army is. See `byBudget` below.
  'two-points-short': { strip: 'EFFECTUNIT_HECKLER', byBudget: true },
  'evict-him': {
    // PANIC is intrinsic to elephants and it is the TOOL here. Swap the
    // elephant for a maceman, which cannot shove: that isolates the push.
    label: 'elephant swapped for a maceman (no shove)',
    neutralise: (p) => {
      p.units.forEach((u) => { if (u.type === 'UNIT_WAR_ELEPHANT') u.type = 'UNIT_MACEMAN'; });
      return p;
    },
  },
  // Still in drafts/promo/: the-crown (rebuilt around a warrior and a
  // chariot, awaiting play). the-far-bank, dont-step-closer and
  // one-hex-further are parked — see the note at the bottom of this file.
};

function solve(puzzle, ms) {
  return SOLVER.solve(puzzle, { maxStates: 400000, maxMs: ms || 8000 });
}
function solved(res) { return !!(res.best && res.best.met); }
function clone(p) { return JSON.parse(JSON.stringify(p)); }

test('every taught promotion is on a puzzle that still exists', () => {
  const missing = Object.keys(LESSONS).filter((id) => !PUZZLES.some((p) => p.id === id));
  assert.deepEqual(missing, [], `teaching puzzles named here but not in the library: ${missing.join(', ')}`);
});

// Most damage a blue unit could possibly deal to any red, from any tile it can
// reach. The chariot gets three swings because each kill routs it onward; every
// other unit swings once (attacking sets a cooldown nothing clears).
function bestBlow(state, u) {
  let mx = 0;
  const spots = [{ q: u.q, r: u.r }].concat(E.reachableTiles(state, u));
  for (const t of spots) {
    const save = { q: u.q, r: u.r };
    u.q = t.q; u.r = t.r;
    for (const red of state.units.filter((x) => x.player === 1 && x.hp > 0)) {
      if (E.attackTargets(state, u).some((z) => z.id === red.id)) {
        mx = Math.max(mx, E.attackUnitDamage(state, u, { q: u.q, r: u.r }, red));
      }
    }
    u.q = save.q; u.r = save.r;
  }
  return mx;
}
function deliverable(puzzle) {
  const s = E.loadPuzzle(puzzle, { play: true });
  return s.units.filter((u) => u.player === 0)
    .reduce((sum, u) => sum + bestBlow(s, u) * (u.type === 'UNIT_CHARIOT' ? 3 : 1), 0);
}
function redHitPoints(puzzle) {
  return E.loadPuzzle(puzzle, { play: true })
    .units.filter((u) => u.player === 1).reduce((a, u) => a + u.hp, 0);
}

for (const [id, spec] of Object.entries(LESSONS)) {
  const puzzle = PUZZLES.find((p) => p.id === id);
  if (!puzzle) continue;

  if (spec.byBudget) {
    test(`${id}: the army can only just do it, and only with ${spec.strip.replace('EFFECTUNIT_', '')}`, () => {
      const need = redHitPoints(puzzle);
      const withIt = deliverable(puzzle);
      const stripped = clone(puzzle);
      stripped.units.forEach((u) => {
        if (u.promotions) u.promotions = u.promotions.filter((x) => x !== spec.strip);
      });
      const without = deliverable(stripped);
      assert.ok(withIt >= need,
        `UNSOLVABLE: the army can deliver ${withIt} against ${need} hit points`);
      assert.ok(without < need,
        `THE LESSON IS A LIE: without ${spec.strip} the army still delivers ${without} against ${need}`);
    });
    continue;
  }

  test(`${id}: solvable at its par of ${puzzle.orders}`, () => {
    const res = solve(puzzle);
    assert.ok(solved(res), `no line reaches the objective in ${puzzle.orders} orders`);
  });

  test(`${id}: par is tight — unsolvable in ${puzzle.orders - 1}`, () => {
    const tighter = clone(puzzle);
    tighter.orders = puzzle.orders - 1;
    const res = solve(tighter);
    assert.ok(!solved(res),
      `PAR OVERSTATED: also solvable in ${tighter.orders} orders, so the budget is not the gate`);
  });

  test(`${id}: the lesson is true at the play pool — ${spec.strip ? spec.strip.replace('EFFECTUNIT_', '') + ' is required' : spec.label}`, () => {
    let probe = clone(puzzle);
    probe.orders = E.poolOrders(puzzle);   // what the player really gets
    if (spec.strip) {
      let hits = 0;
      probe.units.forEach((u) => {
        if (u.promotions && u.promotions.includes(spec.strip)) {
          u.promotions = u.promotions.filter((x) => x !== spec.strip);
          hits++;
        }
      });
      assert.ok(hits > 0, `${spec.strip} is not on any unit — the puzzle no longer teaches it`);
    } else {
      probe = spec.neutralise(probe);
    }
    const res = solve(probe, 30000);
    assert.ok(!solved(res),
      `THE LESSON IS A LIE: still solvable in ${probe.orders} orders without the idea the puzzle teaches`);
  });
}

test('the teaching set does not depend on an inert promotion', () => {
  // iCriticalChance is deliberately unimplemented (randomness has no place in a
  // puzzle), which makes FOCUS1/2/3 do precisely nothing. A board built on one
  // would pass every check above by accident and teach nothing at all.
  const inert = ['EFFECTUNIT_FOCUS1', 'EFFECTUNIT_FOCUS2', 'EFFECTUNIT_FOCUS3'];
  for (const id of Object.keys(LESSONS)) {
    const p = PUZZLES.find((x) => x.id === id);
    if (!p) continue;
    for (const u of p.units) {
      for (const pr of u.promotions || []) {
        assert.ok(!inert.includes(pr), `${id} carries ${pr}, which the engine implements as nothing`);
      }
    }
  }
});

test('every teaching board loads and its promotions are real effects', () => {
  for (const id of Object.keys(LESSONS)) {
    const p = PUZZLES.find((x) => x.id === id);
    if (!p) continue;
    E.loadPuzzle(p);
    for (const u of p.units) {
      for (const pr of u.promotions || []) {
        assert.ok(E.DATA.effects[pr], `${id}: ${pr} is not an effect in the data`);
      }
    }
  }
});

// PARKED, and why — so nobody rebuilds them expecting a different answer:
//   the-far-bank (AMPHIBIOUS): crossing the river is the only route, so there
//     is no decision to make, only an obligation to carry out.
//   dont-step-closer (EAGLE_EYE) and one-hex-further (MARKSMAN): both promotions
//     are about distance, and with a par+5 order pool a plain archer can simply
//     WALK into range and take the same shot. Making them required needs a
//     barrier the player cannot cross; without one the lesson text is false.
//     Measured, not assumed: both boards passed at par and failed at the pool.
