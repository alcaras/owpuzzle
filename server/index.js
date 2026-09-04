// owpuzzle server: static site + rated puzzle API + Discord auth + submissions.
// Attempts are SERVER-VERIFIED: the client sends its action line and we replay
// it through the same engine.js the browser uses.
'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, seedCorePuzzles, backfillAttempts, linkAuthors, resetAchievementsOnce,
  reuniteRewordedSolves } = require('./db');
const { computeAchievements, LIVE } = require('./achievements');
const { beatsPublished, retireSupersededRecords } = require('./records');
const { withdrawSubmission } = require('./submissions');
const glicko = require('./glicko');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const SOLVER = require(path.join(__dirname, '..', 'web', 'solver.js'));

const PORT = process.env.PORT || 8080;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || '').split(',').filter(Boolean);
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || ''; // submission pings
const FAILED_REQUEUE_HOURS = 24;

const seeded = seedCorePuzzles();
// before achievements are recomputed, so a recovered solve grants its badge
// on the same boot
const reunited = reuniteRewordedSolves();
if (reunited) console.log(`recovered ${reunited} attempt(s) stranded by a reworded puzzle`);
const backfilled = backfillAttempts((puzzle, line) => replayLine(puzzle, line));
if (backfilled) console.log(`backfilled ${backfilled} attempt rows`);
const linked = linkAuthors();
if (linked) console.log(`linked ${linked} puzzle(s) to their author account`);
// record every achievement currently met, so existing players keep them for
// good even as the library grows or puzzles are retired
{
  // thresholds changed (cognomen legitimacy) — re-grant against the new bar
  const wiped = resetAchievementsOnce('achv_reset_two_tier_v3');
  if (wiped) console.log(`cleared ${wiped} achievement grant(s) for re-evaluation`);
  const before = db.prepare('SELECT COUNT(*) n FROM user_achievements').get().n;
  for (const u of db.prepare('SELECT id FROM users').all()) computeAchievements(db, u.id, true);
  const after = db.prepare('SELECT COUNT(*) n FROM user_achievements').get().n;
  if (after > before) console.log(`recorded ${after - before} achievement(s) as permanent`);
}
console.log(`seeded ${seeded} core puzzles`);

