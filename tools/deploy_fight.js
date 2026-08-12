// Ceiling finder / verifier for a puzzle: how much strength can be destroyed,
// and in how few orders.
//
// usage: node tools/deploy_fight.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]
//        LATE=n  cap on mid-fight moves (default: iterative deepening 0,1,2,3)
//
// The search is engine-exact — every position comes from the real engine, so
// flanking, rout chains, counterattacks and terrain are whatever the game says
// they are. Three ideas keep it tractable:
//
// 1. SEATS. A unit only ever wants to stand where it can shoot something, or
//    beside an enemy (the flank seat that doubles an ally's blow). Everything
//    else is walking. Seats are computed with the enemies LIFTED OFF the board,
//    because the tiles that matter most are the ones enemies are standing on —
//    they get vacated by kills and routs, and the ground beside them is locked
//    by zone of control until the owner dies.
//
// 2. SETUP vs MID-FIGHT MOVES. Most lines are "everyone walks somewhere, then
//    the army fights". A few need a unit to move once blood is drawn — into a
//    tile an ally vacated by routing, or ground that opened when a gatekeeper
//    died. So moves after the first attack are rationed, and we deepen on that
//    ration: LATE=0 first (cheap, and enough for most boards), then 1, 2, 3.
//    Without the ration, mid-fight moves multiply the tree at every node and
//    the search never finishes; with it, the common case stays fast and the
//    rare case is still reachable.
//
// 3. A DAMAGE BOUND. Counting orders is toothless early in a turn — there are
//    always enough. What rules a kill out is damage: gather every blow that
//    could still land on a red, and if they cannot sum to its HP, it will
//    never die and its strength leaves the ceiling. The blow set has to
//    include the tiles a routing unit advances into, or the bound throws away
//    real lines.
'use strict';
var path = require('path');
var E = require(path.join(__dirname, '..', 'web', 'engine.js'));

var SRC = process.argv[2];
if (!SRC) {
  console.error('usage: node tools/deploy_fight.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]');
  process.exit(1);
}
var P = /\.json$/.test(SRC)
  ? (function () { var j = JSON.parse(require('fs').readFileSync(SRC, 'utf8')); return j.puzzle || j; })()
  : require(path.resolve(SRC));

var base = JSON.parse(JSON.stringify(P));
var POOL = parseInt(process.argv[3], 10) || E.poolOrders(P);
base.orders = POOL;
base.objective = { kind: 'maxKill', count: 999999 };
var DEADLINE = Date.now() + (parseInt(process.argv[4], 10) || 600) * 1000;
var SEED = parseInt(process.argv[5], 10) || 0;
var LATE_ARG = process.env.LATE !== undefined ? parseInt(process.env.LATE, 10) : null;

var INIT = E.loadPuzzle(base);
var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
var STR = function (u) { return E.DATA.units[u.type].iStrength; };
var BLUE = INIT.units.filter(function (u) { return u.player === 0 && u.hp > 0; });
var REDS = INIT.units.filter(function (u) { return u.player === 1 && u.hp > 0; });
function hasRout(u) { return E.effectsOf(u).indexOf('EFFECTUNIT_ROUT') >= 0; }
function damageFrom(u, tile, R, s) {
  if (E.hexDistance(tile, R) > Math.max(1, E.rangeMax(u))) return 0;
  try { return E.attackUnitDamage(s || INIT, u, tile, R) || 0; } catch (e) { return 0; }
}

