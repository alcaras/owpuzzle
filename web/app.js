// UI: SVG hex board + interaction for one-turn puzzles.
(function () {
  'use strict';
  var E = OWENGINE;

  // ---------- unit art style: colorful portraits vs white flag icons ----------
  var ICON_STYLE = 'portrait';
  try { ICON_STYLE = localStorage.getItem('owpuzzle-iconstyle') || 'portrait'; } catch (e) {}
  var _artParam = new URLSearchParams(location.search).get('art');
  if (_artParam === 'flag' || _artParam === 'portrait') ICON_STYLE = _artParam;
  function unitIcon(type) {
    var IC = (typeof OWICONS !== 'undefined') ? OWICONS : {};
    return ICON_STYLE === 'flag'
      ? (IC['FLAG_' + type] || IC[type])
      : (IC[type] || IC['FLAG_' + type]);
  }
  function isFlagIcon(type) {
    var IC = (typeof OWICONS !== 'undefined') ? OWICONS : {};
    var ic = unitIcon(type);
    return !!ic && ic === IC['FLAG_' + type];
  }
  function wireIconStyleToggle() {
    var btn = document.getElementById('btn-iconstyle');
    if (!btn) return;
    function label() {
      btn.textContent = 'Unit art: ' + (ICON_STYLE === 'flag' ? 'Icons' : 'Portraits') + ' \u21c4';
    }
    label();
    btn.addEventListener('click', function () {
      ICON_STYLE = ICON_STYLE === 'flag' ? 'portrait' : 'flag';
      try { localStorage.setItem('owpuzzle-iconstyle', ICON_STYLE); } catch (e) {}
      label();
      var onHome = document.getElementById('home') &&
        document.getElementById('home').classList.contains('show');
      if (onHome) location.reload();
      else if (window.__rerender) window.__rerender();
    });
  }
  wireIconStyleToggle();

  // ---------- puzzle selection: library home, ?p=<id> to play ----------
  var params = new URLSearchParams(location.search);
  var puzzle = null;
  var remotePending = false;
  if (params.get('draft')) {
    try { puzzle = JSON.parse(localStorage.getItem('owpuzzle-draft')); } catch (e) {}
  } else if (params.get('p')) {
    puzzle = OWPUZZLES.filter(function (p) { return p.id === params.get('p'); })[0];
    if (!puzzle) {
      // community puzzle: fetch from the server, then boot the game view
      remotePending = true;
      document.getElementById('p-brief').textContent = 'loading puzzle\u2026';
      fetch('/api/puzzle/' + encodeURIComponent(params.get('p')))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.puzzle) { d.puzzle.id = d.slug; boot(d.puzzle); }
          else document.getElementById('p-brief').textContent = d.error || 'puzzle not found';
        })
        .catch(function () { document.getElementById('p-brief').textContent = 'could not load puzzle'; });
    }
  }

  // ---------- progress versioning ----------
  // An edited puzzle is a new puzzle: local progress entries carry a hash of
  // the GAMEPLAY content (not brief/lesson text). A stored entry whose hash
  // no longer matches reads as unsolved. Entries without a hash predate this
  // and are trusted as-is.
  var puzzleHash = E.puzzleHash;   // one canonical implementation, in the engine
  function progEntry(prog, p) {
    var e = prog[p.id];
    if (e && e.v && e.v !== puzzleHash(p)) return null; // content changed
    return e || null;
  }

  // ---------- auth widget (works on every page) ----------
  var ME = null;
  function renderAuth() {
    var el = document.getElementById('auth-widget');
    if (!el) return;
    if (ME) {
      // the site bar identifies you and nothing else — actions live where the
      // action is (create in the library bar, admin behind its own link)
      el.innerHTML = '<a class="whoami" href="hall.html?me=1">' +
        (ME.avatar ? '<img src="' + ME.avatar + '" alt="">' : '') +
        '<b>' + ME.name + '</b></a>' +
        '<span class="whorating" title="your rating (private)">' + ME.rating + '</span>' +
        (ME.completedAll ? ' <span title="whole library cleared">🏆</span>' : '') +
        (ME.isAdmin ? ' <a class="whoadmin" href="admin.html">admin</a>' : '');
    } else {
      el.innerHTML = '<a class="whoami" href="/auth/discord">Sign in with Discord</a>';
    }
  }
  fetch('/api/me').then(function (r) { return r.json(); })
    .then(function (d) {
      ME = d.user; renderAuth();
      // The library may already have painted (700ms timer) before this
      // response arrived, and the paint only loads the review queue when it
      // already knows you are an admin — lose that race and the queue never
      // appears. Loading it here as well covers both orders; it is idempotent.
      if (ME && ME.isAdmin && document.getElementById('home') &&
          document.getElementById('home').classList.contains('show')) {
        loadReviewQueue();
      }
      // your account's unit-art choice wins over whatever this browser had
      if (ME && ME.unitArt && ME.unitArt !== ICON_STYLE) {
        ICON_STYLE = ME.unitArt;
        try { localStorage.setItem('owpuzzle-iconstyle', ICON_STYLE); } catch (e) {}
        if (window.__rerender) window.__rerender();
      }
      var onHome = document.getElementById('home') &&
        document.getElementById('home').classList.contains('show');
      if (onHome) loadCommunityPuzzles();
    }).catch(function () {});

  function loadCommunityPuzzles() {
    fetch('/api/puzzles').then(function (r) { return r.json(); }).then(function (d) {
      // fold the server's cross-device solved list into the library display
      var changed = false;
      (d.puzzles || []).forEach(function (x) {
        if (x.solvedByMe && !SERVER_SOLVED[x.slug]) { SERVER_SOLVED[x.slug] = true; changed = true; }
        if (x.perfectByMe && !SERVER_PERFECT[x.slug]) { SERVER_PERFECT[x.slug] = true; changed = true; }
        if (x.rating && SERVER_RATING[x.slug] !== x.rating) { SERVER_RATING[x.slug] = x.rating; changed = true; }
        if (x.band && SERVER_BAND[x.slug] !== x.band) { SERVER_BAND[x.slug] = x.band; changed = true; }
      });
      var ICONS0 = (typeof OWICONS !== 'undefined') ? OWICONS : {};
      var community = (d.puzzles || []).filter(function (x) { return x.status === 'approved'; });
      // assign BEFORE re-rendering — the library total counts these
      if (community.length !== COMMUNITY.length) changed = true;
      COMMUNITY = community;
      if (window.__firstPaint && !window.__painted) {
        window.__painted = true;
        window.__firstPaint();
      } else if (changed && window.__renderLibrary) {
        window.__renderLibrary();
        if (ME && ME.isAdmin) loadReviewQueue();   // the re-render drops it
      }
      if (!community.length) return;
      var home = document.getElementById('home');
      var sec = document.createElement('div');
      sec.innerHTML = '<h2 class="group">Community puzzles — by players like you</h2>';
      var grid = document.createElement('div');
      grid.className = 'grid';
      grid.innerHTML = community.map(function (x) {
        var pz = x.puzzle;
        var heroU = (pz.hero != null && pz.units[pz.hero]) ||
          pz.units.filter(function (u) { return u.player === 0; })[0];
        var hero = heroU && unitIcon(heroU.type);
        var foes = pz.units.filter(function (u) { return u.player === 1; }).map(function (u) {
          var ic = unitIcon(u.type);
          return ic ? '<img src="' + ic + '" alt="">' : '';
        }).join('');
        var cPe = null;
        try { cPe = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}')[x.slug]; } catch (e) {}
        var cDone = x.solvedByMe || !!(cPe && cPe.solved);
        var cPerf = x.perfectByMe || !!(cPe && cPe.perfect);
        return '<a class="card' + (cDone ? ' solved' : '') + '" href="?p=' + x.slug + '">' +
          (cDone ? '<span class="done">' + (cPerf ? '\u2b50' : '\u2713') + '</span>' : '') +
          (hero ? '<img class="hero" src="' + hero + '" alt="">' : '') +
          '<div class="body"><div class="card-head"><h3>' + esc(pz.name) + '</h3>' +
          '<span class="meta">' +
          (cDone && x.rating ? 'puzzle elo ' + x.rating + ' · ' : '') +
          'by ' + esc(x.author || '?') + '</span></div>' +
          '<p>' + esc(pz.brief || '') + '</p>' +
          '<div class="foes"><span class="vs">VS</span>' + foes + '</div></div></a>';
      }).join('');
      sec.appendChild(grid);
      home.appendChild(sec);
    }).catch(function () {});
  }

  // Every string that reaches innerHTML and did not originate in this file
  // goes through esc(). Community submissions are user content; a puzzle
  // named <img onerror=...> must render as text, not execute in the admin's
  // browser.
  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // the game displays strength / 10 (a 50-strength unit shows "5").
  // Shared scope: the review cards on the library page use it too, and a
  // swallowed ReferenceError here silently deleted the whole review queue.
  function fmt10(v) { return (v / 10).toFixed(1).replace(/\.0$/, ''); }

  function loadReviewQueue() {
    fetch('/api/review').then(function (r) { return r.json(); }).then(function (d) {
      var home = document.getElementById('home');
      var old = document.getElementById('review-queue');
      if (old) old.remove();                 // never stack a second copy
      if (!d.pending || !d.pending.length) return;
      var sec = document.createElement('div');
      sec.id = 'review-queue';
      sec.innerHTML = '<h2 class="group">Review queue — ' + d.pending.length + ' pending</h2>';
      var grid = document.createElement('div');
      grid.className = 'grid';
      d.pending.forEach(function (item) {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<div class="body"><div class="card-head"><h3>' + esc(item.puzzle.name) + '</h3>' +
          '<span class="meta">' + esc(item.puzzle.orders) + ' orders</span></div>' +
          '<p>by <b>' + esc(item.author || '?') + '</b> — ' + esc(item.puzzle.brief || '') + '</p>' +
          (item.solution ? '<p style="font-size:12.5px;color:var(--muted)">their line: <b>' +
            fmt10(item.solution.claimed ? item.solution.claimed.strength : 0) + ' STR</b> in ' +
            (item.solution.claimed ? item.solution.claimed.orders : '?') + ' orders · ' +
            (item.solution.line || []).length + ' actions</p>' : '') +
          '<div class="row" style="margin-top:8px;display:flex;gap:8px">' +
          '<a href="?p=' + item.slug + '"><button class="rated-btn" style="font-size:13px;padding:5px 12px">Play</button></a>' +
          (item.solution ? '<a href="?p=' + item.slug + '&review=1"><button class="rated-btn" ' +
            'style="font-size:13px;padding:5px 12px">Step their line</button></a>' : '') +
          '<button data-v="1" style="font-size:13px;padding:5px 12px">Approve</button>' +
          '<button data-v="0" style="font-size:13px;padding:5px 12px">Reject</button></div>';
        Array.prototype.forEach.call(card.querySelectorAll('[data-v]'), function (b) {
          b.addEventListener('click', function () {
            fetch('/api/review/' + item.slug, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ approve: b.dataset.v === '1' }),
            }).then(function (r) { return r.json(); }).then(function (res) {
              card.style.opacity = 0.4;
              card.querySelector('h3').textContent += ' — ' + res.status;
            });
          });
        });
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      home.insertBefore(sec, home.firstChild);
    }).catch(function (e) {
      // a silent catch here cost a day once — an undefined helper deleted the
      // whole queue with no trace. Log it; admins read consoles.
      console.error('review queue failed to render:', e);
    });
  }

  // SERVER_SOLVED: slugs this signed-in account has solved (from /api/puzzles)
  // — local progress is per-browser, the server knows across devices.
  var SERVER_SOLVED = {}, SERVER_PERFECT = {}, SERVER_RATING = {}, SERVER_BAND = {};
  // community puzzles shown on this page — counted in the library total so
  // the home count matches the Hall of Fame (which counts every live puzzle)
  var COMMUNITY = [];

  // ---------- library home ----------
  if (!puzzle && !remotePending) {
    document.getElementById('day-label').textContent = 'the library';
    document.getElementById('p-name').textContent = '';
    document.getElementById('p-brief').textContent =
      'Single-turn tactics puzzles. Find the winning line within your orders.';
    document.getElementById('main-row').style.display = 'none';
    document.querySelector('.hud').style.display = 'none';
    // every control row, not just the first — Reset lives on the second one
    // and has no business showing under the puzzle list
    Array.prototype.forEach.call(document.querySelectorAll('.controls'), function (c) {
      c.style.display = 'none';
    });
    var home = document.getElementById('home');
    home.classList.add('show');
    window.__renderLibrary = renderLibrary;
    var painted = false;
    window.__firstPaint = function () {
      if (painted) return;
      painted = true;
      window.__painted = true;   // the data-arrival path checks THIS flag
      renderLibrary();
      if (ME && ME.isAdmin) loadReviewQueue();
    };
    // the server is warm (~75ms), so waiting for the data avoids painting the
    // library twice; the timeout covers a slow or absent API
    setTimeout(window.__firstPaint, 700);
    return; // no game to run
  }

  function renderLibrary() {
    var home = document.getElementById('home');
    var ICONS0 = (typeof OWICONS !== 'undefined') ? OWICONS : {};
    var prog = {};
    try { prog = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}'); } catch (e) {}
    function isSolved(p) {
      var e = progEntry(prog, p);
      return (e && e.solved) || !!SERVER_SOLVED[p.id];
    }
    var communitySolved = COMMUNITY.filter(function (x) {
      var e = null;
      try { e = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}')[x.slug]; } catch (err) {}
      return x.solvedByMe || !!(e && e.solved);
    }).length;
    var solvedCount = OWPUZZLES.filter(isSolved).length + communitySolved;
    var libraryTotal = OWPUZZLES.length + COMMUNITY.length;
    var GROUPS = [
      { n: 1, title: 'Basics — one unit, one rule' },
      { n: 2, title: 'Tactics — combined arms' },
      { n: 3, title: 'Challenges — several rules at once' },
    ];
    // One library bar instead of four stacked centred sentences: where you
    // stand on the left, what you can do about it on the right.
    var cleared = solvedCount === libraryTotal && solvedCount > 0;
    var pct = libraryTotal ? Math.round(100 * solvedCount / libraryTotal) : 0;
    var actions = [];
    if (!cleared) {
      actions.push(ME
        ? '<button class="rated-btn" id="btn-rated">\u25b6 Play another</button>'
        : '<a class="rated-btn" href="/auth/discord">Sign in with Discord</a>');
    }
    actions.push('<a class="libact" href="editor.html">\u270e Create</a>');
    actions.push('<a class="libact" href="hall.html">\ud83c\udfc6 Hall of Fame</a>');
    // no "my achievements" link: your avatar in the site bar already goes to
    // your profile, and your profile IS the achievement gallery
    var html =
      '<div class="libbar">' +
        '<div class="libstat">' +
          '<div class="libcount">Solved <b>' + solvedCount + '</b> of ' + libraryTotal +
            (cleared ? ' \u2014 the whole library \u2694\ufe0f' : '') + '</div>' +
          '<div class="libmeter"><i style="width:' + pct + '%"></i></div>' +
        '</div>' +
        '<div class="libactions">' + actions.join('') + '</div>' +
      '</div>';
    GROUPS.forEach(function (g) {
      // group by MEASURED difficulty (the puzzle's own Elo band) and fall back
      // to the authored difficulty until ratings arrive
      var list = OWPUZZLES.filter(function (p) {
        return (SERVER_BAND[p.id] || p.difficulty || 2) === g.n;
      });
      if (!list.length) return;
      html += '<h2 class="group">' + g.title + '</h2><div class="grid">';
      html += list.map(function (p) {
        var pe = progEntry(prog, p);
        var done = isSolved(p);
        var perf = (pe && pe.perfect) || !!SERVER_PERFECT[p.id];
        var heroU = (p.hero != null && p.units[p.hero]) ||
          p.units.filter(function (u) { return u.player === 0; })[0];
        var hero = heroU && unitIcon(heroU.type);
        var foes = p.units.filter(function (u) { return u.player === 1; }).map(function (u) {
          var ic = unitIcon(u.type);
          return ic ? '<img src="' + ic + '" alt="">' : '';
        }).join('');
        return '<a class="card' + (done ? ' solved' : '') + '" href="?p=' + p.id + '">' +
          (done ? '<span class="done">' + (perf ? '\u2b50' : '\u2713') + '</span>' : '') +
          (hero ? '<img class="hero" src="' + hero + '" alt="">' : '') +
          '<div class="body"><div class="card-head"><h3>' + p.name + '</h3>' +
          '<span class="meta">' + (done && SERVER_RATING[p.id] ? 'puzzle elo ' + SERVER_RATING[p.id] : '') + '</span></div>' +
          '<p>' + p.brief + '</p>' +
          '<div class="foes"><span class="vs">VS</span>' + foes + '</div></div></a>';
      }).join('');
      html += '</div>';
    });
    home.innerHTML = html;
    var ratedBtn = document.getElementById('btn-rated');
    if (ratedBtn) ratedBtn.addEventListener('click', function () {
      var btn = this;
      fetch('/api/next').then(function (r) { return r.json(); }).then(function (d) {
        if (d.slug) location.href = '?p=' + d.slug;
        else btn.textContent = d.error || d.message || 'sign in with Discord first';
      }).catch(function () { btn.textContent = 'server not available'; });
    });
  }
  if (puzzle) boot(puzzle);

  function boot(bootPuzzle) {
  puzzle = bootPuzzle;
  document.getElementById('back-link').innerHTML = puzzle.id === 'draft'
    ? '<a href="editor.html">← back to the editor</a>'
    : '<a href="./">← all puzzles</a>';

  // ---------- state ----------
  var history = [];       // stack of states for undo
  var redoStack = [];     // states undone, available to redo
  var state = E.loadPuzzle(puzzle, { play: true });
  var selected = null;    // unit id
  var finished = false;
  var actionsUsed = 0;
  var lineLog = [];       // actions taken, replayed server-side for rating

  // ---------- board geometry (pointy-top axial) ----------
  var SIZE = 46;
  var SQ3 = Math.sqrt(3);
  function cx(t) { return SIZE * SQ3 * (t.q + t.r / 2); }
  function cy(t) { return SIZE * 1.5 * t.r; }
  function hexPoints(x, y) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 30);
      pts.push((x + SIZE * Math.cos(a)).toFixed(1) + ',' + (y + SIZE * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  // Visual language ported from owdeepanalysis (viewer/index.html:72-160):
  // dark ground, its exact terrain palette, banded hills, procedural trees,
  // owner-colored unit discs with the in-game icon on top.
  var BOARD_BG = '#0b0c0f';
  var TERRAIN_FILL = {
    TERRAIN_TEMPERATE: 'rgb(104,138,74)', TERRAIN_LUSH: 'rgb(74,110,56)',
    TERRAIN_ARID: 'rgb(170,148,95)', TERRAIN_SAND: 'rgb(206,184,120)',
    TERRAIN_TUNDRA: 'rgb(200,205,210)', TERRAIN_MARSH: 'rgb(96,110,80)',
    TERRAIN_WATER: 'rgb(26,52,92)', TERRAIN_URBAN: 'rgb(150,128,116)',
  };
  var PCOL = { 0: 'rgb(110,160,210)', 1: 'rgb(150,60,60)' }; // us blue, them dark red
  var ICONS = (typeof OWICONS !== 'undefined') ? OWICONS : {};
  function glyphFor(u) {
    var inf = E.DATA.units[u.type];
    return (inf.iRangeMax || 0) > 0 ? '🏹' : '⚔';
  }
  function prettyEffectName(e) {
    return e.replace('EFFECTUNIT_', '').toLowerCase().replace(/_/g, ' ');
  }
  function shortName(u) {
    return u.type.replace('UNIT_', '').replace(/_/g, ' ').toLowerCase();
  }

  // ---------- render ----------
  var wrap = document.getElementById('board-wrap');

  window.__rerender = function () { render(); };
  function render() {
    var tiles = Object.keys(state.tiles).map(function (k) { return state.tiles[k]; });
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    tiles.forEach(function (t) {
      minX = Math.min(minX, cx(t) - SIZE); maxX = Math.max(maxX, cx(t) + SIZE);
      minY = Math.min(minY, cy(t) - SIZE); maxY = Math.max(maxY, cy(t) + SIZE);
    });
    var pad = 6;
    var vb = (minX - pad) + ' ' + (minY - pad) + ' ' + (maxX - minX + 2 * pad) + ' ' + (maxY - minY + 2 * pad);
    var S = [];
    S.push('<svg viewBox="' + vb + '" xmlns="http://www.w3.org/2000/svg">');
    S.push('<defs></defs>');
    // dark ground behind the hex mosaic, as in the owdeepanalysis viewer
    S.push('<rect x="' + (minX - pad) + '" y="' + (minY - pad) + '" width="' + (maxX - minX + 2 * pad) +
      '" height="' + (maxY - minY + 2 * pad) + '" rx="10" fill="' + BOARD_BG + '"/>');

    var sel = selected != null ? E.unitById(state, selected) : null;
    var reach = (sel && !finished) ? E.reachableTiles(state, sel) : [];
    var targets = (sel && !finished) ? E.attackTargets(state, sel) : [];
    var reachKeys = {}; reach.forEach(function (t) { reachKeys[E.key(t.q, t.r)] = t; });
    var targetIds = {}; targets.forEach(function (t) { targetIds[t.id] = true; });
    // Spill damage (pierce / cleave / splash / circle) from the attack the
    // player is currently looking at — previewed on the bystanders it hits,
    // which the board never used to show.
    var collateralPreview = {};
    if (sel && !finished && previewFocus != null && targetIds[previewFocus]) {
      try {
        E.previewAttack(state, sel.id, previewFocus).collateral.forEach(function (c) {
          if (c.damage > 0) collateralPreview[c.id] = c.damage;
        });
      } catch (e) {}
    }
    var swapIds = {};
    if (sel && !finished) state.units.forEach(function (o) {
      if (o.player === 0 && E.canSwap(state, sel, o)) swapIds[o.id] = true;
    });
    // objective targets: strong red + skull marker; bystander enemies washed out
    var mustKill = {};
    state.units.forEach(function (o) {
      if (o.player !== 1) return;
      var ob = puzzle.objective;
      mustKill[o.id] = ob.kind === 'killAll' ||
        (ob.kind === 'killTarget' && ob.target === o.id) ||
        (ob.kind === 'killList' && ob.targets.indexOf(o.id) >= 0);
      if (ob.kind === 'maxKill') mustKill[o.id] = 'open'; // strong red, no skull
    });

    // tiles
    var clips = [];
    tiles.forEach(function (t) {
      var fill = TERRAIN_FILL[t.terrain] || 'rgb(90,90,90)';
      var x = cx(t), y = cy(t);
      if (t.height === 'HEIGHT_MOUNTAIN' || t.height === 'HEIGHT_VOLCANO') {
        fill = 'rgb(150,150,153)'; // desaturated, after lum()*0.6+26
      }
      var k = E.key(t.q, t.r);
      var cls = 'hex' + (reachKeys[k] ? ' reach' : '');
      S.push('<polygon class="' + cls + '" points="' + hexPoints(x, y) + '" fill="' + fill +
        '" stroke="' + BOARD_BG + '" stroke-width="1" data-t="' + t.q + ',' + t.r + '"' +
        (reachKeys[k] ? ' data-move="' + t.q + ',' + t.r + '"' : '') + '/>');

      // hills: light band over dark band, clipped to the hex (viewer :146-148)
      var needsClip = t.height === 'HEIGHT_HILL';
      if (needsClip) {
        var cid = 'clip' + t.q + '_' + t.r;
        clips.push('<clipPath id="' + cid + '"><polygon points="' + hexPoints(x, y) + '"/></clipPath>');
        S.push('<g clip-path="url(#' + cid + ')" pointer-events="none">' +
          '<rect x="' + (x - SIZE) + '" y="' + (y - SIZE) + '" width="' + (2 * SIZE) + '" height="' + (SIZE * 0.85) + '" fill="rgba(255,255,255,.16)"/>' +
          '<rect x="' + (x - SIZE) + '" y="' + (y + SIZE * 0.05) + '" width="' + (2 * SIZE) + '" height="' + SIZE + '" fill="rgba(0,0,0,.30)"/></g>');
      }
      // trees/jungle: procedural triangle+trunk (viewer :150-158)
      var jg = t.vegetation === 'VEGETATION_JUNGLE', fr = t.vegetation === 'VEGETATION_TREES';
      var sc = t.vegetation === 'VEGETATION_SCRUB';
      if (jg) {
        var cid2 = 'clipj' + t.q + '_' + t.r;
        clips.push('<clipPath id="' + cid2 + '"><polygon points="' + hexPoints(x, y) + '"/></clipPath>');
        S.push('<rect clip-path="url(#' + cid2 + ')" x="' + (x - SIZE) + '" y="' + (y - SIZE) + '" width="' + (2 * SIZE) + '" height="' + (2 * SIZE) + '" fill="rgba(6,44,10,.5)" pointer-events="none"/>');
      }
      if (sc) drawScrub(S, x, y, t.height === 'HEIGHT_HILL');
      else if (jg || fr) drawTrees(S, x, y, jg ? 3 : 2, t.height === 'HEIGHT_HILL',
        jg ? 'rgba(14,50,16,.95)' : 'rgba(24,68,26,.95)');
      if (t.city != null) {
        // city: double wall ring in owner color + hall glyph
        var cring = [];
        for (var ci = 0; ci < 6; ci++) {
          var ca = Math.PI / 180 * (60 * ci - 30);
          cring.push((x + SIZE * 0.86 * Math.cos(ca)).toFixed(1) + ',' + (y + SIZE * 0.86 * Math.sin(ca)).toFixed(1));
        }
        S.push('<polygon points="' + cring.join(' ') + '" fill="none" stroke="' + (PCOL[t.city] || '#999') + '" stroke-width="5" pointer-events="none"/>');
        S.push('<polygon points="' + cring.join(' ') + '" fill="none" stroke="' + BOARD_BG + '" stroke-width="1.5" stroke-dasharray="4 6" pointer-events="none"/>');
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.42) + '" text-anchor="middle" font-size="15" pointer-events="none">\ud83c\udfdb\ufe0f</text>');
      }
      if (t.improvement) {
        // draw improvements as an inset wall ring so they stay visible
        // under an occupying unit; fort gets crenellation ticks
        var ringPts = [];
        for (var ai = 0; ai < 6; ai++) {
          var aa = Math.PI / 180 * (60 * ai - 30);
          ringPts.push((x + SIZE * 0.82 * Math.cos(aa)).toFixed(1) + ',' + (y + SIZE * 0.82 * Math.sin(aa)).toFixed(1));
        }
        S.push('<polygon points="' + ringPts.join(' ') + '" fill="none" stroke="#c9b07a" stroke-width="4" pointer-events="none"/>');
        S.push('<polygon points="' + ringPts.join(' ') + '" fill="none" stroke="#6b5636" stroke-width="4" stroke-dasharray="6 7" pointer-events="none"/>');
      }
    });

    // territory: owner wash + hairline border on ownership-change edges
    tiles.forEach(function (t) {
      if (t.owner == null) return;
      var x = cx(t), y = cy(t);
      var oc = PCOL[t.owner] || 'rgb(120,120,120)';
      S.push('<polygon points="' + hexPoints(x, y) + '" fill="' + oc.replace('rgb', 'rgba').replace(')', ',0.14)') + '" pointer-events="none"/>');
      E.DIRS.forEach(function (d, di) {
        var n = E.tileAt(state, t.q + d.q, t.r + d.r);
        if (n && n.owner === t.owner) return;
        var a1 = Math.PI / 180 * (-60 * di - 30), a2 = Math.PI / 180 * (-60 * di + 30);
        S.push('<line x1="' + (x + SIZE * 0.97 * Math.cos(a1)) + '" y1="' + (y + SIZE * 0.97 * Math.sin(a1)) +
          '" x2="' + (x + SIZE * 0.97 * Math.cos(a2)) + '" y2="' + (y + SIZE * 0.97 * Math.sin(a2)) +
          '" stroke="' + oc + '" stroke-width="2" opacity="0.8" pointer-events="none"/>');
      });
    });

    // roads: brown segments from center toward each adjacent road tile
    tiles.forEach(function (t) {
      if (!t.road) return;
      var x = cx(t), y = cy(t);
      var any = false;
      E.DIRS.forEach(function (d) {
        var n = E.tileAt(state, t.q + d.q, t.r + d.r);
        if (!n || !n.road) return;
        any = true;
        var nx = cx(n), ny = cy(n);
        S.push('<line x1="' + x + '" y1="' + y + '" x2="' + ((x + nx) / 2) + '" y2="' + ((y + ny) / 2) +
          '" stroke="rgba(160,120,70,.9)" stroke-width="' + (SIZE * 0.16) + '" stroke-linecap="round" pointer-events="none"/>');
      });
      if (!any) S.push('<circle cx="' + x + '" cy="' + y + '" r="' + (SIZE * 0.14) + '" fill="rgba(160,120,70,.9)" pointer-events="none"/>');
    });

    // river edges (viewer :161-171 — bright blue segments on hex borders).
    // Neighbour d lies at pixel angle -60*d (DIRS order E,NE,NW,W,SW,SE in a
    // pointy-top layout), so the shared edge spans vertices at -60d +/- 30.
    tiles.forEach(function (t) {
      (t.river || []).forEach(function (d) {
        var x = cx(t), y = cy(t);
        var a1 = Math.PI / 180 * (-60 * d - 30), a2 = Math.PI / 180 * (-60 * d + 30);
        S.push('<line x1="' + (x + SIZE * Math.cos(a1)) + '" y1="' + (y + SIZE * Math.sin(a1)) +
          '" x2="' + (x + SIZE * Math.cos(a2)) + '" y2="' + (y + SIZE * Math.sin(a2)) +
          '" stroke="#4696eb" stroke-width="' + (SIZE * 0.2) + '" stroke-linecap="round"/>');
      });
    });

    // reach markers: drawn ABOVE roads/rivers/territory so they always read.
    // One click moves the whole way; the badge is the total order cost.
    reach.forEach(function (rt) {
      var x = cx(rt), y = cy(rt);
      if (rt.orders <= 1) {
        S.push('<circle cx="' + x + '" cy="' + y + '" r="6" fill="#ffffff" opacity="0.85" stroke="#14161c" stroke-width="0.8" pointer-events="none"/>');
      } else {
        S.push('<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + (rt.forced ? '#ffb020' : '#ffffff') + '" opacity="0.9" stroke="#14161c" stroke-width="0.8" pointer-events="none"/>');
        S.push('<text x="' + x + '" y="' + (y + 0.5) + '" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="bold" fill="#14161c" pointer-events="none">' + rt.orders + '</text>');
      }
    });

    // units: owner-color disc + in-game icon + HP bar (viewer :229-242)
    state.units.forEach(function (u) {
      if (u.hp <= 0) return;
      var t = { q: u.q, r: u.r };
      var x = cx(t), y = cy(t);
      var color = PCOL[u.player] || PCOL[1];
      if (u.player === 1 && !mustKill[u.id]) color = 'rgb(158,112,104)'; // not an objective
      var isSel = sel && sel.id === u.id;
      var isTarget = targetIds[u.id];
      var exhausted = u.player === 0 && !E.canAct(state, u) && !finished;
      S.push('<g class="unit-chip" data-unit="' + u.id + '"' + (exhausted ? ' opacity="0.55"' : '') + '>');
      if (isSel) S.push('<circle cx="' + x + '" cy="' + (y + SIZE * 0.08) + '" r="' + (SIZE * 0.72) + '" fill="none" stroke="#fff" stroke-width="3"/>');
      if (isTarget) S.push('<circle cx="' + x + '" cy="' + (y + SIZE * 0.08) + '" r="' + (SIZE * 0.72) + '" fill="none" stroke="#ffb020" stroke-width="3" stroke-dasharray="8 5"/>');
      S.push('<circle cx="' + x + '" cy="' + (y + SIZE * 0.24) + '" r="' + (SIZE * 0.52) + '" fill="' + color + '" stroke="' + BOARD_BG + '" stroke-width="1.6"/>');
      var ic = unitIcon(u.type);
      if (ic && isFlagIcon(u.type)) {
        // white silhouette sits ON the colored disc, like the game's flags
        S.push('<image href="' + ic + '" x="' + (x - SIZE * 0.32) + '" y="' + (y - SIZE * 0.08) + '" width="' + (SIZE * 0.64) + '" height="' + (SIZE * 0.64) + '" pointer-events="none"/>');
      } else if (ic) {
        S.push('<image href="' + ic + '" x="' + (x - SIZE * 0.4) + '" y="' + (y - SIZE * 0.16) + '" width="' + (SIZE * 0.8) + '" height="' + (SIZE * 0.8) + '" pointer-events="none"/>');
      } else {
        S.push('<text x="' + x + '" y="' + (y + SIZE * 0.24) + '" text-anchor="middle" dominant-baseline="middle" font-size="' + (SIZE * 0.55) + '" pointer-events="none">' + glyphFor(u) + '</text>');
      }
      var pv = isTarget ? E.previewAttack(state, sel.id, u.id) : null;
      // spill from the focused attack (pierce / cleave / splash / circle)
      var spill = collateralPreview[u.id];
      // HP pips, Old World style: two rows of boxes, one box per HP.
      // On attack preview, the boxes that would be lost turn red.
      drawHpPips(S, x, y, u.hp, E.hpMax(u), pv ? pv.damage : (spill || 0));
      // swap affordance: moving onto an adjacent friendly swaps — show a
      // tappable arrows badge on the ally's tile (no separate action needed)
      if (swapIds[u.id]) {
        S.push('<g data-swap="' + u.id + '" style="cursor:pointer">' +
          '<circle cx="' + (x - SIZE * 0.52) + '" cy="' + (y - SIZE * 0.34) + '" r="11" fill="#ffffff" stroke="' + BOARD_BG + '" stroke-width="1.4"/>' +
          '<text x="' + (x - SIZE * 0.52) + '" y="' + (y - SIZE * 0.34 + 1) + '" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="bold" fill="#14161c" pointer-events="none">\u21c4</text></g>');
      }
      // objective marker: skull above units that must die
      if (u.player === 1 && mustKill[u.id] === true) {
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.66) + '" text-anchor="middle" dominant-baseline="middle" font-size="14" pointer-events="none">\ud83c\udfaf</text>');
      }
      // statuses applied during the turn (disarmed = the game's broken sword)
      (u.applied || []).forEach(function (st, si) {
        var sic = ICONS['EFFECT_' + st.replace('EFFECTUNIT_', '')];
        var sx = x - SIZE * 0.46, sy = y + SIZE * 0.34 - si * 15;
        S.push('<circle cx="' + sx + '" cy="' + sy + '" r="9" fill="#b03030" stroke="' + BOARD_BG + '" stroke-width="1.2" pointer-events="none"/>');
        if (sic) S.push('<image href="' + sic + '" x="' + (sx - 7) + '" y="' + (sy - 7) + '" width="14" height="14" pointer-events="none"/>');
        else S.push('<text x="' + sx + '" y="' + (sy + 1) + '" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#fff">✗</text>');
      });
      // A general wears the game's own commander badge; a named leader wears
      // the badge for THAT leader type (commander/tactician/zealot/hero...),
      // which is the crowned icon the game itself uses.
      var leadEff = E.effectsOf(u).filter(function (e) { return /_LEADER$/.test(e); })[0];
      if (u.general || leadEff) {
        var gico = ICONS['EFFECT_' + String(leadEff || 'EFFECTUNIT_COMMANDER').replace('EFFECTUNIT_', '')] ||
                   ICONS['EFFECT_COMMANDER'];
        var gx = x - SIZE * 0.46, gy = y - SIZE * 0.34;
        if (gico) {
          S.push('<circle cx="' + gx + '" cy="' + gy + '" r="9" fill="#ffd23e" stroke="' + BOARD_BG + '" stroke-width="1.2" pointer-events="none"/>');
          S.push('<image href="' + gico + '" x="' + (gx - 7.5) + '" y="' + (gy - 7.5) + '" width="15" height="15" pointer-events="none"/>');
        }
      }
      // promotion badges: the promotion's in-game icon on a gold disc
      (u.promotions || []).filter(function (pr) { return !/_LEADER$/.test(pr); }).forEach(function (pr, pi) {
        var effName = (E.DATA.promotions[pr] && E.DATA.promotions[pr].effect) || pr;
        var pic = ICONS['EFFECT_' + effName.replace('EFFECTUNIT_', '')];
        var bx = x + SIZE * 0.46, by = y - SIZE * 0.36 + pi * 16;
        if (pic) {
          // dark disc with a gold rim: the game's promotion icons are light
          // silver and vanished on a solid gold coin, especially on phones
          S.push('<circle cx="' + bx + '" cy="' + by + '" r="9" fill="#3a2f1b" stroke="#ffd23e" stroke-width="1.6" pointer-events="none"/>');
          S.push('<image href="' + pic + '" x="' + (bx - 7) + '" y="' + (by - 7) + '" width="14" height="14" pointer-events="none"/>');
        } else {
          S.push('<text x="' + bx + '" y="' + by + '" text-anchor="middle" dominant-baseline="middle" font-size="14" fill="#ffd23e" stroke="' + BOARD_BG + '" stroke-width="2.5" paint-order="stroke" pointer-events="none">★</text>');
        }
      });
      // fatigue pips for blue
      if (u.player === 0) {
        var lim = E.fatigueLimit(u);
        for (var i = 0; i < lim; i++) {
          S.push('<circle cx="' + (x - (lim - 1) * 5.5 / 2 + i * 5.5) + '" cy="' + (y - SIZE * 0.72) + '" r="2.2" fill="' +
            (i < u.steps ? '#ffffff33' : '#ffb020') + '"/>');
        }
      }
      // damage preview on targets — the viewer's attack-flash language:
      // gold ⚔ for a hit, red ☠ for a kill (viewer :226-227)
      if (!pv && spill) {
        var sLabel = (spill >= u.hp ? '☠ ' : '✳ ') + '-' + spill;
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.62) + '" text-anchor="middle" font-size="13" font-family="system-ui" font-weight="bold" fill="' + (spill >= u.hp ? '#ff5040' : '#ffd23e') + '" stroke="' + BOARD_BG + '" stroke-width="3" paint-order="stroke" pointer-events="none">' + sLabel + '</text>');
      }
      if (pv) {
        var label = (pv.kills ? '☠ ' : '⚔ ') + '-' + pv.damage;
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.62) + '" text-anchor="middle" font-size="15" font-family="system-ui" font-weight="bold" fill="' + (pv.kills ? '#ff5040' : '#ffb020') + '" stroke="' + BOARD_BG + '" stroke-width="3" paint-order="stroke" pointer-events="none">' + label + '</text>');
      }
      S.push('</g>');
    });

    // ---- on-board counters (Discord request): orders and training in the
    // corner of the map itself, with the game's own yield icons, so you never
    // have to look away from the board to know what you can still spend.
    if (!finished) {
      var hudX = minX + 10, hudY = minY + 10;
      var oIco = ICONS['YIELD_ORDERS'], tIco = ICONS['YIELD_TRAINING'];
      var showTraining = (state.training || 0) > 0;
      var boxW = 62, boxH = showTraining ? 46 : 26;
      S.push('<g pointer-events="none">');
      S.push('<rect x="' + hudX + '" y="' + hudY + '" width="' + boxW + '" height="' + boxH +
        '" rx="7" fill="rgba(10,12,16,0.62)" stroke="#3a3d46" stroke-width="1"/>');
      if (oIco) S.push('<image href="' + oIco + '" x="' + (hudX + 5) + '" y="' + (hudY + 4) + '" width="17" height="17"/>');
      S.push('<text x="' + (hudX + 27) + '" y="' + (hudY + 13) + '" dominant-baseline="middle" font-size="14" font-weight="bold" font-family="system-ui" fill="#ffd9a0">' + state.orders + '</text>');
      if (showTraining) {
        if (tIco) S.push('<image href="' + tIco + '" x="' + (hudX + 5) + '" y="' + (hudY + 24) + '" width="17" height="17"/>');
        S.push('<text x="' + (hudX + 27) + '" y="' + (hudY + 33) + '" dominant-baseline="middle" font-size="14" font-weight="bold" font-family="system-ui" fill="#cfe3ff">' + state.training + '</text>');
      }
      S.push('</g>');
    }

    S.push('</svg>');
    if (clips.length) S[1] = '<defs>' + clips.join('') + '</defs>';
    wrap.innerHTML = S.join('');

    // wire events
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-move]'), function (el) {
      el.addEventListener('click', function () {
        var qr = el.getAttribute('data-move').split(',');
        act({ type: 'move', unit: selected, q: +qr[0], r: +qr[1] });
      });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-swap]'), function (el) {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (selected != null) act({ type: 'swap', unit: selected, target: +el.getAttribute('data-swap') });
      });
    });
    // hovering an empty tile shows its terrain card
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-t]'), function (el) {
      el.addEventListener('pointerenter', function () {
        if (!CAN_HOVER) return;
        var qr = el.getAttribute('data-t').split(',');
        if (!E.unitAt(state, +qr[0], +qr[1])) showTileInfo(+qr[0], +qr[1]);
      });
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-unit]'), function (el) {
      var uid = +el.getAttribute('data-unit');
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        onUnitTap(uid);
      });
      // hover (desktop): legal targets show the attack breakdown, anyone
      // else shows their unit card. Content persists until replaced — the
      // pane never collapses, so the layout never shifts under the cursor.
      el.addEventListener('pointerenter', function () {
        if (!CAN_HOVER) return;
        if (targetIds[uid]) {
          // focus this target so its pierce/cleave/splash spill is previewed
          if (previewFocus !== uid) { previewFocus = uid; render(); }
          showPreviewPanel(uid);
        } else showUnitInfo(uid);
      });
      el.addEventListener('pointerleave', function () {
        if (!CAN_HOVER || previewFocus !== uid) return;
        previewFocus = null; render();
      });
    });

    renderHud();
  }

  // ---------- attack preview panel (game-style breakdown) ----------
  var CAN_HOVER = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  var armedTarget = null; // touch: first tap arms + previews, second attacks
  var previewFocus = null; // the target under the cursor (or armed on touch)

  function modLines(mods) {
    return mods.map(function (m) {
      return '<div class="modline"><span>' + m.label + '</span>' +
        '<span class="v ' + (m.pct > 0 ? 'pos' : 'neg') + '">' +
        (m.pct > 0 ? '+' : '') + m.pct + '%</span></div>';
    }).join('');
  }

  function showPreviewPanel(defId) {
    if (selected == null || finished) return;
    var ex;
    try { ex = E.explainAttack(state, selected, defId); } catch (e) { return; }
    var attU = E.unitById(state, selected), defU = E.unitById(state, defId);
    var p = document.getElementById('preview-panel');
    function chip(u) {
      var ic = unitIcon(u.type);
      return (ic ? '<img class="p' + u.player + '" src="' + ic + '" alt="">' : '') +
        shortName(u);
    }
    p.innerHTML =
      '<h4>⚔ Attack Preview</h4>' +
      '<div class="vs">' +
      '<div class="col"><div class="who">' + chip(attU) + '</div>' +
      '<div class="big">' + fmt10(ex.att.total) + '</div>' +
      '<div class="modline"><span>base strength</span><span>' + fmt10(ex.att.base) + '</span></div>' +
      modLines(ex.att.mods) + '</div>' +
      '<div class="col"><div class="who">' + chip(defU) + '</div>' +
      '<div class="big">' + fmt10(ex.def.total) + '</div>' +
      '<div class="modline"><span>base strength</span><span>' + fmt10(ex.def.base) + '</span></div>' +
      modLines(ex.def.mods) + '</div>' +
      '</div><hr>' +
      '<div class="result"><span>Damage</span><b class="' + (ex.kills ? 'kill' : 'dmg') + '">' +
      ex.damage + (ex.kills ? ' ☠ kill' : '') + ' / ' + defU.hp + ' HP</b></div>' +
      '<div class="result"><span>Counterattack</span><b>' + ex.counter + '</b></div>' +
      (ex.collateral.length ? ex.collateral.map(function (c) {
        var v = E.unitById(state, c.id);
        return '<div class="result"><span>splash: ' + shortName(v) + '</span><b>' + c.damage + '</b></div>';
      }).join('') : '') +
      (ex.rout ? '<div class="note">Rout: advances and may attack again</div>' : '') +
      (armedTarget === defId && !CAN_HOVER ? '<div class="arm">tap again to attack</div>' : '');
    p.classList.add('show');
  }
  function hidePreviewPanel() {
    var pp = document.getElementById('preview-panel');
    if (pp) pp.onclick = null;
    var p = document.getElementById('preview-panel');
    p.classList.remove('show');
    p.innerHTML = '';
  }

  // ---------- unit card (hover any unit) ----------
  var TRAIT_NAMES = { UNITTRAIT_MELEE: 'melee', UNITTRAIT_RANGED: 'ranged', UNITTRAIT_INFANTRY: 'infantry', UNITTRAIT_MOUNTED: 'mounted', UNITTRAIT_POLEARM: 'polearm', UNITTRAIT_SIEGE: 'siege', UNITTRAIT_HORSE: 'horse', UNITTRAIT_CHARIOT: 'chariot', UNITTRAIT_ELEPHANT: 'elephant', UNITTRAIT_SHIP: 'ship' };
  var ATTACK_NAMES = { ATTACK_PIERCE: 'pierce (hits through target)', ATTACK_CLEAVE: 'cleave (hits beside target)', ATTACK_SPLASH: 'splash (hits around target)', ATTACK_CIRCLE: 'circle (hits all adjacent)' };

  // human-readable combat-relevant lines for one effect unit
  function describeEffect(e) {
    var d = E.DATA.effects[e];
    if (!d) return [];
    var out = [];
    if (d.iStrengthModifier) out.push(fmtPct(d.iStrengthModifier) + ' strength');
    if (d.iAttackModifier) out.push(fmtPct(d.iAttackModifier) + ' attack');
    if (d.iDefenseModifier) out.push(fmtPct(d.iDefenseModifier) + ' defense');
    if (d.bRout) out.push('rout: advances on kill, may strike again');
    if (d.bPush) out.push('panic: pushes a surviving defender back one tile');
    if (d.bStun) out.push('stuns the defender');
    if (d.bHealKill) out.push('heals fully when it kills');
    if (d.bLaunchOffensive) out.push('can launch an offensive');
    if (d.iActionsExtra) out.push('+' + d.iActionsExtra + ' action per turn');
    if (d.bLastStand) out.push('last stand: cannot be killed from above 1 HP');
    if (d.bIgnoresDistance) out.push('no ranged damage falloff with distance');
    if (d.bIgnoreZOC) out.push('ignores zones of control');
    (d.aeEffectUnitImmune || []).forEach(function (im) {
      out.push('immune to ' + im.replace('EFFECTUNIT_', '').toLowerCase());
    });
    ['aiUnitTraitModifier', 'aiUnitTraitModifierAttack', 'aiUnitTraitModifierDefense', 'aiUnitTraitModifierMelee'].forEach(function (f, i) {
      Object.keys(d[f] || {}).forEach(function (t) {
        var suffix = ['', ' attacking', ' defending', ' in melee'][i];
        out.push(fmtPct(d[f][t]) + ' vs ' + (TRAIT_NAMES[t] || t.replace('UNITTRAIT_', '').toLowerCase()) + suffix);
      });
    });
    Object.keys(d.aiAttackValue || {}).forEach(function (a) {
      var pct = (d.aiAttackPercent || {})[a] || 0;
      out.push(ATTACK_NAMES[a] + (pct ? ' at ' + pct + '%' : ''));
    });
    Object.keys(d.aiMeleeToClearTerrainTargetModifier || {}).forEach(function (t) {
      out.push(fmtPct(d.aiMeleeToClearTerrainTargetModifier[t]) + ' attacking open terrain');
    });
    Object.keys(d.aiTerrainFromModifier || {}).forEach(function (t) {
      out.push(fmtPct(d.aiTerrainFromModifier[t]) + ' fighting on ' + t.replace('TERRAIN_', '').toLowerCase());
    });
    Object.keys(d.aiHeightFromModifier || {}).forEach(function (t) {
      out.push(fmtPct(d.aiHeightFromModifier[t]) + ' fighting on ' + t.replace('HEIGHT_', '').toLowerCase() + 's');
    });
    Object.keys(d.aiVegetationFromModifier || {}).forEach(function (t) {
      out.push(fmtPct(d.aiVegetationFromModifier[t]) + ' fighting in ' + t.replace('VEGETATION_', '').toLowerCase());
    });
    if (d.iRiverAttackModifier) out.push(fmtPct(d.iRiverAttackModifier) + ' attacking across river');
    if (d.iFlankingAttackModifier) out.push(fmtPct(d.iFlankingAttackModifier) + ' flanking');
    if (d.iMeleeCounterPercent) out.push('counterattacks at ' + d.iMeleeCounterPercent + '% of attack');
    if (d.iDamagedThemModifier) out.push(fmtPct(d.iDamagedThemModifier) + ' vs damaged units');
    return out;
  }
  function fmtPct(v) { return (v > 0 ? '+' : '') + v + '%'; }

  // ---------- terrain description (shared by tile + unit cards) ----------
  function terrainName(t) {
    var bits = [];
    if (t.height === 'HEIGHT_MOUNTAIN' || t.height === 'HEIGHT_VOLCANO') bits.push('mountain');
    else if (t.height === 'HEIGHT_HILL') bits.push('hill');
    if (t.vegetation) bits.push(t.vegetation.replace('VEGETATION_', '').toLowerCase().replace('_', ' '));
    bits.push(t.terrain.replace('TERRAIN_', '').toLowerCase());
    if (t.city != null) bits.push(t.city === 0 ? 'your city' : 'enemy city');
    if (t.improvement) bits.push(t.improvement.replace('IMPROVEMENT_', '').toLowerCase());
    if (t.road) bits.push('road');
    return bits.join(' · ');
  }
  function terrainLines(t) {
    var out = [];
    var impassable = t.height === 'HEIGHT_MOUNTAIN' || t.height === 'HEIGHT_VOLCANO' ||
      t.terrain === 'TERRAIN_WATER';
    if (impassable) { out.push('impassable to land units'); return out; }
    var cost = (E.DATA.terrain[t.terrain] && E.DATA.terrain[t.terrain].iMovementCost) || 9;
    cost += (E.DATA.height[t.height] && E.DATA.height[t.height].iMovementCost) || 0;
    if (t.vegetation) cost += (E.DATA.vegetation[t.vegetation] && E.DATA.vegetation[t.vegetation].iMovementCost) || 0;
    if (t.road) cost = 6;
    out.push('movement cost: ' + (cost / 9).toFixed(1).replace('.0', '') + (cost === 9 ? ' move' : ' moves'));
    var veg = t.vegetation && E.DATA.vegetation[t.vegetation];
    if (veg && veg.aiDefendEffectUnit) {
      Object.keys(veg.aiDefendEffectUnit).forEach(function (e) {
        out.push('-' + veg.aiDefendEffectUnit[e] + '% for ' + e.replace('EFFECTUNIT_', '').toLowerCase() + ' attacks into this tile');
      });
    }
    if (t.improvement && E.DATA.improvements[t.improvement] && E.DATA.improvements[t.improvement].iDefenseModifier) {
      out.push('+' + E.DATA.improvements[t.improvement].iDefenseModifier + '% defense for the occupant');
    }
    if (t.owner != null && t.city == null) out.push((t.owner === 0 ? 'your' : 'enemy') + ' territory');
    if (t.city != null) out.push('cities are never inside enemy ZOC; hostile cities project ZOC');
    if (t.river && t.river.length) {
      out.push('river on ' + t.river.length + ' edge' + (t.river.length > 1 ? 's' : '') +
        ' (melee across a river: -50%; crossing costs extra movement)');
    }
    return out;
  }

  // Old World coordinates. The game's save format maps offset -> axial as
  // q = x + floor(y/2), r = -y, so we invert that; then shift so the
  // bottom-left tile of THIS board reads (0,0), as the game's minimap does.
  var COORD_ORIGIN = null;   // recomputed per board (see owCoord)
  function owCoord(q, r) {
    if (!COORD_ORIGIN) {
      var minX = Infinity, minY = Infinity;
      Object.keys(state.tiles).forEach(function (k) {
        var t = state.tiles[k];
        var y = -t.r, x = t.q - Math.floor(y / 2);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
      });
      COORD_ORIGIN = { x: minX, y: minY };
    }
    var y = -r, x = q - Math.floor(y / 2);
    return (x - COORD_ORIGIN.x) + ',' + (y - COORD_ORIGIN.y);
  }

  function showTileInfo(q, r) {
    var t = E.tileAt(state, q, r);
    if (!t) return;
    var p = document.getElementById('preview-panel');
    p.innerHTML =
      '<h4>Terrain <span style="margin-left:auto;font-size:11px;color:#b9b4a4;letter-spacing:0">(' +
        owCoord(q, r) + ')</span></h4>' +
      '<div class="who">' + terrainName(t) + '</div>' +
      terrainLines(t).map(function (l) { return '<div class="modline"><span>' + l + '</span></div>'; }).join('');
    p.classList.add('show');
  }

  function showUnitInfo(uid, compact) {
    var u = E.unitById(state, uid);
    if (!u || u.hp <= 0) return;
    var inf = E.DATA.units[u.type];
    var p = document.getElementById('preview-panel');
    var ic = unitIcon(u.type);
    // Community feedback (zophister, Aran): the full card on every selection
    // covered half the phone. Selecting now shows ONE SLIM ROW; tapping the
    // row expands the full card; tapping the expanded card collapses it back.
    // Selection is never affected by any of it.
    if (compact) {
      p.innerHTML =
        '<div class="who" style="margin:0">' +
        (ic ? '<img class="p' + u.player + '" src="' + ic + '" alt="">' : '') +
        shortName(u) +
        '<span style="margin-left:auto;font-weight:400;color:#b9b4a4">' +
        fmt10(inf.iStrength) + ' str · ' + u.hp + '/' + E.hpMax(u) + ' hp · ' +
        inf.iMovement + ' mv</span>' +
        '<span style="margin-left:8px;color:#ffb020">ⓘ</span></div>';
      p.classList.add('show');
      p.onclick = function () { showUnitInfo(uid); };   // expand on tap
      return;
    }
    p.onclick = function () { hidePreviewPanel(); };    // collapse on tap
    var promoNames = (u.promotions || []).map(function (pr) {
      var eff = (E.DATA.promotions[pr] && E.DATA.promotions[pr].effect) || pr;
      var nm = eff.replace(/^(EFFECTUNIT_|PROMOTION_)/, '').toLowerCase().replace(/_/g, ' ');
      var pic = ICONS['EFFECT_' + eff.replace('EFFECTUNIT_', '')];
      return (pic ? '<img src="' + pic + '" style="width:16px;height:16px;vertical-align:-3px"> ' : '★ ') + nm;
    });
    var lines = [];
    E.effectsOf(u).forEach(function (e) {
      var pic = ICONS['EFFECT_' + e.replace('EFFECTUNIT_', '')];
      // the game's own tooltip wording, so an ability reads the way it does
      // in Old World rather than in our paraphrase
      E.describeEffect(e).forEach(function (t) {
        lines.push((pic ? '<img src="' + pic + '" style="width:14px;height:14px;vertical-align:-2.5px;margin-right:3px">' : '') + t);
      });
    });
    if (inf.bZOC) lines.push('Exerts zone of control');
    var stateBits = [];
    (u.applied || []).forEach(function (st) {
      stateBits.push(prettyEffectName(st) + ' (' +
        (E.DATA.effects[st] && E.DATA.effects[st].iStrengthModifier
          ? E.DATA.effects[st].iStrengthModifier + '% strength' : 'status') + ')');
    });
    // Name the KIND of general: a commander flanks, a zealot heals on a kill,
    // a tactician stuns — "carries a general" alone tells you nothing.
    var leadEffects = E.effectsOf(u).filter(function (e) { return /_LEADER$/.test(e); });
    if (u.general || leadEffects.length) {
      var kinds = leadEffects.map(function (e) {
        return e.replace('EFFECTUNIT_', '').replace(/_LEADER$/, '')
          .replace('TRAIT_', '').toLowerCase().replace(/_/g, ' ');
      });
      stateBits.push(kinds.length
        ? 'carries a ' + kinds.join(' + ').toUpperCase() + ' general'
        : 'carries a GENERAL');
    }
    if (E.DATA.units[u.type].bUnlimber) {
      stateBits.push(u.unlimbered ? 'set up — ready to fire (-25% defense)' : 'packed up — must Set Up before firing');
    }
    if (u.cooldown === 'ROUT') stateBits.push('routing — may attack again');
    else if (u.cooldown) stateBits.push('done for this turn (' + u.cooldown.toLowerCase() + ')');
    if (u.steps > 0) stateBits.push('moved ' + u.steps + '/' + E.fatigueLimit(u) + ' steps');
    if (u.fortifyTurns > 0) stateBits.push('fortified ' + u.fortifyTurns + ' (+' + (u.fortifyTurns * 5) + '%)');
    p.innerHTML =
      '<h4>' + (u.player === 0 ? 'Your unit' : 'Enemy unit') +
        '<span style="margin-left:auto;font-size:11px;color:#b9b4a4;letter-spacing:0">(' +
        owCoord(u.q, u.r) + ')</span></h4>' +
      '<div class="who">' + (ic ? '<img class="p' + u.player + '" src="' + ic + '" alt="">' : '') +
      shortName(u) + '</div>' +
      (promoNames.length ? '<div class="note" style="color:#ffd23e;margin:0 0 4px">' + promoNames.join(' · ') + '</div>' : '') +
      '<div class="result"><span>Strength</span><b>' + fmt10(inf.iStrength) + '</b></div>' +
      '<div class="result"><span>Hit points</span><b>' + u.hp + ' / ' + E.hpMax(u) + '</b></div>' +
      '<div class="result"><span>Movement</span><b>' + inf.iMovement + '</b></div>' +
      ((inf.iRangeMax || 0) > 0 ? '<div class="result"><span>Range</span><b>' + inf.iRangeMax + '</b></div>' : '') +
      (lines.length ? '<hr>' + lines.map(function (t) { return '<div class="modline"><span>' + t + '</span></div>'; }).join('') : '') +
      (stateBits.length ? '<hr>' + stateBits.map(function (t) { return '<div class="note">' + t + '</div>'; }).join('') : '') +
      (function () {
        var tt = E.tileAt(state, u.q, u.r);
        if (!tt) return '';
        return '<hr><div class="modline"><span>standing on: <b>' + terrainName(tt) + '</b></span></div>' +
          terrainLines(tt).map(function (l) { return '<div class="modline"><span>' + l + '</span></div>'; }).join('');
      })();
    p.classList.add('show');
  }

  // Old World's unit health readout: two rows of boxes, one box per HP.
  // Filled = current HP; red = HP the previewed attack would remove;
  // dark = already lost. Fills COLUMN-MAJOR from the left: one column is a
  // "tick" of HEALTH_PER_TICK (2) HP, as in the game (ClientUI.cs:1961), so
  // 4 HP reads as a 2x2 block and 8 HP as 4x2.
  var HEALTH_PER_TICK = 2;
  function drawHpPips(S, x, y, hp, max, previewLoss) {
    var cols = Math.ceil(max / HEALTH_PER_TICK);
    var gap = 0.9, bw = (SIZE * 0.98 - gap * (cols - 1)) / cols, bh = 3.4;
    var x0 = x - (cols * bw + gap * (cols - 1)) / 2;
    var y0 = y + SIZE * 0.78;
    hp = Math.max(0, hp);
    for (var i = 0; i < max; i++) {
      var col = Math.floor(i / HEALTH_PER_TICK), row = i % HEALTH_PER_TICK;
      var fill;
      if (i < hp - previewLoss) fill = '#7fb069';
      else if (i < hp) fill = '#ff5040';
      else fill = 'rgba(0,0,0,.55)';
      S.push('<rect x="' + (x0 + col * (bw + gap)) + '" y="' + (y0 + row * (bh + 1)) +
        '" width="' + bw + '" height="' + bh + '" fill="' + fill +
        '" stroke="' + BOARD_BG + '" stroke-width="0.5" pointer-events="none"/>');
    }
  }

  // scrub: low rounded bushes, not trees
  function drawScrub(S, x, y, onHill) {
    var yb = y + (onHill ? -SIZE * 0.05 : SIZE * 0.3);
    var spots = [[-0.34, 0], [0, 0.12], [0.34, -0.02], [0.16, -0.3]];
    spots.forEach(function (sp) {
      var bx = x + SIZE * sp[0], by = yb + SIZE * sp[1];
      S.push('<ellipse cx="' + bx + '" cy="' + by + '" rx="' + (SIZE * 0.14) + '" ry="' + (SIZE * 0.09) +
        '" fill="rgba(110,122,63,.95)" stroke="rgba(50,56,26,.6)" stroke-width="1" pointer-events="none"/>');
    });
  }

  // procedural trees, geometry lifted from owdeepanalysis viewer :152-158:
  // n trees in a row at the bottom of the hex, trunk rect + triangle canopy
  function drawTrees(S, x, y, n, onHill, color) {
    var tw = SIZE * 0.26, th = SIZE * 0.62;
    var yb = y + (onHill ? -SIZE * 0.12 : SIZE * 0.24);
    for (var k = 0; k < n; k++) {
      var X = x + (k - (n - 1) / 2) * (tw * 1.25);
      S.push('<rect x="' + (X - tw * 0.16) + '" y="' + (yb - th * 0.18) + '" width="' + (tw * 0.32) + '" height="' + (th * 0.34) + '" fill="rgba(60,40,20,.9)" pointer-events="none"/>');
      S.push('<path d="M ' + X + ' ' + (yb - th) + ' L ' + (X - tw) + ' ' + yb + ' L ' + (X + tw) + ' ' + yb + ' Z" fill="' + color + '" pointer-events="none"/>');
    }
  }

  function decorate(S, x, y, glyph) {
    S.push('<text x="' + x + '" y="' + y + '" text-anchor="middle" dominant-baseline="middle" font-size="' + (SIZE * 0.5) + '" pointer-events="none" opacity="0.85">' + glyph + '</text>');
  }

  function renderHud() {
    var used = E.poolOrders(puzzle) - state.orders;
    var hudLine = '<span class="pill">\ud83d\udcdc Orders <b>' + used + '</b>/' +
      E.poolOrders(puzzle) + '</span>';
    if (puzzle.objective.kind === 'maxKill') {
      hudLine += '<span class="pill str-killed">\u2620 <b>' +
        fmt10(E.strKilledOf(state)) + '</b> STR destroyed</span>';
    }
    hudLine += '<span class="hud-hint">spend as few as you can</span>';
    document.getElementById('orders-pips').innerHTML = hudLine;
    var tr = document.getElementById('training-span');
    tr.style.display = '';
    tr.innerHTML = '<span class="pill">\ud83d\udee1 Training <b>' + state.training + '</b></span>';
    var selU = selected != null ? E.unitById(state, selected) : null;
    var bu2 = document.getElementById('btn-undo');
    if (bu2) bu2.disabled = !history.length;
    var br = document.getElementById('btn-redo');
    if (br) br.disabled = !redoStack.length;
    var bm = document.getElementById('btn-march');
    bm.style.display = (selU && !finished && E.canMarch(state, selU) && selU.steps >= E.fatigueLimit(selU)) ? '' : 'none';
    var bu = document.getElementById('btn-setup');
    bu.style.display = (selU && !finished && E.canUnlimber(state, selU)) ? '' : 'none';
    var be = document.getElementById('btn-endturn');
    // A draft always needs an explicit End Turn: the author has to be able to
    // finish and record their line whatever the objective is, including one
    // they have not met. Without it a killAll draft simply strands them.
    be.style.display =
      ((puzzle.objective.kind === 'maxKill' || puzzle.id === 'draft') && !finished) ? '' : 'none';

    var st = document.getElementById('status');
    if (finished) { st.textContent = ''; return; }
    var sel = selected != null ? E.unitById(state, selected) : null;
    if (sel) {
      var pvs = E.attackTargets(state, sel);
      var msg = shortName(sel) + ' selected — tap any highlighted tile to move there in one go (numbers = orders)' +
        (pvs.length ? ', or a marked enemy to attack' : '');
      if (E.canMove(state, sel) && E.nextStepOrderCost(sel) > 1) {
        msg += '. FATIGUED: further moves are a FORCE MARCH costing 2 orders each (orange dots).';
      }
      if (E.DATA.units[sel.type].bUnlimber && !sel.unlimbered) {
        msg = shortName(sel) + ' is PACKED UP — setting up ends its turn, so it cannot fire until next turn.';
      }
      st.textContent = msg;
    } else {
      st.textContent = 'Tap one of your (blue) units.';
    }
  }

  // ---------- interaction ----------
  function onUnitTap(id) {
    if (finished) return;
    var u = E.unitById(state, id);
    if (u.player === 0) {
      selected = (selected === id) ? null : id;
      armedTarget = null;
      previewFocus = null;
      hidePreviewPanel();
      render();
      // touch has no hover: selecting a unit is the only gesture there is,
      // so it doubles as "tell me about this unit" — but slim, so the card
      // does not bury the map (tap the strip for the full card)
      if (!CAN_HOVER && selected != null) showUnitInfo(id, true);
      return;
    }
    // enemy: attack if selected unit can. On touch (no hover), the first tap
    // shows the breakdown and arms the target; the second tap strikes.
    if (selected != null) {
      var can = E.attackTargets(state, E.unitById(state, selected)).some(function (t) { return t.id === id; });
      if (!can) {
        // not a legal target — on touch, show the unit's info card instead
        // (there is no hover on mobile)
        if (!CAN_HOVER) showUnitInfo(id);
        return;
      }
      if (!CAN_HOVER && armedTarget !== id) {
        armedTarget = id;
        previewFocus = id;      // touch has no hover: arming IS the preview
        render();
        showPreviewPanel(id);
        return;
      }
      act({ type: 'attack', unit: selected, target: id });
    } else if (!CAN_HOVER) {
      // nothing selected: on touch, a tap on an enemy opens its info card
      showUnitInfo(id);
    }
  }

  function act(a) {
    try {
      history.push(state);
      redoStack.length = 0;         // a fresh action forks off the redo branch
      var keepSel = a.unit;
      state = E.applyAction(state, a);
      lineLog.push(a);
      actionsUsed++;
      armedTarget = null;
      previewFocus = null;
      hidePreviewPanel();
      var u = E.unitById(state, keepSel);
      selected = (u && u.hp > 0 && E.canAct(state, u)) ? keepSel : null;
      checkEnd();
      render();
    } catch (e) {
      history.pop();
      document.getElementById('status').textContent = e.message;
    }
  }

  function checkEnd() {
    if (finished) return;   // redoing the final action must not re-run finish()
    if (puzzle.objective.kind === 'maxKill') {
      // the player declares the turn over (End Turn) — or runs out of actions
      if (state.orders <= 0 || E.legalActions(state).length === 0) endTurnMaxKill();
      return;
    }
    var met = E.checkObjective(state, puzzle.objective);
    if (met) { finish(true); return; }
    if (state.orders <= 0 || E.legalActions(state).length === 0) finish(false);
  }

  function endTurnMaxKill() {
    finish(E.checkObjective(state, puzzle.objective));
  }

  // ---------- achievement unlock celebration ----------
  // Cards fly in one after another with a burst of gold sparks; tap to
  // dismiss, or they retire themselves. Respects prefers-reduced-motion.
  function celebrate(list) {
    var wrap = document.getElementById('achv-pop');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'achv-pop';
      document.body.appendChild(wrap);
    }
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    list.forEach(function (a, i) {
      setTimeout(function () {
        var card = document.createElement('div');
        card.className = 'achv-card';
        card.innerHTML =
          '<div class="achv-ico">' + a.icon + '</div>' +
          '<div><div class="achv-head">Achievement unlocked</div>' +
          '<div class="achv-name">' + a.name + '</div>' +
          '<div class="achv-desc">' + a.desc + '</div></div>';
        wrap.appendChild(card);
        if (!calm) {
          // gold sparks bursting from the medal
          for (var k = 0; k < 14; k++) {
            var sp = document.createElement('i');
            sp.className = 'achv-spark';
            var ang = (Math.PI * 2 * k) / 14, dist = 34 + (k % 4) * 11;
            sp.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(1) + 'px');
            sp.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(1) + 'px');
            sp.style.animationDelay = (k * 12) + 'ms';
            card.appendChild(sp);
          }
        }
        card.addEventListener('click', function () { retire(card); });
        setTimeout(function () { retire(card); }, 6000);
      }, i * 900);
    });
    function retire(card) {
      if (card.classList.contains('gone')) return;
      card.classList.add('gone');
      setTimeout(function () { card.remove(); }, 450);
    }
  }

  function finish(won) {
    finished = true;
    selected = null;
    var r = document.getElementById('result');
    r.classList.add('show');
    document.getElementById('result-title').textContent = won ? '⚔️ Victory!' : '💀 Not this time';
    // Only offer the button when there IS another puzzle, and name it for
    // what it does: signed in there is no fixed order (the rated queue picks),
    // so "another"; signed out we really do walk the library in order.
    var nextBtn = document.getElementById('btn-next');
    nextBtn.style.display = 'none';
    window.__nextSlug = null;
    // Ask for the next puzzle only AFTER this solve has been recorded, or the
    // queue does not yet know you have beaten this one and hands it straight
    // back. `exclude` covers the case where the write is still settling.
    window.__offerNext = function () {
      fetch('/api/next?exclude=' + encodeURIComponent(puzzle.id))
        .then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.slug && d.slug !== puzzle.id) {
            window.__nextSlug = d.slug;
            nextBtn.textContent = 'Play another puzzle ▶';
            nextBtn.style.display = '';
          }
        }).catch(function () {});
    };
    if (puzzle.id === 'draft') {
      // a draft has nowhere to go next: the author wants their editor back,
      // whether or not the line they just played met the objective
      nextBtn.textContent = '← back to the editor';
      nextBtn.style.display = '';
    } else if (won) {
      if (ME) {
        // deliberately not called here — see the attempt POST below
      } else {
        var cand = nextUnsolvedLocal();
        if (cand) {
          window.__nextSlug = cand;
          nextBtn.textContent = 'Next puzzle ▶';
          nextBtn.style.display = '';
        }
      }
    }
    var used = E.poolOrders(puzzle) - state.orders;
    var perfect = won && used <= puzzle.orders;
    // Record the author's line FIRST. The maxKill branch below returns early
    // for a draft (it has no ceiling to judge against yet), and everything
    // after that return was being skipped — including this. An author would
    // play their line, end the turn, and find nothing had been recorded.
    if (puzzle.id === 'draft') {
      // the author's own play of their puzzle IS the claimed solution
      try {
        localStorage.setItem('owpuzzle-draft-solution', JSON.stringify({
          // Store the board that was actually played, not only its
          // fingerprint. Comparing two hash strings means trusting that the
          // player page and the editor page are running the same vintage of
          // the code — one stale cached file and the author is told they
          // changed a puzzle they never touched.
          puzzle: puzzle,
          v: puzzleHash(puzzle),
          line: lineLog,
          orders: E.poolOrders(puzzle) - state.orders,
          strength: E.strKilledOf(state),
          kills: E.killsOf(state),
          met: E.checkObjective(state, puzzle.objective),
        }));
      } catch (e) {}
      // …and lodge a copy with the server, so a browser that cannot keep
      // localStorage does not silently lose the author's line
      if (ME) {
        fetch('/api/draft-solution', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            puzzle: puzzle, line: lineLog,
            orders: E.poolOrders(puzzle) - state.orders,
            strength: E.strKilledOf(state), kills: E.killsOf(state),
            met: E.checkObjective(state, puzzle.objective),
          }),
        }).catch(function () {});
      }
    }

    var blueDmg = state.units.filter(function (u) { return u.player === 0; })
      .reduce(function (s, u) { return s + (E.hpMax(u) - Math.max(0, u.hp)); }, 0);
    var body;
    if (puzzle.objective.kind === 'maxKill') {
      var killStr = E.strKilledOf(state);
      var kills = E.killsOf(state);
      if (!puzzle.objective.count) {
        // draft test-play: the ceiling is computed at review, so the game
        // cannot judge "maximum" — report the tally without a verdict.
        document.getElementById('result-title').textContent = '⚔️ Turn complete';
        document.getElementById('result-body').textContent =
          'You destroyed ' + kills + ' unit' + (kills === 1 ? '' : 's') + ' (' + fmt10(killStr) +
          ' strength) in ' + used + ' orders. ' +
          (puzzle.id === 'draft'
            ? 'The target ceiling is set during review — this draft cannot score itself.'
            : 'This submission has no ceiling yet — it is set when the puzzle is approved.');
        window.__perfect = false; window.__won = false;
        return;
      }
      if (won) {
        body = '\u2b50 MAXIMUM DESTRUCTION \u2014 ' + kills + ' kills, ' + fmt10(killStr) +
          ' strength: the most possible!' +
          (perfect ? ' And in the fewest orders (' + used + '). \u2b50' : ' (' + used + ' orders \u2014 it can be done in fewer\u2026)') +
          ' Damage taken: ' + blueDmg + '.';
      } else {
        body = 'You destroyed ' + kills + ' unit' + (kills === 1 ? '' : 's') + ' (' + fmt10(killStr) +
          ' strength) \u2014 more destruction is possible\u2026 Study the field and try again.';
      }
    } else {
      body = won
        ? (perfect
          ? '\u2b50 PERFECT \u2014 solved in ' + used + ' orders, the fewest possible! Damage taken: ' + blueDmg + '.'
          : 'Solved in ' + used + ' orders \u2014 but it can be done in fewer\u2026 Damage taken: ' + blueDmg + '.')
        : 'The objective was not met. Study the field and try again.';
    }
    document.getElementById('result-body').textContent = body;
    window.__perfect = perfect;
    document.getElementById('result-lesson').textContent = won && puzzle.lesson ? puzzle.lesson : '';
    window.__won = won;
    if (ME && puzzle.id !== 'draft') {
      fetch('/api/attempt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: puzzle.id, line: lineLog }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (typeof d.ratingDelta === 'number' && d.rated) {
          var b = document.getElementById('result-body');
          b.textContent += ' Rating ' + (d.ratingDelta >= 0 ? '+' : '') + d.ratingDelta +
            ' → ' + d.user.rating + '.';
          ME = d.user; renderAuth();
        }
        // the puzzle's own Elo is disclosed only once you have beaten it
        if (d.solved && d.puzzleRating) {
          var rb = document.getElementById('result-body');
          rb.textContent += ' This puzzle is rated ' + d.puzzleRating + '.';
        }
        if (d.unlocked && d.unlocked.length) celebrate(d.unlocked);
        if (won && window.__offerNext) window.__offerNext();
      }).catch(function () { if (won && window.__offerNext) window.__offerNext(); });
    }
    if (won) {
      try {
        var prog = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}');
        var used2 = E.poolOrders(puzzle) - state.orders;
        var prev = progEntry(prog, puzzle) || {};
        if (!prev.solved || used2 < prev.orders) {
          prog[puzzle.id] = { solved: true, orders: Math.min(used2, prev.orders || 99),
            perfect: !!(prev.perfect || window.__perfect), ts: Date.now(),
            v: puzzleHash(puzzle) };
          localStorage.setItem('owpuzzle-progress', JSON.stringify(prog));
        } else if (window.__perfect && !prev.perfect) {
          prev.perfect = true;
          localStorage.setItem('owpuzzle-progress', JSON.stringify(prog));
        }
      } catch (e) {}
    }
  }

  // ---------- controls ----------
  document.getElementById('btn-undo').addEventListener('click', function () {
    if (!history.length) return;
    redoStack.push({ state: state, action: lineLog[lineLog.length - 1] });
    state = history.pop();
    lineLog.pop();
    actionsUsed--;
    finished = false;
    selected = null;
    armedTarget = null;
    previewFocus = null;
    hidePreviewPanel();
    document.getElementById('result').classList.remove('show');
    render();
  });
  document.getElementById('btn-redo').addEventListener('click', function () {
    if (!redoStack.length) return;
    var step = redoStack.pop();
    history.push(state);
    state = step.state;
    if (step.action) lineLog.push(step.action);
    actionsUsed++;
    selected = null;
    armedTarget = null;
    previewFocus = null;
    hidePreviewPanel();
    checkEnd();
    render();
  });
  document.getElementById('btn-endturn').addEventListener('click', function () {
    if (!finished) endTurnMaxKill();
  });

  document.getElementById('btn-march').addEventListener('click', function () {
    if (selected != null) act({ type: 'march', unit: selected });
  });
  document.getElementById('btn-setup').addEventListener('click', function () {
    if (selected != null) act({ type: 'unlimber', unit: selected });
  });

  document.getElementById('btn-reset').addEventListener('click', reset);
  document.getElementById('btn-again').addEventListener('click', reset);
  function reset() {
    state = E.loadPuzzle(puzzle, { play: true });
    history = [];
    lineLog = [];
    selected = null;
    finished = false;
    actionsUsed = 0;
    armedTarget = null;
    previewFocus = null;
    hidePreviewPanel();
    document.getElementById('result').classList.remove('show');
    render();
  }

  // next unsolved puzzle in DISPLAY order (Basics -> Tactics -> Challenges),
  // for anonymous play where an ordering genuinely exists
  function nextUnsolvedLocal() {
    var prog = {};
    try { prog = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}'); } catch (e) {}
    var list = [];
    [1, 2, 3].forEach(function (d) {
      OWPUZZLES.forEach(function (p) { if ((p.difficulty || 2) === d) list.push(p); });
    });
    var idx = list.indexOf(list.filter(function (p) { return p.id === puzzle.id; })[0]);
    for (var i = 1; i <= list.length; i++) {
      var cand = list[(idx + i) % list.length];
      var ce = progEntry(prog, cand);
      if (!(ce && ce.solved)) return cand.id;
    }
    return null;
  }

  // ---------- reviewing an author's line ----------
  // ?review=1 on a pending puzzle walks their recorded solution one action at
  // a time, so a reviewer can watch the idea rather than reconstruct it.
  if (params.get('review')) {
    fetch('/api/review').then(function (r) { return r.json(); }).then(function (d) {
      var item = ((d && d.pending) || []).filter(function (x) { return x.slug === puzzle.id; })[0];
      if (!item || !item.solution || !item.solution.line) return;
      var line = item.solution.line, at = 0;
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
        var a = line[at];
        var what = at >= line.length ? 'line complete'
          : (at + 1) + ' of ' + line.length + ': ' +
            (a.type === 'move' ? 'move to (' + a.q + ',' + a.r + ')'
              : a.type + (a.target != null ? ' →' : ''));
        document.getElementById('rv-at').textContent = what +
          '  ·  ' + fmt10(E.strKilledOf(state)) + ' STR destroyed, ' +
          (E.poolOrders(puzzle) - state.orders) + ' orders';
      }
      function step() {
        if (at >= line.length) return false;
        try { act(line[at]); } catch (e) { document.getElementById('rv-at').textContent =
          'step ' + (at + 1) + ' would not replay: ' + e.message; return false; }
        at++; label(); return true;
      }
      document.getElementById('rv-step').onclick = step;
      document.getElementById('rv-back').onclick = function () {
        if (at === 0) return;
        document.getElementById('btn-undo').click();
        at--; label();
      };
      document.getElementById('rv-all').onclick = function () {
        var guard = 0;
        while (step() && guard++ < 500) { /* to the end */ }
      };
      document.getElementById('rv-reset').onclick = function () { location.reload(); };
      // the verdict belongs where the evidence is — no trip back to the queue
      function verdict(approve) {
        fetch('/api/review/' + puzzle.id, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approve: approve }),
        }).then(function (r) { return r.json(); }).then(function (res) {
          document.getElementById('rv-verdict').textContent = res.status +
            (res.status === 'approved' ? ' — it is live' : '');
          document.getElementById('rv-approve').disabled = true;
          document.getElementById('rv-reject').disabled = true;
        }).catch(function () {
          document.getElementById('rv-verdict').textContent = 'could not reach the server';
        });
      }
      document.getElementById('rv-approve').onclick = function () { verdict(true); };
      document.getElementById('rv-reject').onclick = function () { verdict(false); };
      label();
    }).catch(function () {});
  }

  document.getElementById('btn-next').addEventListener('click', function () {
    if (puzzle.id === 'draft') { location.href = 'editor.html'; return; }
    if (window.__nextSlug) { location.href = '?p=' + window.__nextSlug; return; }
    location.href = './';
  });
  document.getElementById('btn-share').addEventListener('click', function () {
    var used = E.poolOrders(puzzle) - state.orders;
    var txt = 'Old World Combat Puzzle — ' + puzzle.name + '\n' +
      (window.__won ? '⚔️ Solved in ' + used + '/' + puzzle.orders + ' orders' : '💀 Unsolved') +
      '\n' + location.origin + location.pathname + '?p=' + puzzle.id;
    if (navigator.share) navigator.share({ text: txt }).catch(function () {});
    else if (navigator.clipboard) {
      navigator.clipboard.writeText(txt);
      this.textContent = 'Copied!';
    }
  });

  // ---------- header ----------
  // A community puzzle is not in the core list, so it has no "N of M" number —
  // it has an author, and that is what belongs in the header instead.
  var pnum = OWPUZZLES.indexOf(puzzle) + 1;
  var isCore = pnum > 0;
  var dayEl = document.getElementById('day-label');
  dayEl.textContent = isCore ? 'puzzle ' + pnum + ' of ' + OWPUZZLES.length : 'community puzzle';
  // the offline count knows only the core set; the library is core + community,
  // so number this puzzle within the whole thing once the server answers
  fetch('/api/puzzles').then(function (r) { return r.json(); }).then(function (d) {
    var list = (d && d.puzzles) || [];
    if (!list.length) return;
    var i = list.findIndex(function (x) { return x.slug === puzzle.id; });
    dayEl.textContent = i >= 0 ? 'puzzle ' + (i + 1) + ' of ' + list.length : 'community puzzle';
  }).catch(function () {});
  var byEl = document.getElementById('p-author');
  if (!isCore && puzzle.author) {
    var prof = 'hall.html?u=' + encodeURIComponent(puzzle.author);
    var safe = esc(puzzle.author);
    byEl.innerHTML = 'a puzzle by <a href="' + prof + '">' + safe + '</a>';
    // their Discord portrait, if the server knows it — credit with a face on it
    fetch('/api/profile?name=' + encodeURIComponent(puzzle.author))
      .then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.player && d.player.avatar) {
          byEl.innerHTML = 'a puzzle by <a href="' + prof + '">' +
            '<img src="' + d.player.avatar + '" alt="">' + safe + '</a>';
        }
      }).catch(function () {});
  }
  document.getElementById('p-name').textContent = puzzle.name;
  document.getElementById('p-brief').textContent = puzzle.brief;
  document.getElementById('library').innerHTML = '';

  render();
  } // end boot
})();
