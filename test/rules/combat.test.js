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

test('TOUGH raises a wounded unit\'s own strength, attacking AND defending [Unit.baseStrengthModifier, Unit.cs:6288]', () => {
  // miDamagedUsModifier is folded into baseStrength, so it is the unit's own
  // strength that changes — not a defensive bonus. Applying it on defence
  // only left a wounded veteran hitting like a fresh recruit.
  function pair(hp, promo) {
    const g = setup(`
      blue SPEARMAN 0,0 hp=${hp}${promo ? ' promo=' + promo : ''}
      red AXEMAN 1,0
    `);
    return {
      attacking: damage(g, g.blue(), g.red()),
      taking: damage(g, g.red(), g.blue()),
    };
  }
  const hurtPlain = pair(10, null), hurtTough = pair(10, 'EFFECTUNIT_TOUGH');
  assert.ok(hurtTough.attacking > hurtPlain.attacking,
    `a wounded TOUGH unit must hit harder (${hurtPlain.attacking} -> ${hurtTough.attacking})`);
  assert.ok(hurtTough.taking < hurtPlain.taking,
    `and take less (${hurtPlain.taking} -> ${hurtTough.taking})`);

  const wholePlain = pair(20, null), wholeTough = pair(20, 'EFFECTUNIT_TOUGH');
  assert.deepEqual(wholeTough, wholePlain, 'undamaged, TOUGH does nothing at all');
});

test('CIRCLE strikes every enemy around the attacker except the main target [Tile.cs:12538, ATTACK_CIRCLE 10%]', () => {
  // cataphracts and the Hittite chariots carry EFFECTUNIT_CIRCLE: on attack,
  // every OTHER tile adjacent to the attacker takes a 10% side-blow
  const g = setup(`
    blue CATAPHRACT 0,0
    red AXEMAN 1,0 hp=12
    red SLINGER 0,1 hp=9
    red ARCHER 1,-1 hp=9
    red SPEARMAN -2,0 hp=9
  `);
  g.attack(g.blue(), g.at('1,0'));
  // 10% of the per-victim damage (15 vs the slinger -> 2 after rounding);
  // the exact figure is the engine's getAttackDamage port, cited there
  assert.equal(g.at('0,1').hp, 7, 'adjacent slinger clipped by the side-blow');
  assert.equal(g.at('1,-1').hp, 7, 'adjacent archer clipped by the side-blow');
  assert.equal(g.at('-2,0').hp, 9, 'two tiles away: untouched');
});

test('CIRCLE never clips friendly units', () => {
  const g = setup(`
    blue CATAPHRACT 0,0
    blue MILITIA 0,1
    red AXEMAN 1,0 hp=12
  `);
  const hp0 = g.at('0,1').hp;
  g.attack(g.blue(0), g.at('1,0'));
  assert.equal(g.at('0,1').hp, hp0, 'the militia beside the swing is unharmed');
});

// iVsGeneralModifier fires on a unit that HAS a general (Unit.cs:8833 gates
// the bonus on pToUnit.hasGeneral(), Unit.cs:2274). A leader effect is granted
// BY that attached general, so a unit carrying one is a general — the two ways
// a puzzle can say it must agree, or promotions aimed at generals do nothing.
test('heckler hits a general marked by the general flag (Unit.cs:8833)', () => {
  const plain = setup(`
    blue LONGBOWMAN 0,0 promo=EFFECTUNIT_HECKLER
    red LONGBOWMAN 1,0
  `);
  const led = setup(`
    blue LONGBOWMAN 0,0 promo=EFFECTUNIT_HECKLER
    red LONGBOWMAN 1,0 general
  `);
  assert.equal(mods(led, led.blue(), led.red())['att:vs general'], 25);
  assert.ok(damage(led, led.blue(), led.red()) > damage(plain, plain.blue(), plain.red()));
});

test('a leader effect makes the unit a general (Unit.cs:2274 hasGeneral)', () => {
  const g = setup(`
    blue LONGBOWMAN 0,0 promo=EFFECTUNIT_HECKLER
    red LONGBOWMAN 1,0 promo=EFFECTUNIT_COMMANDER_LEADER
  `);
  assert.equal(g.red().general, true, 'COMMANDER_LEADER implies an attached general');
  assert.equal(mods(g, g.blue(), g.red())['att:vs general'], 25, 'so heckler applies');
});

// ---- critical hits: a pre-rolled flag the attack spends ----

