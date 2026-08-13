// verify2 — the third ceiling verifier. See docs/verifier-design.md.
//
// usage: node tools/verify2.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]
//        LAMBDA=n      travel-cost weight in seat scoring (default 6)
//        S2MAX=n       max blue units for the exhaustive in-state search (default 8)
//        LATE=n        fix the mid-fight move ration instead of deepening 0..3
//        V2_WORKERS=n  worker threads for big boards (default cpus-2; 0 = off)
//        W=x           completion-heuristic weight in the deployment heap (<1 digs deeper)
//        PLANK=n       seats kept per unit in plan (finder) slices (default 8)
//        FCAP=n        fight node cap (default: 2500 in plan slices, exact elsewhere)
//        V2_NOPUSH=1   drop push-drift from the tables (diagnostics only — unsound)
//
// Three stages, sharing one table of engine-derived OPTIMISTIC damage:
//   1. kill-set upper bound U: enumerate red subsets by descending strength and
//      refute them with a sound blow-allocation relaxation. Everything above
//      the first unrefuted subset is PROVEN dead ground.
//   2. exact in-state search (small boards): deploy_fight's engine-exact DFS
//      with a tighter, table-driven bound and march support.
//   3. assignment search over deployments (big boards): DFS over unit->seat
//      assignments (collision-free by construction), limited-discrepancy
//      deepening, pruned by the kill-set bound conditioned on the partial
//      assignment. Leaves walk in and fight out through the real engine.
// A line whose strength reaches U proves the ceiling without exhaustion.
'use strict';
var path = require('path');
var WT = require('worker_threads');
var E = require(path.join(__dirname, '..', 'web', 'engine.js'));

var GLOB = E.DATA.globals;
var EFF = E.DATA.effects;

function effField(u, field) {
  return E.effectsOf(u).reduce(function (a, e) {
    return a + ((EFF[e] || {})[field] || 0);
  }, 0);
}
function hasFlag(u, flag) {
  return E.effectsOf(u).some(function (e) { return EFF[e] && EFF[e][flag]; });
}
function immuneTo(u, eff) {
  return E.effectsOf(u).some(function (e) {
    var d = EFF[e];
    return d && d.aeEffectUnitImmune && d.aeEffectUnitImmune.indexOf(eff) >= 0;
  });
}
function hasRout(u) { return hasFlag(u, 'bRout'); }
function hasPush(u) { return hasFlag(u, 'bPush'); }
function STRV(u) { return E.DATA.units[u.type].iStrength; }
function key(q, r) { return q + ',' + r; }

// InfoHelpers.getAttackDamage (engine.js:412) — replicated so blow values can
// be computed RAW from a chosen (attStr, defStr) pair; attackUnitDamage caps
// at def.hp, which would hide the true size of a blow from the bound.
function gAD(fromStr, toStr, percent) {
  if (fromStr <= 0) return 0;
  var dmg = GLOB.BASE_DAMAGE * fromStr;
  if (fromStr > toStr) dmg += toStr - 1;
  dmg = Math.floor(dmg / toStr);
  if (percent !== 100) dmg = Math.floor((dmg * percent + 99) / 100);
  return Math.max(1, dmg);
}

