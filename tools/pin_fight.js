// The fight-execution experiment: pin a known-good line's attack seats as
// a deployment and let the EXACT fight machinery try to cash out the
// line's value. Answers "is the remaining gap deployment-ordering or
// fight-execution?" — if the fight cannot execute the value even given
// the perfect seats, ordering work upstream is moot.
//
// usage: node tools/pin_fight.js <puzzle.json|id> <pool> <line.json|authorSolution> [seconds=1800]
'use strict';
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const V = require(path.join(__dirname, 'verify2.js'));

const SRC = process.argv[2], POOL = parseInt(process.argv[3], 10);
const LSRC = process.argv[4];
const SECONDS = parseInt(process.argv[5], 10) || 1800;
if (!SRC || !POOL || !LSRC) {
  console.error('usage: node tools/pin_fight.js <puzzle.json|id> <pool> <line.json|authorSolution> [seconds]');
  process.exit(1);
}
const P = /\.json$/.test(SRC)
  ? (JSON.parse(fs.readFileSync(SRC, 'utf8')).puzzle || JSON.parse(fs.readFileSync(SRC, 'utf8')))
  : require(path.join(__dirname, '..', 'web', 'puzzles.js')).filter(x => x.id === SRC)[0];
const lineJ = LSRC === 'authorSolution'
  ? JSON.parse(fs.readFileSync(SRC, 'utf8')).authorSolution
  : JSON.parse(fs.readFileSync(LSRC, 'utf8'));
const line = lineJ.line || lineJ;

const ctx = V.build(P, POOL);
const key = (q, r) => q + ',' + r;

// seats = each unit's first-attack pre-tile; the line's own value is the bar
let s = E.loadPuzzle(ctx.base);
const seat = {};
for (const a of line) {
  if (a.type === 'attack' && seat[a.unit] === undefined) {
    const u = E.unitById(s, a.unit);
    if (u) seat[a.unit] = key(u.q, u.r);
  }
  s = E.applyAction(s, a);
}
const barStr = E.strKilledOf(s), barOrd = ctx.POOL - s.orders;
console.log('line replays to ' + (barStr / 10) + ' STR in ' + barOrd + ' orders — the bar');

const placement = {};
for (const b of ctx.BLUE) {
  placement[b.id] = seat[b.id] !== undefined ? seat[b.id] : key(b.q, b.r);
}

const inc = V.mkIncumbent(0);
V.stage3(ctx, inc, Date.now() + SECONDS * 1000,
  { pinned: placement, masks: null, expressive: true });
console.log('\nverdict: fight machinery ' +
  (inc.str >= barStr ? 'CASHES OUT the line (' + (inc.str / 10) + '/' + inc.orders + ')'
    : 'falls SHORT: ' + (inc.str / 10) + ' STR vs the line\'s ' + (barStr / 10) +
      ' — the wall is FIGHT EXECUTION, not deployment ordering'));
