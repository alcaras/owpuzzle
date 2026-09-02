#!/usr/bin/env python3
"""CP-SAT backend for lp.js models. Reads {vars, cons, sense, opts} JSON on
stdin, writes {status, obj, values} JSON on stdout.

Continuous variables (the schedule's time variables) are scaled by TS and
made integer; every row containing one is scaled by TS too. The objective is
scaled by OS. All coefficients in the planner's model are multiples of 0.01
(times) or 0.001 (objective weights), so the scaling is exact."""
import json, sys, math
from ortools.sat.python import cp_model

TS_DEFAULT = 100      # time scale (overridden by opts.ts)
OS = 1000     # objective scale


def main():
    data = json.load(sys.stdin)
    opts = data.get('opts', {})
    TS = int(opts.get('ts', 100))
    m = cp_model.CpModel()
    v = {}
    cont = set()
    for var in data['vars']:
        name = var['name']
        if var.get('binary'):
            v[name] = m.NewBoolVar(name)
        else:
            cont.add(name)
            lb = var['lb'] if var['lb'] is not None else 0
            ub = var['ub'] if var['ub'] is not None else 1e6
            v[name] = m.NewIntVar(int(math.floor(lb * TS + 1e-9)), int(math.ceil(ub * TS - 1e-9)), name)

    def ival(x, scale):
        y = x * scale
        r = int(round(y))
        if abs(y - r) > 1e-6:
            raise SystemExit('non-integer coefficient after scaling: %r * %r' % (x, scale))
        return r

    for c in data['cons']:
        has_cont = any(t[1] in cont for t in c['terms'])
        scale = TS if has_cont else 1
        expr = []
        for coef, name in c['terms']:
            if name in cont:
                expr.append(ival(coef, 1) * v[name])       # var already carries TS
            else:
                expr.append(ival(coef, scale) * v[name])
        rhs = ival(c['rhs'], scale)
        s = sum(expr)
        if c['sense'] == '<=':
            ct = m.Add(s <= rhs)
        elif c['sense'] == '>=':
            ct = m.Add(s >= rhs)
        else:
            ct = m.Add(s == rhs)
        enf = c.get('enf')
        if enf:
            ct.OnlyEnforceIf([v[l[1:]].Not() if l.startswith('!') else v[l] for l in enf])

    obj = []
    for var in data['vars']:
        if var.get('obj'):
            name = var['name']
            if name in cont:
                obj.append(ival(var['obj'], OS) * v[name])   # (rare) continuous in objective
            else:
                obj.append(ival(var['obj'], OS) * v[name])
    if data.get('sense', 'Maximize') == 'Maximize':
        m.Maximize(sum(obj))
    else:
        m.Minimize(sum(obj))

    solver = cp_model.CpSolver()
    solver.parameters.num_workers = int(opts.get('workers', 8))
    solver.parameters.max_time_in_seconds = float(opts.get('time_limit', 60))
    if 'seed' in opts:
        solver.parameters.random_seed = int(opts['seed'])
    if 'mip_rel_gap' in opts:
        solver.parameters.relative_gap_limit = float(opts['mip_rel_gap'])
    if 'mip_abs_gap' in opts:
        solver.parameters.absolute_gap_limit = float(opts['mip_abs_gap']) * OS
    hints = data.get('hints') or {}
    for name, val in hints.items():
        if name in v:
            m.AddHint(v[name], int(round(val * (TS if name in cont else 1))))
    if opts.get('log'):
        solver.parameters.log_search_progress = True
        solver.parameters.log_to_stdout = False
        solver.log_callback = lambda msg: sys.stderr.write(msg + '\n')
    if 'hint_conflict_limit' in opts:
        solver.parameters.hint_conflict_limit = int(opts['hint_conflict_limit'])
        solver.parameters.repair_hint = True
    # assumptions: {name: 0|1} — literals assumed true; on INFEASIBLE the
    # solver reports a sufficient subset (a core). Single worker only.
    assume = data.get('assumptions') or {}
    alits = []
    for name, val in assume.items():
        if name in v and name not in cont:
            alits.append(v[name] if val else v[name].Not())
    if alits:
        m.AddAssumptions(alits)
    st = solver.Solve(m)
    names = {cp_model.OPTIMAL: 'Optimal', cp_model.FEASIBLE: 'Time limit reached',
             cp_model.INFEASIBLE: 'Infeasible', cp_model.MODEL_INVALID: 'Invalid', cp_model.UNKNOWN: 'Unknown'}
    out = {'status': names.get(st, str(st)), 'obj': None, 'values': {}, 'bound': None}
    if st == cp_model.INFEASIBLE and alits:
        idx = solver.SufficientAssumptionsForInfeasibility()
        core = []
        for i in idx:
            # index refers to the literal's variable (negated literals have negative index)
            name = m.Proto().variables[i if i >= 0 else -i - 1].name
            core.append(name)
        out['core'] = core
    if st in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        out['obj'] = solver.ObjectiveValue() / OS
        out['bound'] = solver.BestObjectiveBound() / OS
        for name, var in v.items():
            val = solver.Value(var)
            out['values'][name] = val / TS if name in cont else val
    json.dump(out, sys.stdout)


if __name__ == '__main__':
    main()
