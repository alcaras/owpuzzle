#!/bin/sh
# Pull pending community submissions from the fly.io DB to submissions/<slug>.json.
# Uses your flyctl login as the credential (no extra auth surface).
# Also heals any rows stuck in the old 'validating' state -> 'pending'.
# Usage: tools/snarf.sh   (then: node tools/verify_submission.js)
set -e
cd "$(dirname "$0")/.."
mkdir -p submissions

DUMP=$(cat <<'EOF'
const { db } = require("/app/server/db.js");
db.prepare("UPDATE puzzles SET status='pending', notes='awaiting review' WHERE status='validating'").run();
const rows = db.prepare("SELECT slug, json, status, author_name, notes, created_at FROM puzzles WHERE status='pending' ORDER BY created_at").all();
console.log("SNARF_BEGIN");
console.log(JSON.stringify(rows));
EOF
)
B64=$(printf '%s' "$DUMP" | base64 | tr -d '\n')
# wake the machine (fly auto-stops idle VMs; an HTTP request starts one)
curl -s -o /dev/null --max-time 30 https://owpuzzle.fly.dev/api/puzzles || true
OUT=$(fly ssh console -C "sh -c 'echo $B64 | base64 -d > /tmp/snarf.js && node /tmp/snarf.js'" 2>/dev/null)
if [ -z "$OUT" ]; then
  sleep 3
  OUT=$(fly ssh console -C "sh -c 'echo $B64 | base64 -d > /tmp/snarf.js && node /tmp/snarf.js'" 2>/dev/null)
fi
JSON=$(printf '%s\n' "$OUT" | awk '/^SNARF_BEGIN/{getline; print; exit}')
if [ -z "$JSON" ]; then
  echo "snarf failed — raw output:" >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi
printf '%s' "$JSON" | python3 -c '
import json, sys, pathlib
rows = json.load(sys.stdin)
if not rows:
    print("no pending submissions")
for r in rows:
    p = json.loads(r["json"])
    path = pathlib.Path("submissions") / (r["slug"] + ".json")
    path.write_text(json.dumps({
        "slug": r["slug"], "author": r["author_name"],
        "submitted": r["created_at"], "notes": r["notes"], "puzzle": p,
    }, indent=2))
    print(r["slug"] + "  by " + str(r["author_name"]) + "  (" + r["created_at"] + ")  -> " + str(path))
'
