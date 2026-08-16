// PANIC (elephants) — a shove is a targeting decision, because the target is
// pushed DIRECTLY AWAY from wherever you struck it.
//
// Trees cost a RANGED attacker 50% (vegetation aiDefendEffectUnit RANGED:50):
// the archer does 3 into the wood and 6 in the open. Melee ignores it entirely.
// So the axeman in the trees cannot be shot out — it has to be MOVED out.
//
// Numbers: red at 14 hp, elephant hits for 9 and leaves 5.
//   * 5 hp survives an archer's 3 (in trees) and dies to its 6 (in the open)
//   * one archer only, so "shove it into the next wood and shoot twice" is not
//     available — the direction has to be right the first time
//   * the elephant starts IN the trees at 1,-1, already adjacent: striking from
//     there pushes the axeman to -1,1, another tree tile. One step to 1,0 first
//     pushes it to -1,0, open ground, in front of the archer.
//
// The probe swaps the elephant for a maceman, which does the SAME 9 damage and
// cannot push — so it isolates the shove rather than the muscle.
module.exports = {
  teaches: 'EFFECTUNIT_PANIC',
  neutraliseLabel: 'elephant swapped for a maceman (same 9 damage, no shove)',
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
      { q: 1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: -1, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_WAR_ELEPHANT', q: 1, r: -2 },
      { player: 0, type: 'UNIT_ARCHER', q: -2, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0, hp: 14 },
    ],
  },
};
