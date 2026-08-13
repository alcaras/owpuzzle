# Architecture review and redesign plan

Written August 2026, after the first fast build-out (roughly 40 commits in a
few days, live at https://owpuzzle.fly.dev with real players and a real
submission pipeline). The brief: say what is sound, say what is fragile with
evidence, and lay out a redesign that can ship in small increments with the
site up the whole time.

Every claim below was checked against the code as of commit `fc0791d`, with
file:line references. Where something looks unconventional but is deliberate
and earning its keep, it is listed under "keep", not "fix".

---

## Part 1 — what is sound. Keep it.

**The engine as a cited port (`web/engine.js`).** Every rule names the C#
line it ports; the state is plain JSON cloned with `JSON.parse(JSON.stringify)`
(engine.js:50); the API is plain functions over that state; the same file runs
in the browser and in node (engine.js:1362-1363). This is the reason the
verifiers, the server replay, the solver and the tests can all share one
implementation. The JSON-clone style looks naive and is exactly right here:
state snapshots are what undo, the solver, and the server referee are built
on. Do not introduce classes, mutation-in-place, or a state library.

**The test suite's shape.** Citation-required rule tests over a three-line
board DSL (`test/helpers.js`), a mechanics coverage gate that makes silent
gaps impossible (`test/coverage.test.js`), structural library invariants, and
a slow ceilings re-proof (`test/ceilings.test.js`). This architecture was
learned from five real engine bugs (CLAUDE.md lists them) and it is the most
valuable thing in the repo after the engine itself. Extend it; never weaken
the citation rule.

**Verifier redundancy.** Three independent implementations
(`tools/compute_ceilings.js`, `tools/deploy_fight.js`, `tools/verify2.js`)
that have each caught another being confidently wrong, including a
"search complete" that pruned real lines. Redundancy here is not waste, it is
the only way a published ceiling is trustworthy. Keep all three; keep the
house rule that agreement between tools is the proof standard.

**Server replay as referee (`server/index.js:161-187`).** The client sends
its action line; the server replays it through the same engine and believes
only the replay. Ratings, records, achievements all hang off that. Sound, and
the reason the client never needs to be trusted.

**Zero build step, no framework.** Challenged, as asked, and upheld — with a
caveat. The costs actually paid over the last 48 hours (auth/paint races,
swallowed rejections, string-concat HTML, page modes by early return) are
**structure** costs, not **tooling** costs. React would not have prevented the
draft-recording early return or the puzzleHash omission; it would have added a
build, a dependency treadmill, and killed the file:// friendliness and the
"engine runs everywhere" property. What is missing is a discipline (one state
object, one render function, escape-by-default helpers), and that fits in
~100 lines of plain JS. Phase 1 below supplies it. The caveat: if the UI ever
grows past roughly three more pages or needs real-time interactivity, revisit
Preact (no-build via htm) — but not now, and never mid-rescue.

**better-sqlite3 + express, one file DB, prepared statements.** Right size
for this load. The synchronous driver is a feature: no async races in
handlers. What needs structure is the *organisation* (Phase 3), not the
stack.

**Small deliberate touches worth protecting:** the no-cache header on
js/html to prevent version skew (server/index.js:46-50); retire-and-reseed on
puzzle edit so an edited puzzle is a new puzzle (server/db.js:56-107); the
editor's snapshot-on-render autosave/undo (editor.js:628-641), which catches
every mutation site by construction; immutable achievements (db.js:139-146);
privacy rules on ratings enforced server-side (index.js:584, 604-619).

---

## Part 2 — what is fragile, with evidence

### 2.1 `web/app.js` is four pages sharing one mutable scope

One IIFE hosts the library, the player, the draft test-play, and the review
stepper. Mode is decided by early returns (`app.js:233-260` returns out of
the IIFE for the library; everything after `boot()` at :347 is the player;
review bolts on at :1425). Cross-mode communication happens through nine
`window.*` globals: `__rerender` (:402), `__renderLibrary` (:247),
`__firstPaint` (:249), `__painted` (:252), `__nextSlug` (:1203), `__offerNext`
(:1207), `__perfect` (:1287), `__won` (:1309).

