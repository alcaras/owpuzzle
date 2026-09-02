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
// when the tile isWaterMovement for its team, and costs movement() — the RAW
// value, so water is CHEAP (see the FAST test below).
// Tile.canUnitTypeOccupy (Tile.cs:10577-10605): those water tiles may be moved
// ACROSS but never STOPPED on, so every test here crosses to a far bank.
// Tile.isWaterMovement (Tile.cs:8073-8113): true if the team has water control
// on the tile, OR the tile is owned by that team or an ally.
// Unit.waterControl (Unit.cs:3480): radius = the unit's own iWaterControl plus
// iWaterControlExtra from effects. A bireme is 3, a trireme 4, a dromon 5 —
// the engine had this hardcoded to 1.

test('an anchored bireme controls water out to its own radius of 3 [Unit.cs:3480, unit.xml iWaterControl]', () => {
  const g = setup(`
    tile -2,0 TERRAIN_WATER
    tile -1,0 TERRAIN_WATER
    tile 0,0 TERRAIN_WATER
    blue AXEMAN -3,0
    blue BIREME -1,0 anchored
    red ARCHER 3,0 hp=5
  `);
  // -2,0 is two tiles from the anchored bireme and 0,0 is one: all three lie
  // inside its radius of 3, so the axeman can cross the channel to 1,0
  const reach = E.reachableTiles(g.state, g.blue(0)).map((t) => t.q + ',' + t.r);
  assert.ok(reach.includes('1,0'),
    'the far bank across controlled water should be reachable, got: ' + reach.join(' '));
});

// This is what "FAST water movement" means. getMovementCost (Unit.cs:7583)
// returns movement() — the RAW movement value, 1 to 3 — where a land tile costs
// terrain().miMovementCost, which is 9. movementFull() (Unit.cs:6341) is the
// 9x-scaled figure and is a DIFFERENT method. Charging movementFull() made
// water nine times dearer than the game charges, which is the whole of
// "fast water movement doesn't work".
test('controlled water is FAST: it costs movement(), not movementFull() [Unit.cs:7583 vs 6341]', () => {
  const g = setup(`
    tile -2,0 TERRAIN_WATER
    tile -1,0 TERRAIN_WATER
    tile 0,0 TERRAIN_WATER
    blue AXEMAN -3,0
    blue BIREME -1,0 anchored
    red ARCHER 3,0 hp=5
  `);
  const far = E.reachableTiles(g.state, g.blue(0)).filter((t) => t.q === 1 && t.r === 0)[0];
  assert.ok(far, 'the far bank is reachable at all');
  // an axeman has movement 2, so each water tile costs 2 against an 18-point
  // step: three of them plus the 9 of the far bank is 15, still ONE step.
  // Charging movementFull() would make the three crossings 54 on their own.
  assert.equal(far.steps, 1, 'the whole crossing fits in a single step');
  assert.equal(far.orders, 1, 'and costs one order');
});

test('water owned by your own territory is crossable without any ship [Tile.cs:8103 areAllied]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER own=0
    blue AXEMAN 0,0
    red ARCHER -1,0 hp=5
  `);
  const reach = E.reachableTiles(g.state, g.blue()).map((t) => t.q + ',' + t.r);
  assert.ok(reach.includes('2,0'),
    'friendly territory lets you cross to the far bank; got: ' + reach.join(' '));
  assert.ok(!reach.includes('1,0'), 'but you may not stop on the water itself');
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

// The area an anchored ship controls is not a plain circle. The game builds it
// with getContiguous (Unit.updateWaterControlTiles, Unit.cs:4003):
//   pFromTile.getContiguous(tile => tile.isWater() && distance <= waterControl())
// so it is WATER only, and only water CONNECTED to the ship's own tile. Water
// on the far side of a spit of land is inside the radius but not controlled.
test('an anchored ship controls only water connected to it [Unit.cs:4003 getContiguous]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    tile 3,0 TERRAIN_WATER
    blue AXEMAN 0,0
    blue BIREME 1,0 anchored
    red ARCHER -1,0 hp=5
  `);
  // 2,0 is land, so 3,0 — though only two tiles from the bireme, well inside
  // its radius of 3 — is cut off from the ship's own water and uncontrolled
  assert.ok(!E.waterControlled(g.state, { q: 3, r: 0 }, 0),
    'water behind a land barrier must not be controlled');
  assert.ok(E.waterControlled(g.state, { q: 1, r: 0 }, 0),
    "the ship's own tile is controlled");
});

