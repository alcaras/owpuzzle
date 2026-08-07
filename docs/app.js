location.replace('https://owpuzzle.fly.dev/' + location.search + location.hash);
// UI: SVG hex board + interaction for one-turn puzzles.
(function () {
  'use strict';
  var E = OWENGINE;

  // ---------- puzzle selection: library home, ?p=<id> to play ----------
  var params = new URLSearchParams(location.search);
  var puzzle = null;
  if (params.get('draft')) {
    try { puzzle = JSON.parse(localStorage.getItem('owpuzzle-draft')); } catch (e) {}
  } else if (params.get('p')) {
    puzzle = OWPUZZLES.filter(function (p) { return p.id === params.get('p'); })[0];
    if (!puzzle) {
      // community puzzle: fetch from the server, then boot
      fetch('/api/puzzle/' + encodeURIComponent(params.get('p')))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.puzzle) { d.puzzle.id = d.slug; boot(d.puzzle); }
          else document.getElementById('p-brief').textContent = d.error || 'puzzle not found';
        })
        .catch(function () { document.getElementById('p-brief').textContent = 'could not load puzzle'; });
    }
  }

  // ---------- auth widget (works on every page) ----------
  var ME = null;
  function renderAuth() {
    var el = document.getElementById('auth-widget');
    if (!el) return;
    if (ME) {
      el.innerHTML = '<b>' + ME.name + '</b> · rating <b>' + ME.rating + '</b>' +
        ' · <a href="editor.html">✎ create a puzzle</a>' +
        (ME.completedAll ? ' 🏆' : '');
    } else {
      el.innerHTML = '<a href="/auth/discord">Sign in with Discord</a> <span class="hint">to get rated & submit puzzles</span>';
    }
  }
  fetch('/api/me').then(function (r) { return r.json(); })
    .then(function (d) {
      ME = d.user; renderAuth();
      if (ME && ME.isAdmin && document.getElementById('home') &&
          document.getElementById('home').classList.contains('show')) loadReviewQueue();
    }).catch(function () {});

  function loadReviewQueue() {
    fetch('/api/review').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.pending || !d.pending.length) return;
      var home = document.getElementById('home');
      var sec = document.createElement('div');
      sec.innerHTML = '<h2 class="group">Review queue — ' + d.pending.length + ' pending</h2>';
      var grid = document.createElement('div');
      grid.className = 'grid';
      d.pending.forEach(function (item) {
        var card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = '<div class="body"><div class="card-head"><h3>' + item.puzzle.name + '</h3>' +
          '<span class="meta">' + item.puzzle.orders + ' orders</span></div>' +
          '<p>by <b>' + (item.author || '?') + '</b> — ' + (item.puzzle.brief || '') + '</p>' +
          '<div class="row" style="margin-top:8px;display:flex;gap:8px">' +
          '<a href="?p=' + item.slug + '"><button class="rated-btn" style="font-size:13px;padding:5px 12px">Play</button></a>' +
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
    }).catch(function () {});
  }

  // ---------- library home ----------
  if (!puzzle) {
    document.getElementById('day-label').textContent = 'COMBAT PUZZLES';
    document.getElementById('p-name').textContent = '';
    document.getElementById('p-brief').textContent =
      'Single-turn tactics puzzles. Find the winning line within your orders.';
    document.getElementById('main-row').style.display = 'none';
    document.querySelector('.hud').style.display = 'none';
    document.querySelector('.controls').style.display = 'none';
    var home = document.getElementById('home');
    home.classList.add('show');
    var ICONS0 = (typeof OWICONS !== 'undefined') ? OWICONS : {};
    var prog = {};
    try { prog = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}'); } catch (e) {}
    var solvedCount = OWPUZZLES.filter(function (p) { return prog[p.id] && prog[p.id].solved; }).length;
    var GROUPS = [
      { n: 1, title: 'Basics — one unit, one rule' },
      { n: 2, title: 'Tactics — combined arms' },
      { n: 3, title: 'Challenges' },
    ];
    var invite = '';
    if (solvedCount === OWPUZZLES.length && solvedCount > 0) {
      invite = '<div class="progress" style="margin-bottom:6px">🏆 You have conquered the whole library — ' +
        '<a href="editor.html"><b>build one of your own?</b></a></div>';
    }
    var html = invite + '<div class="progress" id="rated-row" style="margin-bottom:8px">' +
      '<button class="rated-btn" id="btn-rated">▶ Play rated puzzle</button></div>' +
      '<div class="progress">Solved <b>' + solvedCount + '</b> of ' + OWPUZZLES.length +
      (solvedCount === OWPUZZLES.length && solvedCount > 0 ? ' — the whole library! ⚔️' : '') + '</div>';
    GROUPS.forEach(function (g) {
      var list = OWPUZZLES.filter(function (p) { return (p.difficulty || 2) === g.n; });
      if (!list.length) return;
      html += '<h2 class="group">' + g.title + '</h2><div class="grid">';
      html += list.map(function (p) {
        var done = prog[p.id] && prog[p.id].solved;
        var heroU = p.units.filter(function (u) { return u.player === 0; })[0];
        var hero = heroU && ICONS0[heroU.type];
        var foes = p.units.filter(function (u) { return u.player === 1; }).map(function (u) {
          var ic = ICONS0[u.type];
          return ic ? '<img src="' + ic + '" alt="">' : '';
        }).join('');
        return '<a class="card' + (done ? ' solved' : '') + '" href="?p=' + p.id + '">' +
          (done ? '<span class="done">✓</span>' : '') +
          (hero ? '<img class="hero" src="' + hero + '" alt="">' : '') +
          '<div class="body"><div class="card-head"><h3>' + p.name + '</h3>' +
          '<span class="meta">' + p.orders + ' orders</span></div>' +
          '<p>' + p.brief + '</p>' +
          '<div class="foes"><span class="vs">VS</span>' + foes + '</div></div></a>';
      }).join('');
      html += '</div>';
    });
    home.innerHTML = html;
    document.getElementById('btn-rated').addEventListener('click', function () {
      var btn = this;
      fetch('/api/next').then(function (r) { return r.json(); }).then(function (d) {
        if (d.slug) location.href = '?p=' + d.slug;
        else btn.textContent = d.error || d.message || 'sign in with Discord first';
      }).catch(function () { btn.textContent = 'server not available'; });
    });
    return; // no game to run
  }
  if (puzzle) boot(puzzle);

  function boot(bootPuzzle) {
  puzzle = bootPuzzle;
  document.getElementById('back-link').innerHTML = '<a href="./">← all puzzles</a>';

  // ---------- state ----------
  var history = [];       // stack of states for undo
  var state = E.loadPuzzle(puzzle);
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
  function shortName(u) {
    return u.type.replace('UNIT_', '').replace(/_/g, ' ').toLowerCase();
  }

  // ---------- render ----------
  var wrap = document.getElementById('board-wrap');

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
      if (jg || fr || sc) drawTrees(S, x, y, jg ? 3 : 2, t.height === 'HEIGHT_HILL',
        jg ? 'rgba(14,50,16,.95)' : sc ? 'rgba(96,110,60,.95)' : 'rgba(24,68,26,.95)');
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
      if (reachKeys[k]) {
        // one click moves the whole way; the badge is the total order cost
        // (game shows the same multi-step range with boundary pips)
        var rt = reachKeys[k];
        if (rt.orders <= 1) {
          S.push('<circle cx="' + x + '" cy="' + y + '" r="6" fill="#ffffff" opacity="0.8" pointer-events="none"/>');
        } else {
          S.push('<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + (rt.forced ? '#ffb020' : '#ffffff') + '" opacity="' + (rt.forced ? 0.9 : 0.75) + '" pointer-events="none"/>');
          S.push('<text x="' + x + '" y="' + (y + 0.5) + '" text-anchor="middle" dominant-baseline="middle" font-size="9" font-weight="bold" fill="#14161c" pointer-events="none">' + rt.orders + '</text>');
        }
      }
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
      var ic = ICONS[u.type];
      if (ic) {
        S.push('<image href="' + ic + '" x="' + (x - SIZE * 0.4) + '" y="' + (y - SIZE * 0.16) + '" width="' + (SIZE * 0.8) + '" height="' + (SIZE * 0.8) + '" pointer-events="none"/>');
      } else {
        S.push('<text x="' + x + '" y="' + (y + SIZE * 0.24) + '" text-anchor="middle" dominant-baseline="middle" font-size="' + (SIZE * 0.55) + '" pointer-events="none">' + glyphFor(u) + '</text>');
      }
      var pv = isTarget ? E.previewAttack(state, sel.id, u.id) : null;
      // HP pips, Old World style: two rows of boxes, one box per HP.
      // On attack preview, the boxes that would be lost turn red.
      drawHpPips(S, x, y, u.hp, E.hpMax(u), pv ? pv.damage : 0);
      // swap affordance: moving onto an adjacent friendly swaps — show a
      // tappable arrows badge on the ally's tile (no separate action needed)
      if (swapIds[u.id]) {
        S.push('<g data-swap="' + u.id + '" style="cursor:pointer">' +
          '<circle cx="' + (x - SIZE * 0.52) + '" cy="' + (y - SIZE * 0.34) + '" r="11" fill="#ffffff" stroke="' + BOARD_BG + '" stroke-width="1.4"/>' +
          '<text x="' + (x - SIZE * 0.52) + '" y="' + (y - SIZE * 0.34 + 1) + '" text-anchor="middle" dominant-baseline="middle" font-size="13" font-weight="bold" fill="#14161c" pointer-events="none">\u21c4</text></g>');
      }
      // objective marker: skull above units that must die
      if (u.player === 1 && mustKill[u.id]) {
        S.push('<circle cx="' + x + '" cy="' + (y - SIZE * 0.68) + '" r="7.5" fill="#2c0f0c" stroke="#ffd23e" stroke-width="1.2" pointer-events="none"/>');
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.68 + 0.5) + '" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#ffd23e" pointer-events="none">☠</text>');
      }
      // general pennant: gold flag at top-left, like the game's general banner
      if (u.general) {
        var gx = x - SIZE * 0.5, gy = y - SIZE * 0.52;
        S.push('<line x1="' + gx + '" y1="' + gy + '" x2="' + gx + '" y2="' + (gy + 16) + '" stroke="' + BOARD_BG + '" stroke-width="2" pointer-events="none"/>');
        S.push('<polygon points="' + gx + ',' + gy + ' ' + (gx + 14) + ',' + (gy + 4) + ' ' + gx + ',' + (gy + 8) + '" fill="#ffd23e" stroke="' + BOARD_BG + '" stroke-width="1" pointer-events="none"/>');
      }
      // promotion badges: the promotion's in-game icon on a gold disc
      (u.promotions || []).forEach(function (pr, pi) {
        var effName = (E.DATA.promotions[pr] && E.DATA.promotions[pr].effect) || pr;
        var pic = ICONS['EFFECT_' + effName.replace('EFFECTUNIT_', '')];
        var bx = x + SIZE * 0.46, by = y - SIZE * 0.36 + pi * 16;
        if (pic) {
          S.push('<circle cx="' + bx + '" cy="' + by + '" r="8.5" fill="#ffd23e" stroke="' + BOARD_BG + '" stroke-width="1.2" pointer-events="none"/>');
          S.push('<image href="' + pic + '" x="' + (bx - 6.5) + '" y="' + (by - 6.5) + '" width="13" height="13" pointer-events="none"/>');
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
      if (pv) {
        var label = (pv.kills ? '☠ ' : '⚔ ') + '-' + pv.damage;
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.62) + '" text-anchor="middle" font-size="15" font-family="system-ui" font-weight="bold" fill="' + (pv.kills ? '#ff5040' : '#ffb020') + '" stroke="' + BOARD_BG + '" stroke-width="3" paint-order="stroke" pointer-events="none">' + label + '</text>');
      }
      S.push('</g>');
    });

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
        if (targetIds[uid]) showPreviewPanel(uid);
        else showUnitInfo(uid);
      });
    });

    renderHud();
  }

  // ---------- attack preview panel (game-style breakdown) ----------
  var CAN_HOVER = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  var armedTarget = null; // touch: first tap arms + previews, second attacks

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
      var ic = ICONS[u.type];
      return (ic ? '<img class="p' + u.player + '" src="' + ic + '" alt="">' : '') +
        shortName(u);
    }
    p.innerHTML =
      '<h4>⚔ Attack Preview</h4>' +
      '<div class="vs">' +
      '<div class="col"><div class="who">' + chip(attU) + '</div>' +
      '<div class="big">' + ex.att.total + '</div>' +
      '<div class="modline"><span>base strength</span><span>' + ex.att.base + '</span></div>' +
      modLines(ex.att.mods) + '</div>' +
      '<div class="col"><div class="who">' + chip(defU) + '</div>' +
      '<div class="big">' + ex.def.total + '</div>' +
      '<div class="modline"><span>base strength</span><span>' + ex.def.base + '</span></div>' +
      modLines(ex.def.mods) + '</div>' +
      '</div><hr>' +
      '<div class="result"><span>Damage</span><b class="' + (ex.kills ? 'kill' : 'dmg') + '">' +
      ex.damage + (ex.kills ? ' ☠ kill' : '') + ' / ' + defU.hp + ' HP</b></div>' +
      '<div class="result"><span>Counterattack</span><b>' + ex.counter + '</b></div>' +
      (ex.collateral.length ? ex.collateral.map(function (c) {
        var v = E.unitById(state, c.id);
        return '<div class="result"><span>splash: ' + shortName(v) + '</span><b>' + c.damage + '</b></div>';
      }).join('') : '') +
      (ex.rout ? '<div class="note">Rout: overruns and may attack again</div>' : '') +
      (armedTarget === defId && !CAN_HOVER ? '<div class="arm">tap again to attack</div>' : '');
    p.classList.add('show');
  }
  function hidePreviewPanel() {
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
    if (t.river && t.river.length) {
      out.push('river on ' + t.river.length + ' edge' + (t.river.length > 1 ? 's' : '') +
        ' (melee across a river: -50%; crossing costs extra movement)');
    }
    return out;
  }

  function showTileInfo(q, r) {
    var t = E.tileAt(state, q, r);
    if (!t) return;
    var p = document.getElementById('preview-panel');
    p.innerHTML =
      '<h4>Terrain</h4>' +
      '<div class="who">' + terrainName(t) + '</div>' +
      terrainLines(t).map(function (l) { return '<div class="modline"><span>' + l + '</span></div>'; }).join('');
    p.classList.add('show');
  }

  function showUnitInfo(uid) {
    var u = E.unitById(state, uid);
    if (!u || u.hp <= 0) return;
    var inf = E.DATA.units[u.type];
    var p = document.getElementById('preview-panel');
    var ic = ICONS[u.type];
    var promoNames = (u.promotions || []).map(function (pr) {
      var eff = (E.DATA.promotions[pr] && E.DATA.promotions[pr].effect) || pr;
      var nm = eff.replace(/^(EFFECTUNIT_|PROMOTION_)/, '').toLowerCase().replace(/_/g, ' ');
      var pic = ICONS['EFFECT_' + eff.replace('EFFECTUNIT_', '')];
      return (pic ? '<img src="' + pic + '" style="width:16px;height:16px;vertical-align:-3px"> ' : '★ ') + nm;
    });
    var lines = [];
    E.effectsOf(u).forEach(function (e) {
      var pic = ICONS['EFFECT_' + e.replace('EFFECTUNIT_', '')];
      describeEffect(e).forEach(function (t) {
        lines.push((pic ? '<img src="' + pic + '" style="width:14px;height:14px;vertical-align:-2.5px;margin-right:3px">' : '') + t);
      });
    });
    if (inf.bZOC) lines.push('exerts zone of control');
    var stateBits = [];
    if (u.general) stateBits.push('carries a GENERAL');
    if (E.DATA.units[u.type].bUnlimber) {
      stateBits.push(u.unlimbered ? 'set up — ready to fire (-25% defense)' : 'packed up — must Set Up before firing');
    }
    if (u.cooldown === 'ROUT') stateBits.push('routing — may attack again');
    else if (u.cooldown) stateBits.push('done for this turn (' + u.cooldown.toLowerCase() + ')');
    if (u.steps > 0) stateBits.push('moved ' + u.steps + '/' + E.fatigueLimit(u) + ' steps');
    if (u.fortifyTurns > 0) stateBits.push('fortified ' + u.fortifyTurns + ' (+' + (u.fortifyTurns * 5) + '%)');
    p.innerHTML =
      '<h4>' + (u.player === 0 ? 'Your unit' : 'Enemy unit') + '</h4>' +
      '<div class="who">' + (ic ? '<img class="p' + u.player + '" src="' + ic + '" alt="">' : '') +
      shortName(u) + '</div>' +
      (promoNames.length ? '<div class="note" style="color:#ffd23e;margin:0 0 4px">' + promoNames.join(' · ') + '</div>' : '') +
      '<div class="result"><span>Strength</span><b>' + inf.iStrength + '</b></div>' +
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
    var pips = '';
    for (var i = 0; i < puzzle.orders; i++) {
      pips += '<span class="order-pip' + (i < puzzle.orders - state.orders ? ' spent' : '') + '"></span>';
    }
    document.getElementById('orders-pips').innerHTML = '<b>' + state.orders + '</b>' + pips;
    var tr = document.getElementById('training-span');
    if (puzzle.training) {
      tr.style.display = '';
      tr.innerHTML = 'Training: <b>' + state.training + '</b>';
    } else tr.style.display = 'none';
    var selU = selected != null ? E.unitById(state, selected) : null;
    var bm = document.getElementById('btn-march');
    bm.style.display = (selU && !finished && E.canMarch(state, selU) && selU.steps >= E.fatigueLimit(selU)) ? '' : 'none';
    var bu = document.getElementById('btn-setup');
    bu.style.display = (selU && !finished && E.canUnlimber(state, selU)) ? '' : 'none';

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
      hidePreviewPanel();
      render();
      return;
    }
    // enemy: attack if selected unit can. On touch (no hover), the first tap
    // shows the breakdown and arms the target; the second tap strikes.
    if (selected != null) {
      var can = E.attackTargets(state, E.unitById(state, selected)).some(function (t) { return t.id === id; });
      if (!can) return;
      if (!CAN_HOVER && armedTarget !== id) {
        armedTarget = id;
        showPreviewPanel(id);
        return;
      }
      act({ type: 'attack', unit: selected, target: id });
    }
  }

  function act(a) {
    try {
      history.push(state);
      var keepSel = a.unit;
      state = E.applyAction(state, a);
      lineLog.push(a);
      actionsUsed++;
      armedTarget = null;
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
    var met = E.checkObjective(state, puzzle.objective);
    if (met) { finish(true); return; }
    // no more useful actions?
    if (state.orders <= 0 || E.legalActions(state).length === 0) finish(false);
  }

  function finish(won) {
    finished = true;
    selected = null;
    var r = document.getElementById('result');
    r.classList.add('show');
    document.getElementById('result-title').textContent = won ? '⚔️ Victory!' : '💀 Not this time';
    document.getElementById('btn-next').style.display = won ? '' : 'none';
    var used = puzzle.orders - state.orders;
    var blueLost = state.units.filter(function (u) { return u.player === 0 && u.hp <= 0; }).length;
    var blueDmg = state.units.filter(function (u) { return u.player === 0; })
      .reduce(function (s, u) { return s + (E.hpMax(u) - Math.max(0, u.hp)); }, 0);
    document.getElementById('result-body').textContent = won
      ? 'Solved in ' + used + ' orders. Damage taken: ' + blueDmg + '.'
      : 'The objective was not met. Study the field and try again.';
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
      }).catch(function () {});
    }
    if (won) {
      try {
        var prog = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}');
        var used = puzzle.orders - state.orders;
        if (!prog[puzzle.id] || !prog[puzzle.id].solved || used < prog[puzzle.id].orders) {
          prog[puzzle.id] = { solved: true, orders: used, ts: Date.now() };
          localStorage.setItem('owpuzzle-progress', JSON.stringify(prog));
        }
      } catch (e) {}
    }
  }

  // ---------- controls ----------
  document.getElementById('btn-undo').addEventListener('click', function () {
    if (!history.length) return;
    state = history.pop();
    lineLog.pop();
    actionsUsed--;
    finished = false;
    selected = null;
    armedTarget = null;
    hidePreviewPanel();
    document.getElementById('result').classList.remove('show');
    render();
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
    state = E.loadPuzzle(puzzle);
    history = [];
    lineLog = [];
    selected = null;
    finished = false;
    actionsUsed = 0;
    armedTarget = null;
    hidePreviewPanel();
    document.getElementById('result').classList.remove('show');
    render();
  }

  document.getElementById('btn-next').addEventListener('click', function () {
    var btn = this;
    if (ME) {
      fetch('/api/next').then(function (r) { return r.json(); }).then(function (d) {
        if (d.slug) location.href = '?p=' + d.slug;
        else btn.textContent = d.message || 'queue exhausted!';
      }).catch(function () { advanceLocal(); });
    } else advanceLocal();
    function advanceLocal() {
      var prog = {};
      try { prog = JSON.parse(localStorage.getItem('owpuzzle-progress') || '{}'); } catch (e) {}
      var idx = OWPUZZLES.indexOf(OWPUZZLES.filter(function (p) { return p.id === puzzle.id; })[0]);
      for (var i = 1; i <= OWPUZZLES.length; i++) {
        var cand = OWPUZZLES[(idx + i) % OWPUZZLES.length];
        if (!(prog[cand.id] && prog[cand.id].solved)) { location.href = '?p=' + cand.id; return; }
      }
      location.href = './';
    }
  });
  document.getElementById('btn-share').addEventListener('click', function () {
    var used = puzzle.orders - state.orders;
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
  var pnum = OWPUZZLES.indexOf(puzzle) + 1;
  document.getElementById('day-label').textContent = 'Combat Puzzles · ' + pnum + ' of ' + OWPUZZLES.length;
  document.getElementById('p-name').textContent = puzzle.name;
  document.getElementById('p-brief').textContent = puzzle.brief;
  document.getElementById('library').innerHTML = '';

  render();
  } // end boot
})();
