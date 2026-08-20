'use strict';
// The review queue for lines that beat par. A record is a claim about the
// numbers as they stood when it landed, so folding one in ANSWERS every other
// record on that puzzle — and nothing was retiring them. Five players found
// the same 16-order line on Two Points Short and the queue kept asking for the
// same verdict five times, on top of five more for the same board under its
// withdrawn name (the-crown). Real rows off the live DB, 2026-08-20.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owp-rec-'));
process.env.DB_PATH = path.join(dir, 'records.db');
// as in test/seeding.test.js: the sqlite driver lives in server/node_modules,
// so a bare clone skips rather than fails. CI installs it (see the workflow).
let db, unavailable = null;
try { ({ db } = require('../server/db.js')); }
catch (e) { unavailable = 'server deps not installed (npm ci --prefix server): ' + e.message; }
const { beatsPublished, retireSupersededRecords } = require('../server/records.js');
const opts = unavailable ? { skip: unavailable } : {};

let seq = 0;
function puzzle(objective, orders, status) {
  const slug = 'rectest-' + (++seq);
  const p = { id: slug, name: slug, orders, objective, tiles: [], units: [] };
  const id = db.prepare(`INSERT INTO puzzles (slug, json, status, rating, author_name)
    VALUES (?, ?, ?, 1200, 'owpuzzle')`).run(slug, JSON.stringify(p), status || 'approved').lastInsertRowid;
  return { id, slug, json: p };
}
function record(pz, kind, strKilled, ordersUsed) {
  const uid = db.prepare('INSERT INTO users (discord_id, name) VALUES (?, ?)')
    .run('u' + (++seq), 'player' + seq).lastInsertRowid;
  return db.prepare(`INSERT INTO records
      (puzzle_id, user_id, kind, str_killed, orders_used, par_orders, par_count, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`)
    .run(pz.id, uid, kind, strKilled, ordersUsed, pz.json.orders,
         pz.json.objective.count || null).lastInsertRowid;
}
function statusOf(id) {
  return db.prepare('SELECT status FROM records WHERE id = ?').get(id).status;
}
function fold(pz, changes) {
  Object.assign(pz.json, changes);
  db.prepare('UPDATE puzzles SET json = ? WHERE id = ?').run(JSON.stringify(pz.json), pz.id);
}

// ---- what counts as beating the published answer [server/records.js] ----

test('a maxKill line past the ceiling is a strength record [server/index.js /api/attempt]', opts, () => {
  const p = { orders: 15, objective: { kind: 'maxKill', count: 260 } };
  assert.equal(beatsPublished(p, { strKilled: 270, ordersUsed: 15 }), 'strength');
});

test('the ceiling in fewer orders is an orders record, not nothing [pinball-37c1a3]', opts, () => {
  const p = { orders: 15, objective: { kind: 'maxKill', count: 260 } };
  assert.equal(beatsPublished(p, { strKilled: 260, ordersUsed: 13 }), 'orders');
  assert.equal(beatsPublished(p, { strKilled: 260, ordersUsed: 15 }), null, 'par is not beating par');
});

test('an unsolved line is never a record, however short [killAll]', opts, () => {
  const p = { orders: 18, objective: { kind: 'killAll' } };
  assert.equal(beatsPublished(p, { solved: false, ordersUsed: 4 }), null);
  assert.equal(beatsPublished(p, { solved: true, ordersUsed: 16 }), 'orders');
});

// ---- the sweep ----

test('folding one par retires everyone else who found the same line [two-points-short]', opts, () => {
  const pz = puzzle({ kind: 'killAll' }, 18);
  const folded = record(pz, 'orders', 150, 16);      // the one an admin accepts
  const same = record(pz, 'orders', 150, 16);        // four other players, same discovery
  const worse = record(pz, 'orders', 150, 17);
  const better = record(pz, 'orders', 150, 15);      // genuinely still ahead of the fold

  fold(pz, { orders: 16 });
  db.prepare(`UPDATE records SET status = 'accepted' WHERE id = ?`).run(folded);
  assert.equal(retireSupersededRecords(db, pz.id), 2, 'the duplicate and the worse line');
  assert.equal(statusOf(same), 'superseded');
  assert.equal(statusOf(worse), 'superseded');
  assert.equal(statusOf(better), 'new', 'a line the fold did NOT answer stays in the queue');
  assert.equal(retireSupersededRecords(db, pz.id), 0, 'and the sweep is idempotent');
});

test('folding a ceiling retires the longer lines that only reach it [are-we-playing-chess-again]', opts, () => {
  const pz = puzzle({ kind: 'maxKill', count: 530 }, 38);
  const folded = record(pz, 'strength', 570, 34);
  const longer = record(pz, 'strength', 570, 37);
  const past = record(pz, 'strength', 580, 40);

  fold(pz, { orders: 34, objective: { kind: 'maxKill', count: 570 } });
  db.prepare(`UPDATE records SET status = 'accepted' WHERE id = ?`).run(folded);
  assert.equal(retireSupersededRecords(db, pz.id), 1);
  assert.equal(statusOf(longer), 'superseded', '570 in 37 no longer beats 570 in 34');
  assert.equal(statusOf(past), 'new', 'but 58 STR still beats the new ceiling');
});

test('a record on a puzzle that is no longer live has nothing to fold into [the-crown]', opts, () => {
  const pz = puzzle({ kind: 'killAll' }, 18);
  const rec = record(pz, 'orders', 150, 16);
  assert.equal(retireSupersededRecords(db, pz.id), 0, 'precondition: it stands while the puzzle is live');

  db.prepare(`UPDATE puzzles SET status = 'retired' WHERE id = ?`).run(pz.id);
  assert.equal(retireSupersededRecords(db, pz.id), 1);
  assert.equal(statusOf(rec), 'superseded');
});

test('the sweep leaves accepted and rejected verdicts alone [records.status]', opts, () => {
  const pz = puzzle({ kind: 'killAll' }, 18);
  const rec = record(pz, 'orders', 150, 16);
  db.prepare(`UPDATE records SET status = 'rejected' WHERE id = ?`).run(rec);
  fold(pz, { orders: 16 });
  retireSupersededRecords(db);
  assert.equal(statusOf(rec), 'rejected', 'a human verdict is not the sweep to overwrite');
});
