// Elephant panic: the shove, and what happens when there is nowhere to shove to.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, applied, E } = require('../helpers');

test('a panic attack shoves the defender back [EFFECTUNIT_PANIC bPush]', () => {
  const g = setup(`
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '2,0', 'straight back, directly away from the attacker');
});

test('the shove falls back through the rear diagonals before bouncing', () => {
  const g = setup(`
    tile 2,0 HEIGHT_MOUNTAIN
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(), g.red());
  const d = g.unit(g.red());
  assert.ok(d.q + ',' + d.r !== '1,0', 'still shoved somewhere');
  assert.deepEqual(applied(d), [], 'and not disarmed, because it had room');
});

test('a shove never lands a land unit on water, even under friendly water control [canUnitTypeOccupy bFinalTile, Tile.cs:10598-10603]', () => {
  // the attacker's own bireme controls the water behind the defender; the
  // shove is a FINAL move, so crossable water is still not a destination
  const g = setup(`
    tile 2,0 TERRAIN_WATER
    tile 3,0 TERRAIN_WATER
    tile 2,-1 HEIGHT_MOUNTAIN
    tile 1,1 HEIGHT_MOUNTAIN
    tile 1,-1 HEIGHT_MOUNTAIN
    tile 0,1 HEIGHT_MOUNTAIN
    blue AFRICAN_ELEPHANT 0,0
    blue BIREME 3,0 anchored
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '1,0', 'he stays put — water is not a place to stand');
  assert.deepEqual(applied(d), ['EFFECTUNIT_DISARMED']);
});

test('with nowhere to go the shove becomes a disarm [PANIC_NO_ESCAPE_EFFECTUNIT]', () => {
  const g = setup(`
    tile 2,0 HEIGHT_MOUNTAIN
    tile 2,-1 HEIGHT_MOUNTAIN
    tile 1,1 HEIGHT_MOUNTAIN
    blue AFRICAN_ELEPHANT 0,0
    blue MILITIA 1,-1
    blue MILITIA 0,1
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '1,0', 'he stays put');
  assert.deepEqual(applied(d), ['EFFECTUNIT_DISARMED']);
  assert.equal(E.DATA.globals.PANIC_NO_ESCAPE_EFFECTUNIT, 'EFFECTUNIT_DISARMED');
});

// Unit.hasPush (Unit.cs:10046-10068) decides whether the shove happens AT
// ALL. When it says no there is no push and no no-escape disarm either: the
// elephant simply hits.
test('a ruler-led unit is immune to panic: hit, not shoved [Unit.cs:10059 isImmuneEffectUnit; EFFECTUNIT_LEADER_GENERAL aeEffectUnitImmune]', () => {
  const g = setup(`
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0 promo=EFFECTUNIT_LEADER_GENERAL
  `);
  assert.ok(E.DATA.effects.EFFECTUNIT_LEADER_GENERAL.aeEffectUnitImmune.includes('EFFECTUNIT_PANIC'));
  g.attack(g.blue(), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '1,0', 'open ground behind him, and he stays put');
  assert.deepEqual(applied(d), []);
  assert.ok(d.hp < E.hpMax(d), 'the blow itself still lands');
});

test('a unit in a city is never shoved [Unit.cs:10054 isSettlement]', () => {
  const g = setup(`
    tile 1,0 city=1
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '1,0');
  assert.deepEqual(applied(d), []);
});

test('a shoved siege unit loses its set-up [Unit.cs:9690-9693 UNLIMBERED_COOLDOWN -> ATTACKED_COOLDOWN]', () => {
  const g = setup(`
    blue AFRICAN_ELEPHANT 0,0
    red ONAGER 1,0 unlimbered
  `);
  assert.ok(g.unit(g.red()).unlimbered);
  g.attack(g.blue(), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '2,0', 'shoved');
  assert.equal(d.unlimbered, false, 'and no longer set up');
});
