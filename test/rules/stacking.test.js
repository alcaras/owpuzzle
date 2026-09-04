// Two units on one tile. Old World is not strictly one-unit-per-tile:
// Tile.canBothUnitsOccupy (Tile.cs:10428-10477) lets ALLIED units share when
// exactly one of them can damage — canDamage = bMelee || iRangeMax > 0
// (InfoHelpers.cs:741-744) — so a horseman may stand on its own scout. And a
// unit only walls a tile off if it BLOCKS (mbBlocks, canUnitOccupy
// Tile.cs:10516), which the scout, the workers, the settlers and the caravan
// do not; you walk straight through an enemy scout, you just cannot stop on it.
//
// Reported by an author (2026-09-03) after the scout reached the editor: his
// horseman could not step onto his own scout. The coverage audit had bBlocks
// acknowledged as "every unit blocks its tile in a puzzle" — true until the
// day a non-blocking unit joined the roster.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, reach, E } = require('../helpers');

test('a horseman may END its move on its own scout — one of them cannot damage [Tile.cs:10449, InfoHelpers.cs:741]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    blue SCOUT 1,0
  `);
  assert.ok(reach(g, g.blue(0)).includes('1,0'), 'the scout tile is a destination');
  g.move(g.blue(0), '1,0');
  const h = g.unit(g.blue(0)), s = g.unit(g.blue(1));
  assert.equal(h.q + ',' + h.r, '1,0');
  assert.equal(s.q + ',' + s.r, '1,0', 'and the scout is still there — they share it');
});

test('the scout may step onto the horseman too — the rule is symmetric [Tile.cs:10449]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    blue SCOUT 1,0
  `);
  assert.ok(reach(g, g.blue(1)).includes('0,0'));
});

test('two units that BOTH damage may not share a tile [Tile.cs:10477 returns false]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    blue SPEARMAN 1,0
  `);
  assert.ok(!reach(g, g.blue(0)).includes('1,0'), 'still one military unit per tile');
});

test('two scouts may not share either — neither can damage, so nothing differs [Tile.cs:10449]', () => {
  const g = setup(`
    blue SCOUT 0,0
    blue SCOUT 1,0
  `);
  assert.ok(!reach(g, g.blue(0)).includes('1,0'));
});

test('an enemy scout does not block the path — it has no bBlocks [Tile.cs:10516]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    red SCOUT 1,0
  `);
  const r = reach(g, g.blue(0));
  assert.ok(r.includes('2,0'), 'the tile beyond the enemy scout is reachable');
  assert.ok(!r.includes('1,0'), 'but you cannot stop on a hostile unit (canBothUnitsOccupy)');
});

test('an enemy SPEARMAN still walls its own tile off [bBlocks, Tile.cs:10516]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    red SPEARMAN 1,0
  `);
  assert.ok(!reach(g, g.blue(0)).includes('1,0'));
});

test('a scout on the tile does not hide its partner\'s ZOC [Tile.cs:10091, unit.xml bZOC]', () => {
  // the engine used to read whichever unit came out of the tile first, and a
  // scout has no bZOC — so the spearman's pin would vanish under it
  const board = (extra) => setup(`
    ${extra}
    red SPEARMAN 2,0
    blue SWORDSMAN 0,0
  `);
  const alone = reach(board(''), board('').blue(0));
  const stacked = board('red SCOUT 2,0');
  assert.equal(E.unitAt(stacked.state, 2, 0).type, 'UNIT_SCOUT', 'the scout is the one unitAt finds');
  assert.ok(!alone.includes('3,0'), 'the pin denies the ZOC -> ZOC step past the spearman');
  assert.deepEqual(reach(stacked, stacked.blue(0)).sort(), alone.sort(),
    'and denies exactly the same tiles with a scout standing on it');
});

test('a scout on the tile does not cost its partner the flank [Unit.cs:10598 — a flanked defender cannot counter]', () => {
  // flanking does not change the damage; it takes the counterattack away
  const counter = (spec) => {
    const g = setup(spec);
    const before = g.blue(0).hp;
    g.attack(g.blue(0), g.red(0));
    return before - g.unit(g.blue(0)).hp;
  };
  assert.equal(counter('blue SPEARMAN 0,0\nred WARRIOR 1,0'), 1, 'unflanked: the warrior counters');
  assert.equal(counter('blue SPEARMAN 0,0\nblue SWORDSMAN 2,0\nred WARRIOR 1,0'), 0, 'flanked: no counter');
  assert.equal(counter('blue SPEARMAN 0,0\nblue SCOUT 2,0\nred WARRIOR 1,0'), 1,
    'a scout cannot flank on its own — it deals no damage (InfoHelpers.cs:741)');
  assert.equal(counter('blue SPEARMAN 0,0\nblue SCOUT 2,0\nblue SWORDSMAN 2,0\nred WARRIOR 1,0'), 0,
    'but the swordsman under it still flanks');
});

test('a shove lands the enemy on ITS OWN scout rather than being blocked [Unit.cs:1918-1921]', () => {
  const g = setup(`
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0
    red SCOUT 2,0
  `);
  const scout = g.red(1);
  g.attack(g.blue(0), g.red(0));
  const d = g.unit(g.red(0));
  assert.equal(d.q + ',' + d.r, '2,0', 'shoved straight back onto its own scout');
  const s = g.unit(scout);
  assert.equal(s.q + ',' + s.r, '2,0', 'and the scout stays — they share the tile');
});
