// ILP line finder for a puzzle: plan the turn as a scheduled integer
// programme (tools/solverengine/), execute it with the engine, print the line.
//
//   node tools/ilp_fight.js <puzzle.json|submission.json|puzzle-id> [pool] [options]
//
//     --seconds N     solver budget per wave (default 30)
//     --k N           push prefixes planned in full (default 3; --nobranch: none)
//     --waves N       re-plan rounds (default 4)
//     --dump FILE     write the line as {strength, orders, line}
//     --verbose       per-blow execution log
//     SOLVER=cpsat    CP-SAT backend (needs python + ortools; default HiGHS)
//
// A FINDER, not a prover: the blow table keeps a handful of seats per
// (unit, target), so a line outside it is invisible. It complements the
// engine-exact searches (deploy_fight, verify2, compute_ceilings) by reaching
// long interleaved lines those cannot — f6ff55's 37-STR author line, which the
// fight search never executed, comes out of this in ~40s with CP-SAT.
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./solverengine/engine.js');
const { solvePosition } = require('./solverengine/solve.js');

function loadBoard(arg) {
  if (fs.existsSync(arg)) { const raw = JSON.parse(fs.readFileSync(arg, 'utf8')); return raw.puzzle || raw; }
  const P = require(path.join(__dirname, '..', 'web', 'puzzles.js')).find(p => p.id === arg);
  if (!P) throw new Error('no such file or puzzle id: ' + arg);
  return P;
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    if (!args[0]) { console.error('usage: node tools/ilp_fight.js <puzzle.json|puzzle-id> [pool] [--seconds N] [--k N] [--waves N] [--dump FILE]'); process.exit(2); }
    const P = loadBoard(args[0]);
    const pool = parseInt(args[1], 10) || P.orders;
    const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
    const opts = {
      seconds: +(opt('--seconds') || 30), verbose: args.includes('--verbose'), quiet: args.includes('--quiet'),
      branchK: +(opt('--k') || 3), branch: !args.includes('--nobranch'), waves: +(opt('--waves') || 0) || undefined,
      workers: +(opt('--workers') || 0) || undefined, twoPhaseAt: +(opt('--two-phase-at') || 0) || undefined,
      masterShare: +(opt('--master') || 0) || undefined, hint: !args.includes('--no-hint'), pareto: !args.includes('--no-pareto'),
    };
    const s0 = E.loadPuzzle({ ...P, orders: pool });
    const r = await solvePosition(s0, opts);
    console.log(`\nRESULT: ${r.str / 10} STR killed in ${r.orders}/${pool} orders, ${r.ms}ms (${r.label})` +
      (r.lostStr ? `, lost ${r.lostStr / 10} STR of our own` : ''));
    let chk = s0; for (const a of r.line) chk = E.applyAction(chk, a);
    if (E.strKilledOf(chk) !== r.str) console.log('REPLAY MISMATCH', E.strKilledOf(chk), r.str);
    const dump = opt('--dump');
    if (dump) { fs.writeFileSync(dump, JSON.stringify({ strength: r.str, orders: r.orders, line: r.line }, null, 1)); console.log('line -> ' + dump); }
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { loadBoard };
