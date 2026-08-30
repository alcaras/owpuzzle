// Offline seat-ranking eval — the learned-ordering programme's instrument.
//
// For each (board, line) pair in a manifest: replay the line, take each
// unit's first-attack seat, and report where those seats rank in the real
// search orders (plain / expressive / plan-witness). The known-good lines'
// rank-sums are the metric ANY new ordering heuristic — hand-tuned or
// learned — must improve OFFLINE before it may touch a search budget:
// king's human line carried rank-sum 61 and f6ff55's 270/30 carried 90
// under the current ordering, which is why search had to brute-force them.
//
// usage: node tools/rank_eval.js bench/rank-eval-manifest.json
//          [--scorer mod.js]        re-rank with mod.score(feat) desc, compare
//          [--dump-features out.json]  emit per-(unit,seat) feature rows
//
// A scorer module exports { score: function (feat) -> number }. Features
// are the fields listed in featRow() — everything the current heuristic
// sees, so a learned scorer competes on even ground.
'use strict';
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const V = require(path.join(__dirname, 'verify2.js'));

const args = process.argv.slice(2);
const manifestPath = args.find(a => !a.startsWith('--'));
const scorerPath = args.includes('--scorer') ? args[args.indexOf('--scorer') + 1] : null;
const dumpPath = args.includes('--dump-features') ? args[args.indexOf('--dump-features') + 1] : null;
if (!manifestPath) { console.error('usage: node tools/rank_eval.js <manifest.json> [--scorer mod.js] [--dump-features out.json]'); process.exit(1); }
const scorer = scorerPath ? require(path.resolve(scorerPath)) : null;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function loadBoard(spec) {
  if (/\.json$/.test(spec)) {
    const j = JSON.parse(fs.readFileSync(spec, 'utf8'));
    return j.puzzle || j;
  }
  const P = require(path.join(__dirname, '..', 'web', 'puzzles.js')).filter(x => x.id === spec)[0];
  if (!P) throw new Error('no puzzle ' + spec);
  return P;
}
const key = (q, r) => q + ',' + r;

function featRow(ctx, bi, entry) {
  // the SHARED feature computation (verify2.seatFeatures) plus the hand
  // score for comparison — offline features and in-search features must
  // be the same numbers or the offline bar predicts nothing
  const b = ctx.BLUE[bi];
  return Object.assign({ unitType: b.type, heurScore: entry.score },
    V.seatFeatures(ctx, b, entry));
}

const rows = [];
for (const m of manifest) {
  const P = loadBoard(m.puzzle);
  const ctx = V.build(P, m.pool);
  // m.line: a line file; or "authorSolution" to use the recording embedded
  // in the submission file itself (the author's own replay-verified line)
  const lineJ = m.line === 'authorSolution'
    ? JSON.parse(fs.readFileSync(m.puzzle, 'utf8')).authorSolution
    : JSON.parse(fs.readFileSync(m.line, 'utf8'));
  const line = lineJ.line || lineJ;

  // seats = each unit's first-attack pre-tile
  let s = E.loadPuzzle(ctx.base);
  const seat = {};
  for (const a of line) {
    if (a.type === 'attack' && seat[a.unit] === undefined) {
      const u = E.unitById(s, a.unit);
      if (u) seat[a.unit] = key(u.q, u.r);
    }
    s = E.applyAction(s, a);
  }
  const str = E.strKilledOf(s), used = ctx.POOL - s.orders;

  // plan-witness lists for the line's own kill-set (first witness, as the
  // search would find it)
  let planB = null;
  if (ctx.NR <= 20) {
    let mask = 0;
    s.units.forEach(u => { if (u.player === 1 && u.hp <= 0) mask |= (1 << ctx.ridx[u.id]); });
    const outw = {};
    if (V.feasibleMask(ctx, mask, ctx.POOL, V.fullRows(ctx, 'walk'), 300000, outw) && outw.assign) {
      planB = V.buildSeatLists(ctx, { plan: { mask, str, assign: outw.assign } });
    }
  }
  const exprB = V.buildSeatLists(ctx, { expressive: true });

  function ranksIn(built, reSort) {
    let sum = 0, worst = -1, missing = 0;
    for (const id of Object.keys(seat)) {
      const bi = ctx.BLUE.findIndex(b => b.id === +id);
      if (bi < 0) continue;
      let list = built.lists[bi];
      if (reSort) {
        list = list.slice().sort((a, b) =>
          scorer.score(featRow(ctx, bi, b2f(a))) - scorer.score(featRow(ctx, bi, b2f(b)))).reverse();
      }
      const idx = list.findIndex(e => e.key === seat[id]);
      if (idx < 0) { missing++; continue; }
      sum += idx;
      if (idx > worst) worst = idx;
    }
    return { sum, worst, missing };
  }
  const b2f = e => e;   // list entries already carry the feature fields

  const expr = ranksIn(exprB, false);
  const plan = planB ? ranksIn(planB, false) : null;
  const scored = scorer ? ranksIn(exprB, true) : null;
  console.log(`${m.name || m.puzzle}: line ${str / 10} STR/${used} orders · ` +
    `expr rank-sum ${expr.sum} (worst ${expr.worst}${expr.missing ? `, ${expr.missing} ABSENT` : ''})` +
    (plan ? ` · plan ${plan.sum}` : '') +
    (scored ? ` · SCORER ${scored.sum} (worst ${scored.worst})` : ''));

  if (dumpPath) {
    for (let bi = 0; bi < ctx.BLUE.length; bi++) {
      const id = ctx.BLUE[bi].id;
      for (const entry of exprB.lists[bi]) {
        rows.push(Object.assign(
          { board: m.name || m.puzzle, unit: id, seat: entry.key,
            inLine: seat[id] === entry.key ? 1 : 0 },
          featRow(ctx, bi, entry)));
      }
    }
  }
}
if (dumpPath) {
  fs.writeFileSync(dumpPath, JSON.stringify(rows));
  console.log(`${rows.length} feature rows -> ${dumpPath}`);
}
