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
//        V2_LNS_SEED=n PRNG seed for the ALNS destroy-set draws (default 0xC0FFEE)
//        V2_LNS_T3=n   ALNS triple budget per stall on >8-blue boards (default 40)
//        V2_LNS_CAP=n  candidates per LNS rebuild on >8-blue boards (default 600)
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
      var lim = r.zealot && r.hp > 1 ? r.hp - 1 : r.hp;   // at 1 hp any blow kills (engine.js:428)
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
    var lim = r.zealot && r.hp > 1 ? r.hp - 1 : r.hp;   // at 1 hp any blow kills (engine.js:428)
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
    var lim = hasFlag(ctx.REDS[i], 'bLastStand') && R.hp > 1 ? R.hp - 1 : R.hp; // at 1 hp any blow kills (engine.js:428)
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
// The move model is explicit and reported: up to `moves` move ACTIONS per
// unit (each action is already a full multi-step walk), destinations to seat
// tiles or any tile, swaps on or off. Bottleneck's real 35-STR line needs
// 3 move actions per unit, ~7 mid-fight moves, AND pure waiting tiles that
// hit nothing — a model narrower than that "completes" at 30 and proves
// nothing about the game. `improveOnly` prunes equal-value branches: right
// for hunting a higher ceiling, wrong for minimising par.
function stage2(ctx, inc, deadline, lateLevels, m) {
  m = m || {};
  var POOL = ctx.POOL;
  var MOVES = m.moves !== undefined ? m.moves : (process.env.MOVES ? parseInt(process.env.MOVES, 10) : 1);
  var SWAPS = m.swaps !== undefined ? m.swaps : process.env.SWAPS === '1';
  var ALLTILES = m.alltiles !== undefined ? m.alltiles : process.env.ALLTILES === '1';
  var IMPROVE = !!m.improveOnly;
  var ATTFIRST = !!m.attackFirst;
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
      function mayMove(u) { return (moved[u.id] || 0) < MOVES && !(fought && lateUsed >= L); }
      var b2 = stateBound(ctx, s, mayMove);
      if (IMPROVE ? b2 <= curBest(inc) : b2 < curBest(inc)) return;

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
          if (rt.orders > s.orders) return;
          // ALLTILES=1 lifts the seat filter: any reachable tile is a legal
          // destination, including pure waiting tiles. Slower, but the only
          // way a stage-2 completion approaches a full-play claim.
          if (!ALLTILES && (!ctx.SEAT[u.id].hasOwnProperty(k) || ctx.SEAT[u.id][k].march)) return;
          var punch = row[k] ? Math.max.apply(null, row[k]) : 0;
          moves.push({ act: [{ type: 'move', unit: u.id, q: rt.q, r: rt.r }],
            unit: u.id, rank: punch * 4 - rt.orders });
        });
        // swaps: two adjacent allies exchange tiles for ONE order — the only
        // way to pass in a one-wide corridor, and how Bottleneck's real
        // 35-STR line gets its slinger forward. Counts as a move for both.
        if (SWAPS) {
          s.units.forEach(function (v) {
            if (v.player !== 0 || v.id <= u.id) return;
            if (!mayMove(v) || !E.canSwap(s, u, v)) return;
            moves.push({ act: [{ type: 'swap', unit: u.id, target: v.id }],
              unit: u.id, unit2: v.id, rank: -1 });
          });
        }
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
      // wide passes engage first and reposition second: their move lists are
      // dominated by zero-punch waiting tiles, and walking those first buries
      // the fight thousands of plies deep
      var opts = (fought || ATTFIRST) ? attacks.concat(moves) : moves.concat(attacks);

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
        var last = o.act[o.act.length - 1].type;
        var isMove = last === 'move' || last === 'swap';
        var nm = moved, nl = lateUsed;
        if (isMove) {
          nm = Object.assign({}, moved); nm[o.unit] = (nm[o.unit] || 0) + 1;
          if (o.unit2 !== undefined) nm[o.unit2] = (nm[o.unit2] || 0) + 1;
          if (fought) nl = lateUsed + 1;
        }
        var h = ns.units.map(function (x) {
          return x.id + ':' + x.q + ',' + x.r + ':' + Math.max(0, x.hp) + ':' + (x.cooldown || 0) +
            ':' + (x.steps || 0) + ':' + (x.march ? 1 : 0) + ':' + ((x.applied || []).join('+'));
        }).join(';') + '|' + Object.keys(nm).sort().map(function (k2) {
          return k2 + ':' + nm[k2];
        }).join(',') + '|' + nl;
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
  var model = '≤' + MOVES + ' move action' + (MOVES === 1 ? '' : 's') + '/unit to ' +
    (ALLTILES ? 'any tile' : 'seat tiles') + ', ≤' + lateLevels[lateLevels.length - 1] +
    ' mid-fight moves, swaps ' + (SWAPS ? 'on' : 'OFF') + ', march, no anchor';
  return { complete: allComplete, nodes: nodes, model: model };
}

// ----------------------------- stage 2u: TRUE full-play in-state search ----
// The engine's own legalActions, no synthetic move rations, no seat filter,
// swaps and lazy march included — transpositions merge on the board state
// alone, which is why this searches FEWER states than a "widened" rationed
// model whose budget counters fragment the space. Completing this IS a
// full-play proof of the ceiling (fortify is skipped: it costs an order,
// ends the unit's turn, and only changes how hard BLUES are to kill — reds
// never attack during the puzzle turn, so it cannot affect red deaths).
// Improvement-only: it hunts a higher ceiling, not a cheaper line.
function stage2u(ctx, inc, deadline) {
  var POOL = ctx.POOL;
  var nodes = 0, complete = true;
  var seen = new Map();
  function mayMoveAlways() { return true; }
  (function rec(s, line) {
    if (Date.now() > deadline) { complete = false; return; }
    nodes++;
    noteBest(inc, E.strKilledOf(s), POOL - s.orders, line.length ? line.slice() : null,
      'full-play node ' + nodes);
    if (stateBound(ctx, s, mayMoveAlways) <= curBest(inc)) return;
    var acts = E.legalActions(s);
    for (var i = 0; i < acts.length; i++) {
      if (Date.now() > deadline) { complete = false; return; }
      var a = acts[i];
      if (a.type === 'fortify') continue;
      var ns;
      try { ns = E.applyAction(s, a); } catch (e) { continue; }
      if (a.type === 'attack') checkBlow(ctx, s, ns, a.unit, a.target);
      var h = ns.units.map(function (x) {
        return x.q + ',' + x.r + ',' + Math.max(0, x.hp) + ',' + (x.cooldown || 0) + ',' +
          x.steps + ',' + (x.march ? 1 : 0) + ',' + ((x.applied || []).join('+')) + ',' +
          (x.anchored ? 1 : 0) + ',' + (x.unlimbered ? 1 : 0) + ',' + (x.fortifyTurns || 0);
      }).join(';') + '|' + ns.training;
      var used = POOL - ns.orders;
      var prev = seen.get(h);
      if (prev !== undefined && prev <= used) continue;
      if (seen.size < 30000000) seen.set(h, used);
      rec(ns, line.concat([a]));
    }
  })(E.loadPuzzle(ctx.base), []);
  console.log('  stage2u (full play) ' + (complete ? 'COMPLETE' : 'TIMED OUT') +
    ' · nodes ' + nodes + ' · best ' + (inc.str / 10));
  return { complete: complete, nodes: nodes, fullPlay: true,
    model: 'full legal play — engine legalActions, fortify excluded (provably irrelevant to maxKill)' };
}

