# verify2 — design notes

The third verifier (`tools/verify2.js`), built to scale to 10–20 blue units.
It keeps the house discipline: the engine is the only ground truth, every
model is used for *ordering and bounding only*, and every claim is printed
with the assumptions it rests on. `deploy_fight.js` and
`compute_ceilings.js` stay untouched — cross-checking implementations is
what makes any of these numbers trustworthy.

## The idea that changes the game: prove the ceiling from the top down

Everything before verify2 searched *play*: sequences of actions, or
deployments of units. Play-space grows multiplicatively with units. But the
*answer* space is tiny: a ceiling is a **kill-set** — a subset of the red
army — and a board with 9 reds has 512 subsets, of which only a handful
have strength above any given incumbent.

So verify2 splits the problem:

1. **Upper bound (stage 1).** Enumerate kill-sets in descending strength.
   For each, ask a relaxed but *sound* question: is there any allocation of
   optimistic blows that covers every red's hp within the order pool? The
   first subset that cannot be refuted gives the upper bound `U`, and every
   subset above it is *proven* unkillable. On the 11-blue submission this
   is milliseconds of arithmetic, not hours of search.
2. **Lower bound (stages 2–3).** Search real play with the real engine
   until a replayable line is found. The moment the line's strength equals
   `U`, the ceiling is **proven** — no exhaustive play search needed.

The exhaustive play search is still there (stage 2) because small boards
deserve a second, independent proof, and because `U` is not always tight.

## The optimistic damage table (the part that must not be wrong)

Every bound rests on `OPT[b][tile][r]` — an upper bound on the damage blue
`b` could *ever* deal red `r` from `tile`, under any play. Hand-rolled
damage models have all been wrong somewhere, so the table is computed by
the engine itself on doctored two-unit states, taking a max over variants:

- **flanking**: a phantom allied unit is placed on the tile opposite the
  seat (the engine then applies `iFlankingAttackModifier` — only
  COMMANDER_LEADER +100 and SADDLEBORN +25 carry it — and only if the
  opposite tile actually exists and matches water-ness, which the engine
  checks itself). This is far tighter than deploy_fight's blanket ×2.
- **adjacent-same** attacker bonus (VOLLEY/FORMATION/COMMANDER): a phantom
  same-type ally beside the seat, only if the army actually contains a
  second unit of that type.
- **defender minimized**: no red neighbours (kills adjacent-same defence),
  `fortifyTurns = 0` when any melee blue can reach it, DISARMED applied
  when any blue carries DISARM or PANIC (push-with-no-escape disarms) and
  the red is not immune, and both damaged/undamaged hp variants on both
  sides (TOUGH cuts both ways).
- **raw, uncapped** damage via the exact `getAttackDamage` formula
  (engine.js:412, replicated with citation), so a variant's hp cap cannot
  hide a bigger blow. Zealot (`bLastStand`) is handled at allocation time:
  each blow vs a zealot caps at `hp−1`, so it always needs two blows.
- **push drift**: boards with `bPush` blues (war elephants) can move a red
  up to K tiles (K = number of push-capable attacks). OPT is a max over
  every tile the red could be pushed to. On push-free boards this costs
  nothing.
- **range is the engine's range**: `effectiveRange` + line of sight, so
  height-extended shots are in the table. (deploy_fight's `damageFrom`
  gates on `rangeMax` and silently drops hill-extended shots — a real
  admissibility hole found while building this.)

A runtime assertion backs the table: every attack the search actually
applies is checked against its OPT entry, and a violation taints all
claims loudly. `test/verify2.test.js` brute-forces the same invariant on
small boards.

