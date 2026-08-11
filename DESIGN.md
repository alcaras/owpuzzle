# Puzzle design principles

What makes these work (distilled from the first eleven):

1. **One mechanic, one aha.** Each puzzle isolates a single rule and makes it
   the entire difference between defeat and victory. If a puzzle needs two new
   rules, it's two puzzles.

2. **The trap is the obvious move.** The natural line — attack the nearest
   enemy, shoot from where you stand, charge straight in — must fail by a
   *small, visible* margin (one damage short, one order over). The player has
   to feel the rule's weight, not read about it.

3. **Tight budgets are the teeth.** Orders are the currency; the winning line
   spends every one. The solver enforces this: every puzzle must be SOLVABLE
   with a UNIQUE winning outcome (`tools/verify_puzzles.js`).

4. **Numbers must be countable.** HP pips (1 box = 1 HP), damage previews on
   hover, and the breakdown panel let the player do the arithmetic. Keep it in
   working memory: ≤4 units per side, board radius ≤4.

5. **Real rules only.** Everything is grounded on the game's own C# and
   differential-tested against the engine harness. A lesson learned here
   transfers to the real game — that's the entire point.

6. **The lesson is the reward.** The victory screen states the rule the player
   just proved to themselves, in one sentence.

7. **The unit is the hero.** Per-unit puzzles ask "what can THIS unit do that
   nothing else can?" — the palton's bloodless rout chain, the ballista's
   column-piercing bolt, the elephant's shove. Name the puzzle after the deed.

8. **Hidden par.** Players get a forgiving pool (+6 orders, 300 training) so
   mistakes are playable, and the brief never states the optimal order count.
   Solving at all is a win; solving at par earns the PERFECT star. The
   discovery of "how few is possible?" is itself part of the puzzle.

9. **Give them more army than they need.** In challenge puzzles, include
   units the optimal line does NOT use — decoys, tempting slow paths,
   redundant attackers. Several lines should reach the objective at
   different order costs; only one hits par. A unit is never dead weight if
   it anchors a plausible-but-inefficient plan.

10. **Difficulty is scope, not obscurity.**
   - *Basics*: one unit, one rule, flat ground.
   - *Tactics*: two-three units cooperating; the rule interacts with another.
   - *Battlefields*: real mined positions where several rules stack.

## Composition theory (borrowed from chess problems)

Chess composition has a 150-year-old vocabulary for what makes a puzzle good,
and most of it transfers:

- **The key.** The first move of the solution. The strongest keys are *quiet*
  (not a capture/check — for us: not an attack) and *paradoxical* (they look
  wrong: a sacrifice, a retreat, declining a capture). A key that is also the
  most tempting move is a weak key.
- **Tries and refutations.** A good problem has 2–3 plausible plans that fail
  by a small, visible margin, each for a *different* reason. The tries are the
  teaching: understanding why each fails is understanding why the key works.
  A "try" that also reaches par is not a try — it's move-order freedom.
- **Paradox.** The solution should defy a natural principle of play. Research
  on generated puzzles (DeepMind 2025) operationalizes this as *shallow search
  vs deep search disagreement* — the greedy move is not the right move.
- **Economy / unity.** Every unit serves the idea or the soundness. A decoy is
  never dead weight — it anchors a plausible-but-refuted try.
- **Difficulty is idiosyncratic.** Hristova et al. 2014: even strong players
  cannot rank puzzle difficulty. Trust the Glicko ratings, not our seeds.

`tools/analyze_puzzle.js` measures this per puzzle: the winning first
action(s), whether the key is QUIET, its **paradox rank** (how many legal
first actions deal more immediate damage than the key), and the loudest
refuted tries with their failure margins. Quality bar for new Tactics/
Battlefield puzzles: paradox rank ≥ 2 **or** a quiet key with real
alternatives, and at least one refuted loud try.

### Paradox vocabulary for Old World

The OW-native forms of "the move that looks wrong":

1. **The wrong-way advance** — Rout advances are mandatory and directional;
   the loudest kill can carry you away from the objective (*Cut the
   Bowstring*).
2. **The rout ferry** — kills as free movement: plan the advance lane by kill
   order, not by damage.
3. **Decline the kill** — a wounded enemy begs to die, but the order is needed
   elsewhere (*Leave Him*).
4. **The quiet flank key** — move 1 deals zero damage: park a unit on the far
   side so the real attack is flanked (*The Pincer*).
5. **Weak unit first** — attack order matters: softening thresholds, rounding
   (round up iff stronger), and who must land the killing blow.
6. **Push to align** — the elephant shove as geometry, not damage: relocate an
   enemy into a pierce/splash lane (*The Shove*).