// ---------------------------------------------------------------- build ----
// Everything the stages share: seats, optimistic damage tables, collateral,
// travel floors. `P` is the raw puzzle, `POOL` the order pool to verify under.
function build(P, POOL) {
  var base = JSON.parse(JSON.stringify(P));
  base.orders = POOL;
  base.objective = { kind: 'maxKill', count: 999999 };
  // play semantics for training (loadPuzzle:1332): the site grants 300 unless
  // the author set a budget. deploy_fight ignores training (it has no march);
  // real lines march (the 11-blue author line marches its ballista).
  base.training = P.training != null ? P.training : 300;

  var INIT = E.loadPuzzle(base);
  var BLUE = INIT.units.filter(function (u) { return u.player === 0 && u.hp > 0; });
  var REDS = INIT.units.filter(function (u) { return u.player === 1 && u.hp > 0; });
  var NR = REDS.length;
  var ridx = {}; REDS.forEach(function (r, i) { ridx[r.id] = i; });

  // -- push drift: bPush attacks can shove a red K tiles off its start -------
  var PUSHK = process.env.V2_NOPUSH ? 0 : BLUE.reduce(function (a, b) {
    return a + (hasPush(b) ? (hasRout(b) ? Math.min(NR, 4) : 1) : 0);
  }, 0);
  function driftOf(R) {
    var seen = {}, out = [{ q: R.q, r: R.r }];
    seen[key(R.q, R.r)] = 1;
    var frontier = [{ q: R.q, r: R.r }];
    for (var d = 0; d < PUSHK; d++) {
      var next = [];
      frontier.forEach(function (p) {
        E.DIRS.forEach(function (dd) {
          var q = p.q + dd.q, r = p.r + dd.r, k = key(q, r);
          if (seen[k]) return;
          if (!E.tileAt(INIT, q, r)) return;
          // a push lands only where the unit could stand (doAttack:978)
          var c = tryMoveCost(R, p, { q: q, r: r });
          if (c === Infinity) return;
          seen[k] = 1;
          var t = { q: q, r: r };
          out.push(t); next.push(t);
        });
      });
      frontier = next;
    }
    return out;
  }
  function tryMoveCost(u, from, to) {
    // moveCostInto is not exported; probe it through reachableTiles semantics
    // is overkill — water/mountain are the only Infinity cases that matter.
    var t = E.tileAt(INIT, to.q, to.r);
    if (!t) return Infinity;
    if (t.terrain === 'TERRAIN_WATER') {
      return E.DATA.units[u.type].bWater ? 1 : Infinity;
    }
    if (E.DATA.units[u.type].bWater) return Infinity;
    if (t.height === 'HEIGHT_MOUNTAIN' || t.height === 'HEIGHT_VOLCANO') return Infinity;
    return 1;
  }
  var DRIFT = REDS.map(function (R) { return PUSHK ? driftOf(R) : [{ q: R.q, r: R.r }]; });

  // -- seats: reachability with the reds lifted off, march included ----------
  var CLEARED = (function () {
    var st = E.loadPuzzle(base);
    st.units = st.units.filter(function (u) { return u.player === 0; });
    return st;
  })();
  var adjRed = {};
  REDS.forEach(function (R, i) {
    DRIFT[i].forEach(function (p) {
      E.DIRS.forEach(function (d) { adjRed[key(p.q + d.q, p.r + d.r)] = 1; });
    });
  });
  function canHitFrom(u, tile, pos) {
    var dist = E.hexDistance(tile, pos);
    if (dist < 1) return false;
    if (E.isMelee(u)) return dist === 1;
    return dist <= E.effectiveRange(INIT, u, tile, pos) && !E.isShotObstructed(INIT, tile, pos);
  }
  function hitsAnything(u, tile) {
    for (var i = 0; i < NR; i++) {
      for (var j = 0; j < DRIFT[i].length; j++) {
        if (canHitFrom(u, tile, DRIFT[i][j])) return true;
      }
    }
    return false;
  }
  var canMarchAtAll = INIT.training >= GLOB.UNIT_MARCH_COST;
  var SEAT = {};       // unit id -> { tileKey: {orders, march} }
  BLUE.forEach(function (u) {
    var c = {};
    c[key(u.q, u.r)] = { orders: 0, march: false };
    var cu = E.unitById(CLEARED, u.id);
    E.reachableTiles(CLEARED, cu).forEach(function (rt) {
      if (rt.orders > POOL) return;
      var k = key(rt.q, rt.r);
      if (adjRed[k] || hitsAnything(u, rt)) c[k] = { orders: rt.orders, march: false };
    });
    if (canMarchAtAll) {
      var CM = E.cloneState(CLEARED);
      E.unitById(CM, u.id).march = true;
      E.reachableTiles(CM, E.unitById(CM, u.id)).forEach(function (rt) {
        if (rt.orders > POOL) return;
        var k = key(rt.q, rt.r);
        if (c[k]) return;                                  // walkable without marching
        if (adjRed[k] || hitsAnything(u, rt)) c[k] = { orders: rt.orders, march: true };
      });
    }
    SEAT[u.id] = c;
  });

  // Deployment seats (stage 3): what a unit can reach BEFORE any blood is
  // drawn — reds alive (blocking, projecting ZOC), allies lifted (they move
  // out of the way; the walk-in retries the ordering). Cleared-board seats
  // include tiles only a mid-fight move can use; walking into those fails at
  // every leaf, which is pure waste in walk-then-fight mode.
  var SEAT3 = {};
  BLUE.forEach(function (u) {
    var RS = E.loadPuzzle(base);
    RS.units = RS.units.filter(function (x) { return x.player === 1 || x.id === u.id; });
    var c = {};
    c[key(u.q, u.r)] = { orders: 0, march: false };
    E.reachableTiles(RS, E.unitById(RS, u.id)).forEach(function (rt) {
      if (rt.orders > POOL) return;
      var k = key(rt.q, rt.r);
      if (SEAT[u.id][k]) c[k] = { orders: rt.orders, march: false };
    });
    if (canMarchAtAll) {
      E.unitById(RS, u.id).march = true;
      E.reachableTiles(RS, E.unitById(RS, u.id)).forEach(function (rt) {
        if (rt.orders > POOL) return;
        var k = key(rt.q, rt.r);
        if (c[k]) return;
        if (SEAT[u.id][k]) c[k] = { orders: rt.orders, march: true };
      });
    }
    SEAT3[u.id] = c;
  });

  // -- optimistic damage tables ---------------------------------------------
  // For each (blue, tile, red): the engine computes attack/defence strength on
  // a doctored two-unit state, with phantoms and variants chosen so the result
  // can only ever OVERestimate a real blow. See the design doc for why each
  // variant is there. aOpt = max attStr over variants, dOpt = min defStr.
  var disarmables = (function () {
    var list = [];
    BLUE.forEach(function (b) {
      E.effectsOf(b).forEach(function (e) {
        var d = EFF[e];
        if (d && d.attackApply) list.push(d.attackApply.effect);
      });
      if (hasPush(b) && GLOB.PANIC_NO_ESCAPE_EFFECTUNIT) list.push(GLOB.PANIC_NO_ESCAPE_EFFECTUNIT);
    });
    return list.filter(function (e, i) {
      return list.indexOf(e) === i && (EFF[e] || {}).iStrengthModifier < 0;
    });
  })();
  var typeCount = {};
  BLUE.forEach(function (b) { typeCount[b.type] = (typeCount[b.type] || 0) + 1; });

  function cloneUnit(u) { return JSON.parse(JSON.stringify(u)); }
  function optPair(b, tile, R) {
    // -> {a,d}: BOUND pair (max attStr / min defStr over every variant) and
    //    {a0,d0}: SCORE pair (red on its actual tile, no speculative disarm) —
    // the bound must dominate reality, but steering the search by pushed-red
    // and disarmed-red fantasies sends every deployment somewhere the fight
    // cannot cash in. Two tables, one soundness rule: bounds use {a,d} only.
    var ri = ridx[R.id];
    var bestA = 0, bestD = Infinity, any = false;
    var bestA0 = 0, bestD0 = Infinity, any0 = false;
    var flankPct = effField(b, 'iFlankingAttackModifier');
    var adjPct = effField(b, 'iAdjacentSameAttackModifier') + effField(b, 'iAdjacentSameModifier');
    var applied = disarmables.filter(function (e) { return !immuneTo(R, e); });
    var attHps = [b.hp];
    if (b.hp === E.hpMax(b) && b.hp > 1) attHps.push(b.hp - 1);
    var defHps = [R.hp];
    if (R.hp === E.hpMax(R) && R.hp > 1) defHps.push(R.hp - 1);

    DRIFT[ri].forEach(function (pos) {
      if (!canHitFrom(b, tile, pos)) return;
      any = true;
      var adjacent = E.hexDistance(tile, pos) === 1;
      attHps.forEach(function (ah) {
        defHps.forEach(function (dh) {
          [false, true].forEach(function (dis) {
            if (dis && !applied.length) return;
            var attC = cloneUnit(b); attC.q = tile.q; attC.r = tile.r; attC.hp = ah;
            var defC = cloneUnit(R); defC.q = pos.q; defC.r = pos.r; defC.hp = dh;
            defC.fortifyTurns = 0;                      // melee strips it; optimistic
            if (dis) defC.applied = (defC.applied || []).concat(applied);
            var units = [attC, defC];
            if (adjacent && flankPct > 0) {
              units.push({ id: -71, player: b.player, type: 'UNIT_MILITIA',
                q: 2 * pos.q - tile.q, r: 2 * pos.r - tile.r, hp: 10, promotions: [] });
            }
            if (adjPct > 0 && typeCount[b.type] >= 2) {
              for (var d = 0; d < 6; d++) {            // any adjacent coord not already used
                var pq = tile.q + E.DIRS[d].q, pr = tile.r + E.DIRS[d].r;
                if (units.some(function (x) { return x.q === pq && x.r === pr; })) continue;
                units.push({ id: -72, player: b.player, type: b.type, q: pq, r: pr,
                  hp: 10, promotions: [] });
                break;
              }
            }
            var SP = { tiles: INIT.tiles, units: units, orders: 99, training: 0, log: [] };
            var a = E.attackStrength(SP, attC, { q: tile.q, r: tile.r }, { q: pos.q, r: pos.r }, defC);
            var dd = E.defendStrength(SP, defC, { q: pos.q, r: pos.r }, attC);
            if (a > bestA) bestA = a;
            if (dd < bestD) bestD = dd;
            if (!dis && pos.q === R.q && pos.r === R.r) {
              any0 = true;
              if (a > bestA0) bestA0 = a;
              if (dd < bestD0) bestD0 = dd;
            }
          });
        });
      });
    });
    if (!any || bestA <= 0) return null;
    return { a: bestA, d: bestD,
      a0: any0 ? bestA0 : 0, d0: any0 ? bestD0 : 1 };
  }

  // collateral pattern shapes (forEachCollateral, engine.js:870): what a seat
  // could splash onto, geometry relaxed to distances (a superset).
  function colPatterns(b) {
    var out = [];
    [['ATTACK_PIERCE', 0], ['ATTACK_CLEAVE', 1], ['ATTACK_CIRCLE', 2], ['ATTACK_SPLASH', 3]].forEach(function (p) {
      var value = 0, pct = 0;
      E.effectsOf(b).forEach(function (e) {
        var d = EFF[e];
        if (d && d.aiAttackValue && d.aiAttackValue[p[0]]) value += d.aiAttackValue[p[0]];
        if (d && d.aiAttackPercent && d.aiAttackPercent[p[0]]) pct += d.aiAttackPercent[p[0]];
      });
      if (value > 0 && pct > 0) {
        var cap = p[0] === 'ATTACK_PIERCE' ? value
                : p[0] === 'ATTACK_CLEAVE' ? 2 * value
                : 5;                                       // CIRCLE / SPLASH
        out.push({ kind: p[0], value: value, pct: pct, cap: cap });
      }
    });
    return out;
  }
  // Could any OTHER living red stand at position t (initial or drifted)?
  // Collateral needs a primary target; its possible positions gate the shape.
  function redCouldStandAt(t, excludeRi) {
    for (var i = 0; i < NR; i++) {
      if (i === excludeRi) continue;
      for (var j = 0; j < DRIFT[i].length; j++) {
        if (DRIFT[i][j].q === t.q && DRIFT[i][j].r === t.r) return true;
      }
    }
    return false;
  }
  function colPctFrom(b, tile, R, pats) {
    // best collateral percent this seat could land on R, honouring the real
    // pattern shapes (forEachCollateral, engine.js:870): pierce is collinear
    // BEHIND an adjacent primary; cleave/circle victims are adjacent to the
    // attacker with a primary adjacent too; splash victims are adjacent to a
    // primary the attacker can actually shoot.
    var ri = ridx[R.id], best = 0;
    DRIFT[ri].forEach(function (pos) {
      var dist = E.hexDistance(tile, pos);
      pats.forEach(function (p) {
        if (best >= p.pct) return;
        if (p.kind === 'ATTACK_PIERCE') {
          if (dist < 2 || dist > 1 + p.value) return;
          for (var d = 0; d < 6; d++) {
            if (tile.q + dist * E.DIRS[d].q === pos.q && tile.r + dist * E.DIRS[d].r === pos.r) {
              if (redCouldStandAt({ q: tile.q + E.DIRS[d].q, r: tile.r + E.DIRS[d].r }, ri)) {
                best = Math.max(best, p.pct);
              }
              return;
            }
          }
        } else if (p.kind === 'ATTACK_CLEAVE' || p.kind === 'ATTACK_CIRCLE') {
          if (dist !== 1) return;
          for (var d2 = 0; d2 < 6; d2++) {
            var t2 = { q: tile.q + E.DIRS[d2].q, r: tile.r + E.DIRS[d2].r };
            if ((t2.q !== pos.q || t2.r !== pos.r) && redCouldStandAt(t2, ri)) {
              best = Math.max(best, p.pct);
              return;
            }
          }
        } else if (p.kind === 'ATTACK_SPLASH') {
          for (var i = 0; i < NR && best < p.pct; i++) {
            if (i === ri) continue;
            for (var j = 0; j < DRIFT[i].length; j++) {
              var t3 = DRIFT[i][j];
              if (E.hexDistance(t3, pos) === 1 && canHitFrom(b, tile, t3)) {
                best = Math.max(best, p.pct);
                break;
              }
            }
          }
        }
      });
    });
    return best;
  }
  function colPairAt(b, tile, R, pct) {
    // strengths for a collateral hit: same formula, victim as the target tile.
    // Collateral does not require the victim to be in range — compute the
    // strength pair directly against the victim's positions.
    var ri = ridx[R.id];
    var bestA = 0, bestD = Infinity;
    var applied = disarmables.filter(function (e) { return !immuneTo(R, e); });
    var defHps = [R.hp];
    if (R.hp === E.hpMax(R) && R.hp > 1) defHps.push(R.hp - 1);
    DRIFT[ri].forEach(function (pos) {
      defHps.forEach(function (dh) {
        [false, true].forEach(function (dis) {
          if (dis && !applied.length) return;
          var attC = cloneUnit(b); attC.q = tile.q; attC.r = tile.r;
          var defC = cloneUnit(R); defC.q = pos.q; defC.r = pos.r; defC.hp = dh;
          defC.fortifyTurns = 0;
          if (dis) defC.applied = (defC.applied || []).concat(applied);
          var SP = { tiles: INIT.tiles, units: [attC, defC], orders: 99, training: 0, log: [] };
          var a = E.attackStrength(SP, attC, { q: tile.q, r: tile.r }, { q: pos.q, r: pos.r }, defC);
          var dd = E.defendStrength(SP, defC, { q: pos.q, r: pos.r }, attC);
          if (a > bestA) bestA = a;
          if (dd < bestD) bestD = dd;
        });
      });
    });
    return bestA > 0 ? { a: bestA, d: bestD } : null;
  }

  // Assemble per-unit tables over its tileset: seats + (routers) red tiles.
  var OPT = {};        // id -> { tiles: {tileKey: Float64Array(NR)}, col: {...}, static: arr,
                       //         routFire: arr, chainStart: minOrders, travel: arr, ... }
  BLUE.forEach(function (b) {
    var pats = colPatterns(b);
    var colCap = pats.reduce(function (a, p) { return a + p.cap; }, 0);
    var tiles = {}, col = {};
    var tileKeys = Object.keys(SEAT[b.id]);
    var redTileKeys = [], allDriftKeys = [];
    if (hasRout(b)) {
      REDS.forEach(function (R, i) {
        DRIFT[i].forEach(function (p) {
          var k = key(p.q, p.r);
          if (allDriftKeys.indexOf(k) < 0) allDriftKeys.push(k);
          if (redTileKeys.indexOf(k) < 0 && tileKeys.indexOf(k) < 0) redTileKeys.push(k);
        });
      });
    }
    var tiles0 = {};
    tileKeys.concat(redTileKeys).forEach(function (k) {
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      var prow = new Array(NR).fill(0), crow = new Array(NR).fill(0);
      var prow0 = new Array(NR).fill(0);
      REDS.forEach(function (R, i) {
        var pair = optPair(b, tile, R);
        if (pair) {
          prow[i] = gAD(pair.a, pair.d, 100);
          if (pair.a0 > 0) prow0[i] = gAD(pair.a0, pair.d0, 100);
        }
        if (colCap > 0) {
          var pct = colPctFrom(b, tile, R, pats);
          if (pct > 0) {
            var cp = colPairAt(b, tile, R, pct);
            if (cp) crow[i] = gAD(cp.a, cp.d, pct);
          }
        }
      });
      tiles[k] = prow;
      tiles0[k] = prow0;
      if (colCap > 0) col[k] = crow;
    });
    var stat = new Array(NR).fill(0), cstat = new Array(NR).fill(0);
    var routFire = new Array(NR).fill(0);
    var travel = new Array(NR).fill(Infinity);
    tileKeys.forEach(function (k) {
      var seat = SEAT[b.id][k];
      REDS.forEach(function (R, i) {
        if (tiles[k][i] > stat[i]) stat[i] = tiles[k][i];
        if (col[k] && col[k][i] > cstat[i]) cstat[i] = col[k][i];
        if (tiles[k][i] > 0 && seat.orders < travel[i]) travel[i] = seat.orders;
        if (col[k] && col[k][i] > 0 && seat.orders < travel[i]) travel[i] = seat.orders;
      });
    });
    // rout-advance firing positions are the red (drift) tiles, INCLUDING the
    // ones that also happen to be walkable seats
    var routFire0 = new Array(NR).fill(0);
    allDriftKeys.forEach(function (k) {
      REDS.forEach(function (R, i) {
        if (tiles[k][i] > routFire[i]) routFire[i] = tiles[k][i];
        if (tiles[k][i] > stat[i]) stat[i] = tiles[k][i];
        if (tiles0[k][i] > routFire0[i]) routFire0[i] = tiles0[k][i];
      });
    });
    // a rout chain must START with an adjacent kill: cheapest seat adjacent to
    // any red position. Rout-tile blows are only reachable through that door.
    var chainStart = Infinity;
    tileKeys.forEach(function (k) {
      if (!adjRed[k]) return;
      var o = SEAT[b.id][k].orders;
      if (o < chainStart) chainStart = o;
    });
    OPT[b.id] = { tiles: tiles, tiles0: tiles0, col: col, stat: stat, cstat: cstat,
      routFire: routFire, routFire0: routFire0,
      travel: travel, chainStart: chainStart, colCap: colCap,
      rout: hasRout(b), maxAtt: hasRout(b) ? NR + 1 : 1 };
  });

  return { P: P, base: base, POOL: POOL, INIT: INIT, BLUE: BLUE, REDS: REDS,
    NR: NR, ridx: ridx, SEAT: SEAT, SEAT3: SEAT3, OPT: OPT, DRIFT: DRIFT, PUSHK: PUSHK,
    adjRed: adjRed, canHitFrom: canHitFrom };
}

