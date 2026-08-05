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

8. **Difficulty is scope, not obscurity.**
   - *Basics*: one unit, one rule, flat ground.
   - *Tactics*: two-three units cooperating; the rule interacts with another.
   - *Battlefields*: real mined positions where several rules stack.

## Ability coverage matrix

| Ability | Unit(s) | Puzzle |
|---|---|---|
| Rout / overrun chain | horseman, chariot | Overrun |
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
| Mounted +25% open terrain | all mounted | (visible in previews everywhere) |
| Camel +50% vs horse | camel archer | Ships of the Desert |
| Push | elephants | Trample |
| Unlimber + splash + no falloff | onager, mangonel | The Barrage |
| Movement costs / roads | — | The Low Road |
| Fatigue / force march (+training) | — | Over the Hills |
| Real position (stacked rules) | — | The Charge at the River |

## Not yet covered (needs engine work or design)

- Formations (hoplite/legionary TESTUDO stances), disarm (shotelai),
  stealth (scout), circle (cataphract — 10%, needs a crowded fight),
  rapid fire (polybolos), assault/city fights (rams, siege towers),
  naval: anchor inside borders + bireme→trireme upgrade to extend the anchor
  and secure a landing (needs embark/anchor/upgrade actions + an upgrade UI).
- Defensive abilities can only be *felt* by attacking into them (enemies don't
  act in a single-turn puzzle) — fortify-max full counter is the best
  candidate: "kill it without touching it in melee."