// ---------- seats ----------------------------------------------------------
var adjacentToRed = {};
REDS.forEach(function (R) {
  DIRS.forEach(function (d) { adjacentToRed[(R.q + d[0]) + ',' + (R.r + d[1])] = 1; });
});
var CLEARED = (function () {
  var st = E.loadPuzzle(base);
  st.units = st.units.filter(function (u) { return u.player === 0; });
  return st;
})();
var SEAT = {};
BLUE.forEach(function (u) {
  var c = {};
  c[u.q + ',' + u.r] = 0;
  E.reachableTiles(CLEARED, E.unitById(CLEARED, u.id)).forEach(function (rt) {
    if (rt.orders > POOL) return;
    var k = rt.q + ',' + rt.r;
    // somewhere it can shoot from, or a flank seat beside an enemy. A tile
    // that is merely *near* an enemy is just walking.
    var useful = !!adjacentToRed[k];
    for (var i = 0; i < REDS.length && !useful; i++) {
      if (damageFrom(u, { q: rt.q, r: rt.r }, REDS[i])) useful = true;
    }
    if (useful) c[k] = rt.orders;
  });
  SEAT[u.id] = c;
});
// TOPK: keep only each unit's most useful seats. A seat earns its place by
// what it can hit, or by the blow it lets an ALLY land from the tile opposite
// (the flank seat) — the second half matters, because the seat that wins
// Aran's board is a chariot standing next to an axeman doing 3 damage, purely
// so the commander opposite swings at double. Ranking on damage alone drops it.
// This is a heuristic: with TOPK set the search is a finder, not a proof.
var TOPK = process.env.TOPK ? parseInt(process.env.TOPK, 10) : 0;
if (TOPK) {
  // Score every unit against the FULL seat sets, then truncate them all at
  // once. Truncating inside the loop makes the filter order-dependent: a
  // later unit's flank seat scores zero because the ally whose blow it would
  // double has already had that very seat filtered away.
  var scoreOf = {};
  BLUE.forEach(function (u) {
    scoreOf[u.id] = Object.keys(SEAT[u.id]).map(function (k) {
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      var own = 0, ally = 0;
      REDS.forEach(function (R) {
        own = Math.max(own, damageFrom(u, tile, R));
        if (E.hexDistance(tile, R) !== 1) return;
        var opp = { q: 2 * R.q - tile.q, r: 2 * R.r - tile.r };
        BLUE.forEach(function (v) {
          if (v.id === u.id) return;
          if (!SEAT[v.id].hasOwnProperty(opp.q + ',' + opp.r)) return;
          ally = Math.max(ally, damageFrom(v, opp, R) * 2);
        });
      });
      return { k: k, score: own + ally, orders: SEAT[u.id][k] };
    }).sort(function (a, b) { return b.score - a.score || a.orders - b.orders; });
  });
  BLUE.forEach(function (u) {
    var keep = {};
    keep[u.q + ',' + u.r] = 0;                       // standing still is always allowed
    scoreOf[u.id].slice(0, TOPK).forEach(function (x) { keep[x.k] = SEAT[u.id][x.k]; });
    SEAT[u.id] = keep;
  });
}

// PROBE='[["militia",0,"1,2"],...]' — does a known line's seat survive the filters?
if (process.env.PROBE) {
  JSON.parse(process.env.PROBE).forEach(function (pr) {
    var us = BLUE.filter(function (x) { return x.type === 'UNIT_' + pr[0].toUpperCase(); });
    var u = us[pr[1]];
    console.log('  probe ' + pr[0] + '#' + pr[1] + ' seat ' + pr[2] + ': ' +
      (u && SEAT[u.id].hasOwnProperty(pr[2]) ? 'kept' : 'MISSING'));
  });
}
var seatSpace = 1;
BLUE.forEach(function (u) {
  var n = Object.keys(SEAT[u.id]).length;
  seatSpace *= n;
  console.log('  ' + u.type.replace('UNIT_', '').toLowerCase() + ': ' + n + ' seats');
});
console.log('  seat combinations: ' + seatSpace.toExponential(2) +
  (TOPK ? '   (TOPK=' + TOPK + ' — finder mode, not a proof)' : ''));