Seats are computed as before (reachability with all reds lifted off — a
superset of anything achievable while they're alive) but include
**march-extended** rings (march costs training, not orders; the engine's
`u.march` flag doubles the fatigue band) and, for routers, the red-occupied
tiles a rout can advance into. Rout-tile blows are granted only when the
unit's seat is adjacent to some red — a chain has to start with an
adjacent kill.

## The kill-set allocator

`feasible(mask, budget)` asks: can every red in `mask` be covered?

- each non-rout blue contributes at most **one** attack; a rout-capable
  blue up to `|mask|+1` (orders bound it further);
- collateral (PIERCE/CLEAVE/CIRCLE/SPLASH) contributes order-free blows,
  capped per attack at the pattern's victim capacity, at the engine's
  collateral percent — this is what lets splash finish zealots;
- orders = attacks + travel, where travel per used blue is the *cheapest*
  seat that engages any of its assigned reds (an underestimate, as a bound
  must be);
- infeasibility is monotone upward (a superset of an unkillable set is
  unkillable), so refuted masks prune their supersets for free;
- if the allocator hits its node cap the mask is *assumed feasible* — caps
  can only loosen `U`, never break its soundness.

Two variants are reported: `U` (walking travel floors) and `U0` (travel
ignored). `U0` is unconditional; `U` assumes no swap-shortcuts (see model
boundary below).

## Stage 2 — exact in-state search (small boards)

deploy_fight's engine-exact DFS, kept, with three changes: the bound is a
per-red cover + order-knapsack over OPT tables (pure lookups, no per-node
engine calls — and it respects each unit's mobility state: a unit that has
attacked contributes nothing, one that can no longer move only its
current-tile row); march is a real move option; the transposition key
includes steps, march and applied effects, which deploy_fight's key
omits. Mid-fight moves are rationed and deepened LATE = 0..3, as before.
Completing this proves only the model that was searched — see the verdict
discipline below.

## Stage 2u — TRUE full-play search, and the verdict discipline

Bottleneck (`submissions/bottleneck-f5de22.json`, pool 20) is the case
that forced this. Stage 2 with every ration widened — 3 move actions per
unit, 8 mid-fight moves, swaps on, seat destinations — **completes** at
30 STR. The real ceiling is **35**, reached by a line whose opening is
pure choreography: the elephant shuffles through a tile that attacks
nothing and returns to where it started, the push vacates the red
horseman's tile, the blue horseman walks into it, routs away, and a
slinger reuses the same tile two actions later. No ration-and-seat model
expresses that, and "search complete" inside one is not a fact about the
game. (This repo has been burnt by exactly this before; now it has a
regression test.)

Two consequences, both implemented:

- **PROVEN comes from three sources only**: a line matching U0
  (unconditional), a line matching U (no-swap-travel caveat printed), or
  completion of **stage 2u** — a search over the engine's own
  `legalActions` with no synthetic budgets, no seat filter, swaps and
  lazy march included, transpositions merged on board state alone.
  Fortify is the one skipped action, with a printed argument: it costs an
  order, ends the unit's turn, and only changes how hard blues are to
  kill — reds never act during a puzzle turn. Anything narrower that
  completes is reported as "complete within a RESTRICTED move model (…)
  — not a full-play proof".
- **The rationed model is kept for what it is good at** (fast par
  refinement and finding), and stage 2u runs after it with the remaining
  time, improvement-only. Notably the un-rationed search is often
  *cheaper* than a widened ration: budget counters in the transposition
  key fragment the state space, so "3 moves per unit" searches more
  distinct states than "any number of moves".

On Bottleneck, verify2 now finds the 35/16 line itself (stage 2u, ~90s to
the find) and reports it as best known with U=46 — no false PROVEN.

## Stage 3 — assignment search over deployments (big boards)

The 11-blue submission killed deploy_fight's MODE=deploy not by tree size
but by *representation*: a best-first heap over cartesian seat vectors
popped 1.8M candidates and evaluated ~2.3k, because almost every vector
was a seat collision or unaffordable. verify2 makes both impossible by
construction:

- a **lazy-successor best-first search over the assignment tree**: a heap
  node commits one unit to one seat and stands in for its ungenerated
  sibling tail, so popping it pushes exactly two nodes (next sibling,
  first child) and the heap stays O(pops). Priority is chosen-seat scores
  plus an optimistic completion, which is the arrival order that let the
  old heap find hard deployments early — without its collision churn
  (children are collision-checked and cost-floored at creation);
- **deployment seats are live seats** (reds alive and projecting ZOC,
  allies lifted): cleared-board seats include tiles only a mid-fight move
  can use, and walking into them fails at every leaf — deploy_fight burned
  650k walk-in attempts on exactly this;
- seat **scores use the realistic damage rows** (reds on their actual
  tiles, no speculative push or disarm) — steering by the bound's
  optimistic rows sent every deployment somewhere the fight could not
  cash in (found the hard way, see the failure log);
- **plan slices**: before the coverage pass, the top ~10 kill-sets each
  get a short search in which every unit's seat list is truncated to the
  seats that serve that kill-set's witness allocation. These are finders
  (truncated lists claim no coverage) and they are what sets a strong
  incumbent early on big boards;
- the **kill-set bound, conditioned on the partial assignment**: assigned
  units' blows are restricted to their fixed seat, unassigned units keep
  their full tables, and if no kill-set at or above the incumbent is
  feasible under that restriction the subtree dies. Witness revalidation
  and a per-prefix cache keep the common case cheap;
- **symmetry**: units with identical type/promotions/hp fight identically,
  so leaves are deduplicated by class signature and the walk-in picks the
  cheapest member↔seat pairing (their travel costs differ even when their
  fights don't). Descent-time canonical ordering is deliberately NOT used —
  class members can have different reachable sets, so it loses real
  deployments;
- leaves walk the deployment in with real engine actions (with march) and
  run the attack-only fight-out with memoization, pruned against the
  global incumbent — exact in the coverage pass, node-capped in plan
  slices (tracked and reported);
- **worker parallelism**: the tree splits at the root by seat rank mod K;
  each worker runs the whole schedule on its slice, sharing the incumbent
  strength through a SharedArrayBuffer (readable from synchronous search
  loops via Atomics) and reporting lines over postMessage.

## Model boundaries (printed with every verdict)

Anything "proven" by stages 2–3 is proven **within this action model**:

- no **swap** actions (deploy_fight shares this; compute_ceilings covers
  them on small boards). Swaps can beat walking travel costs (they cross
  ZOC and ignore terrain cost), which is why `U0` exists.
- no **anchor** (warship water-control bridges) — no current puzzle needs
  it; it changes reachability, not damage.
- stage 3 is walk-then-fight: no mid-fight moves, no tile reuse. Stage 2
  covers those on boards small enough to search.
- `U` additionally assumes no swap travel shortcuts; `U0` does not.

The verdict logic: **PROVEN** when best == U0, or best == U (with the
no-swap caveat printed), or stage 2 completed its full LATE schedule;
otherwise best-known + upper bound + exactly what was covered (LDS depth
exhausted, deployments evaluated, kill-sets refuted).

Play conditions match the site (`loadPuzzle` play semantics): pool from
the CLI or `poolOrders`, training = author's value or 300. deploy_fight
ignores training entirely — lines that need a march exist (the 11-blue
author line marches its ballista), so verify2 must not.

## Stage 3 expressiveness: deferred seats, shared seats, polish

Decoding the author's line on the 11-blue board showed stage 3's original
model excluded it twice over: five of its nine seats are RED tiles or
ground behind red ZOC (reachable only after kills), and one seat serves
two units in sequence (a router takes it, routs away, an elephant walks
in). March-extended seats were already present. Three mechanisms close
the gap:

- **deferred seats**: every cleared-reach tile that live reach cannot
  enter joins the seat lists, flagged; its walk executes DURING the fight
  as a pending action, offered whenever the engine says the move is now
  legal. Cost floors use the cleared-reach cost; the engine charges truth
  at execution.
- **shared seats**: a tile may carry two claims when a router is
  involved; the router walks first, the partner pends. The fight realises
  the reuse only if the rout actually vacates.
- **two-phase ordering**: speculative branches reshuffled the plain tree
  so badly that left-flank's 19 vanished — so the plain pass (live seats,
  no shares: the exact old arrival order) runs first, and the expressive
  pass extends it. Plan slices are always expressive (a witness's seats
  are often exactly the deferred ones).
- **polish**: hill-climbing repair of the best deployments seen — swap
  one unit's seat, refight, keep improvements. Coordination has local
  gradients (add the missing flank partner, pull a softener into range)
  that global best-first cannot follow. Coverage rounds and polish rounds
  alternate on big boards.

Honest status on the unaided-find gate (f6ff55 pool 45, no seed): the
model now CONTAINS the author's 37-line — all nine seats claimable,
sharing expressible, march included — and the unaided best went 12 → 17
(expressiveness) → 22 (deep plan sweep + polish, 25 min, 8 workers,
replay-verified). It has not reached 37: an 11-unit coordination optimum
sits deeper than ~60k fights of ordering heuristics can reach. Next
levers, unbuilt: population search over deployments (crossover of
per-front seat blocks), conditioning on the spanning units with per-front
exact fights, and annealing restarts from plan witnesses.

## Ideas considered and rejected

- **Hungarian/LP assignment bounds.** The value of a seat is not additive
  per unit (flank seats pay through an ally's blow, collateral through
  neighbours), so a linear assignment relaxation is either unsound or so
  loose it never fires. The kill-set bound conditioned on partial
  assignments prunes on the *real* interaction structure instead.
- **Explicit front decomposition** (condition on spanning units, solve
  fronts independently, sum Pareto frontiers). Correct summation needs
  true independence — no shared flank seats, no rout crossings, no push
  drift, no shared collateral — which none of the real boards quite have,
  and every coupling is a soundness bug of exactly the kind this project
  has been bitten by. The allocator gets most of the same benefit
  implicitly: near-disjoint blow lists make infeasibility proofs cheap.
- **do/undo mutable engine state.** applyAction is ~89µs and leaf fights
  are memoized; the bottleneck in every failure mode observed was
  enumeration order and bound quality, not engine throughput. Not worth a
  second state implementation that can drift from the engine.
- **Dominance-pruning seats** — unsound for flank seats (positional), kept
  out, as deploy_fight already learned.
- **Cartesian best-first heap over seat vectors** — the 11-unit failure
  mode; replaced by the assignment tree (collisions and unaffordable
  vectors never constructed).

## Failure log (things tried while building verify2 that did not survive)

- *Routers' red-tile blows were dropped when the red's tile was also a
  walkable seat* — routFire aggregated over "red tiles not in the seat
  list". Caught because the stage-3 bound then pruned deployments whose
  real fights the exact search was winning; the fix is aggregating over
  ALL drift tiles.
- *Distance-only collateral geometry* let a ballista "pierce" a red three
  tiles away in any direction, giving it travel floors of 2–3 orders to
  the whole board. Pierce needs collinearity behind an adjacent primary;
  splash needs a primary in range adjacent to the victim. Encoding the
  real shapes (with the primary's possible positions as the gate) fixed
  the travel floors.
- *Scoring seats by the bound's rows*: with push drift and speculative
  disarm folded in, the search deployed a crossbowman to hit a spearman
  that would only be there after two imagined elephant pushes — fights
  found 6 STR on a 37-STR board. Bound rows and score rows are now
  separate tables with one rule: bounds use only the optimistic ones.
- *Rank-sum LDS* as the enumeration order: the known-good left-flank
  deployment has rank-sum ~27, and everything below rank-sum 27 must be
  enumerated before it arrives — minutes of leaves that a score-ordered
  heap visits in the first two thousand. Replaced by lazy-successor
  best-first.
- *Naive A\** (push all children per pop): the admissible completion
  heuristic outranks every leaf, so the heap flooded 3M internal nodes
  before evaluating a few thousand leaves. Lazy successors fixed the
  memory; score weighting (`W`) remains available for depth bias.
- *Canonical symmetry ordering enforced during descent*: class members
  with different start tiles have different reachable seat sets, so
  forcing ascending tile order loses deployments one member cannot make.
  Replaced with leaf-level class-signature dedup + min-cost pairing.
- *A fight node cap on the coverage pass* (12k nodes) silently lost
  left-flank's 19-STR line, whose winning fight needs a deeper tree.
  Caps now apply only to plan (finder) slices and are reported.
- *Per-red independent affordability* without an allocation check lets one
  strong blue "kill" three reds at once and overstates U; the allocator
  (each non-router spent on one red, per-(unit,red) primaries at most
  once) closed it.
- *deploy_fight's `damageFrom` range gate* (`hexDistance > rangeMax ⇒ 0`)
  drops height-extended shots — found while building OPT against the
  engine's own `effectiveRange`/LOS predicates, which verify2 uses.

## What stage 1 can and cannot refute (11-blue board, honest numbers)

On `with-a-little-help-from-my-friends` (pool 45) the allocator cannot
refute even the whole-army kill-set: eleven strong blues with a router,
two pierce ballistas and 45 orders genuinely cover 180 red hp under any
sound static relaxation we found (chain adjacency and per-level push
budgets were considered and would not close the gap — the real
obstructions are sequencing and geometry that only play captures). So on
that board U=52 is honest but useless, and the deliverable is the
coverage side. Measured (M-series laptop, 8 workers, seed 37, 40 min):
**52,850 deployments walked in and fought engine-exact** — deploy_fight's
MODE=deploy managed 2,300 in the same time — plus **30,211 assignment
subtrees refuted** by the conditioned kill-set bound. No line above the
author's 37 was found; the ceiling stands at best-known 37, bounded above
by 52. Proving 37 on this board would need play-space exhaustion that
neither tool can reach; what verify2 adds is that the 37 now sits inside
a searched region ~20× wider, still unbeaten.

Validation summary (2026-08-12, revised after the Bottleneck incident):

| board | pool | result | how |
|---|---|---|---|
| the-shore-riders | 10 | **PROVEN 19 STR / 5 orders** | line meets U0, <1s |
| horsing-around | 20 | best known 26 STR / 11 orders, U=31 | rationed model complete; full-play search pending |
| bottleneck | 20 | best known **35** STR / 16 orders, U=46 | stage2u finds the real line (~90s); an earlier rationed-model "PROVEN 30" was wrong and drove the verdict redesign |
| left-flank-right-flank | 30 | found 19 STR / 22 orders | deployment ~1,750, ~3 min, no TOPK truncation |
| with-a-little-help (11 blues) | 45 | best known 37, U=52 | 52,850 deployments + 30,211 refuted subtrees / 40 min |

The Bottleneck row is the cautionary one: every ration-widened stage-2
variant (more moves, swaps, any-tile destinations, LATE 8) either
"completed" at 30 or timed out, while the true-play search both finds 35
and — the deeper point — visits FEWER states, because it carries no
budget counters in its transposition key. Verdicts now grant PROVEN only
to bound matches and full-play completion.
