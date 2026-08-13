// Shared DOM discipline (architecture review, Phase 1).
//
// esc() is the ONLY sanctioned way for a string that did not originate in our
// own source to reach innerHTML. If you are concatenating HTML and the value
// came from a submission, a profile, or any API, it goes through esc().
//
// Loaded as a plain script (window.OWDOM) and requirable from node tests.
(function (root) {
  'use strict';

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // the game displays strength / 10 (a 50-strength unit shows "5")
  function fmt10(v) { return (v / 10).toFixed(1).replace(/\.0$/, ''); }

  // ---- unit art (portraits vs flag icons), account pref > device pref ----
  var iconStyle = 'portrait';
  try { iconStyle = (root.localStorage && localStorage.getItem('owpuzzle-iconstyle')) || 'portrait'; } catch (e) {}
  // ?art=flag|portrait previews a style for this load only (not persisted)
  try {
    var artParam = new URLSearchParams(root.location.search).get('art');
    if (artParam === 'flag' || artParam === 'portrait') iconStyle = artParam;
  } catch (e) {}
  function setIconStyle(v) {
    if (v !== 'flag' && v !== 'portrait') return;
    iconStyle = v;
    try { localStorage.setItem('owpuzzle-iconstyle', v); } catch (e) {}
  }
  function getIconStyle() { return iconStyle; }
  function unitIcon(type) {
    var IC = (typeof OWICONS !== 'undefined') ? OWICONS : {};
    return iconStyle === 'flag'
      ? (IC['FLAG_' + type] || IC[type])
      : (IC[type] || IC['FLAG_' + type]);
  }

  // ---- local progress, versioned by gameplay content ----
  // An edited puzzle is a new puzzle: entries carry E.puzzleHash of the
  // gameplay content; a stale hash reads as unsolved.
  function readProgress() {
    try { return JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}'); } catch (e) { return {}; }
  }
  function progEntry(prog, p, hashFn) {
    var e = prog[p.id];
    if (e && e.v && hashFn && e.v !== hashFn(p)) return null; // content changed
    return e || null;
  }

  var api = {
    esc: esc, fmt10: fmt10,
    unitIcon: unitIcon, getIconStyle: getIconStyle, setIconStyle: setIconStyle,
    readProgress: readProgress, progEntry: progEntry,
  };
  root.OWDOM = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
