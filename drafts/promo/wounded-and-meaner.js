// TOUGH (+10% to its OWN strength while damaged) — the promotion rewards the
// unit you would instinctively keep out of the fight.
//
// Your two axemen are the same soldier except one is on 10 hp and carries
// TOUGH: being hurt makes him hit for 7 where the fresh man hits for 6.
//   the spearman at 9 hp dies only to the wounded man's 9 (the fresh man: 8)
//   the second spearman at 8 hp dies to the fresh man's 8
// Two things about this board are defensive, and both were forced by a probe
// that solved it with no promotion at all once the player's REAL order pool
// (par+5, so ten) was used instead of par:
//   * both reds are polearms — polearms are immune to ROUT, so no kill grants
//     a second swing, and exactly two blows exist
//   * the reds stand four hexes apart — adjacent, an axeman's cleave splashed
//     2 onto the far one and a plain 7 then finished a target set at 9
// TOUGH is worth nothing against a horseman here — 5 damage either way after
// rounding — which is exactly why the target had to be measured, not assumed.
// Send the casualty at the harder target and the healthy one at the softer.
module.exports = {
  teaches: 'EFFECTUNIT_TOUGH',
  puzzle: {
    id: 'wounded-and-meaner',
    difficulty: 2,
    name: 'Wounded and Meaner',
    author: 'owpuzzle',
    brief: 'Destroy both.',
    lesson: '',
    orders: 3,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: 0, r: -1, hp: 10, promotions: ['EFFECTUNIT_TOUGH'] },
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 2, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_SPEARMAN', q: -2, r: 0, hp: 8 },
    ],
  },
};
