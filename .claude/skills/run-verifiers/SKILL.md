---
name: run-verifiers
description: >
  Run and interpret the three independent puzzle verifiers (compute_ceilings,
  deploy_fight, verify2): which tool for which board, every flag, and the
  cross-check protocol that makes a ceiling trustworthy. Use whenever a
  ceiling, par, or "is this line optimal?" question comes up.
---

# Run the verifiers

Three deliberately independent implementations. Each has caught another
being confidently wrong — including a deploy_fight bound that pruned whole
trees while reporting "search complete" (11 STR claimed complete on a 19 STR
puzzle). The redundancy is the design; never let anyone consolidate them.

**The standard of proof: two independent tools agreeing, or verify2's
kill-set upper bound met by a found line. One tool's "search complete" is a
claim, not a fact.**

## Which tool for which board

| board | first choice | why |
|---|---|---|
| small (≤3 blue, tight terrain), already in puzzles.js | `compute_ceilings.js` | exhaustive over the play pool; also yields par (minOrders) and outcome count |
| medium (3–6 blue) or a working file | `deploy_fight.js` | engine-exact seat search, LATE deepening |
| large (6–10+ blue, open ground) | `verify2.js` | kill-set bounds + assignment search; can PROVE without exhaustion; parallel |
| any published ceiling, after engine changes | `npm run test:ceilings` | re-proof harness over deploy_fight |

## Commands

```sh
# exhaustive, by puzzle id (reads web/puzzles.js):
node tools/compute_ceilings.js <id ...>

# engine-exact search; accepts a puzzle.json, a snarfed submission wrapper,
# or a def.js (module.exports = {...}):
node tools/deploy_fight.js <file> [pool] [seconds] [seedStrX10]
    LATE=n        cap mid-fight moves (default: deepen 0,1,2,3)
    TOPK=n        keep each unit's n best seats — FINDER mode, never a proof
    MODE=deploy   best-first over whole deployments, for large boards

# bounds + deployment search; the big-board tool:
node tools/verify2.js <file> [pool] [seconds] [seedStrX10]
    V2_WORKERS=n  parallelise big boards
```

`pool` defaults to `E.poolOrders(puzzle)` — the *play* pool (par+5 rounded
up to a multiple of 5), because the ceiling must hold under what players
actually get, including the 300 training grant. Verifying at bare par
proves the wrong thing.

`seedStrX10`: a known-reachable strength (x10) to prime pruning — use the
current published count when re-verifying.

## Reading the output

- **`search complete` + a number** — a claim of proof *by that tool under
  its stated assumptions*. Suspicion protocol: run a second tool. Agreement
  = trustworthy. Disagreement = one of them has a bug; finding which is
  more important than the puzzle you were verifying.
- **verify2 `PROVEN`** — printed only with its assumptions attached; a
  found line that meets the kill-set upper bound is a genuine proof without
  exhaustion. Read the assumptions anyway.
- **timeout / `TRUNCATED`** — the best found is a **lower bound**. Honest
  and publishable as best-known, but it must be labelled so, and the puzzle
  monitored (better-than-par records will flag any player who beats it).
- **`TOPK` output** — never a proof, by construction. Finder mode only.
- A line the tools found that reaches the ceiling *without the puzzle's
  idea* is a design verdict, not a verification success — the trick is not
  required (see author-house-puzzle step 4).

## Cross-check protocol (when a ceiling matters)

1. Run deploy_fight and verify2 with the same pool and a generous budget.
2. If both complete/prove and agree: done; record the number.
3. If they disagree: extract both best lines, replay each through the raw
   engine in node (`E.loadPuzzle` strict + `applyAction` loop) — the engine
   replay is the arbiter of whether a line is legal and what it scores.
   The tool whose claim the replay contradicts has the bug; file it before
   trusting anything else it ever said.
4. If neither completes: the larger lower bound stands as best-known;
   consider constraining the board (fewer blues, tighter terrain) if this
   was meant to be provable.

## Verification gate

- [ ] verified under the play pool (not bare par), training included
- [ ] proof = two tools agreeing or a bound-met line; else labelled
      best-known
- [ ] any tool disagreement resolved by engine replay and written up

## Known traps

- **Inadmissible bounds are the recurring verifier bug** (affordability
  knapsack `9dcb90d`, deployment affordability `bdff2ea`, the pruned-tree
  "complete" from CLAUDE.md). When touching a bound, the fix must come with
  a test that brute-forces a small board and asserts the bound dominates
  every engine-legal outcome — `test/verify2.test.js` shows the pattern.
- The bound's blow set must include tiles a routing unit *advances into*,
  or real lines get thrown away (`6410d2d`).
- Seats are computed with enemies lifted off the board (deploy_fight idea
  #1) — a seat "under" an enemy is intentional, not a bug.
- Verification cost is a **design input**: if a board cannot be proved in a
  sane budget, the answer may be to change the board, not the budget.
