// Stealth: scouts hide in trees/jungle, and a hidden unit is not there as far
// as a panic shove is concerned — the game tests push destinations with
// TeamType.NONE (Unit.getPushTile, Unit.cs:10082), and Tile.canUnitOccupy
// skips units isHiddenFrom that team (Tile.cs:10514). The vision system
// itself stays out of scope (the whole board is visible in a puzzle); these
// tests cover only the places the GAME resolves hidden-ness without fog.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, mods, E } = require('../helpers');

test('a hidden scout does not block the shove — the pushed unit lands on it and the scout is bounced aside [Tile.cs:10514, Unit.cs:10082]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_TREES
    blue AFRICAN_ELEPHANT 0,0
    blue SCOUT 2,0
    red SWORDSMAN 1,0
  `);
  const scout = g.blue(1);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '2,0', 'shoved straight back, through the hidden scout');
  const s = g.unit(scout);
  assert.ok(s.hp > 0, 'the scout survives');
  assert.notEqual(s.q + ',' + s.r, '2,0', 'and is bounced off its tile');
  assert.equal(E.hexDistance(s, { q: 2, r: 0 }), 1, 'to an adjacent tile (Unit.cs:8181, Game.cs:10208)');
});

test('a scout in the open blocks the shove like any other unit [Tile.cs:10525 canBothUnitsOccupy]', () => {
  const g = setup(`
    blue AFRICAN_ELEPHANT 0,0
    blue SCOUT 2,0
    red SWORDSMAN 1,0
  `);
  const scout = g.blue(1);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.notEqual(d.q + ',' + d.r, '2,0', 'straight back is occupied by a visible unit');
  assert.notEqual(d.q + ',' + d.r, '1,0', 'but there was room on the diagonals');
  assert.equal(g.unit(scout).q + ',' + g.unit(scout).r, '2,0', 'the scout has not moved');
});

test('jungle hides a scout too [effectUnit.xml EFFECTUNIT_STEALTH abHideTerrainTarget]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_JUNGLE
    blue AFRICAN_ELEPHANT 0,0
    blue SCOUT 2,0
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.equal(d.q + ',' + d.r, '2,0');
});

// Scouts cannot attack at all (no bMelee, no range — unit.xml), so the
// "visible for a turn after attacking" clause is exercised by the OTHER
// stealth carrier: a ranged unit under a Tactician leader
// (EFFECTUNIT_TACTICIAN_RANGED, effectUnit.xml:1240-1255).
test('a hidden tactician archer stops hiding once it attacks [hasVisibleAttackCooldown, Unit.cs:3941 via Unit.cs:3503]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_TREES
    blue AFRICAN_ELEPHANT 0,0
    blue ARCHER 2,0 promo=EFFECTUNIT_TACTICIAN_RANGED
    red SWORDSMAN 1,0
    red MILITIA 4,0
  `);
  const archer = g.blue(1);
  g.attack(archer, g.red(1)); // the shot gives it away
  g.attack(g.blue(0), g.red(0));
  const d = g.unit(g.red(0));
  assert.notEqual(d.q + ',' + d.r, '2,0', 'the revealed archer blocks the shove');
  assert.equal(g.unit(archer).q + ',' + g.unit(archer).r, '2,0');
});

test('before it attacks, that same tactician archer hides like a scout [EFFECTUNIT_TACTICIAN_RANGED abHideTerrainTarget]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_TREES
    blue AFRICAN_ELEPHANT 0,0
    blue ARCHER 2,0 promo=EFFECTUNIT_TACTICIAN_RANGED
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  assert.equal(g.unit(g.red()).q + ',' + g.unit(g.red()).r, '2,0');
});

test('a scout in trees on enemy territory is not hidden [Unit.cs:3535-3541]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_TREES own=1
    blue AFRICAN_ELEPHANT 0,0
    blue SCOUT 2,0
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.notEqual(d.q + ',' + d.r, '2,0', 'hostile territory offers no cover');
});

test('trees hide only stealth units — a militia in trees still blocks [unit.xml:257 gives STEALTH to the scout]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_TREES
    blue AFRICAN_ELEPHANT 0,0
    blue MILITIA 2,0
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  const d = g.unit(g.red());
  assert.notEqual(d.q + ',' + d.r, '2,0');
});

test('a bounced scout prefers an adjacent tile where it stays hidden [Game.cs:10317 pRequiresHidden]', () => {
  const g = setup(`
    tile 2,0 VEGETATION_TREES
    tile 3,0 VEGETATION_TREES
    blue AFRICAN_ELEPHANT 0,0
    blue SCOUT 2,0
    red SWORDSMAN 1,0
  `);
  const scout = g.blue(1);
  g.attack(g.blue(0), g.red());
  assert.equal(g.unit(g.red()).q + ',' + g.unit(g.red()).r, '2,0');
  const s = g.unit(scout);
  assert.equal(s.q + ',' + s.r, '3,0', 'into the next stand of trees, not the open');
});

test('attacking from hiding carries an ambush bonus [HIDDEN_ATTACK_MODIFIER, Unit.cs:8843-8846]', () => {
  const inTrees = setup(`
    tile 0,0 VEGETATION_TREES
    blue ARCHER 0,0 promo=EFFECTUNIT_TACTICIAN_RANGED
    red SWORDSMAN 1,0
  `);
  const m = mods(inTrees, inTrees.blue(), inTrees.red());
  assert.equal(m['att:attacking from hiding'], E.DATA.globals.HIDDEN_ATTACK_MODIFIER);
  assert.equal(E.DATA.globals.HIDDEN_ATTACK_MODIFIER, 10);

  const open = setup(`
    blue ARCHER 0,0 promo=EFFECTUNIT_TACTICIAN_RANGED
    red SWORDSMAN 1,0
  `);
  assert.equal(mods(open, open.blue(), open.red())['att:attacking from hiding'], undefined);
});
