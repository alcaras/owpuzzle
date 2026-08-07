// Runs the solver off the main thread so submissions never block the site.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const SOLVER = require(path.join(__dirname, '..', 'web', 'solver.js'));
const { puzzle, opts } = workerData;
let result;
try {
  if (puzzle.objective && puzzle.objective.kind === 'maxKill') {
    // hidden ceiling = max total enemy STRENGTH destroyable; iterate the
    // distinct achievable strength sums from the top down
    const E2 = require(path.join(__dirname, '..', 'web', 'engine.js'));
    const strengths = puzzle.units.filter(u => u.player === 1)
      .map(u => E2.DATA.units[u.type].iStrength);
    let sums = new Set([0]);
    for (const st of strengths) for (const v of [...sums]) sums.add(v + st);
    const targets = [...sums].filter(v => v > 0).sort((a, b) => b - a);
    const probe = JSON.parse(JSON.stringify(puzzle));
    probe.orders = 12; // strict search pool for authoring
    let found = null;
    for (const k of targets) {
      probe.objective = { kind: 'maxKill', count: k };
      const r = SOLVER.solve(probe, opts || {});
      if (r.best && r.best.met) { found = { k, r }; break; }
    }
    if (!found) { result = { best: { met: false }, truncated: true }; }
    else {
      puzzle.objective.count = found.k;
      puzzle.orders = 12 - found.r.best.orders; // par = min orders for the ceiling
      result = found.r;
      result.ceiling = found.k;
      result.par = puzzle.orders;
      result.solution = SOLVER.describeLine(probe, result.line);
      delete result.line; delete result.winLines;
      parentPort.postMessage({ ...result, updatedPuzzle: puzzle });
      return;
    }
  }
  result = SOLVER.solve(puzzle, opts || {});
  result.solution = result.best && result.best.met
    ? SOLVER.describeLine(puzzle, result.line) : null;
  delete result.line; delete result.winLines;
} catch (e) {
  result = { error: e.message };
}
parentPort.postMessage(result);
