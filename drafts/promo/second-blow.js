// BLOODTHIRSTY (+10% vs a DAMAGED target) — the promotion decides the ORDER of
// your blows, not which of them land.
//
// The axeman is at FULL health, which is the whole design: bloodthirsty pays
// nothing against an unwounded man, so the bonus has to be EARNED by hitting
// him with something else first.
//
//   swordsman first: 15 (unwounded) then spearman 4  = 19 — one short
//   spearman first:   4 then swordsman 16 (wounded)  = 20 — exactly dead
//
// Same two blows; only the sequence differs. The swordsman starts in contact
// and the spearman has to walk, so the natural impulse — swing with the man who
// is ready — is precisely the losing line.
//
// Open ground. Neither side can rout (no mounted units, and the axeman is
// infantry), so exactly two blows exist however many orders are spent, and the
// board needs no walls to hold its shape.
module.exports = {
  teaches: 'EFFECTUNIT_BLOODTHIRSTY',
  puzzle: {
    id: 'the-second-blow',
    difficulty: 2,
    name: 'The Second Blow',
    author: 'owpuzzle',
    brief: 'Destroy the axeman.',
    lesson: '',
    orders: 3,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: -1, r: -1, vegetation: 'VEGETATION_TREES' },
      { q: 1, r: 1, vegetation: 'VEGETATION_TREES' },
      { q: 2, r: -1, height: 'HEIGHT_HILL' },
      { q: 2, r: -2, height: 'HEIGHT_HILL' },
      { q: -2, r: 2, vegetation: 'VEGETATION_TREES' },
    ],
    units: [
      { player: 0, type: 'UNIT_SWORDSMAN', q: 1, r: 0, promotions: ['EFFECTUNIT_BLOODTHIRSTY'] },
      { player: 0, type: 'UNIT_SPEARMAN', q: -2, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0 },
    ],
  },
};