The first paint is a *designed race*: a 700 ms timer (`app.js:258`) against
two fetches (`/api/me` at :93, `/api/puzzles` via `loadCommunityPuzzles` at
:115), reconciled by the `__painted`/`__firstPaint` flag pair and a
comment admitting the admin review queue was lost to exactly this race
(:96-99). Every UX bug in the recent log — `f8333f3` "One review queue, one
paint", `a24363d` "stop the review queue being wiped by a re-render",
`3b9aabe` "fix the silent crash and the auth race" — is this one structure
failing repeatedly. The structure is the bug.

### 2.2 String-concatenated HTML with unescaped user content — live stored XSS

`hall.html` and `admin.html` escape (`esc`/`esc0`). `app.js` does not:

- Community cards inject `pz.name`, `pz.brief`, `x.author` straight into
  `innerHTML` (`app.js:156-164`), for **every visitor** once approved.
- Review-queue cards inject `item.puzzle.name`, `item.author`,
  `item.puzzle.brief` (`app.js:190-196`) into the **admin's** page while the
  submission is still completely untrusted.

`/api/submit` performs no sanitisation of `name`/`brief` (server/index.js:
343-403). A submission named `<img src=x onerror=...>` executes in the
admin's browser the next time the library loads. This is the single most
urgent fix in the repo. (Reported, not fixed, per the terms of this review.)

### 2.3 The editor⇄player draft handoff, and a fingerprint that lies

The handoff spans three storage slots (`owpuzzle-draft`,
`owpuzzle-draft-solution`, `owpuzzle-editor-autosave`), a server fallback
(`/api/draft-solution`), a loaded-slug latch (`owpuzzle-loaded-slug`), and a
content hash to detect edits between test play and submit. Four commits in
two days patched this flow (`f32e2ec`, `6bf79f8`, `3338a2d`, `ce459aa`).

The hash itself is incomplete: `puzzleHash`'s `tidyTile`
(`web/engine.js:1155-1159`) covers terrain, height, vegetation, improvement,
river, city — but **not `road` and not `owner`**, both of which the editor
writes (`editor.js:315`) and both of which change gameplay (roads change
movement cost; ownership feeds `iHomeModifier` and territory rules). An
author can edit roads after test play and submit a recording of a different
board, and the check that exists precisely to prevent that passes. It also
means local progress does not reset when a puzzle's roads change. Fixing the
hash invalidates existing local-progress hashes for road/owner-bearing
puzzles (they re-read as unsolved locally; server solves are unaffected) —
acceptable, but do it knowingly.

### 2.4 `finish()` is where bugs go to hide

`app.js:1192-1346`: one function sets result text, decides the next-puzzle
offer, records the draft solution locally and remotely, early-returns for
draft maxKill, posts the attempt, applies rating text, fires achievements,
and writes local progress — with order-dependent early returns. The
"recording skipped by the early return" bug (`f32e2ec`) lived here, and the
grep test guarding it (`test/draft-flow.test.js:14-23`) is a tripwire, not a
fix. Two more members of the same class are live right now:

- **Share math is wrong** (`app.js:1498`): `var used = puzzle.orders -
  state.orders` mixes par with the remaining *pool* orders (everywhere else
  uses `E.poolOrders(puzzle) - state.orders`, e.g. :1029, :1234). A par-3
  puzzle solved in 3 orders shares "Solved in -4/3 orders".
- **Redo re-fires finish** (`app.js:1363-1376`): redoing the final action
  calls `checkEnd()` → `finish()` → a second POST `/api/attempt` for the
  same line, bumping `attempts`/`solves` counters and re-running the
  achievements diff.

### 2.5 Grep-shaped tests are an admission

`test/draft-flow.test.js` asserts source *ordering*; `test/library.test.js:
115-131` greps `server/index.js` for a regex and `editor.html` for an
attribute. These exist because nothing can execute browser wiring. They are
brittle (any refactor of the guarded code breaks them without a behaviour
change) and they can pass while behaviour is broken. They were the right
emergency move and the wrong steady state. The replacement is Phase 2; the
deletion list is in docs/testing-strategy.md.

### 2.6 Two live sites, one of them wrong

