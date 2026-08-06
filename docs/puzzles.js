// Puzzle library. Each puzzle is one player turn; goal = objective within the
// order budget. Solutions are verified by solver.js (tools/verify_puzzles.js).
var OWPUZZLES = [
  {
    id: 'overrun-basics',
    difficulty: 1,
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
    difficulty: 2,
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
    difficulty: 1,
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
    difficulty: 1,
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
    difficulty: 1,
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
    difficulty: 2,
    name: 'The Pincer',
    author: 'owpuzzle',
    brief: 'Your horseman carries the ★ Saddleborn promotion (+25% when flanking). Kill the warrior with only 2 orders.',
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
    brief: 'Kill all three enemies. Your axeman has 2 orders.',
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
    id: 'the-low-road',
    difficulty: 1,
    name: 'The Low Road',
    author: 'owpuzzle',
    brief: 'Kill the wounded archer with 3 orders. The hills are shorter — but are they faster?',
    lesson: 'Count moves, not tiles: every hill costs a full move to climb, while flat road tiles are cheap. The long way around is two moves; the short way over the hills is three.',
    orders: 3,
    radius: 3,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -1, r: 0, height: 'HEIGHT_HILL' },
      { q: 0, r: 0, height: 'HEIGHT_HILL' },
      { q: 1, r: 0, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, road: true },
      { q: -1, r: 1, road: true },
      { q: 0, r: 1, road: true },
      { q: 1, r: 1, road: true },
    ],
    units: [
      { player: 0, type: 'UNIT_WARRIOR', q: -2, r: 0 },
      { player: 1, type: 'UNIT_ARCHER', q: 2, r: 0, hp: 4 },
    ],
  },
  {
    id: 'over-the-hills',
    difficulty: 2,
    name: 'Over the Hills',
    author: 'owpuzzle',
    brief: 'The archer is four hills away and there is no way around. 6 orders, 100 training.',
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
  {
    id: 'parthian-tactics',
    difficulty: 2,
    name: 'Parthian Tactics',
    author: 'owpuzzle',
    brief: 'Kill all three enemies. Your palton cavalry has 3 orders.',
    lesson: 'Palton cavalry shoot at point blank AND rout: a ranged kill still overruns forward — and ranged attackers never take counterattacks. A rout chain with zero blood on your side.',
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
    id: 'one-bolt',
    difficulty: 1,
    name: 'One Bolt, Three Bodies',
    author: 'owpuzzle',
    brief: 'Kill all three warriors. Your ballista has 2 orders.',
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
    brief: 'Your onager is set up and loaded. Kill all three enemies with ONE shot.',
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
    id: 'butchers-work',
    difficulty: 1,
    name: "Butcher's Work",
    author: 'owpuzzle',
    brief: 'Kill all three enemies. Your swordsman has 2 orders.',
    lesson: 'Swordsmen strike infantry at +50% and CLEAVE both flanks of the swing at HALF damage. Against a packed line, one cut is a massacre.',
    orders: 2,
    radius: 3,
    objective: { kind: 'killAll' },
    units: [
      { player: 0, type: 'UNIT_SWORDSMAN', q: -1, r: -1 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 18 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: -1, hp: 9 },
      { player: 1, type: 'UNIT_WARRIOR', q: 0, r: 1, hp: 9 },
    ],
  },
  {
    id: 'ships-of-the-desert',
    difficulty: 2,
    name: 'Ships of the Desert',
    author: 'owpuzzle',
    brief: 'Kill the horseman. Your camel archer has 2 orders.',
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
    brief: 'The war chariot blocking the pass is too tough to break. Kill the horseman behind it. 3 orders.',
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
    brief: 'Kill both warriors with 3 orders. The gap in their line will stop your rout... unless something fills it.',
    lesson: 'Combine your beasts: the elephant PANICS a survivor back one tile — right into your rout lane. Kill, overrun, kill again.',
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
    brief: 'Kill both enemies with 3 orders. The spearman blunts cavalry — but not axes.',
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
    brief: 'Kill both warriors. Your crossbowman has 2 orders.',
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
    brief: 'The wounded general hides behind his escort — no attack can target him directly. Kill him AND the archer. 2 orders.',
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
    id: 'narrow-bridge',
    difficulty: 3,
    name: 'The Narrow Bridge',
    author: 'owpuzzle',
    brief: 'Kill both warriors. Your swordsman cannot pass while your own horseman blocks the bridge. 4 orders.',
    lesson: 'Tile economy: a rout ADVANCE vacates the attacker\'s own tile. Send the horseman crashing sideways so the swordsman can pour through the gap he leaves.',
    orders: 4,
    radius: 3,
    objective: { kind: 'killList', targets: [2, 3] },
    tiles: [
      { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 3, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: -3, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -3, height: 'HEIGHT_MOUNTAIN' },
      { q: -3, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: 1, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: -1, r: 0 },
      { player: 0, type: 'UNIT_SWORDSMAN', q: -3, r: 0 },
      { player: 1, type: 'UNIT_WARRIOR', q: -1, r: -1, hp: 12 },
      { player: 1, type: 'UNIT_WARRIOR', q: 1, r: 0, hp: 15 },
      { player: 1, type: 'UNIT_ARCHER', q: -1, r: -2, name: 'fleeing skirmisher' },
    ],
  },
  {
    id: 'the-zealot',
    difficulty: 3,
    name: 'The Zealot',
    author: 'owpuzzle',
    brief: 'The champion refuses to die. Kill all three — and mind the order of your blows. 3 orders.',
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
    brief: 'The archer in the fort shrugs off everything you throw. Kill it. 4 orders.',
    lesson: 'You cannot out-damage the fort — so take the fort away. The assault elephant strikes at +50% against forts and PANICS the survivor out onto open ground, where cavalry does the rest.',
    orders: 4,
    radius: 3,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 1, r: 0, improvement: 'IMPROVEMENT_FORT' },
    ],
    units: [
      { player: 0, type: 'UNIT_ASSAULT_ELEPHANT', q: -1, r: 0 },
      { player: 0, type: 'UNIT_HORSEMAN', q: -1, r: 1 },
      { player: 1, type: 'UNIT_ARCHER', q: 1, r: 0, hp: 16 },
    ],
  },
  {
    id: 'the-wrong-hill',
    difficulty: 3,
    name: 'The Wrong Hill',
    author: 'community: fluffybunny',
    brief: 'Your HIGHLANDER archer is not the one on the hill — and the enemy is watching. Kill the wounded archer. 2 orders.',
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
];
if (typeof module !== 'undefined') module.exports = OWPUZZLES;
