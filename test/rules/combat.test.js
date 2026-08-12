// Damage, modifiers, flanking, counterattacks, and the effects that change them.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, damage, mods, applied, E } = require('../helpers');

test('damage is 6 x attack strength / defend strength [Unit.getAttackDamage]', () => {
  const g = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const att = E.DATA.units.UNIT_AXEMAN.iStrength, def = E.DATA.units.UNIT_ARCHER.iStrength;
  assert.equal(damage(g, g.blue(), g.red()), Math.floor(6 * att / def));
});

test('damage does not depend on the target\'s current hp', () => {
  const full = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const hurt = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0 hp=3
  `);
  // capped by remaining hp on delivery, so compare the uncapped computation
  assert.ok(damage(hurt, hurt.blue(), hurt.red()) <= 3);
  assert.equal(
    Math.min(damage(full, full.blue(), full.red()), 3),
    damage(hurt, hurt.blue(), hurt.red()),
    'a wounded unit defends exactly as hard as a fresh one');
});

test('spears take +50% against mounted ATTACKERS IN MELEE [EFFECTUNIT_ANTIMOUNTED2 aiUnitTraitModifierMelee]', () => {
  // The anti-cavalry bonus lives in aiUnitTraitModifierMelee, and on defence
  // that field is gated on the attacker being melee (Unit.cs:9111). A horseman
  // riding onto the spears eats it; a palton shooting them does not.
  const charge = setup(`
    blue HORSEMAN 0,0
    red SPEARMAN 1,0
  `);
  assert.equal(mods(charge, charge.blue(), charge.red())['def:vs mounted'], 50);

  const shot = setup(`
    blue PALTON_CAVALRY 0,0
    red SPEARMAN 1,0
  `);
  assert.equal(mods(shot, shot.blue(), shot.red())['def:vs mounted'], undefined,
    'spears do not brace against arrows');
});

test('a flanked defender loses its counterattack [Unit.isFlankedBy]', () => {
  // The defender must be a MELEE unit: counterattacks come from iMeleeCounter,
  // which archers and slingers do not have, so a bowman never hits back
  // whether flanked or not.
  const solo = setup(`
    blue AXEMAN 0,0
    red SPEARMAN 1,0
  `);
  const hp0 = solo.unit(solo.blue()).hp;
  solo.attack(solo.blue(), solo.red());
  assert.ok(solo.unit(solo.blue()).hp < hp0, 'unflanked, a melee defender hits back');

  const g = setup(`
    blue AXEMAN 0,0
    blue MILITIA 2,0
    red SPEARMAN 1,0
  `);
  const before = g.unit(g.blue()).hp;
  g.attack(g.blue(), g.red());
  assert.equal(g.unit(g.blue()).hp, before, 'with an ally opposite, the counter is cancelled');
});

test('ranged defenders never counterattack in melee [iMeleeCounter]', () => {
  const g = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const hp0 = g.unit(g.blue()).hp;
  g.attack(g.blue(), g.red());
  assert.equal(g.unit(g.blue()).hp, hp0);
});

test('COMMANDER_LEADER flanking is an additive percent, not a doubling [iFlankingAttackModifier]', () => {
  const plain = setup(`
    blue PALTON_CAVALRY 0,0 promo=EFFECTUNIT_COMMANDER_LEADER
    red AXEMAN 1,0
  `);
  const flanked = setup(`
    blue PALTON_CAVALRY 0,0 promo=EFFECTUNIT_COMMANDER_LEADER
    blue MILITIA 2,0
    red AXEMAN 1,0
  `);
  const a = damage(plain, plain.blue(), plain.red());
  const b = damage(flanked, flanked.blue(), flanked.red());
  assert.ok(b > a, 'flanking must help');
  assert.equal(mods(flanked, flanked.blue(), flanked.red())['att:flanking'], 100);
});

test('a shotelai blow leaves the target disarmed, and disarmed targets take more [AttackApplyEffectUnitTurns]', () => {
  const g = setup(`
    blue SHOTELAI 0,0
    blue MACEMAN 1,-1
    red PIKEMAN 1,0
  `);
  const mace = g.blue(1);
  const before = damage(g, mace, g.red());
  g.attack(g.blue(0), g.red());
  assert.deepEqual(applied(g.unit(g.red())), ['EFFECTUNIT_DISARMED']);
  const after = damage(g, g.unit(mace), g.unit(g.red()));
  assert.ok(after > before, `disarm should raise incoming damage (${before} -> ${after})`);
  assert.equal(E.DATA.effects.EFFECTUNIT_DISARMED.iStrengthModifier, -20);
});

test('bLastStand caps lethal damage at hp-1 while hp > 1 [Unit.cs zealot]', () => {
  const g = setup(`
    blue SWORDSMAN 0,0
    red MILITIA 1,0 hp=4 promo=EFFECTUNIT_ZEALOT
  `);
  assert.equal(damage(g, g.blue(), g.red()), 3, 'a zealot always keeps one hit point');
  const nearly = setup(`
    blue SWORDSMAN 0,0
    red MILITIA 1,0 hp=1 promo=EFFECTUNIT_ZEALOT
  `);
  assert.equal(damage(nearly, nearly.blue(), nearly.red()), 1, 'at 1 hp the protection is gone');
});

test('melee across a river is halved once [iRiverAttackModifier]', () => {
  const dry = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const wet = setup(`
    tile 0,0 river=0
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const a = damage(dry, dry.blue(), dry.red()), b = damage(wet, wet.blue(), wet.red());
  assert.ok(b < a, `crossing a river should cost damage (${a} -> ${b})`);
});