// ------------------------------------------------- kill-set feasibility ----
// Can every red in `mask` be covered by an allocation of optimistic blows
// within `budget` orders? `rows` supplies each blue's blow tables and travel
// floors, so the same allocator serves stage 1 (full tables), the stage-3
// bound (assigned units pinned to their seat) and travel-free variants.
//
// Sound relaxations, all in the generous direction: a non-router spends its
// one attack on one red; a router attacks up to |mask|+1 distinct reds;
// collateral blows are order-free but capped per attack; travel per used blue
// is the cheapest seat that engages ANY of its reds. If the node cap trips,
// the answer is "feasible" (which can only loosen an upper bound).
function feasibleMask(ctx, mask, budget, rows, nodeCap, out) {
  var reds = [];
  for (var i = 0; i < ctx.NR; i++) {
    if (mask & (1 << i)) {
      reds.push({ i: i, hp: ctx.REDS[i].hp, zealot: hasFlag(ctx.REDS[i], 'bLastStand') });
    }
  }
  var blues = rows.filter(function (b) {
    return reds.some(function (r) { return b.prim[r.i] > 0 || b.col[r.i] > 0; });
  });
  // per-red availability pre-check (cheap refutation of most masks)
  for (var ri = 0; ri < reds.length; ri++) {
    var r = reds[ri], cap = 0;
    blues.forEach(function (b) {
      var lim = r.zealot ? r.hp - 1 : r.hp;
      if (b.prim[r.i] > 0) cap += Math.min(b.prim[r.i], lim);        // one primary per (b,red)
      if (b.col[r.i] > 0) cap += Math.min(b.col[r.i], lim) * b.colCap * b.maxAtt;
    });
    if (cap < r.hp) return false;
  }
  // tightest red first
  reds.sort(function (a, b) {
    var sa = 0, sb = 0;
    blues.forEach(function (x) { sa += x.prim[a.i]; sb += x.prim[b.i]; });
    return (sa - a.hp * blues.length / 4) - (sb - b.hp * blues.length / 4);
  });
  var primUsed = blues.map(function () { return 0; });
  var colUsed = blues.map(function () { return 0; });
  var primOn = blues.map(function () { return 0; });     // bitmask of reds hit
  var travelNow = blues.map(function () { return Infinity; });
  var nodes = 0, capped = false;
  var colFree = {};
  reds.forEach(function (r) {
    colFree[r.i] = blues.some(function (b) { return b.col[r.i] > 0; });
  });

  function ordersLB() {
    var o = 0;
    for (var b = 0; b < blues.length; b++) {
      var att = Math.max(primUsed[b], blues[b].colCap ? Math.ceil(colUsed[b] / blues[b].colCap) : 0);
      if (att > 0) o += att + (travelNow[b] === Infinity ? 0 : travelNow[b]);
    }
    return o;
  }
  function minRemaining(idx) {
    var o = 0;
    for (var j = idx; j < reds.length; j++) if (!colFree[reds[j].i]) o += 1;
    return o;
  }
  function cover(idx) {
    if (nodes++ > nodeCap) { capped = true; return true; }
    if (idx === reds.length) {
      if (ordersLB() > budget) return false;
      if (out) {
        out.assign = {};
        blues.forEach(function (b, bi) {
          if (primUsed[bi] > 0 || colUsed[bi] > 0) {
            out.assign[b.id] = { primOn: primOn[bi], colUsed: colUsed[bi] };
          }
        });
      }
      return true;
    }
    var r = reds[idx];
    var lim = r.zealot ? r.hp - 1 : r.hp;
    // candidate blows, descending
    var opts = [];
    blues.forEach(function (b, bi) {
      if (b.prim[r.i] > 0 && primUsed[bi] < b.maxAtt && !(primOn[bi] & (1 << r.i))) {
        opts.push({ bi: bi, col: false, v: Math.min(b.prim[r.i], lim) });
      }
      if (b.col[r.i] > 0 && colUsed[bi] < b.colCap * b.maxAtt) {
        opts.push({ bi: bi, col: true, v: Math.min(b.col[r.i], lim) });
      }
    });
    opts.sort(function (a, b) { return b.v - a.v; });
    var suffix = new Array(opts.length + 1).fill(0);
    for (var j = opts.length - 1; j >= 0; j--) {
      // generous suffix sum: pretend every remaining option is fully available
      var mult = opts[j].col ? blues[opts[j].bi].colCap * blues[opts[j].bi].maxAtt : 1;
      suffix[j] = suffix[j + 1] + opts[j].v * mult;
    }
    return (function pick(oi, need) {
      if (need <= 0) {
        if (ordersLB() + minRemaining(idx + 1) > budget) return false;
        return cover(idx + 1);
      }
      if (oi >= opts.length || suffix[oi] < need) return false;
      var o = opts[oi], b = blues[o.bi];
      // take it
      var can = o.col ? colUsed[o.bi] < b.colCap * b.maxAtt
                      : (primUsed[o.bi] < b.maxAtt && !(primOn[o.bi] & (1 << r.i)));
      if (can) {
        var tPrev = travelNow[o.bi];
        if (o.col) colUsed[o.bi]++;
        else { primUsed[o.bi]++; primOn[o.bi] |= (1 << r.i); }
        travelNow[o.bi] = Math.min(travelNow[o.bi], b.travel[r.i] === Infinity ? b.travelAny : b.travel[r.i]);
        if (ordersLB() <= budget && pick(o.col ? oi : oi + 1, need - o.v)) return true;
        if (o.col) colUsed[o.bi]--;
        else { primUsed[o.bi]--; primOn[o.bi] &= ~(1 << r.i); }
        travelNow[o.bi] = tPrev;
      }
      // skip it
      return pick(oi + 1, need);
    })(0, r.hp);
  }
  var ok = cover(0);
  return ok || capped;
}

