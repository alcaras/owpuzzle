// EAGLE_EYE (bIgnoresDistance) — every other bow loses 20% per hex beyond the
// first (Unit.distanceModifier, Unit.cs:6585). This one loses nothing.
//
// Two separate things stand between the archer and the shot that matters:
//   RANGE. A longbow reaches 3. The axeman she needs is 4 away, and the only
//     way to add a hex is to shoot from high ground — height lends its own +1.
//     So she has to spend an order climbing the hill behind her.
//   DAMAGE. At four hexes a plain bow lands 2. Eagle Eye lands the full 6.
//
// The horseman can sweep the line, 9 a blow, each kill carrying him onward —
// but the middle axeman is on 15 and stops him dead. Six off the top turns him
// into a 9 the chain eats. Two off the top does nothing at all.
//
// So the order is: climb, shoot the man in the MIDDLE, then let the horse run.
// Spend the arrow on either 9 and the sweep dies at the second body.
module.exports = {
  teaches: 'EFFECTUNIT_EAGLE_EYE',
  puzzle: {
    id: 'dont-step-closer',
    difficulty: 2,
    name: "Don't Step Closer",
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 5,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -2, r: 0, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: -1, r: 2, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: -2, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 2, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_LONGBOWMAN', q: -2, r: 1, promotions: ['EFFECTUNIT_EAGLE_EYE'] },
      { player: 0, type: 'UNIT_HORSEMAN', q: 2, r: -2 },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: -1, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: 0, hp: 15 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 1, hp: 9 },
    ],
  },
};
