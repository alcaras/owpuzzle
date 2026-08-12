// Two-phase validator: DEPLOY, then FIGHT.
//
// Why the old solvers missed Aran's 19: a flat macro search has to interleave
// "walk a militia four tiles" with "attack now", and any beam ranks the walk
// last right up until the moment it pays off, 8 plies later. Branch-and-bound
// sees it but cannot reach 22 plies.
//
// Split the problem instead. Almost every line in this game has a shape:
// each unit goes somewhere once, then the army fights from where it stands.
// So enumerate DEPLOYMENTS (a tile per unit, with an admissible bound that
// throws away deployments which cannot beat the incumbent), and for each one
// run an EXACT attack-only search. The attack phase is engine-exact, so rout
// chains, flanking, counterattacks and one unit routing into the tile that
// flanks for another all fall out for free — those were the mechanics the
// hand-written planner got wrong.
//
// usage: node deployfight.js ./aran_def.js [pool] [seconds] [seedStr]
'use strict';
var path = require('path');
var E = require(path.join(__dirname, '..', 'web', 'engine.js'));
// accepts a submissions/*.json (as pulled by tools/snarf.sh) or any module
// exporting a puzzle definition
var SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node tools/deploy_fight.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]');
  process.exit(1);
}
var P = /\.json$/.test(SRC)
  ? (function () {
      var j = JSON.parse(require('fs').readFileSync(SRC, 'utf8'));
      return j.puzzle || j;
    })()
  : require(path.resolve(SRC));
var POOL = parseInt(process.argv[3], 10) || E.poolOrders(P);
var DEADLINE = Date.now() + (parseInt(process.argv[4], 10) || 600) * 1000;
var SEED = parseInt(process.argv[5], 10) || 0;
var ATTACK_CAP = parseInt(process.env.ATTACK_CAP || '14', 10);

var base = JSON.parse(JSON.stringify(P));
base.orders = POOL;
base.objective = { kind: 'maxKill', count: 999999 };
var INIT = E.loadPuzzle(base);
var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
var STR = function (u) { return E.DATA.units[u.type].iStrength; };
var BLUE = INIT.units.filter(function (u) { return u.player === 0 && u.hp > 0; });
var REDS = INIT.units.filter(function (u) { return u.player === 1 && u.hp > 0; });

function hasRout(u) { return E.effectsOf(u).indexOf('EFFECTUNIT_ROUT') >= 0; }

// ---------- candidate tiles ------------------------------------------------
// A tile is worth standing on if you can shoot something from it, or if it is
// the tile OPPOSITE some enemy — the flank seat that doubles an ally's blow.
var flankSeat = {};
REDS.forEach(function (R) {
  DIRS.forEach(function (d) { flankSeat[(R.q - d[0]) + ',' + (R.r - d[1])] = 1; });
});
function damageFrom(u, tile, R, state) {
  var st = state || INIT;
  if (E.hexDistance(tile, R) > Math.max(1, E.rangeMax(u))) return 0;
  try { return E.attackUnitDamage(st, u, tile, R) || 0; } catch (e) { return 0; }
}
// Reachability is measured on a board with the enemies LIFTED OFF. Enemy
// tiles are the ones that matter most — they get vacated by kills and routs,
// and the ground beside them is locked by zone of control until the owner
// dies. Measured on the opening board, the tile the spearman finally attacks
// from is not even reachable. The engine still charges the true cost when the
// move is actually played, so an optimistic cost here costs nothing.
var CLEAR = (function () {
  var st = E.loadPuzzle(base);
  st.units = st.units.filter(function (u) { return u.player === 0; });
  return st;
})();
var CAND = {};
BLUE.forEach(function (u) {
  var c = {};
  c[u.q + ',' + u.r] = 0;
  E.reachableTiles(CLEAR, E.unitById(CLEAR, u.id)).forEach(function (rt) {
    if (rt.orders > POOL) return;
    var k = rt.q + ',' + rt.r, useful = flankSeat[k], reach = Math.max(1, E.rangeMax(u));
    for (var i = 0; i < REDS.length && !useful; i++) {
      // in range of where an enemy stands now, or beside it — damage is judged
      // during the search, when the board is what it will actually be
      if (E.hexDistance({ q: rt.q, r: rt.r }, REDS[i]) <= reach + 1) useful = 1;
    }
    if (useful) c[k] = rt.orders;
  });
  CAND[u.id] = c;
});

// optimistic damage each unit could ever put on each red, from any candidate
// tile, assuming it gets flanked support and (if it routs) a second swing —
// deliberately generous, because the bound must never discard a real plan
var OPT = {};
BLUE.forEach(function (u) {
  OPT[u.id] = {};
  var swings = hasRout(u) ? 2 : 1;
  REDS.forEach(function (R) {
    var best = 0;
    Object.keys(CAND[u.id]).forEach(function (k) {
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      var d = damageFrom(u, tile, R);
      if (!d) return;
      // flanking is an additive percent; 2x is an over-estimate, which is safe
      best = Math.max(best, d * 2);
    });
    OPT[u.id][R.id] = best * swings;
  });
});

// ---------- one search, with the move set kept small -----------------------
// Deploy-then-fight was wrong: it fixes every unit's tile before a blow lands,
// so it cannot express "the axeman walks into the tile the horseman just
// vacated by routing" — the move Horsing Around is built on. So moves and
// attacks interleave freely here; what keeps it tractable is that a unit may
// move only ONCE (verified: attacking ends a unit's movement, and a rout grants
// another attack but no move) and only to a CANDIDATE tile — somewhere it can
// shoot from, or the flank seat beside an enemy. That is ~10 tiles per unit
// instead of every tile it can reach.
var incumbent = SEED, incLine = null, incOrders = 0;
var nodes = 0, seen = {};

