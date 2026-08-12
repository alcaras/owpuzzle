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
