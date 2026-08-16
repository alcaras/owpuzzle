// MARKSMAN (+1 range) — a longbow reaches 3 hexes. A hill adds one more to
// anything shot from it (height iRangeChange). Neither alone is enough here:
// the axeman who fled to the island is FIVE hexes out, and only 3 + 1 + 1 gets
// there. You have to be a marksman AND you have to climb.
//
// He is on 1 hp, which is all a shot at that distance can manage anyway
// (-20% a hex, so a 10-strength bow lands 1). Water on every side of him means
// nobody is walking over to finish the job.
//
// Meanwhile the horseman has his own work: two axemen, 9 hp each, and a rout
// that carries him from the first into the second. The bow cannot help him and
// he cannot help the bow — the puzzle is that the archer's order goes on the
// climb rather than on anything that looks more useful.
module.exports = {
  teaches: 'EFFECTUNIT_MARKSMAN',
  puzzle: {
    id: 'one-hex-further',
    difficulty: 2,
    name: 'One Hex Further',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 4,
    radius: 3,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      {"q":0,"r":-3,"terrain":"TERRAIN_WATER"},
      {"q":1,"r":-3,"terrain":"TERRAIN_WATER"},
      {"q":2,"r":-3,"terrain":"TERRAIN_WATER"},
      {"q":-1,"r":-2,"terrain":"TERRAIN_WATER"},
      {"q":0,"r":-2,"terrain":"TERRAIN_WATER"},
      {"q":1,"r":-2,"terrain":"TERRAIN_WATER"},
      {"q":2,"r":-2,"terrain":"TERRAIN_WATER"},
      {"q":3,"r":-2,"terrain":"TERRAIN_WATER"},
      {"q":-1,"r":-1,"terrain":"TERRAIN_WATER"},
      {"q":0,"r":-1,"terrain":"TERRAIN_WATER"},
      {"q":1,"r":-1,"terrain":"TERRAIN_WATER"},
      {"q":2,"r":-1,"terrain":"TERRAIN_WATER"},
      {"q":3,"r":-1,"terrain":"TERRAIN_WATER"},
      {"q":-1,"r":0,"terrain":"TERRAIN_WATER"},
      {"q":0,"r":0,"terrain":"TERRAIN_WATER"},
      {"q":1,"r":0,"terrain":"TERRAIN_WATER"},
      {"q":2,"r":0,"terrain":"TERRAIN_WATER"},
      {"q":3,"r":0,"terrain":"TERRAIN_WATER"},
      {"q":-1,"r":1,"terrain":"TERRAIN_WATER"},
      {"q":0,"r":1,"terrain":"TERRAIN_WATER"},
      {"q":1,"r":1,"terrain":"TERRAIN_WATER"},
      {"q":2,"r":1,"terrain":"TERRAIN_WATER"},
      {"q":1,"r":2,"height":"HEIGHT_HILL"},
      {"q":-1,"r":3,"vegetation":"VEGETATION_TREES"},
      {"q":-3,"r":2,"vegetation":"VEGETATION_TREES","height":"HEIGHT_HILL"}
    ],
    units: [
      { player: 0, type: 'UNIT_LONGBOWMAN', q: 0, r: 2, promotions: ['EFFECTUNIT_MARKSMAN'] },
      { player: 0, type: 'UNIT_HORSEMAN', q: -3, r: 1 },
      { player: 1, type: 'UNIT_AXEMAN', q: 3, r: -3, hp: 1 },
      { player: 1, type: 'UNIT_AXEMAN', q: -2, r: 1, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: -2, r: 2, hp: 9 },
    ],
  },
};
