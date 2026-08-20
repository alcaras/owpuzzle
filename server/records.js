'use strict';
// Records: player lines that beat the published answer. Written by
// /api/attempt, reviewed by hand in the admin panel, never applied on their
// own — a record is either a better solution to fold in or a bug that let it
// through, and only a human can tell which.
//
// A record is a claim about the numbers AS PUBLISHED WHEN IT LANDED. Folding
// one in moves those numbers, which silently answers every other record on
// that puzzle: five players found the same 16-order line on Two Points Short,
// so one fold left four rows claiming to beat a par that had become 16. The
// queue must not ask an admin to dismiss the same discovery five times.

// Does this result beat what the puzzle currently publishes? Returns the kind
// of record it is, or null. For a maxKill that means more strength than the
// ceiling, or the ceiling in fewer orders; for the rest, solving inside par.
function beatsPublished(puzzle, r) {
  if (!puzzle || !puzzle.objective) return null;
  if (puzzle.objective.kind === 'maxKill') {
    const ceiling = puzzle.objective.count || 0;
    if (r.strKilled > ceiling) return 'strength';
    if (r.strKilled === ceiling && ceiling > 0 && r.ordersUsed < puzzle.orders) return 'orders';
    return null;
  }
  return r.solved && r.ordersUsed < puzzle.orders ? 'orders' : null;
}

// Mark every open record that the current library has already answered.
// Two ways that happens: the numbers moved past it (someone else's line was
// folded in, or its own was), or its puzzle is no longer live — retired or
// reseeded out from under it, so there is nothing left to fold into. Pass a
// puzzle id to sweep just that puzzle after a fold; omit it to sweep all.
//
// `solved` is asserted, not re-derived: a record is only ever written for a
// line that solved, and that line was replay-verified when the attempt landed
// (server/index.js:/api/attempt). Staleness only ever comes from the numbers.
function retireSupersededRecords(db, puzzleId) {
  const rows = db.prepare(`
    SELECT r.id, r.str_killed, r.orders_used, p.json, p.status pstatus
      FROM records r JOIN puzzles p ON p.id = r.puzzle_id
     WHERE r.status = 'new'` + (puzzleId ? ' AND r.puzzle_id = ?' : ''))
    .all(...(puzzleId ? [puzzleId] : []));
  const mark = db.prepare(`UPDATE records SET status = 'superseded' WHERE id = ?`);
  let n = 0;
  for (const r of rows) {
    let stands = false;
    if (r.pstatus === 'core' || r.pstatus === 'approved') {
      try {
        stands = !!beatsPublished(JSON.parse(r.json),
          { solved: true, strKilled: r.str_killed, ordersUsed: r.orders_used });
      } catch (e) { stands = false; }
    }
    if (!stands) { mark.run(r.id); n++; }
  }
  return n;
}

module.exports = { beatsPublished, retireSupersededRecords };
