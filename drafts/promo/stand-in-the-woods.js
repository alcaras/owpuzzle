// RANGER (+25% attacking FROM trees or jungle) — the promotion is about the
// tile you stand on, not the enemy you pick.
//
// The axeman has 8 hp. Your ranger does 6 from open ground and 8 from the wood.
// Open ground at -1,0 is one step away and kills nothing; the wood at 1,-1 is
// two. So the puzzle asks you to spend an extra order walking PAST a reachable
// attacking position to stand on worse-looking ground.
module.exports = {
  teaches: 'EFFECTUNIT_RANGER',
  puzzle: {
    id: 'stand-in-the-woods',
    difficulty: 2,
    name: 'Stand in the Woods',
    author: 'owpuzzle',
    brief: 'Destroy the axeman.',
    lesson: '',
    orders: 3,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: 0, height: 'HEIGHT_MOUNTAIN' }, { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 0, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: -2, r: 0, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: -1, promotions: ['EFFECTUNIT_RANGER'] },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 8 },
    ],
  },
};
