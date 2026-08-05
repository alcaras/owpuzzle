// Exhaustive solver over the player's single turn.
// Scores terminal states: objective met > fewer orders spent > less blue damage
// > more red damage. Returns best line of actions + stats (unique-solution check).
(function () {
  'use strict';

  var E = (typeof OWENGINE !== 'undefined') ? OWENGINE
        : (typeof require !== 'undefined') ? require('./engine.js') : null;

  function stateHash(s) {
    return s.orders + '|' + s.units.map(function (u) {
      return [u.id, u.q, u.r, u.hp, u.cooldown || '-', u.steps, u.fortifyTurns].join(',');
    }).join(';');
  }

  function score(s, objective) {
    var met = E.checkObjective(s, objective) ? 1 : 0;
    var blueHp = 0, redHp = 0;
    s.units.forEach(function (u) {
      if (u.player === 0) blueHp += Math.max(0, u.hp);
      else redHp += Math.max(0, u.hp);
    });
    // lexicographic: met, ordersLeft, blueHp, -redHp
    return { met: met, orders: s.orders, blueHp: blueHp, redHp: redHp };
  }

  function better(a, b) {
    if (a.met !== b.met) return a.met > b.met;
    if (a.redHp !== b.redHp) return a.redHp < b.redHp;
    if (a.blueHp !== b.blueHp) return a.blueHp > b.blueHp;
    if (a.orders !== b.orders) return a.orders > b.orders;
    return false;
  }

  function equalScore(a, b) {
    return a.met === b.met && a.redHp === b.redHp && a.blueHp === b.blueHp && a.orders === b.orders;
  }

  // Full search. opts: {maxStates}
  function solve(puzzle, opts) {
    opts = opts || {};
    var maxStates = opts.maxStates || 2000000;
    var init = E.loadPuzzle(puzzle);
    var seen = {};
    var best = null, bestLine = null, bestCount = 0, explored = 0, truncated = false;

    function rec(s, line) {
      if (explored++ > maxStates) { truncated = true; return; }
      var sc = score(s, puzzle.objective);
      if (best === null || better(sc, best)) {
        best = sc; bestLine = line.slice(); bestCount = 1;
      } else if (equalScore(sc, best)) {
        // count distinct terminal-equivalent lines only at terminal below
      }
      var acts = E.legalActions(s);
      for (var i = 0; i < acts.length; i++) {
        var a = acts[i];
        var ns;
        try { ns = E.applyAction(s, a); } catch (e) { continue; }
        var h = stateHash(ns);
        if (seen[h]) continue;
        seen[h] = true;
        line.push(a);
        rec(ns, line);
        line.pop();
      }
    }

    rec(init, []);

    // second pass: count distinct winning OUTCOMES (uniqueness check).
    // Terminal states are canonicalized on results (deaths, HP, orders), not
    // unit positions — the same tactical idea executed in a different order or
    // from a different adjacent tile counts once.
    function outcomeHash(s) {
      return s.orders + '|' + s.units.map(function (u) {
        return u.id + ':' + Math.max(0, u.hp);
      }).join(',');
    }
    var winCount = 0, winLines = [], winOutcomes = {};
    if (best && best.met) {
      var seen2 = {};
      (function rec2(s, line) {
        if (winLines.length > 25) return;
        var sc = score(s, puzzle.objective);
        if (sc.met && equalScore(sc, best)) {
          var oh = outcomeHash(s);
          if (!winOutcomes[oh]) {
            winOutcomes[oh] = true;
            winCount++;
            if (winLines.length < 25) winLines.push(line.slice());
          }
          return; // don't extend past a win
        }
        var acts = E.legalActions(s);
        for (var i = 0; i < acts.length; i++) {
          var ns;
          try { ns = E.applyAction(s, acts[i]); } catch (e) { continue; }
          var h = stateHash(ns);
          if (seen2[h]) continue;
          seen2[h] = true;
          line.push(acts[i]);
          rec2(ns, line);
          line.pop();
        }
      })(E.loadPuzzle(puzzle), []);
    }

    return {
      best: best, line: bestLine, explored: explored, truncated: truncated,
      winCount: winCount, winLines: winLines,
    };
  }

  function describeLine(puzzle, line) {
    var s = E.loadPuzzle(puzzle);
    var out = [];
    line.forEach(function (a) {
      var u = E.unitById(s, a.unit);
      if (a.type === 'move') out.push(E.nameOf(u) + ' -> (' + a.q + ',' + a.r + ')');
      else if (a.type === 'attack') out.push(E.nameOf(u) + ' attacks ' + E.nameOf(E.unitById(s, a.target)));
      else out.push(E.nameOf(u) + ' ' + a.type);
      s = E.applyAction(s, a);
    });
    return out;
  }

  var api = { solve: solve, describeLine: describeLine, stateHash: stateHash };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.OWSOLVER = api;
})();
