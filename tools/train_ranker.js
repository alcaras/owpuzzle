// Train a seat-ranking scorer on rank_eval feature dumps — the learned
// half of the learned-ordering programme. Dependency-free logistic
// regression (the whole test suite is dependency-free; the ranker stays
// that way): predicts P(seat is in the known-good line) from the same
// features the hand heuristic sees, so it competes on even ground.
//
// The model is ORDERING ONLY. It may never touch a bound or a verdict —
// a bad model costs search time, never correctness.
//
// usage: node tools/train_ranker.js <features.json> <out-weights.json>
//   Evaluation is leave-one-board-out: for each board, train on the
//   others and report the held-out board's rank-sum under the learned
//   scorer vs the hand heuristic. The final weights train on everything.
//   Load the result in rank_eval via --scorer tools/ranker_scorer.js
//   (reads weights from RANKER_WEIGHTS, default the path written here).
'use strict';
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3] || 'bench/ranker-weights.json';

const FEATS = ['orders', 'march', 'deferred', 'essential', 'rout', 'adjRed', 'own0', 'ownOpt',
  'nTargets', 'dmgShare', 'killPot', 'adjRedN', 'melee', 'flanker', 'colGun', 'travelFrac'];
// heurScore is deliberately excluded: the learned model must not lean on
// the very heuristic it is trying to replace, or the comparison is moot.

// per-feature standardization (fit on train only)
function fitScale(data) {
  const mu = {}, sd = {};
  for (const f of FEATS) {
    let s = 0;
    for (const r of data) s += r[f];
    mu[f] = s / data.length;
    let v = 0;
    for (const r of data) v += (r[f] - mu[f]) ** 2;
    sd[f] = Math.sqrt(v / data.length) || 1;
  }
  return { mu, sd };
}
const x = (r, sc) => FEATS.map(f => (r[f] - sc.mu[f]) / sc.sd[f]);

function train(data, sc, epochs, lr, l2) {
  const w = new Array(FEATS.length).fill(0);
  let b = 0;
  const nPos = data.filter(r => r.inLine).length;
  const posW = (data.length - nPos) / Math.max(1, nPos);   // class balance
  for (let e = 0; e < epochs; e++) {
    for (const r of data) {
      const xi = x(r, sc);
      let z = b;
      for (let i = 0; i < xi.length; i++) z += w[i] * xi[i];
      const p = 1 / (1 + Math.exp(-z));
      const g = (r.inLine ? posW : 1) * ((r.inLine ? 1 : 0) - p);
      for (let i = 0; i < xi.length; i++) w[i] += lr * (g * xi[i] - l2 * w[i]);
      b += lr * g;
    }
  }
  return { w, b };
}

function rankSums(data, score) {
  // group by (board, unit); rank of the inLine seat under `score` desc
  const groups = {};
  for (const r of data) (groups[r.board + '|' + r.unit] = groups[r.board + '|' + r.unit] || []).push(r);
  let sum = 0, units = 0;
  for (const k of Object.keys(groups)) {
    const g = groups[k];
    const target = g.find(r => r.inLine);
    if (!target) continue;
    const s0 = score(target);
    let rank = 0;
    for (const r of g) if (r !== target && score(r) > s0) rank++;
    sum += rank; units++;
  }
  return { sum, units };
}

const boards = [...new Set(rows.map(r => r.board))];
console.log(`${rows.length} rows, ${rows.filter(r => r.inLine).length} positives, ${boards.length} boards`);
console.log('\nleave-one-board-out (held-out rank-sums, lower is better):');
for (const hold of boards) {
  const tr = rows.filter(r => r.board !== hold);
  const te = rows.filter(r => r.board === hold);
  const sc = fitScale(tr);
  const m = train(tr, sc, 40, 0.05, 1e-4);
  const learned = rankSums(te, r => {
    const xi = x(r, sc);
    let z = m.b;
    for (let i = 0; i < xi.length; i++) z += m.w[i] * xi[i];
    return z;
  });
  const hand = rankSums(te, r => r.heurScore);
  console.log(`  ${hold}: learned ${learned.sum} vs hand ${hand.sum} (${learned.units} units)`);
}

const scAll = fitScale(rows);
const mAll = train(rows, scAll, 40, 0.05, 1e-4);
fs.writeFileSync(OUT, JSON.stringify({ feats: FEATS, mu: scAll.mu, sd: scAll.sd, w: mAll.w, b: mAll.b }, null, 1));
console.log(`\nweights (trained on all) -> ${OUT}`);
console.log(FEATS.map((f, i) => `  ${f}: ${mAll.w[i].toFixed(3)}`).join('\n'));
