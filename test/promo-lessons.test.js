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
  'evict-him': {
    // PANIC is intrinsic to elephants and it is the TOOL here. Swap the
    // elephant for a maceman, which cannot shove: that isolates the push.
    label: 'elephant swapped for a maceman (no shove)',
    neutralise: (p) => {
      p.units.forEach((u) => { if (u.type === 'UNIT_WAR_ELEPHANT') u.type = 'UNIT_MACEMAN'; });
      return p;
    },
  },
  // Still in drafts/promo/, still being played: the-crown, wounded-and-meaner,
  // the-far-bank, dont-step-closer, one-hex-further.
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

for (const [id, spec] of Object.entries(LESSONS)) {
  const puzzle = PUZZLES.find((p) => p.id === id);
  if (!puzzle) continue;

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
