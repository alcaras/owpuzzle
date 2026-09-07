#!/bin/bash
# Ground-truth a scenario against the real engine harness.
# usage: tools/ground.sh "<sunits>" "<splan>" ["<srivers>"]
#   sunits  TYPE@pos@player[@EFF+EFF][@dmg][@fort];...  pos is dx,dy or a
#           direction path from the arena centre (C, E, NE, E.NW)
#   splan   ATTACK:s0:1,0;MOVE:s1:2,0;...   (may be empty)
#   srivers P:E+NE;P:NW   river edges on the tile at path P (arena cleared
#           of rivers first)
# Prints each executed step, the final units, and STEP: the pathfinder's own
# per-direction step test for every placed unit
# (Unit.isValidMovementDirection, Unit.cs:7678) — a rule about ONE step
# cannot be read off the reach preview, since a unit with steps to spare
# walks around.
H=/Users/dominik/Library/CloudStorage/Dropbox/cc/owearlysim/engine-harness
cd "$H" && dotnet bin/Debug/net10.0/GameHarness.dll --scenario 1 --attacker 0 \
  --sunits "$1" --splan "$2" --srivers "${3:-}" 2>/dev/null | python3 -c "
import json, sys
raw = sys.stdin.read()
raw = raw[raw.index('{'):]
d = json.loads(raw)
print('UNITS', json.dumps(list(zip(d.get('specIds', []), d.get('specTiles', [])))))
if d.get('riverTiles'): print('RIVERS', json.dumps([(r['path'], r['edges']) for r in d['riverTiles']]))
for i, row in enumerate(d.get('stepProbe', [])):
    print('STEP s%d' % i, json.dumps(row))
for s in d.get('steps', []):
    out = {k: v for k, v in s.items() if k not in ('board', 'tiles', 'vision', 'visibleTiles')}
    print('STEP', json.dumps(out))
print('FINAL', json.dumps(d.get('finalUnits')))
print('OK', d.get('ok'), 'cleared:', d.get('cleared'))
"