// ------------------------------------------- seat lists (search order) ----
// The exact per-unit seat lists and unit processing order stage3 searches.
// Extracted so V2_TRACE_LINE can report the REAL rank of a human line's
// seats in the current ordering — misranking data drives heuristic work.
function buildSeatLists(ctx, opts) {
  opts = opts || {};
  var LAMBDA = process.env.LAMBDA ? parseFloat(process.env.LAMBDA) : 6;
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
  // expressive mode admits the speculative seats (deferred walk-ins, rout-
  // shared tiles). Plain mode is the exact old tree — the arrival order that
  // finds real lines on live-seat boards. Plans are always expressive: the
  // seats a witness allocation needs are often exactly the deferred ones.
  var EXPR = !!(opts.expressive || plan);
  var PLANK = process.env.PLANK ? parseInt(process.env.PLANK, 10) : 8;
  var DEFPEN = process.env.DEFPEN ? parseFloat(process.env.DEFPEN) : (plan ? 0 : 10);
  // A unit's seats are its live-reach tiles (walk in before the fight) PLUS
  // the cleared-reach-only tiles — ground that opens when reds die: their own
  // tiles, tiles behind their ZOC. Those are DEFERRED: claimed in the tree,
  // walked into DURING the fight when the engine says the walk is legal.
  // Their cost is the cleared-board cost — a lower bound; the real cost is
  // whatever the engine charges at execution.
  function seatEntry(uid, k) {
    var s3 = ctx.SEAT3[uid][k];
    if (s3) return { orders: s3.orders, march: s3.march, deferred: false };
    var s = ctx.SEAT[uid][k];
    if (s) return { orders: s.orders, march: s.march, deferred: true };
    return null;
  }
  var lists = ctx.BLUE.map(function (b) {
    var o = ctx.OPT[b.id];
    var assigned = plan && plan.assign[b.id] ? plan.assign[b.id].primOn : 0;
    var inMask = plan ? plan.mask : (1 << ctx.NR) - 1;
    var keys = Object.keys(EXPR ? ctx.SEAT[b.id] : ctx.SEAT3[b.id]);
    if (EXPR) {
      Object.keys(ctx.SEAT3[b.id]).forEach(function (k) {
        if (keys.indexOf(k) < 0) keys.push(k);
      });
    }
    // which reds can this unit hit from any IMMEDIATE seat? A deferred seat
    // that reaches a red the unit cannot otherwise touch is not speculative —
    // it is the unit's only door (Closing In: the axeman's target is walled
    // off by rivers until the first kill vacates the tile between them), and
    // burying it behind every immediate seat hides the only winning lines.
    var hasImm = new Array(ctx.NR).fill(false);
    Object.keys(ctx.SEAT3[b.id]).forEach(function (k) {
      var row = o.tiles[k];
      if (!row) return;
      for (var i = 0; i < ctx.NR; i++) if (row[i] > 0) hasImm[i] = true;
    });
    var list = keys.map(function (k) {
      var seat = seatEntry(b.id, k);
      var t = k.split(','), tile = { q: +t[0], r: +t[1] };
      var essential = false;
      if (seat.deferred) {
        var row0 = o.tiles[k];
        for (var ei = 0; ei < ctx.NR; ei++) {
          if (row0 && row0[ei] > 0 && !hasImm[ei]) { essential = true; break; }
        }
      }
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
        var s2 = seatEntry(uid, k);
        if (s2 && s2.orders < minCost) minCost = s2.orders;
      });
      // a deferred seat is speculative — it only exists after the right kill —
      // so it must not outrank the immediate seats that make those kills.
      // UNLESS it is essential (the unit's only access to some red): then it
      // ranks with the immediates on merit.
      var defPen = seat.deferred && !essential ? DEFPEN : 0;
      // in plan mode the witness has already certified affordability, so
      // travel is a tiebreak, not a tax — a heavy LAMBDA buries the marched
      // or far seat whose BLOW the allocation is counting on (Closing In:
      // the 7-damage march seat lost to cheap 5-damage seats and the fight
      // came up one point short on a 20-hp axeman)
      var LAM = plan ? 1 : LAMBDA;
      return { key: k, q: tile.q, r: tile.r, orders: seat.orders, march: seat.march,
        deferred: seat.deferred, essential: essential, rout: ctx.OPT[b.id].rout,
        classMin: minCost, score: own + ally - LAM * seat.orders - defPen };
    }).sort(plan
      // plans rank purely by contribution — the witness's seats may all be deferred
      ? function (a, b) { return b.score - a.score || a.orders - b.orders; }
      // otherwise immediates (and essential deferred) first, luxuries behind
      : function (a, b) {
        var da = a.deferred && !a.essential ? 1 : 0;
        var db = b.deferred && !b.essential ? 1 : 0;
        return da - db || b.score - a.score || a.orders - b.orders;
      });
    if (plan) {
      // truncation exists for the 11-unit board's sake; on small boards it
      // is pure loss — the human lines use collision-driven SUBOPTIMAL seats
      // (king's 13-damage march seat over its 15-damage collidng one) that
      // no per-red retention heuristic anticipates. Full lists, plan-scored.
      if (ctx.BLUE.length <= 8) return list;
      var kept = list.slice(0, PLANK);
      function retain(k2) {
        if (!kept.some(function (s) { return s.key === k2; })) {
          var extra = list.filter(function (s) { return s.key === k2; })[0];
          if (extra) kept.push(extra);
        }
      }
      // PLANK truncation must never cut the seats that any allocation of
      // this MASK could depend on: for each red in the mask, retain the
      // unit's strongest seat against that red. The witness is one arbitrary
      // allocation — keying retention on it alone left king's marched
      // 13-damage seat off the list because the witness happened to assign
      // that unit elsewhere, and the human /20 deployment was unreachable.
      ctx.REDS.forEach(function (R, i) {
        if (!(inMask & (1 << i))) return;
        var bestK = null, bestV = 0;
        list.forEach(function (s) {
          var v = o.tiles[s.key][i] || 0;
          if (v > bestV) { bestV = v; bestK = s.key; }
        });
        if (bestK) retain(bestK);
      });
      // and the start seat, so a unit can sit out of a plan
      retain(key(b.q, b.r));
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
  return { classOf: classOf, classes: classes, seatEntry: seatEntry,
    lists: lists, order: order };
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
    tWalk: 0, tFight: 0, tPrune: 0, fightCapped: 0, gateCut: 0 };
  // fights are exact except in plan (finder) passes, where a node cap keeps
  // the leaf rate up; a capped fight is honesty-tracked in the verdict
  var FCAP = process.env.FCAP ? parseInt(process.env.FCAP, 10)
    : (opts.plan ? 2500 : Infinity);

  var built = buildSeatLists(ctx, { plan: opts.plan, expressive: opts.expressive });
  var classOf = built.classOf, classes = built.classes, seatEntry = built.seatEntry;
  var lists = built.lists, order = built.order;
  var plan = opts.plan || null;
  var EXPR = !!(opts.expressive || plan);
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
  // `pending`: units whose assigned seat was not walkable before the fight —
  // deferred seats (ground that opens when reds die) and second claimants of
  // a rout-shared tile. The fight offers each its ONE deployment walk as an
  // action whenever the engine says the walk is now legal.
  function fightOut(st, startLine, maxNodes, pending) {
    pending = pending || [];
    var seen = {}, fnodes = 0;
    var localBest = { str: E.strKilledOf(st), orders: POOL - st.orders, line: null };
    (function rec(s, line, pend) {
      if (Date.now() > deadline) return;
      if (fnodes++ > maxNodes) { stats.fightCapped++; return; }
      var str = E.strKilledOf(s), used = POOL - s.orders;
      if (str > localBest.str || (str === localBest.str && used < localBest.orders)) {
        localBest.str = str; localBest.orders = used; localBest.line = line.slice();
      }
      var pendSet = {};
      for (var pi = 0; pi < pend.length; pi++) pendSet[pend[pi].id] = 1;
      // a still-pending unit may yet reposition: give the bound its full row
      if (stateBound(ctx, s, function (u) { return !!pendSet[u.id]; }) <
          Math.max(localBest.str, curBest(inc))) return;
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
          opts2.push({ attack: true, unit: u.id, target: t.id, rank: (v >= t.hp ? 1000 : 0) + v });
        });
      });
      pend.forEach(function (p) {
        var u = E.unitById(s, p.id);
        if (!u || u.hp <= 0 || u.cooldown) return;
        if (p.march && !u.march && s.training < GLOB.UNIT_MARCH_COST) return;
        var o = ctx.OPT[p.id];
        var row = o.tiles0[p.key];
        var v = row ? Math.max.apply(null, row) : 0;
        opts2.push({ attack: false, unit: p.id, p: p, rank: v });
      });
      opts2.sort(function (a, b) { return b.rank - a.rank; });
      opts2.forEach(function (o) {
        var ns, acts, npend = pend;
        if (o.attack) {
          acts = [{ type: 'attack', unit: o.unit, target: o.target }];
        } else {
          acts = [];
          var u2 = E.unitById(s, o.unit);
          if (o.p.march && !u2.march) acts.push({ type: 'march', unit: o.unit });
          acts.push({ type: 'move', unit: o.unit, q: o.p.q, r: o.p.r });
          npend = pend.filter(function (x) { return x.id !== o.unit; });
        }
        ns = s;
        try {
          for (var ai = 0; ai < acts.length; ai++) ns = E.applyAction(ns, acts[ai]);
        } catch (e) { return; }
        if (o.attack) checkBlow(ctx, s, ns, o.unit, o.target);
        var h = fightHash(ns) + (npend.length ? '|' + npend.map(function (x) { return x.id; }).join(',') : '');
        var uu = POOL - ns.orders;
        if (seen[h] !== undefined && seen[h] <= uu) return;
        seen[h] = uu;
        rec(ns, line.concat(acts), npend);
      });
    })(st, [], pending);
    if (localBest.line) {
      noteBest(inc, localBest.str, localBest.orders, startLine.concat(localBest.line),
        'deployment ' + stats.leaves);
    }
    return { str: localBest.str, orders: localBest.orders };
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
            var s = seatEntry(p.id, p.tile);
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
    evalPlacement(placement, cost);
  }

  // evaluate a concrete unit->tile placement (used by the tree's leaves and
  // by the hill-climbing polish pass); returns the fight's best strength,
  // or -1 when the placement was already fought or could not be executed
  function evalPlacement(placement, cost) {
    var sig2 = Object.keys(placement).map(function (id) {
      return classOf[id] + '@' + placement[id];
    }).sort().join(';') + '|' + Math.min(POOL - cost, 63);
    if (mem.fightMemo[sig2]) { stats.dedup++; return -1; }
    mem.fightMemo[sig2] = 1;

    // Split the placement: pre-fight walkers vs deferred/pending. A deferred
    // seat pends by definition; on a rout-shared tile the router walks and
    // the other claimant pends. Blocked walkers fall back to pending too —
    // the fight may open their path.
    var tW0 = Date.now();
    var st = E.cloneState(ctx.INIT);
    var startLine = [], pending = [];
    var byTile = {};
    Object.keys(placement).forEach(function (id) {
      (byTile[placement[id]] = byTile[placement[id]] || []).push(+id);
    });
    // on a shared tile, only a ROUTER may take it pre-fight (it can vacate);
    // if no immediately-walkable router claims it, everyone pends and the
    // fight orders the walks out
    var walkerOf = {};
    Object.keys(byTile).forEach(function (k) {
      var sh = byTile[k];
      if (sh.length === 1) { walkerOf[k] = sh[0]; return; }
      var routersNow = sh.filter(function (id) {
        return ctx.OPT[id].rout && !seatEntry(id, k).deferred;
      });
      walkerOf[k] = routersNow.length ? routersNow[0] : -1;
    });
    var todo = [];
    Object.keys(placement).forEach(function (id) {
      id = +id;
      var k = placement[id];
      var s = seatEntry(id, k);
      var t = k.split(',');
      var entry = { id: id, q: +t[0], r: +t[1], key: k, orders: s.orders, march: s.march };
      if (s.deferred || walkerOf[k] !== id) pending.push(entry);
      else if (s.orders > 0) todo.push(entry);
    });
    todo.sort(function (a, b) { return a.orders - b.orders; });
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
    todo.forEach(function (x) { pending.push(x); });   // fight may open the path
    stats.leaves++;
    stats.tWalk += Date.now() - tW0;
    var tF0 = Date.now();
    var fres = fightOut(st, startLine, FCAP, pending);
    stats.tFight += Date.now() - tF0;
    // remember the best deployments seen — seeds for the polish pass
    var tl = mem.topLeaves = mem.topLeaves || [];
    if (tl.length < 16 || fres.str > tl[tl.length - 1].str) {
      tl.push({ placement: Object.assign({}, placement), str: fres.str, orders: fres.orders });
      tl.sort(function (a, b) { return b.str - a.str || a.orders - b.orders; });
      if (tl.length > 16) tl.pop();
    }
    if (stats.leaves % 20000 === 0) {
      console.log('  … ' + stats.leaves + ' deployments fought, best ' + (inc.str / 10) + ' STR');
    }
    return fres;
  }

  // LNS polish: take the strongest deployments seen so far (plus the
  // deployment the incumbent line itself stands on) and improve them by
  // destroying k units' seat assignments and rebuilding that subset
  // EXACTLY — every joint reassignment from the freed units' FULL seat
  // lists. Coordination has local gradients (add the missing flank
  // partner, pull a softener into range) that a global best-first order
  // cannot follow — and the misranking data (optimizer-handoff.md) says
  // winning deployments sit 2-3 seat substitutions from reached ones with
  // the decisive seats ranked 25-30 in the search order, beyond any fixed
  // candidate cap. The old polish capped 1-swaps at rank 20 and pair
  // rebuilds at rank 12, so king's rank-27 march seat and rank-29
  // deferred seat were unreachable BY CONSTRUCTION. Exhaustive rebuild
  // stays affordable because every candidate must survive the kill-set
  // allocator pinned to its seats before it is fought: a refutation is an
  // OPT-model proof the fight cannot beat the reference.
  if (opts.polishOnly) {
    var listById = {};
    ctx.BLUE.forEach(function (b, i) { listById[b.id] = lists[i]; });
    function claimants(pl, k, exceptId) {
      var out = [];
      Object.keys(pl).forEach(function (id) {
        if (+id !== exceptId && pl[id] === k) out.push(+id);
      });
      return out;
    }
    function placementCost(pl) {
      var c = 0, t = 0;
      var ids = Object.keys(pl);
      for (var i = 0; i < ids.length; i++) {
        var s = seatEntry(+ids[i], pl[ids[i]]);
        if (!s) return null;
        c += s.orders;
        if (s.march) t += GLOB.UNIT_MARCH_COST;
      }
      return c <= POOL && t <= ctx.INIT.training ? c : null;
    }
    // Acceptance is lexicographic (strength, then fewer orders): the same
    // machinery that climbs toward a higher ceiling also grinds par down at
    // a proven one. VND ladder: k=1 sweeps first; when a seed stalls, pair
    // rebuilds; when those stall, ALNS-chosen triples. Misranking data:
    // winning deployments are often a couple of substitutions from reached
    // ones, but NOT one (king's /20 shares no seat assignment with the
    // reached /21).
    function better(r, str0, ord0) {
      if (r === -1) return false;
      return r.str > str0 || (r.str === str0 && r.orders < ord0);
    }
    function claimOKPl(pl, k2, uid) {
      var others = claimants(pl, k2, uid);
      if (others.length >= 2) return false;
      if (others.length === 1) {
        var mine = listById[uid].filter(function (x) { return x.key === k2; })[0];
        if (!(mine && mine.rout) && !ctx.OPT[others[0]].rout) return false;
      }
      return true;
    }

    // Seeded PRNG (mulberry32) for the ALNS draws: reproducibility is the
    // house currency — a run's numbers must replay from its command line.
    // State lives in `mem` so successive polish rounds continue the
    // sequence instead of replaying it.
    if (mem.rngState === undefined) {
      mem.rngState = ((process.env.V2_LNS_SEED ? parseInt(process.env.V2_LNS_SEED, 10) : 0xC0FFEE) >>> 0) || 1;
    }
    function rng() {
      mem.rngState = (mem.rngState + 0x6D2B79F5) >>> 0;
      var t = mem.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Admissible improvement gate for a FULL candidate placement: pin every
    // unit's OPT rows to its seat and ask the allocator whether ANY kill-set
    // could beat the reference — strictly stronger, or equal strength in
    // strictly fewer orders. A false is an OPT-model proof the fight cannot
    // improve, so the fight is skipped; refutations are cached against the
    // reference they were proven at (a refutation of (S,O) also refutes any
    // stricter reference — S can only rise and O only fall at equal S).
    var gateFalse = mem.gateFalse = mem.gateFalse || {};
    // pinned allocator rows are pure functions of (unit, seat) — cached, or
    // a triple rebuild would allocate ~30k row sets per call
    var ZEROROW = new Array(ctx.NR).fill(0);
    var pinRows = mem.pinRows = mem.pinRows || {};
    function pinRow(b, pin) {
      var c1 = pinRows[b.id] || (pinRows[b.id] = {});
      var hit = c1[pin];
      if (hit) return hit;
      var o = ctx.OPT[b.id];
      var row = o.tiles[pin] || ZEROROW;
      if (o.rout && ctx.adjRed[pin]) {
        row = row.map(function (v, i2) { return Math.max(v, o.routFire[i2]); });
      }
      return (c1[pin] = { id: b.id, prim: row, col: (o.col && o.col[pin]) || ZEROROW,
        colCap: o.colCap, maxAtt: o.maxAtt, travel: ZEROROW, travelAny: 0 });
    }
    function gateImproves(pl, cost, refStr, refOrd) {
      if (!masks) return true;
      var sig = Object.keys(pl).map(function (id) { return id + '@' + pl[id]; }).sort().join(';');
      var hit = gateFalse[sig];
      if (hit && (refStr > hit.s || (refStr === hit.s && refOrd <= hit.o))) return false;
      var rows = ctx.BLUE.map(function (b) {
        return pinRow(b, pl[b.id] || key(b.q, b.r));
      });
      for (var k = 0; k < masks.length; k++) {
        var m = masks[k];
        if (m.str < refStr) break;
        var budget = (m.str > refStr ? POOL : refOrd - 1) - cost;
        if (budget < 0) continue;
        if (feasibleMask(ctx, m.mask, budget, rows, 20000)) return true;
      }
      gateFalse[sig] = { s: refStr, o: refOrd };
      stats.gateCut++;
      return false;
    }

    // Destroy-and-rebuild: free `subset`, enumerate its joint reassignment
    // from the FULL lists (list order = the search-order heuristic), first
    // improvement wins. Freed units are lifted to null before enumeration so
    // one freed unit may take another's old seat — a seat ROTATION inside
    // the subset is a real move, and claim-checking against saved seats
    // would veto it. When this returns null and the deadline did not cut it
    // short, no reassignment of `subset` beats the reference within the
    // OPT model — the rebuild is exact, not sampled.
    //
    // On >8-blue boards the rebuild is CAPPED (and says so in the log): the
    // gate earns exhaustiveness only where the allocator can refute — on
    // f6ff55 it refutes almost nothing (the design doc's stage-1 finding),
    // so an uncapped pair rebuild fights thousands of low-value candidates
    // and one neighbourhood eats the whole polish slice. The cap trades
    // depth in one pair for breadth across pairs and seeds; ≤8-blue boards
    // stay exact, which is what the king gate stands on.
    var LNSCAP = process.env.V2_LNS_CAP ? parseInt(process.env.V2_LNS_CAP, 10) : 600;
    function rebuild(cur, subset, refStr, refOrd) {
      var saved = subset.map(function (id) { return cur[id]; });
      subset.forEach(function (id) { cur[id] = null; });
      var found = null, capped = false;
      var capLeft = ctx.BLUE.length <= 8 ? Infinity : LNSCAP;
      // k>=4 (front rebuilds): exact enumeration under a cap visits only the
      // lexicographic top corner of |L|^k, which is no diversity at all —
      // sample instead: LNSCAP score-biased draws (geometric over list rank,
      // so the top seats dominate but the tail stays reachable)
      if (subset.length >= 4) {
        for (var d = 0; d < LNSCAP && !found && Date.now() < deadline; d++) {
          var okDraw = true;
          for (var di = 0; di < subset.length; di++) {
            var uid2 = subset[di], l2 = listById[uid2];
            var pickI = 0;
            while (pickI < l2.length - 1 && rng() < 0.72) pickI++;
            var kk = l2[pickI].key;
            if (!claimOKPl(cur, kk, uid2)) { okDraw = false; break; }
            cur[uid2] = kk;
          }
          if (okDraw) {
            var cD = placementCost(cur);
            if (cD !== null && gateImproves(cur, cD, refStr, refOrd)) {
              var rD = evalPlacement(Object.assign({}, cur), cD);
              if (better(rD, refStr, refOrd)) { found = rD; break; }
            }
          }
          for (var dj = 0; dj < subset.length; dj++) cur[subset[dj]] = null;
        }
        if (!found) {
          for (var dk = 0; dk < subset.length; dk++) cur[subset[dk]] = saved[dk];
        }
        return found;
      }
      (function assign(i) {
        if (found || capped || Date.now() > deadline) return;
        if (i === subset.length) {
          if (capLeft-- <= 0) { capped = true; stats.lnsCapped = (stats.lnsCapped || 0) + 1; return; }
          var same = true;
          for (var si = 0; si < subset.length; si++) {
            if (cur[subset[si]] !== saved[si]) { same = false; break; }
          }
          if (same) return;
          var c = placementCost(cur);
          if (c === null) return;
          if (!gateImproves(cur, c, refStr, refOrd)) return;
          var r = evalPlacement(Object.assign({}, cur), c);
          if (better(r, refStr, refOrd)) found = r;
          return;
        }
        var uid = subset[i], list = listById[uid];
        for (var j = 0; j < list.length && !found && !capped; j++) {
          if (Date.now() > deadline) break;
          var k2 = list[j].key;
          if (!claimOKPl(cur, k2, uid)) continue;
          cur[uid] = k2;
          assign(i + 1);
        }
        if (!found) cur[uid] = null;
      })(0);
      if (!found) {
        for (var si2 = 0; si2 < subset.length; si2++) cur[subset[si2]] = saved[si2];
      }
      return found;
    }

    function combinations(arr, k) {
      var out = [];
      (function go(start, acc) {
        if (acc.length === k) { out.push(acc.slice()); return; }
        for (var i = start; i < arr.length; i++) { acc.push(arr[i]); go(i + 1, acc); acc.pop(); }
      })(0, []);
      return out;
    }

    // ALNS destroy-set operators: which units to free. Weights persist in
    // `mem` across polish rounds and adapt toward what has produced
    // improvements (w <- 0.85w + 0.6*reward, floored). On ≤8-blue boards
    // the operators only ORDER the triple space and an exhaustive tail
    // sweeps whatever the dice never rolled, so "dry" means dry.
    function pickWeighted(k, weight) {
      var picked = [], avail = ctx.BLUE.map(function (b, i) { return i; });
      while (picked.length < k && avail.length) {
        var tot = 0;
        var w = avail.map(function (i2) { var x = weight(i2) + 0.001; tot += x; return x; });
        var r = rng() * tot, j = 0;
        while (j < avail.length - 1 && (r -= w[j]) > 0) j++;
        picked.push(avail[j]); avail.splice(j, 1);
      }
      return picked.map(function (i) { return ctx.BLUE[i].id; });
    }
    var OPS = mem.alnsOps = mem.alnsOps || [
      { name: 'rand', w: 1, hits: 0, draws: 0 },
      { name: 'weak', w: 1, hits: 0, draws: 0 },
      { name: 'front', w: 1, hits: 0, draws: 0 },
      { name: 'dear', w: 1, hits: 0, draws: 0 },
    ].concat(ctx.BLUE.length > 8
      // big boards only: destroy a whole FRONT (every unit able to hit one
      // red, up to 5) and rebuild it jointly — f6ff55's structure (8 of 11
      // blues reach only 3 reds) says the coordination that matters is
      // within-front, and k<=3 rebuilds cannot re-coordinate one
      ? [{ name: 'frontK', w: 1, hits: 0, draws: 0 }] : []);
    var PICKERS = {
      rand: function (pl, k) { return pickWeighted(k, function () { return 1; }); },
      // least realistic punch from its current seat — likely misplaced
      weak: function (pl, k) {
        return pickWeighted(k, function (i) {
          var b = ctx.BLUE[i], row = ctx.OPT[b.id].tiles0[pl[b.id]];
          var v = 0;
          if (row) for (var j = 0; j < ctx.NR; j++) { if (row[j] > v) v = row[j]; }
          return 20 / (1 + v);
        });
      },
      // the units best able to hit one red: a front, freed together
      front: function (pl, k) {
        var r = Math.floor(rng() * ctx.NR);
        return pickWeighted(k, function (i) {
          return (ctx.OPT[ctx.BLUE[i].id].stat[r] || 0) + 0.5;
        });
      },
      // the most expensive seats — where par grinding pays
      dear: function (pl, k) {
        return pickWeighted(k, function (i) {
          var b = ctx.BLUE[i], s = seatEntry(b.id, pl[b.id]);
          return (s ? s.orders : 0) + 0.5;
        });
      },
      // a whole front: up to 5 units able to hit one red, sampled by punch.
      // k>=4 subsets take the SAMPLED rebuild path in rebuild().
      frontK: function (pl, k) {
        var r = Math.floor(rng() * ctx.NR);
        var able = [];
        ctx.BLUE.forEach(function (b, i) {
          if ((ctx.OPT[b.id].stat[r] || 0) > 0) able.push(i);
        });
        var want = Math.min(5, Math.max(4, able.length));
        if (able.length <= want) {
          return able.map(function (i) { return ctx.BLUE[i].id; });
        }
        var picked = [];
        while (picked.length < want && able.length) {
          var tot = 0;
          var w = able.map(function (i2) {
            var x = (ctx.OPT[ctx.BLUE[i2].id].stat[r] || 0) + 0.5; tot += x; return x;
          });
          var rr = rng() * tot, j = 0;
          while (j < able.length - 1 && (rr -= w[j]) > 0) j++;
          picked.push(able[j]); able.splice(j, 1);
        }
        return picked.map(function (i) { return ctx.BLUE[i].id; });
      },
    };
    function drawOp() {
      var tot = 0;
      OPS.forEach(function (o) { tot += o.w; });
      var r = rng() * tot;
      for (var i = 0; i < OPS.length; i++) { if ((r -= OPS[i].w) <= 0) return OPS[i]; }
      return OPS[OPS.length - 1];
    }
    function rewardOp(op, hit) {
      op.draws++;
      if (hit) op.hits++;
      op.w = Math.max(0.1, 0.85 * op.w + 0.6 * (hit ? 1 : 0));
    }

    // The deployment the incumbent line stands on joins the seed pool: a
    // stage2-found incumbent never went through evalLeaf, so topLeaves may
    // not hold the very deployment the proof rests on. Seats are the
    // pre-attack tiles; units that never attack sit on their start tile.
    function lineSeed() {
      if (!inc.line) return null;
      var s, seat = {};
      try {
        s = E.loadPuzzle(ctx.base);
        for (var i = 0; i < inc.line.length; i++) {
          var a = inc.line[i];
          if (a.type === 'attack' && seat[a.unit] === undefined) {
            var u = E.unitById(s, a.unit);
            if (u) seat[a.unit] = key(u.q, u.r);
          }
          s = E.applyAction(s, a);
        }
      } catch (e) { return null; }
      var pl = {};
      for (var bi = 0; bi < ctx.BLUE.length; bi++) {
        var b = ctx.BLUE[bi];
        var k2 = seat[b.id] !== undefined ? seat[b.id] : key(b.q, b.r);
        if (!seatEntry(b.id, k2)) return null;             // outside the seat model
        pl[b.id] = k2;
      }
      return pl;
    }

    var seeds = (mem.topLeaves || []).slice()
      .sort(function (a, b) { return b.str - a.str || a.orders - b.orders; });
    var pls = lineSeed();
    if (pls) {
      var lc = placementCost(pls);
      if (lc !== null) {
        var lr = evalPlacement(Object.assign({}, pls), lc);
        seeds.unshift(lr !== -1
          ? { placement: pls, str: lr.str, orders: lr.orders }
          : { placement: pls, str: inc.str, orders: inc.orders });
      }
    }
    // V2_SEED_DEBUG: is the seed set one basin or several? Mean pairwise
    // distance over the unit->tile assignments answers it in one number.
    // This instrument exists because it KILLED a plausible theory: the top-16
    // seeds looked like elitism collapsing into a single basin, so they were
    // replaced with a quality-diversity archive. Measured on king-of-the-hill,
    // mean pairwise distance was 0.729 either way and the diversity branch
    // fired zero times — the seeds were already spread (sharing ~27% of their
    // seats), and the change was a no-op. See optimizer-handoff.md.
    if (process.env.V2_SEED_DEBUG && seeds.length) {
      var sum = 0, pairs = 0;
      function sdesc(x) {
        return Object.keys(x.placement).map(function (id) {
          return id + '@' + x.placement[id];
        }).sort();
      }
      function sdist(a, b) {
        var A = {}, n = 0, i;
        for (i = 0; i < a.length; i++) A[a[i]] = true;
        for (i = 0; i < b.length; i++) if (A[b[i]]) n++;
        var u = a.length + b.length - n;
        return u === 0 ? 0 : 1 - n / u;
      }
      var descs = seeds.map(sdesc);
      for (var da = 0; da < descs.length; da++) {
        for (var db = da + 1; db < descs.length; db++) { sum += sdist(descs[da], descs[db]); pairs++; }
      }
      console.log('  [seeds] n=' + seeds.length +
        ' meanPairwiseDist=' + (pairs ? (sum / pairs).toFixed(3) : 'n/a') +
        ' strRange=' + (seeds[seeds.length - 1].str / 10) + '..' + (seeds[0].str / 10));
    }
    var allIds = ctx.BLUE.map(function (b) { return b.id; });
    var TRIPLES = ctx.BLUE.length >= 3 ? combinations(allIds, 3) : [];
    // ALNS triple budget per stall: exhaustive on small boards (a dry
    // verdict must mean DRY), sampled with honest logging on big ones
    var T3 = ctx.BLUE.length <= 8 ? TRIPLES.length
      : Math.min(TRIPLES.length, process.env.V2_LNS_T3 ? parseInt(process.env.V2_LNS_T3, 10) : 40);
    var t3Sampled = false;
    for (var sd = 0; sd < seeds.length; sd++) {
      if (Date.now() > deadline) break;
      var cur = Object.assign({}, seeds[sd].placement);
      var curStr = seeds[sd].str, curOrd = seeds[sd].orders;
      for (;;) {                      // VND: k=1 -> pairs -> triples; restart on any improvement
        if (Date.now() > deadline) break;
        var r = null, i1;
        for (i1 = 0; i1 < allIds.length && !r; i1++) {
          r = rebuild(cur, [allIds[i1]], curStr, curOrd);
        }
        if (!r && Date.now() < deadline) {
          var pairs = combinations(allIds, 2);
          for (i1 = 0; i1 < pairs.length && !r; i1++) {
            if (Date.now() > deadline) break;
            r = rebuild(cur, pairs[i1], curStr, curOrd);
          }
        }
        if (!r && Date.now() < deadline && TRIPLES.length) {
          var tried = {}, triedN = 0, drawsLeft = T3 * 3;
          while (!r && Date.now() < deadline && triedN < T3 && drawsLeft-- > 0) {
            var op = drawOp();
            var sub = PICKERS[op.name](cur, 3).sort(function (a, b) { return a - b; });
            var sg = sub.join('+');
            if (tried[sg]) continue;
            tried[sg] = 1; triedN++;
            r = rebuild(cur, sub, curStr, curOrd);
            rewardOp(op, !!r);
          }
          // exhaustive tail on small boards: sweep the triples the dice
          // never rolled, so "no improvement" is a statement about the
          // neighbourhood, not about the sampling
          if (!r && ctx.BLUE.length <= 8) {
            for (i1 = 0; i1 < TRIPLES.length && !r; i1++) {
              if (Date.now() > deadline) break;
              var sg2 = TRIPLES[i1].join('+');
              if (tried[sg2]) continue;
              r = rebuild(cur, TRIPLES[i1], curStr, curOrd);
            }
          } else if (!r && triedN >= T3 && TRIPLES.length > T3) {
            t3Sampled = true;
          }
        }
        if (!r) break;
        curStr = r.str; curOrd = r.orders;
      }
    }
    console.log('  stage3 LNS polish done · leaves ' + stats.leaves +
      ' · gateCut ' + stats.gateCut +
      ' · ops ' + OPS.map(function (o) { return o.name + ' ' + o.hits + '/' + o.draws; }).join(', ') +
      (t3Sampled ? ' · triples SAMPLED (' + T3 + ' of ' + TRIPLES.length + ' per stall)' : '') +
      (stats.lnsCapped ? ' · ' + stats.lnsCapped + ' rebuilds CAPPED at ' + LNSCAP + ' candidates' : '') +
      ' · best ' + (inc.str / 10));
    stats.exhausted = false;
    stats.expressive = true;
    return stats;
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
  // root partition for worker parallelism: worker w of K owns the root seats
  // with rank ≡ w (mod K); the union over workers is the whole tree
  var partW = opts.partW || 0, partK = opts.partK || 1;
  // Seat sharing: one tile may serve TWO units in a turn when a router takes
  // it first and routs away (tile reuse — the pattern that decides real
  // puzzles). The tree allows a second claim iff a router is involved; the
  // fight executor orders the walks with the real engine and simply never
  // realises combinations the game forbids.
  function claimState(chainTop, seat) {
    // 0 = blocked, 1 = free, 2 = shareable (a router is involved)
    var count = 0, anyRout = seat.rout;
    for (var w = chainTop; w; w = w.p) {
      var s = nodeSeat(w);
      if (s.key === seat.key) {
        count++;
        if (s.rout) anyRout = true;
      }
    }
    if (count === 0) return 1;
    return EXPR && count === 1 && anyRout ? 2 : 0;
  }
  // sharing a seat is speculative (it only works if the router's fight
  // actually vacates it) — deprioritised the same way deferred seats are,
  // so the plain assignments the old searches found first still come first
  var SHAREPEN = process.env.SHAREPEN ? parseFloat(process.env.SHAREPEN) : 15;
  // first valid seat rank >= si for depth d under ancestor chain `p`
  // marches draw on the SHARED training pool: floor(training/UNIT_MARCH_COST)
  // of them, army-wide. Without this the tree happily assigns every unit a
  // march seat — king-of-the-hill's budget funds exactly two, and the human
  // line uses exactly two, so every over-marched subtree is pure waste.
  var TRAIN = ctx.INIT.training;
  function firstValid(p, d, si, gBase, costBase, trainBase) {
    var list = lists[order[d]];
    for (; si < list.length; si++) {
      if (d === 0 && partK > 1 && si % partK !== partW) continue;
      var seat = list[si];
      var claim = claimState(p, seat);
      if (!claim) continue;
      var t2 = trainBase + (seat.march ? GLOB.UNIT_MARCH_COST : 0);
      if (t2 > TRAIN) { stats.costCut++; continue; }
      var pen = claim === 2 ? SHAREPEN : 0;
      var c2 = costBase + seat.classMin;
      if (c2 + suffixMin[d + 1] > POOL) { stats.costCut++; continue; }
      return { p: p, d: d, si: si, g: gBase + seat.score - pen, cost: c2, tr: t2,
        f: gBase + W * (seat.score - pen + suffixBest[d + 1]) };
    }
    return null;
  }
  var root = firstValid(null, 0, 0, 0, 0, 0);
  if (root) hpush(root);
  var HEAPCAP = 2000000;
  var exhausted = true;
  while (heap.length) {
    if (Date.now() > deadline) { exhausted = false; break; }
    if (heap.length > HEAPCAP) { exhausted = false; break; }        // coverage lost
    var node = hpop();
    // sibling first: the tail this node stood in for lives on
    var sib = firstValid(node.p, node.d, node.si + 1,
      node.p ? node.p.g : 0, node.p ? node.p.cost : 0, node.p ? node.p.tr : 0);
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
    var child = firstValid(node, node.d + 1, 0, node.g, node.cost, node.tr);
    if (child) hpush(child);
  }
  stats.exhausted = exhausted && !heap.length && !plan;   // plan lists are truncated
  stats.expressive = EXPR;
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
// Plan slices: for each top kill-set, a short search restricted to the seats
// its witness allocation wants. Kill-set-directed deployment assembly — the
// one order of search that composes a COORDINATED deployment directly. Used
// by both the big-board schedule and (briefly) small boards, where a
// must-use deferred seat can otherwise hide behind thousands of plain
// deployments (Closing In).
function planSlices(ctx, inc, budgetMs, hardEnd, masks, s3state, partW, partK, plansMax, includeEqual) {
  var POOL = ctx.POOL;
  var walkRows = fullRows(ctx, 'walk');
  // Sweep DEEP down the kill-set list, not just the summit: the strongest
  // masks are usually over-stretched fantasies whose deployments spread the
  // army thin; the masks just above what's actually playable are where a
  // plan's fight cashes in — and every realized plan raises the incumbent,
  // which silently skips everything weaker.
  var PLANS = process.env.PLANS ? parseInt(process.env.PLANS, 10) : (plansMax || 48);
  var plans = [];
  for (var mi = 0; mi < masks.length && plans.length < PLANS; mi++) {
    // WITNESS DIVERSIFICATION: one mask has many allocations, and the plan
    // ordering follows the allocation — king's human /20 assigns roles the
    // first-found witness does not, so its seats rank mid-list under that
    // witness and near the top under the right one. Rotating the allocator's
    // unit order yields structurally different witnesses cheaply.
    var seen = {};
    for (var rot = 0; rot < 3 && plans.length < PLANS; rot++) {
      var rows2 = walkRows.slice(rot * Math.ceil(walkRows.length / 3))
        .concat(walkRows.slice(0, rot * Math.ceil(walkRows.length / 3)));
      var outw = {};
      if (feasibleMask(ctx, masks[mi].mask, POOL, rows2, 300000, outw) && outw.assign) {
        var sig = JSON.stringify(outw.assign);
        if (seen[sig]) continue;
        seen[sig] = 1;
        plans.push({ mask: masks[mi].mask, str: masks[mi].str, assign: outw.assign });
      } else break;                                    // infeasible: no more rotations
    }
  }
  var perPlan = Math.max(12000, budgetMs / Math.max(1, plans.length));
  var planEnd = Date.now() + budgetMs;
  console.log('--- stage3 (plan slices: ' + plans.length + ' kill-sets)' +
    (partK > 1 ? ' [worker ' + partW + '/' + partK + ']' : ''));
  var s3 = null;
  for (var pi = 0; pi < plans.length; pi++) {
    if (Date.now() + 5000 > hardEnd || Date.now() > planEnd) break;
    // par refinement wants EQUAL-strength kill-sets (cheaper lines to the
    // same ceiling); the strength hunt wants only better ones
    if (includeEqual ? plans[pi].str < curBest(inc) : plans[pi].str <= curBest(inc)) continue;
    var pEnd = Math.min(hardEnd, Date.now() + perPlan);
    s3 = stage3(ctx, inc, pEnd, { masks: masks, state: s3state, plan: plans[pi],
      partW: partW, partK: partK });
  }
  return s3;
}

function scheduleBig(ctx, inc, DEADLINE, SECONDS, masks, s3state, partW, partK) {
  var s3 = planSlices(ctx, inc, Math.max(20, SECONDS * 0.45) * 1000, DEADLINE,
    masks, s3state, partW, partK);
  if (Date.now() < DEADLINE) {
    // alternate coverage and polish: the tree finds fresh material, the
    // climb turns the best of it into coordinated deployments
    for (var round = 0; round < 6 && Date.now() < DEADLINE; round++) {
      var covEnd = Math.min(DEADLINE, Date.now() + Math.max(30000, (DEADLINE - Date.now()) * 0.25));
      console.log('--- stage3 (full, expressive)' + (partK > 1 ? ' [worker ' + partW + '/' + partK + ']' : ''));
      s3 = stage3(ctx, inc, covEnd, { masks: masks, state: s3state,
        partW: partW, partK: partK, expressive: true });
      if (Date.now() >= DEADLINE || s3.exhausted) break;
      var polEnd = Math.min(DEADLINE, Date.now() + Math.max(20000, (DEADLINE - Date.now()) * 0.2));
      console.log('--- stage3 (polish)' + (partK > 1 ? ' [worker ' + partW + '/' + partK + ']' : ''));
      stage3(ctx, inc, polEnd, { masks: masks, state: s3state, polishOnly: true, expressive: true });
    }
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

// ------------------------------------------------------- line trace mode ----
// V2_TRACE_LINE=<file.json>: replay a (human) action line through the engine,
// then interrogate the solver's own machinery about it — is each attack seat
// in the live/deferred seat sets, would the deployment survive the kill-set
// bound, does the fight model even contain the line's shape? This is the
// diagnostic that separates "ordering problem" from "expressiveness problem"
// without an afternoon of bisection.
function traceLine(ctx, line) {
  var E2 = E, POOL = ctx.POOL;
  var s = E.loadPuzzle(ctx.base);
  var fought = false;
  var info = {};   // unit id -> {seat, marched, moveActions, midFightMoves}
  var okAll = true;
  line.forEach(function (a, i) {
    var u = E.unitById(s, a.unit);
    // capture the tile the unit attacks FROM before the engine applies the
    // action — a routing kill advances the attacker, and the post-apply
    // position is the victim's tile, not the seat the tree must assign
    var preAt = u ? key(u.q, u.r) : null;
    var rec = info[a.unit] = info[a.unit] || { moveActions: 0, midFightMoves: 0, marched: false, seat: null, attacks: 0 };
    try { s = E.applyAction(s, a); } catch (e) {
      console.log('  trace: action ' + (i + 1) + ' ' + JSON.stringify(a) + ' ILLEGAL under current engine: ' + e.message);
      okAll = false;
      return;
    }
    if (a.type === 'move') { rec.moveActions++; if (fought) rec.midFightMoves++; }
    if (a.type === 'march') rec.marched = true;
    if (a.type === 'swap') { rec.moveActions++; console.log('  trace: line uses SWAP — outside every stage3 model'); }
    if (a.type === 'attack') {
      fought = true;
      rec.attacks++;
      if (rec.seat === null) rec.seat = preAt;
    }
  });
  var str = E.strKilledOf(s), used = POOL - s.orders;
  console.log('trace: line replays to ' + (str / 10) + ' STR in ' + used + ' orders' + (okAll ? '' : ' (WITH ILLEGAL ACTIONS)'));
  var mask = 0;
  s.units.forEach(function (u) { if (u.player === 1 && u.hp <= 0) mask |= (1 << ctx.ridx[u.id]); });
  console.log('trace: kill-set mask str ' + (str / 10));
  // the REAL search orders: rank of each traced seat in the plain tree, the
  // expressive tree, and the plan tree for this line's own kill-set witness
  var plainB = buildSeatLists(ctx, {});
  var exprB = buildSeatLists(ctx, { expressive: true });
  var planB = null;
  var outw = {};
  if (ctx.NR <= 20 &&
      feasibleMask(ctx, mask, POOL, fullRows(ctx, 'walk'), 300000, outw) && outw.assign) {
    planB = buildSeatLists(ctx, { plan: { mask: mask, str: str, assign: outw.assign } });
  }
  function rankIn(built, id, seatKey) {
    var bi = ctx.BLUE.findIndex(function (b) { return b.id === +id; });
    if (bi < 0) return '-';
    var idx = built.lists[bi].findIndex(function (s) { return s.key === seatKey; });
    return idx < 0 ? 'ABSENT/' + built.lists[bi].length : idx + '/' + built.lists[bi].length;
  }
  Object.keys(info).forEach(function (id) {
    var r = info[id];
    if (r.seat === null) { console.log('  unit ' + id + ': never attacks'); return; }
    var s3 = ctx.SEAT3[id] && ctx.SEAT3[id][r.seat];
    var sc = ctx.SEAT[id] && ctx.SEAT[id][r.seat];
    var row = ctx.OPT[id] && ctx.OPT[id].tiles[r.seat];
    console.log('  unit ' + id + ': attack seat ' + r.seat +
      (s3 ? ' [live, ' + s3.orders + ' orders' + (s3.march ? ', march' : '') + ']'
          : sc ? ' [DEFERRED, floor ' + sc.orders + (sc.march ? ', march' : '') + ']'
               : ' [NOT A SEAT — outside the seat model!]') +
      ' · ' + r.moveActions + ' move action(s), ' + r.midFightMoves + ' mid-fight' +
      (r.marched ? ', marched' : '') + ' · ' + r.attacks + ' attack(s)' +
      (row ? ' · OPT row ' + row.join(',') : '') +
      ' · rank plain ' + rankIn(plainB, id, r.seat) +
      ', expr ' + rankIn(exprB, id, r.seat) +
      (planB ? ', plan ' + rankIn(planB, id, r.seat) : ''));
  });
  // the tree's arrival cost for the whole deployment: sum of expressive ranks
  var sumExpr = 0, sumPlan = 0, worst = null;
  Object.keys(info).forEach(function (id) {
    var r = info[id];
    if (r.seat === null) return;
    var bi = ctx.BLUE.findIndex(function (b) { return b.id === +id; });
    var ei = exprB.lists[bi].findIndex(function (s) { return s.key === r.seat; });
    if (ei >= 0) { sumExpr += ei; if (worst === null || ei > worst.rank) worst = { id: id, rank: ei }; }
    if (planB) {
      var pi2 = planB.lists[bi].findIndex(function (s) { return s.key === r.seat; });
      if (pi2 >= 0) sumPlan += pi2;
    }
  });
  console.log('trace: rank-sum expressive ' + sumExpr +
    (planB ? ', plan ' + sumPlan : '') +
    (worst ? ' · worst-ranked: unit ' + worst.id + ' at expr rank ' + worst.rank : ''));
  // would the pinned deployment survive the kill-set bound?
  var pins = {};
  Object.keys(info).forEach(function (id) { if (info[id].seat) pins[id] = info[id].seat; });
  var rows = ctx.BLUE.map(function (b) {
    var o = ctx.OPT[b.id];
    var pin = pins[b.id];
    if (!pin) {
      return { id: b.id, prim: o.stat, col: o.cstat, colCap: o.colCap, maxAtt: o.maxAtt,
        travel: o.travel, travelAny: 0 };
    }
    var row = o.tiles[pin] || new Array(ctx.NR).fill(0);
    if (o.rout && ctx.adjRed[pin]) {
      row = row.map(function (v, i2) { return Math.max(v, o.routFire[i2]); });
    }
    return { id: b.id, prim: row, col: (o.col && o.col[pin]) || new Array(ctx.NR).fill(0),
      colCap: o.colCap, maxAtt: o.maxAtt, travel: new Array(ctx.NR).fill(0), travelAny: 0 };
  });
  var cost = 0;
  Object.keys(pins).forEach(function (id) {
    var e3 = ctx.SEAT3[id][pins[id]] || ctx.SEAT[id][pins[id]];
    cost += e3 ? e3.orders : 0;
  });
  console.log('trace: pinned kill-set feasible under the bound: ' +
    feasibleMask(ctx, mask, POOL - cost, rows, 300000) + ' (assigned cost floor ' + cost + ')');
}

// ----------------------------------------------------------------- main ----
function replay(ctx, line) {
  var s = E.loadPuzzle(ctx.base);
  line.forEach(function (o, i) {
    var u = E.unitById(s, o.unit);
    var msg = o.type === 'move' ? E.nameOf(u) + ' -> (' + o.q + ',' + o.r + ')'
            : o.type === 'march' ? E.nameOf(u) + ' force marches'
            : o.type === 'swap' ? E.nameOf(u) + ' swaps with ' + E.nameOf(E.unitById(s, o.target))
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
  var P;
  if (/\.json$/.test(SRC)) {
    var j = JSON.parse(require('fs').readFileSync(SRC, 'utf8'));
    P = j.puzzle || j;
  } else if (/\.js$/.test(SRC)) {
    P = require(path.resolve(SRC));
  } else {
    // bare id: look it up in the shipped library, for reproducible commands
    P = require(path.join(__dirname, '..', 'web', 'puzzles.js'))
      .filter(function (x) { return x.id === SRC; })[0];
    if (!P) { console.error('no puzzle with id "' + SRC + '" in web/puzzles.js'); process.exit(1); }
  }
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

  if (process.env.V2_TRACE_LINE) {
    var traced = JSON.parse(require('fs').readFileSync(process.env.V2_TRACE_LINE, 'utf8'));
    traceLine(ctx, traced.line || traced);
    return;
  }

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
    // small boards: brief kill-set-directed plan slices, but ONLY when the
    // ceiling actually depends on deferred (kill-opened) seats — measured by
    // recomputing the upper bound with blows restricted to live-reach seats.
    // If immediate seats already support U0, plans are a luxury that eats
    // the plain pass's budget (left-flank's winning leaf sits ~2,800 fights
    // in); if they don't (Closing In: the axeman's real blow only exists on
    // the tile a kill vacates), plans are the only fast route.
    if (masks) {
      // primary blows only: the allocator's collateral model is decoupled-
      // generous, and on Closing In the cleave pseudo-blows paper over the
      // one missing point that makes the deferred seat load-bearing. A
      // primaries-only selector errs toward running plans, which costs 30s
      // on boards that did not need them — the right direction to be wrong.
      var immRows = fullRows(ctx, 'walk').map(function (r) {
        var o = ctx.OPT[r.id];
        var prim = new Array(ctx.NR).fill(0);
        Object.keys(ctx.SEAT3[r.id]).forEach(function (k) {
          for (var i = 0; i < ctx.NR; i++) {
            if (o.tiles[k] && o.tiles[k][i] > prim[i]) prim[i] = o.tiles[k][i];
          }
        });
        return { id: r.id, prim: prim, col: new Array(ctx.NR).fill(0), colCap: 0,
          maxAtt: r.maxAtt, travel: r.travel, travelAny: r.travelAny };
      });
      var Uimm = upperBound(ctx, masks, immRows, POOL, []).U;
      if (Uimm < U0) {
        console.log('immediate-seat ceiling ' + (Uimm / 10) + ' < U0 ' + (U0 / 10) +
          ' — deferred seats are load-bearing, running plan slices');
        s3 = planSlices(ctx, inc, Math.max(15, SECONDS * 0.1) * 1000, DEADLINE,
          masks, s3state, 0, 1, 8);
      }
    }
  }

  // ---- stage 2: exhaustive in-state search on small boards. It gets a
  // bounded slice — if it can't finish in that, stage 3 covers more ground
  // per second and gets the rest.
  var s2 = null;
  if (ctx.BLUE.length <= S2MAX && !(U !== null && inc.str >= U)) {
    var lateLevels = process.env.LATE !== undefined ? [parseInt(process.env.LATE, 10)] : [0, 1, 2, 3];
    var s2end = Math.min(DEADLINE, Date.now() + Math.max(30, (DEADLINE - Date.now()) * 0.2 / 1000) * 1000);
    console.log('--- stage2 (exact in-state search)');
    s2 = stage2(ctx, inc, s2end, lateLevels);
    // then TRUE full play: Bottleneck's 35 lives in waiting-tile choreography
    // the rationed model cannot express, and its budget counters fragment
    // transpositions so badly that widening the ration searches MORE states
    // than searching the real game. If this completes, the ceiling is proven
    // outright. When the rationed pass timed out the state space is large —
    // stage2u then waits its turn BEHIND the stage-3 passes (see below), so
    // the deployment search keeps the budget that finds real lines.
    if (s2.complete && Date.now() < DEADLINE && !(U !== null && inc.str >= U)) {
      console.log('--- stage2u (full legal play)');
      var before = inc.str;
      var s2u = stage2u(ctx, inc, DEADLINE);
      if (s2u.complete) s2 = s2u;
      else if (inc.str > before) s2 = null;                // narrow completion is now moot
    }
  }

  // ---- stage 3 full runs with the remaining time: plain first (the arrival
  // order that finds real lines on live-seat boards), expressive after, and
  // a deferred stage2u slice last when the rationed pass could not finish
  if (!(s2 && s2.complete) && !(U !== null && inc.str >= U) && Date.now() < DEADLINE) {
    console.log('--- stage3 (full)');
    var s3end = Math.min(DEADLINE, Date.now() + (DEADLINE - Date.now()) * 0.55);
    s3 = stage3(ctx, inc, s3end, { masks: masks, state: s3state });
    if (Date.now() < DEADLINE && !(U !== null && inc.str >= U)) {
      console.log('--- stage3 (full, expressive)');
      var s3xend = Math.min(DEADLINE, Date.now() + (DEADLINE - Date.now()) * 0.6);
      var s3x = stage3(ctx, inc, s3xend, { masks: masks, state: s3state, expressive: true });
      if (s3x.exhausted) s3 = s3x;
    }
    if (ctx.BLUE.length <= S2MAX && Date.now() < DEADLINE && !(U !== null && inc.str >= U)) {
      console.log('--- stage2u (full legal play, tail slice)');
      stage2u(ctx, inc, DEADLINE);
    }
  }

  // A bound-match proof ends the strength hunt the moment the ceiling is
  // found — usually NOT on the cheapest line. Par matters (it is the
  // published number players chase), so spend part of the leftover budget
  // minimising orders at the proven strength: with the incumbent at the
  // ceiling, the bound prunes everything that cannot at least equal it, and
  // the rationed search runs fast.
  if (!TAINted && inc.line && Date.now() + 10000 < DEADLINE &&
      ((U0 !== null && inc.str >= U0) || (U !== null && inc.str >= U)) &&
      ctx.BLUE.length <= S2MAX) {
    var before = inc.orders;
    console.log('--- par refinement (ceiling proven, minimising orders)');
    // equal-strength plan slices first: the witness for the PROVEN kill-set
    // assembles cheaper deployments of the same kills directly (king's 18/20
    // is an 18/21-proof plus a better-ordered deployment of the same mask)
    if (masks) {
      planSlices(ctx, inc, Math.max(20, (DEADLINE - Date.now()) * 0.25 / 1000) * 1000,
        DEADLINE, masks, s3state, 0, 1, 8, true);
    }
    // LNS polish over the best deployments seen — lexicographic acceptance
    // means it grinds orders down at the proven strength
    if (Date.now() + 5000 < DEADLINE) {
      stage3(ctx, inc, Math.min(DEADLINE, Date.now() + (DEADLINE - Date.now()) * 0.3),
        { masks: masks, state: s3state, polishOnly: true, expressive: true });
    }
    stage2(ctx, inc, Math.min(DEADLINE, Date.now() +
      Math.max(30, (DEADLINE - Date.now()) * 0.3 / 1000) * 1000),
      process.env.LATE !== undefined ? [parseInt(process.env.LATE, 10)] : [0, 1, 2, 3]);
    // the deployment tree keeps equal-strength kill-sets alive, so its
    // coverage passes also refine par — often past the rationed model
    if (Date.now() + 5000 < DEADLINE) {
      stage3(ctx, inc, Math.min(DEADLINE, Date.now() + (DEADLINE - Date.now()) * 0.6),
        { masks: masks, state: s3state });
    }
    if (Date.now() + 5000 < DEADLINE) {
      stage3(ctx, inc, DEADLINE, { masks: masks, state: s3state, expressive: true });
    }
    if (inc.orders < before) console.log('  par tightened: ' + before + ' -> ' + inc.orders + ' orders');
  }

  verdict(ctx, inc, U, U0, s2, s3);
}

// The verdict discipline (learned the hard way — Bottleneck's stage-2 model
// completed at 30 STR while real play reaches 35 via swaps the model lacked):
// search completeness only ever proves the model that was searched, and no
// search model here provably contains all legal play. So PROVEN comes from
// BOUND MATCHES ONLY; completeness is reported as what it is — a
// model-relative result that needs a cross-check to become a ceiling.
function verdict(ctx, inc, U, U0, s2, s3) {
  console.log('\nbest: ' + (inc.str / 10) + ' STR in ' + inc.orders + ' orders');
  if (inc.line) {
    var rep = replay(ctx, inc.line);
    console.log('verified: ' + (rep.str / 10) + ' STR in ' + rep.orders + ' orders' +
      (rep.str === inc.str && rep.orders === inc.orders ? '  ✓ matches' : '  ✗ MISMATCH'));
    // V2_DUMP_LINE=<path>: persist the replay-verified best line as the same
    // plain action-array JSON the trace mode consumes — lines are how results
    // travel between tools, reviews and future traces
    if (process.env.V2_DUMP_LINE) {
      require('fs').writeFileSync(process.env.V2_DUMP_LINE, JSON.stringify({
        strength: rep.str, orders: rep.orders, line: inc.line }, null, 1));
      console.log('line dumped to ' + process.env.V2_DUMP_LINE);
    }
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
    if (s2 && s2.complete && s2.fullPlay) {
      proven = true;
      why.push('full-play search complete (' + s2.model + ')');
    } else if (s2 && s2.complete) {
      why.push('search complete within a RESTRICTED move model (' + (s2.model || 'stage2') +
        ') — not a full-play proof; cross-check with compute_ceilings before publishing');
    }
    if (s3 && s3.exhausted) {
      why.push('stage3 exhausted the deployment space (model: ' +
        (s3.expressive
          ? 'walk-then-fight + deferred walk-ins onto kill-opened tiles and rout-shared seats; no free mid-fight repositioning'
          : 'walk-then-fight over live-reach seats only') +
        (s3.fightCapped ? '; ' + s3.fightCapped + ' fights hit the node cap' : '') + ')');
    }
  }
  var line;
  if (proven) {
    line = 'verdict: PROVEN ceiling ' + (inc.str / 10) + ' STR — ' + why.join('; ');
  } else {
    line = 'verdict: best known ' + (inc.str / 10) + ' STR' +
      (U !== null ? '; upper bound ' + (U / 10) + ' STR (U0=' + (U0 / 10) + ')' : '') +
      (why.length ? ' — ' + why.join('; ') : '');
  }
  console.log(line);
  return line;
}

module.exports = { build: build, feasibleMask: feasibleMask, fullRows: fullRows,
  sortedMasks: sortedMasks, upperBound: upperBound, stateBound: stateBound, gAD: gAD,
  verdict: verdict, stage2: stage2, mkIncumbent: mkIncumbent };

if (!WT.isMainThread && WT.workerData && WT.workerData.v2worker) workerMain(WT.workerData);
else if (require.main === module) main();
