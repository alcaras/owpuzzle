// SLOW: re-prove every maxKill ceiling against the current engine.
//
// This is the check that would have caught each of the rules fixes silently
// invalidating a published puzzle. It shells out to the verifier with a time
// budget: a search that completes must agree with the stored ceiling, and one
// that times out is reported, not failed.
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

const SECONDS = Number(process.env.OWP_CEILING_SECONDS || 90);
const maxKill = PUZZLES.filter((p) => p.objective.kind === 'maxKill');

for (const p of maxKill) {
  test(`${p.id}: ceiling is still ${p.objective.count / 10} STR`, { skip: !process.env.OWP_SLOW }, () => {
    const file = path.join(os.tmpdir(), `owp-${p.id}.json`);
    fs.writeFileSync(file, JSON.stringify(p));
    const out = execFileSync('node',
      [path.join(__dirname, '..', 'tools', 'deploy_fight.js'), file, String(E.poolOrders(p)), String(SECONDS), '0'],
      { encoding: 'utf8', maxBuffer: 1 << 24 });
    fs.unlinkSync(file);
    const m = /best: ([\d.]+) STR/.exec(out);
    assert.ok(m, 'verifier produced no answer:\n' + out.slice(-400));
    const found = Math.round(Number(m[1]) * 10);
    const complete = /search complete/.test(out);
    assert.ok(found <= p.objective.count,
      `BEATABLE: found ${found / 10} STR against a published ceiling of ${p.objective.count / 10}`);
    if (complete) {
      assert.equal(found, p.objective.count,
        `ceiling drifted: proved ${found / 10} STR, published ${p.objective.count / 10}`);
    } else {
      console.log(`  (${p.id}: search incomplete, ${found / 10} STR is a lower bound only)`);
    }
  });
}
