// SQLite schema + core-puzzle seeding.
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'owpuzzle.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  discord_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT,
  rating REAL NOT NULL DEFAULT 1200,
  rd REAL NOT NULL DEFAULT 350,
  vol REAL NOT NULL DEFAULT 0.06,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS puzzles (
  id INTEGER PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  json TEXT NOT NULL,             -- full puzzle definition
  status TEXT NOT NULL DEFAULT 'core',  -- core | pending | approved | rejected
  author_id INTEGER REFERENCES users(id),
  author_name TEXT,
  rating REAL NOT NULL DEFAULT 1200,
  rd REAL NOT NULL DEFAULT 300,
  vol REAL NOT NULL DEFAULT 0.06,
  attempts INTEGER NOT NULL DEFAULT 0,
  solves INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  puzzle_id INTEGER NOT NULL REFERENCES puzzles(id),
  solved INTEGER NOT NULL,
  rated INTEGER NOT NULL,         -- only the first attempt per puzzle is rated
  orders_used INTEGER,
  line TEXT,                      -- action list, server-replayed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, puzzle_id);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Seed / refresh core puzzles from web/puzzles.js.
// Difficulty seeds the initial rating; high RD lets attempts converge it.
//
// An EDITED puzzle is technically a new puzzle: its old rating and everyone's
// completion no longer apply. When the seeded json differs from the stored
// row, the old row is retired under slug@vN (attempt history stays attached
// to it) and a fresh row takes the canonical slug with a reseeded rating —
// so it re-enters every player's queue, and first attempts are rated again.
//
// FORCE_RESET: puzzles edited before this versioning existed (their new json
// was already upserted, so the diff can't see the change). Retired once —
// the versions>0 guard makes it idempotent.
const FORCE_RESET = ['nestor-charge', 'the-shore-riders', 'the-wood-line',
  'the-jungle-road', 'the-crossed-lanes', 'down-the-avenue', 'cut-the-bowstring'];
function seedCorePuzzles() {
  const PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));
  const seedRating = { 1: 900, 2: 1200, 3: 1500 };
  const sel = db.prepare('SELECT id, json, status FROM puzzles WHERE slug = ?');
  const countV = db.prepare('SELECT COUNT(*) c FROM puzzles WHERE slug LIKE ?');
  const retire = db.prepare(`UPDATE puzzles SET slug = ?, status = 'retired' WHERE id = ?`);
  const ins = db.prepare(`INSERT INTO puzzles (slug, json, status, rating, author_name)
    VALUES (?, ?, 'core', ?, ?)`);
  const restore = db.prepare(`UPDATE puzzles SET status = 'core' WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const p of PUZZLES) {
      const json = JSON.stringify(p);
      const rating = seedRating[p.difficulty || 2] || 1200;
      const author = p.author || 'owpuzzle';
      const row = sel.get(p.id);
      if (!row) { ins.run(p.id, json, rating, author); continue; }
      const versions = countV.get(p.id + '@v%').c;
      const force = FORCE_RESET.includes(p.id) && versions === 0;
      if (row.json !== json || force) {
        retire.run(p.id + '@v' + (versions + 1), row.id);
        ins.run(p.id, json, rating, author);
      } else if (row.status !== 'core') {
        restore.run(row.id);
      }
    }
  });
  tx();
  return PUZZLES.length;
}

try { db.exec('ALTER TABLE puzzles ADD COLUMN notes TEXT'); } catch (e) {}

// Achievements are IMMUTABLE: once earned they are written here and never
// recomputed away. Live counters can legitimately fall (a puzzle you solved
// gets retired, the library grows past a coverage badge), but a badge you
// have already been shown must never vanish.
db.exec(`
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL REFERENCES users(id),
  achv_id TEXT NOT NULL,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achv_id)
);`);
// Per-attempt outcome details (achievements + the PERFECT star on any device).
// NULL on rows written before this existed — backfilled from the stored line.
try { db.exec('ALTER TABLE attempts ADD COLUMN perfect INTEGER'); } catch (e) {}
try { db.exec('ALTER TABLE attempts ADD COLUMN damage_taken INTEGER'); } catch (e) {}
try { db.exec('ALTER TABLE attempts ADD COLUMN units_lost INTEGER'); } catch (e) {}

// Manually-inserted puzzles (a submission repaired by hand, say) can end up
// with author_name but no author_id, which silently costs the author their
// Architect / Beloved achievements. Reconcile by exact name match, ignoring
// the house bylines. Idempotent, runs at startup.
const HOUSE_AUTHORS = ['owpuzzle', 'mined from a real game'];
function linkAuthors() {
  const rows = db.prepare(`SELECT id, author_name FROM puzzles
    WHERE author_id IS NULL AND author_name IS NOT NULL`).all()
    .filter(r => !HOUSE_AUTHORS.includes(r.author_name));
  const find = db.prepare('SELECT id FROM users WHERE name = ?');
  const set = db.prepare('UPDATE puzzles SET author_id = ? WHERE id = ?');
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const u = find.get(r.author_name);
      if (u) { set.run(u.id, r.id); n++; }
    }
  });
  tx();
  return n;
}

// Replay historical attempts through the engine to fill the new columns.
// Cheap (one pass over a few hundred short lines) and idempotent.
function backfillAttempts(replay) {
  const rows = db.prepare(`
    SELECT a.id, a.line, p.json FROM attempts a
    JOIN puzzles p ON p.id = a.puzzle_id
    WHERE a.perfect IS NULL`).all();
  if (!rows.length) return 0;
  const up = db.prepare(
    'UPDATE attempts SET perfect = ?, damage_taken = ?, units_lost = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const r of rows) {
      let out = { perfect: false, damageTaken: 0, unitsLost: 0 };
      try { out = replay(JSON.parse(r.json), JSON.parse(r.line || '[]')); } catch (e) {}
      up.run(out.perfect ? 1 : 0, out.damageTaken | 0, out.unitsLost | 0, r.id);
    }
  });
  tx();
  return rows.length;
}

module.exports = { db, seedCorePuzzles, backfillAttempts, linkAuthors };
