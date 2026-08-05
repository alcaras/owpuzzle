# owpuzzle — Daily Old World Combat Puzzle (web)

Chess-puzzle-style single-turn tactics puzzles for Old World, playable in the
browser (mobile-friendly). One puzzle a day, Wordle-style; find the BEST move
sequence within your order budget.

**Try it:** `python3 -m http.server -d web 8471` → http://localhost:8471
(or open `dist/owpuzzle.html`, a self-contained single file).

## Architecture

```
tools/extract_data.py    XML -> web/data.js  (units, effects, promotions,
                         terrain, globals — straight from the game's own XML)
tools/extract_icons.py   in-game unit icons (owreference/dist/img/icons/units,
                         the same source owdeepanalysis uses) -> web/icons.js
web/engine.js            JS port of the game's combat core (see below)
web/solver.js            exhaustive search over the player's turn:
                         verifies solvability + solution uniqueness
web/puzzles.js           puzzle library (positions, order budget, objective)
web/app.js + index.html  SVG hex board UI in the owdeepanalysis visual language
                         (dark ground, its terrain palette, banded hills,
                         procedural trees, unit discs + in-game icons)
tools/verify_puzzles.js  node runner: every puzzle must be SOLVABLE, reports
                         winning-line count (1 = unique solution)
tools/build_single.py    bundle everything into dist/owpuzzle.html
```

## The engine is a port of the real game code

Source of truth is the game's shipped C# reference source
(`.../Old World/Reference/Source/Base/Game/GameCore/`):

- **Damage**: `InfoHelpers.getAttackDamage` (InfoHelpers.cs:754):
  `dmg = 6 * attackStr / defendStr` (round up iff attacker stronger, min 1).
- **Strength modifiers**: `Unit.attackUnitStrength` (Unit.cs:8726) /
  `defendUnitStrength` (Unit.cs:9044). Everything is additive percent
  modifiers applied as `base * (100+mod)/100`. Nearly all modifiers are
  data-driven via *effect units* (effectUnit.xml) — units get them from
  traits (melee/ranged/mounted...), innate lists (cavalry have
  EFFECTUNIT_ROUT), and promotions.
- **Counterattack** (Unit.cs:10526): only melee attackers take counter damage,
  computed before the attack, applied even if the defender dies, capped at
  attacker HP-1. Base melee counter is 1; attacking while routed costs +1.
  A **flanked defender cannot counterattack at all** (Unit.cs:10598) — the
  pincer's payoff is counter-cancellation, not bonus damage. A **max-fortified
  defender counters with 100% of its full attack damage** (Unit.cs:10605).
- **Rout & overrun** (Unit.cs:9705, 8342): if a rout-capable attacker
  (cavalry) kills adjacent, it advances into the tile and gets ROUT cooldown,
  which still allows acting — kill chains. Spearmen are immune
  (EFFECTUNIT_POLEARM immunity), so spears stop cavalry chains. The rout (and
  the advance) requires a FURTHER hostile attackable from the ending tile
  (canTargetFrom, Unit.cs:8508) — a lone kill ends the unit's turn in place.
- **Collateral attacks** (Tile.cs:12419): PIERCE (through-line), CLEAVE,
  CIRCLE, SPLASH patterns at a % of full damage (spearman pierce = 25%).
- **Distance/terrain**: ranged −20%/hex beyond 1; melee −50% across rivers;
  trees −50% for ranged attackers; forts +50 defense; fortify +5/turn.
- **Movement**: terrain iMovementCost is the base per-tile cost (9 = 1 move
  point of iMovement), hills/vegetation add, roads override to 6, river
  crossing +6; enemy ZOC ends movement.
- Deliberately excluded for puzzles: criticals (random), cities, events, XP.

## Puzzle format

```js
{ id, name, brief, lesson, orders: N, radius: 3, objective: {kind:'killAll'},
  units: [{player:0|1, type:'UNIT_HORSEMAN', q, r, hp?, promotions?, ...}],
  tiles: [{q, r, terrain?, height?, vegetation?, improvement?, river:[dirs]}] }
```

Objectives so far: `killAll`, `killTarget`, `surviveAll`. Every puzzle must
pass `node tools/verify_puzzles.js` (solvable; aim for winningLines=1).

## Related projects (surveyed 2026-08-05)

- `../owgobo` (Go) — the best prior reimplementation; **differentially tested
  against the real engine with 0 mismatches** (5,472 strikes, 113k reach
  tiles). `sim/damage.go`, `sim/strength.go`, `sim/resolve.go` are the
  reference reading for any rule question; `sim/exactsolve.go` has a
  provably-optimal branch-and-bound max-kill solver.
- `../owearlysim/engine-harness` — the real C# engine, headless (.NET 10).
  For verification: `--puzzle --punits "TYPE@dx,dy@player[@EFF][@dmg]..."`
  emits a loadable save; `--combatserver` loads a save and evaluates one plan
  per stdin line (~100ms/query) with engine-derived legality — the gold
  standard to diff this JS engine against. Caveat: ENDTURN crashes on
  city-less puzzle saves (single-turn only), and `--scenario` verifies in a
  differently-constructed game than `--puzzle` emits — prefer verifying
  against the emitted zip via `--combatserver`.
- `../owpuzzles` — hand-authored puzzles emitted as real in-game saves; the
  puzzle definition lives in `scripts/gen.sh` (no machine format yet).
- `../owdeepanalysis` — canvas map renderer (`viewer/index.html`, 448 lines);
  its procedural terrain art (hill bands, triangle trees) and outlined-label
  technique are ported here; its camera-fit and supersampling tricks are worth
  lifting if the board grows. It has no touch support or hit-testing.
- `../owbattleoptimizer/NOTES.md` — spec-grade description of the combat
  model + calibration insight: unit value scales as modifiedAttack^1.3
  (integer damage amplifies strength gaps).

## Roadmap

- [ ] Validate engine vs the owearlysim engine harness (differential tests)
- [ ] More mechanics: generals, promotions in puzzles, formations, unlimber,
      push/stun, city fights, water
- [ ] Puzzle generator: random positions -> solver -> keep ones with unique,
      non-obvious solutions (search-depth / trap-count heuristics)
- [ ] Real daily pool + archive, streaks, timer, leaderboard (setpuzzle.com
      style), share with emoji grid
- [x] In-game unit icons + owdeepanalysis tile/terrain language
