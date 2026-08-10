// owpuzzle server: static site + rated puzzle API + Discord auth + submissions.
// Attempts are SERVER-VERIFIED: the client sends its action line and we replay
// it through the same engine.js the browser uses.
'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { db, seedCorePuzzles, backfillAttempts } = require('./db');
const { computeAchievements, LIVE } = require('./achievements');
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
const backfilled = backfillAttempts((puzzle, line) => replayLine(puzzle, line));
if (backfilled) console.log(`backfilled ${backfilled} attempt rows`);
console.log(`seeded ${seeded} core puzzles`);

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'web')));

// ---------- sessions ----------
function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
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
    name: u.name, avatar: u.avatar, rating: Math.round(u.rating),
    rd: Math.round(u.rd), isAdmin: !!u.is_admin,
    coreSolved: coreSolvedCount(u.id), coreTotal: coreCount(),
    canSubmit: true, completedAll: completedAll(u),
  };
}

// Replay the client's action line through the real engine. The server is the
// referee: "solved" is whatever the replay says, nothing else.
function replayLine(puzzle, line) {
  let s = E.loadPuzzle(puzzle, { play: true }); // same forgiving pool the client plays with
  if (!Array.isArray(line) || line.length > 100) return { solved: false, ordersUsed: 0 };
  try {
    for (const a of line) s = E.applyAction(s, a);
  } catch (e) {
    return { solved: false, ordersUsed: puzzle.orders - s.orders };
  }
  const pool = E.poolOrders(puzzle);
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
  };
}

// ---------- API ----------
app.get('/api/me', (req, res) => res.json({ user: publicUser(userFromReq(req)) }));

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
      author: r.author_name, rating: Math.round(r.rating),
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
  const eligible = rows.filter(r => {
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
    rating: Math.round(pick.rating),
    rated: !pick.last_attempt,                                // only first attempt is rated
  });
});

app.post('/api/attempt', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  const { slug, line } = req.body || {};
  const row = db.prepare(`SELECT * FROM puzzles WHERE slug = ? AND status IN ('core','approved')`).get(slug);
  if (!row) return res.status(404).json({ error: 'unknown puzzle' });
  const puzzle = JSON.parse(row.json);
  const { solved, ordersUsed, perfect, damageTaken, unitsLost } = replayLine(puzzle, line);

  // achievement snapshot BEFORE this attempt lands, to diff what it unlocked
  const earnedBefore = new Set(
    computeAchievements(db, user.id).achievements.filter(a => a.earned).map(a => a.id));

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
  const unlocked = computeAchievements(db, user.id).achievements
    .filter(a => a.earned && !earnedBefore.has(a.id))
    .map(a => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc }));
  res.json({ solved, perfect, rated, ratingDelta, user: publicUser(fresh), unlocked });
});

// Submissions: collected as-is into the review queue; admins verify locally.
app.post('/api/submit', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'not logged in' });
  const p = req.body && req.body.puzzle;
  if (!p || !String(p.name || '').trim() || !Array.isArray(p.units) || !p.objective || !p.orders) {
    return res.status(400).json({ error: 'incomplete puzzle' });
  }
  if (p.units.length > 12 || (p.radius || 3) > 5) {
    return res.status(400).json({ error: 'too large (max 12 units, radius 5)' });
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
  db.prepare(`INSERT INTO puzzles (slug, json, status, author_id, author_name, rating, notes)
              VALUES (?, ?, 'pending', ?, ?, 1200, 'awaiting review')`)
    .run(slug, JSON.stringify(p), user.id, user.name);
  if (DISCORD_WEBHOOK_URL) {
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `New puzzle submission: **${p.name}** by ${user.name}. Review: ${BASE_URL}/?p=${slug}` }),
    }).catch(() => {});
  }
  res.json({ ok: true, slug, status: 'pending',
    message: "Thanks for submitting your puzzle — we'll review it!" });
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
  const rows = db.prepare(`SELECT id, slug, json, author_name, created_at FROM puzzles WHERE status = 'pending'`).all();
  res.json({ pending: rows.map(r => ({ id: r.id, slug: r.slug, puzzle: JSON.parse(r.json), author: r.author_name, at: r.created_at })) });
});
app.post('/api/review/:slug', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  const verdict = req.body && req.body.approve ? 'approved' : 'rejected';
  db.prepare(`UPDATE puzzles SET status = ? WHERE slug = ? AND status = 'pending'`).run(verdict, req.params.slug);
  res.json({ ok: true, status: verdict });
});