// Build allocator rows from the full tables (stage 1) or restricted to fixed
// seats (stage-3 bound). travelMode: 'walk' | 'free'.
function fullRows(ctx, travelMode) {
  return ctx.BLUE.map(function (b) {
    var o = ctx.OPT[b.id];
    var travel = o.travel.map(function (t, i) {
      if (travelMode === 'free') return 0;
      // routers can also reach red i THROUGH a chain from the cheapest
      // adjacent seat, even with no direct seat on it
      if (o.rout && o.routFire[i] > 0) return Math.min(t, o.chainStart);
      return t;
    });
    var travelAny = travel.reduce(function (a, t) { return Math.min(a, t); }, 0 * 0 + Infinity);
    return { id: b.id, prim: o.stat, col: o.cstat, colCap: o.colCap,
      maxAtt: o.maxAtt, travel: travel, travelAny: travelAny === Infinity ? 0 : travelAny };
  });
}

// masks by descending strength
function sortedMasks(ctx) {
  var out = [];
  for (var m = 1; m < (1 << ctx.NR); m++) {
    var s = 0;
    for (var i = 0; i < ctx.NR; i++) if (m & (1 << i)) s += STRV(ctx.REDS[i]);
    out.push({ mask: m, str: s });
  }
  out.sort(function (a, b) { return b.str - a.str; });
  return out;
}

// stage 1: greatest strength no mask above which survives refutation
function upperBound(ctx, masks, rows, budget, infeasible) {
  var refuted = 0;
  for (var k = 0; k < masks.length; k++) {
    var m = masks[k];
    var dead = false;
    for (var j = 0; j < infeasible.length; j++) {
      if ((m.mask & infeasible[j]) === infeasible[j]) { dead = true; break; }
    }
    if (dead) { refuted++; continue; }
    if (feasibleMask(ctx, m.mask, budget, rows, 300000)) {
      return { U: m.str, mask: m.mask, refuted: refuted };
    }
    infeasible.push(m.mask);
    refuted++;
  }
  return { U: 0, mask: 0, refuted: refuted };
}

// ----------------------------------------------------------- search core ----
function mkIncumbent(seed, sab) {
  return { str: seed || 0, orders: 0, line: null, fromSeed: !!(seed), sab: sab || null, onBest: null };
}
// current best strength, including what OTHER workers found (shared cell)
function curBest(inc) {
  if (!inc.sab) return inc.str;
  var s = Atomics.load(inc.sab, 0);
  return s > inc.str ? s : inc.str;
}
function noteBest(inc, str, orders, line, tag) {
  if (str > inc.str || (str === inc.str && inc.line && line && orders < inc.orders) ||
      (str === inc.str && !inc.line && line)) {
    inc.str = str; inc.orders = orders; inc.line = line; inc.fromSeed = false;
    if (inc.sab) {
      for (;;) {
        var cur = Atomics.load(inc.sab, 0);
        if (cur >= str || Atomics.compareExchange(inc.sab, 0, cur, str) === cur) break;
      }
    }
    console.log('  ' + (str / 10) + ' STR in ' + orders + ' orders   (' + tag + ')');
    if (inc.onBest) inc.onBest(inc);
    return true;
  }
  return false;
}

// The table-driven in-state bound: current + what the tables say could still
// die within the orders left. Per-red cover with an order knapsack — blues are
// shared between reds' covers (generous, hence admissible).
function stateBound(ctx, s, mayMove) {
  var cap = E.strKilledOf(s);
  var orders = s.orders;
  // per-blue row references, no copying in the hot path
  var bRow = [], bCrow = [], bRout = [], bCol = [], nb = 0;
  for (var ui = 0; ui < s.units.length; ui++) {
    var u = s.units[ui];
    if (u.player !== 0 || u.hp <= 0) continue;
    if (u.cooldown && u.cooldown !== 'ROUT') continue;
    var o = ctx.OPT[u.id];
    if (u.cooldown === 'ROUT' || !mayMove(u)) {
      var k = key(u.q, u.r);
      bRow[nb] = o.tiles[k] || o.stat;                  // unexpected tile: stay sound
      bCrow[nb] = (o.col && o.col[k]) || o.cstat;
      bRout[nb] = o.rout ? o.routFire : null;
    } else {
      bRow[nb] = o.stat; bCrow[nb] = o.cstat; bRout[nb] = null;
    }
    bCol[nb] = o.colCap * o.maxAtt;
    nb++;
  }
  var killable = [];
  for (var i = 0; i < ctx.NR; i++) {
    var R = null;
    for (var j = 0; j < s.units.length; j++) {
      if (s.units[j].id === ctx.REDS[i].id) { R = s.units[j]; break; }
    }
    if (!R || R.hp <= 0) continue;
    var lim = hasFlag(ctx.REDS[i], 'bLastStand') ? R.hp - 1 : R.hp;
    var blows = [];
    for (var b = 0; b < nb; b++) {
      var v = bRow[b][i];
      if (bRout[b] && bRout[b][i] > v) v = bRout[b][i];
      if (v > 0) blows.push(v > lim ? lim : v);
      var cv = bCrow[b][i];
      if (cv > 0) {
        var n2 = bCol[b] > 6 ? 6 : bCol[b];
        for (var c = 0; c < n2; c++) blows.push(cv > lim ? lim : cv);
      }
    }
    blows.sort(function (a, b2) { return b2 - a; });
    var acc = 0, n = 0;
    while (acc < R.hp && n < blows.length) { acc += blows[n]; n++; }
    if (acc >= R.hp) killable.push({ str: STRV(R), attacks: Math.max(1, n) });
  }
  killable.sort(function (a, b2) { return a.attacks - b2.attacks; });
  var budget = orders, fits = 0;
  for (var q = 0; q < killable.length; q++) {
    if (killable[q].attacks > budget) break;
    budget -= killable[q].attacks; fits++;
  }
  killable.sort(function (a, b2) { return b2.str - a.str; });
  for (var w = 0; w < fits; w++) cap += killable[w].str;
  return cap;
}

// admissibility tripwire: a real blow bigger than its OPT entry means a bound
// bug, and every claim this run prints is tainted
var TAINted = false;
function checkBlow(ctx, s, ns, attId, defId) {
  var att = E.unitById(s, attId), def = E.unitById(s, defId);
  if (!att || !def || def.player !== 1) return;
  var i = ctx.ridx[def.id];
  if (i === undefined) return;
  var dealt = Math.max(0, def.hp - E.unitById(ns, defId).hp);
  var o = ctx.OPT[att.id];
  var row = o.tiles[key(att.q, att.r)];
  var allow = row ? row[i] : o.stat[i];
  if (o.rout) allow = Math.max(allow, o.routFire[i]);
  if (dealt > allow) {
    TAINted = true;
    console.log('  !! OPT VIOLATION: unit ' + att.id + ' dealt ' + dealt + ' to red ' +
      def.id + ' from ' + att.q + ',' + att.r + ' but OPT says ' + allow +
      ' — all completeness claims are void');
  }
}

