# Mined puzzle candidates

Five puzzles authored from real positions in `mined/scenes.json` (the NestorLN
scene is skipped — already used). For each one the attacking side became
player 0 (blue), the victim player 1 (red), terrain is copied verbatim from the
scene inside the puzzle radius, and HP was tuned down to a mid-battle state so
that the historical kill is reachable inside one turn.

Verification: `SOLVER.solve(puzzle, { maxStates: 400000 })` against
`web/engine.js` + `web/solver.js`. Every entry is solvable with a **single**
winning outcome (`winCount = 1`) at the stated par, and no line explored was
truncated.

| Puzzle | Source scene | Par | winCount | Solve |
|---|---|---|---|---|
| The Shore Riders | scene 9 — avN, turn 68 | 5 | 1 | 91 ms (520 states) |
| The Wood Line | scene 8 — alcaras v Marauder, turn 66 | 4 | 1 | 26.4 s (43 861 states) |
| The Jungle Road | scene 6 — alcaras v JCT, turn 86 | 4 | 1 | 5.5 s (13 456 states) |
| The Crossed Lanes | scene 1 — Auro v alcaras, turn 107 | 3 | 1 | 1.2 s (3 674 states) |
| Down the Avenue | scene 2 — alcaras v ThePurpleBullMoose, turn 101 | 4 | 1 | 3.5 s (5 571 states) |

---

## The Shore Riders (`the-shore-riders`)

- **Source**: scene 9 (avN, turn 68), window centred on the scene's (1,0),
  radius 3 — the shoreline with the coast to the north and the hill town inland.
  Attacker was player 0; the victim lost an archer, a Beja archer, a chariot and
  a bireme that turn. Objective = the chariot, the Beja archer and the bireme.
- **Kernel**: the lead rider is locked in contact — every tile around it lies in
  enemy ZOC, so it cannot slide and the turn is won by *firing order*. A
  palton's point-blank kill routs like a charge, and each rout buys another
  shot, but only while a further enemy is reachable from the tile it fires from.
- **Par**: 5. **winCount**: 1. **Solve**: 91 ms, 520 states explored.
- **Winning line** (`describeLine`):
  1. palton cavalry #0 @(0,0) attacks chariot #2 @(-1,0) for 8 (hp 8→0), overruns to (-1,0)
  2. palton cavalry #0 @(-1,0) attacks Beja archer #3 @(-1,1) for 4 (hp 8→4)
  3. palton cavalry #1 (1,0) → (0,0)
  4. palton cavalry #1 @(0,0) attacks bireme #4 @(0,-1) for 6 (hp 6→0), routs
  5. palton cavalry #1 @(0,0) attacks Beja archer #3 @(-1,1) for 4 (hp 4→0)
- **Trap**: the Beja archer needs two hits, and only the second rider can supply
  the second one — and only after the first rider has vacated (0,0). Opening
  with the archer, or leaving the first rider parked, loses the turn.

## The Wood Line (`the-wood-line`)

- **Source**: scene 8 (alcaras v Marauder, turn 66), window centred on the
  scene's (1,0), radius 3 — the treeline west of the river crossing, town
  tiles to the east. The victim lost two archers, an axeman, a spearman and a
  chariot that turn. Objective = the axeman and the archer in the trees.
- **Kernel**: trees halve ranged attacks, so the slingers can only scratch the
  archer (2 a shot) — but vegetation does nothing against a charge. The
  elephant kills into the wood, overruns into the vacated trees, and takes the
  axeman from behind; a single sling stone finishes him.
- **Par**: 4. **winCount**: 1. **Solve**: 26.4 s, 43 861 states explored.
- **Winning line**:
  1. african elephant #0 (1,-1) → (0,0)
  2. african elephant #0 @(0,0) attacks archer #4 @(-1,1) for 8 (hp 8→0) — ROUT, overruns to (-1,1)
  3. african elephant #0 @(-1,1) attacks axeman #3 @(0,1) for 9 (hp 13→4)
  4. slinger #1 @(1,1) attacks axeman #3 @(0,1) for 4 (hp 4→0)
- **Trap**: shooting the treed archer with both slingers (2 damage each) is the
  obvious opening and cannot get there. The second archer in the trees and the
  anti-mounted spearman are decoys.

## The Jungle Road (`the-jungle-road`)

