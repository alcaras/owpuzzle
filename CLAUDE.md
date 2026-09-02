# owpuzzle

Daily single-turn Old World combat puzzles. Live at https://owpuzzle.fly.dev.

- `web/engine.js` — the combat engine, a port of Old World's own rules
- `web/app.js`, `web/index.html` — the player
- `web/editor.js` — the community puzzle editor
- `server/` — express + sqlite: auth, ratings, submissions, achievements
- `tools/` — data extraction, the puzzle verifiers, and `export_save.js`
  (writes a board as a real loadable Old World save — see the README)
- `test/` — the rules suite (see below)
- `drafts/` — puzzles being designed, not yet published

## The one rule that matters

**The game is the source of truth, not our intuition.** Every rule in
`engine.js` is a port of specific code in Old World's own source, which ships
with the game:

```
~/Library/Application Support/Steam/steamapps/common/Old World/Reference/
    Source/Base/Game/GameCore/{Unit,Tile,Game}.cs
    XML/Infos/{unit,effectUnit,unitTrait,terrain,height,globalsInt}.xml
```

`tools/extract_data.py` pulls the XML into `web/data.js` (`npm run data`).
If a rule question comes up, read the C# or the XML and cite it. Numbers
remembered from playing are a hypothesis; the source settles it.

## Water movement — read this before touching it

Five interacting rules, each a separate line of C#. It took three wrong
implementations in one sitting to get them all, because each fix looked
complete on its own:

| rule | where |
|---|---|
| control radius comes off the unit — bireme 3, trireme 4, dromon 5 | `Unit.waterControl`, Unit.cs:3480 (`iWaterControl`) |
| the ship must be ANCHORED | `setAnchoredTurns`, Unit.cs:3125-3160; `Tile.cs:3404` |
| the controlled area is CONTIGUOUS water, not a circle | `updateWaterControlTiles`, Unit.cs:4003 (`getContiguous`) |
| water you OWN is crossable with no ship at all | `Tile.isWaterMovement`, Tile.cs:8103 |
| crossing is CHEAP: `movement()`, the raw 1-3 — not `movementFull()` | Unit.cs:7583 vs 6341 |
| a land unit may CROSS water but never END on it | `canUnitTypeOccupy`, Tile.cs:10577-10605 (`if (bFinalTile)`) |

The last two are the ones that bite. `movement()` and `movementFull()` are
different methods; a land tile costs 9, so controlled water is about **nine
times cheaper** than land — that is why it is called *fast* water movement, and
charging the 9x figure made the whole mechanic look broken. And because water
can never be a final tile, it belongs on the search frontier but never in the
destination set: units path *through* it to the far bank. That is what water
control is *for*.

A land unit may also cross a friendly anchored ship's own tile: `canUnitOccupy`
(Tile.cs:10500-10531) blocks a hostile unit on any tile but tests friendly ones
only when `bFinalMoveTile`.

One rule here rests on the owner's word rather than a citation: **a land unit
afloat cannot attack**. The nearest C# guard (`canTargetTile`, Unit.cs:8449)
bars *tribe* units only. It is enforced anyway, because the editor still lets an
author place a land unit on water.

## Stealth — implemented only where the game resolves it without a viewer

Scouts (EFFECTUNIT_STEALTH) and tactician-led ranged units hide in trees or
jungle. The vision system is out of scope (a puzzle shows the whole board), so
the engine implements hidden-ness only where the C# tests it with
`TeamType.NONE` or between hostile teams — checks that need no fog:

- a hidden unit does not block a **panic shove** (`getPushTile` tests
  candidates with NONE, Unit.cs:10082; `canUnitOccupy` skips hidden units,
  Tile.cs:10514) — the pushed unit lands there and the hidden unit is bounced
  aside (Unit.cs:1918-1921). This is what makes scouts *herd* a panic.
- **+10% attacking from hiding** (HIDDEN_ATTACK_MODIFIER, Unit.cs:8843).
- attacking, routing or being stunned reveals (`hasVisibleAttackCooldown`,
  Unit.cs:3941); enemy territory offers no cover (Unit.cs:3535-3541).