// ------------------------------------------------ stage 2: in-state DFS ----
function stage2(ctx, inc, deadline, lateLevels) {
  var POOL = ctx.POOL;
  var nodes = 0, allComplete = true;
  var marchable = {};
  ctx.BLUE.forEach(function (b) {
    marchable[b.id] = Object.keys(ctx.SEAT[b.id]).some(function (k) { return ctx.SEAT[b.id][k].march; });
  });

  lateLevels.forEach(function (L) {
    if (Date.now() > deadline) { allComplete = false; return; }
    var seen = {};
    var complete = true;
    (function rec(s, moved, lateUsed, fought, line) {
      if (Date.now() > deadline) { complete = false; return; }
      nodes++;
      noteBest(inc, E.strKilledOf(s), POOL - s.orders, line.length ? line.slice() : null, 'node ' + nodes);
      function mayMove(u) { return !moved[u.id] && !(fought && lateUsed >= L); }
      if (stateBound(ctx, s, mayMove) < inc.str) return;

      var attacks = [], moves = [];
      s.units.forEach(function (u) {
        if (u.player !== 0 || u.hp <= 0) return;
        if (E.canAttack(s, u)) {
          E.attackTargets(s, u).forEach(function (t) {
            var d = 0;
            try { d = E.attackUnitDamage(s, u, { q: u.q, r: u.r }, t); } catch (e) {}
            attacks.push({ act: [{ type: 'attack', unit: u.id, target: t.id }],
              unit: u.id, rank: (d >= t.hp ? 1000 : 0) + d });
          });
        }
        if (!mayMove(u) || !E.canMove(s, u)) return;
        var row = ctx.OPT[u.id].tiles;
        E.reachableTiles(s, u).forEach(function (rt) {
          var k = key(rt.q, rt.r);
          if (!ctx.SEAT[u.id].hasOwnProperty(k) || ctx.SEAT[u.id][k].march || rt.orders > s.orders) return;
          var punch = row[k] ? Math.max.apply(null, row[k]) : 0;
          moves.push({ act: [{ type: 'move', unit: u.id, q: rt.q, r: rt.r }],
            unit: u.id, rank: punch * 4 - rt.orders });
        });
        // march-extended seats: march (training, no orders) then one move.
        // Only offered from the unit's start (a marched split-walk costs the
        // same orders as march-then-walk, so this loses nothing).
        if (marchable[u.id] && !u.march && u.steps === 0 && s.training >= GLOB.UNIT_MARCH_COST) {
          var CM = E.cloneState(s);
          E.unitById(CM, u.id).march = true;
          E.reachableTiles(CM, E.unitById(CM, u.id)).forEach(function (rt) {
            var k = key(rt.q, rt.r);
            var seat = ctx.SEAT[u.id][k];
            if (!seat || !seat.march || rt.orders > s.orders) return;
            var punch = row[k] ? Math.max.apply(null, row[k]) : 0;
            moves.push({ act: [{ type: 'march', unit: u.id }, { type: 'move', unit: u.id, q: rt.q, r: rt.r }],
              unit: u.id, rank: punch * 4 - rt.orders });
          });
        }
      });
      attacks.sort(function (a, b) { return b.rank - a.rank; });
      moves.sort(function (a, b) { return b.rank - a.rank; });
      var opts = fought ? attacks.concat(moves) : moves.concat(attacks);

      opts.forEach(function (o) {
        if (Date.now() > deadline) { complete = false; return; }
        var ns = s, ok = true;
        for (var ai = 0; ai < o.act.length && ok; ai++) {
          try {
            var prev = ns;
            ns = E.applyAction(ns, o.act[ai]);
            if (o.act[ai].type === 'attack') checkBlow(ctx, prev, ns, o.act[ai].unit, o.act[ai].target);
          } catch (e) { ok = false; }
        }
        if (!ok) return;
        var isMove = o.act[o.act.length - 1].type === 'move';
        var nm = moved, nl = lateUsed;
        if (isMove) {
          nm = Object.assign({}, moved); nm[o.unit] = 1;
          if (fought) nl = lateUsed + 1;
        }
        var h = ns.units.map(function (x) {
          return x.id + ':' + x.q + ',' + x.r + ':' + Math.max(0, x.hp) + ':' + (x.cooldown || 0) +
            ':' + (x.steps || 0) + ':' + (x.march ? 1 : 0) + ':' + ((x.applied || []).join('+'));
        }).join(';') + '|' + Object.keys(nm).sort().join(',') + '|' + nl;
        var used = POOL - ns.orders;
        if (seen[h] !== undefined && seen[h] <= used) return;
        seen[h] = used;
        rec(ns, nm, nl, fought || !isMove, line.concat(o.act));
      });
    })(E.loadPuzzle(ctx.base), {}, 0, false, []);
    allComplete = allComplete && complete;
    console.log('  stage2 LATE=' + L + ' ' + (complete ? 'complete' : 'TIMED OUT') +
      ' · nodes ' + nodes + ' · best ' + (inc.str / 10));
  });
  return { complete: allComplete, nodes: nodes };
}

