// AMPHIBIOUS (+50% attacking across a river) — a promotion that does not add
// strength so much as REMOVE a penalty everybody else pays.
//
// EFFECTUNIT_MELEE itself carries iRiverAttackModifier -50, so every melee
// unit in the game strikes across a river at half force. Amphibious cancels it
// to exactly zero:
//   plain axeman across the river -> 4
//   amphibious axeman             -> 8, the full blow
// The spearman is on 8 hp, so the river is the whole difficulty. Measured, not
// assumed: a SWORDSMAN would have killed him across the river unaided (10), and
// the first draft of this board shipped exactly that mistake.
module.exports = {
  teaches: 'EFFECTUNIT_AMPHIBIOUS',
  puzzle: {
    id: 'the-far-bank',
    difficulty: 2,
    name: 'The Far Bank',
    author: 'owpuzzle',
    brief: 'Destroy the spearman.',
    lesson: '',
    orders: 2,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 1, r: 0, river: [3] },
      { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: 0, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0, promotions: ['EFFECTUNIT_AMPHIBIOUS'] },
      { player: 1, type: 'UNIT_SPEARMAN', q: 1, r: 0, hp: 8 },
    ],
  },
};
