#!/usr/bin/env node
// The design harness for a promotion-teaching puzzle.
//
// A teaching puzzle makes one promise: "you cannot do this without the
// promotion." That promise is checkable, and checking it is the whole job —
// on Bottleneck the horseman's three promotions turned out to be decoration
// (strip them, same 290, same five kills), which for a teaching puzzle would
// have been a lesson that was simply false.
//
// So this reports four things about a board:
//
//   MATRIX    every blue against every red from where it stands, with the
//             labelled modifiers, because damage is never what you remember
//   SOLVABLE  the objective is reachable at par
//   PAR TIGHT the objective is NOT reachable at par-1 (par is honest)
//   REQUIRED  the objective is NOT reachable — at the pool the player really
//             gets, NOT at par — once the taught promotion is stripped
//
// That distinction is not pedantry. Par is the tight number; play grants
// poolOrders (par+5, rounded up to a multiple of 5), so a par-2 board hands the
// player TEN orders. Two of these nine boards passed the required-ness check at
// par and failed it at the pool: one because the spare orders bought a rout
// chain, one because they bought a walk around the water. A lesson that is only
// true at par is not true.
//
// Usage:
//   node tools/promo_check.js drafts/<board>.js [--seconds=60]
// The board file exports the puzzle plus `teaches`: the promotion under test.
'use strict';
var path = require('path');
var E = require(path.join(__dirname, '..', 'web', 'engine.js'));
var SOLVER = require(path.join(__dirname, '..', 'web', 'solver.js'));

var args = process.argv.slice(2);
var file = args.filter(function (a) { return !a.startsWith('--'); })[0];
if (!file) { console.error('usage: node tools/promo_check.js <board.js> [--seconds=N]'); process.exit(2); }
var secArg = args.filter(function (a) { return a.startsWith('--seconds='); })[0];
var SECONDS = secArg ? Number(secArg.slice(10)) : 60;

var mod = require(path.resolve(file));
var P = mod.puzzle || mod;
var TEACHES = mod.teaches;

function nm(u) { return u.type.replace('UNIT_', '').toLowerCase() + '#' + u.id; }

function solve(puzzle, seconds) {
  return SOLVER.solve(puzzle, { maxStates: 4000000, maxMs: (seconds || SECONDS) * 1000 });
}

// ---------- the damage matrix ----------
function matrix(puzzle) {
  var s = E.loadPuzzle(puzzle);
  var blues = s.units.filter(function (u) { return u.player === 0 && u.hp > 0; });
  var reds = s.units.filter(function (u) { return u.player === 1 && u.hp > 0; });
  console.log('\n  DAMAGE MATRIX (from starting tiles; blank = cannot reach/see)');
  reds.forEach(function (r) {
    console.log('   vs ' + nm(r) + ' hp' + r.hp + ' @' + r.q + ',' + r.r);
    blues.forEach(function (b) {
      var reach = E.attackTargets(s, b).some(function (t) { return t.id === r.id; });
      var d = E.attackUnitDamage(s, b, { q: b.q, r: b.r }, r);
      var pv = E.previewAttack(s, b.id, r.id);
      var labels = [];
      E.attackStrength(s, b, { q: b.q, r: b.r }, { q: r.q, r: r.r }, r, labels);
      var mods = labels.filter(function (m) { return m.pct; })
        .map(function (m) { return m.label + ' ' + (m.pct > 0 ? '+' : '') + m.pct; }).join(', ');
      console.log('     ' + nm(b).padEnd(20) + (reach ? 'dmg ' + String(d).padStart(2) : ' (out of reach)') +
        (reach && pv.kills ? '  KILLS' : '') + (mods ? '   [' + mods + ']' : ''));
    });
  });
}

// ---------- strip the taught promotion ----------
function stripped(puzzle, promo) {
  var p = JSON.parse(JSON.stringify(puzzle));
  var hits = 0;
  p.units.forEach(function (u) {
    if (u.promotions && u.promotions.indexOf(promo) >= 0) {
      u.promotions = u.promotions.filter(function (x) { return x !== promo; });
      hits++;
    }
  });
  return { puzzle: p, hits: hits };
}