Deliberately NOT implemented (vision-side, would matter only for a *red* scout
in trees): blue being unable to target it, and blue moving through it. Scouts
also cannot attack at all — no bMelee, no range — which is the game's rule,
not an omission. See `test/rules/stealth.test.js`.

## Testing

```
npm test              # rules + library invariants, ~100ms — run this constantly
npm run test:ceilings # SLOW: re-prove every published maxKill ceiling
```

### Language traps that have caused wrong diagnoses

- **`applyAction` returns a NEW state; it does not mutate.** Discarding the
  return value replays every action against the starting position, which looks
  exactly like a corrupt recording. This produced a confident, wrong "the
  author's line is invalid" verdict about a line that was fine.
- **`null <= 0` is `true`.** An editor board spells "full health" as `hp: null`,
  so `if (u.hp <= 0) return` silently skips every unplaced unit.
- **Player 0 is falsy.** `if (map[key])` where the value is a player index drops
  blue and keeps red. Compare against `null`.

### Why the suite exists

Nearly every bug this project has had is the same shape: a rule that looked
right, was wrong in a specific case, and stayed wrong because nothing checked
it. A sample, all real:

- the shoreline penalty applied twice, so shore assaults did nothing at all
- `canTargetFrom` and `canTargetTile` use **different** range rules in the game;
  we used the strict one for both, so units would not rout onto high ground
- cavalry were held by zone of control because the engine read `bIgnoreZOC`
  from effects but not from the unit
- urban tiles were not roads, because nobody extracted `bRoadFree`
- a maceman kept its anti-infantry bonus against arrows, because the bonus is
  gated on the **attacker** being melee, not the defender
- onagers shot enemies standing next to them for a year: `iRangeMin` was
  never implemented (Unit.cs:8493). Nobody noticed until a puzzle was
  designed *around* minimum range
- a unit carrying a leader effect was not a general, so promotions that
  hunt generals did nothing. In the game those effects exist only because a
  general is attached (Unit.cs:2274)

None of these are exotic. They are all "we implemented the neighbouring rule".

### How the tests are organised

**`test/rules/*.test.js`** — one rule per test on a tiny synthetic board, using
the DSL in `test/helpers.js`:

```js
const g = setup(`
  tile 1,0 HEIGHT_HILL
  blue PALTON_CAVALRY 0,0
  red ARCHER 2,0 hp=6
`);
assert.equal(canHit(g, g.blue(), g.red()), true);
```

**Every rule test names the file:line or XML field it encodes**, in the test
title. A test without a citation only freezes today's belief, which is how the
bugs got in. If a test fails after a change, read the citation first and decide
which of the two is wrong — twice now the test was wrong and the engine right.

**`test/coverage.test.js`** — enumerates every effect field **and every unit
field** the data actually uses, and asserts each is implemented or listed with
a reason. A mechanic can never go missing silently: a new field fails the build
and forces a decision. Known gaps live there too, so they stay visible.

The unit-field half exists because the effect-field half could not have caught
`iRangeMin`: it lives on the unit, not on an effect, so an entire mechanic sat
unimplemented for a year inside an audit whose whole job was to prevent that.
When you add an audit, check it would have caught the bug that motivated it —
run it against a source with the fix removed and watch it fail.

**`test/library.test.js`** — structural invariants over the shipped puzzles:
they load, unit types exist, no two units share a tile, ceilings do not exceed
the red army's worth, par fits its own pool.

**`test/ceilings.test.js`** — the expensive one. Re-proves every published
maxKill ceiling against the current engine. **Run this after any rules change**:
a ceiling that becomes beatable is a puzzle telling players "maximum
destruction" about a number they can exceed, which is the worst bug we ship.

It only covers `web/puzzles.js` — the ~45 core puzzles. **The live library is
bigger: approved community puzzles are equally live and are NOT in that file.**
A water rule was once declared "inert on the published library" on the strength
of the core boards alone; the one board it actually broke was a community
puzzle, and a player found it. When a rules change lands, sweep
`/api/puzzles` for the boards that can exercise it, not just the repo.

Two operational notes on the slow suite:

- **Never `pkill -f deploy_fight.js` while it runs** — ceilings spawns that as a
  subprocess, and killing it reports as a failed ceiling.
