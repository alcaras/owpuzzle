// The whole state discipline in ~30 lines (architecture review, Phase 1).
//
// A page holds ONE store. Rendering is a pure function of the store's state
// and must be idempotent — painting twice is harmless. Fetch handlers only
// ever call set(). There is no first-paint flag because there is no race:
// this replaces the 700ms timer, __firstPaint/__painted, and the whole
// "section wiped by a re-render" bug class with one rule.
(function (root) {
  'use strict';

  function createStore(initial) {
    var state = initial || {};
    var subs = [];
    var notifying = false;
    return {
      get: function () { return state; },
      set: function (patch) {
        Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
        // re-entrant set() from inside a subscriber coalesces into the pass
        // that is already running rather than recursing
        if (notifying) return;
        notifying = true;
        try {
          subs.forEach(function (fn) { fn(state); });
        } finally {
          notifying = false;
        }
      },
      onChange: function (fn) { subs.push(fn); },
    };
  }

  root.createStore = createStore;
  if (typeof module !== 'undefined') module.exports = createStore;
})(typeof window !== 'undefined' ? window : globalThis);
