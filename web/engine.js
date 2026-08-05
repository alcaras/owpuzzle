// Old World single-turn combat engine — a faithful JS port of the combat core
// from the game's Reference C# source (Unit.cs / InfoHelpers.cs / Tile.cs).
// Deterministic subset: no criticals, no events, no cities. Data comes from
// data.js (extracted from the game's XML).
//
// Works as a browser global (OWENGINE) and as a Node module.
(function () {
  'use strict';

  var DATA = (typeof OWDATA !== 'undefined') ? OWDATA
           : (typeof require !== 'undefined') ? require('./data.js') : null;

  var G = DATA.globals;

  // Axial hex directions, pointy-top. Index = DirectionType-ish; opposite = +3 mod 6.
  var DIRS = [
    { q: 1, r: 0 },   // E
    { q: 1, r: -1 },  // NE
    { q: 0, r: -1 },  // NW
    { q: -1, r: 0 },  // W
    { q: -1, r: 1 },  // SW
    { q: 0, r: 1 },   // SE
  ];

  function key(q, r) { return q + ',' + r; }
  function wrapDir(d, i) { return ((d + i) % 6 + 6) % 6; }

  function hexDistance(a, b) {
    var dq = a.q - b.q, dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  }

  // ---- Utils.modify (Utils.cs:58): base * (100 + mod) / 100, floor toward zero ----
  function modify(value, mod) {
    if (value === 0 || mod === 0) return value;
    var mult = Math.max(0, mod + 100);
    return Math.floor((value * mult) / 100);
  }

  // ================= Game state =================
  //
  // state = {
  //   tiles: { "q,r": {q,r,terrain,height,vegetation,improvement,river:[dir..],owner} },
  //   units: [ {id,player,type,hp,promotions:[],effects? (derived),fortifyTurns,
  //             cooldown:null|'ATTACK'|'ROUT'|'ATTACKED',fatigue,name} ],
  //   orders: int,
  //   log: [string]
  // }

  function cloneState(s) {
    return JSON.parse(JSON.stringify(s));
  }

  function tileAt(state, q, r) { return state.tiles[key(q, r)] || null; }

  function unitAt(state, q, r) {
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.hp > 0 && u.q === q && u.r === r) return u;
    }
    return null;
  }

  function unitById(state, id) {
    for (var i = 0; i < state.units.length; i++)
      if (state.units[i].id === id) return state.units[i];
    return null;
  }

  function info(u) { return DATA.units[u.type]; }

  // All effect units on a unit: innate (traits + aeEffectUnit) + promotions.
  function effectsOf(u) {
    var effs = (info(u).effects || []).slice();
    (u.promotions || []).forEach(function (p) {
      var pr = DATA.promotions[p];
      if (pr && pr.effect) effs.push(pr.effect);
      else if (DATA.effects[p]) effs.push(p); // allow raw effect names in puzzles
    });
    return effs;
  }

  function sumEffect(u, field) {
    var t = 0;
    effectsOf(u).forEach(function (e) {
      var d = DATA.effects[e];
      if (d && typeof d[field] === 'number') t += d[field];
    });
    return t;
  }

  function sumEffectPair(u, field, k) {
    var t = 0;
    effectsOf(u).forEach(function (e) {
      var d = DATA.effects[e];
      if (d && d[field] && typeof d[field][k] === 'number') t += d[field][k];
    });
    return t;
  }

  function hasEffectFlag(u, flag) {
    return effectsOf(u).some(function (e) {
      var d = DATA.effects[e];
      return d && d[flag];
    });
  }

  function isImmuneToEffect(u, eff) {
    return effectsOf(u).some(function (e) {
      var d = DATA.effects[e];
      return d && d.aeEffectUnitImmune && d.aeEffectUnitImmune.indexOf(eff) >= 0;
    });
  }

  // Attacker has a bRout effect the defender is not immune to (Unit.cs:8420).
  function routEffectVs(att, def) {
    var effs = effectsOf(att);
    for (var i = 0; i < effs.length; i++) {
      var d = DATA.effects[effs[i]];
      if (d && d.bRout && !isImmuneToEffect(def, effs[i])) return effs[i];
    }
    return null;
  }

  function isMelee(u) { return !!info(u).bMelee; }
  function rangeMax(u) {
    var r = info(u).iRangeMax || 0;
    if (r > 0) r += sumEffect(u, 'iRangeExtra');
    return r;
  }
  function baseStrength(u) { return info(u).iStrength; }
  function hpMax(u) { return info(u).iHPMax + 0; }
  function isDamaged(u) { return u.hp < hpMax(u); }
  function fatigueLimit(u) { return (info(u).iFatigue || G.UNIT_FATIGUE_LIMIT) + sumEffect(u, 'iFatigueExtra'); }
  function movementPoints(u) { return (info(u).iMovement + sumEffect(u, 'iMovementExtra')) * G.MOVEMENT_MULTIPLER; }

  function isWaterTile(t) { return t.terrain === 'TERRAIN_WATER'; }
  function isUrbanTile(t) { return t.terrain === 'TERRAIN_URBAN'; }
  function isClearTile(t) { return !t.vegetation && !isUrbanTile(t) && !isWaterTile(t); }

  // Approximation of TERRAIN_TARGET_OPEN: clear flat land (used by mounted +25).
  function isTerrainTarget(t, target) {
    if (target === 'TERRAIN_TARGET_OPEN')
      return isClearTile(t) && t.height === 'HEIGHT_FLAT' &&
        ['TERRAIN_LUSH', 'TERRAIN_TEMPERATE', 'TERRAIN_ARID', 'TERRAIN_SAND', 'TERRAIN_TUNDRA'].indexOf(t.terrain) >= 0;
    if (target === 'TERRAIN_TARGET_FERTILE')
      return ['TERRAIN_LUSH', 'TERRAIN_TEMPERATE'].indexOf(t.terrain) >= 0;
    return false;
  }

  function riverBetween(state, a, b) {
    // rivers stored per tile as list of direction indices with a river edge
    var d = dirBetween(a, b);
    if (d < 0) return false;
    var ta = tileAt(state, a.q, a.r), tb = tileAt(state, b.q, b.r);
    if (ta && ta.river && ta.river.indexOf(d) >= 0) return true;
    if (tb && tb.river && tb.river.indexOf(wrapDir(d, 3)) >= 0) return true;
    return false;
  }

  function dirBetween(a, b) {
    for (var d = 0; d < 6; d++)
      if (a.q + DIRS[d].q === b.q && a.r + DIRS[d].r === b.r) return d;
    return -1;
  }

  // ---- flankingAttack (Tile.cs:11978): allied damaging unit on the tile
  // directly opposite the attacker across the defender ----
  function flankingAttack(state, att, fromTile, toTile) {
    var d = dirBetween(fromTile, toTile);
    if (d < 0) return false;
    var opp = tileAt(state, toTile.q + DIRS[d].q, toTile.r + DIRS[d].r);
    if (!opp) return false;
    if (isWaterTile(tileAt(state, fromTile.q, fromTile.r) || fromTile) !== isWaterTile(opp)) return false;
    var u = unitAt(state, opp.q, opp.r);
    return !!(u && u.player === att.player && u.id !== att.id && canDamage(u));
  }

  function canDamage(u) { return !!info(u).bMelee || (info(u).iRangeMax || 0) > 0; }

  function adjacentFriendSame(state, u, t) {
    // friendly unit sharing a trait-class adjacent (used by shield-wall style effects)
    for (var d = 0; d < 6; d++) {
      var o = unitAt(state, t.q + DIRS[d].q, t.r + DIRS[d].r);
      if (o && o.player === u.player && o.id !== u.id && o.type === u.type) return true;
    }
    return false;
  }

  // ================= Strength =================

  // Port of Unit.attackUnitStrength (Unit.cs:8726) — puzzle-relevant subset.
  function attackStrength(state, att, fromTile, toTile, defUnit) {
    if (!canDamage(att)) return 0;
    var mod = sumEffect(att, 'iStrengthModifier') + sumEffect(att, 'iAttackModifier');

    var from = tileAt(state, fromTile.q, fromTile.r);
    var to = toTile ? tileAt(state, toTile.q, toTile.r) : null;

    if (from && to) {
      if (isMelee(att) && isWaterTile(from) !== isWaterTile(to)) {
        mod += G.LAND_WATER_MODIFIER + sumEffect(att, 'iWaterLandAttackModifier');
      }
      var flank = sumEffect(att, 'iFlankingAttackModifier');
      if (flank !== 0 && flankingAttack(state, att, from, to)) mod += flank;

      var adjSame = sumEffect(att, 'iAdjacentSameAttackModifier') + sumEffect(att, 'iAdjacentSameModifier');
      if (adjSame !== 0 && adjacentFriendSame(state, att, from)) mod += adjSame;
    }

    if (to) {
      // fort / defensive improvement helps defender => improvement "to" modifier on attacker side
      if (to.improvement && defUnit) {
        mod += sumEffectPair(att, 'aiImprovementToModifier', to.improvement);
      }
      if (isClearTile(to) && isMelee(att)) {
        effectsOf(att).forEach(function (e) {
          var d = DATA.effects[e];
          if (d && d.aiMeleeToClearTerrainTargetModifier) {
            Object.keys(d.aiMeleeToClearTerrainTargetModifier).forEach(function (tt) {
              if (isTerrainTarget(to, tt)) mod += d.aiMeleeToClearTerrainTargetModifier[tt];
            });
          }
        });
      }
      if (isUrbanTile(to)) {
        mod += sumEffect(att, 'iUrbanAttackModifier');
      } else if (to.vegetation && !ignoresVegetationDefense(att, to.vegetation)) {
        // vegetation protects vs certain attacker classes (trees vs ranged: -50)
        var veg = DATA.vegetation[to.vegetation];
        if (veg && veg.aiDefendEffectUnit) {
          effectsOf(att).forEach(function (e) {
            if (veg.aiDefendEffectUnit[e]) mod += -veg.aiDefendEffectUnit[e];
          });
        }
      }
    }

    if (defUnit) {
      if (isDamaged(defUnit)) mod += sumEffect(att, 'iDamagedThemModifier');
      if (defUnit.general) mod += sumEffect(att, 'iVsGeneralModifier');
      // attacker effects vs defender traits
      (info(defUnit).traits || []).forEach(function (tr) {
        mod += sumEffectPair(att, 'aiUnitTraitModifier', tr);
        mod += sumEffectPair(att, 'aiUnitTraitModifierAttack', tr);
        if (isMelee(att)) mod += sumEffectPair(att, 'aiUnitTraitModifierMelee', tr);
      });
    }

    if (from) {
      if (from.vegetation) mod += sumEffectPair(att, 'aiVegetationFromModifier', from.vegetation);
      mod += sumEffectPair(att, 'aiTerrainFromModifier', from.terrain);
      mod += sumEffectPair(att, 'aiHeightFromModifier', from.height);

      if (to) {
        if (isMelee(att) && riverBetween(state, from, to)) {
          mod += sumEffect(att, 'iRiverAttackModifier');
        }
        mod += distanceModifier(att, from, to);
      }
    }

    return modify(baseStrength(att), mod);
  }

  function ignoresVegetationDefense(u, veg) {
    return effectsOf(u).some(function (e) {
      var d = DATA.effects[e];
      return d && d.aeIgnoreVegetationDefense && d.aeIgnoreVegetationDefense.indexOf(veg) >= 0;
    });
  }

  // Unit.distanceModifier (Unit.cs:6585): -20% per hex beyond the first.
  function distanceModifier(u, from, to) {
    if (hasEffectFlag(u, 'bIgnoresDistance')) return 0;
    var dist = hexDistance(from, to);
    if (dist > 1) return G.DISTANCE_MODIFIER * (dist - 1);
    return 0;
  }

  // Port of Unit.defendUnitStrength (Unit.cs:9044).
  function defendStrength(state, def, toTile, attUnit) {
    var mod = sumEffect(def, 'iStrengthModifier') + sumEffect(def, 'iDefenseModifier');
    var to = tileAt(state, toTile.q, toTile.r);

    var adjSame = sumEffect(def, 'iAdjacentSameModifier');
    if (adjSame !== 0 && adjacentFriendSame(state, def, to)) mod += adjSame;

    // tileDefenseModifier (Unit.cs:8982)
    if (to) {
      if (def.q === to.q && def.r === to.r) {
        mod += (def.fortifyTurns || 0) * G.FORTIFY_BONUS_PER;
      }
      if (isUrbanTile(to)) mod += sumEffect(def, 'iUrbanDefenseModifier');
      if (to.vegetation) mod += sumEffectPair(def, 'aiVegetationFromModifier', to.vegetation);
      mod += sumEffectPair(def, 'aiTerrainFromModifier', to.terrain);
      mod += sumEffectPair(def, 'aiHeightFromModifier', to.height);
      if (to.improvement) {
        var imp = DATA.improvements[to.improvement];
        if (imp) {
          // neutral-or-friendly tile only; puzzles: apply if tile owner is null or defender's
          if (to.owner == null || to.owner === def.player) mod += (imp.iDefenseModifier || 0);
          if (to.owner === def.player) mod += (imp.iDefenseModifierFriendly || 0);
        }
      }
    }

    if (attUnit) {
      if (isDamaged(attUnit)) mod += sumEffect(def, 'iDamagedThemModifier');
      if (attUnit.general) mod += sumEffect(def, 'iVsGeneralModifier');
      (info(attUnit).traits || []).forEach(function (tr) {
        mod += sumEffectPair(def, 'aiUnitTraitModifier', tr);
        mod += sumEffectPair(def, 'aiUnitTraitModifierDefense', tr);
        if (isMelee(def)) mod += sumEffectPair(def, 'aiUnitTraitModifierMelee', tr);
      });
    }

    return Math.max(1, modify(baseStrength(def), mod));
  }

  // ================= Damage =================

  // InfoHelpers.getAttackDamage (InfoHelpers.cs:754)
  function getAttackDamage(fromStr, toStr, percent) {
    var dmg = G.BASE_DAMAGE * fromStr;
    if (fromStr > toStr) dmg += toStr - 1; // round up
    dmg = Math.floor(dmg / toStr);
    if (percent !== 100) dmg = Math.floor((dmg * percent + 99) / 100);
    return Math.max(1, dmg);
  }

  // Unit.attackUnitDamage (Unit.cs:9119) — no crits in puzzles.
  function attackUnitDamage(state, att, fromTile, def, percent) {
    percent = percent == null ? 100 : percent;
    var toTile = { q: def.q, r: def.r };
    if (percent === 0) return def.hp > 1 ? 1 : 0;
    var dmg = getAttackDamage(
      attackStrength(state, att, fromTile, toTile, def),
      defendStrength(state, def, toTile, att), percent);
    if (hasEffectFlag(def, 'bLastStand') && def.hp > 1 && dmg >= def.hp) dmg = def.hp - 1;
    return Math.min(dmg, def.hp);
  }

  // Unit.getCounterAttackDamage (Unit.cs:10526)
  function counterAttackDamage(state, att, fromTile, def) {
    if (!isMelee(att)) return 0;
    if (att.hp === 0) return 0;
    var val = 0;
    if (def) {
      var defTile = tileAt(state, def.q, def.r);
      var atTile = tileAt(state, fromTile.q, fromTile.r);
      if (isWaterTile(defTile) !== isWaterTile(atTile)) {
        // cross-domain: no counter (approximation of mbWater check)
      } else if (!canCounterattack(state, def, att, fromTile)) {
        // no counter
      } else {
        // Unit.cs:10605 getCounterPercentOfAttack: max fortify counters with
        // FULL attack damage; otherwise per-effect percent (Tactician = 100)
        var pct = ((def.fortifyTurns || 0) >= G.MAX_FORTIFY_TURNS) ? 100
                : sumEffect(def, 'iMeleeCounterPercent');
        if (pct > 0) {
          val += Math.floor(attackUnitDamage(state, def, { q: def.q, r: def.r }, att, 100) * pct / 100);
        } else {
          val += counterAttackMelee(def);
        }
      }
    }
    if (att.cooldown === 'ROUT') val += G.COUNTER_ROUT_DAMAGE;
    return Math.min(val, att.hp - 1);
  }

  function canCounterattack(state, def, att, attTile) {
    if (!canDamage(def)) return false;
    if (info(def).bUnlimber) return false; // siege must be limbered; simplification
    if (def.cooldown === 'STUNNED') return false;
    // Unit.cs:10598 — a flanked defender cannot counterattack at all.
    // (This, not bonus damage, is the real payoff of the pincer.)
    if (flankingAttack(state, att, tileAt(state, attTile.q, attTile.r), tileAt(state, def.q, def.r))) return false;
    return true;
  }

  // Unit.cs:8508 canTargetFrom — from tile `pos`, is any hostile unit (other
  // than `exclude`) attackable? Melee range 1; ranged uses rangeMax.
  function canTargetFrom(state, u, pos, excludeId) {
    var r = isMelee(u) ? 1 : rangeMax(u);
    for (var i = 0; i < state.units.length; i++) {
      var o = state.units[i];
      if (o.hp <= 0 || o.player === u.player || o.id === excludeId) continue;
      if (hexDistance(pos, o) <= r) return true;
    }
    return false;
  }

  // Unit.counterAttackMelee (Unit.cs:6571)
  function counterAttackMelee(def) { return sumEffect(def, 'iMeleeCounter'); }

  // ================= Movement =================

  function moveCostInto(state, u, from, to) {
    var t = tileAt(state, to.q, to.r);
    if (!t) return Infinity;
    if (isWaterTile(t) && !info(u).bWater) return Infinity;
    if (t.height === 'HEIGHT_MOUNTAIN' || t.height === 'HEIGHT_VOLCANO') return Infinity;
    // terrain iMovementCost is the full base cost (9 = one move); height and
    // vegetation costs are additive on top
    var cost = (DATA.terrain[t.terrain] && DATA.terrain[t.terrain].iMovementCost) || G.MOVEMENT_MULTIPLER;
    cost += (DATA.height[t.height] && DATA.height[t.height].iMovementCost) || 0;
    if (t.vegetation) cost += (DATA.vegetation[t.vegetation] && DATA.vegetation[t.vegetation].iMovementCost) || 0;
    if (t.road) cost = G.ROAD_MOVEMENT_COST;
    if (riverBetween(state, from, to) && !(t.road && tileAt(state, from.q, from.r).road)) {
      cost += G.RIVER_MOVEMENT_COST;
    }
    return cost;
  }

  function inEnemyZOC(state, u, q, r) {
    for (var d = 0; d < 6; d++) {
      var o = unitAt(state, q + DIRS[d].q, r + DIRS[d].r);
      if (o && o.player !== u.player && info(o).bZOC) return true;
    }
    return false;
  }

  // Reachable tiles for one move action. Returns [{q,r,cost}]
  function reachableTiles(state, u) {
    if (!canAct(state, u)) return [];
    var start = { q: u.q, r: u.r };
    var best = {}; best[key(u.q, u.r)] = 0;
    var frontier = [{ q: u.q, r: u.r, left: movementPoints(u) }];
    var ignoreZOC = hasEffectFlag(u, 'bIgnoreZOC');
    var out = {};
    while (frontier.length) {
      var cur = frontier.pop();
      for (var d = 0; d < 6; d++) {
        var nq = cur.q + DIRS[d].q, nr = cur.r + DIRS[d].r;
        var t = tileAt(state, nq, nr);
        if (!t) continue;
        var occ = unitAt(state, nq, nr);
        if (occ) continue; // one unit per tile; can't pass through anyone (simplified)
        var c = moveCostInto(state, u, cur, { q: nq, r: nr });
        if (c > cur.left) continue;
        var k = key(nq, nr);
        var spent = movementPoints(u) - cur.left + c;
        if (best[k] != null && best[k] <= spent) continue;
        best[k] = spent;
        out[k] = { q: nq, r: nr, cost: spent };
        var leftAfter = cur.left - c;
        // entering enemy ZOC ends movement
        if (!ignoreZOC && inEnemyZOC(state, u, nq, nr)) continue;
        frontier.push({ q: nq, r: nr, left: leftAfter });
      }
    }
    return Object.keys(out).map(function (k2) { return out[k2]; });
  }

  function canAct(state, u) {
    if (u.hp <= 0) return false;
    if (u.cooldown && u.cooldown !== 'ROUT') return false;
    if (u.fatigue >= fatigueLimit(u)) return false;
    if (state.orders <= 0) return false;
    return true;
  }

  // Attackable targets from the unit's current tile.
  function attackTargets(state, u) {
    if (!canAct(state, u) || !canDamage(u)) return [];
    var out = [];
    var r = rangeMax(u);
    state.units.forEach(function (t) {
      if (t.hp <= 0 || t.player === u.player) return;
      var dist = hexDistance(u, t);
      if (isMelee(u) ? dist === 1 : (dist >= 1 && dist <= r)) {
        // ranged line of sight: simplified (no blocking on small arenas)
        out.push(t);
      }
    });
    return out;
  }

  // ================= Actions =================

  function previewAttack(state, attId, defId) {
    var att = unitById(state, attId), def = unitById(state, defId);
    var from = { q: att.q, r: att.r };
    var dmg = attackUnitDamage(state, att, from, def, 100);
    var counter = counterAttackDamage(state, att, from, def);
    var kills = dmg >= def.hp;
    var routEff = kills && isMelee(att) && hexDistance(att, def) === 1 ? routEffectVs(att, def) : null;
    return { damage: dmg, counter: counter, kills: kills, rout: !!routEff, collateral: collateralPreview(state, att, def) };
  }

  function collateralPreview(state, att, def) {
    var out = [];
    forEachCollateral(state, att, def, function (victim, pct) {
      out.push({ id: victim.id, damage: attackUnitDamage(state, att, { q: att.q, r: att.r }, victim, pct) });
    });
    return out;
  }

  // attack.xml patterns via Tile.getAttackTiles (Tile.cs:12419)
  function forEachCollateral(state, att, def, fn) {
    var from = { q: att.q, r: att.r }, to = { q: def.q, r: def.r };
    var d = dirBetween(from, to);
    var patterns = {
      'ATTACK_PIERCE': function (value, pct) {
        if (d < 0) return; // pierce only along an adjacent direction
        var last = to;
        for (var i = 0; i < value; i++) {
          var nxt = { q: last.q + DIRS[d].q, r: last.r + DIRS[d].r };
          if (!tileAt(state, nxt.q, nxt.r)) break;
          visit(nxt, pct);
          last = nxt;
        }
      },
      'ATTACK_CLEAVE': function (value, pct) {
        if (d < 0) return;
        for (var i = 0; i < value; i++) {
          [wrapDir(d, i + 1), wrapDir(d, -(i + 1))].forEach(function (dd) {
            visit({ q: from.q + DIRS[dd].q, r: from.r + DIRS[dd].r }, pct);
          });
        }
      },
      'ATTACK_CIRCLE': function (value, pct) {
        if (d < 0) return;
        for (var dd = 0; dd < 6; dd++) {
          if (dd !== d) visit({ q: from.q + DIRS[dd].q, r: from.r + DIRS[dd].r }, pct);
        }
      },
      'ATTACK_SPLASH': function (value, pct) {
        for (var dd = 0; dd < 6; dd++) {
          var t2 = { q: to.q + DIRS[dd].q, r: to.r + DIRS[dd].r };
          if (t2.q === from.q && t2.r === from.r) continue;
          visit(t2, pct);
        }
      },
    };
    function visit(pos, pct) {
      var v = unitAt(state, pos.q, pos.r);
      if (v && v.player !== att.player && v.hp > 0) fn(v, pct);
    }
    Object.keys(patterns).forEach(function (atk) {
      var value = sumEffectPair(att, 'aiAttackValue', atk);
      var pct = sumEffectPair(att, 'aiAttackPercent', atk);
      if (value > 0 && pct > 0) patterns[atk](value, pct);
    });
  }

  // Execute a move action. Returns new state (does not mutate).
  function doMove(state, unitId, q, r) {
    var s = cloneState(state);
    var u = unitById(s, unitId);
    var reach = reachableTiles(s, u);
    var ok = reach.some(function (t) { return t.q === q && t.r === r; });
    if (!ok) throw new Error('illegal move');
    u.q = q; u.r = r;
    u.fatigue += 1;
    u.fortifyTurns = 0;
    s.orders -= 1;
    s.log.push(nameOf(u) + ' moves');
    return s;
  }

  // Execute an attack action. Returns new state.
  function doAttack(state, attId, defId) {
    var s = cloneState(state);
    var att = unitById(s, attId), def = unitById(s, defId);
    if (!canAct(s, att)) throw new Error('unit cannot act');
    var legal = attackTargets(s, att).some(function (t) { return t.id === defId; });
    if (!legal) throw new Error('illegal attack');

    var from = { q: att.q, r: att.r };
    var defTile = { q: def.q, r: def.r };
    var adjacent = hexDistance(att, def) === 1;

    // counter computed BEFORE damage (Unit.cs:9608), applied after — simultaneous
    var counter = counterAttackDamage(s, att, from, def);
    var dmg = attackUnitDamage(s, att, from, def, 100);
    def.hp -= dmg;
    var killed = def.hp <= 0;
    var msg = nameOf(att) + ' hits ' + nameOf(def) + ' for ' + dmg;

    // collateral attacks (pierce/cleave/circle/splash)
    forEachCollateral(s, att, def, function (victim, pct) {
      var cd = attackUnitDamage(s, att, from, victim, pct);
      victim.hp -= cd;
      s.log.push(nameOf(att) + ' collateral ' + cd + ' to ' + nameOf(victim) + (victim.hp <= 0 ? ' (killed)' : ''));
    });

    att.hp -= counter;
    if (counter > 0) msg += ', takes ' + counter + ' counter';
    if (killed) msg += ' — killed!';
    s.log.push(msg);

    // defender loses a fortification turn when melee-attacked (Unit.cs:9643)
    if (isMelee(att) && !killed && def.fortifyTurns > 0 && adjacent) def.fortifyTurns -= 1;

    // rout / advance / cooldown (Unit.cs:9705-9734, 8342-8433).
    // ROUT (and the advance) requires a FURTHER hostile attackable from the
    // tile the unit ends on (canTargetFrom, Unit.cs:8413) — a lone kill gives
    // a plain attack cooldown and no advance.
    var routEff = killed && adjacent && isMelee(att) ? routEffectVs(att, def) : null;
    var routed = false;
    if (routEff && att.hp > 0) {
      var blocked = unitAt(s, defTile.q, defTile.r);
      var canAdvance = !blocked && moveCostInto(s, att, from, defTile) !== Infinity &&
        canTargetFrom(s, att, defTile, def.id);
      if (canAdvance) {
        att.q = defTile.q; att.r = defTile.r;
        routed = true;
        s.log.push(nameOf(att) + ' overruns forward and routs — may act again');
      } else if (canTargetFrom(s, att, from, def.id)) {
        routed = true;
        s.log.push(nameOf(att) + ' routs — may act again');
      }
    }
    if (routed) {
      att.cooldown = 'ROUT';
    } else {
      att.cooldown = 'ATTACK';
    }

    att.fatigue += 1;
    att.fortifyTurns = 0;
    s.orders -= 1;
    return s;
  }

  function doFortify(state, unitId) {
    var s = cloneState(state);
    var u = unitById(s, unitId);
    if (!canAct(s, u) || !info(u).bFortify) throw new Error('cannot fortify');
    u.fortifyTurns = Math.min(G.MAX_FORTIFY_TURNS, (u.fortifyTurns || 0) + 1);
    u.fatigue += 1;
    u.cooldown = 'ATTACK'; // fortifying ends the unit's activity for the turn
    s.orders -= 1;
    s.log.push(nameOf(u) + ' fortifies');
    return s;
  }

  function nameOf(u) {
    return (u.name || u.type.replace('UNIT_', '').toLowerCase().replace(/_/g, ' ')) +
      (u.player === 0 ? ' (blue)' : ' (red)');
  }

  // ================= Objectives =================

  function checkObjective(state, objective) {
    switch (objective.kind) {
      case 'killAll':
        return state.units.filter(function (u) { return u.player === 1 && u.hp > 0; }).length === 0;
      case 'killTarget':
        var t = unitById(state, objective.target);
        return !t || t.hp <= 0;
      case 'surviveAll':
        return state.units.filter(function (u) { return u.player === 0 && u.hp <= 0; }).length === 0;
      default:
        return false;
    }
  }

  // All legal actions for the blue player in the current state.
  function legalActions(state) {
    var acts = [];
    state.units.forEach(function (u) {
      if (u.player !== 0) return;
      if (!canAct(state, u)) return;
      attackTargets(state, u).forEach(function (t) {
        acts.push({ type: 'attack', unit: u.id, target: t.id });
      });
      reachableTiles(state, u).forEach(function (t) {
        acts.push({ type: 'move', unit: u.id, q: t.q, r: t.r });
      });
    });
    return acts;
  }

  function applyAction(state, a) {
    if (a.type === 'attack') return doAttack(state, a.unit, a.target);
    if (a.type === 'move') return doMove(state, a.unit, a.q, a.r);
    if (a.type === 'fortify') return doFortify(state, a.unit);
    throw new Error('unknown action ' + a.type);
  }

  // ================= Puzzle loading =================

  // puzzle = { name, orders, objective, tiles:[{q,r,terrain?,height?,veg?,improvement?,river?}...] OR radius,
  //            units:[{player,type,q,r,hp?,promotions?,fortifyTurns?,name?}] }
  function loadPuzzle(p) {
    var tiles = {};
    if (p.radius != null) {
      for (var q = -p.radius; q <= p.radius; q++)
        for (var r = Math.max(-p.radius, -q - p.radius); r <= Math.min(p.radius, -q + p.radius); r++)
          tiles[key(q, r)] = { q: q, r: r, terrain: 'TERRAIN_TEMPERATE', height: 'HEIGHT_FLAT', vegetation: null, improvement: null, river: [], road: false, owner: null };
    }
    (p.tiles || []).forEach(function (t) {
      var base = tiles[key(t.q, t.r)] || { q: t.q, r: t.r, terrain: 'TERRAIN_TEMPERATE', height: 'HEIGHT_FLAT', vegetation: null, improvement: null, river: [], road: false, owner: null };
      Object.keys(t).forEach(function (k2) { base[k2] = t[k2]; });
      tiles[key(t.q, t.r)] = base;
    });
    var units = p.units.map(function (u, i) {
      return {
        id: i, player: u.player, type: u.type, q: u.q, r: u.r,
        hp: u.hp != null ? u.hp : DATA.units[u.type].iHPMax,
        promotions: u.promotions || [], fortifyTurns: u.fortifyTurns || 0,
        cooldown: null, fatigue: 0, general: !!u.general, name: u.name || null,
      };
    });
    return { tiles: tiles, units: units, orders: p.orders, objective: p.objective, log: [] };
  }

  var api = {
    DATA: DATA, DIRS: DIRS, key: key, hexDistance: hexDistance, dirBetween: dirBetween,
    modify: modify, tileAt: tileAt, unitAt: unitAt, unitById: unitById,
    effectsOf: effectsOf, isMelee: isMelee, rangeMax: rangeMax, hpMax: hpMax,
    canAct: canAct, canDamage: canDamage, fatigueLimit: fatigueLimit,
    movementPoints: movementPoints, reachableTiles: reachableTiles,
    attackTargets: attackTargets, attackStrength: attackStrength,
    defendStrength: defendStrength, attackUnitDamage: attackUnitDamage,
    counterAttackDamage: counterAttackDamage, previewAttack: previewAttack,
    doMove: doMove, doAttack: doAttack, doFortify: doFortify,
    legalActions: legalActions, applyAction: applyAction,
    checkObjective: checkObjective, loadPuzzle: loadPuzzle, cloneState: cloneState,
    nameOf: nameOf,
  };

  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.OWENGINE = api;
})();