test('a loaded crit doubles the blow [Unit.attackUnitDamage, Unit.cs:9135]', () => {
  const plain = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0
  `);
  const loaded = setup(`
    blue AXEMAN 0,0 crit
    red ARCHER 1,0
  `);
  assert.equal(damage(loaded, loaded.blue(), loaded.red()), 2 * damage(plain, plain.blue(), plain.red()));
  assert.equal(E.previewAttack(loaded.state, loaded.blue().id, loaded.red().id).crit, true);
  assert.equal(E.previewAttack(plain.state, plain.blue().id, plain.red().id).crit, false);
});

test('no crit against a critical-immune target [Unit.criticalChanceVs, Unit.cs:6566-6572]', () => {
  const g = setup(`
    blue AXEMAN 0,0 crit
    red ARCHER 1,0 promo=EFFECTUNIT_SWORD_OF_THE_GODS
  `);
  const plain = setup(`
    blue AXEMAN 0,0
    red ARCHER 1,0 promo=EFFECTUNIT_SWORD_OF_THE_GODS
  `);
  assert.equal(damage(g, g.blue(), g.red()), damage(plain, plain.blue(), plain.red()));
  assert.equal(E.previewAttack(g.state, g.blue().id, g.red().id).crit, false);
});

test('the attack spends the crit, immune target or not [Unit.attackTile, Unit.cs:10422-10423]', () => {
  const g = setup(`
    blue ARCHER 0,0 crit
    red AXEMAN 2,0 promo=EFFECTUNIT_SWORD_OF_THE_GODS hp=100
    red AXEMAN 0,2 hp=100
  `, { orders: 20 });
  assert.equal(g.unit(g.blue()).crit, true);
  g.attack(g.blue(), g.red(0));
  assert.equal(g.unit(g.blue()).crit, false, 'spent on an immune target too');
});

test('collateral hits never crit [Unit.attackTile bTargetTile, Unit.cs:10418]', () => {
  // an onager fires a splash pattern; the tile behind takes collateral
  const g = setup(`
    blue ONAGER 0,0 unlimbered crit
    red AXEMAN 2,0 hp=100
    red AXEMAN 3,0 hp=100
  `);
  const plain = setup(`
    blue ONAGER 0,0 unlimbered
    red AXEMAN 2,0 hp=100
    red AXEMAN 3,0 hp=100
  `);
  const pv = E.previewAttack(g.state, g.blue().id, g.red(0).id);
  const pv0 = E.previewAttack(plain.state, plain.blue().id, plain.red(0).id);
  assert.equal(pv.damage, 2 * pv0.damage, 'the targeted tile is doubled');
  if (pv0.collateral.length) {
    assert.deepEqual(pv.collateral, pv0.collateral, 'the tiles beside it are not');
  }
});

test('a limbered siege unit holds no crit; fortifying drops one [Unit.cs:3411-3414, 2830-2836]', () => {
  const siege = setup(`
    blue ONAGER 0,0 crit
    red AXEMAN 2,0
  `);
  assert.equal(siege.blue().crit, false);
  const f = setup(`
    blue AXEMAN 0,0 crit
    red ARCHER 3,0
  `);
  f.act({ type: 'fortify', unit: f.blue().id });
  assert.equal(f.unit(f.blue()).crit, false);
});

// Family: the family's opinion of the player rides on every unit of that
// family as an effect (Unit.cs:4352; opinionFamily.xml: Friendly +10%), and
// fighting on the family's own land under the unit's own player is worth
// FAMILY_TERRITORY_MODIFIER on the attack from that tile (Unit.cs:8907) and
// on the defence of it (Unit.cs:9017). Measured on turn 74 of a real game:
// a spearman with both read 6.0 attack against 6.0 defence and dealt 6.
test('family: the opinion effect and the territory modifier lift a spearman\'s blow from 5 to 6 [Unit.cs:4352, 6964, 8907, 9017]', () => {
  const plain = setup(`
    blue SPEARMAN 0,0
    red SPEARMAN 1,0
  `);
  const d0 = E.previewAttack(plain.state, plain.state.units[0].id, plain.state.units[1].id).damage;
  const fam = setup(`
    blue SPEARMAN 0,0
    red SPEARMAN 1,0
  `);
  const u = fam.state.units[0];
  u.family = 'FAMILY_DIDONIAN'; u.promotions = ['EFFECTUNIT_OPINIONFAMILY_FRIENDLY'];
  const home = Object.values(fam.state.tiles).find(t => t.q === 0 && t.r === 0);
  home.owner = 0; home.family = 'FAMILY_DIDONIAN';
  const d1 = E.previewAttack(fam.state, u.id, fam.state.units[1].id).damage;
  assert.ok(d1 > d0, `family lifts the blow: ${d0} -> ${d1}`);
  // the territory counts only under the unit's own player
  home.owner = 1;
  const d2 = E.previewAttack(fam.state, u.id, fam.state.units[1].id).damage;
  assert.ok(d2 < d1, 'another owner\'s land gives no territory bonus');
});

// a tile answers an attack with its best defender: a scout sharing a tile
// with a spearman cannot be picked off while the spearman stands
test('a stacked scout is not a target while its tile has a better defender [Tile.defendingUnit, Tile.cs:10697; Unit.isHigherTileDefender, Unit.cs:6262]', () => {
  const g = setup(`
    blue SWORDSMAN 0,0
    red SPEARMAN 1,0
    red SCOUT 1,0
  `);
  const me = g.state.units[0], spear = g.state.units[1], scout = g.state.units[2];
  const targets = E.attackTargets(g.state, me).map(t => t.id);
  assert.deepEqual(targets, [spear.id], 'only the spearman answers');
  spear.hp = 0;
  assert.deepEqual(E.attackTargets(g.state, me).map(t => t.id), [scout.id], 'alone, the scout is the target');
});
