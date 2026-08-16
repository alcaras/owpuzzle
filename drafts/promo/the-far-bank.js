// AMPHIBIOUS (+50% across a river) — a promotion that removes a penalty
// everyone else pays. EFFECTUNIT_MELEE itself carries iRiverAttackModifier -50,
// so every melee unit in the game strikes across a river at half force:
//   plain horseman across the water -> 5
//   amphibious horseman             -> 9, the whole blow
//
// The three axemen are on an island, and the only place the bank comes close
// enough to strike is the river edge in front of you. Each is on 9 hp, so the
// first one dies only to the full blow — and a rout advance CROSSES the river,
// putting you on the island where the other two are ordinary work.
//
// Ride around looking for a ford and there isn't one; strike across at half
// force and he lives. The river is the door, and Amphibious is the key.
module.exports = {
  teaches: 'EFFECTUNIT_AMPHIBIOUS',
  puzzle: {
    id: 'the-far-bank',
    difficulty: 2,
    name: 'The Far Bank',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 3,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: 0, river: [3] },
      { q: 0, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 1, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 1, r: 1, terrain: 'TERRAIN_WATER' },
      { q: 0, r: 1, terrain: 'TERRAIN_WATER' },
      { q: 2, r: 0, terrain: 'TERRAIN_WATER' },
      { q: -1, r: 1, terrain: 'TERRAIN_WATER' },
      { q: -2, r: 1, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: -1, r: 0, promotions: ['EFFECTUNIT_AMPHIBIOUS'] },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: -1, hp: 9 },
    ],
  },
};
