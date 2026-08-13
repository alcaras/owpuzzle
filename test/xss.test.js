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
