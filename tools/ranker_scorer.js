// Scorer module for rank_eval --scorer: scores a seat feature row with the
// weights train_ranker.js wrote. RANKER_WEIGHTS overrides the path.
'use strict';
const fs = require('fs');
const path = require('path');
const W = JSON.parse(fs.readFileSync(
  process.env.RANKER_WEIGHTS || path.join(__dirname, '..', 'bench', 'ranker-weights.json'), 'utf8'));
module.exports.score = function (feat) {
  let z = W.b;
  for (let i = 0; i < W.feats.length; i++) {
    z += W.w[i] * ((feat[W.feats[i]] - W.mu[W.feats[i]]) / W.sd[W.feats[i]]);
  }
  return z;
};
