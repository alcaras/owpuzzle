// Tiny MIP model builder with two backends: HiGHS (npm `highs`, wasm, via
// CPLEX LP text) and CP-SAT (OR-tools, via a python subprocess — cpsat.py).
//
// Rows may carry ENFORCEMENT LITERALS (`addCon(..., enf)`): the row holds only
// when every literal is true. CP-SAT takes them natively (OnlyEnforceIf); the
// LP text gets a big-M per row, computed exactly from the variable bounds.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

class Model {
  constructor(sense) {
    this.sense = sense || 'Maximize';
    this.vars = [];            // {name, obj, lb, ub, binary}
    this.byName = new Map();
    this.cons = [];            // {name, terms:[[coef,name]], sense, rhs, enf}
  }
  addVar(name, o) {
    o = o || {};
    if (this.byName.has(name)) throw new Error('dup var ' + name);
    const v = { name, obj: o.obj || 0, lb: o.lb == null ? 0 : o.lb, ub: o.ub == null ? Infinity : o.ub, binary: !!o.binary };
    if (v.binary && v.ub === 0) { v.binary = false; v.lb = 0; }   // a fixed-off binary: plain 0 <= v <= 0
    this.vars.push(v); this.byName.set(name, v);
    return name;
  }
  addObj(name, coef) { this.byName.get(name).obj += coef; }
  // terms: array of [coef, varName]; sense: '<=', '>=', '='
  // enf: optional list of binary literals ('v' or '!v')
  addCon(name, terms, sense, rhs, enf) {
    terms = terms.filter(t => t[0] !== 0);
    if (!terms.length) {
      if (enf && enf.length) return;   // constant row under enforcement: assume satisfiable
      if ((sense === '<=' && 0 > rhs) || (sense === '>=' && 0 < rhs) || (sense === '=' && rhs !== 0))
        throw new Error('infeasible constant constraint ' + name);
      return;
    }
    this.cons.push({ name, terms, sense, rhs, enf: enf && enf.length ? enf : undefined });
  }
  // expand an enforced row into plain big-M rows for the LP text
  bigM(c) {
    if (!c.enf) return [c];
    const rows = c.sense === '=' ? [{ ...c, sense: '<=' }, { ...c, sense: '>=' }] : [c];
    const out = [];
    for (const r of rows) {
      const sign = r.sense === '>=' ? -1 : 1;   // normalise to <=
      const terms = r.terms.map(t => [sign * t[0], t[1]]);
      const rhs = sign * r.rhs;
      let maxL = 0;
      for (const [coef, name] of terms) {
        const v = this.byName.get(name);
        const lb = v.binary ? 0 : v.lb, ub = v.binary ? 1 : v.ub;
        const m = coef > 0 ? coef * ub : coef * lb;
        if (!isFinite(m)) throw new Error('unbounded var in enforced row ' + c.name);
        maxL += m;
      }
      const M = Math.max(0, maxL - rhs);
      if (M === 0) { out.push({ name: r.name, terms, sense: '<=', rhs }); continue; }
      let n1 = 0; const extra = [];
      for (const l of c.enf) {
        if (l[0] === '!') extra.push([-M, l.slice(1)]); else { extra.push([M, l]); n1++; }
      }
      out.push({ name: r.name + (rows.length > 1 ? (r.sense === '<=' ? 'a' : 'b') : ''), terms: terms.concat(extra), sense: '<=', rhs: rhs + M * n1 });
    }
    return out;
  }
  static fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(6); }
  lpText(relax) {
    const F = Model.fmt;
    const out = [];
    out.push(this.sense === 'Maximize' ? 'Maximize' : 'Minimize');
    const objTerms = this.vars.filter(v => v.obj !== 0).map(v => (v.obj >= 0 ? '+ ' : '- ') + F(Math.abs(v.obj)) + ' ' + v.name);
    out.push(' obj: ' + (objTerms.length ? objTerms.join(' ') : '0 ' + this.vars[0].name));
    out.push('Subject To');
    for (const c0 of this.cons) for (const c of this.bigM(c0)) {
      const e = c.terms.map(t => (t[0] >= 0 ? '+ ' : '- ') + F(Math.abs(t[0])) + ' ' + t[1]).join(' ');
      out.push(' ' + c.name + ': ' + e + ' ' + c.sense + ' ' + F(c.rhs));
    }
    out.push('Bounds');
    for (const v of this.vars) {
      if (v.binary) { if (relax) out.push(' 0 <= ' + v.name + ' <= 1'); continue; }
      const lb = v.lb === -Infinity ? '-inf' : F(v.lb);
      const ub = v.ub === Infinity ? '+inf' : F(v.ub);
      out.push(' ' + lb + ' <= ' + v.name + ' <= ' + ub);
    }
    const bins = relax ? [] : this.vars.filter(v => v.binary).map(v => v.name);
    if (bins.length) {
      out.push('Binary');
      for (let i = 0; i < bins.length; i += 20) out.push(' ' + bins.slice(i, i + 20).join(' '));
    }
    out.push('End');
    return out.join('\n');
  }
}

// ---- backends
let highsInst = null;
async function highs() {
  if (!highsInst) highsInst = await require('highs')();
  return highsInst;
}
function hasHighs() { try { require.resolve('highs'); return true; } catch (e) { return false; } }

// the python that has ortools: $CPSAT_PY, else a venv beside this file, else python3
function pythonPath() {
  if (process.env.CPSAT_PY) return process.env.CPSAT_PY;
  const venv = path.join(__dirname, '.venv', 'bin', 'python');
  return fs.existsSync(venv) ? venv : 'python3';
}
function hasCpsat() {
  try { execFileSync(pythonPath(), ['-c', 'import ortools.sat.python.cp_model'], { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}
function solveCpsat(model, opts, hints, assumptions) {
  if (model.timeScale && opts.ts == null) opts.ts = model.timeScale;
  const payload = JSON.stringify({ sense: model.sense, vars: model.vars, cons: model.cons, opts, hints: hints || null, assumptions: assumptions || null });
  const res = execFileSync(pythonPath(), [path.join(__dirname, 'cpsat.py')], { input: payload, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'inherit'] });
  const out = JSON.parse(res.toString());
  const values = new Map(Object.entries(out.values));
  return { status: out.status, obj: out.obj, bound: out.bound, values, core: out.core };
}

// returns {status, obj, bound?, values: Map name->value}
// opts: backend ('highs' | 'cpsat'; default $SOLVER or highs), time_limit,
// mip_rel_gap, relax (LP relaxation; highs only), hints, workers, seed
async function solve(model, opts) {
  opts = Object.assign({ time_limit: 60, mip_rel_gap: 0.005 }, opts || {});
  const backend = opts.backend || process.env.SOLVER || 'highs'; delete opts.backend;
  const hints = opts.hints; delete opts.hints;
  const assumptions = opts.assumptions; delete opts.assumptions;
  if (backend === 'cpsat' && !opts.relax) return solveCpsat(model, opts, hints, assumptions);
  const h = await highs();
  const relax = !!opts.relax; delete opts.relax;
  const text = model.lpText(relax);
  for (const k of ['workers', 'seed', 'hint_conflict_limit']) delete opts[k];   // CP-SAT-only knobs
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  const res = h.solve(text, opts);
  const values = new Map();
  for (const name of Object.keys(res.Columns)) values.set(name, res.Columns[name].Primal);
  return { status: res.Status, obj: res.ObjectiveValue, values, text };
}

module.exports = { Model, solve, hasHighs, hasCpsat, pythonPath };
