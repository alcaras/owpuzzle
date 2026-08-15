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

## Testing

```
npm test              # rules + library invariants, ~100ms — run this constantly
npm run test:ceilings # SLOW: re-prove every published maxKill ceiling
```

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

Keep all of them. Each has caught another being confidently wrong — including a
`deploy_fight` bound that pruned whole trees while reporting "search complete".
**Treat "search complete" with the same suspicion as a finding**; agreement
between independent tools is what makes a ceiling trustworthy.

Publishing checklist for a maxKill puzzle: prove the ceiling, confirm the
intended line **is** the optimum (not merely *a* line that reaches it), and
check the trick is *required* — three of five drafts died because a cheaper
line reached the same ceiling without the idea the puzzle was built around.

## In flight (2026-08-14)

- **`phase1-library-store` branch** carries the frontend refactor (tested on
  owpuzzle-dev.fly.dev, awaiting a manual pass against `docs/phase1-test-plan.md`
  before merge) *and* the whole verifier/optimizer programme:
  `bench/human-baselines.json` plus `docs/optimizer-handoff.md`, which is the
  resume point for that work — read it before touching `tools/verify2.js`.
  Four of six benchmark boards pass unaided; the two gaps are search *ordering*,
  not model expressiveness, and large-neighbourhood search is specced and gated.
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