// --------------------------------- stage 3: assignment search (deploy) ----
function stage3(ctx, inc, deadline, opts) {
  opts = opts || {};
  var POOL = ctx.POOL;
  var LAMBDA = process.env.LAMBDA ? parseFloat(process.env.LAMBDA) : 6;
  var masks = opts.masks;                 // sorted by strength desc
  // persistent across calls: fights already evaluated, prune decisions made
  var mem = opts.state || { fightMemo: {}, pruneCache: {} };
  var stats = { leaves: 0, dedup: 0, illegal: 0, boundCut: 0, costCut: 0,
    tWalk: 0, tFight: 0, tPrune: 0, fightCapped: 0 };
  // fights are exact except in plan (finder) passes, where a node cap keeps
  // the leaf rate up; a capped fight is honesty-tracked in the verdict
  var FCAP = process.env.FCAP ? parseInt(process.env.FCAP, 10)
    : (opts.plan ? 2500 : Infinity);

  // symmetry classes: identical type+promotions+hp fight identically
  var classOf = {}, classes = {};
  ctx.BLUE.forEach(function (b) {
    var sig = b.type + '|' + (b.promotions || []).slice().sort().join('+') + '|' + b.hp +
      '|' + (b.general ? 1 : 0);
    if (!classes[sig]) classes[sig] = [];
    classes[sig].push(b.id);
    classOf[b.id] = sig;
  });

  // per-unit seat lists sorted by net value. Two modes:
  //  - free: own blow + best enabled ally flank blow, net of travel, over
  //    every red — REALISTIC rows (tiles0) only: steering by pushed-red or
  //    disarmed-red fantasies sends deployments where the fight can't cash in
  //  - plan (opts.plan = {mask, assign}): value seats by contribution to ONE
  //    kill-set's witness allocation, and truncate hard. A finder, not a
  //    coverage pass — the incumbent it finds makes the coverage pass cheap.
  var plan = opts.plan || null;
  var PLANK = process.env.PLANK ? parseInt(process.env.PLANK, 10) : 8;
  var lists = ctx.BLUE.map(function (b) {
    var o = ctx.OPT[b.id];
    var assigned = plan && plan.assign[b.id] ? plan.assign[b.id].primOn : 0;
    var inMask = plan ? plan.mask : (1 << ctx.NR) - 1;
    var list = Object.keys(ctx.SEAT3[b.id]).map(function (k) {
      var seat = ctx.SEAT3[b.id][k];
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      var own = 0;
      ctx.REDS.forEach(function (R, i) {
        if (!(inMask & (1 << i))) return;
        var v = Math.min(o.tiles0[k][i] || 0, R.hp);
        if (o.rout && o.routFire0[i] > 0 && ctx.adjRed[k]) v = Math.max(v, Math.min(o.routFire0[i], R.hp));
        if (plan && (assigned & (1 << i))) v = v * 2 + Math.min(o.tiles[k][i] || 0, R.hp);
        own = plan ? own + v : Math.max(own, v);
      });
      var ally = 0;
      ctx.REDS.forEach(function (R, i) {
        if (!(inMask & (1 << i))) return;
        if (E.hexDistance(tile, R) !== 1) return;
        var opp = key(2 * R.q - tile.q, 2 * R.r - tile.r);
        ctx.BLUE.forEach(function (v2) {
          if (v2.id === b.id) return;
          var ot = ctx.OPT[v2.id].tiles0[opp];
          if (ot && ot[i] > ally) ally = Math.min(ot[i], R.hp);
        });
      });
      // class-minimum cost keeps symmetry pruning sound: the canonical member
      // may not be the cheap one, so descent charges the cheapest of the class
      var minCost = seat.orders;
      classes[classOf[b.id]].forEach(function (uid) {
        var s2 = ctx.SEAT3[uid][k];
        if (s2 && s2.orders < minCost) minCost = s2.orders;
      });
      return { key: k, q: tile.q, r: tile.r, orders: seat.orders, march: seat.march,
        classMin: minCost, score: own + ally - LAMBDA * seat.orders };
    }).sort(function (a, b) { return b.score - a.score || a.orders - b.orders; });
    if (plan) {
      // keep the start seat reachable so a unit can sit out of a plan
      var startKey = key(b.q, b.r);
      var kept = list.slice(0, PLANK);
      if (!kept.some(function (s) { return s.key === startKey; })) {
        var st = list.filter(function (s) { return s.key === startKey; })[0];
        if (st) kept.push(st);
      }
      return kept;
    }
    return list;
  });
  // most useful units first: their seat choice decides the most
  var order = ctx.BLUE.map(function (b, i) { return i; });
  order.sort(function (a, b) {
    var sa = lists[a].length ? lists[a][0].score : 0;
    var sb = lists[b].length ? lists[b][0].score : 0;
    return sb - sa;
  });
  var suffixMin = new Array(order.length + 1).fill(0);
  for (var i = order.length - 1; i >= 0; i--) {
    var cheapest = Infinity;
    lists[order[i]].forEach(function (s) { cheapest = Math.min(cheapest, s.classMin); });
    suffixMin[i] = suffixMin[i + 1] + (cheapest === Infinity ? 0 : cheapest);
  }

  // rows for the restricted kill-set bound: pinned seats for assigned units.
  // `costLB` is a lower bound on the ASSIGNED units' walk cost only — the
  // unassigned units' travel is priced inside the allocator, and pricing it
  // twice would make the bound inadmissible.
  var lastWitness = -1;
  function restrictedPrune(assigned, costLB, cacheKey) {
    if (!masks) return false;
    // cached decisions: "prune" stays valid as the incumbent only rises;
    // "no prune" is valid while the incumbent hasn't risen since
    var best = curBest(inc);
    var hit = mem.pruneCache[cacheKey];
    if (hit !== undefined) {
      if (hit === true) return true;
      if (hit >= best) return false;
    }
    var rows = ctx.BLUE.map(function (b) {
      var o = ctx.OPT[b.id];
      var pin = assigned[b.id];
      if (!pin) {
        var travel = o.travel.map(function (t, i2) {
          return o.rout && o.routFire[i2] > 0 ? Math.min(t, o.chainStart) : t;
        });
        return { id: b.id, prim: o.stat, col: o.cstat, colCap: o.colCap, maxAtt: o.maxAtt,
          travel: travel, travelAny: 0 };
      }
      var row = o.tiles[pin] || new Array(ctx.NR).fill(0);
      if (o.rout && ctx.adjRed[pin]) {
        row = row.map(function (v, i2) { return Math.max(v, o.routFire[i2]); });
      }
      var crow = (o.col && o.col[pin]) || new Array(ctx.NR).fill(0);
      var zero = new Array(ctx.NR).fill(0);
      return { id: b.id, prim: row, col: crow, colCap: o.colCap, maxAtt: o.maxAtt,
        travel: zero, travelAny: 0 };
    });
    var budget = POOL - costLB;
    // `< best` (not <=): equal-strength kill-sets stay alive so cheaper
    // lines to the same ceiling (par) can still be found
    if (lastWitness >= 0 && masks[lastWitness].str >= best &&
        feasibleMask(ctx, masks[lastWitness].mask, budget, rows, 30000)) {
      mem.pruneCache[cacheKey] = best;
      return false;
    }
    for (var k = 0; k < masks.length; k++) {
      if (masks[k].str < best) break;
      if (k === lastWitness) continue;
      if (feasibleMask(ctx, masks[k].mask, budget, rows, 30000)) {
        lastWitness = k;
        mem.pruneCache[cacheKey] = best;
        return false;
      }
    }
    mem.pruneCache[cacheKey] = true;                      // no better kill-set is feasible
    return true;
  }

  function fightHash(s) {
    var h = '';
    for (var i = 0; i < s.units.length; i++) {
      var x = s.units[i];
      h += ((x.q + 8) * 24 + (x.r + 8)) + '.' + (x.hp > 0 ? x.hp : 0) +
        (x.cooldown ? (x.cooldown === 'ROUT' ? 'r' : 'a') : '') +
        (x.applied && x.applied.length ? 'd' + x.applied.length : '') + ';';
    }
    return h;
  }
  function fightOut(st, startLine, maxNodes) {
    var seen = {}, fnodes = 0;
    var localBest = { str: E.strKilledOf(st), orders: POOL - st.orders, line: null };
    (function rec(s, line) {
      if (Date.now() > deadline) return;
      if (fnodes++ > maxNodes) { stats.fightCapped++; return; }
      var str = E.strKilledOf(s), used = POOL - s.orders;
      if (str > localBest.str || (str === localBest.str && used < localBest.orders)) {
        localBest.str = str; localBest.orders = used; localBest.line = line.slice();
      }
      if (stateBound(ctx, s, function () { return false; }) < Math.max(localBest.str, curBest(inc))) return;
      var opts2 = [];
      s.units.forEach(function (u) {
        if (u.player !== 0 || u.hp <= 0 || !E.canAttack(s, u)) return;
        // rank by the realistic table (cheap) instead of engine damage
        // previews — ordering only, legality still comes from applyAction
        var o = ctx.OPT[u.id];
        var row = o.tiles0[key(u.q, u.r)] || o.stat;
        E.attackTargets(s, u).forEach(function (t) {
          var ri = ctx.ridx[t.id];
          var v = ri === undefined ? 0 : row[ri];
          if (o.rout && ri !== undefined && o.routFire0[ri] > v) v = o.routFire0[ri];
          opts2.push({ unit: u.id, target: t.id, rank: (v >= t.hp ? 1000 : 0) + v });
        });
      });
      opts2.sort(function (a, b) { return b.rank - a.rank; });
      opts2.forEach(function (o) {
        var ns;
        try { ns = E.applyAction(s, { type: 'attack', unit: o.unit, target: o.target }); }
        catch (e) { return; }
        checkBlow(ctx, s, ns, o.unit, o.target);
        var h = fightHash(ns);
        var uu = POOL - ns.orders;
        if (seen[h] !== undefined && seen[h] <= uu) return;
        seen[h] = uu;
        rec(ns, line.concat([{ type: 'attack', unit: o.unit, target: o.target }]));
      });
    })(st, []);
    if (localBest.line) {
      noteBest(inc, localBest.str, localBest.orders, startLine.concat(localBest.line),
        'deployment ' + stats.leaves);
    }
  }

  function evalLeaf(assignment) {
    // assignment: array of {unitIdx, seat} in `order` order. Resolve symmetry:
    // choose the min-cost member<->tile pairing within each class.
    var byClass = {};
    assignment.forEach(function (a) {
      var b = ctx.BLUE[a.unitIdx];
      var sig = classOf[b.id];
      (byClass[sig] = byClass[sig] || []).push(a);
    });
    var placement = {};   // unit id -> seat entry from ITS OWN list
    var cost = 0, training = 0, ok = true;
    Object.keys(byClass).forEach(function (sig) {
      if (!ok) return;
      var group = byClass[sig];
      var ids = group.map(function (a) { return ctx.BLUE[a.unitIdx].id; });
      var tiles = group.map(function (a) { return a.seat.key; });
      // try all pairings (classes are tiny) and keep the cheapest legal one
      var best = null;
      (function perm(rem, chosen) {
        if (!rem.length) {
          var c = 0, t2 = 0, legal = true;
          chosen.forEach(function (p) {
            var s = ctx.SEAT3[p.id][p.tile];
            if (!s) { legal = false; return; }
            c += s.orders;
            if (s.march) t2 += GLOB.UNIT_MARCH_COST;
          });
          if (legal && (best === null || c < best.c)) best = { c: c, t: t2, pairs: chosen.slice() };
          return;
        }
        for (var j = 0; j < rem.length; j++) {
          var nr = rem.slice(); nr.splice(j, 1);
          perm(nr, chosen.concat([{ id: ids[group.length - rem.length], tile: rem[j] }]));
        }
      })(tiles, []);
      if (!best) { ok = false; return; }
      cost += best.c; training += best.t;
      best.pairs.forEach(function (p) { placement[p.id] = p.tile; });
    });
    if (!ok || cost > POOL || training > ctx.INIT.training) { stats.illegal++; return; }

    var sig2 = Object.keys(placement).map(function (id) {
      return classOf[id] + '@' + placement[id];
    }).sort().join(';') + '|' + Math.min(POOL - cost, 63);
    if (mem.fightMemo[sig2]) { stats.dedup++; return; }
    mem.fightMemo[sig2] = 1;

    // walk in: cheapest first, 3 passes for ally-blocked destinations
    var tW0 = Date.now();
    var st = E.cloneState(ctx.INIT);
    var startLine = [];
    var todo = Object.keys(placement).map(function (id) {
      var s = ctx.SEAT3[id][placement[id]];
      var t = placement[id].split(',');
      return { id: +id, q: +t[0], r: +t[1], orders: s.orders, march: s.march };
    }).filter(function (x) { return x.orders > 0; })
      .sort(function (a, b) { return a.orders - b.orders; });
    for (var pass = 0; pass < 3 && todo.length; pass++) {
      var again = [];
      todo.forEach(function (x) {
        try {
          if (x.march && !E.unitById(st, x.id).march) {
            st = E.applyAction(st, { type: 'march', unit: x.id });
            startLine.push({ type: 'march', unit: x.id });
          }
          st = E.applyAction(st, { type: 'move', unit: x.id, q: x.q, r: x.r });
          startLine.push({ type: 'move', unit: x.id, q: x.q, r: x.r });
        } catch (e) { again.push(x); }
      });
      todo = again;
    }
    if (todo.length) { stats.illegal++; return; }
    stats.leaves++;
    stats.tWalk += Date.now() - tW0;
    var tF0 = Date.now();
    fightOut(st, startLine, FCAP);
    stats.tFight += Date.now() - tF0;
    if (stats.leaves % 20000 === 0) {
      console.log('  … ' + stats.leaves + ' deployments fought, best ' + (inc.str / 10) + ' STR');
    }
  }

  // Best-first over the assignment TREE: nodes are partial assignments,
  // collision-free by construction; priority = chosen seat scores + an
  // optimistic completion (each unassigned unit's best seat, collisions
  // ignored). This is the arrival order that made deploy_fight's heap find
  // hard deployments early, without its failure mode — the heap never holds
  // a colliding or unaffordable vector, and popped nodes are killed by the
  // kill-set bound (cached) before their subtree is generated.
  // Symmetry duplicates (class members with seats exchanged) are not pruned
  // during descent — members can have different reachable sets, so a
  // canonical-order skip loses real deployments. The leaf dedupes identical
  // fights by class signature instead.
  var suffixBest = new Array(order.length + 1).fill(0);
  for (var sb = order.length - 1; sb >= 0; sb--) {
    var top = 0;
    lists[order[sb]].forEach(function (s) { top = Math.max(top, s.score); });
    suffixBest[sb] = suffixBest[sb + 1] + top;
  }
  var heap = [];                                          // max-heap on f
  function hpush(n) {
    heap.push(n);
    var i2 = heap.length - 1;
    while (i2 > 0) {
      var par = (i2 - 1) >> 1;
      if (heap[par].f >= heap[i2].f) break;
      var t2 = heap[par]; heap[par] = heap[i2]; heap[i2] = t2; i2 = par;
    }
  }
  function hpop() {
    var top2 = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      var i2 = 0;
      for (;;) {
        var l = 2 * i2 + 1, r2 = l + 1, m = i2;
        if (l < heap.length && heap[l].f > heap[m].f) m = l;
        if (r2 < heap.length && heap[r2].f > heap[m].f) m = r2;
        if (m === i2) break;
        var t2 = heap[m]; heap[m] = heap[i2]; heap[i2] = t2; i2 = m;
      }
    }
    return top2;
  }
  // Lazy-successor best-first: a heap node commits ONE unit to ONE seat and
  // stands in for its whole not-yet-generated sibling tail — popping it pushes
  // the next sibling and its own first child, so the heap stays O(pops)
  // instead of O(pops × branching), which is what drowned the naive A*.
  // node: {p: parent (or null), d: depth (unit index in `order`), si: seat
  // rank, g: score sum through this seat, cost, f}
  var W = process.env.W ? parseFloat(process.env.W) : 1;
  function nodeSeat(n) { return lists[order[n.d]][n.si]; }
  function clashes(chainTop, seatKey) {
    for (var w = chainTop; w; w = w.p) if (nodeSeat(w).key === seatKey) return true;
    return false;
  }
  // root partition for worker parallelism: worker w of K owns the root seats
  // with rank ≡ w (mod K); the union over workers is the whole tree
  var partW = opts.partW || 0, partK = opts.partK || 1;
  // first valid seat rank >= si for depth d under ancestor chain `p`
  function firstValid(p, d, si, gBase, costBase) {
    var list = lists[order[d]];
    for (; si < list.length; si++) {
      if (d === 0 && partK > 1 && si % partK !== partW) continue;
      var seat = list[si];
      if (clashes(p, seat.key)) continue;
      var c2 = costBase + seat.classMin;
      if (c2 + suffixMin[d + 1] > POOL) { stats.costCut++; continue; }
      return { p: p, d: d, si: si, g: gBase + seat.score, cost: c2,
        f: gBase + W * (seat.score + suffixBest[d + 1]) };
    }
    return null;
  }
  var root = firstValid(null, 0, 0, 0, 0);
  if (root) hpush(root);
  var HEAPCAP = 2000000;
  var exhausted = true;
  while (heap.length) {
    if (Date.now() > deadline) { exhausted = false; break; }
    if (heap.length > HEAPCAP) { exhausted = false; break; }        // coverage lost
    var node = hpop();
    // sibling first: the tail this node stood in for lives on
    var sib = firstValid(node.p, node.d, node.si + 1,
      node.p ? node.p.g : 0, node.p ? node.p.cost : 0);
    if (sib) hpush(sib);
    // materialise the assignment chain once
    var assignment = [], pfx = [];
    for (var w2 = node; w2; w2 = w2.p) assignment.push({ unitIdx: order[w2.d], seat: nodeSeat(w2) });
    assignment.reverse();
    var pinned = {};
    for (var ai = 0; ai < assignment.length; ai++) {
      pinned[ctx.BLUE[assignment[ai].unitIdx].id] = assignment[ai].seat.key;
      pfx.push(assignment[ai].unitIdx + '@' + assignment[ai].seat.key);
    }
    var tP0 = Date.now();
    var cut = restrictedPrune(pinned, node.cost, pfx.join('|'));
    stats.tPrune += Date.now() - tP0;
    if (cut) { stats.boundCut++; continue; }
    if (node.d === order.length - 1) { evalLeaf(assignment); continue; }
    var child = firstValid(node, node.d + 1, 0, node.g, node.cost);
    if (child) hpush(child);
  }
  stats.exhausted = exhausted && !heap.length && !plan;   // plan lists are truncated
  console.log('  stage3' + (plan ? '[plan ' + (plan.str / 10) + ']' : '') +
    ' ' + (stats.exhausted ? 'EXHAUSTED the deployment tree' :
      !heap.length ? 'plan tree done' :
      heap.length > HEAPCAP ? 'stopped (heap cap)' : 'stopped (deadline)') +
    ' · leaves ' + stats.leaves + ' · dedup ' + stats.dedup + ' · boundCut ' + stats.boundCut +
    ' · costCut ' + stats.costCut + ' · illegal ' + stats.illegal +
    (stats.fightCapped ? ' · fightCapped ' + stats.fightCapped : '') +
    ' · best ' + (inc.str / 10) +
    '   [walk ' + stats.tWalk + 'ms, fight ' + stats.tFight + 'ms, prune ' + stats.tPrune + 'ms]');
  return stats;
}

