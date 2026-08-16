// Guards for the two bugs that stopped an author submitting a maxKill puzzle.
// Both live in browser code, so these are source-order checks rather than
// behavioural ones — crude, but they fail loudly if the shape regresses.
// The behavioural version is test/e2e/draft-flow.py (needs a running server).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
const EDITOR = fs.readFileSync(path.join(__dirname, '..', 'web', 'editor.js'), 'utf8');

test("a draft's line is recorded before anything can return early", () => {
  // The maxKill branch returns early for a draft (no ceiling to judge yet).
  // Everything after that return is skipped, so the recording must come first
  // or the author plays a turn that is never saved.
  const record = APP.indexOf("'owpuzzle-draft-solution'");
  const earlyReturn = APP.indexOf('this draft cannot score itself');
  assert.ok(record > 0 && earlyReturn > 0, 'both landmarks should exist');
  assert.ok(record < earlyReturn,
    'the draft recording must be written before the maxKill early return');
});

test('every puzzle field persists what the author types', () => {
  // Fields that only live in the DOM are lost on the way back from a test
  // play, and the submitted board then differs from the one played.
  for (const id of ['p-name', 'p-brief', 'p-lesson', 'p-orders', 'p-training', 'p-objective']) {
    assert.ok(EDITOR.includes(`'${id}'`), `${id} is never referenced in the editor`);
  }
  const wiring = /\['p-name'[^\]]*'p-objective'\]\s*\.forEach/.test(EDITOR);
  assert.ok(wiring, 'the puzzle fields should be wired to render() so they autosave');
});

// A maxKill draft carries no objective.count — the reviewer sets it after
// approval (server/index.js:477-490). Reading that missing ceiling as an
// impossible one told every maxKill author their own correct line had failed.
test('a maxKill draft has no ceiling to meet, so nothing reports it as failure', () => {
  const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
  assert.equal(E.objectiveScorable({ kind: 'maxKill' }), false,
    'a ceiling-less maxKill cannot be scored');
  assert.equal(E.objectiveScorable({ kind: 'maxKill', count: 290 }), true,
    'once review sets the ceiling it can be scored');
  assert.equal(E.objectiveScorable({ kind: 'killAll' }), true,
    'other objectives are always scorable');

  // The old sentinel: `strKilledOf(state) >= (objective.count || 999999)`.
  // Nothing may reintroduce a target the board cannot possibly contain.
  const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'web', 'engine.js'), 'utf8');
  assert.ok(!ENGINE.includes('999999'),
    'no impossible-sentinel ceiling: ask objectiveScorable() instead');

  // The submit warning must be gated on the objective, so that recordings
  // stored before the fix (met:false) do not warn either.
  assert.ok(/sol\.met === false && E\.objectiveScorable\(/.test(EDITOR),
    'the editor should not warn about missing an objective that does not exist yet');
});
