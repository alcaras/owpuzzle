# Ceiling audit under the honest verdict standard (2026-08-13)

Every published maxKill ceiling, re-examined with verify2's post-Bottleneck
verdict discipline: **PROVEN** means a kill-set bound match (U0
unconditional, U with the no-swap-travel caveat) or completion of the
full-play search (stage2u over raw engine legalActions). Rationed-model
completion proves nothing and is not accepted here. All runs are play
conditions (published pool, play training), every best line replay-verified
through the engine.

Budgets follow the node-rate arithmetic: stage2u does ~4k nodes/s on an
M-series laptop; pool-10 boards complete their full-play search well under
240s or prove by bound match first; pool-15 boards got 300-900s; the one
pool-20 board got 900s. Runs marked ✻ were batched 3-4 at a time on a
10-core machine — all single-threaded, so uncontended.

## The verdict table

| puzzle | published count / par | audit verdict | source | orders found |
|---|---|---|---|---|
| nestor-charge | 26 / 5 | **PROVEN 26** ✓ | U0 bound match | 5 = par ✓ |
| cut-the-bowstring | 16 / 3 | **PROVEN 16** ✓ | full-play complete (441 nodes) | 3 = par ✓ |
| leave-him | 15 / 4 | **PROVEN 15** ✓ | full-play complete (105k nodes) | 4 = par ✓ |
| the-shore-riders | 19 / 5 | **PROVEN 19** ✓ | U0 bound match | 5 = par ✓ |
| the-wood-line | 15 / 5 | **PROVEN 15** ✓ | U0 bound match | 5 = par ✓ |
| the-jungle-road | 14 / 4 | **PROVEN 14** ✓ | full-play complete (908k nodes) | 4 = par ✓ |
| down-the-avenue | 17 / 4 | **PROVEN 17** ✓ | full-play complete (421k nodes) | 4 = par ✓ |
| the-man-beside-him | 17 / 7 | **PROVEN 17** ✓ | U0 bound match — after fixing a verify2 bound bug, see below | 7 = par ✓ |
| broken-sword | 12 / 9 | **PROVEN 12** ✓ | U0 bound match | 9 = par ✓ |
| the-crossed-lanes | 22 / 3 | best-known agreement 22 | value matches; stage2u timed out (2.4M+ nodes); certified by compute_ceilings historically | 3 = par ✓ |
| the-ground-he-wins | 13 / 8 | best-known agreement 13 | value matches; stage2u timed out; certified by compute_ceilings historically | 8 = par ✓ |
| the-two-fords | 34 / 12 | best-known agreement 34 | value matches; stage2u timed out (608k nodes / 900s; pool-20 board); certified by compute_ceilings historically | 12 = par ✓ |
| with-a-little-help (DB) | 37 / 37 | best-known agreement 37 | author line replays at 37; verify2 coverage 52,850 deployments + 30,211 refuted subtrees / 40 min found nothing above; U=52 | 37 |

**Result: 9 of 13 ceilings PROVEN under the honest standard, 4 best-known
with cross-tool agreement, 0 suspect in either direction.** Every audited
board's best line also lands exactly on its published par. No ceiling was
found beatable. One row initially looked unreachable and turned out to be
an auditor bug (below) — which is the cross-check discipline doing its job
on the newest tool.

## The audit's own finding: a verify2 inadmissibility, caught and fixed

the-man-beside-him first audited as "13 found, published 17, U0=17" —
SUSPECT in the unreachable direction. Hand-replaying the intended line
through the engine reached 17 in 7 orders, so the ceiling was fine and the
AUDITOR was wrong: `stateBound` capped every blow against a Last-Stand
(zealot) unit at `hp-1`, which at **hp 1 caps at 0** and declares the unit
unkillable — pruning every line that whittles the zealot to its last point
before the finishing blow, which is this puzzle's entire lesson. The
engine's cap gates on `def.hp > 1` (attackUnitDamage, engine.js:428); the
bound now does too, in stateBound and both allocator sites. Regression
test: `test/verify2.test.js` ("a 1-hp zealot is killable in the bound").
Post-fix the puzzle proves at 17/7 in seconds.

Corollary: earlier f6ff55 finder numbers (unaided 22) were computed with
this bug active and its red spearman is a zealot — unaided finding there
may improve on a re-run.

## Reproduction commands (one per row; a row without one is a rumor)

```
node tools/verify2.js nestor-charge 10 240
node tools/verify2.js cut-the-bowstring 10 240
node tools/verify2.js leave-him 10 240
node tools/verify2.js the-shore-riders 10 240
node tools/verify2.js the-wood-line 10 240
node tools/verify2.js the-jungle-road 10 240
node tools/verify2.js the-crossed-lanes 10 1200
node tools/verify2.js down-the-avenue 10 240
node tools/verify2.js the-two-fords 20 900
node tools/verify2.js the-man-beside-him 15 300
node tools/verify2.js the-ground-he-wins 15 900
node tools/verify2.js broken-sword 15 420
node tools/verify2.js submissions/with-a-little-help-from-my-friends-f6ff55.json 45 2400 370
```

Notes: bare ids resolve against web/puzzles.js. Bound-match proofs land in
seconds regardless of budget; full-play completions are deterministic in
node count, so a slower machine needs proportionally more seconds, never a
different command. the-two-fords sets `training: 0` explicitly, so play
conditions grant no marches there; every other board plays at training 300.

## Recommendation for test/ceilings.test.js

Move the gate to verify2, in two tiers:

1. **Fast tier (runs in `npm run test:ceilings`)**: for each published
   maxKill puzzle, run stage 1 + the finder slice with a 60-second cap and
   assert (a) U0 >= published count — a published count above the sound
   upper bound is an immediate red flag in the unreachable direction — and
   (b) no replay-verified line exceeds the published count (beatable
   direction). This catches both failure modes cheaply on every rules
   change.
2. **Deep tier (manual, after any engine change)**: the exact commands
   above; assert the verdict classification does not regress (PROVEN rows
   stay PROVEN at the same value). The nine bound-match/full-play proofs
   complete in ≤ 240s each; only crossed-lanes, ground-he-wins and
   two-fords need long budgets, and for those the assertion is
   value-agreement, not proof.

Keep compute_ceilings as the second implementation for the small boards —
the cross-check discipline is what caught deploy_fight before and what
caught verify2's zealot cap now. deploy_fight's role shrinks to a fast
finder; its "search complete" should never again be treated as a proof
(its rationed model is exactly the one Bottleneck defeated, and it also
gates range on `rangeMax` without height extension — a second known
admissibility hole documented in the design doc).
