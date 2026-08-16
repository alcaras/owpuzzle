// HECKLER (+25% vs a GENERAL) — a promotion that cares WHO it is hitting.
//
// Two axemen in the enemy line look identical. One carries the general, and the
// heckler does 8 to him where it does 6 to anyone else. Both reds sit at the hp
// that exactly one of your blows reaches:
//   general at 8 — only the heckler (8); the plain axeman does 6
//   escort  at 6 — the plain axeman's 6 is exactly enough
// so the heckler must be spent on the crown and cannot be wasted on the escort.
// It starts on the wrong side of the line and has to walk around to reach him.
module.exports = {
  teaches: 'EFFECTUNIT_HECKLER',
  puzzle: {
    id: 'the-crown',
    difficulty: 2,
    name: 'The Crown',
    author: 'owpuzzle',
    brief: 'Destroy both.',
    lesson: '',
    orders: 3,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 0, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 0, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: -1, promotions: ['EFFECTUNIT_HECKLER'] },
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 1 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 8, general: true },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 6 },
    ],
  },
};
