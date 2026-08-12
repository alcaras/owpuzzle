// Rout: the kill that moves you.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, E } = require('../helpers');

test('a rout kill advances into the vacated tile and grants another attack [Unit.cs:9705]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    red ARCHER 1,0 hp=4
    red ARCHER 2,0 hp=4
  `);
  g.attack(g.blue(), g.at('1,0'));
  const h = g.unit(g.blue());
  assert.equal(h.q + ',' + h.r, '1,0', 'advanced into the dead man\'s tile');
  assert.equal(E.canAttack(g.state, h), true, 'and may swing again');
});

test('no advance when nothing further is attackable from the vacated tile [canTargetFrom]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    red ARCHER 1,0 hp=4
  `);
  g.attack(g.blue(), g.red());
  const h = g.unit(g.blue());
  assert.equal(h.q + ',' + h.r, '0,0', 'a lone kill leaves you where you stood');
});

test('a rout grants an attack but NOT movement [Unit.cs:9719 doCooldown(ROUT)]', () => {
  const g = setup(`
    blue HORSEMAN 0,0
    red ARCHER 1,0 hp=4
    red ARCHER 2,0 hp=4
  `);
  g.attack(g.blue(), g.at('1,0'));
  assert.equal(E.canMove(g.state, g.unit(g.blue())), false);
});

test('attacking without a rout ends the unit\'s turn [ATTACK_COOLDOWN]', () => {
  const g = setup(`
    blue AXEMAN 0,0
    red SPEARMAN 1,0
  `);
  g.attack(g.blue(), g.red());
  const a = g.unit(g.blue());
  assert.equal(E.canAttack(g.state, a), false);
  assert.equal(E.canMove(g.state, a), false);
});

test('a ranged kill at distance does not teleport the attacker', () => {
  const g = setup(`
    blue ARCHER 0,0
    red SLINGER 2,0 hp=3
    red SLINGER 3,0 hp=3
  `);
  g.attack(g.blue(), g.at('2,0'));
  const a = g.unit(g.blue());
  assert.equal(a.q + ',' + a.r, '0,0', 'advance requires adjacency');
});

test('polearm units are immune to ROUT, so they break a chain [EFFECTUNIT_POLEARM aeEffectUnitImmune]', () => {
  const { setup } = require('../helpers');
  const chain = setup(`
    blue HORSEMAN 0,0
    red ARCHER 1,0 hp=4
    red ARCHER 2,0 hp=4
  `);
  chain.attack(chain.blue(), chain.at('1,0'));
  assert.equal(chain.unit(chain.blue()).q, 1, 'ordinary kill: the chain carries on');

  const wall = setup(`
    blue HORSEMAN 0,0
    red SPEARMAN 1,0 hp=4
    red ARCHER 2,0 hp=4
  `);
  wall.attack(wall.blue(), wall.at('1,0'));
  const h = wall.unit(wall.blue());
  assert.equal(h.q + ',' + h.r, '0,0', 'killing a spearman gives no rout and no advance');
});
