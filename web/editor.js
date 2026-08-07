// In-browser puzzle editor: paint terrain, place units with promotions and
// generals, mark objectives, test-play, solver-check, submit.
(function () {
  'use strict';
  var E = OWENGINE;
  var ICONS = (typeof OWICONS !== 'undefined') ? OWICONS : {};
  var BOARD_BG = '#0b0c0f';
  var TERRAIN_FILL = {
    TERRAIN_TEMPERATE: 'rgb(104,138,74)', TERRAIN_LUSH: 'rgb(74,110,56)',
    TERRAIN_ARID: 'rgb(170,148,95)', TERRAIN_SAND: 'rgb(206,184,120)',
    TERRAIN_TUNDRA: 'rgb(200,205,210)', TERRAIN_MARSH: 'rgb(96,110,80)',
    TERRAIN_WATER: 'rgb(26,52,92)', TERRAIN_URBAN: 'rgb(150,128,116)',
  };
  var PCOL = { 0: 'rgb(110,160,210)', 1: 'rgb(150,60,60)' };
  var SIZE = 46, SQ3 = Math.sqrt(3);
  function cx(t) { return SIZE * SQ3 * (t.q + t.r / 2); }
  function cy(t) { return SIZE * 1.5 * t.r; }
  function hexPoints(x, y, scale) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 30);
      pts.push((x + SIZE * (scale || 1) * Math.cos(a)).toFixed(1) + ',' + (y + SIZE * (scale || 1) * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }

  // ---------- editable state ----------
  var radius = 3;
  var tiles = {};   // key -> tile
  var units = [];   // {player,type,q,r,hp?,promotions,general,name}
  var targets = []; // unit indexes for killList
  function blank(q, r) {
    return { q: q, r: r, terrain: 'TERRAIN_TEMPERATE', height: 'HEIGHT_FLAT', vegetation: null, improvement: null, river: [], road: false, city: null, owner: null };
  }
  function rebuildBoard() {
    var old = tiles; tiles = {};
    for (var q = -radius; q <= radius; q++)
      for (var r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++) {
        var k = q + ',' + r;
        tiles[k] = old[k] || blank(q, r);
      }
    units = units.filter(function (u) { return tiles[u.q + ',' + u.r]; });
  }
  rebuildBoard();

  // ---------- tool state ----------
  var mode = 'units';       // terrain | units | targets
  var terrainBrush = null;  // {kind:'terrain'|'height'|'veg'|'road'|'fort'|'river'|'clear', value}
  var TOOLSETS = {
    terrain: [['TERRAIN_TEMPERATE', 'grass'], ['TERRAIN_LUSH', 'lush'], ['TERRAIN_ARID', 'arid'], ['TERRAIN_SAND', 'sand'], ['TERRAIN_TUNDRA', 'tundra'], ['TERRAIN_MARSH', 'marsh'], ['TERRAIN_WATER', 'water'], ['TERRAIN_URBAN', 'urban']],
    height: [['HEIGHT_FLAT', 'flat'], ['HEIGHT_HILL', 'hill'], ['HEIGHT_MOUNTAIN', 'mountain']],
    veg: [[null, 'no veg'], ['VEGETATION_TREES', 'trees'], ['VEGETATION_SCRUB', 'scrub'], ['VEGETATION_JUNGLE', 'jungle']],
    feature: [['road', 'road'], ['fort', 'fort'], ['river', 'river edge'], ['city0', 'city (yours)'], ['city1', 'city (enemy)'], ['own0', 'territory (yours)'], ['own1', 'territory (enemy)'], ['clear', 'clear tile']],
  };
  var UNIT_ROSTER = ['UNIT_WARRIOR', 'UNIT_MILITIA', 'UNIT_SLINGER', 'UNIT_ARCHER', 'UNIT_LONGBOWMAN', 'UNIT_CROSSBOWMAN',
    'UNIT_SPEARMAN', 'UNIT_HOPLITE', 'UNIT_PHALANGITE', 'UNIT_PIKEMAN', 'UNIT_AXEMAN', 'UNIT_MACEMAN', 'UNIT_SWORDSMAN',
    'UNIT_LEGIONARY', 'UNIT_HASTATUS', 'UNIT_SHOTELAI', 'UNIT_CHARIOT', 'UNIT_HORSEMAN', 'UNIT_CATAPHRACT',
    'UNIT_HORSE_ARCHER', 'UNIT_CAMEL_ARCHER', 'UNIT_PALTON_CAVALRY', 'UNIT_WAR_ELEPHANT', 'UNIT_TURRETED_ELEPHANT',
    'UNIT_ONAGER', 'UNIT_BALLISTA', 'UNIT_MANGONEL', 'UNIT_POLYBOLOS',
    'UNIT_BIREME', 'UNIT_TRIREME', 'UNIT_QUADRIREME', 'UNIT_DROMON'];
  // promotions come straight from promotion.xml; validity from each effect's
  // abUnitTraitValid / abUnitTraitInvalid tables vs the unit's traits
  var PROMO_ROSTER = Object.keys(E.DATA.promotions).map(function (pr) {
    return E.DATA.promotions[pr].effect;
  }).concat(['EFFECTUNIT_ZEALOT', 'EFFECTUNIT_COMMANDER_LEADER'])
    .filter(function (e, i, a) { return E.DATA.effects[e] && a.indexOf(e) === i; });
  function promoValidFor(effName, unitType) {
    var d = E.DATA.effects[effName] || {};
    var traits = (E.DATA.units[unitType] || {}).traits || [];
    if (d.abUnitTraitInvalid && traits.some(function (t) { return d.abUnitTraitInvalid[t]; })) return false;
    if (d.abUnitTraitValid) return traits.some(function (t) { return d.abUnitTraitValid[t]; });
    return true;
  }
  function refreshPromoList() {
    var t = sel.value;
    Array.prototype.forEach.call(promoSel.options, function (o) {
      var ok = promoValidFor(o.value, t);
      o.disabled = !ok;
      o.style.display = ok ? '' : 'none';
      if (!ok) o.selected = false;
    });
  }

  // ---------- tool UI ----------
  function brushRow(el, items, kind) {
    items.forEach(function (it) {
      var b = document.createElement('span');
      b.className = 'brush';
      b.textContent = it[1];
      b.onclick = function () {
        terrainBrush = { kind: kind, value: it[0] };
        Array.prototype.forEach.call(document.querySelectorAll('#terrain-tools .brush'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      };
      el.appendChild(b);
    });
  }
  ['terrain', 'height', 'veg'].forEach(function (k) {
    brushRow(document.getElementById(k === 'veg' ? 'veg-row' : k + '-row'), TOOLSETS[k], k);
  });
  brushRow(document.getElementById('feature-row'), TOOLSETS.feature, 'feature');

  var modes = [['units', 'place units'], ['terrain', 'paint terrain'], ['targets', 'mark targets ☠']];
  modes.forEach(function (m) {
    var b = document.createElement('span');
    b.className = 'brush' + (m[0] === mode ? ' on' : '');
    b.textContent = m[1];
    b.dataset.mode = m[0];
    b.onclick = function () {
      mode = m[0];
      Array.prototype.forEach.call(document.querySelectorAll('#mode-row .brush'), function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      document.getElementById('terrain-tools').style.display = mode === 'terrain' ? '' : 'none';
      document.getElementById('unit-tools').style.display = mode === 'units' ? '' : 'none';
      document.getElementById('target-tools').style.display = mode === 'targets' ? '' : 'none';
    };
    document.getElementById('mode-row').appendChild(b);
  });
  document.getElementById('unit-tools').style.display = '';

  var sel = document.getElementById('u-type');
  UNIT_ROSTER.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t;
    o.textContent = t.replace('UNIT_', '').toLowerCase().replace(/_/g, ' ');
    sel.appendChild(o);
  });
  var promoSel = document.getElementById('u-promo');
  PROMO_ROSTER.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t;
    o.textContent = t.replace('EFFECTUNIT_', '').toLowerCase().replace(/_/g, ' ');
    promoSel.appendChild(o);
  });

  sel.onchange = refreshPromoList;
  setTimeout(refreshPromoList, 0);

  document.getElementById('p-radius').onchange = function () {
    radius = +this.value; rebuildBoard(); render();
  };

  // ---------- board interaction ----------
  function nearestEdge(t, px, py) {
    var x = cx(t), y = cy(t);
    var ang = Math.atan2(py - y, px - x) * 180 / Math.PI; // -180..180, 0=east
    var d = Math.round(-ang / 60);
    return ((d % 6) + 6) % 6;
  }

  function onTileClick(t, evt, pt) {
    if (mode === 'terrain' && terrainBrush) {
      var b = terrainBrush;
      if (b.kind === 'terrain') { t.terrain = b.value; if (b.value === 'TERRAIN_WATER') { t.height = 'HEIGHT_FLAT'; t.vegetation = null; } }
      else if (b.kind === 'height') t.height = b.value;
      else if (b.kind === 'veg') t.vegetation = b.value;
      else if (b.kind === 'feature') {
        if (b.value === 'road') t.road = !t.road;
        else if (b.value === 'fort') t.improvement = t.improvement ? null : 'IMPROVEMENT_FORT';
        else if (b.value === 'river') {
          var d = nearestEdge(t, pt.x, pt.y);
          var i = t.river.indexOf(d);
          if (i >= 0) t.river.splice(i, 1); else t.river.push(d);
        } else if (b.value === 'city0' || b.value === 'city1') {
          var cp = +b.value.slice(4);
          if (t.city === cp) { t.city = null; }
          else { t.city = cp; t.owner = cp; t.height = 'HEIGHT_FLAT'; t.vegetation = null; }
        } else if (b.value === 'own0' || b.value === 'own1') {
          var op = +b.value.slice(3);
          t.owner = (t.owner === op) ? null : op;
        } else if (b.value === 'clear') {
          var k = t.q + ',' + t.r; tiles[k] = blank(t.q, t.r);
        }
      }
      render();
      return;
    }
    if (mode === 'units') {
      var idx = units.findIndex(function (u) { return u.q === t.q && u.r === t.r; });
      if (idx >= 0) {
        units.splice(idx, 1);
        targets = targets.filter(function (i) { return i !== idx; }).map(function (i) { return i > idx ? i - 1 : i; });
      } else {
        var promos = Array.prototype.filter.call(promoSel.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
        var hp = parseInt(document.getElementById('u-hp').value, 10);
        units.push({
          player: +document.getElementById('u-side').value,
          type: sel.value,
          q: t.q, r: t.r,
          hp: isNaN(hp) ? undefined : hp,
          promotions: promos.length ? promos : undefined,
          general: document.getElementById('u-general').checked || undefined,
          anchored: (document.getElementById('u-anchored').checked && E.DATA.units[sel.value].bAnchor) || undefined,
        });
      }
      render();
      return;
    }
    if (mode === 'targets') {
      var i2 = units.findIndex(function (u) { return u.q === t.q && u.r === t.r && u.player === 1; });
      if (i2 >= 0) {
        var at = targets.indexOf(i2);
        if (at >= 0) targets.splice(at, 1); else targets.push(i2);
        render();
      }
    }
  }

  // ---------- puzzle assembly ----------
  function buildPuzzle() {
    var objKind = document.getElementById('p-objective').value;
    var objective = { kind: 'killAll' };
    if (objKind === 'killList' && targets.length) objective = { kind: 'killList', targets: targets.slice().sort() };
    if (objKind === 'capture') objective = { kind: 'capture' };
    var tileOverrides = [];
    Object.keys(tiles).forEach(function (k) {
      var t = tiles[k], b = blank(t.q, t.r), o = { q: t.q, r: t.r };
      var any = false;
      ['terrain', 'height', 'vegetation', 'improvement', 'road', 'city', 'owner'].forEach(function (f) {
        if (t[f] !== b[f]) { o[f] = t[f]; any = true; }
      });
      if (t.river.length) { o.river = t.river.slice(); any = true; }
      if (any) tileOverrides.push(o);
    });
    return {
      id: 'draft',
      name: document.getElementById('p-name').value || 'Untitled',
      brief: document.getElementById('p-brief').value || '',
      lesson: document.getElementById('p-lesson').value || '',
      orders: +document.getElementById('p-orders').value || 3,
      training: +document.getElementById('p-training').value || 0,
      radius: radius,
      objective: objective,
      tiles: tileOverrides,
      units: units.map(function (u) {
        var o = { player: u.player, type: u.type, q: u.q, r: u.r };
        if (u.hp != null) o.hp = u.hp;
        if (u.promotions) o.promotions = u.promotions;
        if (u.general) o.general = true;
        if (u.anchored) o.anchored = true;
        return o;
      }),
    };
  }

  function out(msg) { document.getElementById('out').textContent = msg; }

  document.getElementById('btn-reset').onclick = function () {
    if (!confirm('Clear the whole board?')) return;
    units = []; targets = []; tiles = {}; rebuildBoard();
    localStorage.removeItem('owpuzzle-editor-autosave');
    render();
  };
  document.getElementById('btn-export').onclick = function () {
    var j = JSON.stringify(buildPuzzle(), null, 2);
    navigator.clipboard && navigator.clipboard.writeText(j);
    out(j);
  };
  document.getElementById('btn-test').onclick = function () {
    if (!units.some(function (u) { return u.player === 0; })) return out('Place at least one blue unit first.');
    localStorage.setItem('owpuzzle-draft', JSON.stringify(buildPuzzle()));
    location.href = './?draft=1';
  };
  document.getElementById('btn-check').onclick = function () {
    var p = buildPuzzle();
    if (!p.units.some(function (u) { return u.player === 0; })) return out('Place at least one blue unit first.');
    if (!p.units.some(function (u) { return u.player === 1; })) return out('Place at least one red unit first.');
    out('solving…');
    setTimeout(function () {
      try {
        var r = OWSOLVER.solve(p, { maxStates: 150000, maxMs: 25000 });
        if (r.best && r.best.met) {
          out('SOLVABLE — ' + r.winCount + ' distinct winning outcome(s)' +
            (r.winCount === 1 ? ' (unique!)' : ' (consider tightening)') +
            (r.truncated ? ' [search truncated]' : '') + '\n\nBest line:\n' +
            OWSOLVER.describeLine(p, r.line).map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n'));
        } else {
          out('NOT SOLVABLE within ' + p.orders + ' orders' + (r.truncated ? ' [search truncated — may be too big]' : '') +
            '. Adjust HP, positions, or the budget.');
        }
      } catch (e) { out('solver error: ' + e.message); }
    }, 30);
  };
  document.getElementById('btn-submit').onclick = function () {
    var p = buildPuzzle();
    out('submitting… (the server verifies with the solver; up to ~20s for complex boards)');
    fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzle: p }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) return out('✗ ' + d.error);
      out('✓ Received as "' + d.slug + '" — the solver is verifying it now (can take a few minutes for big boards)…');
      var tries = 0;
      (function poll() {
        if (++tries > 60) return out('still verifying — check back later; it will appear in the review queue when done.');
        setTimeout(function () {
          fetch('/api/submit-status/' + d.slug).then(function (r) { return r.json(); }).then(function (st) {
            if (st.status === 'validating') { out('⏳ verifying… (' + (tries * 5) + 's)'); poll(); }
            else if (st.status === 'pending') out('✓ VERIFIED and queued for review!\n' + (st.notes || ''));
            else if (st.status === 'autorejected') out('✗ rejected by the solver: ' + (st.notes || ''));
            else out('status: ' + st.status + ' — ' + (st.notes || ''));
          }).catch(function () { poll(); });
        }, 5000);
      })();
    }).catch(function () { out('✗ network error (are you logged in?)'); });
  };

  // ---------- render ----------
  function render() {
    var list = Object.keys(tiles).map(function (k) { return tiles[k]; });
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    list.forEach(function (t) {
      minX = Math.min(minX, cx(t) - SIZE); maxX = Math.max(maxX, cx(t) + SIZE);
      minY = Math.min(minY, cy(t) - SIZE); maxY = Math.max(maxY, cy(t) + SIZE);
    });
    var S = ['<svg viewBox="' + (minX - 6) + ' ' + (minY - 6) + ' ' + (maxX - minX + 12) + ' ' + (maxY - minY + 12) + '" xmlns="http://www.w3.org/2000/svg">'];
    list.forEach(function (t) {
      var x = cx(t), y = cy(t);
      var fill = TERRAIN_FILL[t.terrain] || 'rgb(90,90,90)';
      if (t.height === 'HEIGHT_MOUNTAIN') fill = 'rgb(150,150,153)';
      S.push('<polygon points="' + hexPoints(x, y) + '" fill="' + fill + '" stroke="' + BOARD_BG + '" stroke-width="1" data-t="' + t.q + ',' + t.r + '"/>');
      if (t.height === 'HEIGHT_HILL') {
        S.push('<rect x="' + (x - SIZE * 0.6) + '" y="' + (y - SIZE * 0.35) + '" width="' + SIZE * 1.2 + '" height="' + SIZE * 0.32 + '" fill="rgba(255,255,255,.16)" pointer-events="none"/>');
        S.push('<rect x="' + (x - SIZE * 0.6) + '" y="' + (y + SIZE * 0.02) + '" width="' + SIZE * 1.2 + '" height="' + SIZE * 0.4 + '" fill="rgba(0,0,0,.30)" pointer-events="none"/>');
      }
      if (t.vegetation === 'VEGETATION_JUNGLE') {
        S.push('<polygon points="' + hexPoints(x, y, 0.98) + '" fill="rgba(6,44,10,.5)" pointer-events="none"/>');
      }
      if (t.vegetation === 'VEGETATION_SCRUB') {
        var yb2 = y + (t.height === 'HEIGHT_HILL' ? -SIZE * 0.05 : SIZE * 0.3);
        [[-0.34, 0], [0, 0.12], [0.34, -0.02], [0.16, -0.3]].forEach(function (sp) {
          S.push('<ellipse cx="' + (x + SIZE * sp[0]) + '" cy="' + (yb2 + SIZE * sp[1]) + '" rx="' + (SIZE * 0.14) + '" ry="' + (SIZE * 0.09) + '" fill="rgba(110,122,63,.95)" stroke="rgba(50,56,26,.6)" stroke-width="1" pointer-events="none"/>');
        });
      } else if (t.vegetation) {
        var nT = t.vegetation === 'VEGETATION_JUNGLE' ? 3 : 2;
        var vc = t.vegetation === 'VEGETATION_JUNGLE' ? 'rgba(14,50,16,.95)' : 'rgba(24,68,26,.95)';
        var tw = SIZE * 0.26, th = SIZE * 0.62, yb = y + (t.height === 'HEIGHT_HILL' ? -SIZE * 0.12 : SIZE * 0.24);
        for (var vk = 0; vk < nT; vk++) {
          var VX = x + (vk - (nT - 1) / 2) * (tw * 1.25);
          S.push('<rect x="' + (VX - tw * 0.16) + '" y="' + (yb - th * 0.18) + '" width="' + (tw * 0.32) + '" height="' + (th * 0.34) + '" fill="rgba(60,40,20,.9)" pointer-events="none"/>');
          S.push('<path d="M ' + VX + ' ' + (yb - th) + ' L ' + (VX - tw) + ' ' + yb + ' L ' + (VX + tw) + ' ' + yb + ' Z" fill="' + vc + '" pointer-events="none"/>');
        }
      }
      if (t.owner != null) {
        S.push('<polygon points="' + hexPoints(x, y, 0.98) + '" fill="' + (PCOL[t.owner] || '#888').replace('rgb', 'rgba').replace(')', ',0.16)') + '" pointer-events="none"/>');
      }
      if (t.city != null) {
        S.push('<polygon points="' + hexPoints(x, y, 0.86) + '" fill="none" stroke="' + PCOL[t.city] + '" stroke-width="5" pointer-events="none"/>');
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.42) + '" text-anchor="middle" font-size="14" pointer-events="none">\ud83c\udfdb\ufe0f</text>');
      }
      if (t.improvement) S.push('<polygon points="' + hexPoints(x, y, 0.82) + '" fill="none" stroke="#c9b07a" stroke-width="4" pointer-events="none"/>');
      if (t.road) S.push('<circle cx="' + x + '" cy="' + y + '" r="6" fill="rgba(160,120,70,.9)" pointer-events="none"/>');
      (t.river || []).forEach(function (d) {
        var a1 = Math.PI / 180 * (-60 * d - 30), a2 = Math.PI / 180 * (-60 * d + 30);
        S.push('<line x1="' + (x + SIZE * Math.cos(a1)) + '" y1="' + (y + SIZE * Math.sin(a1)) + '" x2="' + (x + SIZE * Math.cos(a2)) + '" y2="' + (y + SIZE * Math.sin(a2)) + '" stroke="#4696eb" stroke-width="8" stroke-linecap="round" pointer-events="none"/>');
      });
    });
    units.forEach(function (u, i) {
      var x = cx(u), y = cy(u);
      S.push('<g pointer-events="none">');
      S.push('<circle cx="' + x + '" cy="' + (y + SIZE * 0.24) + '" r="' + SIZE * 0.52 + '" fill="' + PCOL[u.player] + '" stroke="' + BOARD_BG + '" stroke-width="1.6"/>');
      var ic = ICONS[u.type];
      if (ic) S.push('<image href="' + ic + '" x="' + (x - SIZE * 0.4) + '" y="' + (y - SIZE * 0.16) + '" width="' + SIZE * 0.8 + '" height="' + SIZE * 0.8 + '"/>');
      if (u.general) S.push('<polygon points="' + (x - SIZE * 0.5) + ',' + (y - SIZE * 0.52) + ' ' + (x - SIZE * 0.5 + 14) + ',' + (y - SIZE * 0.52 + 4) + ' ' + (x - SIZE * 0.5) + ',' + (y - SIZE * 0.52 + 8) + '" fill="#ffd23e" stroke="' + BOARD_BG + '"/>');
      if ((u.promotions || []).length) S.push('<text x="' + (x + SIZE * 0.44) + '" y="' + (y - SIZE * 0.3) + '" text-anchor="middle" font-size="13" fill="#ffd23e" stroke="' + BOARD_BG + '" stroke-width="2" paint-order="stroke">★</text>');
      if (u.anchored) S.push('<text x="' + (x - SIZE * 0.44) + '" y="' + (y + SIZE * 0.05) + '" text-anchor="middle" font-size="13" pointer-events="none">⚓</text>');
      if (u.hp != null) S.push('<text x="' + x + '" y="' + (y + SIZE * 0.86) + '" text-anchor="middle" font-size="11" font-weight="bold" fill="#fff" stroke="' + BOARD_BG + '" stroke-width="2.5" paint-order="stroke" font-family="system-ui">' + u.hp + '</text>');
      if (targets.indexOf(i) >= 0) {
        S.push('<circle cx="' + x + '" cy="' + (y - SIZE * 0.62) + '" r="8" fill="#2c0f0c" stroke="#ffd23e" stroke-width="1.2"/>');
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.61) + '" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#ffd23e">☠</text>');
      }
      S.push('</g>');
    });
    S.push('</svg>');
    var wrap = document.getElementById('board-wrap');
    wrap.innerHTML = S.join('');
    var svg = wrap.querySelector('svg');
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-t]'), function (el) {
      el.addEventListener('click', function (evt) {
        var qr = el.getAttribute('data-t').split(',');
        var t = tiles[qr[0] + ',' + qr[1]];
        // click point in SVG coords for river-edge picking
        var pt = svg.createSVGPoint();
        pt.x = evt.clientX; pt.y = evt.clientY;
        var loc = pt.matrixTransform(svg.getScreenCTM().inverse());
        onTileClick(t, evt, loc);
      });
    });
  }
  // autosave every render; restore on load
  var restoring = true;
  try {
    var saved = JSON.parse(localStorage.getItem('owpuzzle-editor-autosave') || 'null');
    if (saved && saved.units) {
      radius = saved.radius || 3;
      document.getElementById('p-radius').value = radius;
      rebuildBoard();
      (saved.tiles || []).forEach(function (t) {
        var k = t.q + ',' + t.r;
        if (tiles[k]) Object.keys(t).forEach(function (f) { tiles[k][f] = t[f]; });
        if (tiles[k] && !tiles[k].river) tiles[k].river = [];
      });
      units = (saved.units || []).map(function (u) {
        return { player: u.player, type: u.type, q: u.q, r: u.r, hp: u.hp,
          promotions: u.promotions, general: u.general, anchored: u.anchored };
      });
      if (saved.objective && saved.objective.kind === 'killList') targets = saved.objective.targets || [];
      ['name', 'brief', 'lesson'].forEach(function (f) {
        if (saved[f]) document.getElementById('p-' + f).value = saved[f];
      });
      if (saved.orders) document.getElementById('p-orders').value = saved.orders;
      if (saved.training) document.getElementById('p-training').value = saved.training;
      if (saved.objective) document.getElementById('p-objective').value = saved.objective.kind;
    }
  } catch (e) {}
  restoring = false;
  var origRender = render;
  render = function () {
    origRender();
    if (!restoring) {
      try { localStorage.setItem('owpuzzle-editor-autosave', JSON.stringify(buildPuzzle())); } catch (e) {}
    }
  };
  render();
})();