const app = express();
app.use(express.json({ limit: '256kb' }));
// Always revalidate the app's own code. A browser holding yesterday's app.js
// against today's editor.js produces bugs that look impossible and cannot be
// reproduced locally — an author being told their unchanged puzzle changed.
// 304s are cheap; silent version skew is not.
app.use(express.static(path.join(__dirname, '..', 'web'), {
  setHeaders(res, filePath) {
    if (/\.(js|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ---------- sessions ----------
function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}
// Discord stores an avatar HASH; the CDN URL needs the user id too. Users
// with no avatar get one of Discord's default embeds (id >> 22 % 6 for the
// post-discriminator username scheme).
function avatarUrl(discordId, hash, size) {
  size = size || 64;
  if (hash) {
    const ext = String(hash).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordId}/${hash}.${ext}?size=${size}`;
  }
  let idx = 0;
  try { idx = Number((BigInt(discordId) >> 22n) % 6n); } catch (e) { idx = 0; }
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function userFromReq(req) {
  const m = /owp_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const row = db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(m[1]);
  return row || null;
}

// ---------- Discord OAuth ----------
app.get('/auth/discord', (req, res) => {
  const url = 'https://discord.com/oauth2/authorize?' + new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: `${BASE_URL}/auth/callback`,
    response_type: 'code',
    scope: 'identify',
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: `${BASE_URL}/auth/callback`,
      }),
    });
    const tok = await tokenRes.json();
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    const me = await meRes.json();
    if (!me.id) throw new Error('no discord id');
    const isAdmin = ADMIN_DISCORD_IDS.includes(me.id) ? 1 : 0;
    db.prepare(`
      INSERT INTO users (discord_id, name, avatar, is_admin) VALUES (?, ?, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET name = excluded.name,
        avatar = excluded.avatar, is_admin = MAX(is_admin, excluded.is_admin)`)
      .run(me.id, me.global_name || me.username, me.avatar, isAdmin);
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(me.id);
    const token = newSession(user.id);
    res.setHeader('Set-Cookie',
      `owp_session=${token}; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax${BASE_URL.startsWith('https') ? '; Secure' : ''}`);
    res.redirect('/');
  } catch (e) {
    console.error('auth failed', e);
    res.status(500).send('auth failed');
  }
});

app.post('/auth/logout', (req, res) => {
  const m = /owp_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
  res.setHeader('Set-Cookie', 'owp_session=; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------- helpers ----------
function coreSolvedCount(userId) {
  return db.prepare(`
    SELECT COUNT(DISTINCT p.id) n FROM puzzles p
    JOIN attempts a ON a.puzzle_id = p.id AND a.user_id = ? AND a.solved = 1
    WHERE p.status = 'core'`).get(userId).n;
}
function coreCount() {
  return db.prepare(`SELECT COUNT(*) n FROM puzzles WHERE status = 'core'`).get().n;
}
function canSubmit(user) { return !!user; } // any signed-in player may submit
function completedAll(user) {
  return user && coreSolvedCount(user.id) >= coreCount();
}
function publicUser(u) {
  if (!u) return null;
  return {
    name: u.name, avatar: avatarUrl(u.discord_id, u.avatar, 32), rating: Math.round(u.rating),
    rd: Math.round(u.rd), isAdmin: !!u.is_admin,
    coreSolved: coreSolvedCount(u.id), coreTotal: coreCount(),
    canSubmit: true, completedAll: completedAll(u),
    unitArt: u.pref_unit_art || null,
  };
}

// Replay the client's action line through the real engine. The server is the
// referee: "solved" is whatever the replay says, nothing else.
function replayLine(puzzle, line) {
  let s = E.loadPuzzle(puzzle, { play: true }); // same forgiving pool the client plays with
  const pool = E.poolOrders(puzzle);            // s.orders starts from the POOL, not par
  // A big puzzle's reference line is long: 40 orders of moves, attacks and
  // rout chains runs well past a hundred actions. The cap exists to stop a
  // hostile payload, not to judge a puzzle's size.
  if (!Array.isArray(line) || line.length > 500) return { solved: false, ordersUsed: 0 };
  try {
    for (const a of line) s = E.applyAction(s, a);
  } catch (e) {
    return { solved: false, ordersUsed: pool - s.orders };
  }
  const solved = E.checkObjective(s, puzzle.objective);
  let damageTaken = 0, unitsLost = 0;
  for (const u of s.units) {
    if (u.player !== 0) continue;
    damageTaken += E.hpMax(u) - Math.max(0, u.hp);
    if (u.hp <= 0) unitsLost++;
  }
  return {
    solved,
    ordersUsed: pool - s.orders,
    perfect: solved && (pool - s.orders) <= puzzle.orders,
    damageTaken, unitsLost,
    strKilled: E.strKilledOf(s),
  };
}

// ---------- API ----------
app.get('/api/me', (req, res) => res.json({ user: publicUser(userFromReq(req)) }));

// Display preferences belong to the account once you have one, so they follow
// you between machines; signed out they stay in the browser.
app.post('/api/settings', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  const art = req.body && req.body.unitArt;
  if (art !== undefined) {
    if (art !== 'portrait' && art !== 'flag') return res.status(400).json({ error: 'unknown unit art' });
    db.prepare('UPDATE users SET pref_unit_art = ? WHERE id = ?').run(art, user.id);
  }
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
});

app.get('/api/puzzles', (req, res) => {
  const user = userFromReq(req);
  const rows = db.prepare(`
    SELECT id, slug, json, status, author_name, rating, rd, attempts, solves
    FROM puzzles WHERE status IN ('core', 'approved') ORDER BY id`).all();
  let solved = {}, perfect = {};
  if (user) {
    for (const r of db.prepare(
      `SELECT puzzle_id, MAX(perfect) perfect FROM attempts
       WHERE user_id = ? AND solved = 1 GROUP BY puzzle_id`).all(user.id)) {
      solved[r.puzzle_id] = true;
      if (r.perfect) perfect[r.puzzle_id] = true;
    }
  }
  res.json({
    puzzles: rows.map(r => ({
      id: r.id, slug: r.slug, puzzle: JSON.parse(r.json), status: r.status,
      author: r.author_name,
      // puzzle Elo is disclosed only to players who have beaten it, but a
      // coarse BAND is public so the library can group by measured difficulty
      // without leaking the number
      band: r.rating < 1000 ? 1 : (r.rating < 1300 ? 2 : 3),
      rating: solved[r.id] ? Math.round(r.rating) : undefined,
      attempts: r.attempts, solves: r.solves, solvedByMe: !!solved[r.id],
      perfectByMe: !!perfect[r.id],
    })),
  });
});

// Matchmaking: unseen (or failed-and-cooled-down) puzzle near the user's
// rating, preferring high-RD puzzles so their ratings converge.
app.get('/api/next', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'login required for the rated queue' });
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT MAX(created_at) FROM attempts a WHERE a.puzzle_id = p.id AND a.user_id = @uid) last_attempt,
      (SELECT MAX(solved) FROM attempts a WHERE a.puzzle_id = p.id AND a.user_id = @uid) ever_solved
    FROM puzzles p WHERE p.status IN ('core', 'approved')`).all({ uid: user.id });
  const now = Date.now();
  const exclude = req.query.exclude;
  const eligible = rows.filter(r => {
    if (exclude && r.slug === exclude) return false;          // never hand back the one just played
    if (r.ever_solved === 1) return false;                    // solved: done
    if (!r.last_attempt) return true;                         // unseen
    const ageH = (now - Date.parse(r.last_attempt + 'Z')) / 36e5;
    return ageH >= FAILED_REQUEUE_HOURS;                      // failed: cooldown
  });
  if (!eligible.length) return res.json({ puzzle: null, message: 'queue exhausted — check back later' });
  // score: rating proximity (prefer slightly above), plus RD bonus
  const scored = eligible.map(r => {
    const diff = r.rating - user.rating;
    const proximity = -Math.abs(diff - 60);                   // sweet spot ~+60
    return { r, score: proximity + Math.min(r.rd, 200) * 0.3 + Math.random() * 40 };
  }).sort((a, b) => b.score - a.score);
  const pick = scored[0].r;
  res.json({
    id: pick.id, slug: pick.slug, puzzle: JSON.parse(pick.json),
    rated: !pick.last_attempt,                                // only first attempt is rated
  });
});

// Did this line do better than the published answer? Flag it, never apply it
// (the test is beatsPublished, server/records.js).
function recordIfBeatsPar(row, puzzle, user, line, r) {
  const kind = beatsPublished(puzzle, r);
  if (!kind) return;
  db.prepare(`INSERT INTO records
      (puzzle_id, user_id, kind, str_killed, orders_used, par_orders, par_count, line)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(row.id, user.id, kind, r.strKilled, r.ordersUsed, puzzle.orders,
         puzzle.objective.count || null, JSON.stringify(line || []));
  if (DISCORD_WEBHOOK_URL) {
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `🏅 **${user.name}** beat par on **${puzzle.name}** ` +
        `(${kind === 'strength' ? (r.strKilled / 10) + ' STR vs a ' + ((puzzle.objective.count || 0) / 10) + ' ceiling'
                                : r.ordersUsed + ' orders vs par ' + puzzle.orders}) — needs review` }),
    }).catch(() => {});
  }
}

app.post('/api/attempt', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  const { slug, line } = req.body || {};
  const row = db.prepare(`SELECT * FROM puzzles WHERE slug = ? AND status IN ('core','approved')`).get(slug);
  if (!row) return res.status(404).json({ error: 'unknown puzzle' });
  const puzzle = JSON.parse(row.json);
  const { solved, ordersUsed, perfect, damageTaken, unitsLost, strKilled } = replayLine(puzzle, line);
  recordIfBeatsPar(row, puzzle, user, line, { solved, ordersUsed, strKilled });

  // achievement snapshot BEFORE this attempt lands, to diff what it unlocked
  const earnedBefore = new Set(
    computeAchievements(db, user.id, true).achievements.filter(a => a.earned).map(a => a.id));

  const prior = db.prepare(
    'SELECT COUNT(*) n FROM attempts WHERE user_id = ? AND puzzle_id = ?').get(user.id, row.id).n;
  const rated = prior === 0;

  let ratingDelta = 0;
  if (rated) {
    const u0 = { rating: user.rating, rd: user.rd, vol: user.vol };
    const p0 = { rating: row.rating, rd: row.rd, vol: row.vol };
    const u1 = glicko.update(u0, p0, solved ? 1 : 0);
    const p1 = glicko.update(p0, u0, solved ? 0 : 1);
    ratingDelta = Math.round(u1.rating - u0.rating);
    db.prepare('UPDATE users SET rating = ?, rd = ?, vol = ? WHERE id = ?')
      .run(u1.rating, u1.rd, u1.vol, user.id);
    db.prepare('UPDATE puzzles SET rating = ?, rd = ?, vol = ? WHERE id = ?')
      .run(p1.rating, p1.rd, p1.vol, row.id);
  }
  db.prepare(`UPDATE puzzles SET attempts = attempts + 1, solves = solves + ? WHERE id = ?`)
    .run(solved ? 1 : 0, row.id);
  db.prepare(`INSERT INTO attempts
                (user_id, puzzle_id, solved, rated, orders_used, line, perfect, damage_taken, units_lost)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(user.id, row.id, solved ? 1 : 0, rated ? 1 : 0, ordersUsed,
         JSON.stringify(line || []), perfect ? 1 : 0, damageTaken, unitsLost);

  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const unlocked = computeAchievements(db, user.id, true).achievements
    .filter(a => a.earned && !earnedBefore.has(a.id))
    .map(a => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc }));
  res.json({ solved, perfect, rated, ratingDelta, user: publicUser(fresh), unlocked,
             puzzleRating: Math.round(db.prepare('SELECT rating FROM puzzles WHERE id = ?')
               .get(row.id).rating) });
});

// Submissions: collected as-is into the review queue; admins verify locally.
app.post('/api/submit', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  const p = req.body && req.body.puzzle;
  if (!p || !String(p.name || '').trim() || !Array.isArray(p.units) || !p.objective || !p.orders) {
    return res.status(400).json({ error: 'incomplete puzzle' });
  }
  // the editor warns about this while you build (E.LIMITS); if one still
  // arrives, say WHICH limit and by how much rather than a bare "too large"
  const over = E.limitProblems(p);
  if (over.length) {
    return res.status(400).json({ error: 'too large: ' + over.join('; ') });
  }
  const blues = p.units.filter(u => u.player === 0);
  const reds = p.units.filter(u => u.player === 1);
  if (!blues.length || !reds.length) {
    return res.status(400).json({ error: 'a puzzle needs at least one unit on each side' });
  }
  if (p.objective.kind === 'killList' &&
      !(Array.isArray(p.objective.targets) && p.objective.targets.length &&
        p.objective.targets.every(i => p.units[i] && p.units[i].player === 1))) {
    return res.status(400).json({ error: 'killList objective needs valid enemy targets' });
  }
  if (!['killAll', 'killList', 'killTarget', 'capture', 'maxKill'].includes(p.objective.kind)) {
    return res.status(400).json({ error: 'unknown objective' });
  }
  // An author may name the order pool instead of taking par+slack. It must be
  // a whole number no smaller than par (a pool below the puzzle's own optimum
  // is unwinnable at par, and on killAll may be unwinnable at all), and it
  // must stay inside the same ceiling the editor offers. Absent means the
  // automatic rule, so an untouched field must not arrive as 0 or null.
  if (p.pool != null) {
    if (!Number.isInteger(p.pool) || p.pool < p.orders || p.pool > 120) {
      return res.status(400).json({ error: 'order pool must be a whole number between par (' + p.orders + ') and 120' });
    }
  }
  if (p.objective.kind === 'capture' &&
      !(p.tiles || []).some(t => t.city === 1)) {
    return res.status(400).json({ error: 'capture objective needs an enemy city tile' });
  }
  // does it even load? (broken tiles/targets throw) — cheap, synchronous
  try { E.loadPuzzle(p); } catch (e) {
    return res.status(400).json({ error: 'puzzle does not load: ' + e.message });
  }
  const slug = (p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) +
    '-' + crypto.randomBytes(3).toString('hex'));
  p.id = slug;
  p.author = user.name;
  // No server-side solving: submissions land in the review queue as-is and
  // are verified locally by the admins (the async worker gave silent fails).
  // the author's own play of the puzzle, recorded by Test play — the
  // reference solution a reviewer verifies against
  const sol = req.body && req.body.solution;
  let note = 'awaiting review';
  if (sol && Array.isArray(sol.line) && sol.line.length) {
    const check = replayLine(p, sol.line);
    note = JSON.stringify({
      claimed: { strength: sol.strength, orders: sol.orders, kills: sol.kills },
      replayed: { strength: check.strKilled, orders: check.ordersUsed, solved: check.solved },
      line: sol.line,
    });
  }
  db.prepare(`INSERT INTO puzzles (slug, json, status, author_id, author_name, rating, notes)
              VALUES (?, ?, 'pending', ?, ?, 1200, ?)`)
    .run(slug, JSON.stringify(p), user.id, user.name, note);
  if (DISCORD_WEBHOOK_URL) {
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `New puzzle submission: **${p.name}** by ${user.name}. Review: ${BASE_URL}/?p=${slug}` }),
    }).catch(() => {});
  }
  res.json({ ok: true, slug, status: 'pending',
    message: "Thanks for submitting your puzzle — we'll review it!" });
});

