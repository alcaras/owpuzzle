#!/usr/bin/env node
// Exact maxKill ceilings under PLAY conditions (full order pool + training):
// the ceiling is what a player can actually destroy this turn, so the
// "MAXIMUM DESTRUCTION" message can never be beaten.
//
//   Phase 1  branch-and-bound over the play pool -> max base strength killable.
//            Bound: current + the top-K living red strengths, K = orders left
//            (each kill costs >=1 order).
//   Phase 2  iterative deepening on order budget -> min orders achieving the
//            ceiling (this becomes par), plus distinct-outcome count there.
//   The pool depends on par (bucket 10/15/20), so iterate to a fixed point.
//
// Usage: node tools/compute_ceilings.js [id ...]
'use strict';
var E = require('../web/engine.js');
var SOLVER = require('../web/solver.js');
var PUZZLES = require('../web/puzzles.js');

var DEFAULT = PUZZLES.filter(function (p) { return p.objective.kind === 'maxKill'; })
  .map(function (p) { return p.id; });
var ids = process.argv.slice(2).filter(function (a) { return !a.startsWith('--'); });
if (!ids.length) ids = DEFAULT;

var MAX_STATES = 30000000;
var MAX_MS = 45 * 60 * 1000;

function bucket(par) { return par <= 5 ? 10 : par <= 10 ? 15 : 20; }

function liveRedStrengths(s) {
  return s.units.filter(function (u) { return u.player === 1 && u.hp > 0; })
    .map(function (u) { return E.DATA.units[u.type].iStrength; })
    .sort(function (a, b) { return b - a; });
}

function analyze(p, pool, t0) {
  var probe = JSON.parse(JSON.stringify(p));
  probe.orders = pool;
  probe.training = Math.max(p.training || 0, 300);
  var init = E.loadPuzzle(probe);
  var truncated = false, explored = 0;

  // Phase 1: max strength killable within the pool.
  var bestStr = 0;
  var seen1 = {};
  (function rec(s) {
    if (truncated) return;
    if (explored++ > MAX_STATES || Date.now() - t0 > MAX_MS) { truncated = true; return; }
    var str = E.strKilledOf(s);
    if (str > bestStr) bestStr = str;
    var live = liveRedStrengths(s);
    var k = Math.min(live.length, s.orders);
    var bound = str;
    for (var i = 0; i < k; i++) bound += live[i];
    if (bound <= bestStr) return; // cannot EXCEED the best seen
    var acts = E.legalActions(s);
    for (var j = 0; j < acts.length; j++) {
      if (truncated) return;
      var ns;
      try { ns = E.applyAction(s, acts[j]); } catch (e) { continue; }
      var h = SOLVER.stateHash(ns);
      if (seen1[h]) continue;
      seen1[h] = true;
      rec(ns);
    }
  })(init);
  seen1 = null;

  // Phase 2: min orders to reach bestStr + outcome uniqueness there.
  var minOrders = -1, outcomes = {};
  for (var cap = 1; cap <= pool && minOrders < 0 && !truncated; cap++) {
    var seen2 = {};
    (function rec2(s) {
      if (truncated) return;
      if (explored++ > MAX_STATES || Date.now() - t0 > MAX_MS) { truncated = true; return; }
      var used = pool - s.orders;
      var str = E.strKilledOf(s);
      if (str >= bestStr) {
        minOrders = cap;
        var oh = used + '|' + s.units.map(function (u) {
          return u.id + ':' + Math.max(0, u.hp);
        }).join(',');
        outcomes[oh] = true;
        return;
      }
      if (used >= cap) return;
      var live = liveRedStrengths(s);
      var k = Math.min(live.length, cap - used);
      var bound = str;
      for (var i = 0; i < k; i++) bound += live[i];
      if (bound < bestStr) return;
      var acts = E.legalActions(s);
      for (var j = 0; j < acts.length; j++) {
        if (truncated) return;
        var ns;
        try { ns = E.applyAction(s, acts[j]); } catch (e) { continue; }
        var h = SOLVER.stateHash(ns);
        if (seen2[h]) continue;
        seen2[h] = true;
        rec2(ns);
      }
    })(init);
  }
  return { ceiling: bestStr, minOrders: minOrders, outcomes: Object.keys(outcomes).length,
    explored: explored, truncated: truncated };
}

ids.forEach(function (id) {
  var p = PUZZLES.find(function (x) { return x.id === id; });
  if (!p) { console.log('== ' + id + '  NOT FOUND'); return; }
  var t0 = Date.now();
  var pool = bucket(p.orders), res, iter = 0;
  for (;;) {
    res = analyze(p, pool, t0);
    var nb = bucket(res.minOrders > 0 ? res.minOrders : p.orders);
    if (nb === pool || res.truncated || ++iter > 3) break;
    pool = nb;
  }
  var total = p.units.filter(function (u) { return u.player === 1; })
    .reduce(function (a, u) { return a + E.DATA.units[u.type].iStrength; }, 0);
  console.log('== ' + p.name + ' (' + id + ')  currentCount=' + (p.objective.count || '?') +
    ' currentPar=' + p.orders);
  console.log('   pool=' + pool + '  ceiling=' + res.ceiling + ' of ' + total +
    '  minOrders(par)=' + res.minOrders + '  outcomesAtOptimum=' + res.outcomes +
    '  explored=' + res.explored +
    (res.truncated ? '  *** TRUNCATED — lower bound only ***' : '') +
    '  ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
});
