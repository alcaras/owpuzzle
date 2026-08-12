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
