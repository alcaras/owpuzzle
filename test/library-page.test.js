// Phase 1 gate: the library page's logic is pure and node-testable.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { foldPuzzles, libraryHtml } = require(path.join(__dirname, '..', 'web', 'js', 'library.js'));
const createStore = require(path.join(__dirname, '..', 'web', 'js', 'store.js'));
const OWDOM = require(path.join(__dirname, '..', 'web', 'js', 'dom.js'));
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));

test('foldPuzzles separates approved community puzzles and the per-slug server maps', () => {
  const folded = foldPuzzles({ puzzles: [
    { slug: 'a', status: 'approved', solvedByMe: true, rating: 1400, band: 2, puzzle: {} },
    { slug: 'b', status: 'pending', perfectByMe: true, puzzle: {} },
    { slug: 'c', status: 'approved', puzzle: {} },
  ]});
  assert.deepEqual(folded.community.map(x => x.slug), ['a', 'c'], 'pending is not community');
  assert.equal(folded.server.solved.a, true);
  assert.equal(folded.server.perfect.b, true);
  assert.equal(folded.server.rating.a, 1400);
  assert.equal(folded.server.band.a, 2);
});

test('foldPuzzles tolerates an empty or malformed response', () => {
  assert.deepEqual(foldPuzzles(null).community, []);
  assert.deepEqual(foldPuzzles({}).community, []);
});

test('store.set notifies, coalesces re-entrant sets, and get() reflects patches', () => {
  const store = createStore({ a: 1 });
  let calls = 0;
  store.onChange(() => {
    calls++;
    if (calls === 1) store.set({ b: 2 });   // re-entrant: must not recurse
  });
  store.set({ a: 3 });
  assert.equal(store.get().a, 3);
  assert.equal(store.get().b, 2);
  assert.equal(calls, 1, 're-entrant set coalesces into the running pass');
});

test('libraryHtml is a pure function of state: same input, same output, escaped', () => {
  global.OWPUZZLES = [
    { id: 'x', name: 'X', brief: 'b', difficulty: 1,
      units: [{ player: 0, type: 'UNIT_AXEMAN' }, { player: 1, type: 'UNIT_ARCHER' }] },
  ];
  const deps = {
    esc: OWDOM.esc, fmt10: OWDOM.fmt10, unitIcon: () => null,
    progEntry: OWDOM.progEntry, puzzleHash: E.puzzleHash, progress: {},
  };
  const state = {
    me: { isAdmin: true }, server: null,
    community: [{ slug: 's', status: 'approved', author: '<img src=x onerror=1>',
      puzzle: { name: '<b>evil</b>', brief: 'fine', units: [{ player: 0, type: 'UNIT_AXEMAN' }] } }],
    pending: [{ slug: 'p', author: 'a', puzzle: { name: '<script>bad</script>', orders: 3, brief: '', units: [] } }],
  };
  const one = libraryHtml(state, deps);
  const two = libraryHtml(state, deps);
  assert.equal(one, two, 'idempotent: repainting is harmless');
  assert.ok(!one.includes('<b>evil</b>'), 'community name is escaped');
  assert.ok(!one.includes('<script>bad</script>'), 'pending name is escaped');
  assert.ok(!one.includes('onerror=1>'), 'author is escaped');
  assert.ok(one.includes('Review queue — 1 pending'), 'admin sees the queue in the same paint');
  delete global.OWPUZZLES;
});

test('libraryHtml without auth shows sign-in, never the queue', () => {
  global.OWPUZZLES = [];
  const deps = { esc: OWDOM.esc, fmt10: OWDOM.fmt10, unitIcon: () => null,
    progEntry: OWDOM.progEntry, puzzleHash: E.puzzleHash, progress: {} };
  const html = libraryHtml({ me: null, community: [], pending: [{ slug: 'p', puzzle: { name: 'n', orders: 1, units: [] } }] }, deps);
  assert.ok(html.includes('Sign in with Discord'));
  assert.ok(!html.includes('Review queue'), 'pending data without an admin renders nothing');
  delete global.OWPUZZLES;
});
