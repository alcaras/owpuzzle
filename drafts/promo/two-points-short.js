// HECKLER (+25% vs a GENERAL) — worth exactly two damage against a line that
// leaves you exactly two to spare.
//
// Nobody is wounded. Three axemen at a full 20 apiece is 60 hit points, and 60
// is precisely what this army can deliver — but only if every blow lands on the
// right body and nothing is wasted:
//
//   near escort   20 = archer 6 + archer 6 + chariot 8
//   middle escort 20 = archer 6 + archer 6 + chariot 8
//   the general   20 = archer 6 + warrior 6 + chariot 8
//
// The chariot's two kills rout it forward, one body at a time, so its three
// blows are only available if the escorts die in order. The warrior's blow is
// 4 against anybody else on the field and 6 against the crown: strip Heckler
// and the army musters 58 against 60, which is not a harder puzzle but an
// impossible one. He starts four hexes from the general, which is as far as he
// CAN start: infantry fatigue caps a turn at three steps, so from five hexes he
// would never arrive and the army would be two short before it began.
//
// Par is 16, which is the best line found by assigning each shooter its
// cheapest firing seat — not a proven minimum. Seven blue units is far past
// what an exhaustive search can close, so this board is proved the other way:
// by damage accounting, which is exact and does not care how big the army is.
//
// Two things deliberately NOT done, both measured:
//   * no Strike on the chariot. It would deal 9, and 20 - 9 = 11 cannot be made
//     from 4s, 6s and 10s — the fit becomes inexact, the waste covers the
//     missing two points, and the army wins WITHOUT Heckler.
//   * two archers carry Eagle Eye so they can shoot from two hexes at their
//     full 6; the other three must close to point blank, where a plain bow
//     still delivers 6. Same arithmetic, less shuffling.
module.exports = {
  teaches: 'EFFECTUNIT_HECKLER',
  puzzle: {
    id: 'two-points-short',
    difficulty: 3,
    name: 'Two Points Short',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 18,
    radius: 3,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -3, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 3, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: -3, vegetation: 'VEGETATION_TREES' },
      { q: 3, r: -3, height: 'HEIGHT_HILL' },
      { q: -3, r: 0, height: 'HEIGHT_HILL' },
      { q: 2, r: 1, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_WARRIOR', q: 0, r: -1, promotions: ['EFFECTUNIT_HECKLER'] },
      { player: 0, type: 'UNIT_CHARIOT', q: -2, r: 0 },
      { player: 0, type: 'UNIT_ARCHER', q: 0, r: -2 },
      { player: 0, type: 'UNIT_ARCHER', q: -1, r: -1 },
      { player: 0, type: 'UNIT_ARCHER', q: -2, r: -1, promotions: ['EFFECTUNIT_EAGLE_EYE'] },
      { player: 0, type: 'UNIT_ARCHER', q: -1, r: -2, promotions: ['EFFECTUNIT_EAGLE_EYE'] },
      { player: 0, type: 'UNIT_ARCHER', q: -1, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: -1 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 1, general: true },
    ],
  },
};
