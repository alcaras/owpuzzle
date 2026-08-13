// Every innerHTML sink in app.js that renders community-submitted strings
// must escape. TEMPORARY grep-shaped gate (architecture review, Phase 0):
// replaced by a hostile-named-puzzle e2e in Phase 2, then deleted.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// The grep-shaped sink check that used to live here is deleted: the sinks
// moved into web/js/library.js and are now covered BEHAVIOURALLY by
// test/library-page.test.js, which renders hostile names through libraryHtml
// and inspects the output. That is the deletion path testing-strategy.md
// prescribes for every grep test.

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
