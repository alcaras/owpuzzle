# Phase 1 — what to test on dev before merging

Dev: **https://owpuzzle-dev.fly.dev** (ephemeral DB — seeded core library only,
no logins wired, wreck it freely). The refactor: library, player and review
stepper each rebuilt as one store + one idempotent render; finish() split into
decide → persist → present; the fetch wrapper surfaces errors; 10 window
globals gone.

## Covered by automation already (browser-driven, plus 96 node tests)

- library renders all groups + community, both auth orders, anonymous
- admin review queue visible with slow AND fast auth (the old race)
- hostile-named submissions render inert (XSS behavioural test)
- full solve of a core puzzle → PERFECT result, one attempt POST
- undo + redo of the final action does NOT double-post (the old bug)
- next-puzzle offer appears after the attempt records
- maxKill draft: test play → recording written → back to editor → submit OK
- review stepper: step / back / play-all to 37 STR on Aran's board;
  approve/reject buttons present

## Worth human eyes (the things automation checks least well)

1. **Feel**: solve 2–3 puzzles end to end on desktop AND phone — anything
   janky, mis-sized, or slower than prod?
2. **Signed-in flows on prod-like data**: dev has no Discord app configured,
   so rating text, achievements popping, "Play another" routing, and the
   hall/profile pages deserve a pass AFTER merge on prod (or wire dev
   Discord creds first).
3. **The editor round trip with a real puzzle** — build something non-trivial,
   test play, tweak, re-test, submit.
4. **Share button** text on a solved and an unsolved puzzle.
5. Anything you personally do daily that isn't listed — the automation only
   knows the flows we thought of.

## If something breaks

`git checkout main && npm run deploy:prod` restores prod's exact current
state at any time (prod has NOT moved during Phase 1). Dev bugs: report with
the URL + what you clicked; the e2e scripts in test/e2e/ are the repro
starting point.
