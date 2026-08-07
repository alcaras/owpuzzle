// Mined puzzle candidates — authored from real Old World multiplayer
// positions in mined/scenes.json. Terrain and starting squares are the
// game's own; HP is tuned to a mid-battle state so the historical result is
// reachable in one turn. Every entry is solver-verified (see CANDIDATES.md).
var MINED_CANDIDATES = [
  {
    // source: mined/scenes.json scene 9 (avN, turn 68) — the shoreline south of the harbour
    id: 'the-shore-riders',
    difficulty: 3,
    name: 'The Shore Riders',
    author: 'mined from a real game',
    brief: 'Kill the chariot, the Beja archer and the galley grounded in the shallows.',
    lesson: 'A point-blank kill by ranged cavalry routs exactly like a charge — the palton may fire again, but only while another enemy still stands within reach of the tile it fires from.',
    orders: 5,
    radius: 3,
    objective: { kind: 'killList', targets: [2, 3, 4] },
    tiles: [
      { q: -3, r: 3, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -2, r: 3, terrain: 'TERRAIN_LUSH' },
      { q: -1, r: 3, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: 3, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_TREES' },
      { q: -3, r: 2, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -2, r: 2, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -1, r: 2, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: 0, r: 2, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_TREES' },
      { q: 1, r: 2, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_SCRUB' },
      { q: -3, r: 1, terrain: 'TERRAIN_URBAN', road: true },
      { q: -2, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -1, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: 0, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: 1, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_TREES' },
      { q: 2, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_TREES' },
      { q: -3, r: 0, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: -2, r: 0, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: -1, r: 0, terrain: 'TERRAIN_ARID', height: 'HEIGHT_HILL' },
      { q: 0, r: 0, terrain: 'TERRAIN_ARID' },
      { q: 1, r: 0, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_TREES' },
      { q: 2, r: 0, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 3, r: 0, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_TREES' },
      { q: -2, r: -1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: -1, r: -1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 0, r: -1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 1, r: -1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 2, r: -1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 3, r: -1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -1, r: -2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 0, r: -2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 1, r: -2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 2, r: -2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 3, r: -2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 0, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 1, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 2, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
      { q: 3, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_OCEAN' },
    ],
    units: [
      { player: 0, type: 'UNIT_PALTON_CAVALRY', q: 0, r: 0, hp: 11 }, // 0
      { player: 0, type: 'UNIT_PALTON_CAVALRY', q: 1, r: 0, hp: 20 }, // 1
      { player: 1, type: 'UNIT_CHARIOT', q: -1, r: 0, hp: 8 }, // 2
      { player: 1, type: 'UNIT_BEJA_ARCHER', q: -1, r: 1, hp: 8 }, // 3
      { player: 1, type: 'UNIT_BIREME', q: 0, r: -1, hp: 6 }, // 4
      { player: 1, type: 'UNIT_ARCHER', q: 0, r: 2, hp: 20 }, // 5
      { player: 1, type: 'UNIT_ARCHER', q: -1, r: 2, hp: 20 }, // 6
    ],
  },
  {
    // source: mined/scenes.json scene 8 (alcaras v Marauder, turn 66) — the treeline west of the ford
    id: 'the-wood-line',
    difficulty: 3,
    name: 'The Wood Line',
    author: 'mined from a real game',
    brief: 'Kill the archer in the trees and the axeman guarding the open ground beside him.',
    lesson: 'Trees halve ranged fire and do nothing against a charge — and a kill lets the elephant overrun into the wood, where the next man can be taken from behind.',
    orders: 4,
    radius: 3,
    objective: { kind: 'killList', targets: [3, 4] },
    tiles: [
      { q: -2, r: 3, height: 'HEIGHT_HILL', vegetation: 'VEGETATION_SCRUB' },
      { q: -1, r: 3, vegetation: 'VEGETATION_SCRUB' },
      { q: 0, r: 3, river: [4] },
      { q: -2, r: 2, vegetation: 'VEGETATION_SCRUB' },
      { q: 1, r: 2, terrain: 'TERRAIN_URBAN', road: true },
      { q: -1, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: 1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 2, r: 1, terrain: 'TERRAIN_URBAN', road: true },
      { q: -1, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: 0, terrain: 'TERRAIN_URBAN', road: true },
      { q: 3, r: 0, terrain: 'TERRAIN_URBAN', river: [3, 4], road: true },
      { q: -1, r: -1, vegetation: 'VEGETATION_SCRUB' },
      { q: 0, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: -1, river: [4, 5] },
      { q: 2, r: -1, terrain: 'TERRAIN_URBAN', river: [4, 5], road: true },
      { q: 3, r: -1, terrain: 'TERRAIN_URBAN', river: [4], road: true },
      { q: 0, r: -2, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: -2, terrain: 'TERRAIN_LUSH' },
      { q: 2, r: -2, terrain: 'TERRAIN_LUSH' },
      { q: 1, r: -3, vegetation: 'VEGETATION_SCRUB' },
      { q: 2, r: -3, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_TREES' },
      { q: 3, r: -3, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AFRICAN_ELEPHANT', q: 1, r: -1, hp: 11 }, // 0
      { player: 0, type: 'UNIT_SLINGER', q: 1, r: 1, hp: 20 }, // 1
      { player: 0, type: 'UNIT_SLINGER', q: 2, r: 1, hp: 20 }, // 2
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 1, hp: 13 }, // 3
      { player: 1, type: 'UNIT_ARCHER', q: -1, r: 1, hp: 8 }, // 4
      { player: 1, type: 'UNIT_ARCHER', q: -1, r: 0, hp: 8 }, // 5
      { player: 1, type: 'UNIT_SPEARMAN', q: -1, r: -1, hp: 17 }, // 6
    ],
  },
  {
    // source: mined/scenes.json scene 6 (alcaras v JCT, turn 86) — the jungle road above the lake
    id: 'the-jungle-road',
    difficulty: 3,
    name: 'The Jungle Road',
    author: 'mined from a real game',
    brief: 'Kill the armoured elephant holding the road and the onager behind it.',
    lesson: 'Shock cavalry that kills may strike again from where it stands — so land the killing blow from the one tile that already touches your next target.',
    orders: 4,
    radius: 3,
    objective: { kind: 'killList', targets: [3, 4] },
    tiles: [
      { q: -3, r: 3, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_JUNGLE' },
      { q: -2, r: 3, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -1, r: 3, terrain: 'TERRAIN_LUSH' },
      { q: -3, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: -2, r: 2, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: -1, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: 2, terrain: 'TERRAIN_URBAN', height: 'HEIGHT_HILL', road: true },
      { q: -3, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_TREES', road: true },
      { q: -1, r: 1, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: 1, terrain: 'TERRAIN_ARID', height: 'HEIGHT_HILL', road: true },
      { q: 1, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL', vegetation: 'VEGETATION_JUNGLE' },
      { q: -3, r: 0, terrain: 'TERRAIN_LUSH' },
      { q: -2, r: 0, vegetation: 'VEGETATION_TREES', road: true },
      { q: -1, r: 0, vegetation: 'VEGETATION_TREES', road: true },
      { q: 0, r: 0, terrain: 'TERRAIN_ARID', road: true },
      { q: 1, r: 0, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE' },
      { q: 2, r: 0, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE' },
      { q: -2, r: -1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_LAKE' },
      { q: -1, r: -1, road: true },
      { q: 0, r: -1, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE' },
      { q: 1, r: -1, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE' },
      { q: 2, r: -1, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE' },
      { q: -1, r: -2, vegetation: 'VEGETATION_TREES', road: true },
      { q: 0, r: -2, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE', road: true },
      { q: 1, r: -2, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_MOUNTAIN', vegetation: 'VEGETATION_JUNGLE' },
      { q: 2, r: -2, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_MOUNTAIN', vegetation: 'VEGETATION_JUNGLE' },
      { q: 0, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_LAKE' },
      { q: 1, r: -3, terrain: 'TERRAIN_LUSH', vegetation: 'VEGETATION_JUNGLE' },
      { q: 2, r: -3, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_MOUNTAIN', vegetation: 'VEGETATION_JUNGLE' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: 1, r: 1, hp: 12 }, // 0
      { player: 0, type: 'UNIT_AXEMAN', q: 2, r: 0, hp: 19 }, // 1
      { player: 0, type: 'UNIT_KUSHAN_CAVALRY', q: 2, r: -1, hp: 18 }, // 2
      { player: 1, type: 'UNIT_ARMOURED_ELEPHANT', q: 1, r: 0, hp: 7 }, // 3
      { player: 1, type: 'UNIT_ONAGER', q: 0, r: -1, hp: 9 }, // 4
      { player: 1, type: 'UNIT_SPEARMAN', q: -1, r: 0, hp: 18 }, // 5
      { player: 1, type: 'UNIT_SPEARMAN', q: 0, r: -2, hp: 8 }, // 6
    ],
  },
  {
    // source: mined/scenes.json scene 1 (Auro v alcaras, turn 107) — the road out of the coastal town
    id: 'the-crossed-lanes',
    difficulty: 3,
    name: 'The Crossed Lanes',
    author: 'mined from a real game',
    brief: 'Kill both legionaries and the hastatus.',
    lesson: 'A ballista bolt carries on through the body it hits, so two engines shooting the same front-rank man skewer two different men behind him.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killList', targets: [4, 5, 6] },
    tiles: [
      { q: -3, r: 3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: -2, r: 3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: -1, r: 3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 0, r: 3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: -3, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: -2, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: -1, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: 1, r: 2, terrain: 'TERRAIN_LUSH' },
      { q: -3, r: 1, terrain: 'TERRAIN_LUSH' },
      { q: -2, r: 1, terrain: 'TERRAIN_LUSH' },
      { q: -1, r: 1, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: 1, terrain: 'TERRAIN_LUSH', height: 'HEIGHT_HILL' },
      { q: 1, r: 1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_LAKE' },
      { q: 2, r: 1, terrain: 'TERRAIN_MARSH' },
      { q: -3, r: 0, terrain: 'TERRAIN_LUSH' },
      { q: -2, r: 0, terrain: 'TERRAIN_LUSH' },
      { q: -1, r: 0, terrain: 'TERRAIN_LUSH' },
      { q: 1, r: 0, terrain: 'TERRAIN_URBAN', road: true },
      { q: 2, r: 0, terrain: 'TERRAIN_URBAN', road: true },
      { q: 3, r: 0, terrain: 'TERRAIN_LUSH' },
      { q: -2, r: -1, terrain: 'TERRAIN_LUSH' },
      { q: -1, r: -1, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 1, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 2, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 3, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: -1, r: -2, terrain: 'TERRAIN_LUSH' },
      { q: 0, r: -2, terrain: 'TERRAIN_LUSH' },
      { q: 1, r: -2, terrain: 'TERRAIN_LUSH' },
      { q: 2, r: -2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 3, r: -2, terrain: 'TERRAIN_URBAN', road: true },
      { q: 0, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 1, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 2, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
      { q: 3, r: -3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_COAST' },
    ],
    units: [
      { player: 0, type: 'UNIT_BALLISTA', q: 0, r: 0, hp: 16 }, // 0
      { player: 0, type: 'UNIT_BALLISTA', q: 0, r: -1, hp: 17 }, // 1
      { player: 0, type: 'UNIT_LONGBOWMAN', q: 1, r: 0, hp: 7 }, // 2
      { player: 0, type: 'UNIT_TURRETED_ELEPHANT', q: 2, r: 0, hp: 10 }, // 3
      { player: 1, type: 'UNIT_LEGIONARY', q: -1, r: 0, hp: 16 }, // 4
      { player: 1, type: 'UNIT_LEGIONARY', q: -2, r: 1, hp: 7 }, // 5
      { player: 1, type: 'UNIT_HASTATUS', q: -3, r: 0, hp: 5 }, // 6
      { player: 1, type: 'UNIT_SWORDSMAN', q: 0, r: 1, hp: 20 }, // 7
    ],
  },
  {
    // source: mined/scenes.json scene 2 (alcaras v ThePurpleBullMoose, turn 101) — the main street of the besieged city
    id: 'down-the-avenue',
    difficulty: 3,
    name: 'Down the Avenue',
    author: 'mined from a real game',
    brief: 'Kill both onagers in the street and the spearman standing behind them.',
    lesson: 'A bolt does not stop at the first body — take the shot that lines three of them up, then walk a finisher round the block for the survivor.',
    orders: 4,
    radius: 3,
    objective: { kind: 'killList', targets: [3, 4, 5] },
    tiles: [
      { q: -3, r: 3, terrain: 'TERRAIN_WATER', height: 'HEIGHT_LAKE' },
      { q: -2, r: 3, terrain: 'TERRAIN_ARID' },
      { q: 0, r: 3, terrain: 'TERRAIN_LUSH' },
      { q: -3, r: 2, terrain: 'TERRAIN_WATER', height: 'HEIGHT_LAKE' },
      { q: -2, r: 1, terrain: 'TERRAIN_WATER', height: 'HEIGHT_LAKE' },
      { q: -1, r: 1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 0, r: 1, terrain: 'TERRAIN_URBAN', road: true },
      { q: -1, r: 0, terrain: 'TERRAIN_URBAN', river: [5], road: true },
      { q: 0, r: 0, terrain: 'TERRAIN_URBAN', river: [3], road: true },
      { q: 1, r: 0, terrain: 'TERRAIN_URBAN', road: true },
      { q: 2, r: 0, terrain: 'TERRAIN_URBAN', road: true },
      { q: 3, r: 0, vegetation: 'VEGETATION_SCRUB' },
      { q: -2, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: -1, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 0, r: -1, terrain: 'TERRAIN_URBAN', river: [3, 4], road: true },
      { q: 1, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 2, r: -1, terrain: 'TERRAIN_URBAN', road: true },
      { q: 3, r: -1, vegetation: 'VEGETATION_SCRUB' },
      { q: -1, r: -2, terrain: 'TERRAIN_URBAN', road: true },
      { q: 0, r: -2, terrain: 'TERRAIN_URBAN', river: [3, 4], road: true },
      { q: 1, r: -2, terrain: 'TERRAIN_URBAN', road: true },
      { q: 3, r: -2, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: -3, terrain: 'TERRAIN_URBAN', river: [3, 4], road: true },
      { q: 1, r: -3, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: -3, terrain: 'TERRAIN_URBAN', height: 'HEIGHT_HILL', road: true },
      { q: 3, r: -3, height: 'HEIGHT_HILL' },
    ],
    units: [
      { player: 0, type: 'UNIT_BALLISTA', q: -1, r: 0, hp: 20 }, // 0
      { player: 0, type: 'UNIT_CROSSBOWMAN', q: -2, r: 2, hp: 20 }, // 1
      { player: 0, type: 'UNIT_SPEARMAN', q: -3, r: 0, hp: 20 }, // 2
      { player: 1, type: 'UNIT_ONAGER', q: 0, r: 0, hp: 8 }, // 3
      { player: 1, type: 'UNIT_ONAGER', q: 1, r: 0, hp: 10 }, // 4
      { player: 1, type: 'UNIT_SPEARMAN', q: 2, r: 0, hp: 7 }, // 5
      { player: 1, type: 'UNIT_LONGBOWMAN', q: -1, r: 1, hp: 12 }, // 6
      { player: 1, type: 'UNIT_WAR_ELEPHANT', q: 1, r: 1, hp: 20 }, // 7
    ],
  },
];
if (typeof module !== 'undefined') module.exports = MINED_CANDIDATES;
