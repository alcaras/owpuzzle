// The position solver: plan by integer programme, execute by engine, re-plan.
//
//   solvePosition(state, opts) -> {state, line, str, orders, lostStr, ms, label}
//
// The turn is a COVERING problem: choose which enemies die and which blows
// (unit, seat, target) pay for each, subject to one blow per unit, one body
// per tile at a time, the order pool, and the schedule (model.js). The engine
// then executes the plan action by action, and whatever the static model got
// wrong (a kill one point short, a body in the way) is picked up by
// re-planning from the resulting state (`waves`).
//
// Two-phase solve for big boards (`solveWave`, when the table has more than
// `twoPhaseAt` blows): the full scheduled model on a 43-v-54 board is ~68k
// rows and CP-SAT stalls. Its BINARY-ONLY rows (`binaryMaster`: which blows,
// which kills, cover, orders, plus the death-order ranks) are a timing-free
// relaxation that finds a good kill set K fast; the full model restricted to
// K (`restrictTable`) is a few thousand rows and, hinted with the master's
// blows, proves itself in seconds.
//
// PANIC pushes that displace a target are not in the model (they move the
// target, which rewrites every blow on it), so `solvePosition` branches over them:
// each candidate push is applied by the engine as a PREFIX, the resulting
// position is screened by the LP relaxation of the master, and the best few
// are planned in full.
//
// The planner is a FINDER: its blow table is deliberately incomplete (see
// blowtable.js), so a line it cannot find may still exist. It never proves.
'use strict';
const E = require('./engine.js');
const { Model, solve } = require('./lp.js');
const M2 = require('./model.js');
const { blowTable, key, unkey, STR, canPush, isImmune } = require('./blowtable.js');
const { replyEstimate } = require('./threat.js');

// ---------------------------------------------------------------- two-phase
// the binary rows of the full model. D_r (total damage) is a pure sum of
// binaries and rk_r a rank integer under binary literals: both stay, so the
// master keeps the cover row, the last-blow rows and every precedence cycle.
function binaryMaster(m) {
  const rel = new Model(m.sense);
  for (const v of m.vars) if (v.binary || /^(D|rk)\d+$/.test(v.name)) { rel.vars.push(v); rel.byName.set(v.name, v); }
  for (const c of m.cons) {
    if (c.terms.every(t => rel.byName.has(t[1])) && (!c.enf || c.enf.every(l => rel.byName.has(l.replace('!', ''))))) rel.cons.push(c);
  }
  return rel;
}
// the table restricted to a kill set K: blows on non-K targets dropped
// (pushes kept — they disarm), chains only between K reds. `chosen` (the
// master's own blows) are never pruned: its line must stay expressible.
function restrictTable(T, K, pareto, chosen) {
  chosen = chosen || new Set();
  const keepB = b => b.push || K.has(b.target) || b.coll.some(c => K.has(c.id));
  let blows = T.blows.filter(keepB);
  if (pareto) {
    // per (unit, target) drop seats dominated on damage / orders / counter /
    // collateral by a plainer seat — a heuristic cut (a dominated seat can
    // still matter positionally: blocking an escape, standing as a flank)
    const cs = b => b.coll.reduce((a, c) => a + (K.has(c.id) ? c.dmg : 0), 0);
    const g = new Map(); for (const b of blows) { const k = b.unit + '|' + b.target; if (!g.has(k)) g.set(k, []); g.get(k).push(b); }
    blows = blows.filter(b => b.push || b.flank || b.same || chosen.has(b.id) || !g.get(b.unit + '|' + b.target).some(o => o !== b && !o.march &&
      (o.req == null || o.req === b.req) && o.dmg >= b.dmg && o.mv <= b.mv && o.counter <= b.counter && cs(o) >= cs(b) &&
      (o.dmg > b.dmg || o.mv < b.mv || o.counter < b.counter || cs(o) > cs(b) || o.id < b.id)));
  }
  return { ...T, blows, chains: T.chains.filter(c => K.has(c.from) && (K.has(c.target) || c.coll.some(x => K.has(x.id)))) };
}
// greedy cover over the blow table as a warm start for the master: take the
// red with the best strength per order, paid for by its cheapest sufficient
// blows (one blow per unit, one unit per seat), until nothing else fits
function greedyHint(state, T, pool) {
  const reds = state.units.filter(u => u.player !== 0 && u.hp > 0);
  const byT = new Map(); for (const b of T.blows) { if (!byT.has(b.target)) byT.set(b.target, []); byT.get(b.target).push(b); }
  const usedU = new Set(), usedS = new Set(), dead = new Set(), chosen = [];
  let spent = 0;
  for (;;) {
    let pick = null;
    for (const r of reds) {
      if (dead.has(r.id)) continue;
      const cand = (byT.get(r.id) || []).filter(b => !usedU.has(b.unit) && !usedS.has(b.seat) && !b.push && b.req == null && !b.march)
        .sort((a, b) => (b.dmg / (b.mv + 1)) - (a.dmg / (a.mv + 1)));
      let acc = 0, cost = 0; const set = [], su = new Set(), ss = new Set();
      for (const b of cand) {
        if (acc >= r.hp) break;
        if (su.has(b.unit) || ss.has(b.seat)) continue;
        su.add(b.unit); ss.add(b.seat); set.push(b); acc += b.dmg; cost += b.mv + 1;
      }
      if (acc < r.hp || spent + cost > pool) continue;
      const score = STR(r) / cost;
      if (!pick || score > pick.score) pick = { r, set, cost, score };
    }
    if (!pick) break;
    for (const b of pick.set) { usedU.add(b.unit); usedS.add(b.seat); chosen.push(b); }
    spent += pick.cost; dead.add(pick.r.id);
  }
  const hints = {};
  for (const b of T.blows) hints['x' + b.id] = chosen.includes(b) ? 1 : 0;
  for (const r of reds) hints['y' + r.id] = dead.has(r.id) ? 1 : 0;
  return { hints, str: [...dead].reduce((a, id) => a + STR(E.unitById(state, id)), 0), spent };
}

