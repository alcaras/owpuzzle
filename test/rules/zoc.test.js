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

// Rivers. Tile.isHostileZOC (Tile.cs:10107-10142) skips a river edge unless
// bIgnoreRiver (Tile.cs:10128), and the pathfinder's step test
// (Unit.isValidMovementDirection, Unit.cs:7690-7697) asks it twice: the NEXT
// tile with rivers respected, the CURRENT tile with bIgnoreRiver set to
// whether the step itself crosses a river. So a unit beside an enemy — even
// one across the river — may not cross a river into another enemy's ZOC,
// while an ordinary land step keeps "rivers block ZOC" on both tiles.
//
// DIRS: 0=E 1=NE 2=NW 3=W 4=SW 5=SE. The board: blue at A=0,0, the target
// B=1,0 to its east, the red at 1,-1 — a neighbour of both. 0,1 is a
// mountain so B can only be entered straight from A.
function crossing(mover, holder, riversOnA, riversOnB) {
  return setup(`
    tile 0,0 river=${riversOnA}
    ${riversOnB ? 'tile 1,0 river=' + riversOnB : ''}
    tile 0,1 HEIGHT_MOUNTAIN
    blue ${mover} 0,0
    red ${holder} 1,-1
  `, { radius: 1 });
}

test('crossing a river into ZOC is forbidden when an enemy stands beside the crossing tile, even across the river [Unit.cs:7694 with bIgnoreRiver=true; Tile.cs:10128]', () => {
  // river on A's edges toward B (0) and toward the red (1): A is not in ZOC by
  // land, B is in ZOC by land, and the step A->B crosses a river
  const g = crossing('WARRIOR', 'WARRIOR', '0,1');
  assert.ok(!reach(g, g.blue()).includes('1,0'), 'the warrior must not cross into the column');
});

test('crossing a river into ZOC from a tile with no adjacent enemy at all is allowed [Unit.cs:7694: bIgnoreRiver widens the current-tile test, it does not forbid crossings]', () => {
  const g = setup(`
    tile 0,0 river=0
    blue WARRIOR 0,0
    red WARRIOR 2,-1
  `, { radius: 2 });
  // 2,-1 is beside 1,0 by land and two tiles from 0,0
  assert.ok(reach(g, g.blue()).includes('1,0'));
});

test('a land step into ZOC from a tile whose only adjacent enemy is across a river is allowed [Unit.cs:7694 with bIgnoreRiver=false; Tile.cs:10128]', () => {
  // river only on A's edge toward the red: A->B is a land step, A is not in
  // ZOC with rivers respected, and that is the test the game applies
  const g = crossing('WARRIOR', 'WARRIOR', '1');
  assert.ok(reach(g, g.blue()).includes('1,0'));
});

test('a destination whose only adjacent enemy is across a river is not a ZOC tile, even when the step crosses a river [Unit.cs:7690: the next tile always respects rivers]', () => {
  // A is in ZOC by land (the red is A's land neighbour); B's edge toward the
  // red (2 = NW) is a river, so B is not in ZOC; A->B crosses a river
  const g = crossing('WARRIOR', 'WARRIOR', '0', '2');
  assert.ok(reach(g, g.blue()).includes('1,0'));
});

test('a swap tests both tiles with rivers respected [Unit.cs:8257]', () => {
  // neither tile is in ZOC by land (the red is across a river from both), so
  // the swap across the river between them is legal
  const g = setup(`
    tile 0,0 river=0,1
    tile 1,0 river=2
    blue WARRIOR 0,0
    blue ARCHER 1,0
    red WARRIOR 1,-1
  `, { radius: 1 });
  assert.equal(E.canSwap(g.state, g.blue(0), g.blue(1)), true);
});

test('bIgnoreZOC still crosses, and POLEARM still holds MOUNTED across the crossing [Tile.cs:10091, 10095 apply inside every direction test]', () => {
  assert.ok(reach(crossing('HORSEMAN', 'WARRIOR', '0,1'), crossing('HORSEMAN', 'WARRIOR', '0,1').blue()).includes('1,0'),
    'a horseman ignores the warrior on both tiles');
  const g = crossing('HORSEMAN', 'SPEARMAN', '0,1');
  assert.ok(!reach(g, g.blue()).includes('1,0'), 'a spearman across the river pins the horseman at the crossing');
});
