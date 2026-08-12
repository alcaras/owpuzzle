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
var CAND = {};
BLUE.forEach(function (u) {
  var c = {};
  c[u.q + ',' + u.r] = 0;
  E.reachableTiles(INIT, u).forEach(function (rt) {
    if (rt.orders > POOL) return;
    var k = rt.q + ',' + rt.r, useful = flankSeat[k];
    for (var i = 0; i < REDS.length && !useful; i++) {
      if (damageFrom(u, { q: rt.q, r: rt.r }, REDS[i])) useful = 1;
    }
    if (useful) c[k] = rt.orders;
  });
  CAND[u.id] = c;
});

// Dominance: a tile that costs no more, hits every red at least as hard, and
// sits next to every red the other one does, makes the other tile pointless.
// This is what turns a 4-million deployment space into a searchable one.
(function pruneDominated() {
  var adj = {};
  REDS.forEach(function (R) {
    DIRS.forEach(function (d) { (adj[(R.q + d[0]) + ',' + (R.r + d[1])] || (adj[(R.q + d[0]) + ',' + (R.r + d[1])] = {}))[R.id] = 1; });
  });
  BLUE.forEach(function (u) {
    var keys = Object.keys(CAND[u.id]);
    var prof = {};
    keys.forEach(function (k) {
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      prof[k] = {
        orders: CAND[u.id][k],
        dmg: REDS.map(function (R) { return damageFrom(u, tile, R); }),
        adj: adj[k] || {},
        home: (tile.q === u.q && tile.r === u.r),
      };
    });
    keys.forEach(function (b) {
      if (!CAND[u.id].hasOwnProperty(b) || prof[b].home) return;
      for (var i = 0; i < keys.length; i++) {
        var a = keys[i];
        if (a === b || !CAND[u.id].hasOwnProperty(a)) continue;
        var A = prof[a], B = prof[b];
        if (A.orders > B.orders) continue;
        // A seat next to an enemy is unique: flanking needs the ally on the
        // tile DIRECTLY OPPOSITE the attacker, so two tiles beside the same
        // enemy are not interchangeable and neither can stand in for the
        // other. Only pure firing positions — next to nobody — are eligible
        // to be dominated. (Comparing "adjacent to the same reds" instead is
        // what deleted the militia seat Aran's line depends on.)
        if (Object.keys(B.adj).length) continue;
        var ok = true;
        for (var j = 0; j < REDS.length && ok; j++) if (A.dmg[j] < B.dmg[j]) ok = false;
        if (ok) { delete CAND[u.id][b]; return; }
      }
    });
  });
  var space = 1;
  BLUE.forEach(function (u) {
    var n = Object.keys(CAND[u.id]).length;
    space *= n;
    console.log('  ' + u.type.replace('UNIT_', '').toLowerCase() + ': ' + n + ' tiles after dominance');
  });
  console.log('deployment space: ' + space.toExponential(2));
})();


// --- diagnostic: is the reference deployment still on the menu? -------------
if (process.env.PROBE) {
  JSON.parse(process.env.PROBE).forEach(function (pr) {
    var u = BLUE.filter(function (x) { return x.type === 'UNIT_' + pr[0].toUpperCase(); })[pr[1]];
    var here = u && CAND[u.id].hasOwnProperty(pr[2]);
    console.log('  probe ' + pr[0] + '#' + pr[1] + ' -> ' + pr[2] + ': ' +
      (here ? 'KEPT (' + CAND[u.id][pr[2]] + ' orders)' : 'PRUNED AWAY'));
  });
}

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

// ---------- phase 2: exact attack-only search ------------------------------
var incumbent = SEED, incLine = null, incOrders = 0;
function fight(state, budget) {
  var best = { str: E.strKilledOf(state), orders: 0 };
  var seen = {};
  (function rec(s, spent) {
    if (Date.now() > DEADLINE) return;
    var str = E.strKilledOf(s);
    if (str > best.str || (str === best.str && spent < best.orders)) {
      best = { str: str, orders: spent };
    }
    if (spent >= budget) return;
    var opts = [];
    s.units.forEach(function (u) {
      if (u.player !== 0 || u.hp <= 0 || !E.canAttack(s, u)) return;
      E.attackTargets(s, u).forEach(function (t) { opts.push({ u: u.id, t: t.id }); });
    });
    if (!opts.length) return;
    // an admissible cap: every remaining red needs at least one more order
    var live = s.units.filter(function (x) { return x.player === 1 && x.hp > 0; })
      .map(STR).sort(function (a, b) { return b - a; });
    var cap = str, room = Math.min(live.length, budget - spent);
    for (var i = 0; i < room; i++) cap += live[i];
    // prune against the GLOBAL incumbent, not just this deployment's best:
    // a deployment that cannot beat the running champion is dead weight, and
    // this is what makes the leaf cost collapse
    if (cap < Math.max(best.str, incumbent)) return;
    // kills first, then damage — good lines early make the cap bite sooner
    opts.forEach(function (o) {
      var tg = E.unitById(s, o.t), at = E.unitById(s, o.u), d = 0;
      try { d = E.attackUnitDamage(s, at, { q: at.q, r: at.r }, tg); } catch (e) {}
      o.rank = (d >= tg.hp ? 1000 : 0) + d;
    });
    opts.sort(function (a, b) { return b.rank - a.rank; });
    opts.forEach(function (o) {
      if (Date.now() > DEADLINE) return;
      var ns; try { ns = E.applyAction(s, { type: 'attack', unit: o.u, target: o.t }); } catch (e) { return; }
      var h = ns.units.map(function (x) {
        return x.id + ':' + x.q + ',' + x.r + ':' + Math.max(0, x.hp) + ':' + (x.cooldown || 0);
      }).join(';');
      if (seen[h] !== undefined && seen[h] <= spent + 1) return;
      seen[h] = spent + 1;
      rec(ns, spent + 1);
    });
  })(state, 0);
  return best;
}

