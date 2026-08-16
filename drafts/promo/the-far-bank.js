// AMPHIBIOUS (+50% across a river) — a promotion that removes a penalty
// everyone else pays. EFFECTUNIT_MELEE itself carries iRiverAttackModifier -50,
// so every melee unit in the game strikes across water at half force.
//
//   plain axeman across the river -> 4      on land -> 8
//   amphibious axeman             -> 8      on land -> 8
//
// Both spearmen are on 8 hp, so each dies to exactly one blow on land and the
// far one dies ONLY to the amphibious man. Both are polearms, immune to ROUT,
// so no kill buys a second swing: there are two blows for two enemies and the
// assignment is the whole puzzle.
//
// The two axemen start on the wrong sides of it — the plain one already facing
// the river, the amphibious one already facing the near bank — so the natural
// line has the wrong man wade in and fall four short.
module.exports = {
  teaches: 'EFFECTUNIT_AMPHIBIOUS',
  puzzle: {
    id: 'the-far-bank',
    difficulty: 2,
    name: 'The Far Bank',
    author: 'owpuzzle',
    brief: 'Destroy both spearmen.',
    lesson: '',
    orders: 5,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 1, r: 0, river: [3] },
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 0, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0, promotions: ['EFFECTUNIT_AMPHIBIOUS'] },
      { player: 0, type: 'UNIT_AXEMAN', q: 0, r: 0 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 1, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_SPEARMAN', q: -2, r: 0, hp: 8 },
    ],
  },
};
