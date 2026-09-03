'use strict';
// An author's own submissions after they are sent in. Withdrawing is the
// author's side of the review queue: a draft they no longer stand behind
// (four revisions of one board arrived in fifty minutes once) leaves the
// queue without an admin having to reject it. Only a PENDING row can be
// withdrawn — a published puzzle has solves and ratings hanging off it, so
// taking it down is an admin decision, not a click.
//
// The row is kept with status 'withdrawn' rather than deleted: the author
// can still open it in the editor (/api/my-puzzles lists every status) and
// resubmit, and /api/puzzle/:slug already hides non-live rows from anyone
// but the author and admins.

// -> { ok: true, status } | { ok: false, code, error }
function withdrawSubmission(db, user, slug) {
  if (!user) return { ok: false, code: 401, error: 'not logged in' };
  const row = db.prepare('SELECT id, status, author_id FROM puzzles WHERE slug = ?').get(slug);
  // a stranger learns nothing, not even that the slug exists
  if (!row || row.author_id !== user.id) return { ok: false, code: 404, error: 'not found' };
  if (row.status === 'withdrawn') return { ok: true, status: 'withdrawn' };
  if (row.status !== 'pending') {
    return { ok: false, code: 409,
      error: row.status === 'rejected'
        ? 'this submission was already reviewed'
        : 'this puzzle is published — ask an admin to take it down' };
  }
  db.prepare(`UPDATE puzzles SET status = 'withdrawn' WHERE id = ? AND status = 'pending'`).run(row.id);
  return { ok: true, status: 'withdrawn' };
}

module.exports = { withdrawSubmission };
