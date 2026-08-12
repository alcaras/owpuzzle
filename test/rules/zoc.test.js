// Zone of control: who is held, who rides past.
//
// The discriminating board is a radius-1 ring with the holder in the middle:
// every tile is beside it, so a pinned unit cannot take a single step, while
// one that ignores ZOC can. On an open board the unit simply walks around and
// the rule is invisible — which is how this stayed broken.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, reach, E } = require('../helpers');

function pinned(mover, holder) {
  const g = setup(`
    blue ${mover} 1,0
    red ${holder} 0,0
  `, { radius: 1 });
  return reach(g, g.blue()).length === 0;
}

test('ordinary units are held by any ZOC unit [Tile.isDirectionHostileZOC, Tile.cs:10067]', () => {
  assert.equal(pinned('AXEMAN', 'ARCHER'), true);
  assert.equal(pinned('SPEARMAN', 'SLINGER'), true);
});

test('units with bIgnoreZOC ride past ordinary enemies [Unit.hasIgnoreZOC, Unit.cs:7013]', () => {
  for (const rider of ['HORSEMAN', 'PALTON_CAVALRY', 'CHARIOT', 'CATAPHRACT', 'SCOUT']) {
    assert.equal(pinned(rider, 'ARCHER'), false, rider + ' should ride past an archer');
    assert.equal(pinned(rider, 'AXEMAN'), false, rider + ' should ride past an axeman');
  }
});

test('POLEARM units still hold mounted troops [aeUnitTraitZOC=UNITTRAIT_MOUNTED; Tile.cs:10095]', () => {
  // Ignoring ZOC is not absolute: after the ignore test the game asks
  // isUnitZoc(moverType), and EFFECTUNIT_POLEARM lists UNITTRAIT_MOUNTED.
  for (const holder of ['SPEARMAN', 'PIKEMAN', 'CONSCRIPT', 'HOPLITE', 'PHALANGITE']) {
    assert.equal(pinned('HORSEMAN', holder), true, holder + ' must pin a horseman');
    assert.equal(pinned('PALTON_CAVALRY', holder), true, holder + ' must pin palton cavalry');
    assert.equal(pinned('CHARIOT', holder), true, holder + ' must pin a chariot');
  }
});

test('elephants do not carry bIgnoreZOC, so everything holds them [unit.xml]', () => {
  assert.equal(E.DATA.units.UNIT_AFRICAN_ELEPHANT.bIgnoreZOC, undefined,
    'if the game ever gives elephants the flag, this test should fail loudly');
  assert.equal(pinned('AFRICAN_ELEPHANT', 'ARCHER'), true);
  assert.equal(pinned('AFRICAN_ELEPHANT', 'SPEARMAN'), true);
});

test('the mounted exception is keyed to the trait, not to being a horse', () => {
  // elephants are UNITTRAIT_MOUNTED too, so a polearm holds them for the same
  // reason it holds cavalry — belt and braces, since they are held anyway
  assert.ok(E.DATA.units.UNIT_AFRICAN_ELEPHANT.traits.includes('UNITTRAIT_MOUNTED'));
  assert.ok(E.DATA.units.UNIT_HORSEMAN.traits.includes('UNITTRAIT_MOUNTED'));
});

test('zone of control does not cross the shoreline [Tile.cs:10044]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    tile 1,-1 TERRAIN_WATER
    tile 0,1 TERRAIN_WATER
    tile 0,-1 TERRAIN_WATER
    tile -1,0 TERRAIN_WATER
    tile -1,1 TERRAIN_WATER
    blue BIREME 1,0
    red AXEMAN 0,0
  `, { radius: 1 });
  assert.ok(reach(g, g.blue()).length > 0, 'a land unit cannot project ZOC onto the water');
});
