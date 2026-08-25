// Reconstruct a line JSON from verify2 replay text: each printed action
// carries the engine's own log string, so candidates are DFS-matched by
// applying them and comparing the produced log exactly. Exists because a
// non-reproducing lucky run's best line lives only in its log — the
// 270/30 f6ff55 find (2026-08-25) was recovered exactly this way.
//
// usage: node tools/reconstruct_line.js <puzzle.json> <pool> <replay.txt> \
//          <out.json> <strengthSTR> <orders>
// where replay.txt is the "N. unit ... [engine log]" block from a verify2 run.
'use strict';
const fs = require('fs');
const path = require('path');
// engine resolved repo-relative, like every other tool
const E = require(path.join(__dirname, "..", "web", "engine.js"));

const sub = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const P = sub.puzzle || sub;
const POOL = parseInt(process.argv[3], 10);
const replayText = fs.readFileSync(process.argv[4], 'utf8');
const OUT = process.argv[5];
const WANT_STR = parseInt(process.argv[6], 10), WANT_ORD = parseInt(process.argv[7], 10);

const base = JSON.parse(JSON.stringify(P));
base.orders = POOL;
base.objective = { kind: 'maxKill', count: 999999 };
base.training = P.training != null ? P.training : 300;

const steps = replayText.split('\n')
  .map(l => l.match(/^\s*\d+\. (.*?)   \[(.*)\]\s*$/))
  .filter(Boolean)
  .map(m => ({ text: m[1], log: m[2] }));
if (!steps.length) { console.error('no steps parsed'); process.exit(1); }

function candidates(s, text) {
  const out = [];
  const mMove = text.match(/^(.*) -> \((-?\d+),(-?\d+)\)$/);
  const mMarch = text.match(/^(.*) force marches$/);
  const mAtt = text.match(/^(.*) attacks (.*)$/);
  for (const u of s.units) {
    if (u.player !== 0 || u.hp <= 0) continue;
    const n = E.nameOf(u);
    if (mMove && n === mMove[1]) out.push({ type: 'move', unit: u.id, q: +mMove[2], r: +mMove[3] });
    if (mMarch && n === mMarch[1]) out.push({ type: 'march', unit: u.id });
    if (mAtt && n === mAtt[1]) {
      for (const t of s.units) {
        if (t.player === 1 && t.hp > 0 && E.nameOf(t) === mAtt[2]) {
          out.push({ type: 'attack', unit: u.id, target: t.id });
        }
      }
    }
  }
  return out;
}

const line = [];
(function dfs(s, i) {
  if (i === steps.length) {
    const str = E.strKilledOf(s), used = POOL - s.orders;
    if (str === WANT_STR * 10 && used === WANT_ORD) return true;
    console.error(`sequence matched all logs but ends at ${str / 10}/${used}`);
    return false;
  }
  for (const a of candidates(s, steps[i].text)) {
    let ns;
    try { ns = E.applyAction(s, a); } catch (e) { continue; }
    if (ns.log[ns.log.length - 1] !== steps[i].log) continue;
    line.push(a);
    if (dfs(ns, i + 1)) return true;
    line.pop();
  }
  return false;
})(E.loadPuzzle(base), 0)
  ? (fs.writeFileSync(OUT, JSON.stringify({ strength: WANT_STR * 10, orders: WANT_ORD, line }, null, 1)),
     console.log(`reconstructed ${steps.length} steps -> ${OUT}`))
  : (console.error('reconstruction failed'), process.exit(1));