async function solveWave(state, T, pool, opts, say) {
  const secs = opts.seconds || 30;
  const big = T.blows.length > (opts.twoPhaseAt || 800);
  const m = M2.buildModel(state, T, pool, opts);
  if (!big) {
    const sol = await solve(m, { time_limit: secs, mip_rel_gap: opts.gap || 0.02, workers: opts.workers });
    return { T, m, sol };
  }
  let mh = {};
  if (opts.greedy) { const g = greedyHint(state, T, pool); mh = g.hints; say(`   greedy hint: ${g.str / 10} STR for ${g.spent} orders`); }
  // several short seeded masters (`restarts`) were measured worse than one
  // long one, and warm-starting each from the best incumbent pins CP-SAT to
  // it; the loop stays for experiments, default 1
  const n = opts.restarts || 1, share = opts.masterShare || 0.6;
  const master = binaryMaster(m);
  let best = null, bestMaster = null;
  for (let seed = 1; seed <= n; seed++) {
    const t0 = Date.now();
    const r1 = await solve(master, { backend: 'cpsat', time_limit: Math.round(secs * share / n), workers: opts.workers || 10, seed: seed + (opts.seed || 0), hints: mh, hint_conflict_limit: (opts.greedy || seed > 1) ? 20 : undefined });
    if (!bestMaster || r1.obj > bestMaster.obj) { bestMaster = r1; mh = {}; for (const [k, v] of r1.values) mh[k] = v; }
    const K = new Set(); for (const [k, v] of r1.values) if (/^y\d+$/.test(k) && v) K.add(+k.slice(1));
    say(`   master${n > 1 ? ' #' + seed : ''}: ${r1.status} ${((r1.obj || 0)).toFixed(0)} (bound ${(r1.bound || 0).toFixed(0)}) in ${Date.now() - t0}ms, K = ${K.size} reds`);
    if (best && r1.obj <= best.sol.obj + 1e-6) { say('   (no better than the best sub so far, skipped)'); continue; }
    const chosen = new Set(); for (const [k, v] of r1.values) if (/^x\d+$/.test(k) && v) chosen.add(+k.slice(1));
    const T2 = restrictTable(T, K, opts.pareto !== false, chosen);
    const sub = M2.buildModel(state, T2, pool, { ...opts, kills: K });
    const t1 = Date.now();
    // the master's x/c/y are feasible in the full model (the timing-free
    // corollaries, cycle cuts and rank rows made them so); hint just those and
    // let the sub complete the timing — hinting every master binary drags in
    // ordering/last-blow literals the master never constrained
    const hints = {}; if (opts.hint !== false) for (const [k, v] of r1.values) if (/^[xcy]\d/.test(k) && sub.byName.has(k)) hints[k] = v;
    const r2 = await solve(sub, { backend: 'cpsat', time_limit: Math.round(secs * (1 - share) / n), workers: opts.workers || 10, seed: opts.seed || undefined, hints, hint_conflict_limit: opts.hint !== false ? 50 : undefined });
    say(`   sub: ${T2.blows.length} blows, ${sub.cons.length} rows, ${r2.status} ${(r2.obj || 0).toFixed(0)} (bound ${(r2.bound || 0).toFixed(0)}) in ${Date.now() - t1}ms`);
    if (!best || (r2.obj || 0) > (best.sol.obj || 0)) best = { T: T2, m: sub, sol: r2 };
  }
  return best;
}

