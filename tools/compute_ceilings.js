#!/usr/bin/env node
// Exact maxKill ceilings for battlefield puzzles, in ONE exhaustive pass each:
// explore the full move tree at par orders and track
//   - ceiling: max total BASE strength of dead enemies (E.strKilledOf)
//   - minOrders: fewest orders that reach the ceiling
//   - outcomes: distinct terminal outcomes at (ceiling, minOrders) — uniqueness
// A truncated run is reported as such (its ceiling is only a lower bound).
// Usage: node tools/compute_ceilings.js [id ...]
'use strict';
var E = require('../web/engine.js');
var SOLVER = require('../web/solver.js');
var PUZZLES = require('../web/puzzles.js');

var DEFAULT = ['nestor-charge', 'the-shore-riders', 'the-wood-line',
  'the-jungle-road', 'the-crossed-lanes', 'down-the-avenue'];
var ids = process.argv.slice(2).filter(function (a) { return !a.startsWith('--'); });
if (!ids.length) ids = DEFAULT;

var MAX_STATES = 6000000;
var MAX_MS = 40 * 60 * 1000;

ids.forEach(function (id) {
  var p = PUZZLES.find(function (x) { return x.id === id; });
  if (!p) { console.log('== ' + id + '  NOT FOUND'); return; }
  var t0 = Date.now();
  var init = E.loadPuzzle(p);
  var seen = {}, explored = 0, truncated = false;
  var ceiling = -1, minOrders = Infinity, outcomes = {};

  function outcomeHash(s) {
    return (init.orders - s.orders) + '|' + s.units.map(function (u) {
      return u.id + ':' + Math.max(0, u.hp);
    }).join(',');
  }

  (function rec(s) {
    if (truncated) return;
    if (explored++ > MAX_STATES || Date.now() - t0 > MAX_MS) { truncated = true; return; }
    var str = E.strKilledOf(s);
    var used = init.orders - s.orders;
    if (str > ceiling) { ceiling = str; minOrders = used; outcomes = {}; }
    if (str === ceiling) {
      if (used < minOrders) { minOrders = used; outcomes = {}; }
      if (used === minOrders) outcomes[outcomeHash(s)] = true;
    }
    var acts = E.legalActions(s);
    for (var i = 0; i < acts.length; i++) {
      if (truncated) return;
      var ns;
      try { ns = E.applyAction(s, acts[i]); } catch (e) { continue; }
      var h = SOLVER.stateHash(ns);
      if (seen[h]) continue;
      seen[h] = true;
      rec(ns);
    }
  })(init);

  var reds = init.units.filter(function (u) { return u.player === 1; });
  var total = reds.reduce(function (a, u) { return a + E.DATA.units[u.type].iStrength; }, 0);
  console.log('== ' + p.name + ' (' + id + ')  oldPar=' + p.orders +
    '  oldObjective=' + JSON.stringify(p.objective));
  console.log('   ceiling=' + ceiling + ' of ' + total + ' total red str' +
    '  minOrders=' + minOrders +
    '  outcomesAtOptimum=' + Object.keys(outcomes).length +
    '  explored=' + explored + (truncated ? '  *** TRUNCATED (lower bound only) ***' : '') +
    '  ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
});
