// Movement costs: roads, terrain, and what counts as a road.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, reachCost, E } = require('../helpers');

test('urban terrain carries a road [terrain.xml bRoadFree; Tile.setTerrain, Tile.cs:3432]', () => {
  assert.equal(E.DATA.terrain.TERRAIN_URBAN.bRoadFree, 1);
  const plain = setup(`
    blue AXEMAN 0,0
    red ARCHER -3,0
  `);
  const urban = setup(`
    tile 0,0 TERRAIN_URBAN
    tile 1,0 TERRAIN_URBAN
    tile 2,0 TERRAIN_URBAN
    tile 3,0 TERRAIN_URBAN
    blue AXEMAN 0,0
    red ARCHER -3,0
  `);
  assert.ok(reachCost(urban, urban.blue(), '3,0') < reachCost(plain, plain.blue(), '3,0'),
    'a street should be cheaper to march down than open ground');
});

test('road movement needs a road at BOTH ends [Unit.cs:7641-7656]', () => {
  const half = setup(`
    tile 1,0 TERRAIN_URBAN
    blue AXEMAN 0,0
    red ARCHER -3,0
  `);
  const plain = setup(`
    blue AXEMAN 0,0
    red ARCHER -3,0
  `);
  assert.equal(reachCost(half, half.blue(), '1,0'), reachCost(plain, plain.blue(), '1,0'),
    'stepping onto a road from open ground is not road movement');
});

test('mountains are impassable', () => {
  const g = setup(`
    tile 1,0 HEIGHT_MOUNTAIN
    blue AXEMAN 0,0
    red ARCHER 2,0
  `);
  assert.equal(reachCost(g, g.blue(), '1,0'), null);
});

test('the order pool is bucketed off par [E.poolOrders]', () => {
  assert.equal(E.poolOrders({ orders: 3 }), 10);
  assert.equal(E.poolOrders({ orders: 5 }), 10);
  assert.equal(E.poolOrders({ orders: 8 }), 15);
  assert.equal(E.poolOrders({ orders: 22 }), 30);
});

// ---------------------------------------------------------------------------
// Water movement for LAND units. Reported by fluffybunny: "Fast water movement
// doesn't work, either via territory or anchored ship."
//
// Unit.getMovementCost (Unit.cs:7571-7585): a land unit entering water is legal
// when the tile isWaterMovement for its team, and then costs movement() — the
// unit's WHOLE allowance, one step.
// Tile.isWaterMovement (Tile.cs:8073-8113): true if the team has water control
// on the tile, OR the tile is owned by that team or an ally.
// Unit.waterControl (Unit.cs:3480): radius = the unit's own iWaterControl plus
// iWaterControlExtra from effects. A bireme is 3, a trireme 4, a dromon 5 —
// the engine had this hardcoded to 1.

test('an anchored bireme controls water out to its own radius of 3 [Unit.cs:3480, unit.xml iWaterControl]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    tile 2,0 TERRAIN_WATER
    tile 3,0 TERRAIN_WATER
    blue AXEMAN 0,0
    blue BIREME 3,0 anchored
    red ARCHER -1,0 hp=5
  `);
  const axe = g.blue(0);
  const reach = E.reachableTiles(g.state, axe).map((t) => t.q + ',' + t.r);
  // 1,0 is three tiles from the anchored bireme at 3,0 — inside its radius
  assert.ok(reach.includes('1,0'),
    'water within the bireme\'s control radius should be enterable, got: ' + reach.join(' '));
});

test('entering controlled water costs the whole movement allowance [Unit.cs:7578 returns movement()]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    blue AXEMAN 0,0
    blue BIREME 2,0 anchored
    red ARCHER -1,0 hp=5
  `);
  const step = E.reachableTiles(g.state, g.blue(0)).filter((t) => t.q === 1 && t.r === 0)[0];
  assert.ok(step, 'the water tile should be reachable at all');
  assert.equal(step.steps, 1, 'it is one step, not a fraction of one');
});

test('water owned by your own territory is crossable without any ship [Tile.cs:8103 areAllied]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER own=0
    blue AXEMAN 0,0
    red ARCHER -1,0 hp=5
  `);
  const reach = E.reachableTiles(g.state, g.blue()).map((t) => t.q + ',' + t.r);
  assert.ok(reach.includes('1,0'),
    'friendly territory makes water passable; got: ' + reach.join(' '));
});

test('enemy-owned water is not crossable [Tile.cs:8103 — allied only]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER own=1
    blue AXEMAN 0,0
    red ARCHER -1,0 hp=5
  `);
  const reach = E.reachableTiles(g.state, g.blue()).map((t) => t.q + ',' + t.r);
  assert.ok(!reach.includes('1,0'), 'enemy water must stay impassable');
});
