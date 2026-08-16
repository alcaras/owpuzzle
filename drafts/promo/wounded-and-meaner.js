// TOUGH (+10% to its OWN strength while damaged) — a promotion that is switched
// OFF at the start of the puzzle and has to be earned.
//
// Your horseman rides in at full health, so TOUGH gives him nothing: 9 damage,
// same as anyone. The axeman he is already touching is on 10.
//
// BOTH men you can reach from where you start are on 10, so both of them shrug
// off your opening blow — no kill, no rout, turn over. The only 9 hp man is
// round the far side of them.
//
//   ride to him, kill him, and his counterattack costs you a single hit point.
//   That one point is the whole puzzle: you are damaged now, TOUGH is live, and
//   every blow after it is 10 — exactly enough. The rout from that kill carries
//   you into the first tough man, and the rout from HIM into the second.
//
// You have to be bloodied before you can break them, so the wound is not the
// cost of the plan. It IS the plan.
module.exports = {
  teaches: 'EFFECTUNIT_TOUGH',
  puzzle: {
    id: 'wounded-and-meaner',
    difficulty: 2,
    name: 'Wounded and Meaner',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 4,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -2, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: -1, r: 2, vegetation: 'VEGETATION_TREES', height: 'HEIGHT_HILL' },
      { q: 0, r: -2, height: 'HEIGHT_HILL' },
      { q: -2, r: 0, height: 'HEIGHT_HILL' },
      { q: -1, r: -1, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_HORSEMAN', q: 1, r: -2, promotions: ['EFFECTUNIT_TOUGH'] },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: -1, hp: 10 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: 0, hp: 9 },
      { player: 1, type: 'UNIT_AXEMAN', q: 2, r: -2, hp: 10 },
    ],
  },
};