// ---------- bound ----------------------------------------------------------
// The seat half of the bound never changes: the best blow unit b could ever
// land on red R from any seat, or from any tile a rout might carry it into.
// Computing that per node was costing ~450 damage evaluations a node; it is
// the same number every time, so compute it once. Doubling covers flanking
// (an additive percent, so never worse than 2x here) and keeps it an
// over-estimate, which is what an admissible bound needs.
var STATIC_BLOW = {};
BLUE.forEach(function (b) {
  STATIC_BLOW[b.id] = {};
  REDS.forEach(function (R) {
    var per = 0;
    Object.keys(SEAT[b.id]).forEach(function (k) {
      var t = k.split(',');
      per = Math.max(per, damageFrom(b, { q: +t[0], r: +t[1] }, R));
    });
    REDS.forEach(function (v) {
      if (v.id === R.id) return;
      per = Math.max(per, damageFrom(b, { q: v.q, r: v.r }, R));
    });
    STATIC_BLOW[b.id][R.id] = per * 2;
  });
});

function ceilingFrom(s, orders) {
  if (orders == null) orders = s.orders;
  var cap = E.strKilledOf(s), minAttacks = 0, killable = [];
  var blues = s.units.filter(function (x) { return x.player === 0 && x.hp > 0; });
  s.units.forEach(function (R) {
    if (R.player !== 1 || R.hp <= 0) return;
    var blows = [];
    blues.forEach(function (b) {
      var swings = hasRout(b) ? 3 : 1;
      var per = Math.max(STATIC_BLOW[b.id][R.id],
                         damageFrom(b, { q: b.q, r: b.r }, R, s) * 2);
      if (per > 0) for (var i = 0; i < swings; i++) blows.push(per);
    });
    blows.sort(function (x, y) { return y - x; });
    var acc = 0, n = 0;
    while (acc < R.hp && n < blows.length) { acc += blows[n]; n++; }
    if (acc >= R.hp) killable.push({ str: STR(R), attacks: Math.max(1, n) });
  });
  // How much of that is actually affordable? Requiring EVERY killable red to
  // fit the remaining orders was wrong — a board with five reds and ten orders
  // would prune its entire tree, which is exactly how Shore Riders' real 19
  // STR line went missing. Take the cheapest kills to count how many fit, then
  // credit the largest strengths: an over-estimate, so still admissible.
  killable.sort(function (a, b) { return a.attacks - b.attacks; });
  var budget = orders, fits = 0;
  for (var i = 0; i < killable.length; i++) {
    if (killable[i].attacks > budget) break;
    budget -= killable[i].attacks; fits++;
  }
  var byStr = killable.map(function (k) { return k.str; }).sort(function (a, b) { return b - a; });
  for (var j = 0; j < fits; j++) cap += byStr[j];
  return { cap: cap, minAttacks: 0 };
}

// ---------- search ---------------------------------------------------------
var incumbent = SEED, incLine = null, incOrders = 0, nodes = 0;

