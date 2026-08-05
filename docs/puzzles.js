// Puzzle library. Each puzzle is one player turn; goal = objective within the
// order budget. Solutions are verified by solver.js (tools/verify_puzzles.js).
var OWPUZZLES = [
  {
    id: 'overrun-basics',
    name: 'Overrun',
    author: 'owpuzzle',
    brief: 'Kill all three enemies this turn. Your horseman has 3 orders.',
    lesson: 'Shock cavalry ROUT when they kill: they advance into the vacated tile and may act again. Chain your kills.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: -2, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: -1, r: 0, hp: 5 },
      { player: 1, type: 'UNIT_WARRIOR', q: 0, r: 0, hp: 5 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 5 },
    ],
  },
  {
    id: 'spear-wall',
    name: 'The Spear Wall',
    author: 'owpuzzle',
    brief: 'Kill both enemies this turn with 3 orders.',
    lesson: 'Spearmen are immune to rout — cavalry cannot chain through them. Clear the spear with ranged fire, then charge.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: -2, r: 1 },
      { player: 0, type: 'UNIT_ARCHER', q: -2, r: 0 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 0, r: 0, hp: 4 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0, hp: 8 },
    ],
  },
  {
    id: 'one-spear-two-kills',
    name: 'One Thrust',
    author: 'owpuzzle',
    brief: 'Kill both enemies this turn. Your spearman has 2 orders.',
    lesson: 'Spearmen PIERCE: their attack strikes through the target, hitting the unit directly behind for 25% damage.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_SPEARMAN', q: -1, r: -1 },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 1, hp: 4 },
      { player: 1, type: 'UNIT_ARCHER', q: 0, r: 2, hp: 1 },
    ],
  },
  {
    id: 'the-ford',
    name: 'The Ford',
    author: 'owpuzzle',
    brief: 'Kill the warrior this turn. Your axeman has 3 orders.',
    lesson: 'Melee attacks across a river are halved. Swing around the bank and strike from dry ground.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    // river guards the warrior's W, NW and SW approaches
    tiles: [
      { q: 0, r: 0, river: [0] },    // E edge of (0,0) -> toward warrior
      { q: 1, r: -1, river: [5] },   // SE edge of (1,-1)
      { q: 0, r: 1, river: [1] },    // NE edge of (0,1)
      { q: -1, r: 2, river: [1] },
      { q: 1, r: -2, river: [5] },
      { q: -2, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: -1, r: -2, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: 1, height: 'HEIGHT_HILL' },
      { q: 3, r: -2, height: 'HEIGHT_HILL', vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 8 },
    ],
  },
];
if (typeof module !== 'undefined') module.exports = OWPUZZLES;
