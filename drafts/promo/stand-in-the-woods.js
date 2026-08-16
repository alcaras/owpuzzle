// RANGER (+25% attacking FROM trees) — the promotion is not a stat, it is a
// reason to want one particular tile. A rout advance is how you keep taking
// them: a kill drops you into the tile the dead man was standing on.
//
// The horseman starts in CONTACT with the eastern axeman, and the whole puzzle
// is that killing him is the cheap move and the losing one:
//
//   the free kill is ONE order: 9 damage, dead — and you advance onto open
//   ground, where the 11 hp man takes 9. One short. The chain stops there.
//   the wood at 0,1 is TWO orders away. From it the axeman standing in the
//   wood at 0,0 takes 9, exactly his hp (8 from open ground, and nothing
//   starts). That kill advances you INTO 0,0, still wood, so the 11 hp man
//   takes 11. That kill advances you onto open ground for a last 9.
//
// So it costs more to reach the trees than to take the kill in front of you,
// and that is the point.
module.exports = {
  teaches: 'EFFECTUNIT_RANGER',
  puzzle: {
    id: 'stand-in-the-woods',
    difficulty: 2,
    name: 'Stand in the Woods',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 5,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: -2, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, height: 'HEIGHT_HILL' },
      { q: -2, r: 2, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: 2, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 1, r: -2, promotions: ['EFFECTUNIT_RANGER'] },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 11 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: -1, hp: 9 },
    ],
  },
};
