# owpuzzle — Daily Old World Combat Puzzle (web)

Chess-puzzle-style single-turn tactics puzzles for Old World, playable in the
browser (mobile-friendly). One puzzle a day, Wordle-style; find the BEST move
sequence within your order budget.

**Live:** https://owpuzzle.fly.dev — the fly.io deployment is the only site.
(The old GitHub Pages mirror is gone: it drifted from `web/` and served an
engine with known-wrong rules. `docs/` now holds documentation only.)

**Local:** `python3 -m http.server -d web 8471` → http://localhost:8471
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
tools/compute_ceilings.js + tools/deploy_fight.js + tools/verify2.js
                         three independent puzzle verifiers (see
                         docs/making-puzzles.md); each has caught another
                         being confidently wrong — reports
                         winning-line count (1 = unique solution)
tools/ilp_fight.js       ILP line FINDER (tools/turnsolver/): plans a turn as
                         a scheduled integer programme, executes it with the
                         engine; reaches long interleaved lines the searches
                         cannot, proves nothing. `npm install` in
                         tools/turnsolver for HiGHS; SOLVER=cpsat needs a
                         python with ortools ($CPSAT_PY or
                         tools/turnsolver/.venv). `npm run test:ilp`
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
- **Movement & orders** (Unit.cs:7440-7748, 8007-8044): one click moves the
  whole path — orders for all steps are charged at once (steps =
  ceil(total path cost / full movement), getNumStepsForCost). The move
  preview shows the full no-march range like the game's boundary pips
  (getVisibleMoveLimit); March (100 training, Unit.cs:11071) unlocks the
  second band at double order cost per step, capped at 2x the limit. Attacks cost 1 order flat and never
  fatigue the unit. Any cooldown (including ROUT) blocks movement — routed
  units may only attack again. ZOC (Unit.cs:7685): only ZOC->ZOC steps are
  forbidden (entering ZOC does not stop movement), and ZOC does not project
  across rivers. Terrain iMovementCost is the base per-tile cost (9 = 1
  move), hills/vegetation add, roads override to 6, river crossing +6.
- Deliberately excluded for puzzles: criticals (random), cities, events, XP.

## Grounded against the real engine

`tools/ground.sh "<sunits>" "<splan>"` runs a scenario through the actual
game engine (owearlysim/engine-harness) and prints per-strike results.
Verified matches (2026-08-05): overrun chain counters 1/2/2 + no advance on
the final kill + routed-unit move rejected; horseman vs archer = 9 (mounted
+25% vs open terrain applies); archer at range 2 vs spearman = 4; spearman
vs axeman = 4 with pierce 1 to the unit behind; ranged defenders never
counter; melee counter = 1.

## Server (fly.io) — rated puzzles, Discord login, submissions

`server/` is a Node app (express + better-sqlite3) that serves `web/` plus a
rated-puzzle API. Lichess-style: every puzzle is Glicko-2 rated; a solve is a
win against the puzzle, a fail is a loss; only the FIRST attempt counts.
Attempts are SERVER-VERIFIED — the client submits its action line and the
server replays it through the same engine.js. Failed puzzles requeue after
24h (unrated on replay). Anonymous play still works (localStorage, unrated).
Submissions unlock after solving every core puzzle; the in-browser editor
(`/editor.html`) builds puzzles (units, terrain, rivers, promotions,
generals, objectives), checks them with the solver, and submits to a review
queue (Discord webhook ping + admin approve API).

Local: `cd server && npm install && node index.js` → http://localhost:8080

Deploy:
```
fly launch --no-deploy        # uses fly.toml; create the app + volume
fly volumes create owpuzzle_data --size 1
fly secrets set DISCORD_CLIENT_ID=... DISCORD_CLIENT_SECRET=... \
  ADMIN_DISCORD_IDS=<your discord id> DISCORD_WEBHOOK_URL=... \
  BASE_URL=https://<app>.fly.dev
fly deploy
```
Discord app: create at discord.com/developers, add redirect
`https://<app>.fly.dev/auth/callback`, scope `identify`.

## Puzzle format

```js
{ id, name, brief, lesson, orders: N, radius: 3, objective: {kind:'killAll'},
  units: [{player:0|1, type:'UNIT_HORSEMAN', q, r, hp?, promotions?, ...}],
  tiles: [{q, r, terrain?, height?, vegetation?, improvement?, river:[dirs]}] }
```

Objectives: `killAll`, `killList`, `killTarget`, `capture`, `maxKill`.
Before publishing, follow docs/making-puzzles.md — prove the ceiling with the
verifiers in tools/, and run `npm test` + `npm run test:ceilings`.

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
