// The review stepper (architecture review, Phase 1: last of the three pages).
//
// Walks an author's recorded line one action at a time on the real board, so
// a reviewer watches the idea instead of reconstructing it, and can approve
// or reject where the evidence is. Attached by the player page when
// ?review=1; every dependency on player internals is EXPLICIT in deps —
// nothing reaches into the player's scope.
(function (root) {
  'use strict';

  // pure: the progress label for step index `at` of `line`
  function stepLabel(line, at, tally) {
    var what = at >= line.length ? 'line complete'
      : (at + 1) + ' of ' + line.length + ': ' +
        (line[at].type === 'move' ? 'move to (' + line[at].q + ',' + line[at].r + ')'
          : line[at].type + (line[at].target != null ? ' →' : ''));
    return what + '  ·  ' + tally;
  }

  // deps: { puzzle, act(action), undo(), tally() -> string, api }
  function attach(line, deps) {
    var at = 0;
    var bar = document.createElement('div');
    bar.className = 'controls';
    bar.style.cssText = 'gap:8px;align-items:center;flex-wrap:wrap';
    bar.innerHTML =
      '<button id="rv-back">◀ back</button>' +
      '<button id="rv-step" class="primary">step ▶</button>' +
      '<button id="rv-all">play all ⏭</button>' +
      '<button id="rv-reset">restart</button>' +
      '<span id="rv-at" style="font-size:13px;color:var(--muted)"></span>' +
      '<span style="flex-basis:100%"></span>' +
      '<button id="rv-approve" style="border-color:#2f7d43;color:#2f7d43">✓ Approve</button>' +
      '<button id="rv-reject" style="border-color:var(--accent);color:var(--accent)">✗ Reject</button>' +
      '<span id="rv-verdict" style="font-size:13px;color:var(--muted)"></span>';
    var host = document.querySelector('.controls-final');
    host.parentNode.insertBefore(bar, host);

    function label() {
      document.getElementById('rv-at').textContent = stepLabel(line, at, deps.tally());
    }
    function step() {
      if (at >= line.length) return false;
      try { deps.act(line[at]); } catch (e) {
        document.getElementById('rv-at').textContent =
          'step ' + (at + 1) + ' would not replay: ' + e.message;
        return false;
      }
      at++; label(); return true;
    }
    document.getElementById('rv-step').onclick = step;
    document.getElementById('rv-back').onclick = function () {
      if (at === 0) return;
      deps.undo(); at--; label();
    };
    document.getElementById('rv-all').onclick = function () {
      var guard = 0;
      while (step() && guard++ < 500) { /* to the end */ }
    };
    document.getElementById('rv-reset').onclick = function () { location.reload(); };

    // the verdict belongs where the evidence is — no trip back to the queue
    function verdict(approve) {
      document.getElementById('rv-approve').disabled = true;
      document.getElementById('rv-reject').disabled = true;
      deps.api.post('/api/review/' + deps.puzzle.id, { approve: approve })
        .then(function (res) {
          document.getElementById('rv-verdict').textContent = res.status +
            (res.status === 'approved' ? ' — it is live' : '');
        }).catch(function (e) {
          document.getElementById('rv-verdict').textContent = e.message || 'could not reach the server';
          document.getElementById('rv-approve').disabled = false;
          document.getElementById('rv-reject').disabled = false;
        });
    }
    document.getElementById('rv-approve').onclick = function () { verdict(true); };
    document.getElementById('rv-reject').onclick = function () { verdict(false); };
    label();
  }

  var exported = { attach: attach, stepLabel: stepLabel };
  root.OWREVIEW = exported;
  if (typeof module !== 'undefined') module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
