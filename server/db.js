// SQLite schema + core-puzzle seeding.
'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
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
  status TEXT NOT NULL DEFAULT 'core',  -- core | pending | approved | rejected | withdrawn
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
// completion no longer apply. When the seeded puzzle PLAYS differently from
// the stored row, the old row is retired under slug@vN (attempt history stays
// attached to it) and a fresh row takes the canonical slug with a reseeded
// rating — so it re-enters every player's queue, and first attempts are rated
// again.
//
// "Plays differently" is puzzleHash (engine.js:1204) — board, units, orders,
// objective — NOT the raw json. Rewording a name, brief or lesson used to
// retire the row too, which silently took the solve off everyone who had
// beaten it: the library kept showing its tick (the client hash was unchanged)
// while the Hall of Fame stopped counting it, so the two totals disagreed.
// Text edits now update the row in place, keeping ratings and completions.
//
// FORCE_RESET: puzzles edited before this versioning existed (their new json
// was already upserted, so the diff can't see the change). Retired once —
// the versions>0 guard makes it idempotent.
const FORCE_RESET = ['nestor-charge', 'the-shore-riders', 'the-wood-line',
  'the-jungle-road', 'the-crossed-lanes', 'down-the-avenue', 'cut-the-bowstring'];
function seedCorePuzzles(puzzles) {
  const PUZZLES = puzzles || require(path.join(__dirname, '..', 'web', 'puzzles.js'));
  const seedRating = { 1: 900, 2: 1200, 3: 1500 };
  const sel = db.prepare('SELECT id, json, status FROM puzzles WHERE slug = ?');
  const countV = db.prepare('SELECT COUNT(*) c FROM puzzles WHERE slug LIKE ?');
  const retire = db.prepare(`UPDATE puzzles SET slug = ?, status = 'retired' WHERE id = ?`);
  const ins = db.prepare(`INSERT INTO puzzles (slug, json, status, rating, author_name)
    VALUES (?, ?, 'core', ?, ?)`);
  const restore = db.prepare(`UPDATE puzzles SET status = 'core' WHERE id = ?`);
  const reword = db.prepare(`UPDATE puzzles SET json = ?, author_name = ? WHERE id = ?`);
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
        // same fight, new words: keep the row, its rating and its solves
        let sameFight = false;
        if (!force) {
          try { sameFight = E.puzzleHash(JSON.parse(row.json)) === E.puzzleHash(p); }
          catch (e) { sameFight = false; }
        }
        if (sameFight) {
          reword.run(json, author, row.id);
          if (row.status !== 'core') restore.run(row.id);
        } else {
          retire.run(p.id + '@v' + (versions + 1), row.id);
          ins.run(p.id, json, rating, author);
        }
      } else if (row.status !== 'core') {
        restore.run(row.id);
      }
    }
  });
  tx();
  // A core puzzle deleted from puzzles.js is withdrawn: retire it (its
  // attempt history stays) rather than leaving it live because seeding only
  // ever upserts. Same status the edit path uses.
  const live = new Set(PUZZLES.map(p => p.id));
  for (const r of db.prepare(`SELECT id, slug FROM puzzles WHERE status = 'core'`).all()) {
    if (!live.has(r.slug)) {
      db.prepare(`UPDATE puzzles SET status = 'retired' WHERE id = ?`).run(r.id);
    }
  }
  return PUZZLES.length;
}

try { db.exec('ALTER TABLE puzzles ADD COLUMN notes TEXT'); } catch (e) {}
// display preferences follow the account, not the browser
try { db.exec('ALTER TABLE users ADD COLUMN pref_unit_art TEXT'); } catch (e) {}

// A player line that beats the published par is evidence the ceiling is wrong
// — or that the engine is. Either way it wants a human eye before the library
// changes, so it lands here rather than updating anything automatically.
db.exec(`CREATE TABLE IF NOT EXISTS draft_solutions (
  user_id INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

db.exec(`CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  puzzle_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  str_killed INTEGER,
  orders_used INTEGER,
  par_orders INTEGER,
  par_count INTEGER,
  line TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

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

// One-time resets while the achievement system is still being designed.
// Immutability protects players from LOSING a badge to later balance changes,
// but during design we want the grants to reflect the current thresholds.
// Bump the sentinel to wipe and re-grant; each runs at most once.
db.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT,
         at TEXT NOT NULL DEFAULT (datetime('now')));`);
function resetAchievementsOnce(sentinel) {
  const seen = db.prepare('SELECT 1 FROM meta WHERE k = ?').get(sentinel);
  if (seen) return 0;
  const n = db.prepare('DELETE FROM user_achievements').run().changes;
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run(sentinel, 'done');
  return n;
}

// Repair for rows retired by the old whole-json diff: a puzzle that was only
// REWORDED got a fresh row, stranding every solve on the retired copy. The
// library kept its tick (the client hash never changed) while the Hall of Fame
// stopped counting it. Move those attempts back onto the live row.
//
// Only ever moves attempts whose retired row is the same FIGHT as the live row
// of the same slug, so a genuine gameplay revision is left alone. Idempotent:
// once moved there is nothing left to move.
function reuniteRewordedSolves() {
  const hash = (j) => { try { return E.puzzleHash(JSON.parse(j)); } catch (e) { return null; } };
  const liveBySlug = new Map();
  for (const r of db.prepare(
    `SELECT id, slug, json FROM puzzles WHERE status IN ('core','approved')`).all()) {
    liveBySlug.set(r.slug, r);
  }
  const retired = db.prepare(
    `SELECT id, slug, json FROM puzzles WHERE status = 'retired' AND slug LIKE '%@v%'`).all();
  // a second rated attempt on the same puzzle would double-count first-try
  // badges, so the moved one is demoted to unrated
  const demote = db.prepare(`UPDATE attempts SET rated = 0 WHERE puzzle_id = @from AND EXISTS
    (SELECT 1 FROM attempts b WHERE b.puzzle_id = @to AND b.user_id = attempts.user_id AND b.rated = 1)`);
  const move = db.prepare('UPDATE attempts SET puzzle_id = @to WHERE puzzle_id = @from');
  let moved = 0;
  const tx = db.transaction(() => {
    for (const r of retired) {
      const liveRow = liveBySlug.get(r.slug.replace(/@v\d+$/, ''));
      if (!liveRow) continue;
      const h = hash(r.json);
      if (!h || h !== hash(liveRow.json)) continue;
      demote.run({ from: r.id, to: liveRow.id });
      moved += move.run({ from: r.id, to: liveRow.id }).changes;
    }
  });
  tx();
  return moved;
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

module.exports = { db, seedCorePuzzles, backfillAttempts, linkAuthors, resetAchievementsOnce,
  reuniteRewordedSolves };
