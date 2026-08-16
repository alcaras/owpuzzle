// "Damage taken" must mean damage taken THIS TURN.
//
// The result screen measured every blue unit's distance from iHPMax, so a board
// whose units are painted wounded billed the player for the author's scenery.
// Bottleneck starts its four blue units 46 HP below full; a line that actually
// took 6 damage reported "Damage taken: 52", and the number looked so wrong it
// was first mistaken for a ×10 scaling bug.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup } = require('./helpers.js');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));

const APP = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

// the result screen's own arithmetic, kept in one place so the test measures
// what the player is shown rather than a paraphrase of it
function damageTaken(state) {
  return state.units.filter((u) => u.player === 0).reduce((s, u) => {
    const start = u.hp0 != null ? u.hp0 : E.hpMax(u);
    return s + Math.max(0, start - Math.max(0, u.hp));
  }, 0);
}

test('hp0 records the HP a unit was painted with, not its maximum', () => {
  const g = setup(`
    blue SWORDSMAN 0,0 hp=4
    red ARCHER 2,0 hp=5
  `);
  const blue = g.blue();
  assert.equal(blue.hp0, 4, 'hp0 should be the painted hp');
  assert.notEqual(blue.hp0, E.hpMax(blue), 'the board is deliberately wounded');
});

test('a wounded army that is never hit has taken no damage', () => {
  // The whole bug in one assertion: these units start 16 HP down and nothing
  // touches them, so the turn cost the player nothing.
  const g = setup(`
    blue SWORDSMAN 0,0 hp=4
    blue ARCHER -1,0 hp=8
    red ARCHER 3,0 hp=5
  `);
  assert.equal(damageTaken(g.state), 0);

  const fromMax = g.state.units.filter((u) => u.player === 0)
    .reduce((s, u) => s + (E.hpMax(u) - Math.max(0, u.hp)), 0);
  assert.ok(fromMax >= 16,
    `the old formula should disagree loudly here, got ${fromMax} — otherwise this test proves nothing`);
});

test('damage taken counts the counter-attack, and only the counter-attack', () => {
  const g = setup(`
    blue SWORDSMAN 0,0 hp=10
    red SPEARMAN 1,0 hp=10
  `);
  const before = g.blue().hp;
  g.attack(g.blue(), g.red());
  const lost = before - g.unit(g.blue()).hp;
  assert.ok(lost > 0, 'the spearman should counter — otherwise this proves nothing');
  assert.equal(damageTaken(g.state), lost);
});

test('the result screen measures from hp0, not from full health', () => {
  // browser code, so a source check — the arithmetic itself is covered above
  assert.ok(/hp0 != null \? u\.hp0 : E\.hpMax\(u\)/.test(APP),
    'app.js should measure damage taken from the starting HP');
});

test('Bottleneck: the published board reports 6 damage taken, not 52', () => {
  const file = path.join(__dirname, 'fixtures', 'bottleneck-f75e15.json');
  if (!fs.existsSync(file)) return;              // fixture optional
  const sub = JSON.parse(fs.readFileSync(file, 'utf8'));
  let st = E.loadPuzzle(sub.puzzle, { play: true });
  for (const a of JSON.parse(sub.notes).line) st = E.applyAction(st, a);
  assert.equal(damageTaken(st), 6);
});
