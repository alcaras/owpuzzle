// HECKLER (+25% vs a GENERAL) — worth 11 damage against the crowned axeman
// where every other blow of yours is 9. He is on 11 hp, so he is the only man
// on the field your horseman cannot kill without it.
//
// He stands BEHIND his two escorts, and a rout advance is the only way to reach
// him: kills carry you along the line, one tile per body. The escort you START
// next to is the wrong one.
//
//   swing at the man in front of you -> you advance onto his tile, and from
//     there you can take the general OR the far escort, but never both: whoever
//     you leave is two hexes away and your horse is spent. Two of three.
//   ride around to the FAR escort first -> the same three blows sweep the whole
//     line inward: escort, escort, crown.
//
// Nothing here is about damage — both lines kill the general perfectly well.
// Only one of them arrives at him having already cleared everything behind.
module.exports = {
  teaches: 'EFFECTUNIT_HECKLER',
  puzzle: {
    id: 'the-crown',
    difficulty: 2,
    name: 'The Crown',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 4,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -1, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 1, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: 2, height: 'HEIGHT_HILL' },
      { q: 1, r: -2, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 1, r: 1, promotions: ['EFFECTUNIT_HECKLER'] },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: -1, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 11, general: true },
    ],
  },
};
