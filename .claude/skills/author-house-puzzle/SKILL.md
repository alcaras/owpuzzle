---
name: author-house-puzzle
description: >
  Design, verify and publish a house puzzle in web/puzzles.js: numbers first,
  board second, then prove the ceiling and prove the trick is REQUIRED.
  Use when creating or reworking any puzzle shipped under author 'owpuzzle'.
---

# Author a house puzzle

Read `docs/making-puzzles.md` first — it is the design doctrine and this
skill is its checklist. The one-line summary: **the trick must be required,
not merely available.** Three of five drafts in one sitting were withdrawn
because the verifier found a duller line reaching the same ceiling without
the idea. You designed the intended line, so you are the last person who
will spot the shortcut. Run the search.

## Preconditions

- The mechanic the puzzle teaches is already implemented and cited in the
  engine (if not: add-engine-mechanic first).
- You know whether you are building something *provable* or something
  published as best-known — verification cost scales with blue units × open
  tiles, and a puzzle nobody can verify has a ceiling that is a guess.

## Steps

1. **Numbers first.** Sketch the board as a def file
   (`module.exports = {...}` in engine coords, same shape as
   `web/puzzles.js` entries). Print the damage matrix — every blue against
   every red from every seat it can reach — with a ~20-line scratch script
   over `test/helpers.js`'s `setup`/`damage`. Never guess damage: a
   spearman defending against *melee* cavalry takes +50% but a palton
   *shooting* it does not; a longbowman defends at 8.

2. **Choose hit points so every rival line falls exactly one short.** One
   discoverable margin beats ten hidden ones — the player can count. This
   is the step that makes the trick required rather than available.

3. **Verify the ceiling with two independent tools** (never one — each has
   caught another being confidently wrong):
   ```sh
   node tools/deploy_fight.js work/mypuzzle.js [pool] [seconds]
   node tools/verify2.js     work/mypuzzle.js [pool] [seconds]
   node tools/compute_ceilings.js <id>     # once it's in puzzles.js
   ```
   See run-verifiers for flags, modes and how to read the output.
   **"search complete" is a claim, not a fact** — the standard of proof is
   two tools agreeing (or verify2's kill-set bound met by a found line).
   A timeout gives a lower bound: honest, publishable as best-known only if
   labelled so.

4. **Prove the trick is required.** Neutralise the idea in a probe copy —
   remove the key promotion, wall off the key tile, swap the key unit for a
   vanilla one — and re-run the search. If the neutered board still reaches
   the ceiling, the lesson text is a lie; redesign (usually: tighten the
   gate HP from step 2). Also confirm the intended line **is** the optimum,
   not merely *a* line that reaches it: step through the verifier's best
   line and check it goes through the idea.

5. **Set par = the minimum orders that reach the ceiling**
   (`compute_ceilings` phase 2 prints `minOrders`). Remember players get a
   bucketed pool, not par (`poolOrders`: par+5 rounded up to a multiple of
   5) — par must not be back-derivable, and the brief never states it.

6. **Add to `web/puzzles.js`**: `author: 'owpuzzle'`, `difficulty`
   (1 basics / 2 tactics / 3 challenges), optional `hero` index for the
   card art, `objective.count` for maxKill = the proven ceiling. Write the
   `lesson` as the one sentence the player just proved to themselves.

7. **Gates:** `npm test` (library invariants: loads, units exist, ceiling
   ≤ red army worth, par fits pool) and `npm run test:ceilings` (the new
   puzzle joins the re-proof set; make sure it *can* be re-proved in the
   time budget, or you have shipped an unverifiable ceiling).

8. **Playtest before it is live:** deploy of `puzzles.js` publishes
   immediately (the server reseeds core puzzles at boot). To playtest
   first, insert into the DB with `status: 'pending'` — reachable by URL
   for author/admins, invisible in the library.

## Verification gate

- [ ] ceiling agreed by two independent verifiers, or explicitly best-known
- [ ] neutered-probe search confirms the trick is required
- [ ] intended line is the optimum, and par is the proven minimum orders
- [ ] `npm test` and `npm run test:ceilings` green

## Known traps

- **Editing a shipped puzzle makes it a new puzzle**: on deploy the old row
  is retired under `slug@vN`, everyone's completion resets, first attempts
  are rated again (`server/db.js:56-107`). Deliberate — but do not "just
  fix a typo" in a gameplay field casually. Brief/lesson-only edits still
  retire the row (the seed diffs the whole JSON), so batch text edits.
- A **deleted** entry in puzzles.js auto-retires the DB row. Also
  deliberate; know that you are withdrawing it.
- Rout advances grant another attack but **no movement**; polearms are
  rout-immune and break chains — the two rules that most often create
  accidental shortcut lines.
- Zealot last stand can still die to splash; panic with no escape becomes
  disarm. Both have produced surprise ceilings.
- Boards with 5+ blue units on open ground routinely exceed exhaustive
  proof. Design the terrain to constrain seats, or accept best-known.
