// Puzzle library. Each puzzle is one player turn; goal = objective within the
// order budget. Solutions are verified by solver.js (tools/verify_puzzles.js).
var OWPUZZLES = [
  {
    id: 'overrun-basics',
    difficulty: 1,
    name: 'Rout',
    author: 'owpuzzle',
    brief: 'Kill all three enemies this turn.',
    lesson: 'Units with ROUT advance into the vacated tile when they kill, and may attack again. Chain your kills.',
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
    difficulty: 2,
    name: 'The Spear Wall',
    author: 'owpuzzle',
    brief: 'Kill both enemies this turn.',
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
    difficulty: 1,
    name: 'One Thrust',
    author: 'owpuzzle',
    brief: 'Kill both enemies this turn.',
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
    difficulty: 1,
    name: 'The Ford',
    author: 'owpuzzle',
    brief: 'Kill the warrior this turn.',
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
    difficulty: 1,
    name: 'Into the Woods',
    author: 'owpuzzle',
    brief: 'Kill the archer hiding in the forest.',
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
    difficulty: 2,
    name: 'The Pincer',
    author: 'owpuzzle',
    brief: 'Kill the warrior.',
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
    difficulty: 1,
    name: 'One Swing',
    author: 'owpuzzle',
    brief: 'Kill all three enemies.',
    lesson: 'Axemen CLEAVE: their attack also strikes the two tiles beside the swing for 25% damage. Line up the whole cluster.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: -1 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: -1, hp: 2 },
      { player: 1, type: 'UNIT_ARCHER', q: 0, r: 1, hp: 2 },
    ],
  },
  {
    id: 'point-blank',
    difficulty: 1,
    name: 'Point Blank',
    author: 'owpuzzle',
    brief: 'Kill the spearman.',
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
   "id": "the-low-road",
   "difficulty": 1,
   "name": "The Low Road",
   "author": "owpuzzle",
   "brief": "Kill the wounded archer.",
   "lesson": "Movement is a budget, not a tile count. The coastal road is the long way round and still the cheap way: road tiles cost a fraction of open ground, and the hill trail costs double. When there is a road, ride it.",
   "orders": 3,
   "radius": 3,
   "objective": {
    "kind": "killAll"
   },
   "tiles": [
    {
     "q": -1,
     "r": 0,
     "height": "HEIGHT_MOUNTAIN"
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
     "q": -2,
     "r": -1,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": -1,
     "r": -1,
     "height": "HEIGHT_HILL"
    },
    {
     "q": 0,
     "r": -1,
     "height": "HEIGHT_HILL"
    },
    {
     "q": 1,
     "r": -1,
     "height": "HEIGHT_HILL"
    },
    {
     "q": 2,
     "r": -1,
     "height": "HEIGHT_HILL"
    },
    {
     "q": 3,
     "r": -1,
     "height": "HEIGHT_HILL"
    },
    {
     "q": -2,
     "r": 0,
     "road": true
    },
    {
     "q": -2,
     "r": 1,
     "road": true
    },
    {
     "q": -1,
     "r": 1,
     "road": true
    },
    {
     "q": 0,
     "r": 1,
     "road": true
    },
    {
     "q": 1,
     "r": 1,
     "road": true
    },
    {
     "q": 2,
     "r": 1,
     "road": true
    },
    {
     "q": -3,
     "r": 2,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": -3,
     "r": 3,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": -2,
     "r": 2,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": -2,
     "r": 3,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": -1,
     "r": 2,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": -1,
     "r": 3,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": 2,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": 3,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 1,
     "r": 2,
     "terrain": "TERRAIN_WATER"
    }
   ],
   "units": [
    {
     "player": 0,
     "type": "UNIT_WARRIOR",
     "q": -2,
     "r": 0
    },
    {
     "player": 1,
     "type": "UNIT_ARCHER",
     "q": 3,
     "r": 0,
     "hp": 4
    }
   ]
  },
  {
    id: 'over-the-hills',
    difficulty: 2,
    name: 'Over the Hills',
    author: 'owpuzzle',
    brief: 'The archer is four hills away and there is no way around.',
    lesson: 'After 3 movement steps a unit is FATIGUED. Activate FORCE MARCH (costs 100 training) to keep going — every extra step then costs 2 orders. Attacks still cost only 1 and are never blocked by fatigue.',
    orders: 6,
    training: 100,
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
      { q: 3, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: -1, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_WARRIOR', q: -2, r: 0 },
      { player: 1, type: 'UNIT_ARCHER', q: 3, r: 0, hp: 4 },
    ],
  },
  {
    "id": "nestor-charge",
    "difficulty": 3,
    "name": "The Charge at the River",
    "author": "mined: alcaras v NestorLN 2024 g1, turn 115",
    "brief": "Destroy as much enemy strength as you can this turn.",
    "lesson": "A real tournament position. Rivers halve melee attacks \u2014 the winning charge threads between river edges to strike from dry ground.",
    "orders": 5,
    "slowVerify": true,
    "radius": 4,
    "objective": { "kind": "maxKill", "count": 260 },
    "units": [
      { "player": 0, "type": "UNIT_CATAPHRACT", "q": -1, "r": 0, "hp": 19 },
      { "player": 0, "type": "UNIT_CATAPHRACT", "q": -1, "r": -2, "hp": 20 },
      { "player": 0, "type": "UNIT_CATAPHRACT", "q": 0, "r": -3, "hp": 18 },
      { "player": 1, "type": "UNIT_CATAPHRACT", "q": 1, "r": -2, "hp": 6 },
      { "player": 1, "type": "UNIT_SWORDSMAN", "q": -1, "r": 1, "hp": 8 },
      { "player": 1, "type": "UNIT_LONGBOWMAN", "q": -3, "r": 1, "hp": 8 }
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
  {
    id: 'parthian-tactics',
    difficulty: 2,
    name: 'Parthian Tactics',
    author: 'owpuzzle',
    brief: 'Kill all three enemies.',
    lesson: 'Palton cavalry shoot at point blank AND have Rout: a ranged kill still advances them — and ranged attackers never take counterattacks. A rout chain with zero blood on your side.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_PALTON_CAVALRY', q: -2, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: -1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_WARRIOR', q: 0, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 9 },
    ],
  },
  {
    id: 'cut-the-bowstring',
    difficulty: 2,
    name: 'Cut the Bowstring',
    author: 'owpuzzle',
    brief: 'Destroy as much enemy strength as you can this turn.',
    lesson: 'A Rout advance is not optional: when a further target is attackable from the vacated tile, the kill carries you into it. Pick kills whose empty tile points where you want to ride — the biggest target may pull you the wrong way.',
    orders: 3,
    radius: 4,
    objective: { kind: 'maxKill', count: 160 },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 0, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: 0, r: -1, hp: 12 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 0, r: -2 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_WARRIOR', q: 2, r: -1, hp: 9 },
      { player: 1, type: 'UNIT_LONGBOWMAN', q: 3, r: -1, hp: 5 },
    ],
  },
  {
    id: 'the-shove',
    difficulty: 2,
    name: 'The Shove',
    author: 'owpuzzle',
    brief: 'Kill both enemies this turn.',
    lesson: "The elephant's shove is a weapon of position: a survivor is pushed one tile straight back. Pierce strikes the tiles beyond the target - arrange the column first, then loose the bolt.",
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_WAR_ELEPHANT', q: 1, r: -2 },
      { player: 0, type: 'UNIT_BALLISTA', q: 0, r: 0 },
      { player: 1, type: 'UNIT_SWORDSMAN', q: 1, r: -1, hp: 12 },
      { player: 1, type: 'UNIT_ARCHER', q: 2, r: 0, hp: 6 },
    ],
  },
  {
    id: 'leave-him',
    difficulty: 3,
    name: 'Leave Him',
    author: 'owpuzzle',
    brief: 'Destroy as much enemy strength as you can this turn.',
    lesson: 'Orders are the scarcest thing on the field. The cheap kill that begs to be taken can cost the order a bigger kill needed - count strength per order, and let the bait live.',
    orders: 4,
    radius: 4,
    objective: { kind: 'maxKill', count: 150 },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 0, r: 0 },
      { player: 0, type: 'UNIT_ARCHER', q: 2, r: 1 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: -1, hp: 8 },
      { player: 1, type: 'UNIT_AXEMAN', q: 3, r: -1, hp: 13 },
      { player: 1, type: 'UNIT_WARRIOR', q: 3, r: 1, hp: 7 },
    ],
  },
  {
    id: 'the-gatekeeper',
    difficulty: 2,
    name: 'The Gatekeeper',
    author: 'owpuzzle',
    brief: 'Kill the marked longbowman this turn.',
    lesson: 'Units control the tiles around them: you may step into a zone of control, but never from one controlled tile straight into another. One arrow on the watchman opens the whole road.',
    orders: 3,
    radius: 4,
    tiles: [
      { q: -4, r: 0, terrain: 'TERRAIN_WATER' },
      { q: -4, r: 1, terrain: 'TERRAIN_WATER' },
      { q: -4, r: 2, terrain: 'TERRAIN_WATER' },
      { q: -4, r: 3, terrain: 'TERRAIN_WATER' },
      { q: -4, r: 4, terrain: 'TERRAIN_WATER' },
      { q: -3, r: -1, terrain: 'TERRAIN_WATER' },
      { q: -3, r: 0, terrain: 'TERRAIN_WATER' },
      { q: -3, r: 1, terrain: 'TERRAIN_WATER' },
      { q: -3, r: 2, terrain: 'TERRAIN_WATER' },
      { q: -3, r: 3, terrain: 'TERRAIN_WATER' },
      { q: -3, r: 4, terrain: 'TERRAIN_WATER' },
      { q: -2, r: -2, terrain: 'TERRAIN_WATER' },
      { q: -2, r: -1, terrain: 'TERRAIN_WATER' },
      { q: -2, r: 0, terrain: 'TERRAIN_WATER' },
      { q: -2, r: 1, terrain: 'TERRAIN_WATER' },
      { q: -2, r: 2, terrain: 'TERRAIN_WATER' },
      { q: -2, r: 3, terrain: 'TERRAIN_WATER' },
      { q: -2, r: 4, terrain: 'TERRAIN_WATER' },
      { q: -1, r: -3, terrain: 'TERRAIN_WATER' },
      { q: -1, r: -2, terrain: 'TERRAIN_WATER' },
      { q: -1, r: -1, terrain: 'TERRAIN_WATER' },
      { q: -1, r: 0, terrain: 'TERRAIN_WATER' },
      { q: -1, r: 1, terrain: 'TERRAIN_WATER' },
      { q: -1, r: 2, terrain: 'TERRAIN_WATER' },
      { q: -1, r: 3, terrain: 'TERRAIN_WATER' },
      { q: -1, r: 4, terrain: 'TERRAIN_WATER' },
      { q: 0, r: -4, terrain: 'TERRAIN_WATER' },
      { q: 0, r: -3, terrain: 'TERRAIN_WATER' },
      { q: 0, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 0, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 0, r: 1, terrain: 'TERRAIN_WATER' },
      { q: 0, r: 3, terrain: 'TERRAIN_WATER' },
      { q: 0, r: 4, terrain: 'TERRAIN_WATER' },
      { q: 1, r: -4, terrain: 'TERRAIN_WATER' },
      { q: 1, r: -3, terrain: 'TERRAIN_WATER' },
      { q: 1, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 1, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 1, r: 2, terrain: 'TERRAIN_WATER' },
      { q: 1, r: 3, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -4, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -3, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 2, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 2, r: 2, terrain: 'TERRAIN_WATER' },
      { q: 3, r: -4, terrain: 'TERRAIN_WATER' },
      { q: 3, r: -3, terrain: 'TERRAIN_WATER' },
      { q: 3, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 3, r: -1, terrain: 'TERRAIN_WATER' },
      { q: 3, r: 1, terrain: 'TERRAIN_WATER' },
      { q: 4, r: -4, terrain: 'TERRAIN_WATER' },
      { q: 4, r: -3, terrain: 'TERRAIN_WATER' },
      { q: 4, r: -2, terrain: 'TERRAIN_WATER' },
      { q: 4, r: -1, terrain: 'TERRAIN_WATER' },
    ],
    objective: { kind: 'killList', targets: [3] },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 0, r: 0 },
      { player: 0, type: 'UNIT_ARCHER', q: 1, r: 1 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 2, r: 1, hp: 4 },
      { player: 1, type: 'UNIT_LONGBOWMAN', q: 4, r: 0, hp: 5 },
      { player: 1, type: 'UNIT_WARRIOR', q: 0, r: 2, hp: 8 },
    ],
  },
  {
    id: 'one-bolt',
    difficulty: 1,
    name: 'One Bolt, Three Bodies',
    author: 'owpuzzle',
    brief: 'Kill all three warriors.',
    lesson: 'Ballistae strike at +100% against infantry, and the bolt PIERCES two tiles beyond the target at half damage. Line up the column.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_BALLISTA', q: -1, r: 1 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 15 },
      { player: 1, type: 'UNIT_WARRIOR', q: 2, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_WARRIOR', q: 3, r: 0, hp: 8 },
    ],
  },
  {
    id: 'the-barrage',
    difficulty: 2,
    name: 'The Barrage',
    author: 'owpuzzle',
    brief: 'Your onager is unlimbered and loaded. Kill all three enemies.',
    lesson: 'Siege must SET UP a turn in advance (setting up ends the turn). Once deployed: shots ignore distance entirely, and the blast SPLASHES everything adjacent to the target for 25%. Aim at the middle.',
    orders: 1,
    radius: 4,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_ONAGER', q: -3, r: 0, unlimbered: true },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_ARCHER', q: 2, r: -1, hp: 2 },
      { player: 1, type: 'UNIT_ARCHER', q: 2, r: 0, hp: 2 },
    ],
  },
  {
   "id": "butchers-work",
   "difficulty": 1,
   "name": "Butcher's Work",
   "author": "owpuzzle",
   "brief": "Kill all three warriors this turn.",
   "lesson": "The swing is the weapon: a swordsman's cleave strikes both flank tiles of the cut at half damage, and swords bite infantry at +50%. Don't spend your one attack on the easy kill - step to where a single cut carves all three.",
   "orders": 2,
   "radius": 3,
   "objective": {
    "kind": "killAll"
   },
   "units": [
    {
     "player": 0,
     "type": "UNIT_SWORDSMAN",
     "q": 0,
     "r": -1
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": 1,
     "r": 0,
     "hp": 18
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": 1,
     "r": -1,
     "hp": 9
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": 0,
     "r": 1,
     "hp": 9
    }
   ]
  },
  {
    id: 'ships-of-the-desert',
    difficulty: 2,
    name: 'Ships of the Desert',
    author: 'owpuzzle',
    brief: 'Kill the horseman.',
    lesson: 'Camels fight at +50% against horses, and Nomad riders gain +25% fighting FROM sand or arid ground. Only the shot from the dunes kills.',
    orders: 2,
    radius: 3,
    tiles: [
      { q: 0, r: 1, terrain: 'TERRAIN_SAND' },
      { q: 0, r: 2, terrain: 'TERRAIN_SAND' },
      { q: -1, r: 2, terrain: 'TERRAIN_SAND' },
      { q: 1, r: 1, terrain: 'TERRAIN_SAND' },
      { q: -2, r: 3, terrain: 'TERRAIN_ARID' },
      { q: -1, r: 3, terrain: 'TERRAIN_ARID' },
    ],
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_CAMEL_ARCHER', q: -2, r: 1 },
      { player: 1, type: 'UNIT_HORSEMAN', q: 1, r: 0, hp: 9 },
    ],
  },
  {
    id: 'trample',
    difficulty: 3,
    name: 'Trample',
    author: 'owpuzzle',
    brief: 'Kill the enemy horseman beyond the pass.',
    lesson: 'Elephants PANIC their victims: a surviving defender is shoved back one tile. You cannot always kill the wall — sometimes you move it.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killTarget', target: 3 },
    tiles: [
      { q: -2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 3, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 3, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -3, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: 2, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_WAR_ELEPHANT', q: 0, r: -1 },
      { player: 0, type: 'UNIT_HORSEMAN', q: -2, r: 0 },
      { player: 1, type: 'UNIT_CHARIOT', q: 0, r: 0, name: 'war chariot' },
      { player: 1, type: 'UNIT_HORSEMAN', q: 2, r: 0, hp: 8, name: 'enemy horseman' },
    ],
  },
  {
    id: 'the-stampede',
    difficulty: 2,
    name: 'The Stampede',
    author: 'owpuzzle',
    brief: 'Kill both warriors.',
    lesson: 'Combine your beasts: the elephant PANICS a survivor back one tile — right into your rout lane. Kill, advance, kill again.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: -1, r: 0 },
      { player: 0, type: 'UNIT_WAR_ELEPHANT', q: 3, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: 0, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_WARRIOR', q: 2, r: 0, hp: 18 },
    ],
  },
  {
    id: 'chop-the-spears',
    difficulty: 1,
    name: 'Chop the Spears',
    author: 'owpuzzle',
    brief: 'Kill both enemies.',
    lesson: 'Axemen strike POLEARMS at +50%. The counter-triangle: spears stop horses, axes chop spears, horses run down axes.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0 },
      { player: 0, type: 'UNIT_HORSEMAN', q: -1, r: 1 },
      { player: 1, type: 'UNIT_SPEARMAN', q: 0, r: 0, hp: 8 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: 1, hp: 8 },
    ],
  },
  {
    id: 'the-windlass',
    difficulty: 1,
    name: 'The Windlass',
    author: 'owpuzzle',
    brief: 'Kill both warriors.',
    lesson: 'Crossbows punch at +50% against melee troops and PIERCE the tile behind at half damage — but only at point blank range.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_CROSSBOWMAN', q: -1, r: 2 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 14 },
      { player: 1, type: 'UNIT_WARRIOR', q: 2, r: 0, hp: 6 },
    ],
  },
  {
    id: 'the-bodyguards',
    difficulty: 3,
    name: 'The Bodyguards',
    author: 'owpuzzle',
    brief: 'Kill General Vahram and the archer beside him.',
    lesson: 'Collateral is targeting too: the onager blast SPLASHES past its victim, and the ballista bolt PIERCES through the wall. Aim at the guards to kill the man behind them.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killList', targets: [2, 4] },
    units: [
      { player: 0, type: 'UNIT_ONAGER', q: -2, r: 1, unlimbered: true },
      { player: 0, type: 'UNIT_BALLISTA', q: -1, r: 0 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: -1, hp: 8 },
      { player: 1, type: 'UNIT_PIKEMAN', q: 0, r: 0 },
      { player: 1, type: 'UNIT_SWORDSMAN', q: 1, r: 0, hp: 5, general: true, name: 'General Vahram' },
    ],
  },
  {
    id: 'the-zealot',
    difficulty: 3,
    name: 'The Zealot',
    author: 'owpuzzle',
    brief: 'Kill the champion and his archers.',
    lesson: 'LAST STAND: the zealot cannot be killed by any blow struck while he is above 1 HP. Land the great cleave FIRST — then the humblest sling stone in the army finishes the legend.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_SWORDSMAN', q: -1, r: -1 },
      { player: 0, type: 'UNIT_SLINGER', q: 2, r: -2 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 14, promotions: ['EFFECTUNIT_ZEALOT'], name: 'zealot champion' },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: -1, hp: 2 },
      { player: 1, type: 'UNIT_ARCHER', q: 0, r: 1, hp: 2 },
    ],
  },
  {
    id: 'the-fortress',
    difficulty: 3,
    name: 'The Fortress',
    author: 'owpuzzle',
    brief: 'Kill the archer holding the fort.',
    lesson: 'You cannot out-damage the fort — so take the fort away. The elephant PANICS the survivor out onto open ground, where cavalry does the rest.',
    orders: 4,
    radius: 3,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 1, r: 0, improvement: 'IMPROVEMENT_FORT' },
    ],
    units: [
      { player: 0, type: 'UNIT_WAR_ELEPHANT', q: -1, r: 0 },
      { player: 0, type: 'UNIT_HORSEMAN', q: -1, r: 1 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0, hp: 13 },
    ],
  },
  {
    id: 'the-wrong-hill',
    difficulty: 3,
    name: 'The Wrong Hill',
    author: 'community: fluffybunny',
    brief: 'Kill the wounded enemy archer.',
    lesson: 'Adjacent friendly units can SWAP tiles for one order — both count a step. The Highlander shoots at +25% from hills; the swap puts the right archer on the right ground.',
    orders: 2,
    radius: 3,
    tiles: [
      { q: 0, r: 0, height: 'HEIGHT_HILL' },
    ],
    objective: { kind: 'killTarget', target: 2 },
    units: [
      { player: 0, type: 'UNIT_ARCHER', q: 1, r: 0, promotions: ['EFFECTUNIT_HIGHLANDER'], name: 'highlander archer' },
      { player: 0, type: 'UNIT_ARCHER', q: 0, r: 0 },
      { player: 1, type: 'UNIT_ARCHER', q: -2, r: 1, hp: 7 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 1 },
    ],
  },
  {
    "id": "the-shore-riders",
    "difficulty": 3,
    "name": "The Shore Riders",
    "author": "mined from a real game",
    "brief": "Destroy as much enemy strength as you can this turn.",
    "lesson": "A point-blank kill by ranged cavalry routs exactly like a charge \u2014 the palton may fire again, but only while another enemy still stands within reach of the tile it fires from.",
    "orders": 5,
    "radius": 3,
    "objective": { "kind": "maxKill", "count": 190 },
    "tiles": [
      {
        "q": -3,
        "r": 3,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -2,
        "r": 3,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -1,
        "r": 3,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": 3,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": -3,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -2,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -1,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": 0,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": -3,
        "r": 1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": -2,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -1,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": 0,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": 1,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 2,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES"
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
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -1,
        "r": 0,
        "terrain": "TERRAIN_ARID",
        "height": "HEIGHT_HILL"
      },
      {
        "q": 0,
        "r": 0,
        "terrain": "TERRAIN_ARID"
      },
      {
        "q": 1,
        "r": 0,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 2,
        "r": 0,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 3,
        "r": 0,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": -2,
        "r": -1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": -1,
        "r": -1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 0,
        "r": -1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 1,
        "r": -1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 2,
        "r": -1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 3,
        "r": -1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -1,
        "r": -2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 0,
        "r": -2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 1,
        "r": -2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 2,
        "r": -2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 3,
        "r": -2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 0,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 1,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 2,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      },
      {
        "q": 3,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_OCEAN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_PALTON_CAVALRY",
        "q": 0,
        "r": 0,
        "hp": 11
      , "promotions": ["EFFECTUNIT_EAGLE_EYE"]},
      {
        "player": 0,
        "type": "UNIT_PALTON_CAVALRY",
        "q": 1,
        "r": 0,
        "hp": 20
      },
      {
        "player": 1,
        "type": "UNIT_CHARIOT",
        "q": -1,
        "r": 0,
        "hp": 8
      },
      {
        "player": 1,
        "type": "UNIT_BEJA_ARCHER",
        "q": -1,
        "r": 1,
        "hp": 8
      },
      {
        "player": 1,
        "type": "UNIT_BIREME",
        "q": 0,
        "r": -1,
        "hp": 6
      },
      {
        "player": 1,
        "type": "UNIT_ARCHER",
        "q": 0,
        "r": 2,
        "hp": 20
      },
      {
        "player": 1,
        "type": "UNIT_ARCHER",
        "q": -1,
        "r": 2,
        "hp": 20
      }
    ]
  },
  {
    "id": "the-wood-line",
    "difficulty": 3,
    "name": "The Wood Line",
    "author": "mined from a real game",
    "brief": "Destroy as much enemy strength as you can this turn.",
    "lesson": "Trees halve ranged fire and do nothing against a charge \u2014 and a Rout kill carries the elephant into the wood, where the next man can be taken from behind.",
    "slowVerify": true,
    "orders": 5,
    "radius": 3,
    "objective": { "kind": "maxKill", "count": 150 },
    "tiles": [
      {
        "q": -2,
        "r": 3,
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": -1,
        "r": 3,
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": 0,
        "r": 3,
        "river": [
          4
        ]
      },
      {
        "q": -2,
        "r": 2,
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": 1,
        "r": 2,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": -1,
        "r": 1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": 1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 2,
        "r": 1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": -1,
        "r": 0,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 2,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 3,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "river": [
          3,
          4
        ],
        "road": true
      },
      {
        "q": -1,
        "r": -1,
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": 0,
        "r": -1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": -1,
        "river": [
          4,
          5
        ]
      },
      {
        "q": 2,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "river": [
          4,
          5
        ],
        "road": true
      },
      {
        "q": 3,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "river": [
          4
        ],
        "road": true
      },
      {
        "q": 0,
        "r": -2,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": -2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 2,
        "r": -2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 1,
        "r": -3,
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": 2,
        "r": -3,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 3,
        "r": -3,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AFRICAN_ELEPHANT",
        "q": 1,
        "r": -1,
        "hp": 11
      },
      {
        "player": 0,
        "type": "UNIT_SLINGER",
        "q": 1,
        "r": 1,
        "hp": 20
      },
      {
        "player": 0,
        "type": "UNIT_SLINGER",
        "q": 2,
        "r": 1,
        "hp": 20
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": 1,
        "hp": 13
      },
      {
        "player": 1,
        "type": "UNIT_ARCHER",
        "q": -1,
        "r": 1,
        "hp": 8
      },
      {
        "player": 1,
        "type": "UNIT_ARCHER",
        "q": -1,
        "r": 0,
        "hp": 8
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": -1,
        "r": -1,
        "hp": 17
      }
    ]
  },
  {
    "id": "the-jungle-road",
    "difficulty": 3,
    "name": "The Jungle Road",
    "author": "mined from a real game",
    "brief": "Destroy as much enemy strength as you can this turn.",
    "lesson": "A ROUT kill carries the attacker into the vacated tile \u2014 line up the charge so you land beside your next victim.",
    "orders": 4,
    "radius": 3,
    "objective": { "kind": "maxKill", "count": 140 },
    "tiles": [
      {
        "q": -3,
        "r": 3,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": -2,
        "r": 3,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -1,
        "r": 3,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -3,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": 2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": -1,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": 2,
        "terrain": "TERRAIN_URBAN",
        "height": "HEIGHT_HILL",
        "road": true
      },
      {
        "q": -3,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_TREES",
        "road": true
      },
      {
        "q": -1,
        "r": 1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": 1,
        "terrain": "TERRAIN_ARID",
        "height": "HEIGHT_HILL",
        "road": true
      },
      {
        "q": 1,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": -3,
        "r": 0,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": 0,
        "vegetation": "VEGETATION_TREES",
        "road": true
      },
      {
        "q": -1,
        "r": 0,
        "vegetation": "VEGETATION_TREES",
        "road": true
      },
      {
        "q": 0,
        "r": 0,
        "terrain": "TERRAIN_ARID",
        "road": true
      },
      {
        "q": 1,
        "r": 0,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": 2,
        "r": 0,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": -2,
        "r": -1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_LAKE"
      },
      {
        "q": -1,
        "r": -1,
        "road": true
      },
      {
        "q": 0,
        "r": -1,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": 1,
        "r": -1,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": 2,
        "r": -1,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": -1,
        "r": -2,
        "vegetation": "VEGETATION_TREES",
        "road": true
      },
      {
        "q": 0,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE",
        "road": true
      },
      {
        "q": 1,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_MOUNTAIN",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": 2,
        "r": -2,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_MOUNTAIN",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": 0,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_LAKE"
      },
      {
        "q": 1,
        "r": -3,
        "terrain": "TERRAIN_LUSH",
        "vegetation": "VEGETATION_JUNGLE"
      },
      {
        "q": 2,
        "r": -3,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_MOUNTAIN",
        "vegetation": "VEGETATION_JUNGLE"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": 1,
        "r": 1,
        "hp": 12
      },
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": 2,
        "r": 0,
        "hp": 19
      },
      {
        "player": 0,
        "type": "UNIT_KUSHAN_CAVALRY",
        "q": 2,
        "r": -1,
        "hp": 18
      },
      {
        "player": 1,
        "type": "UNIT_ARMOURED_ELEPHANT",
        "q": 1,
        "r": 0,
        "hp": 10
      },
      {
        "player": 1,
        "type": "UNIT_ONAGER",
        "q": 0,
        "r": 0,
        "hp": 9
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": -1,
        "r": 0,
        "hp": 18
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": 0,
        "r": -2,
        "hp": 8
      }
    ]
  },
  {
    "id": "the-crossed-lanes",
    "difficulty": 3,
    "name": "The Crossed Lanes",
    "author": "mined from a real game",
    "brief": "Destroy as much enemy strength as you can this turn.",
    "lesson": "A ballista bolt carries on through the body it hits, so two engines shooting the same front-rank man skewer two different men behind him.",
    "orders": 3,
    "radius": 3,
    "objective": { "kind": "maxKill", "count": 220 },
    "tiles": [
      {
        "q": -3,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -2,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -1,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 0,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": -3,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -1,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 1,
        "r": 2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -3,
        "r": 1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": 1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -1,
        "r": 1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": 1,
        "terrain": "TERRAIN_LUSH",
        "height": "HEIGHT_HILL"
      },
      {
        "q": 1,
        "r": 1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_LAKE"
      },
      {
        "q": 2,
        "r": 1,
        "terrain": "TERRAIN_MARSH"
      },
      {
        "q": -3,
        "r": 0,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": 0,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -1,
        "r": 0,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 1,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 2,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 3,
        "r": 0,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -2,
        "r": -1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -1,
        "r": -1,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 1,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 2,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 3,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": -1,
        "r": -2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 0,
        "r": -2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 1,
        "r": -2,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": 2,
        "r": -2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 3,
        "r": -2,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 0,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 1,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 2,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      },
      {
        "q": 3,
        "r": -3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_COAST"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_BALLISTA",
        "q": 0,
        "r": 0,
        "hp": 16
      },
      {
        "player": 0,
        "type": "UNIT_BALLISTA",
        "q": 0,
        "r": -1,
        "hp": 17
      },
      {
        "player": 0,
        "type": "UNIT_LONGBOWMAN",
        "q": 1,
        "r": 0,
        "hp": 7
      },
      {
        "player": 0,
        "type": "UNIT_TURRETED_ELEPHANT",
        "q": 2,
        "r": 0,
        "hp": 10
      },
      {
        "player": 1,
        "type": "UNIT_LEGIONARY",
        "q": -1,
        "r": 0,
        "hp": 16
      },
      {
        "player": 1,
        "type": "UNIT_LEGIONARY",
        "q": -2,
        "r": 1,
        "hp": 7
      },
      {
        "player": 1,
        "type": "UNIT_HASTATUS",
        "q": -3,
        "r": 0,
        "hp": 5
      },
      {
        "player": 1,
        "type": "UNIT_SWORDSMAN",
        "q": 0,
        "r": 1,
        "hp": 20
      }
    ]
  },
  {
    "id": "down-the-avenue",
    "difficulty": 3,
    "name": "Down the Avenue",
    "author": "mined from a real game",
    "brief": "Destroy as much enemy strength as you can this turn.",
    "lesson": "A bolt does not stop at the first body \u2014 take the shot that lines three of them up, then walk a finisher round the block for the survivor.",
    "orders": 4,
    "radius": 3,
    "objective": { "kind": "maxKill", "count": 170 },
    "tiles": [
      {
        "q": -3,
        "r": 3,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_LAKE"
      },
      {
        "q": -2,
        "r": 3,
        "terrain": "TERRAIN_ARID"
      },
      {
        "q": 0,
        "r": 3,
        "terrain": "TERRAIN_LUSH"
      },
      {
        "q": -3,
        "r": 2,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_LAKE"
      },
      {
        "q": -2,
        "r": 1,
        "terrain": "TERRAIN_WATER",
        "height": "HEIGHT_LAKE"
      },
      {
        "q": -1,
        "r": 1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 0,
        "r": 1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": -1,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "river": [
          5
        ],
        "road": true
      },
      {
        "q": 0,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "river": [
          3
        ],
        "road": true
      },
      {
        "q": 1,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 2,
        "r": 0,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 3,
        "r": 0,
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": -2,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": -1,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 0,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "river": [
          3,
          4
        ],
        "road": true
      },
      {
        "q": 1,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 2,
        "r": -1,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 3,
        "r": -1,
        "vegetation": "VEGETATION_SCRUB"
      },
      {
        "q": -1,
        "r": -2,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 0,
        "r": -2,
        "terrain": "TERRAIN_URBAN",
        "river": [
          3,
          4
        ],
        "road": true
      },
      {
        "q": 1,
        "r": -2,
        "terrain": "TERRAIN_URBAN",
        "road": true
      },
      {
        "q": 3,
        "r": -2,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 0,
        "r": -3,
        "terrain": "TERRAIN_URBAN",
        "river": [
          3,
          4
        ],
        "road": true
      },
      {
        "q": 1,
        "r": -3,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 2,
        "r": -3,
        "terrain": "TERRAIN_URBAN",
        "height": "HEIGHT_HILL",
        "road": true
      },
      {
        "q": 3,
        "r": -3,
        "height": "HEIGHT_HILL"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_BALLISTA",
        "q": -1,
        "r": 0,
        "hp": 20
      },
      {
        "player": 0,
        "type": "UNIT_CROSSBOWMAN",
        "q": -2,
        "r": 2,
        "hp": 20
      },
      {
        "player": 0,
        "type": "UNIT_SPEARMAN",
        "q": -3,
        "r": 0,
        "hp": 20
      },
      {
        "player": 1,
        "type": "UNIT_ONAGER",
        "q": 0,
        "r": 0,
        "hp": 8
      },
      {
        "player": 1,
        "type": "UNIT_ONAGER",
        "q": 1,
        "r": 0,
        "hp": 10
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": 2,
        "r": 0,
        "hp": 7
      },
      {
        "player": 1,
        "type": "UNIT_LONGBOWMAN",
        "q": -1,
        "r": 1,
        "hp": 12
      },
      {
        "player": 1,
        "type": "UNIT_WAR_ELEPHANT",
        "q": 1,
        "r": 1,
        "hp": 20
      }
    ]
  },
  {
   "id": "the-two-fords",
   "difficulty": 3,
   "name": "The Two Fords",
   "author": "owpuzzle",
   "brief": "Destroy as much enemy strength as you can this turn.",
   "lesson": "A ford is only a road while nothing holds it: units clamp the tiles around them, and you may never step from one controlled tile straight into another. A bolt that kills the sentry carries on through the gap it opens. And once the horse is across, its kills are its movement — so the shove that moves an enemy INTO the chain is worth more than the blow that kills one out of it.",
   "orders": 12,
   "radius": 4,
   "training": 0,
   "hero": 0,
   "slowVerify": true,
   "objective": {
    "kind": "maxKill",
    "count": 340
   },
   "tiles": [
    {
     "q": 0,
     "r": -4,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": -3,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": -1,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": 0,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": 1,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": 3,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 0,
     "r": 4,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 2,
     "r": -2,
     "height": "HEIGHT_HILL",
     "vegetation": "VEGETATION_TREES"
    },
    {
     "q": 3,
     "r": -3,
     "height": "HEIGHT_HILL",
     "vegetation": "VEGETATION_TREES"
    },
    {
     "q": 1,
     "r": 0,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 1,
     "r": 1,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 2,
     "r": 0,
     "height": "HEIGHT_MOUNTAIN"
    }
   ],
   "units": [
    {
     "player": 0,
     "type": "UNIT_CATAPHRACT",
     "q": -3,
     "r": 0
    },
    {
     "player": 0,
     "type": "UNIT_BALLISTA",
     "q": -2,
     "r": -2
    },
    {
     "player": 0,
     "type": "UNIT_WAR_ELEPHANT",
     "q": -2,
     "r": -1
    },
    {
     "player": 0,
     "type": "UNIT_ARCHER",
     "q": -3,
     "r": -1
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": -1,
     "r": -2,
     "hp": 8
    },
    {
     "player": 1,
     "type": "UNIT_LEGIONARY",
     "q": 1,
     "r": -2,
     "hp": 14
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": 1,
     "r": -3,
     "hp": 8
    },
    {
     "player": 1,
     "type": "UNIT_SPEARMAN",
     "q": 2,
     "r": -3,
     "hp": 10
    },
    {
     "player": 1,
     "type": "UNIT_ARCHER",
     "q": 2,
     "r": -2,
     "hp": 8
    },
    {
     "player": 1,
     "type": "UNIT_LONGBOWMAN",
     "q": 3,
     "r": -2,
     "hp": 10
    },
    {
     "player": 1,
     "type": "UNIT_PIKEMAN",
     "q": 0,
     "r": 2,
     "hp": 8
    },
    {
     "player": 1,
     "type": "UNIT_AXEMAN",
     "q": 1,
     "r": 2,
     "hp": 8
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": -2,
     "r": 3,
     "hp": 3
    }
   ]
  },
  {
   "id": "the-man-beside-him",
   "slowVerify": true,
   "difficulty": 3,
   "name": "The Man Beside Him",
   "author": "owpuzzle",
   "brief": "Destroy as much enemy strength as you can this turn.",
   "lesson": "A zealot never falls to the blow aimed at him: any strike that would kill one is cut short, leaving him standing on his last point of health. Only the spill from an attack on somebody ELSE finishes him — so the man beside him must be the one you shoot, and he must still be alive when you do.",
   "orders": 7,
   "radius": 4,
   "hero": 1,
   "tiles": [
    {
     "q": 3,
     "r": 0,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 3,
     "r": -1,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 1,
     "r": 0,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 1,
     "r": 1,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 3,
     "r": -2,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 2,
     "r": -2,
     "terrain": "TERRAIN_WATER"
    },
    {
     "q": 1,
     "r": -1,
     "terrain": "TERRAIN_WATER"
    }
   ],
   "objective": {
    "kind": "maxKill",
    "count": 170
   },
   "units": [
    {
     "player": 0,
     "type": "UNIT_CATAPHRACT",
     "q": -1,
     "r": 2
    },
    {
     "player": 0,
     "type": "UNIT_AKKADIAN_ARCHER",
     "q": -1,
     "r": 0
    },
    {
     "player": 0,
     "type": "UNIT_SWORDSMAN",
     "q": -2,
     "r": -1
    },
    {
     "player": 1,
     "type": "UNIT_SWORDSMAN",
     "q": 2,
     "r": 0,
     "hp": 8,
     "general": true,
     "promotions": [
      "EFFECTUNIT_ZEALOT"
     ],
     "name": "zealot general"
    },
    {
     "player": 1,
     "type": "UNIT_ARCHER",
     "q": 2,
     "r": -1,
     "hp": 4,
     "name": "standard-bearer"
    },
    {
     "player": 1,
     "type": "UNIT_WARRIOR",
     "q": 0,
     "r": 3,
     "hp": 6
    }
   ]
  },
  {
   "id": "the-anvil",
   "difficulty": 3,
   "name": "The Anvil",
   "author": "owpuzzle",
   "brief": "Kill all three legionaries this turn.",
   "lesson": "A commander doubles his strength when he strikes a man who is pinned from the far side — and a pinned man cannot strike back. Your militia can barely scratch a legionary, but standing them opposite turns the charge from a scratch into a kill. Each kill carries the commander forward, so the next anvil must already be in place before he arrives.",
   "orders": 6,
   "radius": 4,
   "hero": 0,
   "slowVerify": true,
   "objective": {
    "kind": "killAll"
   },
   "units": [
    {
     "player": 0,
     "type": "UNIT_HORSEMAN",
     "q": -2,
     "r": 0,
     "general": true,
     "promotions": [
      "EFFECTUNIT_COMMANDER_LEADER"
     ],
     "name": "commander"
    },
    {
     "player": 0,
     "type": "UNIT_MILITIA",
     "q": 1,
     "r": 0
    },
    {
     "player": 0,
     "type": "UNIT_MILITIA",
     "q": -2,
     "r": -2
    },
    {
     "player": 0,
     "type": "UNIT_MILITIA",
     "q": 2,
     "r": -3
    },
    {
     "player": 1,
     "type": "UNIT_LEGIONARY",
     "q": -1,
     "r": 0,
     "hp": 9
    },
    {
     "player": 1,
     "type": "UNIT_LEGIONARY",
     "q": -1,
     "r": -1,
     "hp": 9
    },
    {
     "player": 1,
     "type": "UNIT_LEGIONARY",
     "q": 0,
     "r": -2,
     "hp": 9
    }
   ]
  },
  {
   "id": "the-ground-he-wins",
   "name": "The Ground He Wins",
   "author": "owpuzzle",
   "slowVerify": true,
   "brief": "Destroy as much enemy strength as you can this turn.",
   "lesson": "A kill is also a move. A rout advance puts you where you could never walk, and a bow on a hill reaches one tile further \u2014 far enough to shoot over the line that screens it.",
   "orders": 8,
   "radius": 3,
   "objective": {
    "kind": "maxKill",
    "count": 130
   },
   "tiles": [
    {
     "q": 1,
     "r": 0,
     "height": "HEIGHT_HILL"
    },
    {
     "q": 3,
     "r": -1,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 2,
     "r": 1,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 0,
     "r": 2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": -1,
     "r": -1,
     "vegetation": "VEGETATION_TREES"
    }
   ],
   "units": [
    {
     "player": 0,
     "type": "UNIT_PALTON_CAVALRY",
     "q": -1,
     "r": 1
    },
    {
     "player": 0,
     "type": "UNIT_AXEMAN",
     "q": -1,
     "r": 0
    },
    {
     "player": 0,
     "type": "UNIT_MILITIA",
     "q": 0,
     "r": 1
    },
    {
     "player": 0,
     "type": "UNIT_SLINGER",
     "q": -2,
     "r": 1
    },
    {
     "player": 1,
     "type": "UNIT_ARCHER",
     "q": 1,
     "r": 0,
     "hp": 20
    },
    {
     "player": 1,
     "type": "UNIT_PIKEMAN",
     "q": 2,
     "r": 0
    },
    {
     "player": 1,
     "type": "UNIT_LONGBOWMAN",
     "q": 3,
     "r": 0,
     "hp": 3
    },
    {
     "player": 1,
     "type": "UNIT_SLINGER",
     "q": 0,
     "r": -2,
     "hp": 8
    }
   ],
   "difficulty": 3
  },
  {
   "id": "broken-sword",
   "name": "Broken Sword",
   "author": "owpuzzle",
   "brief": "Destroy as much enemy strength as you can this turn.",
   "lesson": "Disarm is not damage, it is a discount on every blow that follows. The shotelai strikes first, not last.",
   "orders": 9,
   "radius": 3,
   "objective": {
    "kind": "maxKill",
    "count": 120
   },
   "tiles": [
    {
     "q": 0,
     "r": -2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": -2,
     "r": 2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 2,
     "r": 0,
     "vegetation": "VEGETATION_TREES"
    }
   ],
   "units": [
    {
     "player": 0,
     "type": "UNIT_SHOTELAI",
     "q": -1,
     "r": 0
    },
    {
     "player": 0,
     "type": "UNIT_MACEMAN",
     "q": -1,
     "r": 1
    },
    {
     "player": 0,
     "type": "UNIT_MACEMAN",
     "q": 0,
     "r": -1
    },
    {
     "player": 0,
     "type": "UNIT_SLINGER",
     "q": -2,
     "r": 1
    },
    {
     "player": 1,
     "type": "UNIT_PIKEMAN",
     "q": 1,
     "r": 0,
     "hp": 20
    },
    {
     "player": 1,
     "type": "UNIT_SLINGER",
     "q": 2,
     "r": -2,
     "hp": 6
    }
   ],
   "difficulty": 3
  },
  {
   "id": "one-point-of-pride",
   "name": "One Point of Pride",
   "author": "owpuzzle",
   "brief": "Kill the zealot general this turn.",
   "lesson": "Last stand makes a zealot's final hit points two separate deaths \u2014 no single blow, however mighty, pays for both. Spend your champion where strength matters, and send the cheap blades to do the arithmetic.",
   "orders": 2,
   "radius": 3,
   "objective": {
    "kind": "killTarget",
    "target": 3
   },
   "tiles": [
    {
     "q": 1,
     "r": -2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 2,
     "r": -2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 0,
     "r": 2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 1,
     "r": 1,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 3,
     "r": -1,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 3,
     "r": -2,
     "height": "HEIGHT_MOUNTAIN"
    },
    {
     "q": 3,
     "r": 0,
     "height": "HEIGHT_MOUNTAIN"
    }
   ],
   "units": [
    {
     "player": 0,
     "type": "UNIT_CATAPHRACT",
     "q": 1,
     "r": 0
    },
    {
     "player": 0,
     "type": "UNIT_MILITIA",
     "q": 0,
     "r": 0
    },
    {
     "player": 1,
     "type": "UNIT_AXEMAN",
     "q": 1,
     "r": -1,
     "hp": 10,
     "name": "the guard"
    },
    {
     "player": 1,
     "type": "UNIT_SWORDSMAN",
     "q": 2,
     "r": -1,
     "hp": 2,
     "general": true,
     "promotions": [
      "EFFECTUNIT_ZEALOT"
     ],
     "name": "the zealot general"
    },
    {
     "player": 1,
     "type": "UNIT_ARCHER",
     "q": 2,
     "r": 0,
     "hp": 20
    }
   ],
   "difficulty": 2
  },
  // --- Promotions I: one promotion each, and in every one of them the
  // promotion is REQUIRED, not merely available. test/promo-lessons.test.js
  // strips the taught promotion from each board and asserts par becomes
  // unreachable, so none of these lessons can quietly stop being true.
  {
    "id": "the-far-bank",
    "difficulty": 2,
    "name": "The Far Bank",
    "author": "owpuzzle",
    "brief": "Destroy the spearman.",
    "lesson": "Every melee unit in the game strikes across a river at half force. Amphibious does not beat the river, it cancels the penalty.",
    "orders": 2,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 1,
        "r": 0,
        "river": [
          3
        ]
      },
      {
        "q": 1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": -1,
        "r": 0,
        "promotions": [
          "EFFECTUNIT_AMPHIBIOUS"
        ]
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": 1,
        "r": 0,
        "hp": 8
      }
    ]
  },
  {
    "id": "one-hex-further",
    "difficulty": 2,
    "name": "One Hex Further",
    "author": "owpuzzle",
    "brief": "Destroy the archer.",
    "lesson": "One extra hex of range is the difference between an enemy you cannot touch and a dead one.",
    "orders": 2,
    "radius": 3,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": 0,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 1,
        "r": 0,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 2,
        "r": 0,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 0,
        "r": -1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 1,
        "r": -1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 2,
        "r": -1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 3,
        "r": -1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 0,
        "r": 1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 1,
        "r": 1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 2,
        "r": 1,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": -1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -3,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_LONGBOWMAN",
        "q": -2,
        "r": 0,
        "promotions": [
          "EFFECTUNIT_MARKSMAN"
        ]
      },
      {
        "player": 1,
        "type": "UNIT_ARCHER",
        "q": 3,
        "r": 0,
        "hp": 3
      }
    ]
  },
  {
    "id": "the-second-blow",
    "difficulty": 2,
    "name": "The Second Blow",
    "author": "owpuzzle",
    "brief": "Destroy the axeman.",
    "lesson": "Bloodthirsty pays nothing against an unwounded enemy, so it is worth nothing to the first blow and everything to the second. The same two attacks in the other order kill a man they otherwise leave standing.",
    "orders": 3,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_SWORDSMAN",
        "q": 1,
        "r": 0,
        "promotions": [
          "EFFECTUNIT_BLOODTHIRSTY"
        ]
      },
      {
        "player": 0,
        "type": "UNIT_SPEARMAN",
        "q": -2,
        "r": 0
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": 0
      }
    ]
  },
  {
    "id": "stand-in-the-woods",
    "difficulty": 2,
    "name": "Stand in the Woods",
    "author": "owpuzzle",
    "brief": "Destroy the axeman.",
    "lesson": "Ranger measures the ground under your own feet, not the enemy's — so walking past a perfectly good attacking position to stand in the trees is the strongest move on the board.",
    "orders": 3,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 1,
        "r": -1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": -1,
        "r": -1,
        "promotions": [
          "EFFECTUNIT_RANGER"
        ]
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": 0,
        "hp": 8
      }
    ]
  },
  {
    "id": "the-crown",
    "difficulty": 2,
    "name": "The Crown",
    "author": "owpuzzle",
    "brief": "Destroy both.",
    "lesson": "Two identical axemen stop being identical the moment one of them carries the general.",
    "orders": 3,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": -1,
        "r": -1,
        "promotions": [
          "EFFECTUNIT_HECKLER"
        ]
      },
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": -1,
        "r": 1
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 1,
        "r": 0,
        "hp": 8,
        "general": true
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": 0,
        "hp": 6
      }
    ]
  },
  {
    "id": "wounded-and-meaner",
    "difficulty": 2,
    "name": "Wounded and Meaner",
    "author": "owpuzzle",
    "brief": "Destroy both.",
    "lesson": "Tough turns injury into strength, so the casualty you would instinctively spare is the one you should send.",
    "orders": 3,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": -1,
        "hp": 10,
        "promotions": [
          "EFFECTUNIT_TOUGH"
        ]
      },
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": -1,
        "r": 0
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": 2,
        "r": 0,
        "hp": 9
      },
      {
        "player": 1,
        "type": "UNIT_SPEARMAN",
        "q": -2,
        "r": 0,
        "hp": 8
      }
    ]
  },
  {
    "id": "dont-step-closer",
    "difficulty": 2,
    "name": "Don't Step Closer",
    "author": "owpuzzle",
    "brief": "Destroy both.",
    "lesson": "Every other bow loses a fifth of its strength for each hex it shoots across. Eagle Eye does not, so it is the only one worth aiming at something far away.",
    "orders": 2,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": 0,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 1,
        "r": 0,
        "terrain": "TERRAIN_WATER"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_ARCHER",
        "q": -1,
        "r": 0,
        "promotions": [
          "EFFECTUNIT_EAGLE_EYE"
        ]
      },
      {
        "player": 0,
        "type": "UNIT_ARCHER",
        "q": -2,
        "r": 0
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 2,
        "r": 0,
        "hp": 6
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": -2,
        "r": 1,
        "hp": 6
      }
    ]
  },
  {
    "id": "the-right-sword",
    "difficulty": 2,
    "name": "The Right Sword",
    "author": "owpuzzle",
    "brief": "Destroy all three.",
    "lesson": "A promotion is not extra damage, it is extra damage against someone in particular — so the question is never how hard you hit, but who you send.",
    "orders": 4,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 2,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 0,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": 0,
        "promotions": [
          "EFFECTUNIT_HORSEBANE"
        ]
      },
      {
        "player": 0,
        "type": "UNIT_MACEMAN",
        "q": 0,
        "r": -1
      },
      {
        "player": 0,
        "type": "UNIT_AXEMAN",
        "q": -1,
        "r": 0
      },
      {
        "player": 1,
        "type": "UNIT_HORSEMAN",
        "q": 2,
        "r": 0,
        "hp": 7
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 1,
        "r": -1,
        "hp": 9
      },
      {
        "player": 1,
        "type": "UNIT_ARCHER",
        "q": -1,
        "r": -1,
        "hp": 6
      }
    ]
  },
  {
    "id": "evict-him",
    "difficulty": 2,
    "name": "Evict Him",
    "author": "owpuzzle",
    "brief": "Destroy the axeman.",
    "lesson": "An elephant shoves its victim directly away from the tile you struck from, so choosing where to attack from is choosing where he lands. Arrows are half strength into trees; feet are not.",
    "orders": 4,
    "radius": 2,
    "training": 0,
    "objective": {
      "kind": "killAll"
    },
    "tiles": [
      {
        "q": 0,
        "r": 0,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 0,
        "r": -1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 1,
        "r": -1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 0,
        "r": 1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": -1,
        "r": 1,
        "vegetation": "VEGETATION_TREES"
      },
      {
        "q": 0,
        "r": -2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": -1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -2,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": -1,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 0,
        "r": 2,
        "height": "HEIGHT_MOUNTAIN"
      },
      {
        "q": 1,
        "r": 1,
        "height": "HEIGHT_MOUNTAIN"
      }
    ],
    "units": [
      {
        "player": 0,
        "type": "UNIT_WAR_ELEPHANT",
        "q": 1,
        "r": -2
      },
      {
        "player": 0,
        "type": "UNIT_ARCHER",
        "q": -2,
        "r": 0
      },
      {
        "player": 1,
        "type": "UNIT_AXEMAN",
        "q": 0,
        "r": 0,
        "hp": 14
      }
    ]
  },
];
if (typeof module !== 'undefined') module.exports = OWPUZZLES;