- A timeout prints a lower-bound note instead of failing. Running other
  verifiers concurrently steals cores and *creates* those timeouts, so a board
  that suddenly "goes slow" may just be your own load.

### Designing boards so they can be verified

Verification cost scales with how many tiles the blue units might want. Few
blue units and terrain that constrains their options keeps a board provable.
A puzzle nobody can verify is a puzzle whose ceiling is a guess.

## Making puzzles

See **[docs/making-puzzles.md](docs/making-puzzles.md)** before designing one.
The short version: the trick has to be *required*, not merely available —
three of five drafts in one sitting were withdrawn because the verifier found
a duller line that reached the same ceiling without using the idea.

## Verifiers

Three independent implementations, deliberately:

- `tools/compute_ceilings.js` — exhaustive branch-and-bound over the order pool
- `tools/deploy_fight.js` — engine-exact search with a seat model, plus
  `MODE=deploy` best-first over whole deployments for large boards
- `tools/verify2.js` — kill-set upper bounds + assignment search over
  deployments; scales to 10+ blue units and can PROVE a ceiling without
  exhaustive search when a found line meets the bound
  (see [docs/verifier-design.md](docs/verifier-design.md))

And one **finder** that is not a prover:

- `tools/ilp_fight.js` over `tools/solverengine/` — the turn as a scheduled
  integer programme (blow table → CP-SAT/HiGHS → engine-exact execution). It
  reaches long interleaved lines the searches never execute: f6ff55's 37-STR
  author line in ~40s (`SOLVER=cpsat … --k 6`; the fight search's best is
  27). Its blow table keeps a few seats per (unit, target), so a line it
  misses proves nothing; never cite it as a ceiling. `npm run test:ilp`
  guards the 37. The core is a position solver, not a puzzle solver: keep it
  ignorant of what it is solving — pool, training, objective, counter-damage
  price are inputs, and nothing puzzle-shaped belongs inside it.

Keep all of them. Each has caught another being confidently wrong — including a
`deploy_fight` bound that pruned whole trees while reporting "search complete".
**Treat "search complete" with the same suspicion as a finding**; agreement
between independent tools is what makes a ceiling trustworthy.

Publishing checklist for a maxKill puzzle: prove the ceiling, confirm the
intended line **is** the optimum (not merely *a* line that reaches it), and
check the trick is *required* — three of five drafts died because a cheaper
line reached the same ceiling without the idea the puzzle was built around.

## In flight (2026-09-01)

- **The ILP position solver landed as `tools/solverengine/`** (blowtable, model,
  lp + cpsat.py, solve) with `tools/ilp_fight.js` as its puzzle driver and
  `test/solverengine.test.js` (structural tests always; `npm run test:ilp` for
  the real solves — it hard-fails on a missing backend rather than skipping).
  The key insight of the two-phase solve: the timing-free master must not
  promise a kill set the schedule cannot deliver, and the rows that keep it
  honest (`hx` seat hand-over corollaries, `cy` 2-cycle cuts, `rk` rank
  integers) were found mechanically — fix a master solution in the full
  model, delete row families until feasible, read off the survivors.
- **Engine follow-ups from the planner, both landed:** `waterControlled` is
  memoised per state behind a ship signature (id, tile, alive, anchored) so
  verifiers that mutate clones in place still see fresh control — the blow
  table spent 90% of its time there on water boards (lab copy 39s → 2s);
  and `hasPush` now follows Unit.cs:10046-10068 — no shove out of a
  settlement, none when the defender is immune to the push effect (a
  ruler-led unit carries EFFECTUNIT_LEADER_GENERAL, immune to PANIC), and
  a shoved siege unit loses its set-up (Unit.cs:9690-9693). Rule tests in
  `test/rules/{movement,push}.test.js`; inert on all 55 live boards; every
  ceiling re-proved. The model also takes `counterW` (per-hp price on the
  counter damage a blow eats — counters never kill, Unit.cs:10614).
