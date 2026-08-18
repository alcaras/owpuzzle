// In-browser puzzle editor: paint terrain, place units with promotions and
// generals, mark objectives, test-play, solver-check, submit.
(function () {
  'use strict';

  // ?load=<slug> — pull one of your own submissions back into the editor to
  // copy or tweak it. The editor already restores itself from the autosave
  // slot on load, so we fill that slot and reload rather than duplicating the
  // (fiddly) restore logic.
  var LOAD = (location.search.match(/[?&]load=([^&]+)/) || [])[1];
  if (LOAD) {
    // Loading is a one-off, but the URL is not: the browser's Back button
    // lands here again after a test play. Doing the load a second time
    // replaced the author's edits with the server's copy AND deleted the
    // recording they had just made — so returning with Back meant being told
    // to play a turn they had just played. Load a given puzzle once.
    var already = null;
    try { already = localStorage.getItem('owpuzzle-loaded-slug'); } catch (e) {}
    var haveBoard = false;
    try { haveBoard = !!localStorage.getItem('owpuzzle-editor-autosave'); } catch (e) {}
    if (already === LOAD && haveBoard) { location.replace('editor.html'); return; }
    document.body.innerHTML = '<p style="text-align:center;padding:40px;' +
      'font-family:Georgia,serif">loading your puzzle…</p>';
    fetch('/api/puzzle/' + encodeURIComponent(LOAD))
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.puzzle) throw new Error(d && d.error || 'not found');
        localStorage.setItem('owpuzzle-editor-autosave', JSON.stringify(d.puzzle));
        localStorage.setItem('owpuzzle-loaded-slug', LOAD);
        // a different board than whatever was recorded before; the submit
        // check compares boards anyway, so leave the recording alone rather
        // than destroying something the author may still need
      })
      .catch(function (e) { alert('Could not load that puzzle: ' + e.message); })
      .then(function () { location.replace('editor.html'); });
    return;
  }

  var E = OWENGINE;
  var ICONS = (typeof OWICONS !== 'undefined') ? OWICONS : {};
  var ICON_STYLE = 'portrait';
  try { ICON_STYLE = localStorage.getItem('owpuzzle-iconstyle') || 'portrait'; } catch (e) {}
  function unitIcon(type) {
    return ICON_STYLE === 'flag' ? (ICONS['FLAG_' + type] || ICONS[type])
                                 : (ICONS[type] || ICONS['FLAG_' + type]);
  }
  var BOARD_BG = '#0b0c0f';
  // kept in step with app.js — see the note beside its copy there
  var VEG_WASH = {
    VEGETATION_TREES: 'rgba(18,64,22,.36)',
    VEGETATION_JUNGLE: 'rgba(6,44,10,.5)',
    VEGETATION_SCRUB: 'rgba(126,116,52,.26)',
  };
  var VEG_RIM = {
    VEGETATION_TREES: 'rgba(30,86,34,.85)',
    VEGETATION_JUNGLE: 'rgba(10,58,14,.9)',
    VEGETATION_SCRUB: 'rgba(146,134,64,.75)',
  };
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
    'UNIT_BATTERING_RAM', 'UNIT_SIEGE_TOWER',
    'UNIT_BIREME', 'UNIT_TRIREME', 'UNIT_DROMON',
    // non-tribal units that were simply never listed. Every mechanic they carry
    // is implemented; two of their badges are decoration in the data itself —
    // FORMIDABLE and SHOCK_CAVALRY have no fields at all, so they do nothing.
    'UNIT_CONSCRIPT', 'UNIT_DMT_WARRIOR',
    'UNIT_AKKADIAN_ARCHER', 'UNIT_BEJA_ARCHER', 'UNIT_CIMMERIAN_ARCHER', 'UNIT_MEDJAY_ARCHER',
    'UNIT_KUSHAN_CAVALRY', 'UNIT_KUSHAN_WARLORDS', 'UNIT_CATAPHRACT_ARCHER',
    'UNIT_MOUNTED_LANCER', 'UNIT_STEPPE_RIDER',
    'UNIT_LIGHT_CHARIOT', 'UNIT_HITTITE_CHARIOT_1', 'UNIT_HITTITE_CHARIOT_2',
    'UNIT_AFRICAN_ELEPHANT', 'UNIT_ARMOURED_ELEPHANT', 'UNIT_ASSAULT_ELEPHANT',
    'UNIT_ARCHER_ELEPHANT', 'UNIT_JAVELIN_ELEPHANT'];
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
    Array.prototype.forEach.call(promoList.querySelectorAll('label'), function (lab) {
      var ok = promoValidFor(lab.dataset.eff, t);
      lab.classList.toggle('off', !ok);
      if (!ok) lab.querySelector('input').checked = false;
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

  var modes = [['units', 'place units'], ['terrain', 'paint terrain'], ['targets', 'mark targets 🎯']];
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

  // ---------- the unit picker ----------
  // A flat <select> of fifty-two names was already hard to shop from, and the
  // roster is only going to grow. The grid keeps the select as the source of
  // truth — every existing code path still reads sel.value — and drives it.
  //
  // Grouped by CLASS first because that is what actually decides how a unit
  // behaves: a cataphract at strength 10 and a pikeman at 8 are not comparable,
  // one routs and the other is immune to routing. Strength only sorts WITHIN a
  // class, where it means something.
  function unitClass(type) {
    var t = (E.DATA.units[type].traits || []).map(function (x) { return x.replace('UNITTRAIT_', ''); });
    if (t.indexOf('SHIP') >= 0) return 'ships';
    if (t.indexOf('SIEGE') >= 0) return 'siege';
    if (t.indexOf('ELEPHANT') >= 0) return 'elephants';
    if (t.indexOf('CHARIOT') >= 0) return 'mounted';   // a chariot IS mounted
    if (t.indexOf('MOUNTED') >= 0) return 'mounted';
    if (t.indexOf('POLEARM') >= 0) return 'polearm';
    if (t.indexOf('RANGED') >= 0) return 'ranged';
    return 'melee';
  }
  var CLASS_ORDER = ['melee', 'polearm', 'ranged', 'mounted', 'elephants', 'siege', 'ships'];
  // A unique unit is one a single nation may build (unit.xml NationPrereq).
  // They sit in their own section grouped by nation rather than scattered
  // through the classes: you pick them because of WHOSE army you are building,
  // and every nation's pair reads the same way — the 6 then the 8.
  function nationOf(type) { return E.DATA.units[type].nation || null; }
  function nationLabel(n) { return n.replace('NATION_', '').toLowerCase().replace(/_/g, ' '); }

  // what the hover text says: the numbers a designer actually needs, plus the
  // abilities, in the game's own words where the engine can supply them
  function unitTip(type) {
    var x = E.DATA.units[type];
    var bits = [type.replace('UNIT_', '').toLowerCase().replace(/_/g, ' ')];
    bits.push('strength ' + (x.iStrength / 10));
    if (x.iRangeMax) bits.push('range ' + x.iRangeMax);
    bits.push('move ' + x.iMovement);
    var ab = E.describeUnitAbilities ? E.describeUnitAbilities(type) : null;
    if (ab && ab.length) bits.push(ab.join('; '));
    return bits.join(' · ');
  }

  function renderUnitGrid() {
    var host = document.getElementById('unit-grid');
    if (!host) return;
    host.innerHTML = '';

    function makeCell(t) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'ug-cell' + (sel.value === t ? ' on' : '');
      cell.title = unitTip(t);
      cell.dataset.unit = t;
      var ic = unitIcon(t);
      if (ic) {
        var img = document.createElement('img');
        img.src = ic; img.alt = '';
        cell.appendChild(img);
      } else {
        cell.textContent = t.replace('UNIT_', '').slice(0, 3).toLowerCase();
      }
      var st = document.createElement('span');
      st.className = 'ug-str';
      st.textContent = E.DATA.units[t].iStrength / 10;
      cell.appendChild(st);
      cell.onclick = function () {
        sel.value = t;
        // the select is still the source of truth, so fire its change handler
        // and everything downstream (promotion validity, editing a selected
        // unit in place) keeps working untouched
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        renderUnitGrid();
      };
      return cell;
    }
    function section(label, types, cls) {
      if (!types.length) return;
      var head = document.createElement('div');
      head.className = cls || 'ug-head';
      head.textContent = label;
      host.appendChild(head);
      var row = document.createElement('div');
      row.className = 'ug-row';
      types.forEach(function (t) { row.appendChild(makeCell(t)); });
      host.appendChild(row);
    }
    var byStrength = function (a, b) {
      return E.DATA.units[a].iStrength - E.DATA.units[b].iStrength || a.localeCompare(b);
    };

    var common = UNIT_ROSTER.filter(function (t) { return !nationOf(t); });
    CLASS_ORDER.forEach(function (cls) {
      section(cls, common.filter(function (t) { return unitClass(t) === cls; }).sort(byStrength));
    });

    var uniques = UNIT_ROSTER.filter(nationOf).sort(byStrength);
    if (!uniques.length) return;
    var nations = [];
    uniques.forEach(function (t) {
      if (nations.indexOf(nationOf(t)) < 0) nations.push(nationOf(t));
    });
    nations.sort(function (a, b) { return nationLabel(a).localeCompare(nationLabel(b)); });
    var major = document.createElement('div');
    major.className = 'ug-head ug-head-major';
    major.textContent = 'unique units';
    host.appendChild(major);
    nations.forEach(function (n) {
      section(nationLabel(n), uniques.filter(function (t) { return nationOf(t) === n; }), 'ug-head ug-head-nation');
    });
  }
  var promoList = document.getElementById('u-promo-list');
  PROMO_ROSTER.forEach(function (t) {
    var lab = document.createElement('label');
    lab.dataset.eff = t;
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = t;
    lab.appendChild(cb);
    var pic = ICONS['EFFECT_' + t.replace('EFFECTUNIT_', '')];
    if (pic) {
      var img = document.createElement('img');
      img.src = pic; img.alt = '';
      lab.appendChild(img);
    }
    lab.appendChild(document.createTextNode(
      t.replace('EFFECTUNIT_', '').toLowerCase().replace(/_/g, ' ')));
    promoList.appendChild(lab);
  });
  function checkedPromos() {
    return Array.prototype.filter.call(
      promoList.querySelectorAll('input:checked'),
      function (cb) { return !cb.closest('label').classList.contains('off'); }
    ).map(function (cb) { return cb.value; });
  }

  sel.onchange = function () { refreshPromoList(); applyPanelToSelected(); renderUnitGrid(); refreshModeLine(); };
  setTimeout(function () { refreshPromoList(); renderUnitGrid(); layoutPanel(false); refreshModeLine(); }, 0);

  // every control in the unit panel edits the selected unit as you touch it
  ['u-side', 'u-hp', 'u-general', 'u-anchored'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function () { applyPanelToSelected(); });
  });
  if (promoList) promoList.addEventListener('change', function () { applyPanelToSelected(); });
  var delBtn = document.getElementById('btn-unit-delete');
  if (delBtn) delBtn.onclick = function () {
    if (selectedUnit < 0) return;
    var idx = selectedUnit;
    units.splice(idx, 1);
    targets = targets.filter(function (i) { return i !== idx; })
      .map(function (i) { return i > idx ? i - 1 : i; });
    selectUnit(-1);   // render() inside selectUnit takes the undo snapshot
  };

  // Live size readout. The server refuses an oversized puzzle at submit, which
  // is the worst possible moment to learn it — one author built a 26-unit board
  // and only found out when they pressed the button. Show the count all the
  // time, and colour it when it goes over.
  function refreshLimits() {
    var el = document.getElementById('size-view');
    if (!el) return;
    var radius = +document.getElementById('p-radius').value || 3;
    var problems = E.limitProblems({ units: units, radius: radius });
    el.textContent = 'units ' + units.length + '/' + E.LIMITS.maxUnits +
      ' · radius ' + radius + '/' + E.LIMITS.maxRadius;
    el.className = problems.length ? 'limit-view over' : 'limit-view';
    el.title = problems.length ? 'too large to submit: ' + problems.join('; ') : '';
  }

  // the objective in the same words the player will see, straight from the
  // engine, so the editor cannot drift from the game
  function refreshObjectiveLine() {
    var el = document.getElementById('obj-view');
    if (!el) return;
    var kind = document.getElementById('p-objective').value;
    el.textContent = E.objectiveText({ kind: kind, targets: targets });
  }

  // live pool preview: par -> the order pool players will actually get
  var poolView = document.getElementById('pool-view');
  function refreshPool() {
    var par = +document.getElementById('p-orders').value || 1;
    if (poolView) poolView.textContent = E.poolOrders({ orders: par });
  }
  document.getElementById('p-orders').oninput = refreshPool;
  // Every puzzle field must go through render(), which is what autosaves and
  // snapshots for undo. Without this, changing the objective or par lived only
  // in the DOM: the draft sent to Test play had it, the autosave did not, and
  // returning to the editor silently reverted it — so the board you submitted
  // was not the board you played, and the check rightly refused it.
  ['p-name', 'p-brief', 'p-lesson', 'p-orders', 'p-training', 'p-objective'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var ev = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(ev, function () { render(); });
  });
  setTimeout(refreshPool, 0);

  // unit art toggle (shared setting with the game view)
  var styleBtn = document.getElementById('btn-iconstyle');
  if (styleBtn) {
    var styleLabel = function () {
      styleBtn.textContent = 'Unit art: ' + (ICON_STYLE === 'flag' ? 'Icons' : 'Portraits') + ' \u21c4';
    };
    styleLabel();
    styleBtn.onclick = function () {
      ICON_STYLE = ICON_STYLE === 'flag' ? 'portrait' : 'flag';
      try { localStorage.setItem('owpuzzle-iconstyle', ICON_STYLE); } catch (e) {}
      styleLabel(); renderUnitGrid(); render();
    };
  }

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

  // ---------- editing a unit AFTER it is placed ----------
  // The editor used to be write-only: clicking a placed unit deleted it, so
  // giving somebody a promotion or a general's flag meant deleting them and
  // stamping a replacement with the panel set differently. Now a click SELECTS,
  // the panel loads that unit, and changing any control edits it in place.
  var selectedUnit = -1;   // index into units, or -1

  function loadPanelFrom(u) {
    document.getElementById('u-side').value = String(u.player);
    document.getElementById('u-hp').value = u.hp == null ? '' : u.hp;
    document.getElementById('u-general').checked = !!u.general;
    document.getElementById('u-anchored').checked = !!u.anchored;
    sel.value = u.type;
    refreshPromoList();
    Array.prototype.forEach.call(promoList.querySelectorAll('input'), function (cb) {
      cb.checked = (u.promotions || []).indexOf(cb.value) >= 0;
    });
  }

  // Write the panel back onto the selected unit. Mirrors the placement path
  // exactly — including the rule that a _LEADER promotion implies generalship
  // (Unit.cs:2274), which is the bug king-of-the-hill shipped with.
  function applyPanelToSelected() {
    if (selectedUnit < 0 || !units[selectedUnit]) return;
    var u = units[selectedUnit];
    var promos = checkedPromos();
    var hp = parseInt(document.getElementById('u-hp').value, 10);
    u.player = +document.getElementById('u-side').value;
    u.type = sel.value;
    u.hp = isNaN(hp) ? undefined : hp;
    u.promotions = promos.length ? promos : undefined;
    u.general = document.getElementById('u-general').checked
      || promos.some(function (pr) { return /_LEADER$/.test(pr); }) || undefined;
    u.anchored = (document.getElementById('u-anchored').checked
      && E.DATA.units[sel.value].bAnchor) || undefined;
    render();   // the wrapped render() is what records undo history
  }

  function niceName(type) {
    return type.replace('UNIT_', '').toLowerCase().replace(/_/g, ' ');
  }

  // the coordinates the PLAYER sees (app.js:947): Old World display coords with
  // the bottom-left tile of this board reading 0,0, so an author and a player
  // discussing a tile are naming the same one
  function dispCoord(u) {
    var minX = Infinity, minY = Infinity;
    Object.keys(tiles).forEach(function (k) {
      var t = tiles[k], ty = -t.r, tx = t.q - Math.floor(ty / 2);
      if (tx < minX) minX = tx;
      if (ty < minY) minY = ty;
    });
    var y = -u.r, x = u.q - Math.floor(y / 2);
    return (x - minX) + ',' + (y - minY);
  }

  // The panel does two jobs with one set of controls: it describes the unit you
  // are ABOUT to place, or the one you have picked. Read and restore that
  // description so selecting a unit does not quietly destroy the thing you had
  // set up to place — checking a promotion and then clicking a unit used to
  // wipe the check, which reads as the promotion not working at all.
  function readPanel() {
    return {
      side: document.getElementById('u-side').value,
      hp: document.getElementById('u-hp').value,
      general: document.getElementById('u-general').checked,
      anchored: document.getElementById('u-anchored').checked,
      type: sel.value,
      promos: checkedPromos(),
    };
  }
  function writePanel(t) {
    document.getElementById('u-side').value = t.side;
    document.getElementById('u-hp').value = t.hp;
    document.getElementById('u-general').checked = t.general;
    document.getElementById('u-anchored').checked = t.anchored;
    sel.value = t.type;
    refreshPromoList();
    Array.prototype.forEach.call(promoList.querySelectorAll('input'), function (cb) {
      cb.checked = t.promos.indexOf(cb.value) >= 0;
    });
  }
  var placeTemplate = null;   // what to place, parked while a unit is selected

  // Editing a unit you can see, the promotions are what you came for; picking a
  // type is what you came for when placing. Put whichever that is first so the
  // panel does not have to be scrolled to reach it.
  function layoutPanel(editing) {
    var host = document.getElementById('unit-tools');
    var typeB = document.getElementById('u-type-block');
    var promoB = document.getElementById('u-promo-block');
    if (!host || !typeB || !promoB) return;
    host.insertBefore(editing ? promoB : typeB, editing ? typeB : promoB);
  }

  function refreshModeLine() {
    var el = document.getElementById('u-mode');
    if (!el) return;
    if (selectedUnit >= 0 && units[selectedUnit]) {
      var u = units[selectedUnit];
      el.className = 'u-mode editing';
      el.innerHTML = 'Editing <b>' + esc(niceName(u.type)) + '</b> at ' +
        esc(dispCoord(u)) + ' — changes apply to it';
      var done = document.createElement('button');
      done.type = 'button';
      done.textContent = 'Done';
      done.onclick = function () { selectUnit(-1); };
      el.appendChild(done);
    } else {
      el.className = 'u-mode placing';
      el.innerHTML = 'Placing <b>' + esc(niceName(sel.value)) + '</b> — click empty ground';
    }
  }

  function selectUnit(idx) {
    var was = selectedUnit;
    if (idx >= 0 && was < 0) placeTemplate = readPanel();
    selectedUnit = idx;
    if (idx >= 0) loadPanelFrom(units[idx]);
    else if (placeTemplate) { writePanel(placeTemplate); placeTemplate = null; }
    var del = document.getElementById('btn-unit-delete');
    if (del) del.style.display = idx >= 0 ? '' : 'none';
    var hint = document.getElementById('unit-sel-hint');
    if (hint) {
      hint.textContent = idx >= 0
        ? 'or press Esc to go back to placing'
        : 'click a unit to edit it; click empty ground to place one';
    }
    layoutPanel(idx >= 0);
    refreshModeLine();
    render();
  }

  function onTileClick(t, evt, pt) {
    if (mode === 'terrain' && terrainBrush) {
      var b = terrainBrush;
      if (b.kind === 'terrain') { t.terrain = b.value; if (b.value === 'TERRAIN_WATER') { t.height = 'HEIGHT_FLAT'; t.vegetation = null; } }
      else if (b.kind === 'height') {
        t.height = b.value;
        // water cannot be raised: a hill/mountain/volcano brush turns the
        // tile into land, mirroring the water brush flattening the height
        if (t.terrain === 'TERRAIN_WATER' && b.value !== 'HEIGHT_FLAT') t.terrain = 'TERRAIN_TEMPERATE';
      }
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
        // select it; deleting is now an explicit button, so a misclick on a
        // finished unit no longer destroys it
        selectUnit(idx === selectedUnit ? -1 : idx);
        return;
      } else {
        var promos = checkedPromos();
        var hp = parseInt(document.getElementById('u-hp').value, 10);
        units.push({
          player: +document.getElementById('u-side').value,
          type: sel.value,
          q: t.q, r: t.r,
          hp: isNaN(hp) ? undefined : hp,
          promotions: promos.length ? promos : undefined,
          // A leader effect only exists in the game because a general is
          // attached to the unit (Unit.cs:2274 hasGeneral), so picking one
          // makes the unit a general. Without this, an author gets a unit
          // that reads as a general and grants a leader's flanking bonus but
          // is invisible to everything that asks "is this a general" —
          // king-of-the-hill shipped that way and its Hecklers did nothing.
          general: document.getElementById('u-general').checked
            || promos.some(function (pr) { return /_LEADER$/.test(pr); }) || undefined,
          anchored: (document.getElementById('u-anchored').checked && E.DATA.units[sel.value].bAnchor) || undefined,
        });
        // deliberately NOT selected: the panel stays a brush, so the next
        // thing you do — flip to Red, pick a different unit — configures the
        // NEXT placement rather than rewriting the one just stamped. Selecting
        // here turned the e2e's blue swordsman into a red archer.
        selectUnit(-1);
        return;
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
    if (objKind === 'maxKill') objective = { kind: 'maxKill' };
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
  // Paste JSON: the mirror of Copy JSON, so a puzzle can be moved between
  // machines, kept in a file, or forked from one you already exported.
  document.getElementById('btn-import').onclick = function () {
    var box = document.getElementById('out');
    box.innerHTML = '';
    var ta = document.createElement('textarea');
    ta.rows = 8; ta.style.width = '100%';
    ta.placeholder = 'Paste a puzzle JSON here (as produced by Copy JSON), then hit Load.';
    var go = document.createElement('button');
    go.className = 'act'; go.textContent = 'Load';
    go.style.marginTop = '6px';
    go.onclick = function () {
      var p;
      try { p = JSON.parse(ta.value); } catch (e) { return out('✗ that is not valid JSON: ' + e.message); }
      if (!p || !Array.isArray(p.units) || !p.units.length) return out('✗ no units in that JSON — is it a puzzle?');
      try { E.loadPuzzle(JSON.parse(JSON.stringify(p))); } catch (e) {
        return out('✗ the engine will not load it: ' + e.message);
      }
      try {
        localStorage.setItem('owpuzzle-editor-autosave', JSON.stringify(p));
        localStorage.removeItem('owpuzzle-draft-solution');
      } catch (e) { return out('✗ could not stash it: ' + e.message); }
      location.reload();
    };
    box.appendChild(ta);
    box.appendChild(go);
    ta.focus();
  };
  document.getElementById('btn-test').onclick = function () {
    if (!units.some(function (u) { return u.player === 0; })) return out('Place at least one blue unit first.');
    try {
      localStorage.setItem('owpuzzle-draft', JSON.stringify(buildPuzzle()));
    } catch (e) {
      // private windows / blocked storage: the one case the server fallback
      // exists for — but the handoff itself needs this slot, so say so
      // instead of a click that silently does nothing
      return out('\u2717 Your browser is blocking site storage, which test play needs. ' +
        'Allow storage for this site (or leave private browsing) and try again.');
    }
    location.href = './?draft=1';
  };
  var puzzleHash = E.puzzleHash;   // shared with the player, so a round trip matches

  function submitWith(p, sol) {
    // The recording already knows whether the author's own line met the
    // objective — no solver involved, the engine judged it during test play.
    // A non-solving reference line is probably a sloppy run (it cost a real
    // review round-trip once), but marathon boards sometimes get submitted
    // mid-polish on purpose, so warn, don't block.
    // …but only where "the objective" is a thing that exists yet: a maxKill
    // draft has no ceiling until review, so there is nothing for the line to
    // miss. Gate on the objective rather than on sol.met alone, so recordings
    // made before this fix (which stored met:false) do not warn either.
    if (sol.met === false && E.objectiveScorable(p.objective) && !confirm(
        'Your recorded test play did NOT meet the objective (' +
        (sol.strength / 10) + ' STR in ' + sol.orders + ' orders).\n\n' +
        'Reviewers use your line as the reference solution. Submit it anyway?')) {
      return out('Submission held \u2014 hit \u25b6 Test play and finish a winning line first.');
    }
    out('submitting\u2026 (with your solution: ' + (sol.strength / 10) + ' STR in ' + sol.orders + ' orders)');
    fetch('/api/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzle: p, solution: sol }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) return out('\u2717 ' + d.error);
      out('\u2713 ' + (d.message || "Thanks for submitting your puzzle \u2014 we'll review it!"));
      loadMine();
    }).catch(function () { out('\u2717 network error (are you logged in?)'); });
  }

  document.getElementById('btn-submit').onclick = function () {
    var p = buildPuzzle();
    // A submission must come with the author's own solution: play it through
    // Test play first. That gives the reviewer a known-good line, the kill
    // total and the order count — the things the editor cannot compute.
    var sol = null;
    try { sol = JSON.parse(localStorage.getItem('owpuzzle-draft-solution') || 'null'); } catch (e) {}
    // if this browser could not keep the recording, ask the server for its copy
    if (!sol || !sol.line || !sol.line.length || !sol.puzzle) {
      out('checking for your test play\u2026');
      return fetch('/api/draft-solution').then(function (r) { return r.json(); })
        .then(function (d) {
          var remote = d && d.solution;
          if (remote && remote.line && remote.line.length && remote.puzzle &&
              puzzleHash(remote.puzzle) === puzzleHash(p)) {
            return submitWith(p, remote);
          }
          out('\u2717 Play your own solution first: hit \u25b6 Test play, play your line, ' +
            'press End Turn, then come back and submit. (' +
            (!remote ? 'no recording found here or on the server'
              : (puzzleHash(remote.puzzle || {}) !== puzzleHash(p)
                ? 'the server has a recording, but of a different board'
                : 'the recording has no line')) + ')');
        }).catch(function () {
          out('\u2717 Could not reach the server to check your test play.');
        });
    }
    if (!sol || !sol.line || !sol.line.length) {
      // say what we actually found, so a report tells us something
      var why = !sol ? 'no recording was found'
        : (!sol.line ? 'the recording has no line'
          : 'the recorded line was empty — no orders were spent');
      return out('\u2717 Play your own solution first: hit \u25b6 Test play, play your line, ' +
        'press End Turn, then come back and submit. (' + why + ')');
    }
    // A record written by an older build has no board attached, so we cannot
    // tell whether the puzzle changed. Say that, rather than accusing the
    // author of editing something they never touched.
    if (!sol.puzzle) {
      return out('\u2717 The site updated since your test play, so that recording ' +
        'cannot be checked. Hit \u25b6 Test play once more and submit — your board is unchanged.');
    }
    if (puzzleHash(sol.puzzle) !== puzzleHash(p)) {
      return out('\u2717 You have changed the puzzle since your test play. ' +
        'Play it once more with \u25b6 Test play, then submit.');
    }
    submitWith(p, sol);
  };

  // ---------- your own submissions ----------
  function loadMine() {
    fetch('/api/my-puzzles').then(function (r) { return r.json(); }).then(function (d) {
      var mine = (d && d.mine) || [];
      if (!mine.length) return;
      document.getElementById('mine-wrap').style.display = '';
      document.getElementById('mine').innerHTML = mine.map(function (m) {
        var live = m.status === 'approved' || m.status === 'core';
        return '<div class="mine-row">' +
          '<span class="mine-name">' + esc(m.name) + '</span>' +
          '<span class="mine-status ' + m.status + '">' +
            (m.status === 'pending' ? 'in review' : m.status) + '</span>' +
          (live ? '<a href="./?p=' + encodeURIComponent(m.slug) + '">play</a>' : '') +
          '<a href="editor.html?load=' + encodeURIComponent(m.slug) + '">open</a>' +
          '</div>';
      }).join('');
    }).catch(function () {});
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  loadMine();

  // ---------- render ----------
  function render() {
    var list = Object.keys(tiles).map(function (k) { return tiles[k]; });
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    list.forEach(function (t) {
      minX = Math.min(minX, cx(t) - SIZE); maxX = Math.max(maxX, cx(t) + SIZE);
      minY = Math.min(minY, cy(t) - SIZE); maxY = Math.max(maxY, cy(t) + SIZE);
    });
    var S = ['<svg viewBox="' + (minX - 6) + ' ' + (minY - 6) + ' ' + (maxX - minX + 12) + ' ' + (maxY - minY + 12) + '" xmlns="http://www.w3.org/2000/svg">'];
    var clips = [];
    S.push('');   // slot for the clip defs, filled once the tiles are walked
    list.forEach(function (t) {
      var x = cx(t), y = cy(t);
      var fill = TERRAIN_FILL[t.terrain] || 'rgb(90,90,90)';
      if (t.height === 'HEIGHT_MOUNTAIN') fill = 'rgb(150,150,153)';
      S.push('<polygon points="' + hexPoints(x, y) + '" fill="' + fill + '" stroke="' + BOARD_BG + '" stroke-width="1" data-t="' + t.q + ',' + t.r + '"/>');
      // hills: light band over dark band, clipped to the hex — the same
      // drawing as the player (app.js:491-497). It used to be a narrow
      // free-floating bar here, so a hill you painted did not look like the
      // hill you played on.
      if (t.height === 'HEIGHT_HILL') {
        var hid = 'eclip' + t.q + '_' + t.r;
        clips.push('<clipPath id="' + hid + '"><polygon points="' + hexPoints(x, y) + '"/></clipPath>');
        S.push('<g clip-path="url(#' + hid + ')" pointer-events="none">' +
          '<rect x="' + (x - SIZE) + '" y="' + (y - SIZE) + '" width="' + (2 * SIZE) + '" height="' + (SIZE * 0.85) + '" fill="rgba(255,255,255,.16)"/>' +
          '<rect x="' + (x - SIZE) + '" y="' + (y + SIZE * 0.05) + '" width="' + (2 * SIZE) + '" height="' + SIZE + '" fill="rgba(0,0,0,.30)"/></g>');
      }
      // Same treatment as the player (app.js): vegetation tints the WHOLE hex
      // and gets an inset rim, so a wood with a unit standing in it still reads
      // as a wood. What you paint here has to look like what you play, or the
      // author is designing against a board they will never see.
      if (VEG_WASH[t.vegetation]) {
        S.push('<polygon points="' + hexPoints(x, y, 0.98) + '" fill="' + VEG_WASH[t.vegetation] + '" pointer-events="none"/>');
        S.push('<polygon points="' + hexPoints(x, y, 0.9) + '" fill="none" stroke="' + VEG_RIM[t.vegetation] + '" stroke-width="2.5" pointer-events="none"/>');
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
      var ic = unitIcon(u.type);
      var isFlag = !!ic && ic === ICONS['FLAG_' + u.type];
      if (ic && isFlag) S.push('<image href="' + ic + '" x="' + (x - SIZE * 0.32) + '" y="' + (y - SIZE * 0.08) + '" width="' + SIZE * 0.64 + '" height="' + SIZE * 0.64 + '"/>');
      else if (ic) S.push('<image href="' + ic + '" x="' + (x - SIZE * 0.4) + '" y="' + (y - SIZE * 0.16) + '" width="' + SIZE * 0.8 + '" height="' + SIZE * 0.8 + '"/>');
      if (u.general) S.push('<polygon points="' + (x - SIZE * 0.5) + ',' + (y - SIZE * 0.52) + ' ' + (x - SIZE * 0.5 + 14) + ',' + (y - SIZE * 0.52 + 4) + ' ' + (x - SIZE * 0.5) + ',' + (y - SIZE * 0.52 + 8) + '" fill="#ffd23e" stroke="' + BOARD_BG + '"/>');
      (u.promotions || []).forEach(function (pr, pi) {
        var bx = x + SIZE * 0.44, by = y - SIZE * 0.3 + pi * 15;
        S.push('<circle cx="' + bx + '" cy="' + by + '" r="8" fill="#ffd23e" stroke="' + BOARD_BG + '" stroke-width="1.2"/>');
        var pic = ICONS['EFFECT_' + pr.replace('EFFECTUNIT_', '')];
        if (pic) S.push('<image href="' + pic + '" x="' + (bx - 6.5) + '" y="' + (by - 6.5) + '" width="13" height="13"/>');
        else S.push('<text x="' + bx + '" y="' + (by + 1) + '" text-anchor="middle" dominant-baseline="middle" font-size="9" fill="#14161c">★</text>');
      });
      if (u.anchored) S.push('<text x="' + (x - SIZE * 0.44) + '" y="' + (y + SIZE * 0.05) + '" text-anchor="middle" font-size="13" pointer-events="none">⚓</text>');
      if (u.hp != null) S.push('<text x="' + x + '" y="' + (y + SIZE * 0.86) + '" text-anchor="middle" font-size="11" font-weight="bold" fill="#fff" stroke="' + BOARD_BG + '" stroke-width="2.5" paint-order="stroke" font-family="system-ui">' + u.hp + '</text>');
      if (i === selectedUnit) {
        S.push('<circle cx="' + x + '" cy="' + (y + SIZE * 0.24) + '" r="' + SIZE * 0.62 +
          '" fill="none" stroke="#ffffff" stroke-width="3"/>');
      }
      if (targets.indexOf(i) >= 0) {
        S.push('<text x="' + x + '" y="' + (y - SIZE * 0.6) + '" text-anchor="middle" dominant-baseline="middle" font-size="14">\ud83c\udfaf</text>');
      }
      S.push('</g>');
    });
    S.push('</svg>');
    if (clips.length) S[1] = '<defs>' + clips.join('') + '</defs>';
    refreshLimits();
    refreshObjectiveLine();
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
  // ---------- load / autosave / undo ----------
  // One way to put a board into the editor, used by the autosave restore and
  // by undo alike — two restore paths would drift apart.
  function applyState(saved) {
    if (!saved || !saved.units) return;
    radius = saved.radius || 3;
    document.getElementById('p-radius').value = radius;
    tiles = {};
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
    targets = (saved.objective && saved.objective.kind === 'killList')
      ? (saved.objective.targets || []) : [];
    ['name', 'brief', 'lesson'].forEach(function (f) {
      if (saved[f] != null) document.getElementById('p-' + f).value = saved[f];
    });
    if (saved.orders) document.getElementById('p-orders').value = saved.orders;
    if (saved.training != null) document.getElementById('p-training').value = saved.training;
    if (saved.objective) document.getElementById('p-objective').value = saved.objective.kind;
  }

  var restoring = true;
  try { applyState(JSON.parse(localStorage.getItem('owpuzzle-editor-autosave') || 'null')); }
  catch (e) {}
  restoring = false;

  // Undo history. Every render follows a change, so snapshotting there catches
  // every edit — painting, placing, removing, retyping a field — without
  // hunting down each mutation site.
  var past = [], future = [], travelling = false;
  var current = null;
  function labelHistory() {
    var u = document.getElementById('btn-undo'), r = document.getElementById('btn-redo');
    if (u) u.disabled = !past.length;
    if (r) r.disabled = !future.length;
  }
  function travel(stack, other) {
    if (!stack.length) return;
    other.push(current);
    var snap = stack.pop();
    travelling = true;
    applyState(JSON.parse(snap));
    current = snap;
    travelling = false;
    render();
    labelHistory();
  }
  document.getElementById('btn-undo').onclick = function () { travel(past, future); };
  document.getElementById('btn-redo').onclick = function () { travel(future, past); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && selectedUnit >= 0) {
      if (/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName || '')) return;
      e.preventDefault();
      selectUnit(-1);
      return;
    }
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '')) return;
    e.preventDefault();
    if (e.shiftKey) travel(future, past); else travel(past, future);
  });

  var origRender = render;
  render = function () {
    origRender();
    if (restoring) return;
    var snap;
    try { snap = JSON.stringify(buildPuzzle()); } catch (e) { return; }
    if (snap !== current) {
      if (current !== null && !travelling) { past.push(current); future.length = 0; }
      if (past.length > 100) past.shift();
      current = snap;
      labelHistory();
      try { localStorage.setItem('owpuzzle-editor-autosave', snap); } catch (e) {}
    }
  };
  render();
})();