// your own submissions, whatever their status — so an author can revisit a
// puzzle they sent in, copy it into the editor and tweak it
app.get('/api/my-puzzles', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.json({ mine: [] });
  const rows = db.prepare(`
    SELECT slug, json, status, created_at, solves FROM puzzles
    WHERE author_id = ? ORDER BY created_at DESC`).all(user.id);
  res.json({
    mine: rows.map(r => ({
      slug: r.slug, name: JSON.parse(r.json).name, status: r.status,
      at: r.created_at, solves: r.solves,
    })),
  });
});

// The editor hands a draft to the player and the player hands a recorded line
// back, historically through localStorage alone. When that write fails — private
// browsing, storage partitioning, a wiped origin — the author is told to play a
// turn they just played, with no way to tell why. Keep a copy server-side.
app.post('/api/draft-solution', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  const body = req.body || {};
  if (!body.puzzle || !Array.isArray(body.line)) return res.status(400).json({ error: 'bad recording' });
  db.prepare(`INSERT INTO draft_solutions (user_id, json, created_at)
              VALUES (?, ?, datetime('now'))
              ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`)
    .run(user.id, JSON.stringify(body));
  res.json({ ok: true });
});

app.get('/api/draft-solution', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.json({ solution: null });
  const row = db.prepare('SELECT json FROM draft_solutions WHERE user_id = ?').get(user.id);
  res.json({ solution: row ? JSON.parse(row.json) : null });
});