function search(lateLimit) {
  var seen = {}, complete = true;
  (function rec(s, moved, lateUsed, fought, line) {
    if (Date.now() > DEADLINE) { complete = false; return; }
    nodes++;
    var str = E.strKilledOf(s);
    if (str > incumbent || (str === incumbent && incLine && line.length && POOL - s.orders < incOrders)) {
      incumbent = str; incOrders = POOL - s.orders; incLine = line.slice();
      console.log('  ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders   (node ' + nodes + ')');
    }
    var b = ceilingFrom(s);
    if (b.cap < incumbent) return;
    if (b.minAttacks > s.orders) return;

    var attacks = [], moves = [];
    s.units.forEach(function (u) {
      if (u.player !== 0 || u.hp <= 0) return;
      if (E.canAttack(s, u)) {
        E.attackTargets(s, u).forEach(function (t) {
          var d = 0;
          try { d = E.attackUnitDamage(s, u, { q: u.q, r: u.r }, t); } catch (e) {}
          attacks.push({ unit: u.id, target: t.id, rank: (d >= t.hp ? 1000 : 0) + d });
        });
      }
      if (moved[u.id] || (fought && lateUsed >= lateLimit) || !E.canMove(s, u)) return;
      // one reachability sweep per unit, not one trial move per destination
      E.reachableTiles(s, u).forEach(function (rt) {
        var k = rt.q + ',' + rt.r;
        if (!SEAT[u.id].hasOwnProperty(k) || rt.orders > s.orders) return;
        var punch = 0;
        s.units.forEach(function (R) {
          if (R.player === 1 && R.hp > 0) punch = Math.max(punch, damageFrom(u, { q: rt.q, r: rt.r }, R, s));
        });
        moves.push({ unit: u.id, q: rt.q, r: rt.r, rank: punch * 4 - rt.orders });
      });
    });
    attacks.sort(function (a, c) { return c.rank - a.rank; });
    moves.sort(function (a, c) { return c.rank - a.rank; });
    // before the first blow, take up positions; after it, swing
    var opts = fought ? attacks.concat(moves) : moves.concat(attacks);

    opts.forEach(function (o) {
      if (Date.now() > DEADLINE) { complete = false; return; }
      var isMove = o.target === undefined, ns;
      try {
        ns = isMove ? E.applyAction(s, { type: 'move', unit: o.unit, q: o.q, r: o.r })
                    : E.applyAction(s, { type: 'attack', unit: o.unit, target: o.target });
      } catch (e) { return; }
      var nm = moved, nl = lateUsed;
      if (isMove) {
        nm = Object.assign({}, moved); nm[o.unit] = 1;
        if (fought) nl = lateUsed + 1;
      }
      var h = ns.units.map(function (x) {
        return x.id + ':' + x.q + ',' + x.r + ':' + Math.max(0, x.hp) + ':' + (x.cooldown || 0);
      }).join(';') + '|' + Object.keys(nm).sort().join(',') + '|' + nl;
      var used = POOL - ns.orders;
      if (seen[h] !== undefined && seen[h] <= used) return;
      seen[h] = used;
      rec(ns, nm, nl, fought || !isMove, line.concat([o]));
    });
  })(E.loadPuzzle(base), {}, 0, false, []);
  return complete;
}