- **Source**: scene 6 (alcaras v JCT, turn 86), window centred on the scene's
  (2,0), radius 3 — the jungle road above the lake. The victim lost a slinger,
  an onager, a spearman, an armoured elephant and a chariot that turn.
  Objective = the armoured elephant and the onager.
- **Kernel**: the axes barely scratch armour (3 a blow) and cannot break the
  elephant between them; the horse crushes siege (9) but cannot reach the onager
  past the elephant. The answer is to soften with an axe and let the cavalry
  land the *killing* blow from (1,-1) — the one tile that already touches the
  onager, so the rout converts into a second attack.
- **Par**: 4. **winCount**: 1. **Solve**: 5.5 s, 13 456 states explored.
- **Winning line**:
  1. kushan cavalry #2 (2,-1) → (1,-1)
  2. axeman #0 @(1,1) attacks armoured elephant #3 @(1,0) for 3 (hp 7→4)
  3. kushan cavalry #2 @(1,-1) attacks armoured elephant #3 @(1,0) for 4 (hp 4→0) — ROUT
  4. kushan cavalry #2 @(1,-1) attacks onager #4 @(0,-1) for 9 (hp 9→0)
- **Trap**: both axemen on the elephant totals 6 against 7 HP; killing the
  onager first advances the rider onto (0,-1), out of reach of the elephant.
  The two spearmen are decoys — juicy anti-polearm targets that win nothing.

## The Crossed Lanes (`the-crossed-lanes`)

- **Source**: scene 1 (Auro v alcaras, turn 107), window centred on the scene's
  (1,-1), radius 3 — the lush ground between the coast road and the town. The
  victim lost three legionaries, a hastatus, two ballistae, two pikemen, a
  swordsman, a war elephant and a trireme that turn. Objective = two legionaries
  and the hastatus.
- **Kernel**: a ballista bolt carries on through the body it hits. The two
  engines stand on different bearings, so both firing at the *same* front-rank
  legionary skewer two different men behind him — the hastatus two tiles down
  one lane, the wounded legionary one tile down the other. The longbow finishes
  what the second lane started.
- **Par**: 3. **winCount**: 1. **Solve**: 1.2 s, 3 674 states explored.
- **Winning line**:
  1. ballista #0 @(0,0) attacks legionary #4 @(-1,0) for 8 (hp 16→8) + pierce hastatus #6 for 5 (hp 5→0)
  2. ballista #1 @(0,-1) attacks legionary #4 @(-1,0) for 8 (hp 8→0) + pierce legionary #5 for 4 (hp 7→3)
  3. longbowman #2 @(1,0) attacks legionary #5 @(-2,1) for 3 (hp 3→0)
- **Trap**: spreading the engines over the three targets. Shooting the hastatus
  directly (10 damage into 5 HP) throws away the only lane that reaches him,
  and the front legionary then survives on 8. The turreted elephant is a decoy:
  it needs the whole turn just to close the distance.

## Down the Avenue (`down-the-avenue`)

- **Source**: scene 2 (alcaras v ThePurpleBullMoose, turn 101), window centred
  on the scene's (0,0), radius 3 — the main street of the besieged city. The
  victim lost two phalangites, a longbowman, a war elephant, an onager, three
  spearmen and two workers that turn. Objective = both onagers and the spearman.
- **Kernel**: the street lines three defenders up behind one another. One bolt
  from the ballista kills the near onager, wounds the far onager through it and
  kills the spearman two tiles further down. The crossbowman then loops round
  the block — on the roads two tiles cost one step — and finishes the survivor.
- **Par**: 4. **winCount**: 1. **Solve**: 3.5 s, 5 571 states explored.
- **Winning line**:
  1. ballista #0 @(-1,0) attacks onager #3 @(0,0) for 8 (hp 8→0) + pierce onager #4 for 4 (hp 10→6), spearman #5 for 7 (hp 7→0)
  2. crossbowman #1 (-2,2) → (-1,3)
  3. crossbowman #1 (-1,3) → (0,1)
  4. crossbowman #1 @(0,1) attacks onager #4 @(1,0) for 6 (hp 6→0)
- **Trap**: the ballista can also put 8 into the longbowman standing right
  beside it, and 13 into the spearman if it walks up the street first — either
  shot wastes the one bearing that strings all three defenders on a single bolt.
  The war elephant and the longbowman are decoys, and the blue spearman needs
  most of the turn just to walk round the lake into the fight.
