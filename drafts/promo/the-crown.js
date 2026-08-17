// HECKLER (+25% vs a GENERAL) — worth exactly two damage, and the whole puzzle
// is built on those two.
//
// The general is on 14. Your chariot hits for 8 and your warrior for 4 — twelve
// between them, two short. Against the CROWN specifically the warrior's blow is
// 6 instead of 4, and 6 + 8 is 14 exactly.
//
// The warrior has one swing in him: he is infantry, so no kill carries him
// anywhere, and against an 8 hp escort his 4 does not even finish the job. That
// single blow has to land on the general and nowhere else.
//
// The chariot has the other three: it must ride out to the far escort, kill it,
// and let the rout carry it along the line — escort, escort, and finally into
// the general for the 8 that the warrior's 6 completes. Start it anywhere else
// and the chain does not reach.
module.exports = {
  teaches: 'EFFECTUNIT_HECKLER',
  puzzle: {
    id: 'the-crown',
    difficulty: 2,
    name: 'The Crown',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 5,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -1, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 1, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: 2, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: -2, height: 'HEIGHT_HILL' },
    ],
    units: [
      { player: 0, type: 'UNIT_WARRIOR', q: 1, r: -1, promotions: ['EFFECTUNIT_HECKLER'] },
      { player: 0, type: 'UNIT_CHARIOT', q: 1, r: -2 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 14, general: true },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: -1, hp: 8 },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: 0, hp: 8 },
    ],
  },
};
