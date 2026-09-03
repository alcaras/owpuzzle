'use strict';
// Withdrawing a submission [server/submissions.js, POST /api/withdraw/:slug].
// An author may pull back a PENDING row of their own and nothing else: a
// published puzzle has solves hanging off it, and a stranger must not be able
// to tell whether a slug exists.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owp-sub-'));
process.env.DB_PATH = path.join(dir, 'sub.db');
let db, unavailable = null;
try { ({ db } = require('../server/db.js')); }
catch (e) { unavailable = 'server deps not installed (npm ci --prefix server): ' + e.message; }
const { withdrawSubmission } = require('../server/submissions.js');
const opts = unavailable ? { skip: unavailable } : {};
let seq = 0;
function user() {
  const id = db.prepare('INSERT INTO users (discord_id, name) VALUES (?, ?)')
    .run('u' + (++seq), 'author' + seq).lastInsertRowid;
  return { id, name: 'author' + seq };
}
function submission(author, status) {
  const slug = 'subtest-' + (++seq);
  db.prepare(`INSERT INTO puzzles (slug, json, status, author_id, author_name, rating)
    VALUES (?, ?, ?, ?, ?, 1200)`)
    .run(slug, JSON.stringify({ id: slug, name: slug, orders: 5, objective: { kind: 'killAll' }, tiles: [], units: [] }),
         status, author.id, author.name);
  return slug;
}
function statusOf(slug) { return db.prepare('SELECT status FROM puzzles WHERE slug = ?').get(slug).status; }

test('the author withdraws a pending submission; the row stays, as withdrawn', opts, () => {
  const a = user(), slug = submission(a, 'pending');
  assert.deepEqual(withdrawSubmission(db, a, slug), { ok: true, status: 'withdrawn' });
  assert.equal(statusOf(slug), 'withdrawn');
  // idempotent: a second click is not an error
  assert.deepEqual(withdrawSubmission(db, a, slug), { ok: true, status: 'withdrawn' });
});

test('withdrawn rows leave the review queue and the live library alone', opts, () => {
  const a = user(), slug = submission(a, 'pending');
  withdrawSubmission(db, a, slug);
  const pending = db.prepare(`SELECT slug FROM puzzles WHERE status = 'pending'`).all().map(r => r.slug);
  assert.ok(!pending.includes(slug));
  const live = db.prepare(`SELECT slug FROM puzzles WHERE status IN ('core', 'approved')`).all().map(r => r.slug);
  assert.ok(!live.includes(slug));
});

test('a published puzzle cannot be withdrawn by its author', opts, () => {
  const a = user();
  for (const st of ['approved', 'core']) {
    const slug = submission(a, st);
    const r = withdrawSubmission(db, a, slug);
    assert.equal(r.ok, false); assert.equal(r.code, 409);
    assert.equal(statusOf(slug), st);
  }
  const rejected = submission(a, 'rejected');
  assert.equal(withdrawSubmission(db, a, rejected).code, 409);
  assert.equal(statusOf(rejected), 'rejected');
});

test('someone else gets "not found", not a refusal that confirms the slug', opts, () => {
  const a = user(), b = user(), slug = submission(a, 'pending');
  assert.equal(withdrawSubmission(db, b, slug).code, 404);
  assert.equal(withdrawSubmission(db, b, 'no-such-slug').code, 404);
  assert.equal(withdrawSubmission(db, null, slug).code, 401);
  assert.equal(statusOf(slug), 'pending');
});
