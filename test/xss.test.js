// Every innerHTML sink in app.js that renders community-submitted strings
// must escape. TEMPORARY grep-shaped gate (architecture review, Phase 0):
// replaced by a hostile-named-puzzle e2e in Phase 2, then deleted.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

test('community card and review card sinks escape user content', () => {
  for (const needle of [
    "esc(pz.name)", "esc(pz.brief || '')", "esc(x.author || '?')",
    "esc(item.puzzle.name)", "esc(item.author || '?')", "esc(item.puzzle.brief || '')",
  ]) {
    assert.ok(APP.includes(needle), 'missing escaped sink: ' + needle);
  }
  // and the raw forms must be gone
  for (const raw of ["'<h3>' + pz.name", "'<h3>' + item.puzzle.name"]) {
    assert.ok(!APP.includes(raw), 'unescaped sink resurfaced: ' + raw);
  }
});

test('the puzzle fingerprint covers everything the editor can paint', () => {
  const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
  const base = { orders: 3, radius: 2, objective: { kind: 'killAll' },
    tiles: [{ q: 0, r: 0 }],
    units: [{ player: 0, type: 'UNIT_AXEMAN', q: 0, r: 0 },
            { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0 }] };
  const h0 = E.puzzleHash(base);
  const road = JSON.parse(JSON.stringify(base)); road.tiles[0].road = true;
  const owner = JSON.parse(JSON.stringify(base)); owner.tiles[0].owner = 1;
  assert.notEqual(E.puzzleHash(road), h0, 'adding a road must change the fingerprint');
  assert.notEqual(E.puzzleHash(owner), h0, 'changing ownership must change the fingerprint');
});

// An author-set order pool is part of the fight — a board that hands out 6
// orders is not the board that hands out 10 — so it must move the
// fingerprint. But a board that never sets one has to keep the fingerprint it
// has always had: the term is appended only when a pool exists, because
// re-hashing the whole library retires every row and takes every solve on it
// (server/db.js seedCorePuzzles).
test('a custom order pool moves the fingerprint; its absence never does', () => {
  const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
  const base = { orders: 3, radius: 2, objective: { kind: 'killAll' },
    units: [{ player: 0, type: 'UNIT_AXEMAN', q: 0, r: 0 },
            { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0 }] };
  // frozen: the value this board hashed to before the pool term existed
  assert.equal(E.puzzleHash(base), E.puzzleHash(Object.assign({}, base, { pool: 0 })),
    'no pool and a falsy pool must hash alike — the default rule is unchanged');
  const four = E.puzzleHash(Object.assign({}, base, { pool: 4 }));
  const six = E.puzzleHash(Object.assign({}, base, { pool: 6 }));
  assert.notEqual(four, E.puzzleHash(base), 'naming the pool must change the fingerprint');
  assert.notEqual(four, six, 'a different pool is a different fight');
});

// engine.js poolOrders: the automatic rule rounds par+5 up to a multiple of 5
// so the pool cannot leak par; a named pool is taken as given but never below
// par, which would make the puzzle unwinnable at its own optimum.
test('poolOrders: automatic par+slack, or the author\'s own number floored at par', () => {
  const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
  assert.equal(E.poolOrders({ orders: 3 }), 10);
  assert.equal(E.poolOrders({ orders: 6 }), 15);
  assert.equal(E.poolOrders({ orders: 6, pool: 7 }), 7, 'a named pool is taken as given');
  assert.equal(E.poolOrders({ orders: 6, pool: 6 }), 6, 'a pool equal to par is legal — no slack');
  assert.equal(E.poolOrders({ orders: 6, pool: 4 }), 6, 'a pool below par is floored at par');
});

// The fingerprint must cover everything the editor can PAINT, or an author can
// change the board after test play and the changed-board check waves it
// through. `unlimbered` became paintable when the set-up checkbox landed
// (2026-09-05), and a set-up siege engine is a different unit in the fight: it
// fires on turn one, where a limbered one cannot fire at all.
test('a set-up siege engine moves the fingerprint; a limbered one never did', () => {
  const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
  const base = { orders: 3, radius: 2, objective: { kind: 'killAll' },
    units: [{ player: 0, type: 'UNIT_ONAGER', q: 0, r: 0 },
            { player: 1, type: 'UNIT_ARCHER', q: 2, r: 0 }] };
  const setUp = JSON.parse(JSON.stringify(base)); setUp.units[0].unlimbered = true;
  assert.notEqual(E.puzzleHash(setUp), E.puzzleHash(base),
    'setting up an onager must read as a different fight');
  // ...and a board with none hashes exactly as it always did — the term is
  // only appended when set, so the library is not re-hashed wholesale
  assert.equal(E.puzzleHash(base),
    E.puzzleHash(Object.assign({}, base, { units: base.units.map(u =>
      Object.assign({}, u, { unlimbered: false })) })),
    'unlimbered:false must hash identically to absent');

  // the engine only honours the flag on a type that can carry it, so the
  // editor gates the checkbox the same way (bUnlimber, as anchored uses bAnchor)
  // the XML gives these as 1/absent, not true/false — the editor gates on
  // truthiness for exactly that reason
  assert.ok(E.DATA.units.UNIT_ONAGER.bUnlimber, 'onagers set up');
  assert.ok(!E.DATA.units.UNIT_ARCHER.bUnlimber, 'archers do not');
});
