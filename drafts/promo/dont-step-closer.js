// EAGLE_EYE (bIgnoresDistance) — every other archer loses 20% per hex beyond
// the first (Unit.distanceModifier, Unit.cs:6585). This one does not.
//
// Both reds sit at 6 hp. EVERY tile is declared: an undeclared tile is open
// ground, and the first draft of this board left a dry path around the water
// that let a plain archer simply walk up to the far one.
// Nobody can walk to him, so he can only ever be shot at range 3:
//   plain archer at range 3 -> 3 damage, two shots, and you do not have two
//   eagle eye   at range 3 -> 6 damage, one shot
// The near red also takes exactly 6 from a point-blank shot, so the eagle eye
// is the only unit that can take the far one and must not be spent on the near.
module.exports = {
  teaches: 'EFFECTUNIT_EAGLE_EYE',
  puzzle: {
    id: 'dont-step-closer',
    difficulty: 2,
    name: "Don't Step Closer",
    author: 'owpuzzle',
    brief: 'Destroy both.',
    lesson: '',
    orders: 2,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: 0, terrain: 'TERRAIN_WATER' }, { q: 1, r: 0, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_ARCHER', q: -1, r: 0, promotions: ['EFFECTUNIT_EAGLE_EYE'] },
      { player: 0, type: 'UNIT_ARCHER', q: -2, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: 0, hp: 6 },
      { player: 1, type: 'UNIT_AXEMAN', q: -2, r: 1, hp: 6 },
    ],
  },
};
