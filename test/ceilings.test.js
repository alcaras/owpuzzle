// SLOW: re-check every published maxKill ceiling against the current engine.
//
// Two-tier design per docs/ceiling-audit.md. This file is the FAST tier,
// gating on verify2 (stage1 kill-set bound + a 60s finder slice per puzzle):
//   (a) U0 >= published count — a published count above the sound upper
//       bound is impossible, so this catches the unreachable direction
//       instantly and cheaply;
//   (b) no replay-verified line exceeds the published count — the beatable
//       direction, the one players would find for us.
// The DEEP tier (proof-classification regression) is manual: run the exact
// commands in docs/ceiling-audit.md after any engine change. deploy_fight's
// "search complete" is never treated as proof here — its rationed model is
// the one Bottleneck defeated.
//
//   OWP_SLOW=1 node --test test/ceilings.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));
const PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));

const SECONDS = Number(process.env.OWP_CEILING_SECONDS || 60);
const maxKill = PUZZLES.filter((p) => p.objective.kind === 'maxKill');

for (const p of maxKill) {
  test(`${p.id}: published ceiling ${p.objective.count / 10} STR is sound`, { skip: !process.env.OWP_SLOW }, () => {
    const file = path.join(os.tmpdir(), `owp-${p.id}.json`);
    fs.writeFileSync(file, JSON.stringify(p));
    const out = execFileSync('node',
      [path.join(__dirname, '..', 'tools', 'verify2.js'), file, String(E.poolOrders(p)), String(SECONDS)],
      { encoding: 'utf8', maxBuffer: 1 << 24 });
    fs.unlinkSync(file);

    // verify2 prints STR units throughout: "best: 26 STR", "upper bound 26
    // STR (U0=26)", "PROVEN ceiling 26 STR". Engine counts are STR x 10.
    const mBest = /best: ([\d.]+) STR/.exec(out);
    assert.ok(mBest, 'verifier produced no best line:\n' + out.slice(-400));
    const best = Math.round(Number(mBest[1]) * 10);

    // beatable direction: a line better than the published maximum
    assert.ok(best <= p.objective.count,
      `BEATABLE: found ${best / 10} STR against a published ceiling of ${p.objective.count / 10}`);

    // unreachable direction: the sound upper bound must not sit below the claim
    const mU = /upper bound ([\d.]+) STR/.exec(out) || /U0=([\d.]+)/.exec(out);
    if (mU) {
      const u = Math.round(Number(mU[1]) * 10);
      assert.ok(u >= p.objective.count,
        `UNREACHABLE: published ${p.objective.count / 10} STR exceeds the sound upper bound ${u / 10}`);
    }

    // a verify2 PROVEN at a different value is a hard failure whatever the tier
    const proven = /PROVEN ceiling ([\d.]+) STR/.exec(out);
    if (proven) {
      assert.equal(Math.round(Number(proven[1]) * 10), p.objective.count,
        `ceiling drifted: proved ${proven[1]} STR, published ${p.objective.count / 10}`);
    }

    const replayOk = /verified: [\d.]+ STR in \d+ orders\s+✓ matches/.test(out);
    assert.ok(replayOk || !mBest, 'best line did not replay-verify:\n' + out.slice(-300));
  });
}
