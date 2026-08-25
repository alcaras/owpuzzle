# Optimizer program — handoff (LNS built 2026-08-24; previous pause 2026-08-14)

This file is the resume point: what the program is, what got built, what
the numbers are, and what the next session should do first. The
*technical* state of the verifier lives in
[verifier-design.md](verifier-design.md) — this file does not duplicate
it, it points at it and adds the plan.

## Scoreboard after the LNS campaign (2026-08-24)

The LNS specced below is built (see "What was built"), and its first
gate PASSED. All runs solo, default knobs, this machine:

| board | target | unaided result | verdict |
|---|---|---|---|
| king-of-the-hill | 180 / 18 | **PROVEN 180 / 18** @900s | **PASS** (was /19; the LNS find) |
| horsing-around | 260 / 11 | 260 / 11 @300s | PASS (anchor holds) |
| closing-in | 100 / 22 | **PROVEN** 100 / 22 @600s | PASS |
| left-flank | 190 / 22 | 190 / 22 @600s | PASS |
| bottleneck-v2 | 350 / 16 | 350 / 16 @2400s | PASS |
| with-a-little-help | 370 / 37 | **270 / 30** best (12–27 across runs) | OPEN — big LNS jump, see below |

Note the king target here is **/18** (Aran's live folded-in par), not
the /20 the 08-14 scoreboard used — the 20-order line in submissions/
is problemgambler's authored line; the bench row was already 18.

**f6ff55 metrology, SETTLED 2026-08-24 (evening):** the "170–220
unaided" band does not reproduce at default knobs — and no commit
broke it, because it does not even reproduce at its home commit.
Three solo measurements on this machine (Apple M5, 10 cpus → the same
8 workers the notes recorded):

| code | command | result |
|---|---|---|
| 4f23cbe (the commit whose doc asserts "expect 17-22") | its own repro command, 1500s | 110/12 |
| be5e353 (pre-LNS) | 2400s | 120/14 |
| LNS build | 2400s | 120/15 |

Conclusion: the 17–22 figures carried unrecorded knob settings or
another machine's wall-clock slicing, not a reproducible default. The
row's REAL baseline is **~110–120 at default knobs**, and any claimed
improvement on this board must beat that with a stated command —
knob-archaeology for the old 22 is not worth the runs.

**Then the LNS hit 270/30 on this board (2026-08-25, 00:00-ish).** One
2400s default-knob run: worker 3's LNS polish slice climbed
11 → 17 → 22 → **27 STR** through capped full-list k=1/pair rebuilds
(deployments 76/267/314/378 of the slice; frontK was never even drawn —
the VND ladder kept improving at k≤2), then a later slice trimmed
27/31 → 27/30. Replay-verified; past the old recorded best-ever 22. A
same-command repeat got 12/15 — the spread at default knobs is
**12–27, decided by which worker's polish slice gets the right seeds**
(workers share only incumbent strength, not deployments). The line was
recovered from the lucky run's log with the new
`tools/reconstruct_line.js` (log-string-matched DFS) and lives TRACKED
at `bench/lines/with-a-little-help-f6ff55-line270.json` — it is a lucky
find, not regenerable on demand.

The diagnostic that names the next lever: V2_TRACE_LINE on the 270/30
line reports expressive rank-sum **90** (worst seat rank 40) but plan
rank-sum **14** — under the right kill-set witness, the winning seats
are nearly top-of-list. The line is cheap to ASSEMBLE once the right
witness gets a slice; the search's problem is getting it one, and
getting polish its seeds.

## The goal (the owner's words)

> "my goal here is to get a validator/optimizer that can solve the
> puzzles and find human class or better solutions (ideally optimal)"

Operationalised as `bench/human-baselines.json`: six boards, each with a
replay-verified target line and a time budget. The bar is **match-or-beat
every target unaided** (no seeding, from a cold start) within budget.

## Scoreboard at pause (2026-08-14, historical)

| board | target | unaided result | verdict |
|---|---|---|---|
| closing-in | 100 / 22 | **PROVEN** 100 / 22 @300s | PASS (was failing) |
| left-flank | 190 / 22 | 190 / 22 @420s | PASS |
| horsing-around | 260 / 11 | 260 / 11 @300s | PASS (regression anchor) |
| bottleneck-v2 | 350 / 16 | 350 / 16 @2400s | PASS at the row's raised budget |
| king-of-the-hill | 180 / 20 | **PROVEN** 180 strength / **21** orders | one order short |
| with-a-little-help | 370 / 37 | 170–220 | OPEN — the moonshot |

Four of six pass. Both remaining gaps are **ordering**, not model
expressiveness — proven, not assumed: `V2_TRACE_LINE` replays each human
line through the solver's own move model and reports it fully expressible
and bound-feasible. The solver *contains* the answers; its search order
doesn't reach them.

**Units gotcha:** the bench file uses the objective scale (strength ×10),
verify2 prints STR. `100` in the table is `10 STR` in a run's output.
This exact mismatch once broke every row of `ceilings.test.js`.

## What was built this campaign

1. **Closing-in fixed** (was the blocker; now PROVEN 100/22 = par). Three
   stacked ordering failures, not a crash: Aran's line uses a deferred
   seat (a tile vacated by the first kill) ranked behind every immediate
   seat; its decisive seat costs 5 orders and was buried by the travel
   tax; and plan slices — the only mode that assembles a deployment from
   a kill-set witness — ran on >8-blue boards only. Fixes: a
   "deferred seats are load-bearing" selector enables plan slices on
   small boards, plan-mode travel became a tiebreak (λ=1), essential
   deferred seats rank on merit.
2. **Par refinement** — after a bound-match proof, leftover budget
   minimises orders at the proven strength (this is what took
   king-of-the-hill from 130 to a proven 180).
3. **`V2_TRACE_LINE=<line.json>`** — the diagnostic instrument. Replays a
   human line and reports, per unit: seat class (live / deferred /
   absent), march use, mid-fight moves, OPT row, whether the pinned
   kill-set survives the bound, and **each seat's rank in the real search
   orders**. This is what turned "why can't it find this" into numbers.
4. **`V2_DUMP_LINE=<path>`** — the solver writes its best line as
   replayable JSON, same format trace mode reads. Closes the loop.
5. **Shared march budget in the deployment tree** — at most
   `floor(training / UNIT_MARCH_COST)` marched seats per assignment.
   (The original commission brief said training buys extra *attacks*;
   that's wrong — march buys the second *movement* band, `engine.js:587`,
   `Unit.cs:11018`, and attacks are one per unit unless a rout advances.
   Fable caught it before the bound got built on the wrong rule.)
6. **Two plan-tree defects** found via trace data and fixed: PLANK
   truncation cut seats the kill-set needs (king's human line uses a
   deliberately *suboptimal* 13-damage seat to dodge a collision — no
   per-red retention heuristic survives that, so truncation is off for
   ≤8-blue boards), and plan slices skipped kill-sets *equal* to the
   incumbent, exactly the set par refinement needs (`includeEqual`).

## The misranking finding (why LNS is next)

`V2_TRACE_LINE` rank data on the two calibration boards:

- **left-flank** (a board the solver *does* crack): human seats have
  rank-sum ~20, worst seat rank 7. Calibration: rank-sums in the teens
  are what the current global best-first order reaches.
- **king** (the board it misses by one order): rank-sum **60**, carried
  by two seats — the deferred general-tile seat at rank **29 of 32**
  (OPT damage 18, the best in the table, buried because the unit has
  weak-but-nonzero immediate access so the essential-deferred waiver
  doesn't fire) and a 5-order march seat at rank 26.

No global best-first order we own reaches rank-sums of 40–60. **But** the
solver's own proven 18/21 deployment differs from the human 18/20 by only
2–3 seat substitutions. The gaps are small and *local*.

## Ruled out: seed diversity (2026-08-16)

A plausible theory, tested and dead. `mem.topLeaves` keeps the 16 **strongest**
deployments as polish seeds, which looks like textbook elitism: 16 spellings of
one idea, all inside the basin local search already occupies. That reading is
reinforced by the misranking finding below — king's winning /20 shares no seat
assignment with the reached /21 — so no 1- or 2-seat repair can walk from one
to the other.

Replacing it with a quality-diversity archive (admit on merit **or** on being
structurally unlike everything held) changed nothing:

| | mean pairwise seat distance | king result @900s |
|---|---|---|
| elitist top-16 | 0.729 | 18 STR / 19 orders |
| diversity archive | 0.729 | 18 STR / 19 orders |

The diversity branch fired **zero times** across a full run: no two reached
deployments were ever within 0.2 of each other. The seeds were already spread —
they share about 27% of their seats and span strengths 13..18. There was
nothing to de-duplicate.

The instrument survives as `V2_SEED_DEBUG=1` (prints seed count, mean pairwise
distance, strength range); the archive was reverted as a no-op.

**What this narrows.** Selection among reached deployments is not the
bottleneck — the polish pass already receives 16 structurally distinct seeds
and still cannot find /18. The problem is **coverage**: the winning deployment
is never reached, and no amount of diversity among the reached set contains it.
That is an argument *for* the LNS plan below rather than against it, but with a
sharpened requirement: LNS earns its place by CONSTRUCTING deployments the tree
never enumerated (destroy k seats and rebuild that subset exactly), not by
re-ranking what it already has. Any future ordering heuristic should be
measured against `V2_SEED_DEBUG` first — if the seeds are already spread, the
heuristic is solving a problem the solver does not have.

## The LNS, as built (2026-08-24)

The plan below was executed and its gates ran in order. What shipped, in
`tools/verify2.js` (`opts.polishOnly` is now the LNS):

- **Exact k-subset rebuild.** Destroy k units' seats (k=1, all pairs,
  then triples) and enumerate the subset's joint reassignment from the
  units' FULL seat lists — the old polish capped candidates at rank 20
  (1-swaps) / rank 12 (pairs), and king's decisive seats sit at
  expressive ranks 27 and 29, so the old pass could never propose them
  *by construction*. Freed units are lifted before enumeration so seat
  rotations inside the subset are reachable.
- **The allocator gate is what makes exhaustive affordable.** Every
  candidate placement is pinned into the kill-set allocator first;
  refutation (no mask can beat the reference — strictly stronger, or
  equal strength in strictly fewer orders) skips the fight. On king it
  gated 8,411 of ~10k candidates and the /18 landed 58 fights in.
- **ALNS operators** (rand / weak / front / dear) with adaptive weights
  on a seeded PRNG (`V2_LNS_SEED`) order the triple space; on ≤8-blue
  boards an exhaustive tail sweeps whatever the dice never rolled, so a
  dry verdict means dry. On >8-blue boards rebuilds are CAPPED
  (`V2_LNS_CAP`, default 600 candidates, logged when it trips): where
  the allocator cannot refute (f6ff55 — the stage-1 finding), an
  uncapped pair rebuild fights thousands of low-value candidates and one
  neighbourhood eats the whole polish slice.
- **Proof-line seeding.** The incumbent line's own deployment joins the
  seed pool — a stage2-found proof never passes through evalLeaf, so
  topLeaves can lack the very deployment the proof stands on.

Gate results: (1) king 180/**18** unaided @900s, PROVEN strength —
PASS, one better than the /19 the code did before and equal to the live
par; (2) six-board solo regression clean (scoreboard above, left-flank
included); (3) verdict semantics untouched — the /18 is *best-known*
orders at PROVEN strength, exactly as specced; (4) `npm test` green.

## What to do next session

Make the f6ff55 27-class **reproducible** instead of lucky. Two levers,
both named by this session's data, in value order:

1. **Share topLeaves across workers.** The 27 happened in the one worker
   whose own polish seeds contained the gradient; workers currently
   share only incumbent STRENGTH (the SharedArrayBuffer), so seven
   polish passes ran on worse material. Post top deployments over
   postMessage, merge into each worker's seed pool. Cheap, mechanical,
   and it directly attacks the 12-vs-27 variance.
2. **Get the right witness a plan slice.** The 270/30 line's plan
   rank-sum is 14 — near-top under its own kill-set witness — so
   assembly is cheap once the right (mask, witness) pair gets budget.
   Witness rotation exists (3 rotations/mask); consider more rotations
   on the masks just above the incumbent, and plan slices re-run after
   the incumbent moves (the current schedule runs them once, up front).

frontK (destroy a whole front, sampled rebuild for k>=4) is built and
inert so far — the VND never went dry enough to draw it in the lucky
run. Leave it in; it costs nothing until drawn.

Also on the table, from the owner's 2026-08-24 direction: a **learned
seat-ranking prior** to replace the hand-tuned ordering penalties
(DEFPEN, LAMBDA) — offline-evaluable against `V2_TRACE_LINE` rank-sums
on the known human lines before it touches a single search budget;
training data from PROVEN small boards the verifier can generate. Keep
it ordering-only; bounds stay hand-proven.

## Also scoped but not built

- **Allocator-side march budget.** The deployment tree enforces the
  shared march budget; the allocator's travel floors still price march
  freely. Spec is written in verifier-design.md (rows carry a non-march
  floor; the DFS charges a shared counter and falls back when spent).
  Deliberately deferred as too bug-prone to rush at a block tail.
- **Red-green tests for the two plan-tree fixes.** Requested, not yet
  written. The truncation lesson especially ("no retention heuristic
  survives contact") will be re-learned the hard way by a future
  refactor unless a test pins it.
- **stage2u throughput** (~1.5× would drag bottleneck's /16 back inside
  1200s: hash compaction, skipping redundant reachability calls in
  `legalActions`). Opportunistic only — *not* required for acceptance.

## Process rules earned the hard way

- **Solo runs only.** Parallel benchmark runs starve each other's node
  budgets: bottleneck measured 35/17 solo and 35/19 contended. One
  interim number was published mislabeled as solo because of this.
- **Node counts and proofs are per board-hash, never per slug.** A
  "35/16 at node 1,908,608" claim belonged to the *retired* bottleneck
  fixture; the bench board is a revision with its own landscape. Two
  contradictory reports traced back to this single conflation.
- **Every claim carries a repro command** (they live at the bottom of
  verifier-design.md; the closing-in, left-flank and bottleneck rows were
  all corrected this campaign).
- **Audit findings apply to our own artifacts too.** A `bneck2_deep`
  artifact claiming "PROVEN 35, full-play complete" does not reproduce on
  current code; the bench row now honestly says best-known 35, U=46.

## State of the tree

Branch `phase1-library-store`, **uncommitted**:

```
 M tools/verify2.js          (+491/-72: trace ranks, seat-list extraction,
                              par refinement, plan selector + includeEqual,
                              march budget, V2_DUMP_LINE)
 M docs/verifier-design.md   (+120: optimizer state-of-play, misranking
                              findings, LNS conclusion, march spec)
?? bench/human-baselines.json (the contract)
```

Line files follow `submissions/<boardfile>-line.json` (closing-in,
king-of-the-hill-41e478, bottleneck-aded0b). Note `submissions/` is
gitignored, so **line files are not version-controlled** — they can be
regenerated with `V2_DUMP_LINE`, except the two human ones, which came
from submission rows in the DB.

## The rest of the board (non-optimizer, also paused)

- **Phase 1 refactor** — complete on dev (owpuzzle-dev.fly.dev), awaiting
  the owner's manual pass against `docs/phase1-test-plan.md` before merge
  to prod. Prod currently carries Phase 0 plus cherry-picked mobile
  fixes only. Phases 2–5 queued (Playwright golden flows, draft-handoff
  module, server structure, shared shell).
- **Feed the Wolf** — pending, unpublished; the bait isn't baity enough
  ("i am very confused about feed the wolf"). Needs a salience rework.
- **Small backlog** — Approve-step confirmation guard; admin
  better-than-par table wording ("played by", "beat par: solved in N");
  editor city brushes hidden until cities exist; verifier known gaps
  (bImmobilize, bPushWater, iSettlementAttackModifier,
  iRoadMovementModifier); deploy_fight's rangeMax height-extension bound
  hole.
