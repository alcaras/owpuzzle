// The blow table: everything the ILP is allowed to choose from.
//
// A BLOW is (unit, seat, target): the unit walks to the seat and attacks the
// target from there, with the damage, counter damage, collateral and order
// cost the engine reports for exactly that. The table is built by teleporting
// each unit to each candidate tile on a working copy of the state and asking
// the engine what it could do there — engine-exact per blow, static across
// blows (that is what the model's schedule is for).
//
// Per (unit, target) only the TOPSEATS best unconditional seats and 3
// conditional ones (a tile that opens once a given red is dead, or reached by
// force march) are kept. That is the table's one deliberate incompleteness,
// and why the planner is a FINDER, not a prover: a line that needs a seat
// outside the table is invisible to it.
//
// Also computed here, because they need the engine and not the model:
//   - rout CHAINS: a rout-capable unit standing on dead red p's tile, what it
//     can hit adjacent to p (its turn becomes a path through victims)
//   - positional COUPLING: the damage a blow gains with a flanking partner on
//     the tile opposite, or a same-type friend beside the seat
//   - PANIC escape geometry per push blow, and the disarm delta every other
//     blow on that target would cash once it is disarmed
'use strict';
const E = require('./engine.js');

const key = (q, r) => q + ',' + r;
const unkey = k => { const [q, r] = k.split(',').map(Number); return { q, r }; };
const STR = u => E.DATA.units[u.type].iStrength || 0;
const info = u => E.DATA.units[u.type];
const isSiege = u => !!info(u).bUnlimber;
const hasFlag = (u, f) => E.effectsOf(u).some(e => E.DATA.effects[e] && E.DATA.effects[e][f]);
const canRout = u => hasFlag(u, 'bRout');
const canPush = u => hasFlag(u, 'bPush');
const hasLastStand = u => hasFlag(u, 'bLastStand');
const isImmune = (u, eff) => E.effectsOf(u).some(e => { const d = E.DATA.effects[e]; return d && d.aeEffectUnitImmune && d.aeEffectUnitImmune.indexOf(eff) >= 0; });
const MARCH_COST = (E.DATA.globals && E.DATA.globals.UNIT_MARCH_COST) || 100;

