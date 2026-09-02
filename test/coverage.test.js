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
  bHealNeutral: 'healing happens between turns',
  bMultiTeams: 'two sides only',
  bSkipIcon: 'display only',
  bCriticalImmune: 'criticals are excluded (see iCriticalChance), so immunity to them is inert',
  bGeneralHopping: 'a general changing units is not a combat action',
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
  // the ruler's own traits, reachable only when the ruler is the general
  // (Character.cs:10608). The audit never saw them until characterTraits
  // was extracted: the reachable set was built from unit traits alone, so
  // bStun sat unimplemented behind a promotion the editor offers.
  iActionsExtra: 'GAP: Hannibal aboard — the unit acts once more before its cooldown (Unit.cs:2758 getFreeActions)',
  bHealKill: 'GAP: Zealot ruler aboard — the unit heals on a kill (Unit.cs:9642)',
  bLaunchOffensive: 'GAP: Hero ruler aboard — launch offensive (Unit.cs:14135)',
};

function reachableEffects() {
  const set = new Set();
  for (const u of Object.keys(E.DATA.units)) for (const e of (E.DATA.units[u].effects || [])) set.add(e);
  for (const p of Object.keys(E.DATA.promotions)) set.add(E.DATA.promotions[p].effect);
  for (const t of Object.keys(E.DATA.traitEffects)) set.add(E.DATA.traitEffects[t]);
  // a general lends the unit its character traits' effects (Character.cs:10588);
  // the editor offers these as promotions, so they are reachable too
  for (const t of Object.keys(E.DATA.characterTraits || {})) {
    const d = E.DATA.characterTraits[t];
    if (d.general) set.add(d.general);
    if (d.leader) set.add(d.leader);
  }
  if (E.DATA.globals.LEADER_GENERAL_EFFECTUNIT) set.add(E.DATA.globals.LEADER_GENERAL_EFFECTUNIT);
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

// The audit above only ever looked at EFFECT fields, so a mechanic living on
// the UNIT itself could go missing without a sound: iRangeMin did exactly that
// — onagers happily shot the enemy standing on top of them until a puzzle
// designed around minimum range exposed it. Unit fields get the same treatment.
const ACKNOWLEDGED_UNIT = {
  bRegular: 'unit taxonomy, not a combat rule',
  bGeneral: 'marks which units a general may lead — puzzles state generalship directly',
  formations: 'battle-line art, no combat effect',
  iVision: 'the whole board is visible in a puzzle',
  iFatigue: 'the fatigue LIMIT is derived from movement; this is the XML twin',
  effects: 'the effect list itself; its contents are audited above',
  traits: 'trait names; their consequences are audited via effects',
  bBlocks: 'every unit blocks its tile in a puzzle',
  bCanCapture: 'capture is an objective, authored per puzzle',
  iCost: 'production cost, not a combat rule',
  iBuildTurns: 'production time, not a combat rule',
  bNoCapture: 'capture is an objective, authored per puzzle',
  iUpgradeCost: 'production, not a combat rule',
  bWater: 'implemented via terrain and the ship traits',
  nation: 'which nation may build it — editor grouping, not a combat rule',
};

test('every unit field a player can meet is implemented or acknowledged', () => {
  const fields = new Map();
  for (const name of Object.keys(E.DATA.units)) {
    for (const f of Object.keys(E.DATA.units[name])) {
      if (!fields.has(f)) fields.set(f, []);
      fields.get(f).push(name);
    }
  }
  const unknown = [];
  for (const [f, carriers] of fields) {
    if (referenced(f) || ACKNOWLEDGED_UNIT[f]) continue;
    unknown.push(`${f} (on ${carriers.slice(0, 3).join(', ')})`);
  }
  assert.deepEqual(unknown, [],
    'unclassified unit mechanics — implement them or add a reason:\n  ' + unknown.join('\n  '));
});

test('the acknowledged list has not gone stale', () => {
  // If we implement something, its excuse should be removed, so the list
  // always reads as the current set of gaps.
  const stale = Object.keys(ACKNOWLEDGED).filter(referenced);
  assert.deepEqual(stale, [], 'these are implemented now; drop them from ACKNOWLEDGED: ' + stale.join(', '));
});

test('the known gaps are still only these', () => {
  const gaps = Object.keys(ACKNOWLEDGED).filter((k) => ACKNOWLEDGED[k].startsWith('GAP'));
  assert.deepEqual(gaps.sort(), ['bHealKill', 'bImmobilize', 'bLaunchOffensive', 'bPushWater', 'iActionsExtra', 'iRoadMovementModifier', 'iSettlementAttackModifier']);
});