- **The ruler aboard, closed (2026-09-02).** A `*_LEADER` effect exists
  only because the general is the ruler (trait.xml `LeaderEffectUnit`,
  Character.cs:10608-10616), and the ruler's unit also carries
  EFFECTUNIT_LEADER_GENERAL (+1 move, immune to PANIC/DISARMED/GRAPPLER/
  TACTICIAN_LEADER — Character.cs:6508). `effectsOf` now attaches it,
  driven by `DATA.characterTraits` (new in `extract_data.py`: every trait's
  general/leader effect). Extracting that table also let the coverage audit
  see the ruler effects for the first time — its reachable set had been
  built from unit traits alone — and it surfaced **bStun**
  (EFFECTUNIT_TACTICIAN_LEADER): implemented, `hasStun` per Unit.cs:7069,
  the survivor is STUNNED and cannot counter (Unit.cs:10634). Three ruler
  gaps are acknowledged instead (Hannibal's extra action, Zealot heal-on-
  kill, Hero launch-offensive). Rule tests in `test/rules/push.test.js`.
  Live impact: three boards carry EFFECTUNIT_COMMANDER_LEADER (the-anvil,
  left-flank-right-flank, king-of-the-hill); no board carries a stun. All
  12 published maxKill ceilings re-proved; king-of-the-hill's recorded
  author line now fails at action 13 (the red ruler no longer panics) but
  the 12-action `-line18` still kills all three, so it stays solvable.
  the-anvil (killAll, par 6, its ruler's horseman now moves 4): verify2
  still kills all three in 6 and proves 16 of 24 the most in a 5-order
  pool (full-play search complete), so the par holds; the exhaustive
  `solver.js` line count — its "unique" claim — was not re-run (43 min
  without finishing at 3M states). left-flank-right-flank (community, 190 of a 230 red army) is an
  author-line ceiling (copied from the author's replay at approval) that
  was never proven: verify2 bounds it at U=23 and finds only 14, before and
  after. Its ruler is blue, so the change can only add lines, never remove
  the author's; the 190 stands as it did — unproven, not re-proved.
- **Scouts are in the editor, for stealth herding.** The Stealth section above
  has the rules; `test/rules/stealth.test.js` has the citations. The scout is
  a pure body — it cannot attack (no bMelee, no range; the game's rule) — and
  its value is that hidden in trees/jungle it does not block a panic shove,
  while visible it does, so it steers where a panicked enemy ends up. Same
  change fixed a latent push bug: a shove can no longer end a land unit on
  friendly-controlled water (bFinalTile, Tile.cs:10598). Both changes proved
  inert on all 55 live boards (swept `/api/puzzles`: no stealth units, no red
  ship or red-owned water next to a bPush board) and every ceiling re-proved.
  `verify2`'s push-drift bound needed no change — it never excluded occupied
  tiles, so hidden-scout pass-through was already inside the over-approximation.
- **`tools/solverengine/threat.js` — the threat map, and `exposeW` in the
  model.** The mirror of the blow table: every enemy teleported to every
  post a fresh turn reaches, engine-exact damage to our unit on a tile;
  `exposeW` charges a blow the loss of its seat relative to home. Default
  0, `ilp_fight` never sets it — no puzzle impact, the 37 still holds.
  Measured on a real position it moved what was in reach and not the
  reply: the model has no retreat action, and an order-limited enemy only
  cashes the cheapest kills. Verdict in the file header; do not re-buy it.
- **No puzzle uses a scout yet.** The first herding board should follow
  docs/making-puzzles.md ("Stealth herding" row) and the full author-house-
  puzzle gauntlet — the trick must be *required*, and a scout who could be
  replaced by any blocking body is not a trick.

## Earlier (2026-08-19)

- **Seeding retires a row only when the FIGHT changes** (`puzzleHash`), not on
  any json diff. Rewording a name/brief/lesson used to retire the row and take
  every solve with it, so the library's tick and the Hall of Fame's count
  disagreed forever. `reuniteRewordedSolves()` repaired the damage at boot —
  69 stranded attempts — and is idempotent. See `test/seeding.test.js`.
- **The test suite is otherwise dependency-free**; the seeding tests drive the
  real `server/db.js`, so CI installs `server/`'s sqlite driver and then asserts
  it loads. Without that assert the tests would silently *skip*, and a skipped
  gate looks exactly like a passing one.
- `web/data.js` now carries `nation` (unit.xml `NationPrereq`) purely so the
  editor can group the unique units; it is acknowledged, not a combat rule.

## Earlier (2026-08-14, updated 08-25)

- **The verifier/optimizer programme is on main now**: verify2's stage 3,
  the LNS polish (exact k-subset rebuild behind the kill-set gate),
  cross-worker seed sharing, per-worker witness streams, climb-provenance
  tags, and a LEARNED seat ordering that is default-on for the expressive
  pass (`V2_RANKER=0` opts out; trained only on generated PROVEN boards,
  so bench claims stay unaided). `docs/optimizer-handoff.md` is still the
  resume point; read it before touching `tools/verify2.js`. Bench: five of
  six rows pass unaided — king is PROVEN 180/18, matching the live par.
  The moonshot f6ff55 stands at best-known 270/30 (line kept at
  `bench/lines/`), unaided spread {16..27} over six runs of the shipped
  config. Every schedule hypothesis this week was settled by measurement;
  two (leader-depth, v3-linear features) were rejected on data — the
  verdicts are in the handoff, do not re-buy them.
- **The named next experiment for f6ff55** (cheap, decisive, not yet run):
  pin the author's own nine seats as a placement and let `evalPlacement`'s
  fight machinery try to cash the 370/37 out. The line is fully
  expressible and its seats rank near-top under its own witness — if the
  FIGHT search cannot execute it (11-unit interleaving; plan-slice fights
  are capped at 2500 nodes), the remaining gap is fight-execution depth,
  and no amount of deployment-ordering work will close it. Run that
  before any further ordering research.
- **`phase1-library-store` branch** now carries only the frontend refactor,
  tested on owpuzzle-dev.fly.dev and still awaiting a manual pass against
  `docs/phase1-test-plan.md` (the plan lives on that branch, not main) before
  merge.
- **`drafts/counterbattery.js`** — a siege puzzle mid-design. Its header holds
  the measured damage numbers and the idea: an onager with an enemy standing on
  top of it cannot fire (minimum range), and an elephant's PANIC shove is what
  clears its own firing lane. Not yet verified for "is the trick *required*".
- `verify_puzzles.js` truncates at 500k states; puzzles that hit the cap need
  `slowVerify: true` or they report a scary false negative after ten minutes.

## Community

Submissions arrive via the editor with the author's own solution recorded, land
as `pending`, and are verified locally — never on the server. Any player line
that beats a published par is logged and flagged in the admin panel with its
replayable action line, for review rather than automatic application: it is
either a better solution to fold in or a bug that let it through.

### Three live hazards in that path

**Recordings address units by ARRAY INDEX, and `puzzleHash` sorts units before
hashing.** The fingerprint is deliberately order-insensitive (so the editor
rebuilding its tiles from autosave does not read as an edit); the recording is
inherently order-dependent. Delete and re-add one unit late in editing and it
lands at the end of the array, renumbering everything after it — the recording
now points at different units and the guard sees nothing. This shipped: an
author's honest line replayed as "illegal attack" on action 2, and the board
was fine. Suspect this before doubting an author.

**Approving a bare `maxKill` copies the ceiling from the author's REPLAYED
strength.** If the replay failed there is nothing to copy, so it publishes with
no `objective.count` — and `objectiveScorable` is then false, so nobody can ever
win it. Check the replay before approving a maxKill, and never approve one whose
replay did not succeed.

**Folding a better par into a CORE puzzle writes the DB, and the next boot
reseeds that row from `web/puzzles.js`.** Par and ceiling are both inside
`puzzleHash`, so the stale repo value does not merely revert the fold — it
reads as a different fight, retires the row and takes every solve on it. Two
Points Short sat that way for three days (DB 16, repo 18, 9 solves at risk).
**Any fold on a core puzzle must be mirrored into `web/puzzles.js` and
deployed**; the admin panel now says so when you click Fold in.

Folding also ANSWERS every other open record on that puzzle, and
`retireSupersededRecords` (`server/records.js`) sweeps them: five players found
the same 16-order line, and the queue was asking for the same verdict five
times — plus five more for the same board under its withdrawn name. A record on
a puzzle that is no longer live has nothing to fold into either.

Three fixes are specced and unbuilt, in value order: record units by identity
(`q,r`) rather than index; replay the recording at submit time and refuse it if
it does not reproduce the claim; refuse to approve a ceiling-less `maxKill`.
