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

test('a draft survives the round trip to test play and back unchanged', () => {
  // The editor writes a draft, the player records the board it played, and the
  // editor compares the two at submit. The fingerprint has to be stable across
  // that trip or authors are told they changed a puzzle they did not touch.
  const draft = {
    orders: 4, radius: 3, training: 0,
    objective: { kind: 'killAll' },
    tiles: [{ q: 1, r: 0, height: 'HEIGHT_HILL' }, { q: 0, r: 1, vegetation: 'VEGETATION_TREES' }],
    units: [{ player: 0, type: 'UNIT_SWORDSMAN', q: 0, r: 0 },
            { player: 1, type: 'UNIT_ARCHER', q: 2, r: 0, hp: 4 }],
  };
  const before = E.puzzleHash(draft);
  // the player loads it (loadPuzzle may normalise the object in place)…
  E.loadPuzzle(JSON.parse(JSON.stringify(draft)), { play: true });
  E.loadPuzzle(draft, { play: true });
  assert.equal(E.puzzleHash(draft), before, 'playing a draft must not change its fingerprint');

  // …and the editor rebuilds it from autosave in a different order
  const restored = {
    training: 0, radius: 3, orders: 4,
    objective: { kind: 'killAll' },
    units: [draft.units[1], draft.units[0]],
    tiles: [draft.tiles[1], draft.tiles[0]],
  };
  assert.equal(E.puzzleHash(restored), before, 'order must not matter');
});

test('a long reference line survives the server replay [40+ order puzzles]', () => {
  // A big board's solution runs to dozens of actions; the replay guard must
  // not quietly report it unsolved just for being long.
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'server', 'index.js'), 'utf8');
  const m = /line\.length > (\d+)/.exec(src);
  assert.ok(m, 'replayLine should still guard the line length');
  assert.ok(Number(m[1]) >= 400,
    `the replay cap is ${m[1]} actions — a 40-order puzzle needs far more headroom`);
});

test('the editor lets an author declare a par as long as the puzzle needs', () => {
  const html = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'web', 'editor.html'), 'utf8');
  const m = /id="p-orders"[^>]*max="(\d+)"/.exec(html);
  assert.ok(m && Number(m[1]) >= 40, 'par input caps at ' + (m && m[1]));
});