// the author's side of the review queue: pull a pending submission back
// (a wrong draft, a duplicate) without waiting for an admin to reject it
app.post('/api/withdraw/:slug', (req, res) => {
  const r = withdrawSubmission(db, userFromReq(req), req.params.slug);
  if (!r.ok) return res.status(r.code).json({ error: r.error });
  res.json({ ok: true, status: r.status });
});

app.get('/api/submit-status/:slug', (req, res) => {
  const row = db.prepare('SELECT slug, status, notes, author_id FROM puzzles WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ slug: row.slug, status: row.status, notes: row.notes });
});


// review queue (admin)
app.get('/api/review', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  const rows = db.prepare(`SELECT id, slug, json, author_name, created_at, notes FROM puzzles WHERE status = 'pending'`).all();
  res.json({
    pending: rows.map(r => {
      // the author's own recorded line, so a reviewer can watch what they did
      // rather than trying to infer it from the board
      let sol = null;
      try { sol = JSON.parse(r.notes); } catch (e) {}
      return {
        id: r.id, slug: r.slug, puzzle: JSON.parse(r.json),
        author: r.author_name, at: r.created_at,
        solution: sol && sol.line ? sol : null,
      };
    }),
  });
});
app.post('/api/review/:slug', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  const verdict = req.body && req.body.approve ? 'approved' : 'rejected';
  // A maxKill draft has no ceiling — the review sets it. Approving one bare
  // would publish a puzzle that cannot score anybody, so default the ceiling
  // to the author's replay-verified strength (best-known until proven).
  if (verdict === 'approved') {
    const row = db.prepare(`SELECT id, json, notes FROM puzzles WHERE slug = ? AND status = 'pending'`).get(req.params.slug);
    if (row) {
      const p = JSON.parse(row.json);
      if (p.objective && p.objective.kind === 'maxKill' && !p.objective.count) {
        let claimed = 0;
        try { claimed = JSON.parse(row.notes).replayed.strength || 0; } catch (e) {}
        if (claimed > 0) {
          p.objective.count = claimed;
          db.prepare('UPDATE puzzles SET json = ? WHERE id = ?').run(JSON.stringify(p), row.id);
        }
      }
    }
  }
  db.prepare(`UPDATE puzzles SET status = ? WHERE slug = ? AND status = 'pending'`).run(verdict, req.params.slug);
  res.json({ ok: true, status: verdict });
});

