#!/bin/bash
# Ground-truth a scenario against the real engine harness.
# usage: tools/ground.sh "<sunits>" "<splan>"
H=/Users/dominik/Library/CloudStorage/Dropbox/cc/owearlysim/engine-harness
cd "$H" && dotnet bin/Debug/net10.0/GameHarness.dll --scenario \
  --sunits "$1" --splan "$2" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
raw = raw[raw.index('{'):]
d = json.loads(raw)
for s in d.get('steps', []):
    out = {k: v for k, v in s.items() if k not in ('board', 'tiles', 'vision', 'visibleTiles')}
    print('STEP', json.dumps(out))
print('FINAL', json.dumps(d.get('finalUnits')))
print('OK', d.get('ok'), 'cleared:', d.get('cleared'))
"
