// MARKSMAN (+1 range) — an archer reaches 3 hexes (iRangeMax). This one reaches
// four, and the difference is the whole puzzle.
//
// The enemy archer stands across open water: no unit can walk to him, and water
// does not block a shot. From the only bank you can reach he is exactly 4 hexes
// away — out of range for every bow on the board except the marksman's, which
// lands 3 damage at that distance, exactly his remaining 3 hp.
// You start a further hex back, so the shot has to be walked into first.
module.exports = {
  teaches: 'EFFECTUNIT_MARKSMAN',
  puzzle: {
    id: 'one-hex-further',
    difficulty: 2,
    name: 'One Hex Further',
    author: 'owpuzzle',
    brief: 'Destroy the archer.',
    lesson: '',
    orders: 2,
    radius: 3,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: 0, terrain: 'TERRAIN_WATER' }, { q: 1, r: 0, terrain: 'TERRAIN_WATER' },
      { q: 2, r: 0, terrain: 'TERRAIN_WATER' },
      { q: 0, r: -1, terrain: 'TERRAIN_WATER' }, { q: 1, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -1, terrain: 'TERRAIN_WATER' }, { q: 3, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 0, r: 1, terrain: 'TERRAIN_WATER' }, { q: 1, r: 1, terrain: 'TERRAIN_WATER' },
      { q: 2, r: 1, terrain: 'TERRAIN_WATER' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: -3, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_LONGBOWMAN', q: -2, r: 0, promotions: ['EFFECTUNIT_MARKSMAN'] },
      { player: 1, type: 'UNIT_ARCHER', q: 3, r: 0, hp: 3 },
    ],
  },
};
