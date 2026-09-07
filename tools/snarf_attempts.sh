#!/bin/sh
# Pull every SOLVED attempt line from the fly.io DB, with the puzzle each one
# was played on, to submissions/attempts.json. Uses your flyctl login as the
# credential, like snarf.sh. Then: node tools/replay_attempts.js
#
# The point: a rules change can only be judged against what players actually
# played. A first-move reach diff is a lower bound; the stored lines are the
# authority on which solves a change takes away.
set -e
cd "$(dirname "$0")/.."
mkdir -p submissions

DUMP=$(cat <<'JS'
const { db } = require("/app/server/db.js");
const puzzles = db.prepare("SELECT id, slug, json, status FROM puzzles WHERE id IN (SELECT DISTINCT puzzle_id FROM attempts WHERE solved = 1)").all();
const attempts = db.prepare("SELECT a.id, a.puzzle_id, a.user_id, a.orders_used, a.line, a.created_at FROM attempts a WHERE a.solved = 1 ORDER BY a.puzzle_id, a.id").all();
console.log("SNARF_BEGIN");
console.log(JSON.stringify({ puzzles, attempts }));
JS
)
B64=$(printf '%s' "$DUMP" | base64 | tr -d '\n')
curl -s -o /dev/null --max-time 30 https://owpuzzle.fly.dev/api/puzzles || true
OUT=$(fly ssh console -C "sh -c 'echo $B64 | base64 -d > /tmp/snarf_attempts.js && node /tmp/snarf_attempts.js'" 2>/dev/null)
if [ -z "$OUT" ]; then
  sleep 3
  OUT=$(fly ssh console -C "sh -c 'echo $B64 | base64 -d > /tmp/snarf_attempts.js && node /tmp/snarf_attempts.js'" 2>/dev/null)
fi
JSON=$(printf '%s\n' "$OUT" | awk '/^SNARF_BEGIN/{getline; print; exit}')
if [ -z "$JSON" ]; then
  echo "snarf failed — raw output:" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi
printf '%s' "$JSON" | python3 -c '
import json, sys, pathlib
d = json.load(sys.stdin)
for p in d["puzzles"]:
    p["json"] = json.loads(p["json"])
for a in d["attempts"]:
    a["line"] = json.loads(a["line"]) if a["line"] else []
path = pathlib.Path("submissions/attempts.json")
path.write_text(json.dumps(d, indent=1))
print(str(len(d["attempts"])) + " solved attempts on " + str(len(d["puzzles"])) + " puzzles -> " + str(path))
'
