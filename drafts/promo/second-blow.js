// BLOODTHIRSTY (+10% vs a DAMAGED target) — the promotion decides the ORDER of
// your blows, not which of them land.
//
// The axeman is at FULL health, which is the whole design: BLOODTHIRSTY pays
// nothing against an unwounded target, so the bonus has to be EARNED by hitting
// him with something else first.
//
//   swordsman first: 15 (unwounded) then spearman 4  = 19 — one short
//   spearman first:   4 then swordsman 16 (wounded)  = 20 — exactly dead
//
// Same two blows. Only the sequence differs. The swordsman starts already in
// contact and the spearman has to walk, so the natural impulse — swing with the
// one that is ready — is precisely the losing line.
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
      { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: -1, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: 0, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_SWORDSMAN', q: 1, r: 0, promotions: ['EFFECTUNIT_BLOODTHIRSTY'] },
      { player: 0, type: 'UNIT_SPEARMAN', q: -2, r: 0 },
      { player: 1, type: 'UNIT_AXEMAN', q: 0, r: 0 },
    ],
  },
};
