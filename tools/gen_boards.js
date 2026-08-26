// Training-data generator for the learned seat ranker: perturb small core
// puzzles (red hp jitter, kindred type swaps, pool jitter), solve each
// variant with verify2 on a short budget, and keep ONLY the ones that
// come back PROVEN with a dumped line. PROVEN is what makes the labels
// trustworthy: "seat is in a best-known line" is a heuristic's opinion,
// "seat is in a bound-matching line" is a fact about the board.
//
// Perturbation rather than free generation keeps every variant a valid
// puzzle def for free and keeps the distribution honest — the ranker is
// for THESE kinds of boards, not random soup.
//
// usage: node tools/gen_boards.js <outDir> [variantsPerBoard=8] [budgetSec=60] [seed=1] [hardOnly=0]
//   Writes <outDir>/<id>-vN.json, -vN-line.json, and manifest.json
//   (rank_eval format). Solo discipline applies: this SPAWNS verify2
//   sequentially — do not run it while a benchmark is measuring.
//
//   hardOnly=1 keeps only PROVEN variants whose proof shows the hard
//   structure the v1 dataset lacked (ranker v1's autopsy: easy boards
//   prove from immediate seats, so `deferred` trained NEGATIVE — the
//   opposite of what king and closing-in teach). Hard means any of:
//   verify2's load-bearing-deferred selector fired, the line marches,
//   or the line repositions mid-fight.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));

const OUT = process.argv[2];
const VARIANTS = parseInt(process.argv[3], 10) || 8;
const BUDGET = parseInt(process.argv[4], 10) || 60;
let rngState = (parseInt(process.argv[5], 10) || 1) >>> 0;
const HARD_ONLY = process.argv[6] === '1';
if (!OUT) { console.error('usage: node tools/gen_boards.js <outDir> [variants] [budgetSec] [seed]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

function rng() {
  rngState = (rngState + 0x6D2B79F5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = a => a[Math.floor(rng() * a.length)];

// kindred swaps: same combat family, different numbers — the label stays
// in-distribution while the damage table genuinely changes
const KIN = [
  ['UNIT_ARCHER', 'UNIT_LONGBOWMAN', 'UNIT_CROSSBOWMAN'],
  ['UNIT_AXEMAN', 'UNIT_MACEMAN', 'UNIT_SWORDSMAN'],
  ['UNIT_SPEARMAN', 'UNIT_PIKEMAN'],
  ['UNIT_HORSEMAN', 'UNIT_PALTON_CAVALRY'],
];
function kinOf(t) { return KIN.find(k => k.includes(t)); }

function perturb(P) {
  const v = JSON.parse(JSON.stringify(P));
  delete v.id; delete v.name; delete v.brief; delete v.lesson;
  for (const u of v.units) {
    const ud = E.DATA.units[u.type];
    if (!ud) continue;
    // hp jitter: red always, blue sometimes — wounded attackers change
    // which seats matter (TOUGH cuts both ways)
    if (u.player === 1 || rng() < 0.3) {
      const max = ud.iHPMax || 20;
      if (rng() < 0.7) u.hp = 1 + Math.floor(rng() * max);
    }
    // kindred type swap
    const kin = kinOf(u.type);
    if (kin && rng() < 0.35) {
      const t2 = pick(kin);
      if (E.DATA.units[t2]) u.type = t2;
    }
  }
  return v;
}

const CORE = require(path.join(__dirname, '..', 'web', 'puzzles.js'))
  .filter(P => P.units.filter(u => u.player === 0).length <= 6 &&
               P.units.filter(u => u.player === 1).length <= 4);
console.log(`${CORE.length} core boards ≤6 blue / ≤4 red`);

const manifest = [];
let proven = 0, tried = 0;
for (const P of CORE) {
  for (let vi = 0; vi < VARIANTS; vi++) {
    const v = perturb(P);
    const pool = Math.max(4, E.poolOrders(P) + Math.floor(rng() * 5) - 2);
    // a variant may be degenerate (all reds unreachable, everything at
    // 1 hp); verify2 decides — PROVEN or it doesn't count
    const name = `${P.id}-v${vi}`;
    const bFile = path.join(OUT, `${name}.json`);
    const lFile = path.join(OUT, `${name}-line.json`);
    fs.writeFileSync(bFile, JSON.stringify({ puzzle: v }));
    tried++;
    let out = '';
    try {
      out = cp.execSync(
        `node ${path.join(__dirname, 'verify2.js')} ${bFile} ${pool} ${BUDGET}`,
        { env: Object.assign({}, process.env, { V2_DUMP_LINE: lFile, V2_WORKERS: '0' }),
          timeout: (BUDGET + 60) * 1000, encoding: 'utf8' });
    } catch (e) { out = (e.stdout || '') + ''; }
    const isProven = /verdict: PROVEN/.test(out) && fs.existsSync(lFile);
    let keep = isProven, why = '';
    if (isProven && HARD_ONLY) {
      const line = JSON.parse(fs.readFileSync(lFile, 'utf8')).line;
      const firstAttack = line.findIndex(a => a.type === 'attack');
      const marches = line.some(a => a.type === 'march');
      const midFight = firstAttack >= 0 &&
        line.slice(firstAttack).some(a => a.type === 'move' || a.type === 'swap');
      const loadBearing = /deferred seats are load-bearing/.test(out);
      keep = marches || midFight || loadBearing;
      why = keep ? [loadBearing && 'deferred', marches && 'march', midFight && 'mid-fight']
        .filter(Boolean).join('+') : '';
    }
    if (keep) {
      proven++;
      manifest.push({ name, puzzle: bFile, pool, line: lFile });
      console.log(`  ${name}: PROVEN (pool ${pool})${why ? ' [' + why + ']' : ''}`);
    } else {
      fs.rmSync(bFile, { force: true });
      fs.rmSync(lFile, { force: true });
    }
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${proven}/${tried} variants PROVEN -> ${path.join(OUT, 'manifest.json')}`);
