---
name: ship-a-change
description: >
  The gates between "it works here" and "it is live": which test tiers run
  for which kind of change, how to deploy to fly.io, and what to check
  after. Use for every deploy, however small.
---

# Ship a change

The site is live with real players, a rated queue, and a submission
pipeline. There is no CI safety net today (the only GitHub workflow deploys
Pages; nothing runs `npm test`), so this checklist **is** the pipeline.

## The gate matrix — what must run for what changed

| you touched | must run before deploy |
|---|---|
| anything at all | `npm test` (~100 ms — there is no excuse) |
| `web/engine.js`, `web/data.js`, `tools/extract_data.py` | `npm run test:ceilings` and **read** the output (timeouts print lower-bound notes instead of failing) |
| `web/puzzles.js` | `npm test` + `npm run test:ceilings`; remember edits retire rows and reset completions (author-house-puzzle) |
| `web/app.js`, `web/editor.js`, `web/*.html` | e2e draft flow (below) + manual smoke: library signed-out, one puzzle solved, editor test-play round trip |
| `server/*` | `npm test`, boot locally against a scratch DB, hit the changed endpoints by hand (no route tests exist yet — Phase 3 of the architecture review adds them) |
| verifier tools | cross-check per run-verifiers (never trust one tool's "complete") |

E2e recipe (until `npm run test:e2e` exists):

```sh
DB_PATH=/tmp/owp-e2e.db PORT=8123 node server/index.js &
DB_PATH=/tmp/owp-e2e.db node -e "
  const { db } = require('./server/db.js');
  const u = db.prepare(\"INSERT INTO users (discord_id, name) VALUES ('e2e','e2e-user')\").run();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)')
    .run('a'.repeat(64), u.lastInsertRowid);
"
python3 test/e2e/draft-flow.py     # exits 0 on a clean round trip
```

## Deploy

```sh
fly deploy            # Dockerfile copies server/ + web/; DB lives on the volume
```

Notes:
- The DB is a fly volume (`/data/owpuzzle.db`); deploys never touch data,
  but **startup code does**: `seedCorePuzzles` diffs `puzzles.js` against
  the DB and retires/reseeds edited or deleted puzzles, `backfillAttempts`
  replays old lines, one-shot achievement resets fire on their sentinel.
  Read `server/index.js:22-38` before shipping anything that changes those.
- Secrets (`DISCORD_*`, `ADMIN_DISCORD_IDS`, webhook) are fly secrets —
  never in the repo.

## Post-deploy checks (two minutes, every time)

1. `curl -s https://owpuzzle.fly.dev/api/puzzles | head -c 200` — API up,
   JSON sane.
2. Load the site, hard-refresh once, open the console: zero errors on the
   library page. (JS/HTML are served no-cache precisely so players cannot
   be stuck on yesterday's app.js against today's editor.js — but check
   your own browser anyway.)
3. If puzzles changed: the affected card renders, plays, and its solve
   still records.
4. `fly logs` for a minute — startup lines (`seeded N core puzzles`,
   backfill/link counts) match expectations, no stack traces.

## Verification gate

- [ ] the matrix row for every touched area actually ran, output read
- [ ] deployed, post-deploy checks done
- [ ] if a core puzzle was edited/removed: that was intentional, and its
      completion-reset consequence is accepted

## Known traps

- **Version skew is the "impossible bug" generator.** A browser holding
  yesterday's app.js against today's editor.js once convinced an author
  their unchanged puzzle changed. The no-cache headers
  (`server/index.js:46-50`) exist for this; do not "optimise" them away.
- **A rules change can invalidate a published ceiling silently.** The
  ceilings suite is the only thing standing between an engine fix and a
  player beating "maximum destruction". Run it even for fixes that
  "obviously only reduce damage".
- **GitHub Pages still auto-publishes `docs/` on every push to main**
  (`.github/workflows/pages.yml`), and `docs/` is a stale hand-copied
  mirror of `web/`. Until that workflow/mirror is retired or automated
  (architecture review §2.6), pushing to main republishes a wrong site.
  Do not update the mirror by hand into a new drift; resolve the decision.
- Startup migrations are try/catch ALTERs that swallow every error, not
  just "column exists". If a schema change misbehaves, it misbehaves
  silently — check the columns actually exist after first boot.
- `auto_stop_machines` keeps one machine warm (`min_machines_running = 1`);
  if the site feels cold-start slow after infra edits, check fly.toml
  wasn't reverted.
