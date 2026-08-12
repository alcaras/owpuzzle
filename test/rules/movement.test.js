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
