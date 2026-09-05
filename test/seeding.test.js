'use strict';
// Reseeding a core puzzle. An edit that changes how the puzzle PLAYS is a new
// puzzle: the old row is retired and everyone's completion goes with it, which
// is deliberate (docs/making-puzzles.md, server/db.js:56-107). An edit that
// only changes the WORDS must not cost anyone their solve — the client's
// puzzleHash (engine.js:1204) already ignores name/brief/lesson, so a
// text-only retire makes the library's tick and the Hall of Fame's count
// disagree for every player who had solved it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owp-seed-'));
process.env.DB_PATH = path.join(dir, 'seed.db');
// The rest of the suite runs with nothing installed. These tests drive the
// real server/db.js, whose sqlite driver lives in server/node_modules — so in
// a bare clone they skip rather than fail the run. CI installs it (see
// .github/workflows/test.yml) precisely so they do NOT skip there.
let db, seedCorePuzzles, reuniteRewordedSolves, unavailable = null;
try {
  ({ db, seedCorePuzzles, reuniteRewordedSolves } = require('../server/db.js'));
} catch (e) {
  unavailable = 'server deps not installed (npm ci --prefix server): ' + e.message;
}
const E = require('../web/engine.js');
const opts = unavailable ? { skip: unavailable } : {};

const LIVE = `puzzle_id IN (SELECT id FROM puzzles WHERE status IN ('core','approved'))`;
const TEMPLATE = require('../web/puzzles.js')[0];
// each test gets its own slug: these all retire and reseed the same slug, and
// a leftover retired row from a neighbouring test is a real hash match
function puzzleFor(name) {
  return { ...JSON.parse(JSON.stringify(TEMPLATE)), id: 'seedtest-' + name };
}

function solvesOf(uid) {
  return db.prepare(`SELECT COUNT(DISTINCT puzzle_id) n FROM attempts
    WHERE user_id = ? AND solved = 1 AND ${LIVE}`).get(uid).n;
}

// a player who has solved the puzzle as it stands today
function playerWhoSolved(base) {
  seedCorePuzzles([base]);
  const uid = db.prepare('INSERT INTO users (discord_id, name) VALUES (?, ?)')
    .run(base.id, base.id).lastInsertRowid;
  const pid = db.prepare('SELECT id FROM puzzles WHERE slug = ?').get(base.id).id;
  db.prepare(`INSERT INTO attempts (user_id, puzzle_id, solved, rated, orders_used)
    VALUES (?, ?, 1, 1, ?)`).run(uid, pid, base.orders);
  assert.equal(solvesOf(uid), 1, 'precondition: the solve counts');
  return uid;
}

test('rewording a puzzle keeps every solve [server/db.js:56-107]', opts, () => {
  const base = puzzleFor('reword');
  const uid = playerWhoSolved(base);
  const reworded = { ...base, lesson: (base.lesson || '') + ' (reworded)' };
  assert.equal(E.puzzleHash(reworded), E.puzzleHash(base),
    'sanity: the board did not change, so the client still shows its tick');
  seedCorePuzzles([reworded]);
  assert.equal(solvesOf(uid), 1, 'a text edit must not retire the solve');
  assert.equal(
    JSON.parse(db.prepare('SELECT json FROM puzzles WHERE slug = ?').get(base.id).json).lesson,
    reworded.lesson, 'and the new wording is what players now read');
});

test('changing how a puzzle plays retires it, solves included [server/db.js:56-107]', opts, () => {
  const base = puzzleFor('regame');
  const uid = playerWhoSolved(base);
  const harder = { ...base, orders: base.orders + 1 };
  assert.notEqual(E.puzzleHash(harder), E.puzzleHash(base));
  seedCorePuzzles([harder]);
  assert.equal(solvesOf(uid), 0, 'a gameplay edit is a new puzzle — deliberate');
});