// order pools (model.js): the state's `pools` ({key: orders}) and each
// unit's `pool` key. The model keeps every pool within budget; after the
// engine has played a line, its spend is charged back pool by pool
function chargePools(state, line) {
  if (!state.pools) return undefined;
  const pools = { ...state.pools };
  let s = state;
  for (const a of line) {
    const u = E.unitById(s, a.unit);
    const s2 = E.applyAction(s, a);
    if (u && u.pool != null) pools[u.pool] -= s.orders - s2.orders;
    s = s2;
  }
  return pools;
}

// ---------------------------------------------------------------- driver
// after the plan: any attack still affordable that kills, or failing that
// hurts the most
// Kills only: every objective the engine scores is a kill (maxKill,
// killList, killTarget), so a blow that kills nothing is worth nothing
// and the order it costs is worth keeping. `damageOnly` (the experimental
// mode) still takes the most hurtful blow left.
function mopUp(state, opts) {
  opts = opts || {};
  let s = state; const line = [];
  for (;;) {
    if (s.orders <= 0) break;
    let best = null;
    for (const u of s.units) {
      if (u.player !== 0 || u.hp <= 0 || !E.canAttack(s, u)) continue;
      if (s.pools && (s.pools[u.pool] || 0) < 1) continue;
      for (const t of E.attackTargets(s, u)) {
        if (opts.kills && !opts.kills.has(t.id)) continue;   // a fixed kill set: nothing outside it
        let d = 0; try { d = E.attackUnitDamage(s, u, { q: u.q, r: u.r }, t); } catch (e) { continue; }
        if (d < t.hp && !opts.damageOnly) continue;
        const score = (d >= t.hp ? 100000 + STR(t) : 0) + d * 10;
        if (!best || score > best.score) best = { score, unit: u.id, target: t.id, pool: u.pool };
      }
    }
    if (!best) break;
    try { s = E.applyAction(s, { type: 'attack', unit: best.unit, target: best.target }); line.push({ type: 'attack', unit: best.unit, target: best.target }); }
    catch (e) { break; }
    if (s.pools) s = { ...s, pools: { ...s.pools, [best.pool]: s.pools[best.pool] - 1 } };
  }
  return { state: s, line };
}

// the retreat pass: every unit that did not act walks to the seat the
// estimate prices lowest, its walk included, if that beats standing where it
// is. The model's only action is a blow; this is the move without one.
function retreatPass(state, est, opts) {
  opts = opts || {};
  const ordW = opts.ordW || 0;
  let s = state; const line = [], notes = [];
  const idle = s.units.filter(u => u.player === 0 && u.hp > 0 && !u.cooldown && !u.steps && STR(u) > 0);
  for (const u0 of idle) {
    const u = E.unitById(s, u0.id);
    if (!u || u.cooldown || u.steps) continue;
    const home = key(u.q, u.r), pHome = est.price(u.id, home, u.hp);
    if (pHome <= 0) continue;
    const seats = E.reachableTiles(s, u).filter(t => !(s.pools && (s.pools[u.pool] || 0) < t.orders))
      .map(t => ({ t, p: est.price(u.id, key(t.q, t.r), u.hp) + ordW * t.orders }))
      .filter(x => x.p < pHome - 1e-9).sort((a, b) => a.p - b.p);
    for (const x of seats) {
      let s2; try { s2 = E.applyAction(s, { type: 'move', unit: u.id, q: x.t.q, r: x.t.r }); } catch (e) { continue; }
      if (s.pools) s2 = { ...s2, pools: { ...s.pools, [u.pool]: s.pools[u.pool] - (s.orders - s2.orders) } };
      s = s2; line.push({ type: 'move', unit: u.id, q: x.t.q, r: x.t.r });
      notes.push(`${E.nameOf(u)}#${u.id} retreats ${home} -> ${x.t.q},${x.t.r} (${(pHome / 10).toFixed(1)} -> ${(x.p / 10).toFixed(1)} STR at risk, ${x.t.orders} orders)`);
      break;
    }
  }
  return { state: s, line, notes };
}

