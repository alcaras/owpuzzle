# owpuzzle

Daily single-turn Old World combat puzzles. Live at https://owpuzzle.fly.dev.

- `web/engine.js` — the combat engine, a port of Old World's own rules
- `web/app.js`, `web/index.html` — the player
- `web/editor.js` — the community puzzle editor
- `server/` — express + sqlite: auth, ratings, submissions, achievements
- `tools/` — data extraction and the puzzle verifiers
- `test/` — the rules suite (see below)

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

**`test/coverage.test.js`** — enumerates every effect field the data actually
uses and asserts each is implemented or listed in `ACKNOWLEDGED` with a reason.
A mechanic can never go missing silently: a new field fails the build and
forces a decision. Known gaps live there too, so they stay visible.

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

## Verifiers

Two independent implementations, deliberately:

- `tools/compute_ceilings.js` — exhaustive branch-and-bound over the order pool
- `tools/deploy_fight.js` — engine-exact search with a seat model, plus
  `MODE=deploy` best-first over whole deployments for large boards

Keep both. Each has caught the other being confidently wrong — including a
`deploy_fight` bound that pruned whole trees while reporting "search complete".
**Treat "search complete" with the same suspicion as a finding**; agreement
between the two tools is what makes a ceiling trustworthy.

Publishing checklist for a maxKill puzzle: prove the ceiling, confirm the
intended line **is** the optimum (not merely *a* line that reaches it), and
check the trick is *required* — three of five drafts died because a cheaper
line reached the same ceiling without the idea the puzzle was built around.

## Community

Submissions arrive via the editor with the author's own solution recorded, land
as `pending`, and are verified locally — never on the server. Any player line
that beats a published par is logged and flagged in the admin panel with its
replayable action line, for review rather than automatic application: it is
either a better solution to fold in or a bug that let it through.