// ---------- MODE=deploy: best-first over whole deployments ------------------
// Depth-first over move options enumerates deployments lexicographically — it
// varies the LAST unit's seat fastest, so reaching a particular combination of
// six seats means exhausting everything below it first. For a board whose
// answer needs all six units in the right place at once, that never arrives.
// Best-first fixes the order of arrival: score every seat, start from the
// combination of everyone's best, and expand outward, so strong combinations
// are tried early whatever unit they disagree on.
if (process.env.MODE === 'deploy') {
  var LAMBDA = process.env.LAMBDA ? parseFloat(process.env.LAMBDA) : 4;
  var lists = BLUE.map(function (u) {
    return Object.keys(SEAT[u.id]).map(function (k) {
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      var own = 0, ally = 0;
      REDS.forEach(function (R) {
        own = Math.max(own, damageFrom(u, tile, R));
        if (E.hexDistance(tile, R) !== 1) return;
        var opp = { q: 2 * R.q - tile.q, r: 2 * R.r - tile.r };
        BLUE.forEach(function (v) {
          if (v.id === u.id) return;
          if (!SEAT[v.id].hasOwnProperty(opp.q + ',' + opp.r)) return;
          ally = Math.max(ally, damageFrom(v, opp, R) * 2);
        });
      });
      var orders = SEAT[u.id][k];
      // Rank on value NET OF WHAT IT COSTS TO GET THERE. Ranking on raw value
      // fills the queue with six-unit deployments that each want the far side
      // of the board and together cost more orders than the pool holds, so
      // almost every candidate popped is unplayable before it is examined.
      return { id: u.id, q: tile.q, r: tile.r, orders: orders,
               score: own + ally, key: own + ally - LAMBDA * orders };
    }).sort(function (a, b) { return b.key - a.key || a.orders - b.orders; });
  });

  function fightOut(st) {                       // exact attack-only search
    var best = E.strKilledOf(st), bestOrders = POOL - st.orders, bestLine = null, seen = {};
    (function rec(s, line) {
      if (Date.now() > DEADLINE) return;
      var str = E.strKilledOf(s), used = POOL - s.orders;
      if (str > best || (str === best && bestLine && used < bestOrders)) {
        best = str; bestOrders = used; bestLine = line.slice();
      }
      var b = ceilingFrom(s);
      if (b.cap < Math.max(best, incumbent)) return;
      if (b.minAttacks > s.orders) return;
      var opts = [];
      s.units.forEach(function (u) {
        if (u.player !== 0 || u.hp <= 0 || !E.canAttack(s, u)) return;
        E.attackTargets(s, u).forEach(function (t) {
          var d = 0;
          try { d = E.attackUnitDamage(s, u, { q: u.q, r: u.r }, t); } catch (e) {}
          opts.push({ unit: u.id, target: t.id, rank: (d >= t.hp ? 1000 : 0) + d });
        });
      });
      opts.sort(function (a, c) { return c.rank - a.rank; });
      opts.forEach(function (o) {
        var ns; try { ns = E.applyAction(s, { type: 'attack', unit: o.unit, target: o.target }); } catch (e) { return; }
        var h = ns.units.map(function (x) {
          return x.id + ':' + x.q + ',' + x.r + ':' + Math.max(0, x.hp) + ':' + (x.cooldown || 0);
        }).join(';');
        var uu = POOL - ns.orders;
        if (seen[h] !== undefined && seen[h] <= uu) return;
        seen[h] = uu;
        rec(ns, line.concat([o]));
      });
    })(st, []);
    return { str: best, orders: bestOrders, line: bestLine };
  }

  var heap = [], hseen = {};
  function vkey(v) { return v.join(','); }
  function vscore(v) { return v.reduce(function (a, x, i) { return a + lists[i][x].key; }, 0); }
  function push(v) {
    var k = vkey(v);
    if (hseen[k]) return;
    hseen[k] = 1;
    heap.push({ v: v, s: vscore(v) });
    var i = heap.length - 1;
    while (i > 0) {
      var par = (i - 1) >> 1;
      if (heap[par].s >= heap[i].s) break;
      var t = heap[par]; heap[par] = heap[i]; heap[i] = t; i = par;
    }
  }
  function pop() {
    var top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      var i = 0;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < heap.length && heap[l].s > heap[m].s) m = l;
        if (r < heap.length && heap[r].s > heap[m].s) m = r;
        if (m === i) break;
        var t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
      }
    }
    return top;
  }
  push(BLUE.map(function () { return 0; }));
  var tried = 0, illegal = 0;
  while (heap.length && Date.now() < DEADLINE) {
    var node = pop(), v = node.v;
    for (var i = 0; i < v.length; i++) {
      if (v[i] + 1 < lists[i].length) { var w = v.slice(); w[i]++; push(w); }
    }
    // Reject on arithmetic before touching the engine: two units cannot share
    // a tile, and a deployment costing more than the pool can never be played.
    // Nearly every candidate dies on one of these, and finding that out by
    // trying the move was costing 500x what it should.
    var seats = [], cost = 0, tiles = {}, ok = true;
    for (var i = 0; i < v.length; i++) {
      var seat = lists[i][v[i]];
      seats.push(seat);
      cost += seat.orders;
      var tk = seat.q + ',' + seat.r;
      if (tiles[tk]) { ok = false; break; }
      tiles[tk] = 1;
    }
    if (!ok || cost > POOL) { illegal++; continue; }
    // walk them in, cheapest first, retrying the ones an ally was standing in
    var st = E.loadPuzzle(base);
    var todo = seats.filter(function (x) { return x.orders > 0; })
      .sort(function (a, b) { return a.orders - b.orders; });
    for (var pass = 0; pass < 3 && todo.length; pass++) {
      var again = [];
      todo.forEach(function (x) {
        try { st = E.applyAction(st, { type: 'move', unit: x.id, q: x.q, r: x.r }); }
        catch (e) { again.push(x); }
      });
      todo = again;
    }
    if (todo.length) { illegal++; continue; }
    tried++;
    var r = fightOut(st);
    if (r.str > incumbent || (r.str === incumbent && incLine && r.orders < incOrders)) {
      incumbent = r.str; incOrders = r.orders;
      incLine = seats.filter(function (x) { return x.orders > 0; })
        .map(function (x) { return { unit: x.id, q: x.q, r: x.r }; })
        .concat(r.line || []);
      console.log('  ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders   (deployment ' + tried + ')');
    }
    if (tried % 20000 === 0) console.log('  … ' + tried + ' deployments tried, best ' + (incumbent / 10));
  }
  console.log('deployments tried: ' + tried + ', unreachable: ' + illegal +
    (heap.length ? '   (stopped early — best known)' : '   (exhausted the seat space)'));
  console.log('\nbest: ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders');
  if (incLine) {
    var s2 = E.loadPuzzle(base);
    incLine.forEach(function (o, i) {
      var u = E.unitById(s2, o.unit);
      var isMove = o.target === undefined;
      console.log('  ' + (i + 1) + '. ' + (isMove ? E.nameOf(u) + ' -> (' + o.q + ',' + o.r + ')'
        : E.nameOf(u) + ' attacks ' + E.nameOf(E.unitById(s2, o.target))));
      s2 = E.applyAction(s2, isMove ? { type: 'move', unit: o.unit, q: o.q, r: o.r }
                                    : { type: 'attack', unit: o.unit, target: o.target });
    });
    var killed = s2.units.filter(function (u) { return u.player === 1 && u.hp <= 0; });
    var str = killed.reduce(function (a, u) { return a + STR(u); }, 0);
    console.log('verified: ' + (str / 10) + ' STR in ' + (POOL - s2.orders) + ' orders' +
      (str === incumbent ? '  ✓ matches' : '  ✗ MISMATCH'));
  }
  process.exit(0);
}

