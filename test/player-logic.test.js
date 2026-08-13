// Phase 1 gate: the player's decisions are pure and node-tested.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const L = require(path.join(__dirname, '..', 'web', 'js', 'player-logic.js'));
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));

function play(puzzleOverrides, actions) {
  const puzzle = Object.assign({
    id: 'test', name: 't', brief: '', orders: 3, radius: 2, lesson: 'the lesson',
    objective: { kind: 'killAll' },
    units: [{ player: 0, type: 'UNIT_SWORDSMAN', q: 0, r: 0 },
            { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0, hp: 4 }],
  }, puzzleOverrides || {});
  let s = E.loadPuzzle(puzzle, { play: true });
  const line = [];
  for (const a of actions || []) { s = E.applyAction(s, a); line.push(a); }
  return { puzzle, state: s, line };
}

test('a perfect killAll solve computes as won+perfect with pool-based orders', () => {
  const g = play({}, [{ type: 'attack', unit: 0, target: 1 }]);
  const r = L.computeResult(g.puzzle, g.state, true, E);
  assert.equal(r.won, true);
  assert.equal(r.perfect, true, 'used 1 <= par 3');
  assert.equal(r.used, 1, 'orders come from the POOL, not par — the share-math bug');
  assert.match(r.body, /PERFECT/);
  assert.equal(r.lesson, 'the lesson');
  assert.equal(r.next, 'auto');
  assert.equal(r.writeProgress, true);
});

test('a lost turn offers nothing and writes nothing', () => {
  const g = play({}, []);
  const r = L.computeResult(g.puzzle, g.state, false, E);
  assert.equal(r.won, false);
  assert.equal(r.next, null);
  assert.equal(r.writeProgress, false);
});

test('a maxKill draft with no ceiling: neutral verdict, draft recorded, no attempt posted', () => {
  const g = play({ id: 'draft', objective: { kind: 'maxKill' } },
    [{ type: 'attack', unit: 0, target: 1 }]);
  const r = L.computeResult(g.puzzle, g.state, true, E);
  assert.equal(r.noCeiling, true);
  assert.equal(r.won, false, 'no ceiling means no verdict');
  assert.match(r.body, /draft cannot score itself/);
  assert.equal(r.recordDraft, true, 'the unrecorded-draft bug: this MUST be true');
  assert.equal(r.postAttempt, false);
  assert.equal(r.next, 'editor');
});

test('a pending maxKill (not a draft) says approval sets the ceiling', () => {
  const g = play({ id: 'someones-submission', objective: { kind: 'maxKill' } },
    [{ type: 'attack', unit: 0, target: 1 }]);
  const r = L.computeResult(g.puzzle, g.state, true, E);
  assert.match(r.body, /set when the puzzle is approved/);
});

test('draftRecording captures the played board, line, and tally', () => {
  const g = play({ id: 'draft' }, [{ type: 'attack', unit: 0, target: 1 }]);
  const rec = L.draftRecording(g.puzzle, g.state, g.line, E);
  assert.equal(rec.line.length, 1);
  assert.equal(rec.v, E.puzzleHash(g.puzzle));
  assert.deepEqual(rec.puzzle.id, 'draft');
  assert.equal(rec.orders, 1);
  assert.equal(rec.met, true);
});

test('progressPatch: first solve, improvement, perfect upgrade, and no-op', () => {
  const g = play({}, [{ type: 'attack', unit: 0, target: 1 }]);
  const res = { won: true, used: 2, perfect: false };
  const h = E.puzzleHash;
  const first = L.progressPatch({}, g.puzzle, res, h, 111);
  assert.equal(first[g.puzzle.id].solved, true);
  assert.equal(first[g.puzzle.id].orders, 2);

  const better = L.progressPatch(first, g.puzzle, { won: true, used: 1, perfect: true }, h, 222);
  assert.equal(better[g.puzzle.id].orders, 1);
  assert.equal(better[g.puzzle.id].perfect, true);

  const noop = L.progressPatch(better, g.puzzle, { won: true, used: 3, perfect: false }, h, 333);
  assert.equal(noop, null, 'a worse solve changes nothing');

  const upgrade = L.progressPatch(first, g.puzzle, { won: true, used: 2, perfect: true }, h, 444);
  assert.equal(upgrade[g.puzzle.id].perfect, true, 'same orders but perfect still records');
});

test('progressPatch treats a changed board as unsolved', () => {
  const g = play({}, []);
  const h = E.puzzleHash;
  const prog = { [g.puzzle.id]: { solved: true, orders: 1, v: 'stale-hash' } };
  const patched = L.progressPatch(prog, g.puzzle, { won: true, used: 2, perfect: false }, h, 555);
  assert.equal(patched[g.puzzle.id].orders, 2, 'stale entry is replaced, not min-ed against');
});

test('nextUnsolvedLocal walks display order and skips solved', () => {
  const ps = [
    { id: 'c1', difficulty: 3 }, { id: 'a1', difficulty: 1 },
    { id: 'b1', difficulty: 2 }, { id: 'a2', difficulty: 1 },
  ];
  // display order: a1, a2, b1, c1. From a1 with a2 solved -> b1.
  assert.equal(L.nextUnsolvedLocal(ps, { a2: { solved: true } }, 'a1'), 'b1');
  // everything solved -> null
  const all = { a1: { solved: true }, a2: { solved: true }, b1: { solved: true }, c1: { solved: true } };
  assert.equal(L.nextUnsolvedLocal(ps, all, 'a1'), null);
});

test('stepLabel narrates position, action kind, and completion', () => {
  const { stepLabel } = require(path.join(__dirname, '..', 'web', 'js', 'review.js'));
  const line = [{ type: 'move', unit: 1, q: 2, r: -1 }, { type: 'attack', unit: 1, target: 4 }];
  assert.match(stepLabel(line, 0, 'T'), /1 of 2: move to \(2,-1\)/);
  assert.match(stepLabel(line, 1, 'T'), /2 of 2: attack/);
  assert.match(stepLabel(line, 2, 'T'), /line complete/);
});