async function planWaves(state, opts) {
  opts = opts || {};
  const waves = opts.waves || 4;
  const say = opts.quiet ? () => {} : (...a) => console.log(...a);
  let s = state; const line = [];
  for (let w = 0; w < waves; w++) {
    if (s.orders <= 0) break;
    const tb = Date.now();
    const T = blowTable(s, opts);
    if (!T.blows.length) break;
    const tm = Date.now();
    const { T: Tw, m, sol } = await solveWave(s, T, s.orders, opts, say);
    const plan = M2.extractPlan(Tw, sol, m);
    say(`wave ${w}: ${T.blows.length} blows, ${T.chains.length} chain blows, ${m.cons.length} rows | ` +
      `table ${tm - tb}ms, solve ${Date.now() - tm}ms, ${sol.status}, model says ${plan.kills.length} kills / ` +
      `${plan.kills.reduce((a, r) => a + STR(r), 0) / 10} STR using ${plan.blows.length} blows + ${plan.chains.length} chain blows`);
    if (!plan.blows.length) break;
    const before = E.strKilledOf(s), ordBefore = s.orders;
    const dbg = opts.verbose ? [] : null;
    const ex = M2.executePlan(s, plan, dbg);
    if (s.pools) ex.state = { ...ex.state, pools: chargePools(s, ex.line) };
    if (dbg) for (const l of dbg) say('   ' + l);
    const planned = plan.kills.reduce((a, r) => a + STR(r), 0);
    if (opts.onShortfall && E.strKilledOf(ex.state) - before < planned) opts.onShortfall({ wave: w, state: s, T: Tw, plan, sol });
    s = ex.state; line.push(...ex.line);
    say(`   executed: +${(E.strKilledOf(s) - before) / 10} STR for ${ordBefore - s.orders} orders (total ${E.strKilledOf(s) / 10}, ${s.orders} orders left)`);
    if (ex.line.length === 0) break;
  }
  const mu = mopUp(s, opts);
  if (mu.line.length) say(`mop-up: +${(E.strKilledOf(mu.state) - E.strKilledOf(s)) / 10} STR in ${s.orders - mu.state.orders} orders`);
  if (s.pools && mu.line.length) mu.state = { ...mu.state, pools: chargePools(s, mu.line) };
  s = mu.state; line.push(...mu.line);
  if (opts.estimate && (opts.retreat || (opts.exposeW && opts.retreat !== false))) {
    const rp = retreatPass(s, opts.estimate, opts);
    for (const n of rp.notes) say('   ' + n);
    s = rp.state; line.push(...rp.line);
  }
  return { state: s, line };
}

// every (pusher, seat, target) whose push moves or disarms the target, as a
// played prefix
async function pushPrefixes(state) {
  const out = [];
  const pushers = state.units.filter(u => u.player === 0 && u.hp > 0 && canPush(u) && E.canAttack(state, u));
  for (const u of pushers) {
    const seats = [{ q: u.q, r: u.r, orders: 0 }].concat(E.reachableTiles(state, u));
    for (const st of seats) {
      let s1 = state; const pre = [];
      if (st.q !== u.q || st.r !== u.r) {
        try { s1 = E.applyAction(state, { type: 'move', unit: u.id, q: st.q, r: st.r }); pre.push({ type: 'move', unit: u.id, q: st.q, r: st.r }); } catch (e) { continue; }
      }
      const w = E.unitById(s1, u.id);
      if (!E.canAttack(s1, w)) continue;
      for (const t of E.attackTargets(s1, w)) {
        if (E.hexDistance(w, t) !== 1 || isImmune(t, 'EFFECTUNIT_PANIC')) continue;
        let d = 0; try { d = E.attackUnitDamage(s1, w, w, t); } catch (e) { continue; }
        if (d >= t.hp) continue;                 // lethal: no push, the model handles it
        let s2; try { s2 = E.applyAction(s1, { type: 'attack', unit: u.id, target: t.id }); } catch (e) { continue; }
        const t2 = E.unitById(s2, t.id);
        const moved = t2.q !== t.q || t2.r !== t.r;
        const disarmed = (t2.applied || []).length > (t.applied || []).length;
        if (!moved && !disarmed) continue;
        out.push({ state: s2, line: pre.concat([{ type: 'attack', unit: u.id, target: t.id }]),
          label: `${E.nameOf(u)}#${u.id} @${st.q},${st.r} pushes ${E.nameOf(t)}#${t.id} ${moved ? 'to ' + t2.q + ',' + t2.r : '(disarmed)'}` });
      }
    }
  }
  return out;
}

