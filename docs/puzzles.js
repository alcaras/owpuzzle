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
    lesson: 'Melee attacks across a river are halved (-50%). Crossing costs extra movement, but striking from the dry bank is worth it.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    // One continuous river, rim to rim. It wraps the warrior's W/NW/SW edges,
    // so the only unhalved attack comes from the far bank.
    tiles: [
      { q: 1, r: 0, river: [2, 3, 4] },
      { q: 1, r: -1, river: [0] },
      { q: 2, r: -2, river: [5, 0] },
      { q: 3, r: -3, river: [5] },
      { q: 0, r: 1, river: [0] },
      { q: 0, r: 2, river: [1, 0] },
      { q: 0, r: 3, river: [1] },
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
  {
    id: 'into-the-woods',
    name: 'Into the Woods',
    author: 'owpuzzle',
    brief: 'Kill the archer hiding in the forest. 3 orders.',
    lesson: 'Trees halve RANGED attacks against units inside them — but melee fights through the forest at full strength.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 1, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 2, height: 'HEIGHT_HILL' },
    ],
    units: [
      { player: 0, type: 'UNIT_WARRIOR', q: -1, r: 0 },
      { player: 0, type: 'UNIT_ARCHER', q: -1, r: 1 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0, hp: 5 },
    ],
  },
  {
    id: 'the-pincer',
    name: 'The Pincer',
    author: 'owpuzzle',
    brief: 'Kill the warrior with only 2 orders.',
    lesson: 'Flanking: an ally directly OPPOSITE your attack line boosts a Saddleborn charge (+25%) — and a flanked defender cannot counterattack at all.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 0, r: 0, promotions: ['EFFECTUNIT_SADDLEBORN'], name: 'saddleborn horseman' },
      { player: 0, type: 'UNIT_WARRIOR', q: 2, r: 1 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 13 },
    ],
  },
  {
    id: 'one-swing',
    name: 'One Swing',
    author: 'owpuzzle',
    brief: 'Kill all three enemies. Your axeman has 2 orders.',
    lesson: 'Axemen CLEAVE: their attack also strikes the two tiles beside the swing for 25% damage. Line up the whole cluster.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: -1, hp: 2 },
      { player: 1, type: 'UNIT_ARCHER', q: 0, r: 1, hp: 2 },
    ],
  },
  {
    id: 'point-blank',
    name: 'Point Blank',
    author: 'owpuzzle',
    brief: 'Kill the spearman. Your archer has 2 orders.',
    lesson: 'Ranged damage falls 20% per hex beyond the first — and archers NEVER take counterattacks, even firing point blank.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_ARCHER', q: -2, r: 0 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 1, r: 0, hp: 5 },
    ],
  },
  {
    id: 'over-the-hills',
    name: 'Over the Hills',
    author: 'owpuzzle',
    brief: 'Reach and kill the wounded archer. 6 orders.',
    lesson: 'Hills cost a full move to climb. After 3 steps a unit is FATIGUED — it can force march, but every extra step costs 2 orders.',
    orders: 6,
    radius: 3,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -1, r: 0, height: 'HEIGHT_HILL' },
      { q: 0, r: 0, height: 'HEIGHT_HILL' },
      { q: 1, r: 0, height: 'HEIGHT_HILL' },
      { q: 2, r: 0, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 1, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_WARRIOR', q: -2, r: 0 },
      { player: 1, type: 'UNIT_ARCHER', q: 3, r: 0, hp: 4 },
    ],
  },
  {
    "id": "nestor-charge",
    "name": "The Charge at the River",
    "author": "mined: alcaras v NestorLN 2024 g1, turn 115",
    "brief": "Finish the charge: kill the swordsman and the enemy cataphract. 4 orders.",
    "lesson": "A real tournament position. Rivers halve melee attacks \u2014 the winning charge threads between river edges to strike from dry ground.",
    "orders": 4,
    "radius": 4,
    "objective": {
      "kind": "killList",
      "targets": [
        2,
        3
      ]
    },
    "units": [
      {
        "player": 0,
        "type": "UNIT_CATAPHRACT",
        "q": -1,
        "r": 0,
        "hp": 19
      },
      {
        "player": 0,
        "type": "UNIT_CATAPHRACT",
        "q": -1,
        "r": -2,
        "hp": 20
      },
      {
        "player": 1,
        "type": "UNIT_CATAPHRACT",
        "q": 1,
        "r": -2,
        "hp": 6
      },
      {
        "player": 1,
        "type": "UNIT_SWORDSMAN",
        "q": -1,
        "r": 1,
        "hp": 8
      },
      {
        "player": 1,
        "type": "UNIT_LONGBOWMAN",
        "q": -3,
        "r": 1,
        "hp": 18
      }
    ],
    "tiles": [
      {
        "q": -4,
        "r": 4,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -3,
        "r": 4,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -2,
        "r": 4,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -1,
        "r": 4,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 0,
        "r": 4,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -4,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -3,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -2,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -1,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 0,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 1,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -4,
        "r": 2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -3,
        "r": 2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -2,
        "r": 2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -1,
        "r": 2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 0,
        "r": 2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 1,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 2,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": -4,
        "r": 1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -3,
        "r": 1,
        "terrain": "TERRAIN_MARSH"
      },
      {
        "q": -2,
        "r": 1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -1,
        "r": 1,
        "terrain": "TERRAIN_MARSH"
      },
      {
        "q": 0,
        "r": 1,
        "terrain": "TERRAIN_MARSH"
      },
      {
        "q": 1,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 3,
        "r": 1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": -4,
        "r": 0,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -3,
        "r": 0,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -2,
        "r": 0,
        "terrain": "TERRAIN_MARSH"
      },
      {
        "q": -1,
        "r": 0,
        "terrain": "TERRAIN_MARSH"
      },
      {
        "q": 0,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 3,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 4,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -3,
        "r": -1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": -1,
        "terrain": "TERRAIN_MARSH",
        "river": [
          3
        ]
      },
      {
        "q": -1,
        "r": -1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": -1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": 1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 3,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 4,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES",
        "river": [
          5
        ]
      },
      {
        "q": -1,
        "r": -2,
        "height": "HEIGHT_HILL",
        "river": [
          4,
          5
        ]
      },
      {
        "q": 0,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "river": [
          4,
          5
        ]
      },
      {
        "q": 1,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES",
        "river": [
          3
        ]
      },
      {
        "q": 2,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 3,
        "r": -2,
        "vegetation": "VEGETATION_TREES",
        "river": [
          3
        ]
      },
      {
        "q": 4,
        "r": -2,
        "terrain": "TERRAIN_ARID",
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": -1,
        "r": -3,
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 0,
        "r": -3,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": -3,
        "vegetation": "VEGETATION_TREES",
        "river": [
          5
        ]
      },
      {
        "q": 2,
        "r": -3,
        "vegetation": "VEGETATION_SCRUB",
        "river": [
          3
        ]
      },
      {
        "q": 3,
        "r": -3,
        "river": [
          3,
          4
        ]
      },
      {
        "q": 4,
        "r": -3,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 0,
        "r": -4,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": -4,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 2,
        "r": -4,
        "vegetation": "VEGETATION_TREES_CUT",
        "river": [
          5
        ],
        "road": true
      },
      {
        "q": 3,
        "r": -4,
        "river": [
          4
        ],
        "road": true
      }
    ]
  },
];
if (typeof module !== 'undefined') module.exports = OWPUZZLES;
