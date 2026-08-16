// HORSEBANE (+25% vs MOUNTED) — which of your soldiers swings IS the puzzle.
//
// Gate: three reds, three blows, and each red dies to exactly one attacker in
// exactly one blow. The horseman at 7 hp is the pin — only the horsebane axeman
// reaches it (7). Plain axeman 5, maceman 6.
//   * no swordsman or spearman on blue: both do 8 to a horseman unaided and
//     would make the promotion optional without anyone noticing
//   * red axeman at 9 hp so ONLY the maceman one-shots it (9); both axemen do 6
//   * the horsebane axeman starts adjacent to the red axeman — the tempting
//     target it cannot kill — and must walk away from a live enemy to do its job
//
// The arena is walled down to seven tiles so the search exhausts and the par,
// the tightness and the required-ness are all proved rather than assumed.
module.exports = {
  teaches: 'EFFECTUNIT_HORSEBANE',
  puzzle: {
    id: 'the-right-sword',
    difficulty: 2,
    name: 'The Right Sword',
    author: 'owpuzzle',
    brief: 'Destroy all three.',
    lesson: '',
    orders: 4,
    radius: 2,
    training: 0,
    objective: { kind: 'killAll' },
    tiles: [
      { q: 0, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: -2, height: 'HEIGHT_MOUNTAIN' },
      { q: 2, r: -2, height: 'HEIGHT_MOUNTAIN' }, { q: 2, r: -1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 0, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 1, height: 'HEIGHT_MOUNTAIN' }, { q: 1, r: 1, height: 'HEIGHT_MOUNTAIN' },
      { q: -2, r: 2, height: 'HEIGHT_MOUNTAIN' }, { q: -1, r: 2, height: 'HEIGHT_MOUNTAIN' },
      { q: 0, r: 2, height: 'HEIGHT_MOUNTAIN' },
    ],
    units: [
      { player: 0, type: 'UNIT_AXEMAN', q: 0, r: 0, promotions: ['EFFECTUNIT_HORSEBANE'] },
      { player: 0, type: 'UNIT_MACEMAN', q: 0, r: -1 },
      { player: 0, type: 'UNIT_AXEMAN', q: -1, r: 0 },
      { player: 1, type: 'UNIT_HORSEMAN', q: 2, r: 0, hp: 7 },
      { player: 1, type: 'UNIT_AXEMAN', q: 1, r: -1, hp: 9 },
      { player: 1, type: 'UNIT_ARCHER', q: -1, r: -1, hp: 6 },
    ],
  },
};
