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

// A board says "the ruler is aboard" with a trait's LeaderEffectUnit
// (EFFECTUNIT_COMMANDER_LEADER etc., trait.xml) — those effects exist only
// when the general is the ruler (Character.cs:10608-10616), and the ruler's
// unit also gets LEADER_GENERAL_EFFECTUNIT (Character.cs:6508). The engine
// attaches it, so the unit is panic-immune and a step faster.
test('a *_LEADER effect implies the ruler: EFFECTUNIT_LEADER_GENERAL is attached, +1 move and panic-immune [Character.cs:6508, 10613; trait.xml LeaderEffectUnit]', () => {
  const g = setup(`
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0 promo=EFFECTUNIT_COMMANDER_LEADER
    red SWORDSMAN 3,0
  `);
  assert.equal(E.DATA.characterTraits.TRAIT_COMMANDER_ARCHETYPE.leader, 'EFFECTUNIT_COMMANDER_LEADER');
  const [ruler, plain] = g.state.units.filter(u => u.player === 1);
  assert.ok(E.effectsOf(ruler).includes('EFFECTUNIT_LEADER_GENERAL'));
  assert.ok(!E.effectsOf(plain).includes('EFFECTUNIT_LEADER_GENERAL'));
  assert.equal(E.movementPoints(ruler), E.movementPoints(plain) + E.DATA.globals.MOVEMENT_MULTIPLER);
  // a general who is NOT the ruler lends the plain general effect and nothing else
  const g2 = setup(`
    blue AFRICAN_ELEPHANT 0,0
    red SWORDSMAN 1,0 promo=EFFECTUNIT_COMMANDER
  `);
  assert.ok(!E.effectsOf(g2.unit(g2.red())).includes('EFFECTUNIT_LEADER_GENERAL'));
  g2.attack(g2.blue(), g2.red());
  assert.equal(g2.unit(g2.red()).q, 2, 'shoved');
  g.attack(g.blue(), g.red());
  assert.equal(g.unit(g.red()).q, 1, 'the ruler stays put');
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

// Unit.hasStun (Unit.cs:7069): a bStun effect — EFFECTUNIT_TACTICIAN_LEADER,
// a Tactician ruler aboard — stuns whatever it hits and leaves alive
// (Unit.cs:9660-9665, STUNNED_COOLDOWN). A stunned unit cannot counterattack
// (canCounterattack, Unit.cs:10634), so everyone who hits it next this turn
// hits it for free. A ruler-led unit is immune (EFFECTUNIT_LEADER_GENERAL).
test('a Tactician ruler stuns what he hits; a stunned unit does not counter [Unit.cs:7069, 9664, 10634; effectUnit.xml bStun]', () => {
  assert.equal(E.DATA.effects.EFFECTUNIT_TACTICIAN_LEADER.bStun, 1);
  const g = setup(`
    blue SWORDSMAN 0,0 promo=EFFECTUNIT_TACTICIAN_LEADER
    blue SWORDSMAN 0,1
    red SWORDSMAN 1,0
  `);
  g.attack(g.blue(0), g.red());
  assert.ok(g.unit(g.blue(0)).hp < E.hpMax(g.blue(0)), 'the stunning blow itself still eats the counter');
  assert.equal(g.unit(g.red()).cooldown, 'STUNNED');
  const before = g.unit(g.blue(1)).hp;
  g.attack(g.blue(1), g.red());
  assert.equal(g.unit(g.blue(1)).hp, before, 'the next attacker takes no counter');
  // a plain (non-ruler) tactician general does not stun
  const g2 = setup(`
    blue SWORDSMAN 0,0 promo=EFFECTUNIT_TACTICIAN
    red SWORDSMAN 1,0
  `);
  g2.attack(g2.blue(), g2.red());
  assert.equal(g2.unit(g2.red()).cooldown, null);
  // another ruler's unit is immune
  const g3 = setup(`
    blue SWORDSMAN 0,0 promo=EFFECTUNIT_TACTICIAN_LEADER
    red SWORDSMAN 1,0 promo=EFFECTUNIT_COMMANDER_LEADER
  `);
  g3.attack(g3.blue(), g3.red());
  assert.equal(g3.unit(g3.red()).cooldown, null);
  // and city walls protect (isVulnerable, City.cs:2351)
  const g4 = setup(`
    tile 1,0 city=1
    blue SWORDSMAN 0,0 promo=EFFECTUNIT_TACTICIAN_LEADER
    red SWORDSMAN 1,0
  `);
  g4.attack(g4.blue(), g4.red());
  assert.equal(g4.unit(g4.red()).cooldown, null);
});
