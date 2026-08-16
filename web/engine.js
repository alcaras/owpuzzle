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
  //             cooldown:null|'ATTACK'|'ROUT'|'ATTACKED',steps,name} ],
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
    (u.applied || []).forEach(function (e) { effs.push(e); });   // disarmed etc.
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

  // Which promotions supplied a modifier. The attack preview labels bonuses by
  // category — "terrain +25%" — which reads as if the promotion that granted
  // it were missing; naming the source is the whole difference between a
  // player trusting the number and filing a bug about it.
  function effectSources(u, field, k) {
    var names = [];
    effectsOf(u).forEach(function (e) {
      var d = DATA.effects[e];
      var v = d && (k == null ? d[field] : (d[field] && d[field][k]));
      if (typeof v === 'number' && v !== 0) {
        var nm = (DATA.effectNames && DATA.effectNames[e]) || e.replace('EFFECTUNIT_', '');
        names.push(nm.replace(/^link\([^)]*\)\s*/, ''));
      }
    });
    return names;
  }
  function labelWith(base, u, field, k) {
    var s = effectSources(u, field, k);
    return s.length ? base + ' (' + s.join(', ') + ')' : base;
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
  // Unit.cs:8493 — a shot inside the unit's minimum range is illegal
  // (`if (iDistance < info().miRangeMin) return false`), and getTargetTiles
  // starts its scan at that distance (Unit.cs:6434). Siege engines (onager 2,
  // mangonel 2) cannot hit what is standing on top of them.
  function rangeMin(u) { return isMelee(u) ? 1 : Math.max(1, info(u).iRangeMin || 0); }
  // Unit.baseStrength + Unit.baseStrengthModifier (Unit.cs:6278-6291): the
  // wounded modifier is part of the unit OWN strength, so it counts when it
  // attacks, when it defends, and when it counterattacks. Adding it on the
  // defence side only left TOUGH doing half its job.
  function baseStrength(u) {
    var v = info(u).iStrength;
    if (isDamaged(u)) {
      var pct = sumEffect(u, 'iDamagedUsModifier');
      if (pct) v = Math.round(v * (100 + pct) / 100);
    }
    return v;
  }
  function hpMax(u) { return info(u).iHPMax + 0; }
  function isDamaged(u) { return u.hp < hpMax(u); }
  function fatigueLimit(u) { return (info(u).iFatigue || G.UNIT_FATIGUE_LIMIT) + sumEffect(u, 'iFatigueExtra'); }
  function movementPoints(u) { return (info(u).iMovement + sumEffect(u, 'iMovementExtra')) * G.MOVEMENT_MULTIPLER; }

  function isWaterTile(t) { return t.terrain === 'TERRAIN_WATER'; }
  function isUrbanTile(t) { return t.terrain === 'TERRAIN_URBAN' || t.city != null; }
  function isClearTile(t) { return !t.vegetation && !t.improvement && !isUrbanTile(t) && !isWaterTile(t); } // Tile.isClear = !hasImprovement (Tile.cs:3092)

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

  function prettyEffect(e) {
    return e.replace('EFFECTUNIT_', '').toLowerCase().replace(/_/g, ' ')
      .replace(/(\d)$/, ' $1').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function prettyTrait(t) {
    return t.replace('UNITTRAIT_', '').toLowerCase();
  }

  // Port of Unit.attackUnitStrength (Unit.cs:8726) — puzzle-relevant subset.
  // Pass `out` (array) to collect a labelled modifier breakdown.
  function attackStrength(state, att, fromTile, toTile, defUnit, out) {
    if (!canDamage(att)) return 0;
    var mod = 0;
    function add(label, v) {
      if (!v) return;
      mod += v;
      if (out) out.push({ label: label, pct: v });
    }
    function addPerEffect(field, suffix) {
      effectsOf(att).forEach(function (e) {
        var d = DATA.effects[e];
        if (d && d[field]) add(prettyEffect(e) + (suffix || ''), d[field]);
      });
    }
    addPerEffect('iStrengthModifier');
    addPerEffect('iAttackModifier', ' (attack)');

    var from = tileAt(state, fromTile.q, fromTile.r);
    var to = toTile ? tileAt(state, toTile.q, toTile.r) : null;

    if (from && to) {
      var flank = sumEffect(att, 'iFlankingAttackModifier');
      if (flank !== 0 && flankingAttack(state, att, from, to)) add('flanking', flank);

      var adjSame = sumEffect(att, 'iAdjacentSameAttackModifier') + sumEffect(att, 'iAdjacentSameModifier');
      if (adjSame !== 0 && adjacentFriendSame(state, att, from)) add('adjacent same unit', adjSame);
    }

    if (to) {
      // fort / defensive improvement helps defender => improvement "to" modifier on attacker side
      if (to.improvement && defUnit) {
        add('vs ' + to.improvement.replace('IMPROVEMENT_', '').toLowerCase(),
          sumEffectPair(att, 'aiImprovementToModifier', to.improvement));
      }
      if (isClearTile(to) && isMelee(att)) {
        effectsOf(att).forEach(function (e) {
          var d = DATA.effects[e];
          if (d && d.aiMeleeToClearTerrainTargetModifier) {
            Object.keys(d.aiMeleeToClearTerrainTargetModifier).forEach(function (tt) {
              if (isTerrainTarget(to, tt)) add('attacking open terrain', d.aiMeleeToClearTerrainTargetModifier[tt]);
            });
          }
        });
      }
      if (isUrbanTile(to)) {
        add('attacking urban', sumEffect(att, 'iUrbanAttackModifier'));
      } else if (to.vegetation && !ignoresVegetationDefense(att, to.vegetation)) {
        // vegetation protects vs certain attacker classes (trees vs ranged: -50)
        var veg = DATA.vegetation[to.vegetation];
        if (veg && veg.aiDefendEffectUnit) {
          effectsOf(att).forEach(function (e) {
            if (veg.aiDefendEffectUnit[e])
              add('target in ' + to.vegetation.replace('VEGETATION_', '').toLowerCase(), -veg.aiDefendEffectUnit[e]);
          });
        }
      }
    }

    if (defUnit) {
      if (isDamaged(defUnit)) add('vs damaged', sumEffect(att, 'iDamagedThemModifier'));
      if (defUnit.general) add('vs general', sumEffect(att, 'iVsGeneralModifier'));
      // attacker effects vs defender traits
      (info(defUnit).traits || []).forEach(function (tr) {
        add('vs ' + prettyTrait(tr), sumEffectPair(att, 'aiUnitTraitModifier', tr));
        add('vs ' + prettyTrait(tr), sumEffectPair(att, 'aiUnitTraitModifierAttack', tr));
        if (isMelee(att)) add('vs ' + prettyTrait(tr), sumEffectPair(att, 'aiUnitTraitModifierMelee', tr));
      });
    }

    if (from) {
      if (from.vegetation) add('fighting from ' + from.vegetation.replace('VEGETATION_', '').toLowerCase(),
        sumEffectPair(att, 'aiVegetationFromModifier', from.vegetation));
      add(labelWith('terrain', att, 'aiTerrainFromModifier', from.terrain),
        sumEffectPair(att, 'aiTerrainFromModifier', from.terrain));
      add(labelWith('height', att, 'aiHeightFromModifier', from.height),
        sumEffectPair(att, 'aiHeightFromModifier', from.height));
      if (from.owner === att.player) add('friendly territory', sumEffect(att, 'iHomeModifier'));

      if (to) {
        if (isMelee(att) && riverBetween(state, from, to)) {
          add('attacking across river', sumEffect(att, 'iRiverAttackModifier'));
        }
        // Unit.cs:8748 — a MELEE attack that crosses the shoreline (land at
        // water or the reverse) is heavily penalised; Amphibious/Marines
        // offset it via iWaterLandAttackModifier.
        if (isMelee(att) && isWaterTile(from) !== isWaterTile(to)) {
          add('attacking across the shoreline',
            G.LAND_WATER_MODIFIER + sumEffect(att, 'iWaterLandAttackModifier'));
        }
        add('distance', distanceModifier(att, from, to));
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
  // A RANGED shot that crosses the shoreline counts as one hex further
  // (Unit.cs:6606), so even a point-blank shot from land at a ship takes the
  // penalty. Eagle Eye (bIgnoresDistance) removes all of it.
  function distanceModifier(u, from, to) {
    if (hasEffectFlag(u, 'bIgnoresDistance')) return 0;
    var dist = hexDistance(from, to);
    if (!isMelee(u) && isWaterTile(from) !== isWaterTile(to)) dist++;
    if (dist > 1) return G.DISTANCE_MODIFIER * (dist - 1);
    return 0;
  }

  // Port of Unit.defendUnitStrength (Unit.cs:9044).
  // Pass `out` (array) to collect a labelled modifier breakdown.
  function defendStrength(state, def, toTile, attUnit, out) {
    var mod = 0;
    function add(label, v) {
      if (!v) return;
      mod += v;
      if (out) out.push({ label: label, pct: v });
    }
    function addPerEffect(field, suffix) {
      effectsOf(def).forEach(function (e) {
        var d = DATA.effects[e];
        if (d && d[field]) add(prettyEffect(e) + (suffix || ''), d[field]);
      });
    }
    addPerEffect('iStrengthModifier');
    addPerEffect('iDefenseModifier', ' (defense)');
    var to = tileAt(state, toTile.q, toTile.r);

    var adjSame = sumEffect(def, 'iAdjacentSameModifier');
    if (adjSame !== 0 && adjacentFriendSame(state, def, to)) add('adjacent same unit', adjSame);

    if (def.unlimbered) add('unlimbered', G.UNLIMBERED_DEFENSE_MODIFIER);

    // tileDefenseModifier (Unit.cs:8982)
    if (to) {
      if (def.q === to.q && def.r === to.r) {
        add('fortified', (def.fortifyTurns || 0) * G.FORTIFY_BONUS_PER);
      }
      if (isUrbanTile(to)) add('urban', sumEffect(def, 'iUrbanDefenseModifier'));
      if (to.vegetation) add('in ' + to.vegetation.replace('VEGETATION_', '').toLowerCase(),
        sumEffectPair(def, 'aiVegetationFromModifier', to.vegetation));
      add(labelWith('terrain', def, 'aiTerrainFromModifier', to.terrain),
        sumEffectPair(def, 'aiTerrainFromModifier', to.terrain));
      add(labelWith('height', def, 'aiHeightFromModifier', to.height),
        sumEffectPair(def, 'aiHeightFromModifier', to.height));
      if (to.owner === def.player) add('friendly territory', sumEffect(def, 'iHomeModifier'));
      if (to.improvement) {
        var imp = DATA.improvements[to.improvement];
        if (imp) {
          var impName = to.improvement.replace('IMPROVEMENT_', '').toLowerCase();
          // neutral-or-friendly tile only; puzzles: apply if tile owner is null or defender's
          if (to.owner == null || to.owner === def.player) add(impName, imp.iDefenseModifier || 0);
          if (to.owner === def.player) add(impName + ' (friendly)', imp.iDefenseModifierFriendly || 0);
        }
      }
    }

    if (attUnit) {
      if (isDamaged(attUnit)) add('vs damaged', sumEffect(def, 'iDamagedThemModifier'));
      if (attUnit.general) add('vs general', sumEffect(def, 'iVsGeneralModifier'));
      (info(attUnit).traits || []).forEach(function (tr) {
        add('vs ' + prettyTrait(tr), sumEffectPair(def, 'aiUnitTraitModifier', tr));
        add('vs ' + prettyTrait(tr), sumEffectPair(def, 'aiUnitTraitModifierDefense', tr));
        // Unit.defendUnitStrength (Unit.cs:9111): the melee trait bonus is
        // gated on the ATTACKER being melee, not the defender. A maceman's
        // anti-infantry bonus protects it from an axeman, not from an archer
        // shooting it — we were testing the wrong unit and handing it out
        // against ranged attacks too.
        if (isMelee(attUnit)) add('vs ' + prettyTrait(tr), sumEffectPair(def, 'aiUnitTraitModifierMelee', tr));
      });
    }

    return Math.max(1, modify(baseStrength(def), mod));
  }

  // Full attack preview with the game-style breakdown: both strengths with
  // labelled modifiers, damage, counter, kill/rout flags.
  function explainAttack(state, attId, defId) {
    var att = unitById(state, attId), def = unitById(state, defId);
    var from = { q: att.q, r: att.r }, to = { q: def.q, r: def.r };
    var attMods = [], defMods = [];
    var aStr = attackStrength(state, att, from, to, def, attMods);
    var dStr = defendStrength(state, def, to, att, defMods);
    var pv = previewAttack(state, attId, defId);
    return {
      att: { name: att.type, base: baseStrength(att), mods: attMods, total: aStr },
      def: { name: def.type, base: baseStrength(def), mods: defMods, total: dStr },
      rawDamage: getAttackDamage(aStr, dStr, 100),
      damage: pv.damage, counter: pv.counter, kills: pv.kills, rout: pv.rout,
      collateral: pv.collateral,
    };
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
    var r = isMelee(u) ? 1 : targetingRangeFrom(state, u, pos);
    for (var i = 0; i < state.units.length; i++) {
      var o = state.units[i];
      if (o.hp <= 0 || o.player === u.player || o.id === excludeId) continue;
      var d = hexDistance(pos, o);
      if (d >= rangeMin(u) && d <= r) return true;
    }
    return false;
  }

  // Unit.counterAttackMelee (Unit.cs:6571)
  function counterAttackMelee(def) { return sumEffect(def, 'iMeleeCounter'); }

  // ================= Movement =================

  function moveCostInto(state, u, from, to) {
    var t = tileAt(state, to.q, to.r);
    if (!t) return Infinity;
    if (info(u).bWater) {
      // ships sail water only
      if (!isWaterTile(t)) return Infinity;
      if (u.anchored) return Infinity;
      return G.MOVEMENT_MULTIPLER;
    }
    if (isWaterTile(t)) {
      // land units may enter water under friendly WATER CONTROL, spending a
      // full move (Unit.cs:7578 returns movement())
      if (!waterControlled(state, to, u.player)) return Infinity;
      return movementPoints(u);
    }
    if (t.height === 'HEIGHT_MOUNTAIN' || t.height === 'HEIGHT_VOLCANO') return Infinity;
    // terrain iMovementCost is the full base cost (9 = one move); height and
    // vegetation costs are additive on top
    var cost = (DATA.terrain[t.terrain] && DATA.terrain[t.terrain].iMovementCost) || G.MOVEMENT_MULTIPLER;
    cost += (DATA.height[t.height] && DATA.height[t.height].iMovementCost) || 0;
    if (t.vegetation) cost += (DATA.vegetation[t.vegetation] && DATA.vegetation[t.vegetation].iMovementCost) || 0;
    var fromT = tileAt(state, from.q, from.r);
    var crossing = riverBetween(state, from, to);
    if (t.road && fromT && fromT.road && !crossing) cost = G.ROAD_MOVEMENT_COST;
    if (crossing && !(t.road && fromT && fromT.road)) {
      cost += G.RIVER_CROSSING_COST_EXTRA; // Unit.cs:7605-7609
    }
    return cost;
  }

  // Tile (q,r) is in hostile ZOC for unit u: an adjacent enemy with ZOC,
  // across a non-river edge (Tile.isHostileZOC, Tile.cs:10061 — ZOC does not
  // project across rivers).
  function waterControlled(state, pos, player) {
    for (var i = 0; i < state.units.length; i++) {
      var o = state.units[i];
      if (o.hp <= 0 || o.player !== player || !info(o).bWater || !o.anchored) continue;
      var radius = 1 + sumEffect(o, 'iWaterControlExtra');
      if (hexDistance(o, pos) <= radius) return true;
    }
    // friendly city harbors control adjacent water
    for (var d = 0; d < 6; d++) {
      var t = tileAt(state, pos.q + DIRS[d].q, pos.r + DIRS[d].r);
      if (t && t.city === player) return true;
    }
    return false;
  }

  // does `holder` project zone of control specifically at `mover`'s traits?
  function unitTraitZOC(holder, mover) {
    var traits = info(mover).traits || [];
    var effs = effectsOf(holder);
    for (var i = 0; i < effs.length; i++) {
      var e = DATA.effects[effs[i]];
      if (!e || !e.aeUnitTraitZOC) continue;
      for (var j = 0; j < e.aeUnitTraitZOC.length; j++) {
        if (traits.indexOf(e.aeUnitTraitZOC[j]) >= 0) return true;
      }
    }
    return false;
  }

  function inEnemyZOC(state, u, q, r) {
    // Unit.hasIgnoreZOC (Unit.cs:7013): the unit's OWN flag counts as well as
    // any effect granting it. Palton cavalry carry bIgnoreZOC on the unit.
    var ignores = info(u).bIgnoreZOC || hasEffectFlag(u, 'bIgnoreZOC');
    var here = tileAt(state, q, r);
    if (here && here.city != null) return false;   // city tiles are never in ZOC (Tile.cs:10070)
    for (var d = 0; d < 6; d++) {
      if (riverBetween(state, { q: q, r: r }, { q: q + DIRS[d].q, r: r + DIRS[d].r })) continue;
      var nt = tileAt(state, q + DIRS[d].q, r + DIRS[d].r);
      if (!nt) continue;
      if (here && isWaterTile(here) !== isWaterTile(nt)) continue; // no ZOC across the shoreline (Tile.cs:10044)
      if (nt.city != null && nt.city !== u.player) return true; // hostile cities project ZOC (Tile.cs:10049)
      var o = unitAt(state, q + DIRS[d].q, r + DIRS[d].r);
      if (o && o.player !== u.player) {
        // Tile.isDirectionHostileZOC (Tile.cs:10091): ignoring ZOC is not
        // absolute. After the ignore test the game asks isUnitZoc(movingType)
        // — EFFECTUNIT_POLEARM lists UNITTRAIT_MOUNTED, so spears, pikes,
        // conscripts, hoplites and phalangites still pin cavalry that walks
        // past every other kind of enemy.
        if (unitTraitZOC(o, u)) return true;
        if (!ignores && info(o).bZOC) return true;
      }
    }
    return false;
  }

  // Reachable tiles this turn, multi-step, exactly as the game previews it
  // (Unit.getVisibleMoveLimit / getNumStepsForCost / getNumOrdersForSteps):
  // Dijkstra over total movement cost; steps = ceil(cost / full movement);
  // orders charged per step, doubled past the fatigue limit (march only).
  // Returns [{q, r, cost, steps, orders, forced}].
  // ZOC rule (Unit.isValidMovementDirection, Unit.cs:7685): a step from one
  // hostile-ZOC tile to another hostile-ZOC tile is forbidden; entering ZOC
  // does NOT stop movement.
  function reachableTiles(state, u) {
    if (u.hp <= 0 || u.cooldown) return [];
    var full = movementPoints(u);
    var limit = fatigueLimit(u);
    var maxTotal = u.march ? limit * 2 : limit;   // march unlocks the second band
    var stepsAvail = Math.max(0, maxTotal - u.steps);
    function ordersForSteps(k) {
      var o = 0;
      for (var i = 1; i <= k; i++) o += (u.steps + i > limit) ? 1 + G.UNIT_FATIGUE_COST : 1;
      return o;
    }
    while (stepsAvail > 0 && ordersForSteps(stepsAvail) > state.orders) stepsAvail--;
    if (!stepsAvail) return [];
    var budget = stepsAvail * full;

    var best = {}; best[key(u.q, u.r)] = 0;
    var frontier = [{ q: u.q, r: u.r, cost: 0 }];
    var out = {};
    while (frontier.length) {
      // smallest-cost-first (boards are tiny; linear scan is fine)
      var bi = 0;
      for (var fi = 1; fi < frontier.length; fi++) if (frontier[fi].cost < frontier[bi].cost) bi = fi;
      var cur = frontier.splice(bi, 1)[0];
      if (best[key(cur.q, cur.r)] < cur.cost) continue;
      var curZOC = inEnemyZOC(state, u, cur.q, cur.r);
      for (var d = 0; d < 6; d++) {
        var nq = cur.q + DIRS[d].q, nr = cur.r + DIRS[d].r;
        var t = tileAt(state, nq, nr);
        if (!t) continue;
        var occ = unitAt(state, nq, nr);
        if (occ && occ.player !== u.player) continue; // enemies block the path
        // friendly units can be moved THROUGH but not ended on
        if (curZOC && inEnemyZOC(state, u, nq, nr)) continue; // ZOC -> ZOC step
        var tileCost = moveCostInto(state, u, cur, { q: nq, r: nr });
        if (tileCost === Infinity) continue;
        // PathFinder.getTileMoveCost: clamp so the step ends exactly on the
        // boundary — any tile is enterable with any movement remaining
        var partial = cur.cost % full;
        var c = cur.cost + ((partial + tileCost >= full) ? (full - partial) : tileCost);
        if (c > budget) continue;
        var k = key(nq, nr);
        if (best[k] != null && best[k] <= c) continue;
        best[k] = c;
        if (!occ) {
          var st = Math.ceil(c / full);
          out[k] = { q: nq, r: nr, cost: c, steps: st, orders: ordersForSteps(st),
                     forced: u.steps + st > limit };
        }
        frontier.push({ q: nq, r: nr, cost: c });
      }
    }
    return Object.keys(out).map(function (k2) { return out[k2]; });
  }

  // Order cost of the unit's NEXT move step: 1, or 1+UNIT_FATIGUE_COST when
  // force-marching past the fatigue limit (Unit.getNumOrdersForSteps).
  function nextStepOrderCost(u) {
    return u.steps >= fatigueLimit(u) ? 1 + G.UNIT_FATIGUE_COST : 1;
  }

  // Movement: any cooldown (including ROUT) blocks it; force march allows
  // steps beyond the fatigue limit at double order cost, up to 2x the limit
  // (Unit.canActMove, Unit.cs:7440).
  function canMove(state, u) {
    if (u.hp <= 0) return false;
    if (u.cooldown) return false;
    if (u.steps + 1 > fatigueLimit(u)) {
      if (!u.march) return false;                      // must MARCH first (Unit.cs:7451)
      if (u.steps + 1 > fatigueLimit(u) * 2) return false;
    }
    if (state.orders < nextStepOrderCost(u)) return false;
    return true;
  }

  // March (Unit.cs:11018-11080): explicit activation, costs UNIT_MARCH_COST
  // training from the stockpile, no orders; unlocks force-march steps.
  function canMarch(state, u) {
    if (u.hp <= 0 || u.cooldown || u.march) return false;
    if (state.training < G.UNIT_MARCH_COST) return false;
    return true;
  }
  function doMarch(state, unitId) {
    var st = cloneState(state);
    var u = unitById(st, unitId);
    if (!canMarch(st, u)) throw new Error('cannot march');
    st.training -= G.UNIT_MARCH_COST;
    u.march = true;
    st.log.push(nameOf(u) + ' force marches (-' + G.UNIT_MARCH_COST + ' training)');
    return st;
  }

  // Swap (Unit.cs:8258): adjacent friendly units exchange tiles for 1 order;
  // both count a step; forbidden when BOTH tiles are in hostile ZOC.
  function canSwap(state, u, o) {
    if (!u || !o || u.id === o.id) return false;
    if (u.hp <= 0 || o.hp <= 0 || u.player !== o.player) return false;
    if (u.cooldown || o.cooldown) return false;
    if (hexDistance(u, o) !== 1) return false;
    if (u.steps + 1 > fatigueLimit(u) || o.steps + 1 > fatigueLimit(o)) return false;
    if (state.orders < 1) return false;
    if (inEnemyZOC(state, u, u.q, u.r) && inEnemyZOC(state, u, o.q, o.r)) return false;
    // each unit must be able to stand on the other's tile (no beached ships)
    if (moveCostInto(state, u, u, o) === Infinity || moveCostInto(state, o, o, u) === Infinity) return false;
    return true;
  }
  function doSwap(state, unitId, otherId) {
    var st = cloneState(state);
    var u = unitById(st, unitId), o = unitById(st, otherId);
    if (!canSwap(st, u, o)) throw new Error('cannot swap');
    var q = u.q, r = u.r;
    u.q = o.q; u.r = o.r;
    o.q = q; o.r = r;
    u.steps += 1; o.steps += 1;
    u.fortifyTurns = 0; o.fortifyTurns = 0;
    if (u.unlimbered) u.unlimbered = false;
    if (o.unlimbered) o.unlimbered = false;
    st.orders -= 1;
    st.log.push(nameOf(u) + ' swaps with ' + nameOf(o));
    return st;
  }

  // Anchor (Unit.cs:11126): a warship drops anchor for 1 order and projects
  // WATER CONTROL (1 tile + iWaterControlExtra, e.g. the Lading promotion),
  // letting friendly land units march across the controlled water.
  function canAnchor(state, u) {
    if (u.hp <= 0 || u.cooldown || u.anchored) return false;
    if (!info(u).bAnchor) return false;
    var t = tileAt(state, u.q, u.r);
    if (!t || !isWaterTile(t)) return false;
    if (state.orders < 1) return false;
    return true;
  }
  function doAnchor(state, unitId) {
    var st = cloneState(state);
    var u = unitById(st, unitId);
    if (!canAnchor(st, u)) throw new Error('cannot anchor');
    u.anchored = true;
    st.orders -= 1;
    st.log.push(nameOf(u) + ' drops anchor — water control established');
    return st;
  }

  // Unlimber (Unit.cs:11082): siege must set up before firing; costs 1 order.
  // Moving packs the engine back up.
  function canUnlimber(state, u) {
    if (u.hp <= 0 || u.cooldown) return false;
    if (!info(u).bUnlimber || u.unlimbered) return false;
    if (state.orders < 1) return false;
    return true;
  }
  function doUnlimber(state, unitId) {
    var st = cloneState(state);
    var u = unitById(st, unitId);
    if (!canUnlimber(st, u)) throw new Error('cannot unlimber');
    u.unlimbered = true;
    u.cooldown = 'UNLIMBERED'; // setting up ends the turn (Unit.cs:11117)
    st.orders -= 1;
    st.log.push(nameOf(u) + ' sets up — ready to fire next turn');
    return st;
  }

  // Attacking: cooldown must be NONE or ROUT (Unit.canAct bAttackOnly,
  // Unit.cs:7493); costs 1 order flat; fatigue does not apply to attacks.
  function canAttack(state, u) {
    if (u.hp <= 0) return false;
    if (u.cooldown && u.cooldown !== 'ROUT') return false;
    if (info(u).bUnlimber && !u.unlimbered) return false; // siege must set up first
    if (state.orders < 1) return false;
    return true;
  }

  // a unit that can do something this turn (for UI exhaustion display)
  function canAct(state, u) {
    return canMove(state, u) || (canAttack(state, u) && canDamage(u));
  }

  // Attackable targets from the unit's current tile.
  // ---- line of sight (Tile.isShotObstructed, Tile.cs:12384) ----------------
  // Walk the tiles between shooter and target. A height with
  // bRangedAttackBlock (mountain, volcano) blocks the shot — unless the line
  // runs along a tile edge and the OTHER tile of that pair is clear. An
  // off-board tile counts as blocking, as it does in the C#.
  function cubeRound(x, y, z) {
    var rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    var dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return { q: rx, r: rz };
  }
  function blocksShot(state, p) {
    var t = tileAt(state, p.q, p.r);
    if (!t) return true;                       // off the board blocks
    var h = DATA.height[t.height];
    return !!(h && h.bRangedAttackBlock);
  }
  function isShotObstructed(state, from, to) {
    var n = hexDistance(from, to);
    if (n < 2) return false;
    var ax = from.q, az = from.r, ay = -ax - az;
    var bx = to.q, bz = to.r, by = -bx - bz;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      var x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      // the pair straddling the line: an edge-running shot is blocked only if
      // BOTH sides block
      var p1 = cubeRound(x + 1e-6, y + 1e-6, z - 2e-6);
      var p2 = cubeRound(x - 1e-6, y - 1e-6, z + 2e-6);
      if (blocksShot(state, p1) && blocksShot(state, p2)) return true;
    }
    return false;
  }

  // Unit.canTargetTile (Unit.cs:8440): height extends a shot. Shooting DOWN
  // from a hill reaches one hex further — max(from.rangeChange -
  // to.rangeChange, 0) — unless the unit has bRangeFlat (siege), whose range
  // never changes with terrain.
  function rangeChangeOf(state, q, r) {
    var t = tileAt(state, q, r);
    if (!t) return 0;
    var h = DATA.height[t.height];
    return (h && h.iRangeChange) || 0;
  }
  // Unit.canTargetTile (Unit.cs:8487): a shot reaches
  //   range(from) + max(from.rangeChange - to.rangeChange, 0)
  // where range(from) is Unit.range (Unit.cs:6345) — base + iRangeExtra, with
  // NO terrain height in it. Height enters only through the max() term, so it
  // helps you only insofar as you out-top the target. Contrast rangeMax(tile),
  // which does fold the tile's own height in and is what the rout-advance test
  // uses below.
  // NOT MODELLED: range(from) also adds the city's rangeChange when the
  // shooter stands inside a city (Unit.cs:6367) — we have city tiles but no
  // city range property, so a bowman on a city tile is short-ranged here.
  function effectiveRange(state, u, from, to) {
    var r = rangeMax(u);
    if (info(u).bRangeFlat) return r;
    return r + Math.max(rangeChangeOf(state, from.q, from.r) - rangeChangeOf(state, to.q, to.r), 0);
  }

  // Unit.rangeMax(pFromTile) (Unit.cs:6375), used ONLY by canTargetFrom: the
  // "is anything worth advancing for" test adds the tile's own rangeChange and
  // never looks at what the target is standing on. The game really does use a
  // looser rule here than for the shot itself, so a rout can carry a unit onto
  // high ground for a shot that then turns out to be out of range.
  function targetingRangeFrom(state, u, pos) {
    var r = rangeMax(u);
    if (info(u).bRangeFlat) return r;
    return r + rangeChangeOf(state, pos.q, pos.r);
  }

  function attackTargets(state, u) {
    if (!canAttack(state, u) || !canDamage(u)) return [];
    var out = [];
    state.units.forEach(function (t) {
      if (t.hp <= 0 || t.player === u.player) return;
      var dist = hexDistance(u, t);
      if (isMelee(u)) {
        if (dist === 1) out.push(t);
      } else if (dist >= rangeMin(u) && dist <= effectiveRange(state, u, u, t) &&
                 !isShotObstructed(state, u, t)) {
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
    var dest = reach.filter(function (t) { return t.q === q && t.r === r; })[0];
    if (!dest) throw new Error('illegal move');
    // one click = the whole path; all steps charged at once (Unit.cs:8007-8044)
    u.q = q; u.r = r;
    u.steps += dest.steps;
    if (u.unlimbered) u.unlimbered = false;
    u.fortifyTurns = 0;
    s.orders -= dest.orders;
    s.log.push(nameOf(u) + ' moves (' + dest.steps + (dest.steps > 1 ? ' steps, ' : ' step, ') +
      dest.orders + (dest.orders > 1 ? ' orders' : ' order') + (dest.forced ? ', force march' : '') + ')');
    return s;
  }

  // Execute an attack action. Returns new state.
  function doAttack(state, attId, defId) {
    var s = cloneState(state);
    var att = unitById(s, attId), def = unitById(s, defId);
    if (!canAttack(s, att)) throw new Error('unit cannot attack');
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

    // push (elephants: PANIC bPush) — Unit.getPushTile (Unit.cs:10069): try the
    // tile directly behind, then the two tiles behind-and-to-the-side, then any
    // other adjacent tile away from the attacker. If NOTHING is free the unit
    // cannot escape and is DISARMED instead (PANIC_NO_ESCAPE_EFFECTUNIT).
    if (!killed && adjacent && hasEffectFlag(att, 'bPush')) {
      var pd = dirBetween(from, defTile);
      if (pd >= 0) {
        var order = [pd, wrapDir(pd, 1), wrapDir(pd, -1), wrapDir(pd, 2), wrapDir(pd, -2)];
        var moved = null;
        for (var pi = 0; pi < order.length && !moved; pi++) {
          var pt = { q: defTile.q + DIRS[order[pi]].q, r: defTile.r + DIRS[order[pi]].r };
          if (tileAt(s, pt.q, pt.r) && !unitAt(s, pt.q, pt.r) &&
              moveCostInto(s, def, defTile, pt) !== Infinity) moved = pt;
        }
        if (moved) {
          def.q = moved.q; def.r = moved.r;
          s.log.push(nameOf(def) + ' is pushed back!');
        } else {
          var noEsc = G.PANIC_NO_ESCAPE_EFFECTUNIT;
          if (noEsc && !isImmuneToEffect(def, noEsc)) {
            def.applied = (def.applied || []);
            if (def.applied.indexOf(noEsc) < 0) def.applied.push(noEsc);
            s.log.push(nameOf(def) + ' cannot escape — ' +
              prettyEffect(noEsc).toLowerCase() + '!');
          }
        }
      }
    }

    // an attack that applies an effect to what it hits (DISARM, plague):
    // effectUnit.AttackApplyEffectUnitTurns
    if (!killed) {
      effectsOf(att).forEach(function (e) {
        var d = DATA.effects[e];
        if (!d || !d.attackApply) return;
        var ap = d.attackApply.effect;
        if (isImmuneToEffect(def, ap)) return;
        def.applied = (def.applied || []);
        if (def.applied.indexOf(ap) < 0) {
          def.applied.push(ap);
          s.log.push(nameOf(def) + ' is ' + prettyEffect(ap).toLowerCase() + '!');
        }
      });
    }

    // defender loses a fortification turn when melee-attacked (Unit.cs:9643)
    if (isMelee(att) && !killed && def.fortifyTurns > 0 && adjacent) def.fortifyTurns -= 1;

    // rout / advance / cooldown (Unit.cs:9705-9734, 8342-8433).
    // ROUT (and the advance) requires a FURTHER hostile attackable from the
    // tile the unit ends on (canTargetFrom, Unit.cs:8413) — a lone kill gives
    // a plain attack cooldown and no advance.
    // rout does NOT require melee — an adjacent ranged kill (palton cavalry)
    // routs and advances too (harness-verified)
    var routEff = killed && adjacent ? routEffectVs(att, def) : null;
    var routed = false;
    if (routEff && att.hp > 0) {
      var blocked = unitAt(s, defTile.q, defTile.r);
      var canAdvance = !blocked && moveCostInto(s, att, from, defTile) !== Infinity &&
        canTargetFrom(s, att, defTile, def.id);
      if (canAdvance) {
        att.q = defTile.q; att.r = defTile.r;
        routed = true;
        s.log.push(nameOf(att) + ' routs — advances and may act again');
      } else {
        // rout WITHOUT advance only from a city tile (or onto a stacked tile,
        // which we don't model) — Unit.canRoutAfterNoAdvance, Unit.cs:8372
        var fromT = tileAt(s, from.q, from.r);
        if (fromT && fromT.city != null && canTargetFrom(s, att, from, def.id)) {
          routed = true;
          s.log.push(nameOf(att) + ' routs from the city walls — may act again');
        }
      }
    }
    if (routed) {
      att.cooldown = 'ROUT';
    } else {
      att.cooldown = 'ATTACK';
    }

    att.fortifyTurns = 0;
    s.orders -= 1; // attacks cost 1 order flat and never fatigue the unit
    return s;
  }

  function doFortify(state, unitId) {
    var s = cloneState(state);
    var u = unitById(s, unitId);
    if (!canMove(s, u) || !info(u).bFortify) throw new Error('cannot fortify');
    u.fortifyTurns = Math.min(G.MAX_FORTIFY_TURNS, (u.fortifyTurns || 0) + 1);
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

  function killsOf(state) {
    return state.units.filter(function (u) { return u.player === 1 && u.hp <= 0; }).length;
  }
  // strength-weighted destruction: the measure for maxKill objectives
  function strKilledOf(state) {
    return state.units.filter(function (u) { return u.player === 1 && u.hp <= 0; })
      .reduce(function (t, u) { return t + baseStrength(u); }, 0);
  }

  // A maxKill puzzle has no ceiling until review sets one (server/index.js:477).
  // Until then "did the player meet it?" has no answer — not "no". Anything that
  // REPORTS success or failure must ask this first; anything that merely needs a
  // boolean (win banners, solver pruning) can keep treating unmet as false.
  function objectiveScorable(objective) {
    return !(objective && objective.kind === 'maxKill' && !objective.count);
  }

  function checkObjective(state, objective) {
    switch (objective.kind) {
      case 'maxKill':
        // hidden ceiling: met when the destroyed enemy STRENGTH reaches `count`.
        // No ceiling yet => nothing to reach (see objectiveScorable).
        return objective.count ? strKilledOf(state) >= objective.count : false;
      case 'killAll':
        return state.units.filter(function (u) { return u.player === 1 && u.hp > 0; }).length === 0;
      case 'killList':
        return objective.targets.every(function (id) {
          var u = unitById(state, id);
          return !u || u.hp <= 0;
        });
      case 'capture':
        return state.units.some(function (u) {
          if (u.player !== 0 || u.hp <= 0) return false;
          var t = tileAt(state, u.q, u.r);
          return t && t.city === 1;
        });
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
      attackTargets(state, u).forEach(function (t) {
        acts.push({ type: 'attack', unit: u.id, target: t.id });
      });
      reachableTiles(state, u).forEach(function (t) {
        acts.push({ type: 'move', unit: u.id, q: t.q, r: t.r });
      });
      if (canMarch(state, u) && u.steps >= fatigueLimit(u)) acts.push({ type: 'march', unit: u.id });
      if (canUnlimber(state, u)) acts.push({ type: 'unlimber', unit: u.id });
      if (canAnchor(state, u)) acts.push({ type: 'anchor', unit: u.id });
      state.units.forEach(function (o) {
        if (o.player === 0 && o.id > u.id && canSwap(state, u, o)) acts.push({ type: 'swap', unit: u.id, target: o.id });
      });
    });
    return acts;
  }

  function applyAction(state, a) {
    if (a.type === 'attack') return doAttack(state, a.unit, a.target);
    if (a.type === 'move') return doMove(state, a.unit, a.q, a.r);
    if (a.type === 'fortify') return doFortify(state, a.unit);
    if (a.type === 'march') return doMarch(state, a.unit);
    if (a.type === 'unlimber') return doUnlimber(state, a.unit);
    if (a.type === 'anchor') return doAnchor(state, a.unit);
    if (a.type === 'swap') return doSwap(state, a.unit, a.target);
    throw new Error('unknown action ' + a.type);
  }

  // ================= Puzzle loading =================

  // puzzle = { name, orders, objective, tiles:[{q,r,terrain?,height?,veg?,improvement?,river?}...] OR radius,
  //            units:[{player,type,q,r,hp?,promotions?,fortifyTurns?,name?}] }
  // Bucketed order pool so players cannot back-calculate the hidden par
  // from what they are given.
  // A content fingerprint for a puzzle, used to tell whether a draft changed
  // between test play and submission. It must be canonical: the editor rebuilds
  // its tile map when it restores from autosave, so the same board can come
  // back with its tiles and units in a different order, and a naive
  // JSON.stringify then reports a change that never happened.
  function puzzleHash(p) {
    function tidyUnit(u) {
      return [u.player, u.type, u.q, u.r, u.hp == null ? -1 : u.hp,
        (u.promotions || []).slice().sort().join('+'), u.general ? 1 : 0,
        u.anchored ? 1 : 0, u.name || ''].join(':');
    }
    function tidyTile(t) {
      // road and owner change gameplay (road movement, iHomeModifier) — the
      // fingerprint must cover everything the editor can paint, or an author
      // can edit after test play and the changed-board check passes
      return [t.q, t.r, t.terrain || '', t.height || '', t.vegetation || '',
        t.improvement || '', (t.river || []).slice().sort().join(','),
        t.city == null ? '' : t.city, t.road ? 1 : 0,
        t.owner == null ? '' : t.owner].join(':');
    }
    var parts = [
      p.orders || 0, p.radius == null ? 3 : p.radius, p.training || 0,
      p.objective ? p.objective.kind : '',
      p.objective && p.objective.count ? p.objective.count : 0,
      (p.objective && p.objective.targets ? p.objective.targets.slice().sort() : []).join(','),
      (p.units || []).map(tidyUnit).sort().join('|'),
      (p.tiles || []).map(tidyTile).sort().join('|'),
    ].join(';');
    var h = 5381;
    for (var i = 0; i < parts.length; i++) h = ((h * 33) ^ parts.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // ---------- ability text, in the game's own words ----------
  // Old World builds unit tooltips from per-field templates (text-helptext.xml,
  // TEXT_HELPTEXT_EFFECT_UNIT_HELP_*). We use the same templates so a panel
  // reads the way the game reads, instead of paraphrasing the rules.
  var HELP_FLAG = {
    bRout: 'CAN_ROUT', bEndRout: 'END_ROUT', bPush: 'PUSH', bPushWater: 'PUSH_WATER',
    bStun: 'STUN', bImmobilize: 'IMMOBILIZE', bLastStand: 'LAST_STAND',
    bIgnoresDistance: 'IGNORES_DISTANCE', bCriticalImmune: 'CRITICAL_IMMUNE',
    bPromote: 'PROMOTE', bBuildRoad: 'BUILD_ROAD', bHarvest: 'HARVEST',
    bPillage: 'PILLAGE', bHealKill: 'HEAL_KILL', bHealNeutral: 'HEAL_NEUTRAL',
    bHealPillage: 'HEAL_PILLAGE', bSpreadReligion: 'SPREAD_RELIGION',
    bRemoveVegetation: 'REMOVE_VEGETATION', bNoRoadCooldown: 'NO_ROAD_COOLDOWN',
    bGeneralHopping: 'GENERAL_HOPPING', bEnlistNext: 'ENLIST_NEXT',
    bLaunchOffensive: 'LAUNCH_OFFENSIVE', bIgnoreZOC: null,
  };
  // Value-bearing lines are written here rather than from the game's
  // templates: those carry two placeholders and conditional branches meant for
  // the game's own formatter, and half-substituting them leaks "{v}" into the
  // panel. Flags keep the game's wording, which is the part players recognise.
  var VALUE_LABEL = {
    iDamagedUsModifier: 'while wounded', iDamagedThemModifier: 'vs wounded',
    iVsGeneralModifier: 'vs generals', iHasGeneralModifier: 'with a general',
    iFlankingAttackModifier: 'when flanking', iAdjacentSameAttackModifier: 'beside the same unit',
    iRiverAttackModifier: 'attacking across a river', iWaterLandAttackModifier: 'land/water combat',
    iHomeModifier: 'in friendly territory', iPerLevelAttackModifier: 'per unit level',
  };
  // Real mechanics that say nothing about the turn in front of you. Listing
  // them buries the line that matters.
  var OUT_OF_SCOPE = {
    iVisionExtra: 1, iRevealExtra: 1, bHarvest: 1, bPillage: 1, bHealPillage: 1,
    bSpreadReligion: 1, bTheology: 1, bBuildRoad: 1, bRemoveVegetation: 1,
    bNoRoadCooldown: 1, bPromote: 1, bMultiTeams: 1, iHealExtra: 1, iHealAlways: 1,
    bHealNeutral: 1, iPillageYieldModifier: 1, bGeneralHopping: 1, bEnlistNext: 1,
  };
  function effectName(e) {
    var n = (DATA.effectNames || {})[e];
    if (n) return n;
    return String(e).replace(/^EFFECTUNIT_/, '').toLowerCase().replace(/_/g, ' ');
  }
  function fillHelp(key, value) {
    var t = (DATA.help || {})[key];
    if (!t) return null;
    if (value == null) return t;
    var pct = (value > 0 ? '+' : '') + value + '%';
    return t.replace('{v%}', value + '%').replace('{v}', pct);
  }
  function describeEffect(e) {
    var d = DATA.effects[e];
    if (!d) return [];
    var out = [];
    Object.keys(HELP_FLAG).forEach(function (f) {
      if (!d[f] || !HELP_FLAG[f] || OUT_OF_SCOPE[f]) return;
      var line = fillHelp(HELP_FLAG[f]);
      if (line) out.push(line);
    });
    if (d.iMeleeCounter) out.push('Counterattacks in melee');
    if (d.bIgnoreZOC) out.push('Ignores zone of control');
    // An attack that leaves a mark: the game names the applied effect, so we do
    if (d.attackApply) {
      out.push('Attacks apply ' + effectName(d.attackApply.effect) +
        ' for ' + d.attackApply.turns + ' turns' +
        ((DATA.effects[d.attackApply.effect] || {}).iStrengthModifier
          ? ' (' + DATA.effects[d.attackApply.effect].iStrengthModifier + '% strength)' : ''));
    }
    // A shove with nowhere to go becomes a disarm — the rule that makes
    // penning a target in worth doing, and invisible if we never say it
    if (d.bPush && G.PANIC_NO_ESCAPE_EFFECTUNIT) {
      out.push('A target with nowhere to retreat to is ' +
        effectName(G.PANIC_NO_ESCAPE_EFFECTUNIT) + ' instead');
    }
    Object.keys(VALUE_LABEL).forEach(function (f) {
      if (!d[f] || OUT_OF_SCOPE[f]) return;
      out.push((d[f] > 0 ? '+' : '') + d[f] + '% ' + VALUE_LABEL[f]);
    });
    if (d.iStrengthModifier) out.push(((d.iStrengthModifier > 0 ? '+' : '') + d.iStrengthModifier) + '% strength');
    if (d.iAttackModifier) out.push(((d.iAttackModifier > 0 ? '+' : '') + d.iAttackModifier) + '% attack');
    if (d.iDefenseModifier) out.push(((d.iDefenseModifier > 0 ? '+' : '') + d.iDefenseModifier) + '% defense');
    (d.aeEffectUnitImmune || []).forEach(function (im) {
      out.push(im === 'EFFECTUNIT_ROUT' ? 'Cannot be routed' : 'Immune to ' + effectName(im));
    });
    // positional modifiers — dropped in the tooltip rewrite, restored:
    // Highlander/Warden read as blank cards without these
    Object.keys(d.aiHeightFromModifier || {}).forEach(function (h) {
      var v = d.aiHeightFromModifier[h];
      out.push((v > 0 ? '+' : '') + v + '% fighting on ' + h.replace('HEIGHT_', '').toLowerCase() + 's');
    });
    Object.keys(d.aiTerrainFromModifier || {}).forEach(function (t) {
      var v = d.aiTerrainFromModifier[t];
      out.push((v > 0 ? '+' : '') + v + '% fighting on ' + t.replace('TERRAIN_', '').toLowerCase() + ' ground');
    });
    Object.keys(d.aiVegetationFromModifier || {}).forEach(function (t) {
      var v = d.aiVegetationFromModifier[t];
      out.push((v > 0 ? '+' : '') + v + '% fighting in ' + t.replace('VEGETATION_', '').toLowerCase());
    });
    Object.keys(d.aiMeleeToClearTerrainTargetModifier || {}).forEach(function (t) {
      out.push((d.aiMeleeToClearTerrainTargetModifier[t] > 0 ? '+' : '') +
        d.aiMeleeToClearTerrainTargetModifier[t] + '% attacking open terrain');
    });
    Object.keys(d.aiAttackValue || {}).forEach(function (a) {
      var pct = (d.aiAttackPercent || {})[a] || 0;
      out.push(a.replace('ATTACK_', '').toLowerCase() + ' attack' + (pct ? ' at ' + pct + '%' : ''));
    });
    ['aiUnitTraitModifier', 'aiUnitTraitModifierAttack', 'aiUnitTraitModifierDefense',
     'aiUnitTraitModifierMelee'].forEach(function (f, i) {
      Object.keys(d[f] || {}).forEach(function (tr) {
        var trait = tr.replace('UNITTRAIT_', '').toLowerCase();
        var v = d[f][tr], pct = (v > 0 ? '+' : '') + v + '%';
        out.push(i === 3 ? pct + ' in melee vs ' + trait + ' units'
          : pct + ' vs ' + trait + ' units' + ['', ' attacking', ' defending'][i]);
      });
    });
    return out;
  }
  // everything a unit can do, effects and innate flags together
  function describeUnitAbilities(type) {
    var info = DATA.units[type];
    if (!info) return [];
    var seen = {}, out = [];
    (info.effects || []).forEach(function (e) {
      describeEffect(e).forEach(function (l) { if (!seen[l]) { seen[l] = 1; out.push(l); } });
    });
    if (info.bZOC) out.push('Exerts zone of control');
    if (info.bIgnoreZOC && !seen['Ignores zone of control']) out.push('Ignores zone of control');
    return out;
  }

  function poolOrders(p) {
    if (p.pool) return p.pool;
    // par+5 slack, rounded up to the next multiple of 5 so par can't be
    // back-derived from the pool (1-5 -> 10, 6-10 -> 15, 11-15 -> 20, ...).
    return Math.ceil((p.orders + 5) / 5) * 5;
  }

  // opts.play: grant the forgiving pool (par + slack orders, generous
  // training for force-march recoveries). Solver/verification loads strict.
  function loadPuzzle(p, opts) {
    var tiles = {};
    if (p.radius != null) {
      for (var q = -p.radius; q <= p.radius; q++)
        for (var r = Math.max(-p.radius, -q - p.radius); r <= Math.min(p.radius, -q + p.radius); r++)
          tiles[key(q, r)] = { q: q, r: r, terrain: 'TERRAIN_TEMPERATE', height: 'HEIGHT_FLAT', vegetation: null, improvement: null, river: [], road: false, owner: null, city: null };
    }
    var RAISED = { HEIGHT_HILL: 1, HEIGHT_MOUNTAIN: 1, HEIGHT_VOLCANO: 1 };
    (p.tiles || []).forEach(function (t) {
      // water is never raised — a tile cannot be both a mountain and the sea
      if (t.terrain === 'TERRAIN_WATER' && RAISED[t.height]) t.height = 'HEIGHT_FLAT';
      var base = tiles[key(t.q, t.r)] || { q: t.q, r: t.r, terrain: 'TERRAIN_TEMPERATE', height: 'HEIGHT_FLAT', vegetation: null, improvement: null, river: [], road: false, owner: null };
      Object.keys(t).forEach(function (k2) { base[k2] = t[k2]; });
      tiles[key(t.q, t.r)] = base;
    });
    // Terrain (and improvements) flagged bRoadFree come with a road already
    // laid: Tile.setTerrain calls setRoad(true) for them (Tile.cs:3432), and
    // likewise setImprovement (Tile.cs:6364). Urban is the one that matters —
    // a city street is a road, so moving along it costs road movement.
    Object.keys(tiles).forEach(function (k2) {
      var t2 = tiles[k2];
      var ter = DATA.terrain[t2.terrain], imp = t2.improvement && DATA.improvements[t2.improvement];
      if ((ter && ter.bRoadFree) || (imp && imp.bRoadFree) || t2.city != null) t2.road = true;
    });
    // A unit counts as a general if the puzzle says so, or if it carries a
    // leader effect — in the game those effects exist only BECAUSE a general
    // is attached (Unit.cs:2274 hasGeneral, and the vs-general bonus at
    // Unit.cs:8833 gates on it). Deriving it here keeps the two ways an author
    // can express "this is the general" from disagreeing: king-of-the-hill
    // marked its general with EFFECTUNIT_COMMANDER_LEADER alone, so the two
    // Hecklers aimed at it silently did nothing.
    function hasGeneral(u) {
      return !!u.general || (u.promotions || []).some(function (pr) { return /_LEADER$/.test(pr); });
    }
    var units = p.units.map(function (u, i) {
      return {
        id: i, player: u.player, type: u.type, q: u.q, r: u.r,
        hp: u.hp != null ? u.hp : DATA.units[u.type].iHPMax,
        promotions: u.promotions || [], fortifyTurns: u.fortifyTurns || 0,
        cooldown: null, steps: 0, general: hasGeneral(u), name: u.name || null,
        march: false, unlimbered: DATA.units[u.type].bUnlimber ? !!u.unlimbered : undefined,
        anchored: DATA.units[u.type].bAnchor ? !!u.anchored : undefined,
      };
    });
    // A killList/killTarget id that resolves to nothing would count as
    // already dead (auto-win) — reject the puzzle instead of playing it.
    var obj = p.objective || {};
    function checkTarget(id) {
      var u = units.filter(function (x) { return x.id === id; })[0];
      if (!u || u.player !== 1) throw new Error('objective target ' + id + ' is not an enemy unit');
    }
    if (obj.kind === 'killList') (obj.targets || []).forEach(checkTarget);
    if (obj.kind === 'killTarget') checkTarget(obj.target);
    var play = opts && opts.play;
    var orders = play ? poolOrders(p) : p.orders;
    // play grants 300 training unless the author explicitly set a budget
    var training = play ? (p.training != null ? p.training : 300) : (p.training || 0);
    return { tiles: tiles, units: units, orders: orders, training: training,
      par: p.orders, objective: p.objective, log: [] };
  }

  var api = {
    DATA: DATA, DIRS: DIRS, key: key, hexDistance: hexDistance, dirBetween: dirBetween,
    modify: modify, tileAt: tileAt, unitAt: unitAt, unitById: unitById,
    effectsOf: effectsOf, isMelee: isMelee, rangeMax: rangeMax, hpMax: hpMax,
    canAct: canAct, canMove: canMove, canAttack: canAttack,
    canMarch: canMarch, doMarch: doMarch, canUnlimber: canUnlimber, doUnlimber: doUnlimber,
    canSwap: canSwap, doSwap: doSwap,
    canAnchor: canAnchor, doAnchor: doAnchor, waterControlled: waterControlled,
    poolOrders: poolOrders,
    puzzleHash: puzzleHash, effectName: effectName,
    describeEffect: describeEffect, describeUnitAbilities: describeUnitAbilities, killsOf: killsOf, strKilledOf: strKilledOf,
    nextStepOrderCost: nextStepOrderCost,
    canDamage: canDamage, fatigueLimit: fatigueLimit,
    movementPoints: movementPoints, reachableTiles: reachableTiles,
    attackTargets: attackTargets, isShotObstructed: isShotObstructed,
    effectiveRange: effectiveRange, attackStrength: attackStrength,
    defendStrength: defendStrength, attackUnitDamage: attackUnitDamage,
    counterAttackDamage: counterAttackDamage, previewAttack: previewAttack,
    explainAttack: explainAttack,
    doMove: doMove, doAttack: doAttack, doFortify: doFortify,
    legalActions: legalActions, applyAction: applyAction,
    checkObjective: checkObjective, objectiveScorable: objectiveScorable,
    loadPuzzle: loadPuzzle, cloneState: cloneState,
    nameOf: nameOf,
  };

  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.OWENGINE = api;
})();