test('melee across the shoreline takes ONE -50%, not two [Unit.cs:8748]', () => {
  // Applied twice it is -100% additive, which silently made every shore
  // assault worthless.
  const g = setup(`
    tile 0,0 TERRAIN_WATER
    blue BIREME 0,0
    red AXEMAN 1,0
  `);
  const m = mods(g, g.blue(), g.red());
  const shore = Object.keys(m).filter((k) => /shore|water/i.test(k));
  assert.equal(shore.length, 1, 'exactly one shoreline modifier: ' + JSON.stringify(m));
  assert.equal(m[shore[0]], E.DATA.globals.LAND_WATER_MODIFIER);
});

test('a melee trait bonus protects on defence only against MELEE attackers [Unit.cs:9111]', () => {
  // The maceman's anti-infantry bonus is gated on the ATTACKER being melee.
  // Reading the defender's own melee flag instead handed it out against
  // arrows as well, which is not what the game does.
  const vsMelee = setup(`
    blue AXEMAN 1,0
    red MACEMAN 0,0
  `);
  const vsRanged = setup(`
    blue ARCHER 1,0
    red MACEMAN 0,0
  `);
  assert.equal(mods(vsMelee, vsMelee.blue(), vsMelee.red())['def:vs infantry'], 25);
  assert.equal(mods(vsRanged, vsRanged.blue(), vsRanged.red())['def:vs infantry'], undefined,
    'no anti-infantry bonus against a bowman');
  assert.ok(damage(vsRanged, vsRanged.blue(), vsRanged.red()) > 0);
});

test('the anti-infantry bonus is keyed to the trait, not to melee alone [aiUnitTraitModifierMelee]', () => {
  const vsMountedMelee = setup(`
    blue HORSEMAN 1,0
    red MACEMAN 0,0
  `);
  assert.equal(mods(vsMountedMelee, vsMountedMelee.blue(), vsMountedMelee.red())['def:vs infantry'], undefined,
    'a horseman is melee but not infantry');
});

test('TOUGH gives a wounded defender extra strength [iDamagedUsModifier]', () => {
  const hurt = setup(`
    blue AXEMAN 1,0
    red SPEARMAN 0,0 hp=10 promo=EFFECTUNIT_TOUGH
  `);
  assert.equal(mods(hurt, hurt.blue(), hurt.red())['def:wounded'],
    E.DATA.effects.EFFECTUNIT_TOUGH.iDamagedUsModifier);
  const whole = setup(`
    blue AXEMAN 1,0
    red SPEARMAN 0,0 promo=EFFECTUNIT_TOUGH
  `);
  assert.equal(mods(whole, whole.blue(), whole.red())['def:wounded'], undefined,
    'unwounded, there is nothing to be tough about');
});