`.github/workflows/pages.yml` republishes `docs/` to GitHub Pages on **every
push to main**, and https://alcaras.github.io/owpuzzle/ answers 200 today.
But `docs/` is a hand-copied mirror (README: "run `cp web/*.js
web/index.html docs/`") that nobody has refreshed: all eight mirrored files
differ from `web/` right now, which means Pages is serving an engine that
predates the shoreline/ZOC/range/urban/maceman fixes — a public site
teaching rules known to be wrong, with no server behind it. Also note the
repo's own design docs (making-puzzles.md, verifier-design.md, this file)
get published there on every push. Decide once: either delete the workflow
and the mirrored site files and make the README point only at fly.dev
(recommended), or make the workflow copy `web/` → pages artifact so it can
never drift. Half-alive is the only wrong option.

### 2.7 Server: fine bones, flow-specific sediment

- The `notes` column is schema-by-stuffing: it holds either the string
  `'awaiting review'` or a JSON blob with the author's solution
  (index.js:383-391), parsed opportunistically at :461 and :483, including
  the review-approve path that defaults a maxKill ceiling from it. One
  malformed row and the ceiling silently defaults to nothing.
- Migrations are try/catch `ALTER TABLE`s (db.js:109, 111, 149-151) — they
  work, but they swallow *all* errors, not just "duplicate column", and
  there is no record of what ran. A `meta` table already exists
  (db.js:179-180); a ten-line migration runner can use it.
- `replayLine`'s error path returns `puzzle.orders - s.orders`
  (index.js:170) where `s.orders` started from the *pool* — a negative
  `ordersUsed` on any line that throws mid-replay.
- All 25 routes live in one file with auth checks hand-repeated
  (`if (!user || !user.is_admin)` appears 5 times). At 666 lines it is at
  the edge; one more feature tips it.
- No route tests exist at all — the server is the referee and the referee
  is untested.

What would be overkill at this scale, listed so nobody adds it: an ORM or
query builder, a session store, a job queue, GraphQL, splitting into
services, and async SQLite. None of these earns anything here.

### 2.8 Smaller live defects found during review (report, not fixed)

1. Stored XSS via community puzzle name/brief/author (2.2) — **urgent**.
2. Share text order math (`app.js:1498`).
3. Redo double-posts `/api/attempt` (`app.js:1363-1376`).
4. `puzzleHash` omits `road`/`owner` (`engine.js:1155-1159`).
5. GH Pages serves a stale engine and re-deploys on every push (2.6).
6. Editor "Test play" writes `localStorage` unguarded (`editor.js:385`) —
   with storage blocked the click throws and silently does nothing, the one
   case the whole server-fallback flow was built for.
7. `replayLine` negative `ordersUsed` on a throwing line (index.js:170).
8. Reviewing a pending maxKill via the stepper ends in the *draft* result
   branch ("this draft cannot score itself", `app.js:1279-1288`) because
   pending maxKill puzzles have no `count` — cosmetic, but tells a reviewer
   the wrong thing.
9. README still opens with the GitHub Pages URL as "Live" and documents
   `verify_puzzles.js`/`surviveAll` (README:24-31, :119) — neither matches
   the current system; a new contributor following it lands on the stale
   site with stale advice.

---

## Part 3 — the redesign, in shippable phases

Each phase is independently deployable with the site up, has its own gate,
and does not block the others (except 2 depends on 1's helpers landing
first). Effort: S = an hour or two, M = half a day to a day, L = multiple
days.

### Phase 0 — stop the bleeding (S)

Fix the defect list 2.8 items 1, 2, 3, 6, 7 (item 4 lands with Phase 4's
handoff work or on its own; item 5 is a decision plus a workflow deletion).
The XSS fix is one `esc()` helper applied at every `innerHTML` sink in
app.js — hall.html already shows the house pattern.

*Gate:* new unit test asserting every `${...}`-into-innerHTML sink in app.js
escapes (a temporary grep test is acceptable here **only** until Phase 2's
e2e covers a hostile-named puzzle end to end); `npm test` green.

### Phase 1 — one state, one render, per page (M)

Split `app.js` by page mode without adding a build step — plain script tags,
same as today:

```
web/js/dom.js      esc(), h() element helper, one place innerHTML is allowed
web/js/api.js      fetch wrapper: json, errors SURFACE (status line), never {}
web/js/store.js    ~30 lines: state object + subscribe + set()
web/js/library.js  library page: render(state) from {me, puzzles, progress}
web/js/player.js   player page: the current boot(), state moved into store
web/js/review.js   the stepper
web/index.html     loads dom, api, store, then the page module it needs
```

The discipline, in this codebase's own idiom — no framework, just the shape
the library page should have had:

```js
// store.js
function createStore(initial) {
  var state = initial, subs = [];
  return {
    get: function () { return state; },
    set: function (patch) {
      Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
      subs.forEach(function (fn) { fn(state); });
    },
    onChange: function (fn) { subs.push(fn); },
  };
}

// library.js — replaces __firstPaint/__painted/the 700ms timer entirely
var store = createStore({ me: null, community: [], serverSolved: {} });
store.onChange(renderLibrary);            // render is idempotent, from state
renderLibrary(store.get());               // paint NOW from local data
api('/api/me').then(function (d) { store.set({ me: d.user }); });
api('/api/puzzles').then(function (d) { store.set(foldPuzzles(d)); });
```

Rendering is always a pure function of the store; fetches only ever call
`store.set`. There is no first-paint flag because there is no race: painting
twice is harmless when render is idempotent, which deletes `__painted`,
`__firstPaint`, `__renderLibrary`, the timer, and the "re-render drops the
review queue" class in one move. The player page gets the same treatment
with `{puzzle, state, selected, finished, lineLog, history, redo}` in a
store; `finish()` is split into `computeResult(state)` (pure — node-testable)
and `presentResult()`/`persistResult()` (effects).

Do this one page at a time — library first (most bug history), player
second, stepper last. Each step ships alone.

*Gate:* the extracted pure logic (`foldPuzzles`, `computeResult`,
`nextUnsolvedLocal`, progress versioning) gets real node unit tests with a
fake fetch/localStorage; `npm test`; manual smoke of both pages.

### Phase 2 — a real browser test layer, then delete the grep tests (M)

`test/e2e/draft-flow.py` already proves the approach works; it is just not
wired to anything. Promote it: a `test/e2e/` Playwright suite run by
`npm run test:e2e` against a throwaway server (`DB_PATH=/tmp/... PORT=8123`)
with a seeded session row. Four golden flows only — e2e is for wiring, not
logic (details and the deletion mapping are in docs/testing-strategy.md):

1. draft round trip: editor → test play → recording → submit accepted
2. solve a core puzzle signed in: progress, rating text, attempt row
3. review: hostile-named pending puzzle renders inert, verdict lands
4. library first paint signed out and signed in (no duplicate sections)

Add the missing CI: a `test.yml` workflow running `npm test` on push (there
is a Pages workflow but **no test workflow** today), with e2e in it once
stable.

*Gate:* all four flows green locally; `test/draft-flow.test.js` and the two
greps in `test/library.test.js:115-131` deleted in the same commit that
lands their behavioural replacements.

### Phase 3 — server structure that keeps it honest (M)

The minimal set, nothing more:

```
server/index.js      app wiring, static, listen (~60 lines)
server/routes/auth.js, puzzles.js, attempts.js, submit.js, review.js,
       admin.js, profile.js        one file per resource, same handlers
server/middleware.js  requireUser / requireAdmin (kills 5 hand-rolled checks)
server/migrate.js     numbered migrations recorded in the existing meta table
```

```js
// migrate.js — replaces the try/catch ALTERs, uses the meta table that exists
const MIGRATIONS = [
  { id: '001-puzzle-notes',   sql: `ALTER TABLE puzzles ADD COLUMN notes TEXT` },
  { id: '002-author-solution',sql: `ALTER TABLE puzzles ADD COLUMN author_solution TEXT` },
  // ...
];
function migrate(db) {
  const done = new Set(db.prepare(`SELECT k FROM meta WHERE k LIKE 'mig:%'`)
    .all().map(r => r.k.slice(4)));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare(`INSERT INTO meta (k, v) VALUES (?, 'done')`).run('mig:' + m.id);
    })();
  }
}
```

Move the author solution out of `notes` into `author_solution` (migration
backfills by parsing existing notes; `notes` returns to being notes). Fix
`replayLine`'s error path while its file is open. Add the first route tests
(supertest against a temp-file DB): attempt replay/rating happy path, submit
validation rejections, review-approve ceiling default, puzzle visibility
(pending visible only to author/admin). The server is the referee; these are
the referee's own rules tests.

*Gate:* route tests green; `fly deploy` of a pure-refactor commit serves
byte-identical API responses (spot-check `/api/puzzles`, `/api/hall`).

### Phase 4 — kill the draft handoff class (M now, L later)

Near term (M): complete `puzzleHash` (road, owner — engine.js:1155), and
collapse the handoff into one module (`web/js/draft.js`) owning all slots
and the server fallback, so there is exactly one code path that
reads/writes/compares drafts, unit-tested in node with fake storage.

Longer term (L, worth it when editor work next comes up): **test-play inside
the editor page**. After Phase 1, the player is a store + render module that
can mount on the editor's own DOM with the draft already in memory. No
localStorage handoff, no hash comparison, no stale-recording states, no
Back-button re-load trap (editor.js:11-21) — the entire bug family
(`f32e2ec`, `6bf79f8`, `3338a2d`, `ce459aa`, `611eba0`) becomes
unrepresentable. The hash stays only for "did the author edit after
recording", checked within one page's memory.

*Gate:* draft e2e flow (Phase 2 #1) green throughout; the stale-recording
error states become unreachable code and are removed.

### Phase 5 — information architecture and the shared shell (S/M)

The pages and what each owns (this is mostly ratifying what exists, minus
the tangling):

| page | owns | notes |
|---|---|---|
| `/` library | progress, groups by measured band, community grid, admin review queue | queue stays here — admins live here |
| `/?p=` player | one puzzle: board, HUD, result, attempt posting | also hosts `&review=1` stepper (admin) and `?draft=1` until Phase 4L |
| `/editor.html` | authoring, own submissions | gains in-place test play in Phase 4L |
| `/hall.html` | ranking, profiles, achievements, settings | unchanged |
| `/admin.html` | records-beating-par, stats tables | unchanged |

Shared shell: the four HTML files each carry their own copy of the theme
palette (index.html:10-28, editor.html:9-19, hall.html:9-12, admin.html:9-12
— already drifted: index has `--hex-line`, hall has `--gold`) and three
different headers; the auth widget exists only on index. Extract
`web/theme.css` and `web/js/shell.js` (site bar + auth widget) used by all
four. Component discipline stays the Phase 1 one: a page is a store, render
functions, and wire functions; no component framework.

*Gate:* visual parity screenshots before/after; auth widget present on all
pages.

### Phase 6 — optional hardening (S each, adopt independently)

- **JSDoc types + `tsc --checkJs --noEmit` in CI.** No build step, no
  syntax change; catches the `fmt10`-undefined-helper class (`app.js:174`'s
  war story) statically. Start with engine.js + the new `web/js/` modules.
- **Session expiry** (sessions table has `created_at`; prune on boot) and an
  OAuth `state` parameter (login CSRF).
- **`/api/profile` lookup by unique id** instead of display name
  (index.js:596) — Discord display names are not unique; a duplicate name
  shadows another player's public profile.

---

## Part 4 — the top five highest-leverage changes

1. **Escape-by-default rendering + the XSS fix** (Phase 0/1, S). Closes a
   live stored-XSS against admins and visitors, and makes the whole class
   unwritable once `dom.js` is the only place `innerHTML` is touched.
2. **Store + idempotent render for library and player** (Phase 1, M).
   Deletes the designed race, the nine window globals, and the re-render
   bug family that has consumed the most patch commits of anything here.
3. **Wired-in Playwright + delete the grep tests** (Phase 2, M). Gives the
   browser layer what `test/rules/` gave the engine: bugs of this class
   stop recurring because something executes the wiring.
4. **One draft module now, in-editor test play later** (Phase 4, M→L).
   Turns the single most patched flow from five interacting storage slots
   into one tested code path, then into no handoff at all.
5. **Ship-a-change as an enforced path** (the `.claude/skills/` set +
   `test.yml` CI, S). The engine bugs stopped when citation tests became
   mandatory; the UI and deploy bugs stop the same way — by making the
   checklist the road.

## Part 5 — what NOT to do

No framework migration, no TypeScript compilation step, no bundler, no ORM,
no microservices, no rewrite branch. Every one of those trades this repo's
real strengths (one engine everywhere, zero toolchain, file:// debuggable,
instant deploys) for protection against problems it does not have. The debt
here is structural discipline in ~2,200 lines of UI code and process gates
around a live pipeline — both fixable in place, in increments, with the
site up.
