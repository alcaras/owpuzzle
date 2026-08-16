// Does the known answer still work?
//
// test/ceilings.test.js asks the expensive question — "can anyone now beat the
// published maximum?" — by re-running a search per puzzle, ~8 minutes for the
// set. This asks the cheap half of it: replay the line we know reaches the
// ceiling and check it still does. Milliseconds, so it runs on every push.
//
// It catches the direction that actually bites: an engine change that makes a
// published answer UNREACHABLE, leaving a puzzle whose star nobody can ever
// earn. iRangeMin is the live example — implementing it (Unit.cs:8493) took
// away point-blank onager shots that had been legal here for a year, so any
// ceiling resting on one would have quietly become impossible.
//
// What it does NOT catch is the other direction: a rules change that makes
// something BETTER possible, so players can beat "MAXIMUM DESTRUCTION". Only a
// real search finds that, which is what npm run test:ceilings is for.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));

const FIXTURE = path.join(__dirname, 'fixtures', 'reference-lines.json');
const REF = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : {};

// Boards with no stored line yet, and why. A new maxKill puzzle that lands
// without one fails the check below rather than silently skipping — the same
// discipline as coverage.test.js, so a gap has to be a decision.
const NO_LINE_YET = {
  'the-two-fords': 'solver cannot reach par within 45 min; needs a line from deploy_fight',
  'the-man-beside-him': 'solver cannot reach par within 45 min; needs a line from deploy_fight',
  'the-ground-he-wins': 'solver cannot reach par within 45 min; needs a line from deploy_fight',
};

const maxKill = PUZZLES.filter((p) => p.objective.kind === 'maxKill');

test('every maxKill puzzle has a reference line, or a stated reason', () => {
  const missing = maxKill.filter((p) => !REF[p.id]).map((p) => p.id);
  const unexplained = missing.filter((id) => !NO_LINE_YET[id]);
  assert.deepEqual(unexplained, [],
    `these puzzles have no reference line and no reason: ${unexplained.join(', ')}`);
  const stale = Object.keys(NO_LINE_YET).filter((id) => REF[id]);
  assert.deepEqual(stale, [],
    `these have a line now — drop them from NO_LINE_YET: ${stale.join(', ')}`);
});

for (const p of maxKill) {
  const ref = REF[p.id];
  if (!ref) continue;
  test(`${p.id}: the known line still reaches ${p.objective.count / 10} STR`, () => {
    // strict load, exactly as the line was recorded: par orders, author training
    let s = E.loadPuzzle(p);
    for (let i = 0; i < ref.line.length; i++) {
      const a = ref.line[i];
      const legal = E.legalActions(s).some((l) => l.type === a.type && l.unit === a.unit &&
        (a.type === 'attack' ? l.target === a.target
          : a.type === 'move' ? (l.q === a.q && l.r === a.r) : true));
      assert.ok(legal,
        `step ${i + 1} (${a.type} by unit ${a.unit}) is no longer legal — the engine moved under this line`);
      s = E.applyAction(s, a);
    }
    const got = E.strKilledOf(s);
    assert.equal(got, ref.strength, 'the line no longer destroys what it used to');
    assert.ok(got >= p.objective.count,
      `UNREACHABLE: the known line now reaches ${got / 10} STR against a published ceiling of ${p.objective.count / 10} — nobody can earn this puzzle's star`);
  });
}
