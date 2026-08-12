// Range, height and line of sight.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, canHit, damage } = require('../helpers');

test('a shot reaches range + max(fromHeight - toHeight, 0) [Unit.canTargetTile, Unit.cs:8487]', () => {
  // palton cavalry: range 1. From a hill onto flat that is 2; onto another
  // hill it is back to 1, because height only helps insofar as you out-top
  // the target.
  const flat = setup(`
    tile 0,0 HEIGHT_HILL
    blue PALTON_CAVALRY 0,0
    red ARCHER 2,0
  `);
  assert.equal(canHit(flat, flat.blue(), flat.red()), true, 'hill -> flat at 2 should reach');

  const uphill = setup(`
    tile 0,0 HEIGHT_HILL
    tile 2,0 HEIGHT_HILL
    blue PALTON_CAVALRY 0,0
    red ARCHER 2,0
  `);
  assert.equal(canHit(uphill, uphill.blue(), uphill.red()), false, 'hill -> hill at 2 must not reach');

  const level = setup(`
    blue PALTON_CAVALRY 0,0
    red ARCHER 2,0
  `);
  assert.equal(canHit(level, level.blue(), level.red()), false, 'flat -> flat at 2 must not reach');
});

test('the rout-advance test uses rangeMax(tile), which ignores the target height [Unit.cs:6375, 8517]', () => {
  // The game deliberately asks a looser question when deciding whether a kill
  // is worth advancing for: base range + the tile's own rangeChange. So a
  // palton routs onto a hill for a target it then cannot actually shoot.
  const g = setup(`
    tile 1,0 HEIGHT_HILL
    tile 3,0 HEIGHT_HILL
    blue PALTON_CAVALRY 0,0
    red SLINGER 1,0 hp=6
    red ARCHER 3,0
  `);
  g.attack(g.blue(), g.at('1,0'));
  const pal = g.unit(g.blue());
  assert.equal(pal.q + ',' + pal.r, '1,0', 'should have routed onto the hill');
  assert.equal(canHit(g, pal, g.at('3,0')), false,
    'and the shot it advanced for is out of range, because the target is also elevated');
});

test('bRangeFlat units get nothing from height [Unit.rangeMax, Unit.cs:6377]', () => {
  const { E } = require('../helpers');
  const flatRanged = Object.keys(E.DATA.units).filter((u) => E.DATA.units[u].bRangeFlat);
  if (!flatRanged.length) return; // nothing in this dataset to check
  const type = flatRanged[0].replace('UNIT_', '');
  const base = E.DATA.units[flatRanged[0]].iRangeMax;
  const g = setup(`
    tile 0,0 HEIGHT_HILL
    blue ${type} 0,0
    red ARCHER ${base + 1},0
  `);
  assert.equal(canHit(g, g.blue(), g.red()), false,
    type + ' ignores the hill, so range stays ' + base);
});

test('mountains block line of sight [Tile.isShotObstructed]', () => {
  const clear = setup(`
    blue ARCHER 0,0
    red SLINGER 2,0
  `);
  assert.equal(canHit(clear, clear.blue(), clear.red()), true);

  const blocked = setup(`
    tile 1,0 HEIGHT_MOUNTAIN
    blue ARCHER 0,0
    red SLINGER 2,0
  `);
  assert.equal(canHit(blocked, blocked.blue(), blocked.red()), false,
    'a mountain squarely between must stop the arrow');
});

test('crossing the shoreline costs a ranged shot one hex of DAMAGE, not of reach [Unit.distanceModifier, Unit.cs:6606]', () => {
  // The extra hex is charged against the distance penalty, not against
  // targeting: a point-blank shot at a ship is still legal, it just lands
  // like a shot from two tiles away.
  const across = setup(`
    tile 1,0 TERRAIN_WATER
    blue SLINGER 0,0
    red BIREME 1,0
  `);
  assert.equal(canHit(across, across.blue(), across.red()), true, 'targeting is unaffected');

  const twoAway = setup(`
    blue SLINGER 0,0
    red BIREME 2,0
  `);
  const onLandAdjacent = setup(`
    blue SLINGER 0,0
    red BIREME 1,0
  `);
  assert.ok(damage(across, across.blue(), across.red()) < damage(onLandAdjacent, onLandAdjacent.blue(), onLandAdjacent.red()),
    'the shoreline shot is weaker than the same shot on dry land');
  assert.equal(damage(across, across.blue(), across.red()), damage(twoAway, twoAway.blue(), twoAway.red()),
    'and is worth exactly what a shot one hex further would be');
});

test('hills give no defensive bonus [height.xml carries no defence field]', () => {
  const flat = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const hill = setup(`
    tile 1,0 HEIGHT_HILL
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  assert.equal(damage(hill, hill.blue(), hill.red()), damage(flat, flat.blue(), flat.red()),
    'standing on a hill must not reduce the damage taken');
});
