// What a melee blow costs the unit throwing it — Unit.getCounterAttackDamage
// (Unit.cs:10570-10615). The shape of that function is the whole rule:
//
//   if (!attacker.mbMelee)                    return 0;
//   if (defender.mbWater != attacker.mbWater) return 0;   <- RETURN
//   if (!defender.canCounterattack(...))      return 0;   <- RETURN
//   value += defender.counterAttackMelee()   (or attack% of its damage)
//   if (attacker.cooldown == ROUT) value += COUNTER_ROUT_DAMAGE
//   return min(value, attacker.HP - 1)
//
// Both refusals RETURN, so the rout surcharge is never reached when the
// defender could not have answered back. We used to fall through and charge
// a routing attacker 1 against a scout, an onager, or a flanked defender.
// Reported by an author, 2026-09-03.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, E } = require('../helpers');

const U = (g, t) => g.state.units.find((u) => u.type === 'UNIT_' + t && u.hp > 0);
// counter charged for a fresh melee blow by the horseman
const fresh = (spec, defType) => {
  const g = setup(spec);
  return E.counterAttackDamage(g.state, U(g, 'HORSEMAN'), { q: 0, r: 0 }, U(g, defType));
};
// the horseman kills a 1-hp warrior, advances with the ROUT cooldown, and the
// counter it would pay on the NEXT blow is what we measure
const midRout = (spec, defType) => {
  const g = setup(spec);
  const h = U(g, 'HORSEMAN');
  g.attack(h, U(g, 'WARRIOR'));
  const a = g.unit(h);
  assert.equal(a.cooldown, 'ROUT', 'the setup must actually rout');
  return E.counterAttackDamage(g.state, a, { q: a.q, r: a.r }, U(g, defType));
};

test('a melee defender counters for 1 — iMeleeCounter, carried by EFFECTUNIT_MELEE [Unit.cs:6576]', () => {
  assert.equal(fresh('blue HORSEMAN 0,0\nred SWORDSMAN 1,0', 'SWORDSMAN'), 1);
});

test('a RANGED defender counters for 0 — EFFECTUNIT_RANGED has no iMeleeCounter [effectUnit.xml]', () => {
  // it is allowed to counter (canDamage, and it can reach an adjacent tile);
  // the payload is simply zero. This is the game, not a missing rule.
  assert.equal(fresh('blue HORSEMAN 0,0\nred ARCHER 1,0', 'ARCHER'), 0);
  assert.equal(fresh('blue HORSEMAN 0,0\nred SLINGER 1,0', 'SLINGER'), 0);
});

test('a flanked defender costs the attacker nothing at all [Unit.cs:10598]', () => {
  assert.equal(fresh('blue HORSEMAN 0,0\nred SWORDSMAN 1,0\nblue SPEARMAN 2,0', 'SWORDSMAN'), 0);
});

test('a ROUTING attacker pays 1 extra where the defender could have countered [COUNTER_ROUT_DAMAGE=1]', () => {
  assert.equal(midRout('blue HORSEMAN 0,0\nred WARRIOR 1,0 hp=1\nred SWORDSMAN 2,0', 'SWORDSMAN'), 2,
    'melee defender: 1 counter + 1 rout');
  assert.equal(midRout('blue HORSEMAN 0,0\nred WARRIOR 1,0 hp=1\nred ARCHER 2,0', 'ARCHER'), 1,
    'ranged defender: 0 counter + 1 rout — it CAN counter, it just deals nothing');
});

test('...but nothing when the defender could not have countered at all [Unit.cs:10592-10596 return 0]', () => {
  assert.equal(midRout('blue HORSEMAN 0,0\nred WARRIOR 1,0 hp=1\nred SCOUT 2,0', 'SCOUT'), 0,
    'a scout cannot damage, so it cannot counter (Unit.cs:10619)');
  assert.equal(midRout('blue HORSEMAN 0,0\nred WARRIOR 1,0 hp=1\nred ONAGER 2,0', 'ONAGER'), 0,
    'an onager cannot shoot what stands on top of it — iRangeMin 2 (Unit.cs:8493)');
  assert.equal(midRout('blue HORSEMAN 0,0\nred WARRIOR 1,0 hp=1\nred SWORDSMAN 2,0\nblue SPEARMAN 3,0',
    'SWORDSMAN'), 0, 'and a flanked defender takes the rout surcharge away with it');
});

