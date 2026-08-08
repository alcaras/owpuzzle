#!/usr/bin/env node
// Composition analysis for puzzles, borrowing chess-problem theory:
//  - the KEY (winning first action): is it "quiet" (not an attack)? how
//    counterintuitive is it (paradox rank = how many first actions deal more
//    immediate damage than it)?
//  - TRIES: the most tempting non-winning first actions, and how close their
//    best continuation gets (a good try fails by a small, visible margin).
// Usage: node tools/analyze_puzzle.js [--full] [puzzle-id ...]
'use strict';
var E = require('../web/engine.js');
var SOLVER = require('../web/solver.js');
var PUZZLES = require('../web/puzzles.js');

var FULL = process.argv.includes('--full');
var only = process.argv.slice(2).filter(function (a) { return !a.startsWith('--'); });

function redHp(s) {
  var t = 0;
  s.units.forEach(function (u) { if (u.player !== 0) t += Math.max(0, u.hp); });
  return t;
}

// Immediate damage an action deals right now — the "capture appeal" that a
// human pattern-matcher is drawn to.
function appeal(s, a) {
  var before = redHp(s);
  var ns;
  try { ns = E.applyAction(s, a); } catch (e) { return -1; }
  return before - redHp(ns);
}

function score(s, objective) {
  var met = E.checkObjective(s, objective) ? 1 : 0;
  var blueHp = 0, rHp = 0;
  s.units.forEach(function (u) {
    if (u.player === 0) blueHp += Math.max(0, u.hp); else rHp += Math.max(0, u.hp);
  });
  return { met: met, orders: s.orders, blueHp: blueHp, redHp: rHp };
}
function better(a, b) {
  if (a.met !== b.met) return a.met > b.met;
  if (a.redHp !== b.redHp) return a.redHp < b.redHp;
  if (a.blueHp !== b.blueHp) return a.blueHp > b.blueHp;
  if (a.orders !== b.orders) return a.orders > b.orders;
  return false;
}

// Best reachable outcome from a state (bounded DFS, same scoring as solver).
function bestFrom(state, objective, opts) {
  var maxStates = opts.maxStates || 150000;
  var deadline = Date.now() + (opts.maxMs || 15000);
  var seen = {}, best = null, explored = 0, stop = false, truncated = false;
  (function rec(s) {
    if (stop) return;
    if (explored++ > maxStates || Date.now() > deadline) { stop = truncated = true; return; }
    var sc = score(s, objective);
    if (best === null || better(sc, best)) best = sc;
    var acts = E.legalActions(s);
    for (var i = 0; i < acts.length; i++) {
      if (stop) return;
      var ns;
      try { ns = E.applyAction(s, acts[i]); } catch (e) { continue; }
      var h = SOLVER.stateHash(ns);
      if (seen[h]) continue;
      seen[h] = true;
      rec(ns);
    }
  })(state);
  return { best: best, truncated: truncated };
}

function actName(s, a) {
  var u = E.unitById(s, a.unit);
  var n = u ? E.nameOf(u) : a.unit;
  if (a.type === 'attack') {
    var t = E.unitById(s, a.target);
    return n + ' attacks ' + (t ? E.nameOf(t) : a.target);
  }
  if (a.type === 'move') return n + ' -> (' + a.q + ',' + a.r + ')';
  return n + ' ' + a.type;
}

PUZZLES.forEach(function (p) {
  if (only.length && !only.includes(p.id)) return;
  if (p.slowVerify && !FULL && !only.length) {
    console.log('== ' + p.name + ' (' + p.id + ')  SKIPPED (slowVerify)');
    return;
  }
  var t0 = Date.now();
  var res = SOLVER.solve(p, { maxStates: 500000, maxMs: 120000 });
  if (!res.best || !res.best.met) {
    console.log('== ' + p.name + ' (' + p.id + ')  *** NOT SOLVABLE ***');
    return;
  }
  var init = E.loadPuzzle(p);
  var acts = E.legalActions(init);

  // Winning first actions = first steps of the distinct par-winning lines.
  var winFirsts = {};
  (res.winLines.length ? res.winLines : [res.line]).forEach(function (l) {
    if (l && l.length) winFirsts[JSON.stringify(l[0])] = l[0];
  });
  var winKeys = Object.keys(winFirsts).map(function (k) { return winFirsts[k]; });

  // Appeal of every legal first action.
  var rows = acts.map(function (a) { return { a: a, appeal: appeal(init, a) }; });
  var keyAppeal = Math.max.apply(null, winKeys.map(function (a) {
    var r = rows.find(function (x) { return JSON.stringify(x.a) === JSON.stringify(a); });
    return r ? r.appeal : 0;
  }));
  var louder = rows.filter(function (r) {
    return r.appeal > keyAppeal &&
      !winKeys.some(function (w) { return JSON.stringify(w) === JSON.stringify(r.a); });
  });
  var quiet = winKeys.every(function (a) { return a.type !== 'attack'; });

  console.log('== ' + p.name + ' (' + p.id + ')  d' + p.difficulty + ' par' + p.orders);
  console.log('   key(s): ' + winKeys.map(function (a) { return actName(init, a); }).join(' | ') +
    (quiet ? '   [QUIET KEY]' : '') +
    '   paradoxRank=' + (louder.length + 1) +
    ' (' + louder.length + ' louder first actions)');

  // Tries: the loudest non-winning attacks — how close do they get?
  louder.sort(function (a, b) { return b.appeal - a.appeal; });
  louder.slice(0, 3).forEach(function (r) {
    var ns = E.applyAction(init, r.a);
    var b = bestFrom(ns, p.objective, { maxStates: 150000, maxMs: 15000 });
    var out;
    if (!b.best) out = 'no outcome';
    else if (!b.best.met) out = 'FAILS within par orders (best redHp left ' + b.best.redHp + ')';
    else out = 'STILL REACHES PAR — not a refuted try';
    console.log('   try: ' + actName(init, r.a) + ' (dmg ' + r.appeal + ') -> ' + out +
      (b.truncated ? ' [truncated]' : ''));
  });
  console.log('   (' + ((Date.now() - t0) / 1000).toFixed(1) + 's, ' + acts.length + ' first actions)');
});
