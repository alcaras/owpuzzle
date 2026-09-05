// Old World single-turn combat engine — a faithful JS port of the combat core
// from the game's Reference C# source (Unit.cs / InfoHelpers.cs / Tile.cs).
// Deterministic subset: no events, no cities, and no critical-hit ROLL — a
// unit may carry a known, pre-rolled crit (`crit: true`, the game's
// CRITICAL_HIT_PREVIEW flag) that its next attack spends. Data comes from
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
  //             cooldown:null|'ATTACK'|'ROUT'|'ATTACKED'|'STUNNED'|'UNLIMBERED',steps,name} ],
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

  // A tile can hold more than one unit — see canBothOccupy. unitAt returns
  // the first, which is the wrong answer for any question about what is
  // standing somewhere ("is a flank partner there", "does that tile project
  // ZOC"); those must ask unitsAt.
  function unitsAt(state, q, r) {
    var out = [];
    for (var i = 0; i < state.units.length; i++) {
      var u = state.units[i];
      if (u.hp > 0 && u.q === q && u.r === r) out.push(u);
    }
    return out;
  }

  // Tile.canBothUnitsOccupy (Tile.cs:10428-10477). Hostiles never share a
  // tile. Allies share when either is a caravan (InfoHelpers.canStack,
  // :2465), when exactly one of them can DAMAGE — canDamage = bMelee ||
  // iRangeMax > 0 (InfoHelpers.cs:741-744), which is what lets a horseman
  // stand on its own scout — or when only one of them can defend on that
  // tile (a water unit on land, Tile.canUnitDefend:10420).
  function canBothOccupy(state, u, o) {
    if (u.id === o.id) return true;
    if (u.player !== o.player) return false;
    if (info(u).bCaravan || info(o).bCaravan) return true;
    if (canDamage(u) !== canDamage(o)) return true;
    var t = tileAt(state, o.q, o.r);
    if (t && canDefendOn(u, t) !== canDefendOn(o, t)) return true;
    return false;
  }
  function canDefendOn(u, t) { return !(info(u).bWater && !isWaterTile(t)); }
  // may this unit END its move here — every occupant must be shareable
  // (the game tests each unit on the tile in turn, Tile.cs:10510-10535)
  function canEndOn(state, u, q, r) {
    var all = unitsAt(state, q, r);
    for (var i = 0; i < all.length; i++) if (!canBothOccupy(state, u, all[i])) return false;
    return true;
  }

  function unitById(state, id) {
    for (var i = 0; i < state.units.length; i++)
      if (state.units[i].id === id) return state.units[i];
    return null;
  }

  function info(u) { return DATA.units[u.type]; }

  // The effects a trait lends only when the general aboard is the RULER
  // (trait.xml LeaderEffectUnit; Character.cs:10608-10616). A unit holding
  // one of these is ruler-led, and a ruler-led unit also carries
  // LEADER_GENERAL_EFFECTUNIT (+1 movement, immune to PANIC/DISARMED/GRAPPLER/
  // TACTICIAN_LEADER — Character.cs:6508). Attached here so a board that says
  // EFFECTUNIT_COMMANDER_LEADER gets the immunities the game would give.
  var RULER_EFFECTS = {};
  Object.keys(DATA.characterTraits || {}).forEach(function (t) {
    var l = DATA.characterTraits[t].leader;
    if (l) RULER_EFFECTS[l] = true;
  });
  var LEADER_GENERAL = DATA.globals.LEADER_GENERAL_EFFECTUNIT;

  // All effect units on a unit: innate (traits + aeEffectUnit) + promotions.
  function effectsOf(u) {
    var effs = (info(u).effects || []).slice();
    (u.applied || []).forEach(function (e) { effs.push(e); });   // disarmed etc.
    var rulerLed = false;
    (u.promotions || []).forEach(function (p) {
      var pr = DATA.promotions[p];
      var e = pr && pr.effect ? pr.effect : DATA.effects[p] ? p : null; // raw effect names allowed in puzzles
      if (!e) return;
      effs.push(e);
      if (RULER_EFFECTS[e]) rulerLed = true;
    });
    if (rulerLed && LEADER_GENERAL && DATA.effects[LEADER_GENERAL] && effs.indexOf(LEADER_GENERAL) < 0) effs.push(LEADER_GENERAL);
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

  // Hidden from EVERYONE (Unit.isHiddenTileFrom with TeamType.NONE,
  // Unit.cs:3491): a stealth carrier — a scout in trees or jungle
  // (EFFECTUNIT_STEALTH, effectUnit.xml:1064-1077; the pairs resolve through
  // terrainTarget.xml to vegetation), or a ranged unit under a Tactician
  // leader (EFFECTUNIT_TACTICIAN_RANGED) — standing on hiding vegetation in
  // neutral-or-friendly territory (Unit.cs:3535-3541), not revealed by a
  // visible cooldown (hasVisibleAttackCooldown, Unit.cs:3941: attacking,
  // routing, being stunned all show the unit; setting up siege does not).
  // The fog-of-war half of hiding is out of scope — the whole board is
  // visible in a puzzle — so this is consulted only where the GAME resolves
  // hidden-ness without a viewer: push destinations (Unit.getPushTile tests
  // candidates with TeamType.NONE, Unit.cs:10082) and the ambush attack
  // bonus (Unit.cs:8843, where hostile teams reduce to the same check).
  function isHiddenAt(state, u, t) {
    if (!t || !t.vegetation) return false;
    if (u.cooldown && u.cooldown !== 'UNLIMBERED') return false;
    if (t.owner != null && t.owner !== u.player) return false;
    return effectsOf(u).some(function (e) {
      var d = DATA.effects[e];
      return d && d.hideVegetation && d.hideVegetation.indexOf(t.vegetation) >= 0;
    });
  }

  // Unit.bounce (Unit.cs:8181): relocate a unit whose tile was taken. The
  // game first looks ONLY at adjacent tiles that keep the unit hidden
  // (pRequiresHidden caps that pass at range 1, Game.cs:10317), then takes
  // the nearest tile it can stand on, ring by ring (Game.findUnitTileNearby,
  // Game.cs:10208), preferring tiles not adjacent to a hostile unit (the
  // comparator, Game.cs:10261 — its other tie-breaks, land section /
  // territory / path-to-city, collapse on a puzzle board; remaining ties
  // fall to a fixed (r,q) scan). With nowhere at all to stand the unit dies
  // (Unit.cs:8195-8198) — unreachable off a push, whose freshly vacated tile
  // is always adjacent and standable.
  function bounceUnit(s, u) {
    var home = { q: u.q, r: u.r };
    function standable(t) {
      if (!t || !canEndOn(s, u, t.q, t.r)) return false;
      if (info(u).bWater) return isWaterTile(t);
      if (isWaterTile(t)) return false; // never END afloat (Tile.cs:10598)
      return t.height !== 'HEIGHT_MOUNTAIN' && t.height !== 'HEIGHT_VOLCANO';
    }
    function nextToHostile(t) {
      return s.units.some(function (o) {
        return o.hp > 0 && o.player !== u.player && hexDistance(o, t) === 1;
      });
    }
    var cands = [];
    Object.keys(s.tiles).forEach(function (k) {
      var t = s.tiles[k];
      var dist = hexDistance(t, home);
      if (dist >= 1 && standable(t)) cands.push({ t: t, dist: dist });
    });
    cands.sort(function (a, b) {
      return (a.dist - b.dist) ||
        (nextToHostile(a.t) - nextToHostile(b.t)) ||
        (a.t.r - b.t.r) || (a.t.q - b.t.q);
    });
    var best = null;
    for (var i = 0; i < cands.length && !best; i++)
      if (cands[i].dist === 1 && isHiddenAt(s, u, cands[i].t)) best = cands[i].t;
    if (!best && cands.length) best = cands[0].t;
    if (best) {
      u.q = best.q; u.r = best.r;
      s.log.push(nameOf(u) + ' is bounced aside');
    } else {
      u.hp = 0; // Unit.bounce kills when there is nowhere to go (Unit.cs:8198)
      s.log.push(nameOf(u) + ' has nowhere to go and is lost');
    }
  }

  // Unit.hasPush (Unit.cs:10046-10068): the attacker has a bPush effect, the
  // defender stands on land that is not a settlement, and the defender is not
  // immune to that effect. (Tribe settlements and ruins are not modelled; a
  // city is the settlement a puzzle can have.)
  function hasPush(state, att, def) {
    var t = tileAt(state, def.q, def.r);
    if (!t || t.city != null) return false;
    if (isWaterTile(t)) return false;   // bPushWater (fireships) is a known gap
    var effs = effectsOf(att);
    for (var i = 0; i < effs.length; i++) {
      var d = DATA.effects[effs[i]];
      if (d && d.bPush && !isImmuneToEffect(def, effs[i])) return true;
    }
    return false;
  }

  // Unit.hasStun (Unit.cs:7069): a bStun effect (EFFECTUNIT_TACTICIAN_LEADER —
  // a Tactician ruler aboard) stuns what it hits at any range, unless the
  // target stands in a city with walls up (isVulnerable = city hp 0; we have
  // no city hp, so a city always protects), the attacker's element differs
  // from the target tile's, or the target is immune (another ruler's unit).
  function hasStun(state, att, def) {
    var t = tileAt(state, def.q, def.r);
    if (!t || t.city != null) return false;
    if (!!info(att).bWater !== isWaterTile(t)) return false;
    var effs = effectsOf(att);
    for (var i = 0; i < effs.length; i++) {
      var d = DATA.effects[effs[i]];
      if (d && d.bStun && !isImmuneToEffect(def, effs[i])) return true;
    }
    return false;
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
  // Unit.getFatigueLimit (Unit.cs:2686-2708): the unit's iFatigue, floored at
  // UNIT_MIN_BASE_FATIGUE (2) for every unit that is not a tribe's — the 1 on
  // mercenary and tribal types (peltast, marauder, skirmisher, huscarl, the
  // nomad line) is a tribal number; in a player's hands they get two steps,
  // four under FORCEMARCH_DOUBLE_FATIGUE. Tribes add tribeLevel.miFatigue
  // instead, which no board here carries.
  function fatigueLimit(u) {
    var base = info(u).iFatigue || G.UNIT_FATIGUE_LIMIT;
    return Math.max(G.UNIT_MIN_BASE_FATIGUE || 0, base) + sumEffect(u, 'iFatigueExtra');
  }
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
    // a defender standing in a city with its walls up cannot be flanked
    // (Tile.cs:12043; isVulnerable = city hp 0, and we have no city hp, so a
    // city always protects — the same convention as hasStun)
    var dt = tileAt(state, toTile.q, toTile.r);
    if (dt && dt.city != null) return false;
    return unitsAt(state, opp.q, opp.r).some(function (o) {
      return o.player === att.player && o.id !== att.id && canDamage(o);
    });
  }

  function canDamage(u) { return !!info(u).bMelee || (info(u).iRangeMax || 0) > 0; }

  function adjacentFriendSame(state, u, t) {
    // friendly unit sharing a trait-class adjacent (used by shield-wall style effects)
    for (var d = 0; d < 6; d++) {
      var here = unitsAt(state, t.q + DIRS[d].q, t.r + DIRS[d].r);
      for (var i = 0; i < here.length; i++) {
        var o = here[i];
        if (o.player === u.player && o.id !== u.id && o.type === u.type) return true;
      }
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
      // ambush: attacking from a tile where the unit is hidden from the
      // defender's team (Unit.cs:8843 — for hostile sides this reduces to
      // the same anonymous check the push uses)
      if (isHiddenAt(state, att, from)) add('attacking from hiding', G.HIDDEN_ATTACK_MODIFIER);

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
      damage: pv.damage, counter: pv.counter, kills: pv.kills, rout: pv.rout, crit: pv.crit,
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

  // A loaded critical hit doubles the blow (Unit.cs:9135) unless the target
  // is critical-immune (Unit.criticalChanceVs, Unit.cs:6566). It is rolled
  // by the game, not here: with CRITICAL_HIT_PREVIEW on, the roll is made
  // ahead of time and stored on the unit (Unit.resetCriticalHit,
  // Unit.cs:3404-3420), so a puzzle or a save can state it as a fact.
  function critApplies(att, def) {
    return !!att.crit && !hasEffectFlag(def, 'bCriticalImmune');
  }

  // Unit.attackUnitDamage (Unit.cs:9124). The crit applies to the tile the
  // attack targets only: collateral tiles are attacked with bTargetTile
  // false, which never rolls one (Unit.attackTile, Unit.cs:10418) — pass
  // opts.collateral for those.
  function attackUnitDamage(state, att, fromTile, def, percent, opts) {
    percent = percent == null ? 100 : percent;
    var toTile = { q: def.q, r: def.r };
    if (percent === 0) return def.hp > 1 ? 1 : 0;
    var dmg = getAttackDamage(
      attackStrength(state, att, fromTile, toTile, def),
      defendStrength(state, def, toTile, att), percent);
    if (!(opts && (opts.collateral || opts.noCrit)) && critApplies(att, def)) dmg *= 2; // Unit.cs:9135
    if (hasEffectFlag(def, 'bLastStand') && def.hp > 1 && dmg >= def.hp) dmg = def.hp - 1;
    return Math.min(dmg, def.hp);
  }

  // Unit.getCounterAttackDamage (Unit.cs:10526)
  // Unit.getCounterAttackDamage (Unit.cs:10570-10615), computed for the
  // ATTACKER: what this blow costs the unit throwing it. Two things are easy
  // to get wrong and both were:
  //
  //  - the two refusals below are `return 0` in the game, not "skip the
  //    counter". The rout surcharge sits AFTER them, so a defender that
  //    cannot counter at all — flanked, stunned, a scout, an onager with
  //    someone on top of it — costs a routing attacker NOTHING. We used to
  //    fall through and still charge the 1.
  //  - the payload comes off the DEFENDER's effects (iMeleeCounter, carried
  //    only by EFFECTUNIT_MELEE and EFFECTUNIT_SHIP), so a ranged defender
  //    that CAN counter still deals 0 — but it does open the rout surcharge.
  //
  // (The canDamageCity branch, COUNTER_CITY_DAMAGE, is unreachable here: a
  // puzzle attack always names a unit.)
  function counterAttackDamage(state, att, fromTile, def) {
    if (!isMelee(att)) return 0;
    if (att.hp === 0) return 0;
    var val = 0;
    if (def) {
      // cross-domain: the test is on the UNITS (a ship v a land unit),
      // not on the tiles they stand on (Unit.cs:10590)
      if (!!info(def).bWater !== !!info(att).bWater) return 0;
      if (!canCounterattack(state, def, att, fromTile)) return 0;
      // Unit.cs:10598 getCounterPercentOfAttack: max fortify counters with
      // FULL attack damage; otherwise per-effect percent (Tactician = 100),
      // clamped to 0..100 (Unit.cs:7166). The counter never crits
      // (Unit.cs:10601 passes bCritical false).
      var pct = ((def.fortifyTurns || 0) >= G.MAX_FORTIFY_TURNS) ? 100
              : Math.max(0, Math.min(100, sumEffect(def, 'iMeleeCounterPercent')));
      if (pct > 0) {
        val += Math.floor(attackUnitDamage(state, def, { q: def.q, r: def.r }, att, 100,
                                           { noCrit: true }) * pct / 100);
      } else {
        val += counterAttackMelee(def);
      }
    }
    if (att.cooldown === 'ROUT') val += G.COUNTER_ROUT_DAMAGE;
    return Math.min(val, att.hp - 1);
  }

  // Unit.canCounterattack (Unit.cs:10616-10645), asked of the DEFENDER
  function canCounterattack(state, def, att, attTile) {
    if (!canDamage(def)) return false;
    // siege counters only while it is SET UP (Unit.cs:10621-10629) — a shove
    // takes the set-up away, so a shoved onager stops answering back
    if (info(def).bUnlimber && !def.unlimbered) return false;
    if (def.cooldown === 'STUNNED') return false;
    // and it has to be able to reach the attacker's tile at all: melee is
    // adjacency, ranged is iRangeMin..range with the shot unobstructed
    // (canTargetTile, Unit.cs:8449-8500). This is what stops an onager
    // countering the unit standing on top of it.
    var d = hexDistance(def, attTile);
    if (isMelee(def)) {
      if (d !== 1) return false;
    } else if (d < rangeMin(def) || d > effectiveRange(state, def, def, attTile) ||
               isShotObstructed(state, def, attTile)) {
      return false;
    }
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
      // Land units may enter water under friendly WATER CONTROL, and it is
      // FAST: getMovementCost (Unit.cs:7583) returns movement() — the RAW
      // movement value, 1 to 3 — where a land tile costs its terrain's
      // iMovementCost, which is 9. movementFull() (Unit.cs:6341) is the
      // 9x-scaled figure and a different method; charging that made water nine
      // times dearer than the game does, so a unit could barely get afloat.
      if (!waterControlled(state, to, u.player)) return Infinity;
      return Math.max(1, info(u).iMovement + sumEffect(u, 'iMovementExtra'));
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
  // Tile.isWaterMovement (Tile.cs:8073-8113): a team may cross a water tile if
  // it holds WATER CONTROL there, or if the tile is owned by that team or an
  // ally. Both halves were wrong here:
  //   * the control radius was hardcoded to 1. The game reads it off the unit
  //     (Unit.waterControl, Unit.cs:3480: info().miWaterControl plus
  //     iWaterControlExtra from effects such as Lading) — a bireme projects 3,
  //     a trireme 4, a dromon 5. iWaterControl was not even extracted.
  // Anchoring is required: the tile's control counter is incremented and
  // decremented exactly on the anchored transition (Unit.setAnchoredTurns,
  // Unit.cs:3125-3160) and the range check reads isAnchored (Tile.cs:3404).
  //   * territory was never consulted at all, only adjacent friendly cities,
  //     which is a much smaller thing than owning the water.
  // The water an anchored ship controls (Unit.updateWaterControlTiles,
  // Unit.cs:4003):
  //   pFromTile.getContiguous(tile => tile.isWater() && distance <= waterControl())
  // so it is WATER only, and only water CONNECTED to the ship's own tile — a
  // circle of the right radius is not the same shape, and counted water across
  // a spit of land that the game never gives you.
  function waterControlTiles(state, ship) {
    var out = {};
    // hp == null means "full" on an editor board, and null <= 0 is true in JS,
    // which silently emptied the controlled area for every unplayed unit
    if ((ship.hp != null && ship.hp <= 0) || !info(ship).bWater || !ship.anchored) return out;
    var radius = (info(ship).iWaterControl || 0) + sumEffect(ship, 'iWaterControlExtra');
    if (radius <= 0) return out;
    var start = tileAt(state, ship.q, ship.r);
    if (!start || !isWaterTile(start)) return out;
    var stack = [start], seen = {};
    seen[key(start.q, start.r)] = true;
    while (stack.length) {
      var t = stack.pop();
      out[key(t.q, t.r)] = true;
      for (var d = 0; d < 6; d++) {
        var n = tileAt(state, t.q + DIRS[d].q, t.r + DIRS[d].r);
        if (!n) continue;
        var nk = key(n.q, n.r);
        if (seen[nk] || !isWaterTile(n) || hexDistance(ship, n) > radius) continue;
        seen[nk] = true;
        stack.push(n);
      }
    }
    return out;
  }

  // The union of a player's controlled water, memoised per state: the flood
  // fill above ran once per ship per QUERY, and the blow table / Dijkstra
  // ask this thousands of times per state — 90% of a water board's planning
  // time. The memo is keyed on the state object (clones start empty) and
  // guarded by a signature of the ships that could change the answer, so a
  // state mutated in place (a ship moved, anchored, sunk) is recomputed
  // rather than served stale.
  var WATER_MEMO = typeof WeakMap === 'function' ? new WeakMap() : null;
  function waterControlSig(state, player) {
    var sig = '';
    for (var i = 0; i < state.units.length; i++) {
      var o = state.units[i];
      if (o.player !== player || !info(o).bWater) continue;
      sig += o.id + ':' + o.q + ',' + o.r + ':' + (o.hp > 0 ? 1 : 0) + (o.anchored ? 'a' : '') + ';';
    }
    return sig;
  }
  function controlledWaterOf(state, player) {
    var memo = WATER_MEMO && WATER_MEMO.get(state);
    var sig = waterControlSig(state, player);
    if (memo && memo[player] && memo[player].sig === sig) return memo[player].set;
    var set = {};
    for (var i = 0; i < state.units.length; i++) {
      var o = state.units[i];
      if (o.hp <= 0 || o.player !== player) continue;
      var tiles = waterControlTiles(state, o);
      for (var k in tiles) set[k] = true;
    }
    if (WATER_MEMO) {
      if (!memo) { memo = {}; WATER_MEMO.set(state, memo); }
      memo[player] = { sig: sig, set: set };
    }
    return set;
  }

  function waterControlled(state, pos, player) {
    if (controlledWaterOf(state, player)[key(pos.q, pos.r)]) return true;
    var here = tileAt(state, pos.q, pos.r);
    // owned water is your own water (Tile.cs:8103). A friendly city owns its
    // harbour, so the old adjacent-city rule is subsumed by this — but keep it
    // for boards that mark a city without painting ownership.
    if (here && here.owner === player) return true;
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
      var occs = unitsAt(state, q + DIRS[d].q, r + DIRS[d].r);
      for (var oi = 0; oi < occs.length; oi++) {
        var o = occs[oi];
        if (o.player === u.player) continue;
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
    return moveSearch(state, u).list;
  }

  // The route the search actually took to each tile, so the board can DRAW the
  // crossing. Returns [{q,r}...] from the unit's tile to the destination, or []
  // if it cannot get there. Water tiles appear in the middle of a path and
  // never at its end (Tile.cs:10577-10605), which is exactly what makes a
  // crossing worth showing: you go over and out the other side.
  function movePath(state, u, q, r) {
    var s = moveSearch(state, u);
    var k = key(q, r), out = [];
    if (!s.out[k]) return [];
    var guard = 0;
    while (k && guard++ < 999) {
      var qr = k.split(',');
      out.unshift({ q: +qr[0], r: +qr[1] });
      if (k === key(u.q, u.r)) break;
      k = s.prev[k];
    }
    return out;
  }

  function moveSearch(state, u) {
    if (u.hp <= 0 || u.cooldown) return { list: [], out: {}, prev: {} };
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
    if (!stepsAvail) return { list: [], out: {}, prev: {} };
    var budget = stepsAvail * full;

    var best = {}; best[key(u.q, u.r)] = 0;
    var prev = {};
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
        // A hostile unit blocks the tile outright — but only if it BLOCKS:
        // mbBlocks is the gate (canUnitOccupy, Tile.cs:10516) and the
        // scout, the workers, the settlers and the caravan do not have it,
        // so you walk straight through an enemy scout. Friendly units are
        // never a wall; whether you may STOP on one is canEndOn's question.
        if (unitsAt(state, nq, nr).some(function (o) {
          return o.player !== u.player && info(o).bBlocks;
        })) continue;
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
        prev[k] = key(cur.q, cur.r);
        // A land unit may move ACROSS controlled water but may not END its move
        // on it: Tile.canUnitTypeOccupy checks the water rules only when
        // bFinalTile (Tile.cs:10577-10605). So water stays on the frontier — you
        // path through it — but never becomes a destination. (bTerritoryWater is
        // the one exception and only UNIT_WORKER has it.) Crossing to the far
        // bank is the whole point of water control.
        var endsOnWater = !info(u).bWater && isWaterTile(t);
        if (!endsOnWater && canEndOn(state, u, nq, nr)) {
          var st = Math.ceil(c / full);
          out[k] = { q: nq, r: nr, cost: c, steps: st, orders: ordersForSteps(st),
                     forced: u.steps + st > limit };
        }
        frontier.push({ q: nq, r: nr, cost: c });
      }
    }
    return {
      list: Object.keys(out).map(function (k2) { return out[k2]; }),
      out: out, prev: prev,
    };
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
    u.crit = false; // any cooldown but rout drops a loaded crit (Unit.doCooldown, Unit.cs:2830-2836)
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
    // A land unit afloat is crossing, not fighting: it cannot attack from a
    // water tile. Reported by zophister — a ballista could march onto owned
    // water and shoot from there, which the game does not allow. (The nearest
    // guard in the C#, Unit.canTargetTile at Unit.cs:8449, bars tribe units
    // only; this rule is the game's behaviour, confirmed by the owner.)
    if (!info(u).bWater) {
      var here = tileAt(state, u.q, u.r);
      if (here && isWaterTile(here)) return false;
    }
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
    return { damage: dmg, counter: counter, kills: kills, rout: !!routEff, crit: critApplies(att, def),
      collateral: collateralPreview(state, att, def) };
  }

  function collateralPreview(state, att, def) {
    var out = [];
    forEachCollateral(state, att, def, function (victim, pct) {
      out.push({ id: victim.id, damage: attackUnitDamage(state, att, { q: att.q, r: att.r }, victim, pct, { collateral: true }) });
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
      unitsAt(state, pos.q, pos.r).forEach(function (v) {
        if (v.player !== att.player) fn(v, pct);
      });
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

    // counter computed BEFORE damage (Unit.cs:9613), applied after — so it
    // lands even when the blow kills, and a dying defender still answers
    var counter = counterAttackDamage(s, att, from, def);
    var crit = critApplies(att, def);
    var dmg = attackUnitDamage(s, att, from, def, 100);
    def.hp -= dmg;
    var killed = def.hp <= 0;
    var msg = nameOf(att) + ' hits ' + nameOf(def) + ' for ' + dmg + (crit ? ' (critical hit)' : '');
    // the attack spends the crit whether or not the target could take one
    // (Unit.attackTile, Unit.cs:10422-10423: read, then reset)
    att.crit = false;

    // collateral attacks (pierce/cleave/circle/splash)
    forEachCollateral(s, att, def, function (victim, pct) {
      var cd = attackUnitDamage(s, att, from, victim, pct, { collateral: true });
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
    // Whether the shove happens at all is Unit.hasPush (Unit.cs:10046): not on
    // a settlement tile, only a bPush effect against a LAND tile (bPushWater
    // is the fireship's, a known gap), and only if the defender is not immune
    // to that effect — a ruler-led unit carries EFFECTUNIT_LEADER_GENERAL,
    // which is immune to PANIC. Then neither the shove nor the no-escape
    // disarm happens; the elephant just hits.
    if (!killed && adjacent && hasPush(s, att, def)) {
      var pd = dirBetween(from, defTile);
      if (pd >= 0) {
        var order = [pd, wrapDir(pd, 1), wrapDir(pd, -1), wrapDir(pd, 2), wrapDir(pd, -2)];
        var moved = null;
        for (var pi = 0; pi < order.length && !moved; pi++) {
          var pt = { q: defTile.q + DIRS[order[pi]].q, r: defTile.r + DIRS[order[pi]].r };
          var ptT = tileAt(s, pt.q, pt.r);
          if (!ptT) continue;
          // candidates are tested with canUnitOccupy(TeamType.NONE, ...)
          // (Unit.cs:10082), which does not see hidden units (Tile.cs:10514)
          // — a scout in trees does not block the shove
          // an occupant blocks the shove only if the test can SEE it and it
          // cannot share the tile with the shoved unit — its own scout can
          if (unitsAt(s, pt.q, pt.r).some(function (o) {
            return !isHiddenAt(s, o, ptT) && !canBothOccupy(s, def, o);
          })) continue;
          // the shove is a FINAL move: a land unit may cross friendly water
          // but never end on it (canUnitTypeOccupy bFinalTile,
          // Tile.cs:10598-10603) — moveCostInto alone would allow it
          if (!info(def).bWater && isWaterTile(ptT)) continue;
          if (moveCostInto(s, def, defTile, pt) !== Infinity) moved = pt;
        }
        if (moved) {
          var shouldered = unitsAt(s, moved.q, moved.r).filter(function (o) {
            return !canBothOccupy(s, def, o);
          });
          def.q = moved.q; def.r = moved.r;
          // a shoved siege unit loses its set-up: the UNLIMBERED cooldown is
          // replaced by ATTACKED (Unit.cs:9690-9693)
          if (def.unlimbered) def.unlimbered = false;
          s.log.push(nameOf(def) + ' is pushed back!');
          // arriving on a hidden unit's tile shoulders it aside: setTileID
          // bounces whatever cannot share the tile (Unit.cs:1918-1921)
          shouldered.forEach(function (o) { bounceUnit(s, o); });
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

    // stun (Unit.cs:9660-9665): the survivor gets STUNNED_COOLDOWN, and a
    // stunned unit cannot counterattack (canCounterattack, Unit.cs:10634) —
    // everyone who hits it next this turn hits it for free
    if (!killed && hasStun(s, att, def)) {
      def.cooldown = 'STUNNED';
      s.log.push(nameOf(def) + ' is stunned!');
    }

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
    u.crit = false; // Unit.doCooldown, Unit.cs:2830-2836
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
    ];
    // A hand-set order pool changes the fight as surely as par does. The term
    // is only PUSHED when there is one, so every board on the default rule
    // keeps the fingerprint it has always had — an unconditional term (even
    // the empty string, which still adds its separator) would re-hash the
    // whole library and retire every row, with every solve on it.
    if (p.pool) parts.push('pool' + p.pool);
    parts = parts.join(';');
    var h = 5381;
    for (var i = 0; i < parts.length; i++) h = ((h * 33) ^ parts.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // Which of two recordings of the SAME board is the better reference line?
  // (Callers must check puzzleHash first — comparing across boards is
  // meaningless.) An author test-plays a puzzle many times while polishing
  // it, and the LAST run is not the best one: on 2026-09-04 Sion submitted a
  // 22-order reference line for a board he had already solved in 19, because
  // the server kept whichever recording arrived most recently. The review
  // queue then shows the worse line, and a reviewer sizing up the par from it
  // is reading the wrong number.
  //
  // Ordering, by objective:
  //   maxKill — more strength first (that IS the objective), then fewer orders
  //   everything else — meeting the objective first, then fewer orders, then
  //   more strength as a tie-break
  // `met` is null on a maxKill draft (no ceiling exists until review) and on
  // recordings made before it was stored, so only an explicit false counts
  // against a line — the same test the editor's submit warning uses.
  function betterRecording(a, b) {
    if (!b || !Array.isArray(b.line) || !b.line.length) return a;
    if (!a || !Array.isArray(a.line) || !a.line.length) return b;
    var kind = (a.puzzle && a.puzzle.objective && a.puzzle.objective.kind) || '';
    var ord = function (r) { return r.orders || 0; };
    var str = function (r) { return r.strength || 0; };
    if (kind === 'maxKill') {
      if (str(a) !== str(b)) return str(a) > str(b) ? a : b;
      return ord(a) <= ord(b) ? a : b;
    }
    var am = a.met !== false, bm = b.met !== false;
    if (am !== bm) return am ? a : b;
    if (ord(a) !== ord(b)) return ord(a) < ord(b) ? a : b;
    return str(a) >= str(b) ? a : b;
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
    // Stealth (abHideTerrainTarget): the game's concept text — "Hidden while
    // on a Trees tile in neutral or friendly territory" — plus the two
    // consequences a puzzle can actually meet
    if (d.hideVegetation) {
      out.push('Hidden in ' + d.hideVegetation.map(function (v) {
        return v.replace('VEGETATION_', '').toLowerCase();
      }).sort().join(' or ') + ' (neutral or friendly territory): does not block a panicked enemy, +' +
        G.HIDDEN_ATTACK_MODIFIER + '% attacking from hiding; visible for a turn after attacking');
    }
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
    // An author may name the pool outright (editor: "Order pool - I choose
    // it"), which makes the pool a second constraint rather than slack. It is
    // floored at par: a pool below the puzzle's own optimum is unwinnable at
    // par and, on a killAll board, may be unwinnable at all.
    if (p.pool) return Math.max(p.pool, p.orders || 1);
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
      var hp0 = u.hp != null ? u.hp : DATA.units[u.type].iHPMax;
      return {
        id: i, player: u.player, type: u.type, q: u.q, r: u.r,
        hp: hp0,
        // the HP this unit walked onto the board with. "Damage taken" means
        // damage taken THIS TURN; measuring from iHPMax instead reported the
        // wounds the author painted into the board as the player's own losses
        hp0: hp0,
        promotions: u.promotions || [], fortifyTurns: u.fortifyTurns || 0,
        cooldown: null, steps: 0, general: hasGeneral(u), name: u.name || null,
        march: false, unlimbered: DATA.units[u.type].bUnlimber ? !!u.unlimbered : undefined,
        anchored: DATA.units[u.type].bAnchor ? !!u.anchored : undefined,
        // a critical hit already rolled for this unit's next attack (the
        // game's CriticalHit flag under CRITICAL_HIT_PREVIEW); a limbered
        // siege unit never holds one (Unit.cs:3411-3414)
        crit: !!u.crit && !(DATA.units[u.type].bUnlimber && !u.unlimbered),
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

  // ---- shared with the editor, the player and the server ----------------
  // One source for the submission limits, so the editor can warn while you
  // build instead of the server refusing after you press submit. A puzzle was
  // lost that way: 26 units, rejected at the last step with no earlier hint.
  var LIMITS = { maxUnits: 30, maxRadius: 6 };
  function limitProblems(p) {
    var out = [];
    var n = (p.units || []).length;
    if (n > LIMITS.maxUnits) out.push(n + ' units — the limit is ' + LIMITS.maxUnits);
    if ((p.radius == null ? 3 : p.radius) > LIMITS.maxRadius) {
      out.push('radius ' + p.radius + ' — the limit is ' + LIMITS.maxRadius);
    }
    return out;
  }

  // The objective in one consistent sentence, derived from the objective ITSELF
  // rather than retyped per puzzle. `brief` stays the author's own flavour line;
  // this is the rule of the puzzle, phrased the same way every time, so a player
  // never has to guess what winning means from prose.
  function objectiveText(objective, puzzle) {
    var o = objective || {};
    switch (o.kind) {
      case 'killAll': return 'Destroy every enemy unit.';
      case 'maxKill': return 'Destroy as much enemy strength as you can.';
      case 'killTarget': return 'Destroy the marked enemy.';
      case 'killList':
        return 'Destroy the ' + ((o.targets || []).length === 1 ? 'marked enemy.' : 'marked enemies.');
      case 'capture': return 'Move any unit onto the city.';
      case 'surviveAll': return 'End the turn with every one of your units alive.';
      default: return '';
    }
  }

  var api = {
    DATA: DATA, DIRS: DIRS, key: key, hexDistance: hexDistance, dirBetween: dirBetween,
    modify: modify, tileAt: tileAt, unitAt: unitAt, unitsAt: unitsAt, unitById: unitById,
    canBothOccupy: canBothOccupy, canEndOn: canEndOn,
    effectsOf: effectsOf, isMelee: isMelee, rangeMax: rangeMax, hpMax: hpMax,
    canAct: canAct, canMove: canMove, canAttack: canAttack, isHiddenAt: isHiddenAt,
    canMarch: canMarch, doMarch: doMarch, canUnlimber: canUnlimber, doUnlimber: doUnlimber,
    canSwap: canSwap, doSwap: doSwap,
    canAnchor: canAnchor, doAnchor: doAnchor, waterControlled: waterControlled,
    waterControlTiles: waterControlTiles,
    poolOrders: poolOrders,
    puzzleHash: puzzleHash, betterRecording: betterRecording, effectName: effectName,
    describeEffect: describeEffect, describeUnitAbilities: describeUnitAbilities, killsOf: killsOf, strKilledOf: strKilledOf,
    nextStepOrderCost: nextStepOrderCost,
    canDamage: canDamage, fatigueLimit: fatigueLimit,
    movementPoints: movementPoints, reachableTiles: reachableTiles, movePath: movePath,
    attackTargets: attackTargets, isShotObstructed: isShotObstructed,
    effectiveRange: effectiveRange, attackStrength: attackStrength,
    defendStrength: defendStrength, attackUnitDamage: attackUnitDamage,
    counterAttackDamage: counterAttackDamage, previewAttack: previewAttack,
    explainAttack: explainAttack,
    doMove: doMove, doAttack: doAttack, doFortify: doFortify,
    legalActions: legalActions, applyAction: applyAction,
    checkObjective: checkObjective, objectiveScorable: objectiveScorable,
    objectiveText: objectiveText, LIMITS: LIMITS, limitProblems: limitProblems,
    loadPuzzle: loadPuzzle, cloneState: cloneState,
    nameOf: nameOf,
  };

  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.OWENGINE = api;
})();
