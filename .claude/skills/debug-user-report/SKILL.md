---
name: debug-user-report
description: >
  Debug a player or author bug report by reproducing THEIR exact
  configuration first — auth state, device class, storage state, code
  vintage — before reading any code. Use for any "it broke for someone"
  report from Discord or the admin panel.
---

# Debug a user report

The lesson this skill encodes was paid for: bugs here have repeatedly been
"impossible" in the developer configuration and trivial in the user's. An
author was told their unchanged puzzle changed (stale cached app.js vs fresh
editor.js); the review queue vanished only for an admin, only on the library
page (a ReferenceError swallowed by an empty `.catch`); a recording
vanished only for browsers that could not keep localStorage. **Reproduce
their configuration before forming a theory.**

## Step 1 — capture the configuration (ask, or infer from the report)

- **Signed in or not?** Auth changes the code path everywhere: first paint,
  next-puzzle source, attempt posting, draft server-fallback.
- **Touch or mouse?** `CAN_HOVER` (`app.js:731`) forks the whole
  interaction model: arming taps vs hover previews, info cards on tap.
- **Which page pair?** Editor bugs are usually player-page bugs and vice
  versa — the draft flow spans both, plus five storage keys
  (`owpuzzle-draft`, `owpuzzle-draft-solution`, `owpuzzle-editor-autosave`,
  `owpuzzle-loaded-slug`, `owpuzzle-progress`).
- **Code vintage.** Could they be holding a cached file? (Served no-cache
  now, but PWA-ish browser quirks and long-lived tabs still happen. "Have
  they reloaded since the last deploy?" is question one.)
- **Admin or regular?** The review queue and its races exist only for
  admins; several past bugs were admin-only.
- **Which puzzle exactly** — core, community, retired-version (`slug@vN`),
  or draft? Community puzzles load via fetch, core ones from puzzles.js;
  different failure modes.

## Step 2 — get the replayable evidence

Almost every action in the system leaves a replayable line. Pull it before
theorising:

```sh
fly ssh console -C "node -e \"
  const { db } = require('/app/server/db.js');
  // their recent attempts, with lines
  console.log(JSON.stringify(db.prepare(
    'SELECT a.id, p.slug, a.solved, a.orders_used, a.line, a.created_at \
     FROM attempts a JOIN puzzles p ON p.id = a.puzzle_id \
     JOIN users u ON u.id = a.user_id WHERE u.name = ? \
     ORDER BY a.id DESC LIMIT 10').all('THEIR_NAME'), null, 1));
\""
```

Other stores: `records` (better-than-par lines, also visible in
admin.html), `draft_solutions` (their last draft recording), `puzzles.notes`
(a submission's recorded solution). `tools/snarf.sh` pulls pending
submissions wholesale.

## Step 3 — split engine from UI with a node replay

```sh
node -e "
  const E = require('./web/engine.js');
  const puzzle = /* their puzzle json */;
  let s = E.loadPuzzle(puzzle, { play: true });
  for (const a of /* their line */) s = E.applyAction(s, a);
  console.log(E.strKilledOf(s), E.checkObjective(s, puzzle.objective), s.log);
"
```

- Replays wrong in node too → engine question → switch to
  add-engine-mechanic (read the C#, citation test first). If it is a
  better-than-par record, it may be a *better solution*, not a bug — step
  it in the browser (`/?p=<slug>&review=1` for pending; manual replay
  otherwise) and judge, per review-community-puzzle.
- Replays fine in node, breaks in the browser → UI/wiring bug → step 4.

## Step 4 — reproduce in the browser, their way

- Match device class with devtools emulation (touch on!), match auth state,
  and match storage: private windows for "storage blocked", pre-seeded
  localStorage keys for handoff states.
- **Watch the console with empty-catch suspicion.** The codebase has many
  `catch(function(){})`s; a feature that "just isn't there" (a missing
  section, a dead button) is the signature of a swallowed rejection.
  Playwright's `pageerror` hook (see `test/e2e/draft-flow.py`) catches
  what the eye misses.
- For paint/race reports ("sometimes the X section is missing"): throttle
  the network so the 700 ms first-paint timer (`app.js:258`) fires before
  the fetches land — that ordering is a distinct code path.

## Step 5 — fix under a regression test

Fix the bug where it lives, and leave a test at the right layer
(docs/testing-strategy.md): engine → cited rules test; page logic → node
unit test on the extracted function; wiring → extend an e2e flow. A
source-order grep test is a last resort and must be listed for deletion in
testing-strategy's table.

## Verification gate

- [ ] reproduced in the reporter's configuration, not just yours
- [ ] evidence line replayed in node to locate the layer
- [ ] regression test added at that layer; `npm test` green
- [ ] reporter's exact scenario re-run clean after the fix

## Known traps

- The bug report's *wording* often blames the wrong actor — "you changed my
  puzzle" was version skew; "my recording vanished" was blocked storage.
  Error messages that accuse the user usually mark a state we mishandled.
- Undo/redo interacts with completion: redoing a finishing move re-runs
  `finish()` (known defect — architecture review §2.8). Reports of double
  rating text or inflated attempt counts start there.
- A community puzzle played by its author while `pending` cannot record
  attempts (404 from `/api/attempt`) — "my solve didn't count" on a pending
  puzzle is by design.
- Retired versions (`slug@vN`) keep attempt history but leave the library;
  "my solved count dropped" after a puzzle edit is the deliberate
  reset-on-edit, not data loss.