app.get('/api/admin/records', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  // sweep first: a record the library has already answered is not a review
  // item, and leaving it in the queue buries the ones that are
  retireSupersededRecords(db);
  const rows = db.prepare(`
    SELECT r.*, u.name player, p.slug, p.json, p.status pstatus FROM records r
    JOIN users u ON u.id = r.user_id JOIN puzzles p ON p.id = r.puzzle_id
    WHERE r.status = 'new' ORDER BY r.created_at DESC`).all();
  res.json({
    records: rows.map(r => ({
      id: r.id, player: r.player, slug: r.slug, core: r.pstatus === 'core',
      name: (() => { try { return JSON.parse(r.json).name; } catch (e) { return r.slug; } })(),
      kind: r.kind, strKilled: r.str_killed, ordersUsed: r.orders_used,
      parOrders: r.par_orders, parCount: r.par_count, at: r.created_at,
      line: JSON.parse(r.line),
    })),
  });
});

app.post('/api/admin/records/:id', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  const verdict = req.body && req.body.accept ? 'accepted' : 'rejected';
  const rec = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  let folded = null, warning = null;
  if (verdict === 'accepted' && rec) {
    // 'Fold in' must actually fold: the record's line beat the published
    // answer, so the puzzle's numbers move to match it. For an orders record
    // par tightens; for a strength record the maxKill ceiling rises (and par
    // becomes that line's orders). The line was replay-verified when the
    // attempt landed — accepting is a human judgement, not a re-check.
    const prow = db.prepare('SELECT id, json, slug, status FROM puzzles WHERE id = ?').get(rec.puzzle_id);
    if (prow) {
      const pz = JSON.parse(prow.json);
      if (rec.kind === 'orders' && rec.orders_used < pz.orders) {
        folded = { par: [pz.orders, rec.orders_used] };
        pz.orders = rec.orders_used;
      } else if (rec.kind === 'strength' && pz.objective && pz.objective.kind === 'maxKill' &&
                 rec.str_killed > (pz.objective.count || 0)) {
        folded = { ceiling: [pz.objective.count, rec.str_killed], par: [pz.orders, rec.orders_used] };
        pz.objective.count = rec.str_killed;
        pz.orders = rec.orders_used;
      }
      if (folded) db.prepare('UPDATE puzzles SET json = ? WHERE id = ?').run(JSON.stringify(pz), prow.id);
      // A core puzzle is seeded from web/puzzles.js on every boot, and par and
      // ceiling are both inside puzzleHash — so a fold that lives only in the
      // DB is not just reverted at the next deploy, it retires the row and
      // takes every solve on it with it (server/db.js:56-107). The fold is
      // real until then; the repo has to catch up.
      if (folded && prow.status === 'core') {
        warning = `${prow.slug} is a CORE puzzle: mirror this into web/puzzles.js ` +
          `(orders: ${pz.orders}${folded.ceiling ? ', objective.count: ' + pz.objective.count : ''}) ` +
          `and deploy, or the next boot reverts it and retires the row with its solves.`;
        console.warn('record fold on core puzzle — ' + warning);
      }
    }
  }
  db.prepare('UPDATE records SET status = ? WHERE id = ?').run(verdict, req.params.id);
  // the fold moved the numbers: whatever else was queued against the old ones
  // has now been answered
  const superseded = rec ? retireSupersededRecords(db, rec.puzzle_id) : 0;
  res.json({ ok: true, status: verdict, folded, superseded, warning });
});

