// tools/trick_required.js answers "is the puzzle's idea REQUIRED, or merely
// available?" by intersecting structurally different optimal lines. The danger
// in that method is not being wrong, it is being CONFIDENT: intersecting one
// line marks every action in it forced, which is a tautology wearing a
// finding's clothes.
//
// The first version printed exactly that for Bottleneck — "move -> -2,-1
// [REQUIRED]" — while a known 14-order line reaches the same 290 via -2,0.
// These tests pin the honesty gate, not the search.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOL = path.join(__dirname, '..', 'tools', 'trick_required.js');
const BOARD = path.join(__dirname, 'fixtures', 'twin-swords.json');

function run(args) {
  try {
    return { out: execFileSync('node', [TOOL, BOARD].concat(args), { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status };
  }
}

// twin-swords: two identical swordsmen, either can kill the lone red. So there
// are two optimal lines and NOTHING is required — the perfect control case.
test('with two interchangeable routes, no action is reported as required', () => {
  const { out } = run(['--seconds=10']);
  assert.match(out, /FORCED/);
  assert.match(out, /search exhausted: this is a proof/,
    `a 3-unit board must exhaust in 10s, else this test proves nothing:\n${out}`);
  assert.match(out, /\(none — every single action can be avoided/,
    `either swordsman can do the job, so nothing is forced:\n${out}`);
});

test('a single known line is never enough to call anything required', () => {
  // --seconds=0 leaves the search no time at all: the only thing in the archive
  // is the supplied line. Intersecting it would mark all of its actions forced.
  const line = path.join(__dirname, 'fixtures', 'twin-swords-line.json');
  const { out, code } = run(['--seconds=0', '--line=' + line]);
  assert.match(out, /INCONCLUSIVE/,
    `one line and no search must not conclude:\n${out}`);
  assert.doesNotMatch(out, /\[REQUIRED\]/,
    `nothing may be called REQUIRED on the strength of a single line:\n${out}`);
  assert.equal(code, 3, 'inconclusive should exit 3, not 0');
});

test('two known lines that differ prove the difference is not required', () => {
  const a = path.join(__dirname, 'fixtures', 'twin-swords-line.json');
  const b = path.join(__dirname, 'fixtures', 'twin-swords-line2.json');
  const { out } = run(['--seconds=0', '--line=' + a, '--line=' + b]);
  // no search at all, yet the two lines alone settle it
  assert.match(out, /OPTIONAL — used by some optimal lines but not all: 2/,
    `the two differing attacks should both be optional:\n${out}`);
  assert.match(out, /\[avoidable\]/, `the intended line's blow is avoidable:\n${out}`);
});