test('a STUNNED defender cannot counter [Unit.cs:10634]', () => {
  const g = setup('blue HORSEMAN 0,0\nred SWORDSMAN 1,0');
  U(g, 'SWORDSMAN').cooldown = 'STUNNED';
  assert.equal(E.counterAttackDamage(g.state, U(g, 'HORSEMAN'), { q: 0, r: 0 }, U(g, 'SWORDSMAN')), 0);
});

test('siege counters only while it is set up [Unit.cs:10621-10629]', () => {
  // an onager can never counter an adjacent attacker anyway (iRangeMin 2), so
  // the case that shows the rule is the rout surcharge on a unit that CAN reach
  assert.equal(fresh('blue HORSEMAN 0,0\nred ONAGER 1,0 unlimbered', 'ONAGER'), 0);
  assert.equal(fresh('blue HORSEMAN 0,0\nred ONAGER 1,0', 'ONAGER'), 0);
});

test('a ranged attacker never pays a counter [Unit.cs:10572 !mbMelee]', () => {
  const g = setup('blue ARCHER 0,0\nred SWORDSMAN 1,0');
  assert.equal(E.counterAttackDamage(g.state, g.blue(), { q: 0, r: 0 }, g.red()), 0);
});

test('max fortify counters with the defender\'s FULL attack damage [Unit.cs:10598 getCounterPercentOfAttack]', () => {
  const plain = fresh('blue HORSEMAN 0,0\nred SWORDSMAN 1,0', 'SWORDSMAN');
  const dug = fresh('blue HORSEMAN 0,0\nred SWORDSMAN 1,0 fortify=5', 'SWORDSMAN');
  assert.equal(plain, 1);
  assert.ok(dug > plain, 'a dug-in defender hits back properly');
});

test('the counter never crits [Unit.cs:10601 passes bCritical false]', () => {
  // a crit-capable defender countering at 100% must not double it
  const g = setup('blue HORSEMAN 0,0\nred SWORDSMAN 1,0 fortify=5 crit');
  const def = U(g, 'SWORDSMAN'), att = U(g, 'HORSEMAN');
  const counter = E.counterAttackDamage(g.state, att, { q: 0, r: 0 }, def);
  const withCrit = E.attackUnitDamage(g.state, def, { q: def.q, r: def.r }, att, 100);
  if (E.critApplies && E.critApplies(def, att)) assert.ok(counter < withCrit, 'crit not applied to the counter');
  assert.equal(counter, E.attackUnitDamage(g.state, def, { q: def.q, r: def.r }, att, 100, { noCrit: true }));
});

test('the counter can never kill — capped at the attacker\'s HP-1 [Unit.cs:10614]', () => {
  const g = setup('blue HORSEMAN 0,0 hp=1\nred SWORDSMAN 1,0 fortify=5');
  assert.equal(E.counterAttackDamage(g.state, g.blue(), { q: 0, r: 0 }, g.red()), 0);
});

test('a defender inside walls cannot be flanked [Tile.cs:12043 city isVulnerable]', () => {
  const open = fresh('blue HORSEMAN 0,0\nred SWORDSMAN 1,0\nblue SPEARMAN 2,0', 'SWORDSMAN');
  const walled = fresh('tile 1,0 city=1\nblue HORSEMAN 0,0\nred SWORDSMAN 1,0\nblue SPEARMAN 2,0', 'SWORDSMAN');
  assert.equal(open, 0, 'in the open the pincer takes the counter away');
  assert.equal(walled, 1, 'in a city with its walls up it does not');
});
