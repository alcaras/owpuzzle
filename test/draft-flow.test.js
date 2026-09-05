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
  const FIELDS = ['p-name', 'p-brief', 'p-lesson', 'p-orders', 'p-training',
    'p-objective', 'p-pool-mode', 'p-pool'];
  for (const id of FIELDS) {
    assert.ok(EDITOR.includes(`'${id}'`), `${id} is never referenced in the editor`);
  }
  // the render() wiring list itself, so a field added to the panel and not to
  // the list fails here rather than silently reverting on the author
  const list = EDITOR.match(/\['p-name'[\s\S]{0,300}?\]\s*\.forEach/);
  assert.ok(list, 'the puzzle fields should be wired to render() so they autosave');
  for (const id of FIELDS) {
    assert.ok(list[0].includes(`'${id}'`), `${id} is not wired to render()`);
  }
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

// The editor used to be write-only: clicking a placed unit DELETED it, so
// giving somebody a promotion or a general's flag meant deleting them and
// stamping a replacement with the panel set differently. Clicking now selects,
// and the panel edits the selection in place.
//
// The subtle half is that PLACING must NOT select. The panel doubles as the
// brush for the next unit, so if a freshly stamped unit stayed selected, the
// very next "switch to Red, pick an archer" would rewrite the unit you just
// put down instead of configuring the next one. The e2e caught exactly that:
// its blue swordsman turned into a red archer and the board lost its only
// friendly unit. Behavioural coverage lives in test/e2e/draft-flow.py; these
// are source-shape guards for browser code.
test('a placed unit can be selected and edited, and placing does not select', () => {
  assert.ok(/function selectUnit\(/.test(EDITOR), 'the editor should have a unit selection');
  assert.ok(/function applyPanelToSelected\(/.test(EDITOR),
    'panel changes should write back to the selected unit');
  assert.ok(/selectUnit\(idx === selectedUnit \? -1 : idx\)/.test(EDITOR),
    'clicking a placed unit should select it, not delete it');
  assert.ok(/selectUnit\(-1\);\n        return;/.test(EDITOR),
    'placing a unit must leave nothing selected, or the panel stops being a brush');
  // deletion has to remain possible, just deliberate
  assert.ok(/btn-unit-delete/.test(EDITOR), 'there should be an explicit delete control');
});

test('editing a unit in place honours the leader-implies-general rule', () => {
  // Same rule as the placement path (Unit.cs:2274): a _LEADER promotion only
  // exists because a general is attached, so picking one makes the unit a
  // general. king-of-the-hill shipped without this and its Hecklers did
  // nothing — the edit path must not reintroduce that.
  const apply = EDITOR.slice(EDITOR.indexOf('function applyPanelToSelected'));
  const body = apply.slice(0, apply.indexOf('\n  }'));
  assert.ok(/_LEADER\$/.test(body),
    'applyPanelToSelected should mark leader-carrying units as generals');
});

// The author's LAST test play is not their BEST one. Polishing a board means
// playing it repeatedly, and a later run is often worse — the author is
// exploring, not converging. The server used to keep whichever recording
// arrived most recently, so on 2026-09-04 a 22-order reference line was
// submitted for a board its author had already solved in 19, and the review
// queue showed the 22. `betterRecording` is the one comparator both sides use.
test('betterRecording keeps the best line for a board, not the latest', () => {
  const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
  const rec = (o) => Object.assign(
    { line: [{ type: 'move' }], puzzle: { objective: { kind: 'killList' } } }, o);

  const nineteen = rec({ orders: 19, strength: 180, met: true });
  const twentytwo = rec({ orders: 22, strength: 180, met: true });
  assert.equal(E.betterRecording(twentytwo, nineteen).orders, 19, 'newer-but-worse must not win');
  assert.equal(E.betterRecording(nineteen, twentytwo).orders, 19, 'and order of arguments cannot matter');

  // meeting the objective outranks a cheap line that does not
  const unmet = rec({ orders: 5, met: false });
  const met = rec({ orders: 40, met: true });
  assert.equal(E.betterRecording(unmet, met).met, true);

  // maxKill scores by strength — that IS its objective — then by orders
  const mk = (o) => Object.assign(
    { line: [{ type: 'move' }], puzzle: { objective: { kind: 'maxKill' } } }, o);
  assert.equal(E.betterRecording(mk({ orders: 20, strength: 270 }),
                                 mk({ orders: 30, strength: 370 })).strength, 370,
    'more strength wins even at more orders');
  assert.equal(E.betterRecording(mk({ orders: 30, strength: 370 }),
                                 mk({ orders: 25, strength: 370 })).orders, 25,
    'equal strength falls to fewer orders');

  // `met` is null on a maxKill draft and on recordings predating the field,
  // so only an explicit false may count against a line
  assert.equal(E.betterRecording(rec({ orders: 9, met: null }),
                                 rec({ orders: 12, met: true })).orders, 9);

  // a line-less recording is not a candidate at all
  assert.equal(E.betterRecording(nineteen, { line: [] }).orders, 19);
  assert.equal(E.betterRecording({ line: [] }, nineteen).orders, 19);
});

test('both sides of the submit flow consult the best recording', () => {
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
  // the server must compare before overwriting, and only within one board
  assert.ok(/keep = E\.betterRecording\(old, body\)/.test(SERVER),
    'POST /api/draft-solution should keep the better of the two recordings');
  assert.ok(/puzzleHash\(old\.puzzle\) === E\.puzzleHash\(body\.puzzle\)/.test(SERVER),
    'recordings may only be compared within one board');
  // a better line arriving after submission must reach the pending row
  assert.ok(/function improvePendingReference/.test(SERVER) &&
            /status = 'pending'/.test(SERVER),
    'a late better line should update the pending submission it belongs to');
  // ...and never trade a working reference line for a broken one
  assert.ok(/if \(!check\.solved && cur\) continue;/.test(SERVER),
    'a non-solving line must not replace a solving one');
  // the editor must ask the server rather than trusting its own localStorage
  assert.ok(/E\.betterRecording\(sol, remote\)/.test(EDITOR),
    'the editor should submit the best recording, not the most recent');
});