var levels = LATE_ARG !== null ? [LATE_ARG] : [0, 1, 2, 3];
var allComplete = true;
levels.forEach(function (L) {
  if (Date.now() > DEADLINE) { allComplete = false; return; }
  var before = incumbent;
  console.log('--- searching with at most ' + L + ' mid-fight move' + (L === 1 ? '' : 's'));
  var done = search(L);
  allComplete = allComplete && done;
  console.log('    ' + (done ? 'complete' : 'TIMED OUT') + ' · nodes ' + nodes +
    ' · best ' + (incumbent / 10) + ' STR' + (incumbent > before ? '  (improved)' : ''));
});

console.log('\nbest: ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders' +
  (allComplete && !TOPK ? '   — search complete, this is the ceiling'
               : '   — search incomplete, treat as best known'));

// Replay the winning line through a fresh engine state: the answer is only
// worth as much as its verification.
if (incLine) {
  var s2 = E.loadPuzzle(base);
  incLine.forEach(function (o, i) {
    var u = E.unitById(s2, o.unit);
    var isMove = o.target === undefined;
    var msg = isMove ? E.nameOf(u) + ' -> (' + o.q + ',' + o.r + ')'
                     : E.nameOf(u) + ' attacks ' + E.nameOf(E.unitById(s2, o.target));
    s2 = E.applyAction(s2, isMove ? { type: 'move', unit: o.unit, q: o.q, r: o.r }
                                  : { type: 'attack', unit: o.unit, target: o.target });
    console.log('  ' + (i + 1) + '. ' + msg + '   [' + s2.log[s2.log.length - 1] + ']');
  });
  var killed = s2.units.filter(function (u) { return u.player === 1 && u.hp <= 0; });
  var str = killed.reduce(function (a, u) { return a + STR(u); }, 0);
  console.log('verified: ' + (str / 10) + ' STR in ' + (POOL - s2.orders) + ' orders' +
    (str === incumbent && POOL - s2.orders === incOrders ? '  ✓ matches' : '  ✗ MISMATCH'));
}
