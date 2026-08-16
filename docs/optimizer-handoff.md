# Optimizer program — handoff (paused 2026-08-14)

Work paused mid-block when the Fable budget ran out. This file is the
resume point: what the program is, what got built, what the numbers are,
and what the next session should do first. The *technical* state of the
verifier lives in [verifier-design.md](verifier-design.md) — this file
does not duplicate it, it points at it and adds the plan.

## The goal (the owner's words)

> "my goal here is to get a validator/optimizer that can solve the
> puzzles and find human class or better solutions (ideally optimal)"

Operationalised as `bench/human-baselines.json`: six boards, each with a
replay-verified target line and a time budget. The bar is **match-or-beat
every target unaided** (no seeding, from a cold start) within budget.

## Scoreboard at pause

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

## What to do first next session

**Build large-neighborhood search** over reached deployments: generalise
the existing polish pass from 1-swap hill-climbing to *destroy k units'
assignments and rebuild that subset exactly* (k=2–3), seeded from the top
reached deployments and from the proof line. It reuses the whole existing
`evalPlacement`/fight machinery. Population/crossover and annealing are
**deferred on evidence** — the gaps are local, which is LNS's home ground.

Agreed gates, in this order:

1. **king /20 unaided within its 900s row budget** — first, because its
   target is provably 2–3 substitutions from a deployment the tree
   already reaches. This is the cheapest possible test of the thesis.
2. **Full six-board solo regression** — especially left-flank, which is
   historically the board that ordering changes silently bury, and whose
   420s budget has no slack.
3. **Verdict semantics untouched.** LNS finds lines; replay verifies
   them; PROVEN still comes only from the three sources. An LNS-found /20
   at proven-180 strength is *best-known* /20 — we have no
   order-optimality proof source. If one can be built out of par
   refinement's bound, spec it separately before claiming it.
4. `npm test` 99/0.

Then point LNS at f6ff55 (370/37), with spanning-unit front conditioning
as the follow-on if LNS alone stalls. On that board 8 of 11 blue units
reach only 3 red units, so it nearly decomposes.

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