// ---------------------------------------------------- big-board schedule ----
// Plan slices over the top kill-sets, then the full coverage search. Shared
// verbatim by the single-threaded path and each worker (with its root slice).
function scheduleBig(ctx, inc, DEADLINE, SECONDS, masks, s3state, partW, partK) {
  var POOL = ctx.POOL;
  var walkRows = fullRows(ctx, 'walk');
  var plans = [];
  for (var mi = 0; mi < masks.length && plans.length < 10; mi++) {
    var outw = {};
    if (feasibleMask(ctx, masks[mi].mask, POOL, walkRows, 300000, outw) && outw.assign) {
      plans.push({ mask: masks[mi].mask, str: masks[mi].str, assign: outw.assign });
    }
  }
  var planBudget = Math.max(20, SECONDS * 0.35) * 1000;
  var perPlan = Math.max(15000, planBudget / Math.max(1, plans.length));
  console.log('--- stage3 (plan slices: ' + plans.length + ' kill-sets)' +
    (partK > 1 ? ' [worker ' + partW + '/' + partK + ']' : ''));
  var s3 = null;
  for (var pi = 0; pi < plans.length; pi++) {
    if (Date.now() + 5000 > DEADLINE) break;
    if (plans[pi].str <= curBest(inc)) continue;          // already beaten
    var pEnd = Math.min(DEADLINE, Date.now() + perPlan);
    s3 = stage3(ctx, inc, pEnd, { masks: masks, state: s3state, plan: plans[pi],
      partW: partW, partK: partK });
  }
  if (Date.now() < DEADLINE) {
    console.log('--- stage3 (full)' + (partK > 1 ? ' [worker ' + partW + '/' + partK + ']' : ''));
    s3 = stage3(ctx, inc, DEADLINE, { masks: masks, state: s3state,
      partW: partW, partK: partK });
  }
  return s3;
}

// -------------------------------------------------------- worker harness ----
// The tree is split at the root (seat rank mod K); each worker runs the full
// big-board schedule on its slice. The incumbent STRENGTH is shared through a
// SharedArrayBuffer so sync search loops can read it with Atomics; the lines
// themselves come back over postMessage.
function runParallel(P, POOL, SEED, DEADLINE, K, ctx, inc, masks) {
  var sab = new SharedArrayBuffer(4);
  new Int32Array(sab)[0] = SEED || 0;
  var best = { str: SEED || 0, orders: 0, line: null };
  var agg = { leaves: 0, dedup: 0, boundCut: 0, exhausted: true, tainted: false };
  var left = K;
  console.log('--- stage3 across ' + K + ' workers');
  for (var w = 0; w < K; w++) {
    var wk = new WT.Worker(__filename, { workerData: {
      v2worker: 1, puzzle: P, pool: POOL, seed: SEED, w: w, k: K,
      msLeft: DEADLINE - Date.now(), sab: sab } });
    wk.on('message', function (m) {
      if (m.type === 'best') {
        if (m.str > best.str || (m.str === best.str && best.line && m.orders < best.orders) ||
            (m.str === best.str && !best.line)) best = m;
      } else if (m.type === 'done') {
        agg.leaves += m.stats.leaves; agg.dedup += m.stats.dedup;
        agg.boundCut += m.stats.boundCut;
        agg.fightCapped = (agg.fightCapped || 0) + (m.stats.fightCapped || 0);
        agg.exhausted = agg.exhausted && m.stats.exhausted;
        agg.tainted = agg.tainted || m.tainted;
      }
    });
    wk.on('exit', function () {
      if (--left) return;
      console.log('workers done · leaves ' + agg.leaves + ' · dedup ' + agg.dedup +
        ' · boundCut ' + agg.boundCut);
      inc.str = best.str; inc.orders = best.orders; inc.line = best.line;
      inc.fromSeed = !best.line && best.str > 0;
      if (agg.tainted) TAINted = true;
      verdict(ctx, inc, PARENT_U.U, PARENT_U.U0, null,
        { exhausted: agg.exhausted, fightCapped: agg.fightCapped });
    });
  }
}
var PARENT_U = { U: null, U0: null };