function options(s, moved) {
  var out = [];
  s.units.forEach(function (u) {
    if (u.player !== 0 || u.hp <= 0) return;
    if (E.canAttack(s, u)) {
      E.attackTargets(s, u).forEach(function (t) {
        out.push({ kind: 'attack', unit: u.id, target: t.id, cost: 1 });
      });
    }
    if (!moved[u.id] && E.canMove(s, u)) {
      Object.keys(CAND[u.id]).forEach(function (k) {
        var c = CAND[u.id][k];
        if (c <= 0 || c > s.orders) return;
        var t = k.split(',');
        if (s.units.some(function (x) { return x.hp > 0 && x.q === +t[0] && x.r === +t[1]; })) return;
        out.push({ kind: 'move', unit: u.id, q: +t[0], r: +t[1], cost: c });
      });
    }
  });
  return out;
}

(function rec(s, spent, moved, line) {
  if (Date.now() > DEADLINE) return;
  nodes++;
  var str = E.strKilledOf(s);
  if (str > incumbent || (str === incumbent && incLine && spent < incOrders)) {
    incumbent = str; incOrders = spent; incLine = line.slice();
    console.log('  ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders   (node ' + nodes + ')');
  }
  // Counting orders alone is a toothless bound: early on there are always
  // enough of them. What actually rules a kill out is DAMAGE. For each living
  // red, gather every blow that could still land on it — from where each blue
  // stands, or from the best seat it can still walk to — and if those blows
  // cannot sum to its remaining HP, that red is unkillable and its strength
  // leaves the ceiling. The count of blows needed is likewise a floor on the
  // orders the kill costs. Both over-estimate, so both stay admissible.
  var cap = str, minAttacks = 0;
  var blues = s.units.filter(function (x) { return x.player === 0 && x.hp > 0; });
  s.units.forEach(function (R) {
    if (R.player !== 1 || R.hp <= 0) return;
    var blows = [];
    blues.forEach(function (b) {
      // Every seat this unit could ever swing from: where it stands, anywhere
      // it may still walk, and — because a rout advance carries it into the
      // tile it just emptied — every tile an enemy currently occupies. Leaving
      // that last set out is what made the bound throw away real lines.
      var swings = hasRout(b) ? 3 : 1, per = 0;
      per = damageFrom(b, { q: b.q, r: b.r }, R, s) * 2;
      Object.keys(CAND[b.id]).forEach(function (k) {
        var t = k.split(',');
        per = Math.max(per, damageFrom(b, { q: +t[0], r: +t[1] }, R, s) * 2);
      });
      s.units.forEach(function (v) {
        if (v.player !== 1 || v.hp <= 0 || v.id === R.id) return;
        per = Math.max(per, damageFrom(b, { q: v.q, r: v.r }, R, s) * 2);
      });
      if (per > 0) for (var i = 0; i < swings; i++) blows.push(per);
    });
    blows.sort(function (x, y) { return y - x; });
    var acc = 0, n = 0;
    while (acc < R.hp && n < blows.length) { acc += blows[n]; n++; }
    if (acc >= R.hp) { cap += STR(R); minAttacks += n; }
  });
  if (cap < incumbent) return;
  if (minAttacks > s.orders) return;

  var opts = options(s, moved);
  opts.forEach(function (o) {
    if (o.kind !== 'attack') { o.rank = -o.cost; return; }
    var tg = E.unitById(s, o.target), at = E.unitById(s, o.unit), d = 0;
    try { d = E.attackUnitDamage(s, at, { q: at.q, r: at.r }, tg); } catch (e) {}
    o.rank = (d >= tg.hp ? 1000 : 10) + d;
  });
  opts.sort(function (a, b) { return b.rank - a.rank; });

  opts.forEach(function (o) {
    if (Date.now() > DEADLINE) return;
    var ns;
    try {
      ns = o.kind === 'attack'
        ? E.applyAction(s, { type: 'attack', unit: o.unit, target: o.target })
        : E.applyAction(s, { type: 'move', unit: o.unit, q: o.q, r: o.r });
    } catch (e) { return; }
    var nm = moved;
    if (o.kind === 'move') { nm = Object.assign({}, moved); nm[o.unit] = 1; }
    // the board alone is not the state: two identical boards differ if one
    // still has units that may move, so the move rights belong in the key
    var h = ns.units.map(function (x) {
      return x.id + ':' + x.q + ',' + x.r + ':' + Math.max(0, x.hp) + ':' + (x.cooldown || 0);
    }).join(';') + '|' + Object.keys(nm).sort().join(',');
    var used = POOL - ns.orders;
    if (seen[h] !== undefined && seen[h] <= used) return;
    seen[h] = used;
    rec(ns, used, nm, line.concat([o]));
  });
})(E.loadPuzzle(base), 0, {}, []);

console.log('nodes explored: ' + nodes +
  (Date.now() > DEADLINE ? '   *** TIMED OUT (best-so-far only) ***' : '   (search complete)'));
console.log('best: ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders');
if (incLine) {
  var s2 = E.loadPuzzle(base);
  incLine.forEach(function (o, i) {
    var u = E.unitById(s2, o.unit);
    var msg = o.kind === 'move'
      ? E.nameOf(u) + ' -> (' + o.q + ',' + o.r + ')'
      : E.nameOf(u) + ' attacks ' + E.nameOf(E.unitById(s2, o.target));
    s2 = E.applyAction(s2, o.kind === 'move'
      ? { type: 'move', unit: o.unit, q: o.q, r: o.r }
      : { type: 'attack', unit: o.unit, target: o.target });
    console.log('  ' + (i + 1) + '. ' + msg + '   [' + s2.log[s2.log.length - 1] + ']');
  });
}