app.get('/api/admin/stats', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  const showAll = req.query.all === '1';
  const puzzles = db.prepare(`
    SELECT slug, json, status, author_name, rating, rd, attempts, solves, created_at
    FROM puzzles ${showAll ? '' : `WHERE status IN ('core','approved','pending')`}
    ORDER BY rating DESC`).all().map(r => {
      const p = JSON.parse(r.json);
      return {
        slug: r.slug, name: p.name, status: r.status,
        author: r.author_name, rating: Math.round(r.rating), rd: Math.round(r.rd),
        attempts: r.attempts, solves: r.solves,
        // the published answer, so a folded record is visible on the same page
        // that folded it. A maxKill with no count has no answer yet
        // (objectiveScorable, engine.js:1206) — nobody can win it.
        parOrders: p.orders,
        parCount: p.objective && p.objective.kind === 'maxKill'
          ? (p.objective.count || null) : undefined,
        // the raw kind, so it matches the json an admin is about to read, plus
        // the one sentence players are shown (engine.js:objectiveText) rather
        // than a second wording of the same six rules
        objective: p.objective && p.objective.kind,
        objectiveText: E.objectiveText(p.objective, p),
        targets: p.objective && p.objective.targets ? p.objective.targets.length : undefined,
      };
    });
  const users = db.prepare(`
    SELECT u.name, u.rating, u.rd, u.created_at,
      (SELECT COUNT(DISTINCT puzzle_id) FROM attempts a
        WHERE a.user_id = u.id AND a.solved = 1 AND ${LIVE}) solved,
      (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) attempts
    FROM users u ORDER BY u.rating DESC`).all().map(r => ({
      name: r.name, rating: Math.round(r.rating), rd: Math.round(r.rd),
      solved: r.solved, attempts: r.attempts, since: r.created_at,
    }));
  res.json({ puzzles, users, filtered: !showAll });
});

