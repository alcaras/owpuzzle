// Runs the solver off the main thread so submissions never block the site.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const SOLVER = require(path.join(__dirname, '..', 'web', 'solver.js'));
const { puzzle, opts } = workerData;
let result;
try {
  result = SOLVER.solve(puzzle, opts || {});
  result.solution = result.best && result.best.met
    ? SOLVER.describeLine(puzzle, result.line) : null;
  delete result.line; delete result.winLines;
} catch (e) {
  result = { error: e.message };
}
parentPort.postMessage(result);
