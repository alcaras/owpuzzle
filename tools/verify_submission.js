#!/usr/bin/env node
// Locally verify a snarfed community submission (tools/snarf.sh):
// solvable at par, distinct winning outcomes, best line, and whether par is
// actually the minimum (probes par-1). Approve/reject in the admin UI.
// Usage: node tools/verify_submission.js submissions/<slug>.json [more.json ...]
'use strict';
var fs = require('fs');
var SOLVER = require('../web/solver.js');
var E = require('../web/engine.js');

var files = process.argv.slice(2);
if (!files.length) {
  files = fs.existsSync('submissions')
    ? fs.readdirSync('submissions').filter(function (f) { return f.endsWith('.json'); })
        .map(function (f) { return 'submissions/' + f; })
    : [];
}
if (!files.length) { console.log('nothing to verify — run tools/snarf.sh first'); process.exit(0); }

files.forEach(function (file) {
  var wrap = JSON.parse(fs.readFileSync(file, 'utf8'));
  var p = wrap.puzzle || wrap;
  console.log('== ' + (p.name || p.id) + '  (' + file + ')  by ' + (wrap.author || p.author || '?') +
    '  par ' + p.orders + '  objective ' + JSON.stringify(p.objective));
  try { E.loadPuzzle(p); } catch (e) {
    console.log('   *** DOES NOT LOAD: ' + e.message + ' ***');
    return;
  }
  var t0 = Date.now();
  var res = SOLVER.solve(p, { maxStates: 2000000, maxMs: 300000 });
  var ok = res.best && res.best.met;
  console.log('   ' + (ok ? 'SOLVABLE' : '*** NOT SOLVABLE at par ***') +
    '  winCount=' + res.winCount + (res.winCount === 1 ? ' (unique)' : '') +
    '  explored=' + res.explored + (res.truncated ? ' TRUNCATED' : '') +
    '  ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (ok) {
    SOLVER.describeLine(p, res.line).forEach(function (s, i) {
      console.log('     ' + (i + 1) + '. ' + s);
    });
    // is par honest? a puzzle solvable at par-1 has its par overstated
    if (p.orders > 1) {
      var tighter = JSON.parse(JSON.stringify(p));
      tighter.orders = p.orders - 1;
      var r2 = SOLVER.solve(tighter, { maxStates: 1000000, maxMs: 120000 });
      if (r2.best && r2.best.met) {
        console.log('   *** PAR OVERSTATED: also solvable in ' + tighter.orders + ' orders ***');
      } else {
        console.log('   par is tight (not solvable in ' + tighter.orders + ')' + (r2.truncated ? ' [truncated]' : ''));
      }
    }
  }
});