app.get('/api/leaderboard', (req, res) => {
  const users = db.prepare(`
    SELECT name, avatar, rating, rd,
      (SELECT COUNT(DISTINCT puzzle_id) FROM attempts a
        WHERE a.user_id = users.id AND solved = 1 AND ${LIVE}) solved
    FROM users WHERE rd < 250 ORDER BY rating DESC LIMIT 50`).all();
  res.json({ users: users.map(u => ({ name: u.name, avatar: u.avatar, rating: Math.round(u.rating), solved: u.solved })) });
});

// Hall of Fame: ranked by puzzles COMPLETED (not rating). Open to anyone
// signed in; ties break on perfect solves, then earliest joiner.
app.get('/api/hall', (req, res) => {
  const user = userFromReq(req); // optional — the hall is public
  const rows = db.prepare(`
    SELECT u.id, u.name, u.avatar, u.discord_id, u.rating, u.created_at,
      (SELECT COUNT(DISTINCT puzzle_id) FROM attempts a
        WHERE a.user_id = u.id AND a.solved = 1 AND ${LIVE}) solved,
      (SELECT COUNT(DISTINCT puzzle_id) FROM attempts a
        WHERE a.user_id = u.id AND a.solved = 1 AND a.perfect = 1 AND ${LIVE}) perfect,
      (SELECT COUNT(*) FROM puzzles p
        WHERE p.author_id = u.id AND p.status = 'approved') authored
    FROM users u
    -- ties are ordered by (hidden) rating, then seniority; the rank itself is
    -- still shared, so equal records share a place
    ORDER BY solved DESC, perfect DESC, u.rating DESC, u.created_at ASC LIMIT 100`).all();
  const total = db.prepare(
    `SELECT COUNT(*) n FROM puzzles WHERE status IN ('core','approved')`).get().n;
  // Standard competition ranking: equal (solved, perfect) shares a rank and
  // the next distinct score skips ahead — two players on 36/36 are BOTH 1st.
  const ranked = rows.filter(r => r.solved > 0);
  let lastKey = null, lastRank = 0;
  const players = ranked.map((r, i) => {
    const key = r.solved + ':' + r.perfect;
    if (key !== lastKey) { lastRank = i + 1; lastKey = key; }
    return {
      rank: lastRank, name: r.name, avatar: avatarUrl(r.discord_id, r.avatar, 64),
      solved: r.solved, perfect: r.perfect, authored: r.authored,
      me: !!user && r.id === user.id,
      // player Elo is private: only ever disclosed to the player themselves
      rating: (!!user && r.id === user.id) ? Math.round(r.rating) : undefined,
    };
  });
  res.json({ total, players });
});