// ---------- phase 1: deployments, branch and bound -------------------------
var order = BLUE.slice().sort(function (a, b) {
  return Object.keys(CAND[a.id]).length - Object.keys(CAND[b.id]).length;
});
var leaves = 0, pruned = 0, applyFail = 0;

function bound(assign, i, moveOrders) {
  // For each red: the pool of single blows that could ever land on it, best
  // first. If they cannot sum to its HP it will never die; if they can, the
  // count of blows needed is a floor on the orders this kill costs. Both use
  // over-estimated damage, so both stay admissible.
  var kill = 0, minAttacks = 0;
  REDS.forEach(function (R) {
    var blows = [];
    for (var j = 0; j < order.length; j++) {
      // walk the ASSIGNMENT order, not the board order — assign[j] is the tile
      // chosen for order[j], and pairing it with BLUE[j] silently scrambles
      // every unit's damage into someone else's position
      var u = order[j], swings = hasRout(u) ? 2 : 1, per;
      if (j < i) {
        var a = assign[j];
        if (!a) continue;
        per = damageFrom(u, { q: a.q, r: a.r }, R) * 2;
      } else {
        per = OPT[u.id][R.id] / swings;
      }
      if (per > 0) for (var k = 0; k < swings; k++) blows.push(per);
    }
    blows.sort(function (x, y) { return y - x; });
    var acc = 0, n = 0;
    while (acc < R.hp && n < blows.length) { acc += blows[n]; n++; }
    if (acc >= R.hp) { kill += STR(R); minAttacks += n; }
  });
  if (moveOrders + minAttacks > POOL) return -1;
  return kill;
}

(function assignRec(i, assign, used, moveOrders, st) {
  if (Date.now() > DEADLINE) return;
  var b = bound(assign, i, moveOrders);
  if (b < 0 || b < incumbent) { pruned++; return; }
  if (i === order.length) {
    leaves++;
    var spent = POOL - st.orders;
    var r = fight(st, Math.min(POOL - spent, ATTACK_CAP));
    if (r.str > incumbent || (r.str === incumbent && incLine && spent + r.orders < incOrders)) {
      incumbent = r.str; incOrders = spent + r.orders;
      incLine = assign.slice();
      console.log('  ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders   (leaf ' + leaves + ')');
    }
    return;
  }
  var u = order[i];
  var tiles = Object.keys(CAND[u.id]).map(function (k) {
    var t = k.split(',');
    var tile = { id: u.id, q: +t[0], r: +t[1], orders: CAND[u.id][k], key: k };
    tile.punch = REDS.reduce(function (a, R) { return a + damageFrom(u, tile, R); }, 0);
    return tile;
  }).sort(function (x, y) { return y.punch - x.punch || x.orders - y.orders; });
  tiles.forEach(function (t) {
    if (used[t.key]) return;
    if (moveOrders + t.orders > POOL) return;
    var ns = st;
    if (t.orders > 0) {
      try { ns = E.applyAction(st, { type: 'move', unit: t.id, q: t.q, r: t.r }); }
      catch (e) { applyFail++; return; }
    }
    used[t.key] = 1;
    assignRec(i + 1, assign.concat([t]), used, moveOrders + t.orders, ns);
    delete used[t.key];
  });
})(0, [], {}, 0, E.loadPuzzle(base));

console.log('leaves evaluated: ' + leaves + ', branches pruned: ' + pruned +
  ', deployments that would not apply: ' + applyFail +
  (Date.now() > DEADLINE ? '   *** TIMED OUT (best-so-far only) ***' : '   (search complete)'));
console.log('best: ' + (incumbent / 10) + ' STR in ' + incOrders + ' orders');
if (incLine) {
  console.log('deployment:');
  incLine.forEach(function (a) {
    if (!a) return;
    var u = INIT.units.find(function (x) { return x.id === a.id; });
    console.log('   ' + u.type.replace('UNIT_', '').toLowerCase() +
      ' -> ' + a.q + ',' + a.r + '  (' + a.orders + ' orders)');
  });
}
