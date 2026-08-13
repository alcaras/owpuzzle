// The player's decisions, pure (architecture review, Phase 1).
//
// Everything finish() DECIDES lives here, node-testable with no DOM: what the
// result screen says, what the next-step offer is, what gets recorded, and
// how local progress changes. app.js keeps only the effects — writing DOM,
// posting to the API, touching localStorage. The bug family this kills:
// order-dependent early returns inside one 120-line function that mixed
// decisions with effects (the unrecorded-draft bug, the double-post bug, the
// wrong-share-math bug all lived there).
(function (root) {
  'use strict';

  // ---- the result of a finished turn, fully decided ----
  // deps: { E } (the engine). Returns everything the presentation needs.
  function computeResult(puzzle, state, won, E) {
    var used = E.poolOrders(puzzle) - state.orders;
    var isDraft = puzzle.id === 'draft';
    var noCeiling = puzzle.objective.kind === 'maxKill' && !puzzle.objective.count;
    var perfect = !noCeiling && won && used <= puzzle.orders;
    var strKilled = E.strKilledOf(state);
    var kills = E.killsOf(state);
    var blueDmg = state.units.filter(function (u) { return u.player === 0; })
      .reduce(function (s, u) { return s + (E.hpMax(u) - Math.max(0, u.hp)); }, 0);

    var title, body;
    var fmt10 = function (v) { return (v / 10).toFixed(1).replace(/\.0$/, ''); };
    if (noCeiling) {
      title = '⚔️ Turn complete';
      body = 'You destroyed ' + kills + ' unit' + (kills === 1 ? '' : 's') + ' (' + fmt10(strKilled) +
        ' strength) in ' + used + ' orders. ' +
        (isDraft
          ? 'The target ceiling is set during review — this draft cannot score itself.'
          : 'This submission has no ceiling yet — it is set when the puzzle is approved.');
      won = false; perfect = false;
    } else if (puzzle.objective.kind === 'maxKill') {
      title = won ? '⚔️ Victory!' : '💀 Not this time';
      body = won
        ? '⭐ MAXIMUM DESTRUCTION — ' + kills + ' kills, ' + fmt10(strKilled) +
          ' strength: the most possible!' +
          (perfect ? ' And in the fewest orders (' + used + '). ⭐'
                   : ' (' + used + ' orders — it can be done in fewer…)') +
          ' Damage taken: ' + blueDmg + '.'
        : 'You destroyed ' + kills + ' unit' + (kills === 1 ? '' : 's') + ' (' + fmt10(strKilled) +
          ' strength) — more destruction is possible… Study the field and try again.';
    } else {
      title = won ? '⚔️ Victory!' : '💀 Not this time';
      body = won
        ? (perfect
          ? '⭐ PERFECT — solved in ' + used + ' orders, the fewest possible! Damage taken: ' + blueDmg + '.'
          : 'Solved in ' + used + ' orders — but it can be done in fewer… Damage taken: ' + blueDmg + '.')
        : 'The objective was not met. Study the field and try again.';
    }

    return {
      won: won, perfect: perfect, used: used, kills: kills, strKilled: strKilled,
      blueDmg: blueDmg, isDraft: isDraft, noCeiling: noCeiling,
      title: title, body: body,
      lesson: won && puzzle.lesson ? puzzle.lesson : '',
      // what to offer next: a draft always goes home to the editor; a signed-in
      // win asks the rated queue (after the attempt is recorded); a signed-out
      // win walks the library locally
      next: isDraft ? 'editor' : (won ? 'auto' : null),
      // a finished turn should always be recorded for a draft, win or lose
      recordDraft: isDraft,
      postAttempt: !isDraft,
      writeProgress: won,
    };
  }

  // ---- the draft recording, one shape for localStorage and the server ----
  function draftRecording(puzzle, state, lineLog, E) {
    return {
      puzzle: puzzle,
      v: E.puzzleHash(puzzle),
      line: lineLog,
      orders: E.poolOrders(puzzle) - state.orders,
      strength: E.strKilledOf(state),
      kills: E.killsOf(state),
      met: E.checkObjective(state, puzzle.objective),
    };
  }

  // ---- local progress transition (pure): returns the new map, or null ----
  function progressPatch(prog, puzzle, result, hashFn, now) {
    var entry = prog[puzzle.id];
    if (entry && entry.v && hashFn && entry.v !== hashFn(puzzle)) entry = null; // content changed
    var prev = entry || {};
    if (!result.won) return null;
    if (!prev.solved || result.used < prev.orders) {
      var next = {};
      Object.keys(prog).forEach(function (k) { next[k] = prog[k]; });
      next[puzzle.id] = {
        solved: true,
        orders: Math.min(result.used, prev.orders || 99),
        perfect: !!(prev.perfect || result.perfect),
        ts: now,
        v: hashFn(puzzle),
      };
      return next;
    }
    if (result.perfect && !prev.perfect) {
      var next2 = {};
      Object.keys(prog).forEach(function (k) { next2[k] = prog[k]; });
      next2[puzzle.id] = {
        solved: prev.solved, orders: prev.orders, perfect: true,
        ts: prev.ts, v: prev.v || hashFn(puzzle),
      };
      return next2;
    }
    return null;
  }

  // ---- next unsolved core puzzle in display order (signed-out flow) ----
  function nextUnsolvedLocal(allPuzzles, prog, currentId, hashFn) {
    var list = [];
    [1, 2, 3].forEach(function (d) {
      allPuzzles.forEach(function (p) { if ((p.difficulty || 2) === d) list.push(p); });
    });
    var idx = list.indexOf(list.filter(function (p) { return p.id === currentId; })[0]);
    for (var i = 1; i <= list.length; i++) {
      var cand = list[(idx + i) % list.length];
      var e = prog[cand.id];
      if (e && e.v && hashFn && e.v !== hashFn(cand)) e = null;
      if (!(e && e.solved)) return cand.id;
    }
    return null;
  }

  var exported = {
    computeResult: computeResult,
    draftRecording: draftRecording,
    progressPatch: progressPatch,
    nextUnsolvedLocal: nextUnsolvedLocal,
  };
  root.OWPLAYERLOGIC = exported;
  if (typeof module !== 'undefined') module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