console.log('== ' + (P.name || P.id) + '   par ' + P.orders +
  '   objective ' + JSON.stringify(P.objective) + (TEACHES ? '\n   teaches ' + TEACHES : ''));
try { E.loadPuzzle(P); } catch (e) {
  console.log('   *** DOES NOT LOAD: ' + e.message); process.exit(1);
}
matrix(P);

console.log('\n  CHECKS');
var r1 = solve(P);
var ok1 = !!(r1.best && r1.best.met);
console.log('   solvable at par ' + P.orders + ': ' + (ok1 ? 'YES' : 'NO') +
  '  (states ' + r1.explored + (r1.truncated ? ', TRUNCATED' : '') + ')');
if (ok1) {
  SOLVER.describeLine(P, r1.line).forEach(function (l, i) { console.log('      ' + (i + 1) + '. ' + l); });
}

var tight = null;
if (P.orders > 1) {
  var t = JSON.parse(JSON.stringify(P)); t.orders = P.orders - 1;
  var r2 = solve(t, Math.max(20, SECONDS / 2));
  tight = !(r2.best && r2.best.met);
  console.log('   par is tight (unsolvable at ' + t.orders + '): ' + (tight ? 'YES' : 'NO — PAR OVERSTATED') +
    (r2.truncated ? '  [truncated: treat as unproven]' : ''));
}

var required = null;
// A board may neutralise its own idea instead: when the promotion sits on a RED
// unit it is the OBSTACLE, not the tool, and stripping it makes the puzzle
// easier rather than impossible. Such a board exports `neutralise(puzzle)` —
// wall off the key tile, swap the key unit for a vanilla one — and we assert
// the same thing either way: without the idea, par is out of reach.
var POOL = E.poolOrders(P);
if (mod.neutralise) {
  var probe = mod.neutralise(JSON.parse(JSON.stringify(P)));
  probe.orders = POOL;
  var rn = solve(probe, Math.max(20, SECONDS / 2));
  required = !(rn.best && rn.best.met);
  console.log('   idea REQUIRED at the play pool of ' + POOL + ' (' +
    (mod.neutraliseLabel || 'neutralised probe') + '): ' + (required ? 'YES' : 'NO — THE LESSON IS A LIE') +
    (rn.truncated ? '  [truncated: treat as unproven]' : ''));
  if (required === false) {
    console.log('      a line exists without the idea:');
    SOLVER.describeLine(probe, rn.line).forEach(function (l, i) { console.log('        ' + (i + 1) + '. ' + l); });
  }
} else if (TEACHES) {
  var st = stripped(P, TEACHES);
  if (!st.hits) {
    console.log('   *** ' + TEACHES + ' is not on any unit — nothing to strip');
  } else {
    st.puzzle.orders = POOL;
    var r3 = solve(st.puzzle, Math.max(20, SECONDS / 2));
    required = !(r3.best && r3.best.met);
    console.log('   promotion REQUIRED at the play pool of ' + POOL + ' (without ' +
      TEACHES.replace('EFFECTUNIT_', '') + '): ' + (required ? 'YES' : 'NO — THE LESSON IS A LIE') +
      (r3.truncated ? '  [truncated: treat as unproven]' : ''));
    if (required === false) {
      console.log('      a line exists without the promotion:');
      SOLVER.describeLine(st.puzzle, r3.line).forEach(function (l, i) { console.log('        ' + (i + 1) + '. ' + l); });
    }
  }
}

var verdict = ok1 && tight !== false && required !== false;
console.log('\n  => ' + (verdict ? 'GOOD' : 'NOT READY') +
  (ok1 ? '' : ' (unsolvable)') + (tight === false ? ' (par overstated)' : '') +
  (required === false ? ' (trick not required)' : ''));
process.exit(verdict ? 0 : 1);