7. **Spend to save** — force march's 100 training / double orders, or eating a
   counterattack on purpose, because position is worth more than the cost.
8. **Kill by spill** — some enemies cannot be killed by the blow aimed at
   them (Last Stand caps lethal damage at hp−1); only collateral from an
   attack on a NEIGHBOUR finishes them, so that neighbour must be kept alive
   (*The Last Stand*).
9. **The anvil** — a unit that cannot kill anything can still decide the
   fight by standing opposite: a commander leader gains +100% strength when
   flanking, so weak troops are positioning, not damage (*The Anvil*).
10. **The small kill that opens the map** — killing a cheap unit removes its
   zone of control, unlocking the path the real attack needs (*The Gatekeeper*).

## Ability coverage matrix

| Ability | Unit(s) | Puzzle |
|---|---|---|
| Rout chain | horseman, chariot | Rout |
| Rout immunity (polearm) | spear line | The Spear Wall |
| Anti-mounted | spear line | The Spear Wall (trap line) |
| Pierce 25% | spearman | One Thrust |
| Pierce 50% ×2 + anti-infantry | ballista | One Bolt, Three Bodies |
| Pierce 50% + anti-melee | crossbowman | The Bodkin |
| Cleave 25% | axeman | One Swing |
| Cleave 50% + anti-infantry | swordsman | Butcher's Work |
| Anti-polearm | axeman | Chop the Spears |
| Ranged falloff −20%/hex | archer | Point Blank |
| No counter for ranged | archer, palton | Point Blank, Parthian Tactics |
| Ranged rout chain | palton cavalry | Parthian Tactics |
| Trees −50% vs ranged | (terrain) | Into the Woods |
| River −50% melee | (terrain) | The Ford, Charge at the River |
| Flanking (+saddleborn, counter-cancel) | cavalry | The Pincer |
| Flanking modifier (+100% for a commander leader) | horseman general + militia | The Anvil |
| Mounted +25% open terrain | all mounted | (visible in previews everywhere) |
| Camel +50% vs horse | camel archer | Ships of the Desert |
| Push | elephants | Trample |
| Unlimber + splash + no falloff | onager, mangonel | The Barrage |
| Movement costs / roads | — | The Low Road |
| Rout advance is mandatory + directional | horseman | Cut the Bowstring |
| Push as positioning + pierce lane | war elephant, ballista | The Shove |
| ZOC unlock (kill frees the road) | — | The Gatekeeper |
| maxKill / strength-per-order (decline the bait) | — | Leave Him |
| Fatigue / force march (+training) | — | Over the Hills |
| Real position (stacked rules) | — | The Charge at the River |
| Multi-theatre battle (ZOC gate + pierce + rout ferry + push) | cataphract, ballista, elephant | The Two Fords |
| Ranged line of sight (mountains block, water does not) | (terrain) | The Man Beside Him |
| Last Stand (zealot) + splash finisher, attack ORDER | akkadian archer | The Man Beside Him |

## Designing a large puzzle (par 10+)

The binding constraint is VERIFICATION, not imagination. Search cost scales
with the number of blue *movers*, not with unit count — so a big puzzle means
**few blue units and many red**: 4 blue x ~3 actions = 12 orders, while 9 reds
supply targets, zones of control and decoys almost for free.

- `tools/macro_ceiling.js` / the macro search collapses move-steps into
  (move + attack) macros; rout chains fall out as consecutive attack macros.
  Move-ordering (most strength destroyed first) plus dropping moves that
  neither attack nor park within reach is what makes 12-ply searches converge.
- Length must come from INTERLOCKS, not from ten easy chores: one theatre's
  solution should enable another's. Killing a polearm grants no rout advance,
  so polearm units are the natural CHAIN-BREAKERS that stop one cavalry unit
  soloing the board (the first draft of The Two Fords was won in 8 orders by
  the cataphract alone until spearmen were placed to cut the ferry).
- A decoy theatre that is never worth its orders is good design, not waste —
  it is where the order budget goes to die.

## Not yet covered (needs engine work or design)

- Formations (hoplite/legionary TESTUDO stances), disarm (shotelai),
  stealth (scout), circle (cataphract — 10%, needs a crowded fight),
  rapid fire (polybolos), assault/city fights (rams, siege towers),
  naval: anchor inside borders + bireme→trireme upgrade to extend the anchor
  and secure a landing (needs embark/anchor/upgrade actions + an upgrade UI).
- Defensive abilities can only be *felt* by attacking into them (enemies don't
  act in a single-turn puzzle) — fortify-max full counter is the best
  candidate: "kill it without touching it in melee."
