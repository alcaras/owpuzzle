#!/usr/bin/env node
// Exact pool ceiling via macro-actions. A macro is (move to P), (move to P +
// attack T), or (attack T in place), applied through the real engine so ZOC,
// blocking, pierce alignment and push stay honest. ROUT chains are handled
// naturally: canAttack permits attacks while in the ROUT state and canMove
// blocks routed movement, so chain kills appear as consecutive attack-in-place
// macros from the advanced tile. The ONLY approximation is one voluntary move
// per unit per turn (Dijkstra-optimal costs + friendly pass-through make
// split moves pointless).
// Usage: node tools/macro_ceiling.js <puzzle-id> [pool]
'use strict';
var E = require('../web/engine.js');
var PUZZLES = require('../web/puzzles.js');

var id = process.argv[2];
var found = PUZZLES.find(function (x) { return x.id === id; });
if (!found) { console.error('unknown puzzle: ' + id); process.exit(1); }
var p = JSON.parse(JSON.stringify(found));
var POOL = parseInt(process.argv[3], 10) || (p.orders <= 5 ? 10 : p.orders <= 10 ? 15 : 20);
p.orders = POOL;
p.training = 300;
var init = E.loadPuzzle(p);

var bestStr = (p.objective && p.objective.count) || 0;
var bestOver = null;
var seen = {};
var explored = 0;

function hash(s) {
  return s.orders + '|' + s.units.map(function (u) {
    return [u.id, u.q, u.r, Math.max(0, u.hp), u.cooldown || '-', u.steps, u.march ? 'M' : ''].join(',');
  }).join(';') + '|' + (s.training || 0);
}

function macroSuccessors(s) {
  var out = [];
  s.units.forEach(function (u) {
    if (u.player !== 0 || u.hp <= 0) return;
    if (E.canAttack(s, u)) {
      E.attackTargets(s, u).forEach(function (t) {
        out.push([{ type: 'attack', unit: u.id, target: t.id }]);
      });
    }
    if (u.steps === 0 && E.canMove(s, u)) {
      var reach = E.reachableTiles(s, u);
      reach.forEach(function (rt) {
        if (rt.orders > s.orders) return;
        var mv = { type: 'move', unit: u.id, q: rt.q, r: rt.r };
        out.push([mv]); // move-only (clear a lane)
        var ns;
        try { ns = E.applyAction(s, mv); } catch (e) { return; }
        var nu = E.unitById(ns, u.id);
        if (nu && E.canAttack(ns, nu)) {
          E.attackTargets(ns, nu).forEach(function (t) {
            out.push([mv, { type: 'attack', unit: u.id, target: t.id }]);
          });
        }
      });
    }
  });
  return out;
}

(function rec(s) {
  explored++;
  var str = E.strKilledOf(s);
  if (str > bestStr) {
    bestStr = str;
    bestOver = s.units.filter(function (u) { return u.player === 1 && u.hp <= 0; })
      .map(function (u) { return E.nameOf(u); }).join(', ');
  }
  // Future-attack cap: each remaining attacker gives one attack — EXCEPT a
  // rout-capable one, which can chain a kill per order. If any live attacker
  // routs, only the orders cap is sound.
  var attackers = s.units.filter(function (u) {
    return u.player === 0 && u.hp > 0 && E.canAttack(s, u);
  });
  var anyRout = attackers.some(function (u) {
    return E.effectsOf(u).indexOf('EFFECTUNIT_ROUT') >= 0;
  });
  var live = s.units.filter(function (u) { return u.player === 1 && u.hp > 0; })
    .map(function (u) { return E.DATA.units[u.type].iStrength; })
    .sort(function (a, b) { return b - a; });
  var k = anyRout ? Math.min(live.length, s.orders)
                  : Math.min(live.length, attackers.length, s.orders);
  var bound = str;
  for (var i = 0; i < k; i++) bound += live[i];
  if (bound <= bestStr) return;
  macroSuccessors(s).forEach(function (macro) {
    var ns = s;
    try { for (var i = 0; i < macro.length; i++) ns = E.applyAction(ns, macro[i]); }
    catch (e) { return; }
    var h = hash(ns);
    if (seen[h]) return;
    seen[h] = true;
    rec(ns);
  });
})(init);

console.log('explored', explored, 'states, pool', POOL);
console.log(bestStr > ((p.objective && p.objective.count) || 0)
  ? '*** CEILING BEATEN: ' + bestStr + ' (killed: ' + bestOver + ') ***'
  : 'ceiling ' + ((p.objective && p.objective.count) || 0) + ' stands at pool ' + POOL);
