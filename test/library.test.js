// The shipped library must stay well-formed. These are structural checks and
// run in milliseconds; the expensive "is the ceiling still right" pass lives
// in ceilings.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));

test('every puzzle loads through the engine', () => {
  for (const p of PUZZLES) {
    assert.doesNotThrow(() => E.loadPuzzle(p), p.id + ' failed to load');
  }
});

test('every unit type exists in the game data', () => {
  for (const p of PUZZLES) {
    for (const u of p.units) {
      assert.ok(E.DATA.units[u.type], `${p.id}: unknown unit ${u.type}`);
    }
  }
});

test('no two units share a tile, and every unit stands on a real tile', () => {
  for (const p of PUZZLES) {
    const s = E.loadPuzzle(p);
    const seen = new Set();
    for (const u of s.units) {
      const k = u.q + ',' + u.r;
      assert.ok(!seen.has(k), `${p.id}: two units on ${k}`);
      seen.add(k);
      assert.ok(E.tileAt(s, u.q, u.r), `${p.id}: unit off the board at ${k}`);
    }
  }
});

test('both sides are represented', () => {
  for (const p of PUZZLES) {
    assert.ok(p.units.some((u) => u.player === 0), p.id + ': no blue units');
    assert.ok(p.units.some((u) => u.player === 1), p.id + ': no red units');
  }
});

test('objectives are well-formed', () => {
  const KINDS = ['killAll', 'killList', 'killTarget', 'capture', 'maxKill'];
  for (const p of PUZZLES) {
    assert.ok(KINDS.includes(p.objective.kind), `${p.id}: unknown objective ${p.objective.kind}`);
    if (p.objective.kind === 'killList') {
      assert.ok(Array.isArray(p.objective.targets) && p.objective.targets.length,
        p.id + ': killList needs targets');
      for (const i of p.objective.targets) {
        assert.ok(p.units[i] && p.units[i].player === 1, `${p.id}: bad killList target ${i}`);
      }
    }
    if (p.objective.kind === 'capture') {
      assert.ok((p.tiles || []).some((t) => t.city === 1), p.id + ': capture needs an enemy city');
    }
  }
});

test('a maxKill ceiling is positive and not more than the red army is worth', () => {
  for (const p of PUZZLES) {
    if (p.objective.kind !== 'maxKill') continue;
    const total = p.units.filter((u) => u.player === 1)
      .reduce((a, u) => a + E.DATA.units[u.type].iStrength, 0);
    assert.ok(p.objective.count > 0, p.id + ': ceiling must be set before publishing');
    assert.ok(p.objective.count <= total,
      `${p.id}: ceiling ${p.objective.count} exceeds the ${total} on the board`);
  }
});

test('par fits inside the order pool it generates', () => {
  for (const p of PUZZLES) {
    assert.ok(p.orders > 0, p.id + ': par must be positive');
    assert.ok(p.orders <= E.poolOrders(p), p.id + ': par exceeds its own pool');
  }
});

test('ids are unique', () => {
  const seen = new Set();
  for (const p of PUZZLES) {
    assert.ok(!seen.has(p.id), 'duplicate id ' + p.id);
    seen.add(p.id);
  }
});
