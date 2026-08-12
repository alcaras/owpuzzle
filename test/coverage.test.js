// Mechanics coverage: every effect field the game data actually uses must be
// either implemented by the engine or listed here with a reason.
//
// The point is that a mechanic can never go missing SILENTLY. When Old World
// updates, or a promotion starts being offered that was not before, an
// unclassified field fails this test and forces a decision instead of quietly
// doing nothing in the middle of somebody's puzzle.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require(path.join(__dirname, '..', 'web', 'engine.js'));

const SRC = fs.readFileSync(path.join(__dirname, '..', 'web', 'engine.js'), 'utf8');
const referenced = (f) => SRC.includes(`'${f}'`) || SRC.includes(`.${f}`);

// Reasons we knowingly do not model something. Each entry is a decision, not
// an oversight.
const ACKNOWLEDGED = {
  // deliberately excluded: a puzzle must be deterministic, so a chance to
  // land a critical cannot exist. NOTE this makes the FOCUS promotions inert.
  iCriticalChance: 'randomness has no place in a puzzle',
  // outside a single combat turn
  bHarvest: 'not a combat mechanic',
  bBuildRoad: 'not a combat mechanic',
  bSpreadReligion: 'not a combat mechanic',
  bTheology: 'not a combat mechanic',
  bPromote: 'promotions are authored, not earned mid-puzzle',
  iClassNum: 'bookkeeping for promotion tiers, not a combat effect',
  iVisionExtra: 'the whole board is visible in a puzzle',
  iRevealExtra: 'the whole board is visible in a puzzle',
  iHealAlways: 'healing happens between turns',
  iHealExtra: 'healing happens between turns',
  bMultiTeams: 'two sides only',
  // gates on which units may carry an effect; matters for the editor's
  // promotion list rather than for resolving combat
  // the editor already honours these when it offers promotions
  // (editor.js promoValidFor); combat resolution never needs them
  abUnitTraitValid: 'effect applicability — handled in the editor, not in combat',
  abUnitTraitInvalid: 'effect applicability — handled in the editor, not in combat',
  // genuine gaps, written down so they stay visible
  bImmobilize: 'GAP: grappler',
  bPushWater: 'GAP: fireship shoving ships into open water',
  iSettlementAttackModifier: 'GAP: marines assaulting a settlement',
  iRoadMovementModifier: 'GAP: siege road movement',
};

function reachableEffects() {
  const set = new Set();
  for (const u of Object.keys(E.DATA.units)) for (const e of (E.DATA.units[u].effects || [])) set.add(e);
  for (const p of Object.keys(E.DATA.promotions)) set.add(E.DATA.promotions[p].effect);
  for (const t of Object.keys(E.DATA.traitEffects)) set.add(E.DATA.traitEffects[t]);
  return set;
}

test('every effect field a player can meet is implemented or acknowledged', () => {
  const reach = reachableEffects();
  const fields = new Map();
  for (const name of Object.keys(E.DATA.effects)) {
    if (!reach.has(name)) continue;                 // unreachable content
    for (const f of Object.keys(E.DATA.effects[name])) {
      if (!fields.has(f)) fields.set(f, []);
      fields.get(f).push(name);
    }
  }
  const unknown = [];
  for (const [f, carriers] of fields) {
    if (referenced(f) || ACKNOWLEDGED[f]) continue;
    unknown.push(`${f} (on ${carriers.slice(0, 3).join(', ')})`);
  }
  assert.deepEqual(unknown, [],
    'unclassified mechanics — implement them or add a reason to ACKNOWLEDGED:\n  ' + unknown.join('\n  '));
});

test('the acknowledged list has not gone stale', () => {
  // If we implement something, its excuse should be removed, so the list
  // always reads as the current set of gaps.
  const stale = Object.keys(ACKNOWLEDGED).filter(referenced);
  assert.deepEqual(stale, [], 'these are implemented now; drop them from ACKNOWLEDGED: ' + stale.join(', '));
});

test('the known gaps are still only these', () => {
  const gaps = Object.keys(ACKNOWLEDGED).filter((k) => ACKNOWLEDGED[k].startsWith('GAP'));
  assert.deepEqual(gaps.sort(), ['bImmobilize', 'bPushWater', 'iRoadMovementModifier', 'iSettlementAttackModifier']);
});
