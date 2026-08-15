// DRAFT 3: "Counterbattery" — the siege-train puzzle.
//
// Measured, not assumed (engine probes, 2026-08-14):
//   onager    range 2-4, CANNOT hit an adjacent enemy (iRangeMin 2,
//             Unit.cs:8493). 8 to the target + 2 splash to every enemy
//             adjacent to it. Moving re-limbers it, so it never moves.
//   elephant  turreted: 8 vs a spearman, 10 beside another elephant
//             (COMMANDER +20% adjacent-same), 12/14 vs light infantry.
//             ROUT + PANIC (survivor shoved straight back).
//   spearman  ROUT-IMMUNE — corks the lane; must die to something else.
//   ballista  range 1, 12 vs infantry, pierce 6 to the two tiles behind.
//   slinger   3 at range 2, 4 adjacent.
//
// THE JAM: the western onager has a red spearman standing on top of it and
// every other red is beyond range 4 — so it has NO legal shot at all. An
// elephant hitting the spearman shoves it one tile (PANIC), to exactly the
// distance the onager needs. You clear your own firing lane by shoving the
// enemy into it.
//
// THE CORK: that same spearman is rout-immune, so no elephant can chain
// through it. It has to be killed by the artillery + a slinger's chip.
//
// THE RESERVE: the elephant that shoves is spent. The rout east has to be
// run by a different one — and its first kill needs 14, which it only has
// while standing beside a third elephant (COMMANDER).
module.exports = {
  id: 'counterbattery',
  name: 'Counterbattery',
  brief: 'Silence the enemy battery. Your onagers are unlimbered — moving one packs it away.',
  lesson: 'Artillery cannot hit what stands on top of it. Sometimes you clear a firing lane by shoving the enemy into it.',
  orders: 12,
  training: 0,
  radius: 4,
  objective: { kind: 'killAll' },
  tiles: [
    // mountain wall: one lane east along r = 0
    { q: 0, r: -1, height: 'HEIGHT_MOUNTAIN' },
    { q: 1, r: -1, height: 'HEIGHT_MOUNTAIN' },
    { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
    { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' },
    { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
    { q: 2, r: 1, height: 'HEIGHT_MOUNTAIN' },
  ],
  units: [
    // --- blue, west
    { player: 0, type: 'UNIT_ONAGER', q: -4, r: 0, unlimbered: true },   // jammed: nothing in range
    { player: 0, type: 'UNIT_SLINGER', q: -4, r: 1 },
    { player: 0, type: 'UNIT_BALLISTA', q: -4, r: 2 },
    { player: 0, type: 'UNIT_TURRETED_ELEPHANT', q: -3, r: -1, promotions: ['EFFECTUNIT_COMMANDER'] },
    { player: 0, type: 'UNIT_TURRETED_ELEPHANT', q: -2, r: -1, promotions: ['EFFECTUNIT_COMMANDER'] },
    { player: 0, type: 'UNIT_TURRETED_ELEPHANT', q: -3, r: 1, promotions: ['EFFECTUNIT_COMMANDER'] },
    // --- red
    { player: 1, type: 'UNIT_SPEARMAN', q: -3, r: 0, hp: 20 },   // jams the onager AND corks the lane
    { player: 1, type: 'UNIT_ARCHER', q: 3, r: 0, hp: 14 },
    { player: 1, type: 'UNIT_ARCHER', q: 4, r: 0, hp: 12 },
    { player: 1, type: 'UNIT_ONAGER', q: 4, r: -1, hp: 12, unlimbered: true },
  ],
};