test('water control does not leak onto land [Unit.cs:4003 tile.isWater()]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    blue AXEMAN 0,0
    blue BIREME 1,0 anchored
    red ARCHER -1,0 hp=5
  `);
  assert.ok(!E.waterControlled(g.state, { q: 2, r: 0 }, 0),
    'a land tile inside the radius is not "water controlled"');
});

// Not a game rule: an engine invariant. waterControlled memoises the union of
// a player's controlled water per state (the blow table asks thousands of
// times), and the memo must not outlive the ships it was computed from —
// verifiers mutate cloned states in place (u.q = …, u.hp = 0).
test('the water-control memo follows in-place changes to the ship [engine invariant]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    tile 2,0 TERRAIN_WATER
    tile 3,0 TERRAIN_WATER
    blue AXEMAN 0,0
    blue BIREME 1,0 anchored
    red ARCHER -1,0 hp=5
  `);
  const s = g.state, ship = g.unit(g.blue(1));
  assert.ok(E.waterControlled(s, { q: 3, r: 0 }, 0));
  ship.anchored = false;
  assert.ok(!E.waterControlled(s, { q: 3, r: 0 }, 0), 'weighing anchor drops control');
  ship.anchored = true;
  ship.hp = 0;
  assert.ok(!E.waterControlled(s, { q: 3, r: 0 }, 0), 'a sunk ship controls nothing');
  ship.hp = 10;
  ship.q = 3;
  assert.ok(E.waterControlled(s, { q: 3, r: 0 }, 0), 'moved and re-anchored, it controls from its new tile');
  assert.ok(E.waterControlled(s, { q: 1, r: 0 }, 0));
  // a clone is a fresh state: no stale memo rides along in the JSON
  const c = E.cloneState(s);
  E.unitById(c, ship.id).hp = 0;
  assert.ok(!E.waterControlled(c, { q: 1, r: 0 }, 0));
  assert.ok(E.waterControlled(s, { q: 1, r: 0 }, 0), 'and the original is untouched');
});

// A LAND unit standing on water cannot attack from it. Confirmed as in-game
// behaviour by the project owner after zophister reported a ballista marching
// onto owned water and shooting from it; the only guard in the C# I could
// locate (Unit.canTargetTile, Unit.cs:8449) bars tribe units only, so this
// citation is the game's behaviour rather than that line.
test('a land unit on water cannot attack from it [in-game behaviour]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER own=0
    blue BALLISTA 1,0
    red ARCHER 2,0 hp=5
  `);
  const bal = g.blue(0);
  bal.unlimbered = true;
  assert.equal(E.canAttack(g.state, bal), false,
    'a ballista afloat has no shot');
});

test('the same unit ashore can attack normally [control]', () => {
  const g = setup(`
    blue BALLISTA 1,0
    red ARCHER 2,0 hp=5
  `);
  const bal = g.blue(0);
  bal.unlimbered = true;
  assert.equal(E.canAttack(g.state, bal), true);
});

// Tile.canUnitTypeOccupy (Tile.cs:10577-10605): the water rules are checked
// only `if (bFinalTile)`. A land unit may move ACROSS controlled water but may
// not END its move on it —
//     else if (!(game().isWaterUnit(...))) { if (isWater()) return false; }
// Only UNIT_WORKER carries bTerritoryWater, the one exception, and it is not a
// combat unit. This is what water control is FOR: crossing to the far bank.
test('a land unit may cross controlled water but not stop on it [Tile.cs:10600-10605]', () => {
  const g = setup(`
    tile 1,0 TERRAIN_WATER
    tile 2,0 TERRAIN_WATER
    blue AXEMAN 0,0
    blue BIREME 1,0 anchored
    red ARCHER 4,0 hp=5
  `);
  const reach = E.reachableTiles(g.state, g.blue(0)).map((t) => t.q + ',' + t.r);
  assert.ok(!reach.includes('2,0'),
    'water must not be a legal destination, got: ' + reach.join(' '));
  assert.ok(reach.includes('3,0'),
    'but the far bank beyond the water must be reachable, got: ' + reach.join(' '));
});