// Profile + achievement gallery. Defaults to the signed-in player.
app.get('/api/profile', (req, res) => {
  const user = userFromReq(req); // optional — named profiles are public
  const name = req.query.name;
  if (!name && !user) return res.status(401).json({ error: 'sign in to see your own profile' });
  const target = name
    ? db.prepare('SELECT * FROM users WHERE name = ?').get(name)
    : user;
  if (!target) return res.status(404).json({ error: 'no such player' });
  const { achievements, stats } = computeAchievements(db, target.id, true);
  // every puzzle this player has defeated, hardest (highest rated) first —
  // puzzle Elo is only disclosed for puzzles you have actually beaten
  // ratings in the conquest list are only shown for puzzles the VIEWER has
  // beaten — reading someone else's profile must not disclose them
  const viewerBeat = new Set(user ? db.prepare(`
    SELECT p.slug FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
    WHERE a.user_id = ? AND a.solved = 1`).all(user.id).map(r => r.slug) : []);
  const conquests = db.prepare(`
    SELECT p.slug, p.json, p.rating, MAX(a.perfect) perfect,
           MIN(a.orders_used) orders_used, MIN(a.created_at) first_at
    FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
    WHERE a.user_id = ? AND a.solved = 1 AND ${LIVE}
    GROUP BY p.id ORDER BY p.rating DESC`).all(target.id)
    .map(r => ({
      slug: r.slug,
      name: (() => { try { return JSON.parse(r.json).name; } catch (e) { return r.slug; } })(),
      rating: viewerBeat.has(r.slug) ? Math.round(r.rating) : undefined,
      perfect: !!r.perfect,
      orders: r.orders_used, at: r.first_at,
    }));
  const recent = conquests.slice().sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 8);
  // puzzles this player made, so a profile links to their work
  const authored = db.prepare(`
    SELECT slug, json, solves, rating FROM puzzles
    WHERE author_id = ? AND status = 'approved' ORDER BY created_at`).all(target.id)
    .map(r => ({
      slug: r.slug,
      name: (() => { try { return JSON.parse(r.json).name; } catch (e) { return r.slug; } })(),
      solves: r.solves,
      rating: viewerBeat.has(r.slug) ? Math.round(r.rating) : undefined,
    }));
  res.json({
    player: {
      name: target.name, avatar: avatarUrl(target.discord_id, target.avatar, 128),
      since: target.created_at, me: !!user && target.id === user.id,
      // private: your rating is yours alone
      rating: (!!user && target.id === user.id) ? Math.round(target.rating) : undefined,
      unitArt: (!!user && target.id === user.id) ? (target.pref_unit_art || null) : undefined,
    },
    stats, achievements, recent, conquests, authored,
  });
});

// serve a submitted/approved puzzle definition to the play page
app.get('/api/puzzle/:slug', (req, res) => {
  const user = userFromReq(req);
  const row = db.prepare('SELECT * FROM puzzles WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  // Only the live library is playable by URL. Anything else — awaiting review,
  // rejected, or withdrawn at the author's request — is visible just to its
  // author and to admins, so an old link cannot resurrect an unpublished puzzle.
  if (row.status !== 'core' && row.status !== 'approved' &&
      !(user && (user.is_admin || user.id === row.author_id))) {
    return res.status(403).json({
      error: row.status === 'pending' ? 'pending review' : 'this puzzle is not published',
    });
  }
  const beaten = user && db.prepare(
    'SELECT 1 FROM attempts WHERE user_id = ? AND puzzle_id = ? AND solved = 1 LIMIT 1')
    .get(user.id, row.id);
  res.json({
    slug: row.slug, puzzle: JSON.parse(row.json), status: row.status,
    rating: beaten ? Math.round(row.rating) : undefined,
  });
});

app.listen(PORT, () => console.log(`owpuzzle server on :${PORT}`));