// opts: seconds, quiet, verbose, branch (push prefixes; default on), branchK
// (prefixes planned in full, default 3), waves, workers, twoPhaseAt,
// masterShare, restarts, hint, greedy, pareto, topSeats, onShortfall, and
// the model's (ordW, counterW, exposeW, exposeMode, enemyOrders, bounty);
// retreat (default on with exposeW: idle units walk to safer seats); seed
// (added to CP-SAT's, for a second opinion from the same budget)
// The enemy the estimate prices is the enemy the line LEAVES: every unit
// the line kills strikes nothing and shuts nothing next turn. Each blow's
// own target is excluded exactly (model.js); for what the rest of the line
// kills, the position is solved, the dead taken out of the estimate, and
// solved again, until the kill set holds (three rounds at most). The first
// estimate that counted the spearmen a line was about to kill as the
// strikers on its seats walked three spearmen away from a two-kill line.
async function solvePosition(state, opts) {
  opts = opts || {};
  if ((opts.exposeW || opts.retreat) && opts.exposeMode !== 'threat' && !opts.estimate) {
    const estOn = dead => {
      const st = dead.size ? E.cloneState(state) : state;
      if (dead.size) for (const u of st.units) if (dead.has(u.id)) u.hp = 0;
      return replyEstimate(st, { enemyPools: state.enemyPools, orders: opts.enemyOrders, ordW: opts.ordW, unseen: state.unseenByEnemy });
    };
    const say = opts.quiet ? () => {} : (...a) => console.log(...a);
    let dead = new Set(), r = null;
    for (let round = 0; round < (opts.exposeW ? (opts.repriceRounds == null ? 3 : opts.repriceRounds) : 1); round++) {
      r = await solveOnce(state, { ...opts, estimate: estOn(dead) });
      const now = new Set(r.state.units.filter(u => u.player !== 0 && u.hp <= 0 && E.unitById(state, u.id).hp > 0).map(u => u.id));
      const same = now.size === dead.size && [...now].every(id => dead.has(id));
      if (same) break;
      say(`re-price: the line kills ${now.size} (${[...now].map(id => E.nameOf(E.unitById(state, id)) + '#' + id).join(', ')}); pricing the seats without them`);
      dead = now;
      r.reprice = round + 1;
    }
    return r;
  }
  return solveOnce(state, opts);
}

async function solveOnce(state, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const say = opts.quiet ? () => {} : (...a) => console.log(...a);
  const cands = [{ state, line: [], label: 'no push' }];
  if (opts.branch !== false) cands.push(...await pushPrefixes(state));
  if (state.pools) for (const c of cands) if (c.line.length) c.state = { ...c.state, pools: chargePools(state, c.line) };
  if (cands.length > 1) {
    // screen by the LP relaxation of the timing-free master — the same
    // relaxation the two-phase solve trusts to pick a kill set
    const tl = Date.now();
    for (const c of cands) {
      const T = blowTable(c.state, opts);
      if (!T.blows.length) { c.bound = E.strKilledOf(c.state); continue; }
      const m = binaryMaster(M2.buildModel(c.state, T, c.state.orders, opts));
      const sol = await solve(m, { backend: 'highs', relax: true, time_limit: 10 });
      c.bound = E.strKilledOf(c.state) + (sol.obj || 0);
    }
    cands.sort((a, b) => b.bound - a.bound);
    say(`${cands.length} push prefixes screened in ${Date.now() - tl}ms; top: ` + cands.slice(0, 5).map(c => `${c.label} [${(c.bound / 10).toFixed(1)}]`).join(' | '));
  }
  const K = opts.branchK || 3;
  let best = null;
  const noPush = cands.find(c => c.label === 'no push');
  const tried = cands.slice(0, K); if (!tried.includes(noPush)) tried.unshift(noPush);   // the unpushed line is always planned
  for (const c of tried) {
    say(`== ${c.label}`);
    const r = await planWaves(c.state, opts);
    const str = E.strKilledOf(r.state);
    if (!best || str > best.str) best = { state: r.state, line: c.line.concat(r.line), str, label: c.label };
  }
  const s = best.state;
  const lost = state.units.filter(u => u.player === 0).reduce((a, u) => {
    const v = E.unitById(s, u.id); return a + (v.hp <= 0 ? STR(u) : 0);
  }, 0);
  const est = opts.estimate ? opts.estimate.estimate(s) : null;
  return { state: s, line: best.line, str: best.str, orders: state.orders - s.orders, lostStr: lost, ms: Date.now() - t0, label: best.label,
    estimate: est ? { str: est.str, spent: est.spent, kills: est.kills.length, lambda: est.lambda } : null };
}

module.exports = { solvePosition, planWaves, solveWave, pushPrefixes, binaryMaster, restrictTable, greedyHint, mopUp, retreatPass, chargePools, replyEstimate, blowTable, buildModel: M2.buildModel, extractPlan: M2.extractPlan, executePlan: M2.executePlan };