// What the OLD seeder did to a text-only edit: retire the row, insert a fresh
// one. Every solve is left behind on the retired copy.
function retireTheOldWay(base, reworded) {
  const row = db.prepare('SELECT id FROM puzzles WHERE slug = ?').get(base.id);
  const v = db.prepare("SELECT COUNT(*) c FROM puzzles WHERE slug LIKE ?").get(base.id + '@v%').c + 1;
  db.prepare("UPDATE puzzles SET slug = ?, status = 'retired' WHERE id = ?")
    .run(base.id + '@v' + v, row.id);
  db.prepare("INSERT INTO puzzles (slug, json, status, rating, author_name) VALUES (?, ?, 'core', 1200, 'owpuzzle')")
    .run(base.id, JSON.stringify(reworded));
}

test('solves stranded by an old text-only retire are recovered [server/db.js]', opts, () => {
  const base = puzzleFor('stranded');
  const uid = playerWhoSolved(base);
  retireTheOldWay(base, { ...base, lesson: (base.lesson || '') + ' (reworded)' });
  assert.equal(solvesOf(uid), 0, 'precondition: this is the bug players reported');

  assert.equal(reuniteRewordedSolves(), 1);
  assert.equal(solvesOf(uid), 1, 'the solve is counted again');
  assert.equal(reuniteRewordedSolves(), 0, 'and running it again does nothing');
});

test('a genuine revision keeps its solves retired [server/db.js]', opts, () => {
  const base = puzzleFor('revised');
  const uid = playerWhoSolved(base);
  retireTheOldWay(base, { ...base, orders: base.orders + 1 });   // a different fight
  assert.equal(solvesOf(uid), 0);
  assert.equal(reuniteRewordedSolves(), 0, 'must not resurrect a real revision');
  assert.equal(solvesOf(uid), 0);
});

// A star is a live judgement, not a memory. Par moves when a better line is
// folded in, and a gold star that goes on claiming to be the best line is
// exactly what a player cannot audit — "I have no way of knowing if my star
// still stands, or someone found a shorter solution after I got the star"
// (Egotheist, 2026-09-04). Gold is recomputed against TODAY's par; silver
// remembers that it was par when it was earned.
//
// The stored attempts.perfect flag is deliberately NOT rewritten: achievements
// are immutable once earned (server/db.js), so a demoted star still counts
// toward Perfectionist and the rest. Only the display is re-judged.
test('a gold star becomes silver when a shorter line is folded in', opts, () => {
  const base = puzzleFor('star');
  seedCorePuzzles([base]);
  const uid = db.prepare('INSERT INTO users (discord_id, name) VALUES (?, ?)')
    .run('star-' + base.id, 'Starholder').lastInsertRowid;
  const p = db.prepare('SELECT id, json FROM puzzles WHERE slug = ?').get(base.id);
  const par = JSON.parse(p.json).orders;
  db.prepare(`INSERT INTO attempts (user_id,puzzle_id,solved,rated,orders_used,perfect)
              VALUES (?,?,1,1,?,1)`).run(uid, p.id, par);

  // the endpoint's rule, kept in one place here so the test states it plainly
  const starFor = () => {
    const row = db.prepare(`SELECT MAX(perfect) perfect, MIN(orders_used) best FROM attempts
                            WHERE user_id=? AND puzzle_id=? AND solved=1`).get(uid, p.id);
    const now = JSON.parse(db.prepare('SELECT json FROM puzzles WHERE id=?').get(p.id).json);
    const gold = row.best != null && row.best <= now.orders;
    return gold ? 'gold' : (row.perfect ? 'silver' : null);
  };

  assert.equal(starFor(), 'gold', 'solving in par earns gold');

  const folded = Object.assign({}, JSON.parse(p.json), { orders: par - 1 });  // someone found shorter
  db.prepare('UPDATE puzzles SET json=? WHERE id=?').run(JSON.stringify(folded), p.id);
  assert.equal(starFor(), 'silver', 'the same solve is silver once par moves under it');
  assert.equal(db.prepare('SELECT perfect FROM attempts WHERE puzzle_id=?').get(p.id).perfect, 1,
    'the earned flag must survive — achievements are immutable');

  // and it is recoverable: match the new par and the gold comes back
  db.prepare(`INSERT INTO attempts (user_id,puzzle_id,solved,rated,orders_used,perfect)
              VALUES (?,?,1,0,?,1)`).run(uid, p.id, par - 1);
  assert.equal(starFor(), 'gold', 'matching the new par restores gold');
});
