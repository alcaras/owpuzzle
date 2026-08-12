// Test helpers: build a tiny board, ask the engine a question, assert the
// number the GAME says.
//
// Every rule test should name the file:line in the game's own source (or the
// XML field) that it encodes. A test with no citation is only a snapshot of
// what we currently believe, which is exactly how the bugs got in.
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));

// A board in three lines:
//   blue PALTON_CAVALRY 0,0
//   red  ARCHER 2,0 hp=6 general promo=EFFECTUNIT_ZEALOT
//   tile 1,0 HEIGHT_HILL TERRAIN_WATER VEGETATION_TREES river=2,3
function setup(spec, opts) {
  opts = opts || {};
  const units = [], tiles = [];
  for (const raw of spec.trim().split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const kind = parts.shift();
    // `tile 1,0 HEIGHT_HILL` puts the position first; `blue AXEMAN 0,0` puts
    // the unit type first
    const type = kind === 'tile' ? null : 'UNIT_' + parts.shift();
    const [q, r] = parts.shift().split(',').map(Number);
    if (kind === 'tile') {
      const t = { q, r };
      for (const p of parts) {
        if (p.startsWith('HEIGHT_')) t.height = p;
        else if (p.startsWith('TERRAIN_')) t.terrain = p;
        else if (p.startsWith('VEGETATION_')) t.vegetation = p;
        else if (p.startsWith('IMPROVEMENT_')) t.improvement = p;
        else if (p.startsWith('river=')) t.river = p.slice(6).split(',').map(Number);
        else if (p.startsWith('city=')) t.city = Number(p.slice(5));
        else throw new Error('unknown tile token: ' + p);
      }
      tiles.push(t);
    } else if (kind === 'blue' || kind === 'red') {
      const u = { player: kind === 'blue' ? 0 : 1, type, q, r };
      for (const p of parts) {
        if (p.startsWith('hp=')) u.hp = Number(p.slice(3));
        else if (p.startsWith('promo=')) u.promotions = p.slice(6).split(',');
        else if (p === 'general') u.general = true;
        else if (p.startsWith('fortify=')) u.fortifyTurns = Number(p.slice(8));
        else throw new Error('unknown unit token: ' + p);
      }
      units.push(u);
    } else throw new Error('unknown line: ' + line);
  }
  const puzzle = {
    id: 'test', name: 'test', brief: '', orders: opts.orders || 20,
    radius: opts.radius == null ? 3 : opts.radius,
    objective: opts.objective || { kind: 'maxKill', count: 999999 },
    tiles, units,
  };
  const g = { state: E.loadPuzzle(puzzle), puzzle };
  g.blue = (i) => g.state.units.filter((u) => u.player === 0)[i || 0];
  g.red = (i) => g.state.units.filter((u) => u.player === 1)[i || 0];
  g.at = (qr) => {
    const [q, r] = qr.split(',').map(Number);
    return g.state.units.find((u) => u.q === q && u.r === r && u.hp > 0);
  };
  g.act = (a) => { g.state = E.applyAction(g.state, a); return g.state.log[g.state.log.length - 1]; };
  g.move = (u, qr) => {
    const [q, r] = qr.split(',').map(Number);
    return g.act({ type: 'move', unit: u.id, q, r });
  };
  g.attack = (a, d) => g.act({ type: 'attack', unit: a.id, target: d.id });
  g.unit = (u) => E.unitById(g.state, u.id);
  return g;
}

// damage `att` would deal to `def` from where it stands (or from `fromQR`)
function damage(g, att, def, fromQR) {
  const from = fromQR
    ? { q: Number(fromQR.split(',')[0]), r: Number(fromQR.split(',')[1]) }
    : { q: att.q, r: att.r };
  return E.attackUnitDamage(g.state, att, from, def);
}

// the labelled modifier breakdown the game shows, as {label: pct}
function mods(g, att, def) {
  const a = [], d = [];
  E.attackStrength(g.state, att, { q: att.q, r: att.r }, { q: def.q, r: def.r }, def, a);
  E.defendStrength(g.state, def, { q: def.q, r: def.r }, att, d);
  const out = {};
  for (const m of a) out['att:' + m.label] = m.pct;
  for (const m of d) out['def:' + m.label] = m.pct;
  return out;
}

const canHit = (g, att, def) => E.attackTargets(g.state, att).some((t) => t.id === def.id);
const reach = (g, u) => E.reachableTiles(g.state, u).map((t) => t.q + ',' + t.r);
const reachCost = (g, u, qr) => {
  const t = E.reachableTiles(g.state, u).find((x) => x.q + ',' + x.r === qr);
  return t ? t.orders : null;
};
const applied = (u) => (u.applied || []).slice();

module.exports = { E, setup, damage, mods, canHit, reach, reachCost, applied };
