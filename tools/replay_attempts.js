#!/usr/bin/env node
// Replay every stored solved line (submissions/attempts.json, from
// tools/snarf_attempts.sh) through the CURRENT engine and report, per board:
// the lines that still solve, the lines that now fail (with the failing
// action), and the best surviving orders / strength.
//
//   node tools/replay_attempts.js            # boards with a river edge
//   node tools/replay_attempts.js --all      # every board with a solve
//   node tools/replay_attempts.js <slug...>  # just these
//   VERBOSE=1                                # list every failing attempt
//   ENGINE=web/engine_old.js                 # replay through another engine build
//
// The replay is the server's own (server/index.js replayLine): loadPuzzle
// with the play pool, applyAction over the line, checkObjective at the end.
'use strict';
const path = require('path');
const fs = require('fs');
// ENGINE=web/engine_old.js replays through another engine build (a copy
// inside web/, so its data.js require resolves) — the baseline a rules change
// is judged against: only a line that replayed BEFORE and fails AFTER is a
// solve the change took away.
const E = require(process.env.ENGINE ? path.resolve(process.env.ENGINE) : path.join(__dirname, '..', 'web', 'engine.js'));

const args = process.argv.slice(2);
const ALL = args.includes('--all');
const slugs = args.filter(a => !a.startsWith('--'));
const file = path.join(__dirname, '..', 'submissions', 'attempts.json');
if (!fs.existsSync(file)) { console.error('no ' + file + ' — run tools/snarf_attempts.sh first'); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

function hasRiver(p) { return (p.tiles || []).some(t => t.river && t.river.length); }

// mirrors server/index.js replayLine, plus WHERE a line breaks
function replay(puzzle, line) {
  let s = E.loadPuzzle(JSON.parse(JSON.stringify(puzzle)), { play: true });
  const pool = E.poolOrders(puzzle);
  if (!Array.isArray(line) || line.length > 500) return { solved: false, ordersUsed: 0, failAt: -1, error: 'bad line' };
  for (let i = 0; i < line.length; i++) {
    try { s = E.applyAction(s, line[i]); }
    catch (e) { return { solved: false, ordersUsed: pool - s.orders, failAt: i, action: line[i], error: e.message, strKilled: E.strKilledOf(s) }; }
  }
  return { solved: E.checkObjective(s, puzzle.objective), ordersUsed: pool - s.orders, strKilled: E.strKilledOf(s) };
}

const byId = {};
for (const p of data.puzzles) byId[p.id] = p;
const groups = {};
for (const a of data.attempts) (groups[a.puzzle_id] = groups[a.puzzle_id] || []).push(a);

const rows = [];
for (const pid of Object.keys(groups)) {
  const p = byId[pid]; if (!p) continue;
  const puzzle = p.json;
  if (slugs.length ? !slugs.includes(p.slug) : (!ALL && !hasRiver(puzzle))) continue;
  const atts = groups[pid];
  const ok = [], bad = [];
  for (const a of atts) {
    const r = replay(puzzle, a.line);
    (r.solved ? ok : bad).push({ a, r });
  }
  const bestOrders = ok.length ? Math.min(...ok.map(x => x.r.ordersUsed)) : null;
  const bestStr = ok.length ? Math.max(...ok.map(x => x.r.strKilled)) : null;
  const obj = puzzle.objective || {};
  rows.push({
    slug: p.slug, status: p.status, kind: obj.kind, par: puzzle.orders,
    ceiling: obj.count != null ? obj.count : '',
    solves: atts.length, still: ok.length, fail: bad.length,
    bestOrders, bestStr: bestStr == null ? '' : bestStr,
  });
  if (bad.length) {
    console.log('\n' + p.slug + ' (' + p.status + ', ' + obj.kind + ', par ' + puzzle.orders + (obj.count != null ? ', ceiling ' + obj.count : '') + '): ' + bad.length + ' of ' + atts.length + ' stored solves no longer replay');
    const shown = process.env.VERBOSE ? bad : bad.slice(0, 5);
    for (const { a, r } of shown) {
      const where = r.failAt >= 0 ? 'action ' + r.failAt + ' ' + JSON.stringify(r.action) + ': ' + r.error : 'objective unmet at the end (' + r.strKilled + ' STRx10)';
      console.log('  attempt ' + a.id + ' (user ' + a.user_id + ', ' + a.orders_used + ' orders, ' + a.created_at + '): ' + where);
    }
    if (bad.length > shown.length) console.log('  … ' + (bad.length - shown.length) + ' more (VERBOSE=1)');
  }
}
rows.sort((x, y) => y.fail - x.fail || x.slug.localeCompare(y.slug));
console.log('\nboard | status | objective | par | ceiling | solves | still replay | now fail | best surviving orders | best surviving STRx10');
console.log('---|---|---|---|---|---|---|---|---|---');
for (const r of rows) console.log([r.slug, r.status, r.kind, r.par, r.ceiling, r.solves, r.still, r.fail, r.bestOrders == null ? '-' : r.bestOrders, r.bestStr].join(' | '));
