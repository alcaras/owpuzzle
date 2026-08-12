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
