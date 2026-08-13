# Testing strategy

What layer catches what class of bug, what to build next, and what to delete
once its replacement exists. Companion to docs/architecture-review.md; the
history that motivates all of this is in CLAUDE.md ("Why the suite exists").

The organising idea: **every bug this project has shipped belongs to one of
five classes, and each class needs a different instrument.** A test in the
wrong layer is either too slow to run constantly or structurally unable to
see the bug.

---

## The layers

| # | layer | catches | runs | exists today? |
|---|---|---|---|---|
| 1 | rules tests (`test/rules/*`) | engine rules ported wrong | `npm test`, ~100 ms | yes — the model |
| 2 | coverage gate (`test/coverage.test.js`) | mechanics silently missing | `npm test` | yes |
| 3 | library invariants (`test/library.test.js`) | malformed shipped content | `npm test` | yes |
| 4 | ceilings re-proof (`test/ceilings.test.js`) | rules change invalidating published puzzles | `npm run test:ceilings`, minutes | yes |
| 5 | verifier self-checks (`test/verify2.test.js`) | a verifier's bounds going inadmissible | `npm test` | yes |
| 6 | page-logic unit tests | decisions made in browser code | `npm test` | **no — build (Phase 1)** |
| 7 | browser e2e (Playwright) | wiring: races, handoffs, swallowed errors | `npm run test:e2e`, ~30 s | prototype only |
| 8 | server route tests | the referee's own rules | `npm test` | **no — build (Phase 3)** |

Layers 1–5 are healthy. The bug reports of the last 48 hours all fall in
6–8, which is why the repo grew grep-shaped tests: the only instrument that
existed for browser bugs was reading the source back.

### Layer 1 — rules tests. The rules that keep the rules tests honest

- Every test title cites the C# file:line or XML field it encodes. A test
  without a citation freezes a belief, and beliefs are how the five engine
  bugs got in.
- When a rules test fails, read the citation before deciding which side is
  wrong — twice the test was wrong and the engine right.
- New mechanic ⇒ new rules test **first**, red, then implement. The
  add-engine-mechanic skill is the paved road.

### Layer 4 — ceilings. When to pay for it

Run after **any** change to `web/engine.js` or `web/data.js`, before deploy.
A beatable ceiling is the worst bug the site can ship: it tells a player
"maximum destruction" about a number they can exceed. A timed-out search is
a lower bound, reported not failed — read the output, do not just watch the
exit code.

### Layer 6 — page-logic unit tests (build next, with Phase 1)

The Phase 1 refactor exists partly to create this layer: logic extracted
from `app.js` into pure functions over a state object becomes plain node
tests with a fake `fetch`/`localStorage`. Targets, in order of bug history:

- `computeResult(state, puzzle)` — the pure core of `finish()`: win text,
  perfect flag, what gets recorded for a draft, what gets posted. The
  early-return-skips-recording bug (`f32e2ec`) becomes a unit test instead
  of a grep.
- `foldPuzzles(apiResponse)` + library render-from-state — solved counts,
  band grouping, community totals, "no duplicate community section".
- progress versioning (`progEntry`, hash mismatch ⇒ unsolved).
- the draft module (Phase 4): read/write/compare across its slots with fake
  storage; hash covers every gameplay field (road and owner included —
  today they are missing, engine.js:1155-1159).
- `nextUnsolvedLocal` ordering.

These run in `npm test` and keep the constant-feedback property.

### Layer 7 — browser e2e (build next, small and fixed-size)

Playwright, four golden flows, run against a throwaway server. E2e is for
**wiring** — the things node structurally cannot see: load order, storage,
promise rejections vanishing, DOM events. It is not for logic (layer 6) and
never for combat numbers (layer 1).

Recipe (works today, modulo promoting the prototype):

```sh
DB_PATH=/tmp/owp-e2e.db PORT=8123 node server/index.js &
# seed a signed-in session the tests can use (the prototype assumes 'a'*64)
DB_PATH=/tmp/owp-e2e.db node -e "
  const { db } = require('./server/db.js');
  const u = db.prepare(\"INSERT INTO users (discord_id, name) VALUES ('e2e','e2e-user')\").run();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)')
    .run('a'.repeat(64), u.lastInsertRowid);
"
python3 test/e2e/draft-flow.py          # today's prototype
```

The four flows, each asserting `pageerror` count is zero (the swallowed-
rejection detector):

1. **Draft round trip** — build in editor, test play, End Turn, back,
   submit; expect the ✓ message. (Replaces `test/draft-flow.test.js`.)
2. **Solve signed in** — play a one-move core puzzle, see rating text,
   progress persists across reload, attempt row exists in the DB.
3. **Hostile review** — submit a puzzle named `<img src=x onerror=...>`;
   library + review queue render it inert; approve from the stepper; verdict
   lands. (Guards the XSS fix forever.)
4. **Library first paint** — signed out and signed in (fast and slow
   `/api/puzzles`): exactly one library, one community section, one review
   queue.

Keep the suite at roughly this size. E2e suites that grow per-feature go
flaky and get ignored; four flows that never flake get trusted.

### Layer 8 — server route tests (build with Phase 3)

The server is the referee and currently has zero tests. Supertest (or plain
`fetch` against a listener on an ephemeral port) with `DB_PATH` pointed at a
temp file. The referee's rules worth pinning:

- `/api/attempt`: replay decides solved; only first attempt rated; records
  row written when par is beaten; negative-`ordersUsed` error path fixed and
  pinned.
- `/api/submit`: each validation rejection; solution replay note recorded.
- `/api/review/:slug` approve: bare maxKill ceiling defaults to the
  author's **replayed** strength; malformed notes do not approve a
  ceiling-less puzzle silently.
- `/api/puzzle/:slug`: pending visible only to author/admin; retired never
  playable.
- privacy: ratings only disclosed to the entitled viewer (`/api/hall`,
  `/api/profile`).

---

## What to delete, and exactly when

| grep test | replaced by | delete when |
|---|---|---|
| `test/draft-flow.test.js` (both tests) | e2e flow 1 + `computeResult` unit tests | the commit that lands them |
| `test/library.test.js:115-124` (greps server for the replay cap) | layer-8 test replaying a 450-action line | Phase 3 |
| `test/library.test.js:126-131` (greps editor.html for `max=`) | e2e flow 1 variant with a 40-order par, or accept as a permanent content invariant | Phase 2, judgement call |
| Phase 0's temporary escaping grep (if written) | e2e flow 3 | Phase 2 |

Rule of thumb: a grep test is a tolerable **tripwire** while the behavioural
test does not exist, and pure debt the day after it does. Never let one
outlive its replacement — delete in the same commit, so the coverage story
stays legible.

## What NOT to add

- Snapshot tests of rendered HTML (freeze today's markup, catch nothing).
- Unit tests of SVG geometry or visual styling — eyes and the Phase 5
  parity screenshots do this better.
- Per-mechanic e2e tests — layer 1 owns mechanics.
- A coverage-percentage target. The gates above are behavioural; chasing a
  number invites tests that assert nothing.

## The invariant worth writing on the wall

`npm test` stays under a second. Everything slow lives behind an explicit
opt-in (`test:ceilings`, `test:e2e`). The suite gets run constantly only
because it costs nothing to run, and a suite that is not run constantly
catches nothing.
