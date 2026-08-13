---
name: add-engine-mechanic
description: >
  Add or fix a combat rule in web/engine.js the safe way: read the game's C#
  first, write the citation test red, implement green, re-prove every
  published ceiling. Use for any change to combat behaviour, movement, ZOC,
  targeting, or effect handling — including "small obvious" ones.
---

# Add an engine mechanic

Five engine bugs shipped in the first week and every one had the same shape:
a rule implemented from intuition that was wrong in a specific case (double
shoreline penalty, unit-level bIgnoreZOC not read, the two range rules
conflated, urban tiles not roads, melee-trait gating on the wrong side).
What stopped them was this exact sequence. Do not reorder it.

## Preconditions

- The game's reference source is readable at
  `~/Library/Application Support/Steam/steamapps/common/Old World/Reference/`
  (`Source/Base/Game/GameCore/{Unit,Tile,Game}.cs`, `XML/Infos/*.xml`).
- `npm test` is green before you start.

## Steps

1. **Read the game source first. Numbers remembered from playing are a
   hypothesis; the source settles it.**
   ```sh
   grep -n "<theRuleName>" ~/Library/Application\ Support/Steam/steamapps/common/Old\ World/Reference/Source/Base/Game/GameCore/*.cs
   ```
   Read the whole method plus its callers — the neighbouring rule is where
   the bugs live (canTargetFrom vs canTargetTile use *different* range
   rules; the maceman bonus gates on the **attacker** being melee, not the
   defender). Note the exact file:line you are porting.

2. **If new XML fields are involved**, check whether `tools/extract_data.py`
   extracts them. If not, extend it and run `npm run data`; the coverage
   gate (`test/coverage.test.js`) will then force you to classify every new
   field: implement it or add it to `ACKNOWLEDGED` with a reason. A `GAP:`
   entry is honest; silence is forbidden.

3. **Write the rules test first, and watch it fail.** One rule per test, in
   `test/rules/<area>.test.js`, using the DSL from `test/helpers.js`:
   ```js
   test('shore assault pays the penalty once [Unit.cs:XXXX]', () => {
     const g = setup(`
       tile 1,0 TERRAIN_WATER
       blue AXEMAN 0,0
       red  BIREME 1,0 hp=8
     `);
     assert.equal(damage(g, g.blue(), g.red()), 3);
   });
   ```
   **The test title must cite the C# file:line or XML field.** A test
   without a citation freezes today's belief, which is how the bugs got in.
   Run `npm test` and confirm it is red for the right reason.

4. **Implement in `web/engine.js`**, with a comment citing the same
   file:line. Match the existing style: plain functions over JSON state, no
   new abstractions. If the rule reads unit effects, go through
   `effectsOf`/`sumEffect`/`hasEffectFlag` — and remember to check flags on
   the *unit info* too when the game does (the bIgnoreZOC bug was reading
   effects but not the unit).

5. **`npm test`** — the new test green, everything else still green. If an
   *old* rules test fails, read its citation before touching either side:
   twice now the test was wrong and the engine right.

6. **Re-prove every published ceiling: `npm run test:ceilings`.** A rules
   change can silently invalidate a published maxKill puzzle, and a ceiling
   a player can beat is the worst bug the site ships. Read the output — a
   timed-out search prints a lower-bound note instead of failing; decide
   consciously whether that is acceptable for the puzzles it touched.

7. **When the C# is ambiguous or disputed**, ground-truth against the real
   game harness before trusting your reading:
   ```sh
   tools/ground.sh "<sunits>" "<splan>"
   ```
   (runs the owearlysim GameHarness; see the script for the format). The
   harness result outranks everyone's reading of the source.

8. If the mechanic is player-visible, add it to the mechanics table in
   `docs/making-puzzles.md` and check `describeEffect` renders it in the
   unit card (engine.js keeps ability text in the game's own template
   wording — extend `HELP_FLAG`/`VALUE_LABEL` there, not with paraphrase).

## Verification gate

- [ ] new test cites file:line and was seen red before the implementation
- [ ] `npm test` green
- [ ] `npm run test:ceilings` run and its output actually read
- [ ] coverage gate forced no unclassified fields (or ACKNOWLEDGED updated)

## Known traps

- **"We implemented the neighbouring rule."** The game often has two
  similar-looking code paths (shot legality vs rout targeting; attack vs
  defence trait modifiers). Confirm which one your scenario exercises.
- The engine is deterministic by design: anything involving
  `iCriticalChance` stays excluded (`ACKNOWLEDGED` explains why). Do not
  "helpfully" add randomness.
- `loadPuzzle` normalises input tiles in place; if your change touches it,
  keep `puzzleHash` stable across a load (there is a library test for
  this).
- Do not weaken a bound in `deploy_fight.js`/`verify2.js` to make a ceiling
  re-prove faster — an inadmissible bound once reported 11 STR "complete"
  on a 19 STR puzzle. Verifier changes get their own cross-check (see
  run-verifiers).
