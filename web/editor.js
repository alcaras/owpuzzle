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
    return { q: q, r: r, terrain: 'TERRAIN_TEMPERATE', height: 'HEIGHT_FLAT', vegetation: null, improvement: null, river: [], road: false };
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
    feature: [['road', 'road'], ['fort', 'fort'], ['river', 'river edge'], ['clear', 'clear tile']],
  };
  var UNIT_ROSTER = ['UNIT_WARRIOR', 'UNIT_MILITIA', 'UNIT_SLINGER', 'UNIT_ARCHER', 'UNIT_LONGBOWMAN', 'UNIT_CROSSBOWMAN',
    'UNIT_SPEARMAN', 'UNIT_HOPLITE', 'UNIT_PHALANGITE', 'UNIT_PIKEMAN', 'UNIT_AXEMAN', 'UNIT_MACEMAN', 'UNIT_SWORDSMAN',
    'UNIT_LEGIONARY', 'UNIT_HASTATUS', 'UNIT_SHOTELAI', 'UNIT_CHARIOT', 'UNIT_HORSEMAN', 'UNIT_CATAPHRACT',
    'UNIT_HORSE_ARCHER', 'UNIT_CAMEL_ARCHER', 'UNIT_PALTON_CAVALRY', 'UNIT_WAR_ELEPHANT', 'UNIT_TURRETED_ELEPHANT',
    'UNIT_ONAGER', 'UNIT_BALLISTA', 'UNIT_MANGONEL', 'UNIT_POLYBOLOS'];
  var PROMO_ROSTER = ['EFFECTUNIT_COMBAT1', 'EFFECTUNIT_COMBAT2', 'EFFECTUNIT_COMBAT3', 'EFFECTUNIT_STRIKE1', 'EFFECTUNIT_STRIKE2',
    'EFFECTUNIT_GUARD1', 'EFFECTUNIT_GUARD2', 'EFFECTUNIT_SADDLEBORN', 'EFFECTUNIT_HIGHLANDER', 'EFFECTUNIT_NOMAD',
    'EFFECTUNIT_ZEALOT', 'EFFECTUNIT_COMMANDER_LEADER', 'EFFECTUNIT_TACTICIAN'];

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
    var objective = objKind === 'killList' && targets.length
      ? { kind: 'killList', targets: targets.slice().sort() }
      : { kind: 'killAll' };
    var tileOverrides = [];
    Object.keys(tiles).forEach(function (k) {
      var t = tiles[k], b = blank(t.q, t.r), o = { q: t.q, r: t.r };
      var any = false;
      ['terrain', 'height', 'vegetation', 'improvement', 'road'].forEach(function (f) {
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
        return o;
      }),
    };
  }

  function out(msg) { document.getElementById('out').textContent = msg; }

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
        var r = OWSOLVER.solve(p, { maxStates: 150000 });
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
    out('submitting…');
    fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzle: p }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) out('✗ ' + d.error);
      else out('✓ Submitted for review as "' + d.slug + '" — ' + d.winningLines + ' winning outcome(s).\nSolution on file:\n' +
        d.solution.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n'));
    }).catch(function () { out('✗ network error (are you running against the server, and logged in?)'); });
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
      if (t.vegetation) S.push('<text x="' + x + '" y="' + (y + 4) + '" text-anchor="middle" font-size="16" pointer-events="none">🌲</text>');
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
  render();
})();
