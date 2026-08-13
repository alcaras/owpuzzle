---
name: review-community-puzzle
description: >
  Review a community submission end to end: pull it locally, verify it with
  the solver/verifiers, step the author's own line, set the true ceiling,
  then approve or reject. Use whenever the review queue has pending puzzles.
---

# Review a community puzzle

House rule: submissions are **never verified on the server** (the async
worker gave silent fails — deliberate design, keep it). Verification happens
on your machine; the server only stores the verdict.

## Preconditions

- `flyctl` logged in (snarf uses your fly login as the credential).
- Admin account on the site (ADMIN_DISCORD_IDS).
- `npm test` green locally — you are about to trust local verifier runs.

## Steps

1. **Pull the pending queue to files:**
   ```sh
   tools/snarf.sh          # -> submissions/<slug>.json (puzzle + author's recorded line)
   ```
   Each file carries the author's own test-play line and the server's
   replay of it (`authorSolution.claimed` vs `.replayed` — if those
   disagree, the author's browser and the server disagreed already; find
   out why before anything else).

2. **Verify solvability and par honesty:**
   ```sh
   node tools/verify_submission.js submissions/<slug>.json
   ```
   Reports SOLVABLE, distinct winning outcomes, the best line, and probes
   par−1 (a puzzle solvable under its own par has its par overstated).

3. **For a maxKill submission, find the TRUE ceiling** — the author's line
   is a lower bound, not the answer:
   ```sh
   node tools/deploy_fight.js submissions/<slug>.json
   node tools/verify2.js     submissions/<slug>.json
   ```
   Two tools agreeing is the standard (see run-verifiers). Compare against
   the author's replayed strength.

4. **Watch the author's idea, don't reconstruct it:** open
   `/?p=<slug>&review=1` and step their recorded line. You are judging
   (a) is the idea real and required, (b) is the lesson text true, (c) is
   the name/brief text appropriate to publish. Read the text as *content*
   too: name, brief and lesson are shown to every visitor.

5. **Decide, knowing the ceiling default:** approving a bare maxKill
   defaults `objective.count` to the author's **replay-verified** strength
   (`server/index.js:477-490`). If your verifiers found a *higher* ceiling,
   approving as-is publishes a "maximum" a player can beat — the worst bug
   the site ships. Set the proven ceiling in the row's json first (fly ssh
   + sqlite, or repair-and-reinsert), then approve. If the verifier found
   the ceiling *lower* than the author's claim, something is wrong with an
   engine or a verifier — stop and investigate; that is a bug report, not a
   review.

6. **Deliver the verdict** from the stepper (Approve/Reject buttons) or the
   queue card on the library page. Rejection keeps the puzzle reachable to
   its author (they can reopen it in the editor via `editor.html?load=`),
   so a rejection with a Discord note is a revision request, not a
   deletion.

7. **Aftermath:** approved puzzles enter the rated pool at 1200/300 RD and
   the library immediately. Spot-check the live card and the play page.
   Delete or keep the `submissions/*.json` snapshot per taste — it is a
   local working copy, not a record.

## Verification gate

- [ ] solvable, par honest (par−1 probe failed)
- [ ] maxKill: ceiling proven by two tools and the published count equals it
- [ ] author's line stepped and the idea judged required
- [ ] name/brief/lesson text fit to publish

## Known traps

- **The ceiling-defaults-to-author's-line trap** (step 5) is the big one.
  Never approve a maxKill without having run your own search.
- Until the escaping fix ships, a hostile name/brief is an XSS against
  *your own admin session* the moment the queue renders. Treat unreviewed
  text as hostile; check the DB/file content, not just how it renders.
- The review stepper on a pending maxKill shows the neutral "draft cannot
  score itself" result — expected today (no ceiling exists yet), not a bug
  in the puzzle.
- A replay that fails at step N ("step N would not replay") usually means
  the engine changed since the author recorded — the recording is stale,
  not the author dishonest. The submit flow already has wording for this;
  extend the same courtesy in review.
- `snarf.sh` also heals rows stuck in the legacy 'validating' status; if it
  prints nothing, the machine may still be waking (it curls first, then
  retries once).
