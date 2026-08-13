// The library page (architecture review, Phase 1).
//
// One store, one idempotent render. The whole page is a pure function of
// {me, community, server, pending}: every data arrival calls store.set and
// the page repaints from scratch. There is no first-paint flag, no timer, no
// appendChild-into-a-page-that-might-repaint — the bug class that produced
// "the review queue vanished" three separate times cannot be expressed here.
//
// Buttons survive repaints because the ONE click listener lives on #home and
// delegates, instead of being attached to nodes that innerHTML replaces.
(function (root) {
  'use strict';

  // ---- pure: fold /api/puzzles into library state (node-tested) ----
  function foldPuzzles(resp) {
    var server = { solved: {}, perfect: {}, rating: {}, band: {} };
    var puzzles = (resp && resp.puzzles) || [];
    puzzles.forEach(function (x) {
      if (x.solvedByMe) server.solved[x.slug] = true;
      if (x.perfectByMe) server.perfect[x.slug] = true;
      if (x.rating) server.rating[x.slug] = x.rating;
      if (x.band) server.band[x.slug] = x.band;
    });
    return {
      server: server,
      community: puzzles.filter(function (x) { return x.status === 'approved'; }),
    };
  }

  // ---- pure-ish: the page HTML from state (reads OWPUZZLES + progress) ----
  function libraryHtml(state, deps) {
    var esc = deps.esc, unitIcon = deps.unitIcon, fmt10 = deps.fmt10;
    var prog = deps.progress || {};
    var server = state.server || { solved: {}, perfect: {}, rating: {}, band: {} };
    var community = state.community || [];
    var me = state.me;

    function coreEntry(p) { return deps.progEntry(prog, p, deps.puzzleHash); }
    function coreSolved(p) {
      var e = coreEntry(p);
      return (e && e.solved) || !!server.solved[p.id];
    }
    function commSolved(x) {
      var e = prog[x.slug];
      return x.solvedByMe || !!(e && e.solved);
    }
    function cards(list) {
      return list.map(function (c) {
        return '<a class="card' + (c.done ? ' solved' : '') + '" href="?p=' + encodeURIComponent(c.id) + '">' +
          (c.done ? '<span class="done">' + (c.perfect ? '⭐' : '✓') + '</span>' : '') +
          (c.hero ? '<img class="hero" src="' + c.hero + '" alt="">' : '') +
          '<div class="body"><div class="card-head"><h3>' + esc(c.name) + '</h3>' +
          '<span class="meta">' + c.meta + '</span></div>' +
          '<p>' + esc(c.brief) + '</p>' +
          '<div class="foes"><span class="vs">VS</span>' + c.foes + '</div></div></a>';
      }).join('');
    }
    function heroOf(pz) {
      var u = (pz.hero != null && pz.units[pz.hero]) ||
        pz.units.filter(function (x) { return x.player === 0; })[0];
      return u && unitIcon(u.type);
    }
    function foesOf(pz) {
      return pz.units.filter(function (u) { return u.player === 1; }).map(function (u) {
        var ic = unitIcon(u.type);
        return ic ? '<img src="' + ic + '" alt="">' : '';
      }).join('');
    }

    var solvedCount = OWPUZZLES.filter(coreSolved).length + community.filter(commSolved).length;
    var libraryTotal = OWPUZZLES.length + community.length;
    var cleared = solvedCount === libraryTotal && solvedCount > 0;
    var pct = libraryTotal ? Math.round(100 * solvedCount / libraryTotal) : 0;

    var actions = [];
    if (!cleared) {
      actions.push(me
        ? '<button class="rated-btn" data-act="rated">▶ Play another</button>'
        : '<a class="rated-btn" href="/auth/discord">Sign in with Discord</a>');
    }
    actions.push('<a class="libact" href="editor.html">✎ Create</a>');
    actions.push('<a class="libact" href="hall.html">🏆 Hall of Fame</a>');

    var html =
      '<div class="libbar">' +
        '<div class="libstat">' +
          '<div class="libcount">Solved <b>' + solvedCount + '</b> of ' + libraryTotal +
            (cleared ? ' — the whole library ⚔️' : '') + '</div>' +
          '<div class="libmeter"><i style="width:' + pct + '%"></i></div>' +
        '</div>' +
        '<div class="libactions">' + actions.join('') + '</div>' +
      '</div>';

    // the review queue leads: pending work is why an admin is here
    if (me && me.isAdmin && (state.pending || []).length) {
      html += '<h2 class="group">Review queue — ' + state.pending.length + ' pending</h2><div class="grid">' +
        state.pending.map(function (item) {
          var sol = item.solution;
          return '<div class="card"><div class="body"><div class="card-head">' +
            '<h3>' + esc(item.puzzle.name) + '</h3>' +
            '<span class="meta">' + esc(item.puzzle.orders) + ' orders</span></div>' +
            '<p>by <b>' + esc(item.author || '?') + '</b> — ' + esc(item.puzzle.brief || '') + '</p>' +
            (sol ? '<p style="font-size:12.5px;color:var(--muted)">their line: <b>' +
              fmt10(sol.claimed ? sol.claimed.strength : 0) + ' STR</b> in ' +
              (sol.claimed ? sol.claimed.orders : '?') + ' orders · ' +
              (sol.line || []).length + ' actions</p>' : '') +
            '<div class="row" style="margin-top:8px;display:flex;gap:8px">' +
            '<a href="?p=' + encodeURIComponent(item.slug) + '"><button class="rated-btn" style="font-size:13px;padding:5px 12px">Play</button></a>' +
            (sol ? '<a href="?p=' + encodeURIComponent(item.slug) + '&review=1"><button class="rated-btn" style="font-size:13px;padding:5px 12px">Step their line</button></a>' : '') +
            '<button data-act="verdict" data-slug="' + encodeURIComponent(item.slug) + '" data-v="1" style="font-size:13px;padding:5px 12px">Approve</button>' +
            '<button data-act="verdict" data-slug="' + encodeURIComponent(item.slug) + '" data-v="0" style="font-size:13px;padding:5px 12px">Reject</button>' +
            '</div></div></div>';
        }).join('') + '</div>';
    }

    [{ n: 1, title: 'Basics — one unit, one rule' },
     { n: 2, title: 'Tactics — combined arms' },
     { n: 3, title: 'Challenges — several rules at once' }].forEach(function (g) {
      var list = OWPUZZLES.filter(function (p) {
        return (server.band[p.id] || p.difficulty || 2) === g.n;
      });
      if (!list.length) return;
      html += '<h2 class="group">' + g.title + '</h2><div class="grid">' +
        cards(list.map(function (p) {
          var e = coreEntry(p);
          var done = coreSolved(p);
          return {
            id: p.id, name: p.name, brief: p.brief, done: done,
            perfect: (e && e.perfect) || !!server.perfect[p.id],
            hero: heroOf(p), foes: foesOf(p),
            meta: done && server.rating[p.id] ? 'puzzle elo ' + server.rating[p.id] : '',
          };
        })) + '</div>';
    });

    if (community.length) {
      html += '<h2 class="group">Community puzzles — by players like you</h2><div class="grid">' +
        cards(community.map(function (x) {
          var done = commSolved(x);
          var e = prog[x.slug];
          return {
            id: x.slug, name: x.puzzle.name, brief: x.puzzle.brief || '', done: done,
            perfect: x.perfectByMe || !!(e && e.perfect),
            hero: heroOf(x.puzzle), foes: foesOf(x.puzzle),
            meta: (done && x.rating ? 'puzzle elo ' + x.rating + ' · ' : '') +
              'by ' + (deps.esc)(x.author || '?'),
          };
        })) + '</div>';
    }
    return html;
  }

  // node tests import the pure parts and stop here
  var exported = { foldPuzzles: foldPuzzles, libraryHtml: libraryHtml };
  if (typeof module !== 'undefined') module.exports = exported;
  root.OWLIBRARY = exported;
  if (typeof document === 'undefined') return;

  // ---- the page itself ----
  var params = new URLSearchParams(location.search);
  if (params.get('p') || params.get('draft')) return;   // player page owns those

  // library chrome: no board, no HUD, no game controls
  document.getElementById('day-label').textContent = 'the library';
  document.getElementById('p-name').textContent = '';
  document.getElementById('p-brief').textContent =
    'Single-turn tactics puzzles. Find the winning line within your orders.';
  document.getElementById('main-row').style.display = 'none';
  document.querySelector('.hud').style.display = 'none';
  Array.prototype.forEach.call(document.querySelectorAll('.controls'), function (c) {
    c.style.display = 'none';
  });
  var home = document.getElementById('home');
  home.classList.add('show');

  var store = createStore({ me: null, community: [], pending: [], server: null });

  function render(state) {
    home.innerHTML = libraryHtml(state, {
      esc: OWDOM.esc, fmt10: OWDOM.fmt10, unitIcon: OWDOM.unitIcon,
      progEntry: OWDOM.progEntry, puzzleHash: OWENGINE.puzzleHash,
      progress: OWDOM.readProgress(),
    });
  }
  store.onChange(render);
  render(store.get());                       // paint NOW from local data

  // one delegated listener; repaints cannot orphan it
  home.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    if (btn.dataset.act === 'rated') {
      api('/api/next').then(function (d) {
        if (d.slug) location.href = '?p=' + d.slug;
        else btn.textContent = d.error || d.message || 'sign in with Discord first';
      }).catch(function (e) { btn.textContent = e.message || 'server not available'; });
    }
    if (btn.dataset.act === 'verdict') {
      btn.disabled = true;
      api.post('/api/review/' + btn.dataset.slug, { approve: btn.dataset.v === '1' })
        .then(function () { return refreshReview(); })
        .then(function () { return api('/api/puzzles').then(function (d) { store.set(foldPuzzles(d)); }); })
        .catch(function (e) { btn.textContent = e.message; });
    }
  });

  function refreshReview() {
    return api('/api/review').then(function (d) {
      store.set({ pending: d.pending || [] });
    });
  }

  api.logged(api('/api/me').then(function (d) {
    if (d.user && d.user.unitArt) OWDOM.setIconStyle(d.user.unitArt);
    store.set({ me: d.user });
    if (d.user && d.user.isAdmin) return refreshReview();
  }), 'library auth');

  api.logged(api('/api/puzzles').then(function (d) {
    store.set(foldPuzzles(d));
  }), 'library puzzles');
})(typeof window !== 'undefined' ? window : globalThis);