function workerMain(wd) {
  var POOL = wd.pool;
  var ctx = build(wd.puzzle, POOL);
  var masks = ctx.NR <= 20 ? sortedMasks(ctx) : null;
  var inc = mkIncumbent(wd.seed, new Int32Array(wd.sab));
  inc.onBest = function (i) {
    WT.parentPort.postMessage({ type: 'best', str: i.str, orders: i.orders, line: i.line });
  };
  var DEADLINE = Date.now() + wd.msLeft;
  var s3state = { fightMemo: {}, pruneCache: {} };
  var s3 = masks ? scheduleBig(ctx, inc, DEADLINE, wd.msLeft / 1000, masks, s3state, wd.w, wd.k)
                 : stage3(ctx, inc, DEADLINE, { masks: null, state: s3state, partW: wd.w, partK: wd.k });
  WT.parentPort.postMessage({ type: 'done',
    stats: { leaves: s3 ? s3.leaves : 0, dedup: s3 ? s3.dedup : 0,
      boundCut: s3 ? s3.boundCut : 0, exhausted: !!(s3 && s3.exhausted),
      fightCapped: s3 ? s3.fightCapped : 0 },
    tainted: TAINted });
}

// ----------------------------------------------------------------- main ----
function replay(ctx, line) {
  var s = E.loadPuzzle(ctx.base);
  line.forEach(function (o, i) {
    var u = E.unitById(s, o.unit);
    var msg = o.type === 'move' ? E.nameOf(u) + ' -> (' + o.q + ',' + o.r + ')'
            : o.type === 'march' ? E.nameOf(u) + ' force marches'
            : E.nameOf(u) + ' attacks ' + E.nameOf(E.unitById(s, o.target));
    s = E.applyAction(s, o);
    console.log('  ' + (i + 1) + '. ' + msg + '   [' + s.log[s.log.length - 1] + ']');
  });
  var killed = s.units.filter(function (u) { return u.player === 1 && u.hp <= 0; });
  var str = killed.reduce(function (a, u) { return a + STRV(u); }, 0);
  return { str: str, orders: ctx.POOL - s.orders };
}

function main() {
  var SRC = process.argv[2];
  if (!SRC) {
    console.error('usage: node tools/verify2.js <puzzle.json|def.js> [pool] [seconds] [seedStrX10]');
    process.exit(1);
  }
  var P = /\.json$/.test(SRC)
    ? (function () { var j = JSON.parse(require('fs').readFileSync(SRC, 'utf8')); return j.puzzle || j; })()
    : require(path.resolve(SRC));
  var POOL = parseInt(process.argv[3], 10) || E.poolOrders(P);
  var SECONDS = parseInt(process.argv[4], 10) || 600;
  var SEED = parseInt(process.argv[5], 10) || 0;
  var DEADLINE = Date.now() + SECONDS * 1000;

  var t0 = Date.now();
  var ctx = build(P, POOL);
  console.log('pool ' + POOL + ' orders, training ' + ctx.INIT.training +
    ', ' + ctx.BLUE.length + ' blue vs ' + ctx.NR + ' red' +
    (ctx.PUSHK ? ' (push drift K=' + ctx.PUSHK + ')' : ''));
  ctx.BLUE.forEach(function (u) {
    console.log('  ' + u.type.replace('UNIT_', '').toLowerCase() + ': ' +
      Object.keys(ctx.SEAT[u.id]).length + ' seats');
  });
  console.log('tables built in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  // ---- stage 1: kill-set upper bounds
  var masks = null, U = null, U0 = null;
  if (ctx.NR <= 20) {
    masks = sortedMasks(ctx);
    var infeasible = [];
    var r0 = upperBound(ctx, masks, fullRows(ctx, 'free'), POOL, infeasible);
    U0 = r0.U;
    var r1 = upperBound(ctx, masks, fullRows(ctx, 'walk'), POOL, infeasible);
    U = r1.U;
    console.log('stage1: U0=' + (U0 / 10) + ' (travel-free, unconditional), U=' + (U / 10) +
      ' (walking travel floors, assumes no swap shortcuts); kill-sets refuted above U: ' + r1.refuted);
  } else {
    console.log('stage1: skipped (' + ctx.NR + ' reds > 20)');
  }
  PARENT_U.U = U; PARENT_U.U0 = U0;

  var inc = mkIncumbent(SEED);
  var s3state = { fightMemo: {}, pruneCache: {} };

  // ---- plan slices + full search for big boards, possibly across workers;
  // small boards keep the generic slice that arrives at good deployments on
  // its own, plus the exact stage-2 search.
  var S2MAX = process.env.S2MAX ? parseInt(process.env.S2MAX, 10) : 8;
  var s3 = null;
  if (masks && ctx.BLUE.length > S2MAX) {
    var WORKERS = process.env.V2_WORKERS !== undefined ? parseInt(process.env.V2_WORKERS, 10)
      : Math.max(1, Math.min(8, require('os').cpus().length - 2));
    if (WORKERS > 1) {
      runParallel(P, POOL, SEED, DEADLINE, WORKERS, ctx, inc, masks);
      return;                                             // verdict printed there
    }
    s3 = scheduleBig(ctx, inc, DEADLINE, SECONDS, masks, s3state, 0, 1);
  } else {
    var sliceEnd = Math.min(DEADLINE, Date.now() + Math.max(20, SECONDS * 0.2) * 1000);
    console.log('--- stage3 (finder slice)');
    s3 = stage3(ctx, inc, sliceEnd, { masks: masks, state: s3state });
  }

  // ---- stage 2: exhaustive in-state search on small boards. It gets a
  // bounded slice — if it can't finish in that, stage 3 covers more ground
  // per second and gets the rest.
  var s2 = null;
  if (ctx.BLUE.length <= S2MAX && !(U !== null && inc.str >= U)) {
    var lateLevels = process.env.LATE !== undefined ? [parseInt(process.env.LATE, 10)] : [0, 1, 2, 3];
    var s2end = Math.min(DEADLINE, Date.now() + Math.max(30, (DEADLINE - Date.now()) * 0.4 / 1000) * 1000);
    console.log('--- stage2 (exact in-state search)');
    s2 = stage2(ctx, inc, s2end, lateLevels);
  }

  // ---- stage 3 full run with the remaining time
  if (!(s2 && s2.complete) && !(U !== null && inc.str >= U) && Date.now() < DEADLINE) {
    console.log('--- stage3 (full)');
    s3 = stage3(ctx, inc, DEADLINE, { masks: masks, state: s3state });
    // a completed stage2 slice may still be pending; give it the tail end
    if (s3.exhausted && s2 && !s2.complete && Date.now() < DEADLINE && ctx.BLUE.length <= S2MAX) {
      console.log('--- stage2 (resumed)');
      s2 = stage2(ctx, inc, DEADLINE,
        process.env.LATE !== undefined ? [parseInt(process.env.LATE, 10)] : [0, 1, 2, 3]);
    }
  }

  verdict(ctx, inc, U, U0, s2, s3);
}

function verdict(ctx, inc, U, U0, s2, s3) {
  console.log('\nbest: ' + (inc.str / 10) + ' STR in ' + inc.orders + ' orders');
  if (inc.line) {
    var rep = replay(ctx, inc.line);
    console.log('verified: ' + (rep.str / 10) + ' STR in ' + rep.orders + ' orders' +
      (rep.str === inc.str && rep.orders === inc.orders ? '  ✓ matches' : '  ✗ MISMATCH'));
  } else if (inc.str > 0) {
    console.log('  (best value came from the seed; no line to replay)');
  }
  var proven = false, why = [];
  if (TAINted) {
    why.push('OPT violation observed — nothing here is proven');
  } else {
    if (U0 !== null && inc.str >= U0) { proven = true; why.push('matches U0 (unconditional kill-set bound)'); }
    else if (U !== null && inc.str >= U) {
      proven = true;
      why.push('matches U (kill-set bound; assumes no swap travel shortcuts)');
    }
    if (s2 && s2.complete) {
      proven = true;
      why.push('stage2 search complete (model: single move per unit + ≤3 mid-fight moves, march, no swap/anchor)');
    }
    if (s3 && s3.exhausted) {
      why.push('stage3 exhausted the deployment space (model: walk-then-fight, no mid-fight moves' +
        (s3.fightCapped ? '; ' + s3.fightCapped + ' fights hit the node cap' : '') + ')');
    }
  }
  if (proven) {
    console.log('verdict: PROVEN ceiling ' + (inc.str / 10) + ' STR — ' + why.join('; '));
  } else {
    console.log('verdict: best known ' + (inc.str / 10) + ' STR' +
      (U !== null ? '; upper bound ' + (U / 10) + ' STR (U0=' + (U0 / 10) + ')' : '') +
      (why.length ? ' — ' + why.join('; ') : ''));
  }
}

module.exports = { build: build, feasibleMask: feasibleMask, fullRows: fullRows,
  sortedMasks: sortedMasks, upperBound: upperBound, stateBound: stateBound, gAD: gAD };

if (!WT.isMainThread && WT.workerData && WT.workerData.v2worker) workerMain(WT.workerData);
else if (require.main === module) main();
