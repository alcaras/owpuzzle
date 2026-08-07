#!/usr/bin/env node
// Verify every puzzle with the solver: solvable, and report the best line +
// how many distinct winning lines exist (uniqueness).
var SOLVER = require('../web/solver.js');
var PUZZLES = require('../web/puzzles.js');

var failed = 0;
var FULL = process.argv.includes('--full');
PUZZLES.forEach(function (p) {
  if (p.slowVerify && !FULL) {
    console.log('== ' + p.name + ' (' + p.id + ')  SKIPPED (slowVerify; run with --full) — last offline verification: unique par-' + p.orders);
    return;
  }
  var t0 = Date.now();
  var res = SOLVER.solve(p, { maxStates: 500000 });
  var ms = Date.now() - t0;
  var ok = res.best && res.best.met;
  if (!ok) failed++;
  console.log('== ' + p.name + ' (' + p.id + ')  ' +
    (ok ? 'SOLVABLE' : '*** NOT SOLVABLE ***') +
    '  explored=' + res.explored + (res.truncated ? ' (TRUNCATED)' : '') +
    ' winningLines=' + res.winCount + '  ' + ms + 'ms');
  if (res.line && ok) {
    SOLVER.describeLine(p, res.line).forEach(function (step, i) {
      console.log('   ' + (i + 1) + '. ' + step);
    });
  }
});
process.exit(failed ? 1 : 0);
