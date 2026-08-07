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
function seedCorePuzzles() {
  const PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));
  const seedRating = { 1: 900, 2: 1200, 3: 1500 };
  const up = db.prepare(`
    INSERT INTO puzzles (slug, json, status, rating, author_name)
    VALUES (@slug, @json, 'core', @rating, @author)
    ON CONFLICT(slug) DO UPDATE SET json = @json, status = 'core'`);
  const tx = db.transaction(() => {
    for (const p of PUZZLES) {
      up.run({
        slug: p.id,
        json: JSON.stringify(p),
        rating: seedRating[p.difficulty || 2] || 1200,
        author: p.author || 'owpuzzle',
      });
    }
  });
  tx();
  return PUZZLES.length;
}

module.exports = { db, seedCorePuzzles };