app.get('/api/admin/stats', (req, res) => {
  const user = userFromReq(req);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'admin only' });
  const showAll = req.query.all === '1';
  const puzzles = db.prepare(`
    SELECT slug, json, status, author_name, rating, rd, attempts, solves, created_at
    FROM puzzles ${showAll ? '' : `WHERE status IN ('core','approved','pending')`}
    ORDER BY rating DESC`).all().map(r => ({
      slug: r.slug, name: JSON.parse(r.json).name, status: r.status,
      author: r.author_name, rating: Math.round(r.rating), rd: Math.round(r.rd),
      attempts: r.attempts, solves: r.solves,
    }));
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
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'sign in to see the hall of fame' });
  const rows = db.prepare(`
    SELECT u.id, u.name, u.avatar, u.rating, u.created_at,
      (SELECT COUNT(DISTINCT puzzle_id) FROM attempts a
        WHERE a.user_id = u.id AND a.solved = 1 AND ${LIVE}) solved,
      (SELECT COUNT(DISTINCT puzzle_id) FROM attempts a
        WHERE a.user_id = u.id AND a.solved = 1 AND a.perfect = 1 AND ${LIVE}) perfect,
      (SELECT COUNT(*) FROM puzzles p
        WHERE p.author_id = u.id AND p.status = 'approved') authored
    FROM users u ORDER BY solved DESC, perfect DESC, u.created_at ASC LIMIT 100`).all();
  const total = db.prepare(
    `SELECT COUNT(*) n FROM puzzles WHERE status IN ('core','approved')`).get().n;
  res.json({
    total,
    players: rows.filter(r => r.solved > 0).map((r, i) => ({
      rank: i + 1, name: r.name, avatar: r.avatar, solved: r.solved,
      perfect: r.perfect, authored: r.authored, rating: Math.round(r.rating),
      me: r.id === user.id,
    })),
  });
});

// Profile + achievement gallery. Defaults to the signed-in player.
app.get('/api/profile', (req, res) => {
  const user = userFromReq(req);
  if (!user) return res.status(401).json({ error: 'sign in to see profiles' });
  const name = req.query.name;
  const target = name
    ? db.prepare('SELECT * FROM users WHERE name = ?').get(name)
    : user;
  if (!target) return res.status(404).json({ error: 'no such player' });
  const { achievements, stats } = computeAchievements(db, target.id);
  const recent = db.prepare(`
    SELECT p.slug, p.json, a.solved, a.perfect, a.orders_used, a.created_at
    FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id
    WHERE a.user_id = ? AND a.solved = 1 AND ${LIVE}
    GROUP BY p.id ORDER BY a.created_at DESC LIMIT 8`).all(target.id)
    .map(r => ({
      slug: r.slug, name: (() => { try { return JSON.parse(r.json).name; } catch (e) { return r.slug; } })(),
      perfect: !!r.perfect, orders: r.orders_used, at: r.created_at,
    }));
  res.json({
    player: {
      name: target.name, avatar: target.avatar, rating: Math.round(target.rating),
      since: target.created_at, me: target.id === user.id,
    },
    stats, achievements, recent,
  });
});

// serve a submitted/approved puzzle definition to the play page
app.get('/api/puzzle/:slug', (req, res) => {
  const user = userFromReq(req);
  const row = db.prepare('SELECT * FROM puzzles WHERE slug = ?').get(req.params.slug);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.status === 'pending' && !(user && (user.is_admin || user.id === row.author_id))) {
    return res.status(403).json({ error: 'pending review' });
  }
  res.json({ slug: row.slug, puzzle: JSON.parse(row.json), status: row.status, rating: Math.round(row.rating) });
});

app.listen(PORT, () => console.log(`owpuzzle server on :${PORT}`));
