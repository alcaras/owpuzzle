// PANIC (elephants) — a shove is a targeting decision, because the victim is
// pushed DIRECTLY AWAY from the tile you struck him from.
//
// Trees cost a RANGED attacker half its strength (vegetation aiDefendEffectUnit
// RANGED:50): your archer does 3 into the wood and 6 in the open. Melee does not
// care. So the axeman in the trees cannot be shot out — he has to be MOVED out,
// and there is exactly one tile he can be moved ONTO that your archer can use.
//
// Every neighbour of his wood is more wood, except the clearing at -1,0 in front
// of the archer. Pushing him there means striking from 1,0, on the far side —
// and zone of control means that side has to be chosen on the way in, not after
// you have closed. Come at him from the near side and he lands in more trees.
module.exports = {
  teaches: 'EFFECTUNIT_PANIC',
  neutraliseLabel: 'elephant swapped for a maceman (no shove)',
  neutralise: function (p) {
    p.units.forEach(function (u) { if (u.type === 'UNIT_WAR_ELEPHANT') u.type = 'UNIT_MACEMAN'; });
    return p;
  },
  puzzle: {
    id: 'evict-him',
    difficulty: 2,
    name: 'Evict Him',
    author: 'owpuzzle',
    brief: 'Destroy the axeman.',
    lesson: '',
    orders: 4,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: 0, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: -1, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: -1, r: 2, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: -2, r: 1, height: 'HEIGHT_HILL' },
      { q: 2, r: -2, height: 'HEIGHT_HILL' },
    ],
    units: [
      { player: 0, type: 'UNIT_WAR_ELEPHANT', q: 1, r: -2 },
      { player: 0, type: 'UNIT_ARCHER', q: -2, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 14 },
    ],
  },
};
