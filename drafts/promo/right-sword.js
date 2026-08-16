// HORSEBANE (+25% vs MOUNTED) — a promotion that cares WHO it is hitting, set
// inside a chain that cares about the ORDER you hit them in.
//
// Two rules do the work together:
//   * a rout advance only happens on a kill, and POLEARMS are immune to it
//     (routEffectVs, engine.js:138) — killing the spearman leaves you standing
//     still with your turn over, so he has to die LAST
//   * the red horseman is on 9 hp, and a blue horseman does 8 to cavalry. Only
//     HORSEBANE reaches 9, so he is the link that would otherwise break
//
// The spearman is the man you start next to, at 6 hp against your 6 damage: a
// free kill, in reach, first order of the turn. Take it and the chain never
// begins. Ride the other way, open on the cavalry, and each kill carries you
// down the line into him.
module.exports = {
  teaches: 'EFFECTUNIT_HORSEBANE',
  puzzle: {
    id: 'the-right-sword',
    difficulty: 2,
    name: 'The Right Sword',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 4,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -1, r: -1, height: 'HEIGHT_HILL' },
      { q: -2, r: 2, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: 2, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: -2, height: 'HEIGHT_HILL' },
    ],
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 1, r: -2, promotions: ['EFFECTUNIT_HORSEBANE'] },
      { player: 1, type: 'UNIT_HORSEMAN', q: 0, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 1, r: -1, hp: 6 },
    ],
  },
};
