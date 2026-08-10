// Achievement gallery: everything is derived from the attempts table, so a
// player's badges follow their account, not a browser. Each entry reports
// progress (n of target) whether or not it is earned, so locked badges still
// show how close you are.
//
// Only LIVE puzzles count. A retired version (slug@vN, left behind when a
// puzzle is edited) is a different puzzle, so old solves on it must never
// inflate totals or badges.
'use strict';

const LIVE = `puzzle_id IN (SELECT id FROM puzzles WHERE status IN ('core','approved'))`;

function computeAchievements(db, userId) {
  const one = (sql, ...a) => db.prepare(sql).get(...a) || {};
  const all = (sql, ...a) => db.prepare(sql).all(...a);

  // --- raw stats -----------------------------------------------------------
  const solvedTotal = one(
    `SELECT COUNT(DISTINCT puzzle_id) n FROM attempts
     WHERE user_id = ? AND solved = 1 AND ${LIVE}`, userId).n || 0;

  const perfectTotal = one(
    `SELECT COUNT(DISTINCT puzzle_id) n FROM attempts
     WHERE user_id = ? AND solved = 1 AND perfect = 1 AND ${LIVE}`, userId).n || 0;

  const cleanTotal = one(
    `SELECT COUNT(DISTINCT puzzle_id) n FROM attempts
     WHERE user_id = ? AND solved = 1 AND damage_taken = 0 AND ${LIVE}`, userId).n || 0;

  // hit par on the very first (rated) attempt at a puzzle
  const firstTryPerfect = one(
    `SELECT COUNT(*) n FROM attempts
     WHERE user_id = ? AND solved = 1 AND perfect = 1 AND rated = 1 AND ${LIVE}`, userId).n || 0;

  // came back and beat a puzzle that had beaten them
  const comebacks = one(
    `SELECT COUNT(*) n FROM (
       SELECT puzzle_id FROM attempts WHERE user_id = ? AND solved = 1 AND ${LIVE}
       INTERSECT
       SELECT puzzle_id FROM attempts WHERE user_id = ? AND solved = 0 AND ${LIVE})`,
    userId, userId).n || 0;

  const distinctDays = one(
    `SELECT COUNT(DISTINCT date(created_at)) n FROM attempts
     WHERE user_id = ? AND solved = 1 AND ${LIVE}`, userId).n || 0;

  const bestDay = one(
    `SELECT COUNT(DISTINCT puzzle_id) n FROM attempts
     WHERE user_id = ? AND solved = 1 AND ${LIVE}
     GROUP BY date(created_at) ORDER BY n DESC LIMIT 1`, userId).n || 0;

  // authoring
  const authored = one(
    `SELECT COUNT(*) n FROM puzzles WHERE author_id = ? AND status = 'approved'`, userId).n || 0;
  const authoredSolvers = one(
    `SELECT COUNT(DISTINCT a.user_id) n FROM attempts a
     JOIN puzzles p ON p.id = a.puzzle_id
     WHERE p.author_id = ? AND p.status = 'approved' AND a.solved = 1 AND a.user_id != ?`,
    userId, userId).n || 0;

  // coverage against the CURRENT live library
  const live = all(`SELECT id, slug, json, status FROM puzzles WHERE status IN ('core','approved')`)
    .map(r => { let p = {}; try { p = JSON.parse(r.json); } catch (e) {} return { ...r, p }; });
  const solvedIds = new Set(all(
    `SELECT DISTINCT puzzle_id id FROM attempts
     WHERE user_id = ? AND solved = 1 AND ${LIVE}`, userId).map(r => r.id));
  const cover = (filter) => {
    const set = live.filter(filter);
    return { done: set.filter(r => solvedIds.has(r.id)).length, total: set.length };
  };
  const core = cover(r => r.status === 'core');
  const challenges = cover(r => r.status === 'core' && (r.p.difficulty || 2) === 3);
  const community = cover(r => r.status === 'approved');
  const maxKill = cover(r => (r.p.objective || {}).kind === 'maxKill');

  // --- the gallery ---------------------------------------------------------
  const defs = [
    ['🩸', 'first-blood', 'First Blood', 'Solve your first puzzle.', solvedTotal, 1],
    ['⚔️', 'veteran', 'Veteran', 'Solve 10 puzzles.', solvedTotal, 10],
    ['🏛️', 'consul', 'Consul', 'Solve 25 puzzles.', solvedTotal, 25],
    ['👑', 'completionist', 'Completionist', 'Solve every puzzle in the core library.',
      core.done, core.total || 1],
    ['🧗', 'challenger', 'Challenger', 'Solve every Challenge-tier puzzle.',
      challenges.done, challenges.total || 1],
    ['🤝', 'good-company', 'Good Company', 'Solve every community-made puzzle.',
      community.done, community.total || 1],
    ['⭐', 'perfectionist', 'Perfectionist', 'Solve 5 puzzles at par.', perfectTotal, 5],
    ['🌟', 'flawless', 'Flawless', 'Solve 20 puzzles at par.', perfectTotal, 20],
    ['🎯', 'first-sight', 'At First Sight', 'Hit par on your very first attempt at a puzzle.',
      firstTryPerfect, 1],
    ['🛡️', 'untouchable', 'Untouchable', 'Win a puzzle without taking a single point of damage.',
      cleanTotal, 1],
    ['🪖', 'not-a-scratch', 'Not a Scratch', 'Win 10 puzzles without taking damage.', cleanTotal, 10],
    ['💀', 'butcher', 'Butcher', 'Reach the destruction ceiling on 3 open-slaughter puzzles.',
      maxKill.done, Math.min(3, maxKill.total || 3)],
    ['🔁', 'stubborn', 'Stubborn', 'Come back and beat a puzzle that beat you.', comebacks, 1],
    ['⚡', 'blitz', 'Blitz', 'Solve 5 puzzles in a single day.', bestDay, 5],
    ['📅', 'campaigner', 'Campaigner', 'Solve puzzles on 5 different days.', distinctDays, 5],
    ['📜', 'architect', 'Architect', 'Get a puzzle of your own approved.', authored, 1],
    ['🎖️', 'beloved', 'Beloved', 'Have 5 different players solve a puzzle you made.',
      authoredSolvers, 5],
  ];

  const list = defs.map(([icon, id, name, desc, progress, target]) => ({
    id, icon, name, desc,
    progress: Math.min(progress, target), target,
    earned: progress >= target,
  }));

  return {
    achievements: list,
    stats: {
      solved: solvedTotal, perfect: perfectTotal, clean: cleanTotal,
      days: distinctDays, bestDay, authored,
      core, challenges, community,
    },
  };
}

module.exports = { computeAchievements, LIVE };
