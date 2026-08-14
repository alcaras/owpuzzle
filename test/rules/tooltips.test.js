// Ability text. A unit's panel has to name what the unit can actually do —
// a mechanic the engine implements but never mentions is invisible to the
// player, which is how DISARM went unnoticed on the shotelai.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { E } = require('../helpers');

const text = (type) => E.describeUnitAbilities(type).join(' | ').toLowerCase();

test('a shotelai says it disarms what it hits [AttackApplyEffectUnitTurns]', () => {
  const t = text('UNIT_SHOTELAI');
  assert.match(t, /disarm/, 'shotelai abilities: ' + t);
  assert.match(t, /2 turns?/, 'and for how long');
});

test('a dmt warrior says the same', () => {
  assert.match(text('UNIT_DMT_WARRIOR'), /disarm/);
});

test('an elephant says it panics its target, and disarms one it cannot shove [PANIC_NO_ESCAPE_EFFECTUNIT]', () => {
  const t = text('UNIT_AFRICAN_ELEPHANT');
  assert.match(t, /retreat|push|panic/, 'elephant abilities: ' + t);
  assert.match(t, /disarm/, 'the cornered case is the whole trick and must be stated');
});

test('ability names come from the game\'s own text [text-effectUnit.xml]', () => {
  assert.equal(E.effectName('EFFECTUNIT_DISARMED'), 'Disarmed');
  assert.equal(E.effectName('EFFECTUNIT_ROUT'), 'Rout');
  assert.equal(E.effectName('EFFECTUNIT_PANIC'), 'Panic');
});

test('ability descriptions use the game\'s own wording [text-helptext.xml]', () => {
  const rout = E.describeEffect('EFFECTUNIT_ROUT').join(' ');
  assert.match(rout, /attack again/, 'the game says "Can Rout (attack again) after defeating a Unit"');
  const zealot = E.describeEffect('EFFECTUNIT_ZEALOT').join(' ');
  assert.match(zealot, /cannot die/i, 'the game says "Unit cannot die with >1 HP"');
});

test('every unit in the editor roster can describe itself without throwing', () => {
  for (const type of Object.keys(E.DATA.units)) {
    assert.doesNotThrow(() => E.describeUnitAbilities(type), type);
  }
});

test('no ability line leaks a template placeholder or a nonsense percent', () => {
  for (const type of Object.keys(E.DATA.units)) {
    for (const line of E.describeUnitAbilities(type)) {
      assert.ok(!/[{}]/.test(line), `${type}: unfilled template — "${line}"`);
      assert.ok(!/\bat 1%/.test(line), `${type}: counter count rendered as a percent — "${line}"`);
    }
  }
});

test('the panel sticks to what matters in a fight', () => {
  // vision, harvesting and religion are real mechanics but say nothing about
  // the turn in front of you; listing them buries the line that does.
  const noise = /vision|harvest|religion|pillage|road|xp and promotion/i;
  for (const type of ['UNIT_AFRICAN_ELEPHANT', 'UNIT_PALTON_CAVALRY', 'UNIT_SPEARMAN']) {
    for (const line of E.describeUnitAbilities(type)) {
      assert.ok(!noise.test(line), `${type}: not a combat fact — "${line}"`);
    }
  }
});

test('a spearman reads as un-routable, in plain English', () => {
  assert.match(E.describeUnitAbilities('UNIT_SPEARMAN').join(' | '), /cannot be routed/i);
});

test('positional promotions describe themselves [aiHeightFromModifier and friends]', () => {
  assert.match(E.describeEffect('EFFECTUNIT_HIGHLANDER').join(' '), /\+25% fighting on hills/);
  assert.match(E.describeEffect('EFFECTUNIT_WARDEN').join(' '), /\+25% fighting on urban ground/);
  assert.match(E.describeEffect('EFFECTUNIT_PIERCE1').join(' '), /pierce attack/);
});