// returns {acting, reds, redById, blows, chains, blueDamaging}
//   blow:  {id, unit, seat, target, dmg, counter, mv, req, march, coll:[{id,dmg}], adj, push, escape?, flank?, same?, disarmDelta?}
//   chain: {id, unit, from (red id), target, dmg, counter, coll, push, disarmDelta?}
function blowTable(state, opts) {
  opts = opts || {};
  const TOPSEATS = opts.topSeats || 4;
  const me = 0;
  const acting = state.units.filter(u => u.player === me && u.hp > 0 && E.canDamage(u));
  const reds = state.units.filter(u => u.player !== me && u.hp > 0);
  const redById = new Map(reds.map(r => [r.id, r]));
  const work = E.cloneState(state);
  const blows = [];
  const chains = [];

  // teleport u to a tile (optionally with one red dead) and list what it can do there
  function probe(u, seatQ, seatR, deadId) {
    const w = E.unitById(work, u.id);
    const q0 = w.q, r0 = w.r;
    w.q = seatQ; w.r = seatR;
    let dead = null;
    if (deadId != null) { dead = E.unitById(work, deadId); dead.hp = -dead.hp; }
    const out = [];
    if (E.canAttack(work, w)) {
      for (const t of E.attackTargets(work, w)) {
        if (t.hp <= 0) continue;
        let d = 0, c = 0, coll = [];
        try {
          d = E.attackUnitDamage(work, w, { q: seatQ, r: seatR }, t);
          c = E.counterAttackDamage(work, w, { q: seatQ, r: seatR }, t);
          coll = E.previewAttack(work, w.id, t.id).collateral.filter(x => x.damage > 0 && x.id !== t.id).map(x => ({ id: x.id, dmg: x.damage }));
        } catch (e) { continue; }
        if (d <= 0) continue;
        out.push({ unit: u.id, seat: key(seatQ, seatR), target: t.id, dmg: d, counter: c, coll,
          adj: E.hexDistance({ q: seatQ, r: seatR }, t) === 1, push: canPush(u) && !isImmune(t, 'EFFECTUNIT_PANIC') });
      }
    }
    if (dead) dead.hp = -dead.hp;
    w.q = q0; w.r = r0;
    return out;
  }
  const marchable = state.training >= MARCH_COST;
  const DIRS = E.DIRS;
  const sumEff = (u, f) => E.effectsOf(u).reduce((a, e) => a + ((E.DATA.effects[e] || {})[f] || 0), 0);
  const blueDamaging = state.units.filter(u => u.player === me && u.hp > 0 && E.canDamage(u));
  // positional coupling: damage with a flanking partner on the tile opposite,
  // and with a same-type friend beside the seat (Commander/Formation)
  function couple(u, b) {
    const w = E.unitById(work, u.id);
    const seat = unkey(b.seat), t = E.unitById(work, b.target);
    const q0 = w.q, r0 = w.r; w.q = seat.q; w.r = seat.r;
    const dmgWith = (helper, hq, hr) => {
      const hq0 = helper.q, hr0 = helper.r; helper.q = hq; helper.r = hr;
      let d = 0; try { d = E.attackUnitDamage(work, w, seat, t); } catch (e) { d = 0; }
      helper.q = hq0; helper.r = hr0; return d;
    };
    if (b.adj && sumEff(u, 'iFlankingAttackModifier') > 0) {
      const d = E.dirBetween(seat, t);
      const o = { q: t.q + DIRS[d].q, r: t.r + DIRS[d].r };
      const ot = E.tileAt(work, o.q, o.r);
      if (ot && d >= 0) {
        const helper = blueDamaging.find(h => h.id !== u.id && h.type !== u.type) || blueDamaging.find(h => h.id !== u.id);
        if (helper) {
          const hw = E.unitById(work, helper.id);
          const occ = E.unitAt(work, o.q, o.r);
          const df = occ && occ.player !== me ? 0 : dmgWith(hw, o.q, o.r);
          if (df > b.dmg) b.flank = { o: key(o.q, o.r), dmg: df };
        }
      }
    }
    const adjSame = sumEff(u, 'iAdjacentSameAttackModifier') + sumEff(u, 'iAdjacentSameModifier');
    if (adjSame > 0) {
      const helper = blueDamaging.find(h => h.id !== u.id && h.type === u.type);
      if (helper) {
        const hw = E.unitById(work, helper.id);
        for (let d = 0; d < 6; d++) {
          const n = { q: seat.q + DIRS[d].q, r: seat.r + DIRS[d].r };
          if (!E.tileAt(work, n.q, n.r)) continue;
          const occ = E.unitAt(work, n.q, n.r);
          if (occ && occ.player !== me) continue;
          const ds = dmgWith(hw, n.q, n.r);
          if (ds > b.dmg) { b.same = { dmg: ds }; break; }
        }
      }
    }
    w.q = q0; w.r = r0;
  }

  for (const u of acting) {
    const per = new Map();   // target -> candidate blows
    const add = (list, mv, req, march) => {
      for (const b of list) { b.mv = mv; b.req = req; b.march = march; if (!per.has(b.target)) per.set(b.target, []); per.get(b.target).push(b); }
    };
    add(probe(u, u.q, u.r, null), 0, null, false);
    const steps = Math.max(1, E.fatigueLimit(u) - u.steps) * (marchable ? 2 : 1);
    const rad = steps * (info(u).iMovement + 1) + 1;
    if (!isSiege(u)) {                       // siege that moves cannot fire this turn
      const reach = E.reachableTiles(state, u);
      const base = new Map(reach.map(t => [key(t.q, t.r), t.orders]));
      for (const t of reach) add(probe(u, t.q, t.r, null), t.orders, null, false);
      // force march: the second band of steps, at double order cost + training
      if (marchable && !u.march && E.canMarch(state, u)) {
        const w = E.unitById(work, u.id); w.march = true;
        let r2 = []; try { r2 = E.reachableTiles(work, w); } catch (e) {} w.march = false;
        for (const t of r2) {
          const k = key(t.q, t.r);
          if (base.has(k) && base.get(k) <= t.orders) continue;
          add(probe(u, t.q, t.r, null), t.orders, null, true);
        }
      }
      // conditional seats: what opens when a nearby enemy dies
      for (const t of reds) {
        if (E.hexDistance(u, t) > rad) continue;
        const w = E.unitById(work, t.id);
        w.hp = -w.hp;
        let r2 = [];
        try { r2 = E.reachableTiles(work, E.unitById(work, u.id)); } catch (e) { r2 = []; }
        w.hp = -w.hp;
        for (const s of r2) {
          const k = key(s.q, s.r);
          if (base.has(k) && base.get(k) <= s.orders) continue;
          add(probe(u, s.q, s.r, t.id).filter(b => b.target !== t.id), s.orders, t.id, false);
        }
      }
    }
    for (const [, list] of per) {
      list.sort((a, b) => (b.dmg - a.dmg) || (a.mv - b.mv) || ((a.req == null ? 0 : 1) - (b.req == null ? 0 : 1)));
      const kept = []; let uncond = 0, cond = 0;
      for (const b of list) {
        if (b.req == null && !b.march) { if (uncond < TOPSEATS) { kept.push(b); uncond++; } }
        else if (cond < 3) { kept.push(b); cond++; }
      }
      // always keep the best adjacent blow for rout-capable units (paths start there)
      if (canRout(u)) { const bestAdj = list.find(b => b.adj); if (bestAdj && !kept.includes(bestAdj)) kept.push(bestAdj); }
      for (const b of kept) { b.id = blows.length; couple(u, b); blows.push(b); }
    }
    // rout paths: standing on dead red p's tile, what can u hit adjacent to p?
    if (canRout(u) && !isSiege(u)) {
      const water = !!info(u).bWater;
      for (const p of reds) {
        if (isImmune(p, 'EFFECTUNIT_ROUT')) continue;
        const pt = E.tileAt(state, p.q, p.r);
        if (!pt || water !== (pt.terrain === 'TERRAIN_WATER')) continue;
        if (E.hexDistance(u, p) > rad + 6) continue;
        for (const h of probe(u, p.q, p.r, p.id)) {
          if (!h.adj) continue;
          chains.push({ id: chains.length, unit: u.id, from: p.id, target: h.target, dmg: h.dmg, counter: h.counter, coll: h.coll, push: h.push });
        }
      }
    }
  }
  // PANIC with no escape DISARMS the target (-20% strength for the rest of the
  // turn). For each push blow: the escape candidates in engine order, each
  // classified passable / impassable for the target by simulation; what stands
  // on the passable ones decides. And what every other blow on that target
  // would deal once it is disarmed.
  const NOESC = E.DATA.globals.PANIC_NO_ESCAPE_EFFECTUNIT;
  const wrapDir = (d, i) => ((d + i) % 6 + 6) % 6;
  const disarmTargets = new Set();
  for (const b of blows) {
    if (!b.push || !NOESC) continue;
    const t = E.unitById(state, b.target);
    if (isImmune(t, NOESC)) { b.push = false; continue; }
    const seat = unkey(b.seat);
    const pd = E.dirBetween(seat, t);
    if (pd < 0) continue;
    const cands = [pd, wrapDir(pd, 1), wrapDir(pd, -1), wrapDir(pd, 2), wrapDir(pd, -2)]
      .map(d => ({ q: t.q + DIRS[d].q, r: t.r + DIRS[d].r })).filter(c => E.tileAt(state, c.q, c.r));
    // passability by simulation: block every other candidate with a blue body, push, see where t lands
    const passable = [];
    const bodies = state.units.filter(x => x.player === me && x.hp > 0 && x.id !== b.unit);
    for (const c of cands) {
      if (E.unitAt(state, c.q, c.r) && E.unitAt(state, c.q, c.r).player !== me) { passable.push(c); continue; } // a red stands there; if it dies the tile may open
      const sim = E.cloneState(state);
      const w = E.unitById(sim, b.unit); w.q = seat.q; w.r = seat.r; w.cooldown = null;
      let bi = 0;
      for (const o of cands) {
        if (o === c || E.unitAt(sim, o.q, o.r)) continue;
        const body = bodies[bi++]; if (!body) break;
        const bw = E.unitById(sim, body.id); bw.q = o.q; bw.r = o.r;
      }
      const occ = E.unitAt(sim, c.q, c.r);
      if (occ) { const ow = E.unitById(sim, occ.id); ow.q = -999; ow.r = -999; }
      let after; try { after = E.doAttack(sim, b.unit, b.target); } catch (e) { continue; }
      const t2 = E.unitById(after, b.target);
      if (t2.q === c.q && t2.r === c.r) passable.push(c);
    }
    b.escape = passable.map(c => key(c.q, c.r));
    disarmTargets.add(b.target);
  }
  for (const c of chains) if (c.push && isImmune(E.unitById(state, c.target), NOESC)) c.push = false;
  for (const tid of disarmTargets) {
    const tw = E.unitById(work, tid);
    tw.applied = (tw.applied || []).concat([NOESC]);
    const rec = (unit, seatKey, dmg) => {
      const w = E.unitById(work, unit); const sq = unkey(seatKey);
      const q0 = w.q, r0 = w.r; w.q = sq.q; w.r = sq.r;
      let d = dmg; try { d = E.attackUnitDamage(work, w, sq, tw); } catch (e) {}
      w.q = q0; w.r = r0; return d > dmg ? d - dmg : 0;
    };
    for (const b of blows) if (b.target === tid && !b.push) b.disarmDelta = rec(b.unit, b.seat, b.dmg);
    for (const c of chains) if (c.target === tid) { const p = redById.get(c.from); c.disarmDelta = rec(c.unit, key(p.q, p.r), c.dmg); }
    tw.applied = tw.applied.filter(e => e !== NOESC);
  }
  return { acting, reds, redById, blows, chains, blueDamaging };
}

module.exports = { blowTable, key, unkey, STR, info, isSiege, hasFlag, canRout, canPush, hasLastStand, isImmune, MARCH_COST };
