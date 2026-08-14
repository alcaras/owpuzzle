#!/usr/bin/env node
// Export an owpuzzle board as a real, loadable Old World save (.zip), via the
// engine harness's --puzzle mode (owearlysim/engine-harness, RunPuzzle).
//
//   node tools/export_save.js over-the-hills
//   node tools/export_save.js submissions/closing-in-8f4afe.json --out /tmp/x.zip
//
// The harness only places units and sets heights, onto a corner of a full
// generated world. So we do the rest ourselves: after it writes the save, we
// rewrite the tiles inside the .zip — terrain, trees and rivers forced to the
// puzzle, everything beyond the play radius turned to ocean, so what loads is
// the puzzle's own small island rather than a continent. The order and
// training budgets are set from the puzzle too.
//
// What still does not carry: the objective (a save has no win condition) and
// the general flag. Both are reported per export.
//
// COORDINATES: our boards are axial (q,r) pointy-top; Old World's grid is a
// half-row-offset grid whose rows run NORTH as y grows, so dy = -r. The
// adjacency was measured from the harness's own reach ring; the north/south
// sense was settled by comparing a screenshot of the game against the same
// board on the site (a distance check cannot catch it — reflections preserve
// every distance, which is why the first version shipped mirrored). The
// half-row shear depends on the parity of the arena centre row, which the
// harness picks, so we emit, read back the centre, and re-emit if the parity
// guess was wrong.
//
// Every export self-checks: unit geometry, every play-area tile against the
// puzzle (terrain/height/trees/rivers), an ocean ring, and a load back
// through the engine's own save loader.

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var HARNESS = '/Users/dominik/Library/CloudStorage/Dropbox/cc/owearlysim/engine-harness';
var DLL = path.join(HARNESS, 'bin/Debug/net10.0/GameHarness.dll');
var DATA = require(path.join(__dirname, '..', 'web', 'data.js'));

function par(n) { return ((n % 2) + 2) % 2; }
function ceilHalf(n) { return (n + par(n)) / 2; }
function floorHalf(n) { return (n - par(n)) / 2; }

// Axial (q,r) -> arena offset (dx,dy).
//
// Old World's grid rows run NORTH as y increases; our r runs SOUTH down the
// screen, so dy = -r. Getting this backwards mirrors the whole board top to
// bottom — which is exactly what shipped first, and it survived the distance
// check because a reflection preserves every pairwise distance. The half-row
// shear depends on the parity of the arena centre row, which the harness
// picks, hence cyPar.
function toGrid(q, r, cyPar) {
  var shear = cyPar === 0 ? ceilHalf(r) : floorHalf(r);
  return { dx: q + shear, dy: -r };
}
// arena offset -> axial, the exact inverse (used to verify what came back)
function fromGrid(dx, dy, cyPar) {
  var r = -dy;
  var shear = cyPar === 0 ? ceilHalf(r) : floorHalf(r);
  return { q: dx - shear, r: r };
}

function hexDist(a, b) {
  var dq = a.q - b.q, dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function loadPuzzle(arg) {
  if (/\.json$/.test(arg)) {
    var j = JSON.parse(fs.readFileSync(arg, 'utf8'));
    return j.puzzle || j;
  }
  var lib = require(path.join(__dirname, '..', 'web', 'puzzles.js'));
  var p = lib.filter(function (x) { return x.id === arg; })[0];
  if (!p) throw new Error('no puzzle with id ' + arg + ' in web/puzzles.js');
  return p;
}

function unitInfo(type) {
  var u = DATA.units && DATA.units[type];
  if (!u) throw new Error('unknown unit type ' + type);
  return u;
}

// What the harness cannot represent — reported, never silently dropped.
function dropped(pz) {
  var out = [];
  var terr = {}, veg = 0, riv = 0, imp = 0;
  (pz.tiles || []).forEach(function (t) {
    if (t.terrain) terr[t.terrain] = (terr[t.terrain] || 0) + 1;
    if (t.vegetation) veg++;
    if (t.river && t.river.length) riv++;
    if (t.improvement) imp++;
  });
  Object.keys(terr).forEach(function (k) { out.push(terr[k] + '× ' + k); });
  if (veg) out.push(veg + '× vegetation');
  if (riv) out.push(riv + '× river edge');
  if (imp) out.push(imp + '× improvement');
  var gens = (pz.units || []).filter(function (u) { return u.general; }).length;
  if (gens) out.push(gens + '× general flag');
  return out;
}

function buildSpec(pz, cyPar) {
  var punits = (pz.units || []).map(function (u) {
    var g = toGrid(u.q, u.r, cyPar);
    var info = unitInfo(u.type);
    var dmg = (u.hp != null && u.hp < info.iHPMax) ? (info.iHPMax - u.hp) : 0;
    var promos = (u.promotions || []).join('+');
    return [u.type, g.dx + ',' + g.dy, u.player, promos, dmg || '',
            u.fortifyTurns || ''].join('@').replace(/@+$/, '');
  }).join(';');
  // Every tile of the play area gets an EXPLICIT height. The harness's arena
  // is only cleared of vegetation, not levelled — natural hills survive under
  // tiles the puzzle never mentions, and a unit standing on an unasked-for
  // hill fights with a height bonus it should not have. Measured, not
  // assumed: over-the-hills first exported with its warrior on a stray hill.
  var given = {};
  (pz.tiles || []).forEach(function (t) {
    if (t.height) given[t.q + ',' + t.r] = t.height;
  });
  var radius = pz.radius != null ? pz.radius : 3;
  var area = {};
  for (var q = -radius; q <= radius; q++) {
    for (var r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      area[q + ',' + r] = { q: q, r: r };
    }
  }
  (pz.tiles || []).forEach(function (t) { area[t.q + ',' + t.r] = { q: t.q, r: t.r }; });
  (pz.units || []).forEach(function (u) { area[u.q + ',' + u.r] = { q: u.q, r: u.r }; });
  var pheights = Object.keys(area).map(function (k) {
    var c = area[k];
    var g = toGrid(c.q, c.r, cyPar);
    return g.dx + ',' + g.dy + '=' + (given[k] || 'HEIGHT_FLAT');
  }).join(';');
  return { punits: punits, pheights: pheights, levelled: Object.keys(area).length };
}

function runHarness(pz, spec, outPath) {
  var args = ['--puzzle', '1', '--nation0', 'NATION_GREECE', '--nation1', 'NATION_PERSIA',
              '--name', pz.name || pz.id, '--punits', spec.punits, '--out', outPath];
  if (spec.pheights) args.push('--pheights', spec.pheights);
  var r = cp.spawnSync('dotnet', [DLL].concat(args), {
    cwd: HARNESS, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  var line = (r.stdout || '').split('\n').filter(function (l) { return l.trim()[0] === '{'; }).pop();
  if (!line) throw new Error('harness produced no JSON:\n' + (r.stdout || '') + (r.stderr || ''));
  var j = JSON.parse(line);
  if (j.error) throw new Error('harness: ' + j.error);
  return j;
}

// The emitted board must be the same shape as the puzzle: same multiset of
// pairwise hex distances, same owners, same hp.
//
// Note what this canNOT check: whether the board appears rotated or mirrored
// on screen. Distances survive every reflection, and no engine-side data says
// which way the grid faces when drawn. That convention (Old World's rows run
// north as y grows, so dy = -r) was settled by comparing a screenshot of the
// game against the same board on the site, and it lives in toGrid().
function verify(pz, res, cyPar) {
  var mine = (pz.units || []).map(function (u) {
    var info = unitInfo(u.type);
    return { q: u.q, r: u.r, player: u.player, hp: u.hp != null ? u.hp : info.iHPMax };
  });
  var theirs = (res.units || []).map(function (u) {
    var a = fromGrid(u.x - res.center[0], u.y - res.center[1], cyPar);
    return { q: a.q, r: a.r, player: u.player, hp: u.hp };
  });
  if (mine.length !== theirs.length) {
    return { ok: false, why: 'unit count ' + mine.length + ' -> ' + theirs.length };
  }
  // match by (player, hp) then check every pairwise distance
  var used = {}, map = [];
  for (var i = 0; i < mine.length; i++) {
    var found = -1;
    for (var j = 0; j < theirs.length; j++) {
      if (used[j]) continue;
      if (theirs[j].player === mine[i].player && theirs[j].hp === mine[i].hp) { found = j; break; }
    }
    if (found < 0) return { ok: false, why: 'no emitted unit matches player ' + mine[i].player + ' hp ' + mine[i].hp };
    used[found] = 1; map.push(found);
  }
  for (var a = 0; a < mine.length; a++) {
    for (var b = a + 1; b < mine.length; b++) {
      var d1 = hexDist(mine[a], mine[b]);
      var d2 = hexDist(theirs[map[a]], theirs[map[b]]);
      if (d1 !== d2) {
        return { ok: false, why: 'distance u' + a + '-u' + b + ' is ' + d1 + ' here, ' + d2 + ' in the save' };
      }
    }
  }
  return { ok: true, n: mine.length };
}

// ---------------------------------------------------------------------------
// Making the save actually faithful.
//
// The harness's puzzle mode can only place units and set heights: it has no
// grammar for terrain, trees or rivers, and it drops the board onto a corner
// of a full generated world. Everything else we do ourselves, by rewriting the
// tiles in the emitted save — the same XML the game writes and reads.
//
// Inside the puzzle radius each tile is forced to exactly what the puzzle
// says. Outside it, the world becomes ocean, so what loads is the puzzle's own
// small island instead of a continent with a city site on it.
// ---------------------------------------------------------------------------

var MAP_W = 52;   // OW grid stride for MAPSIZE_SMALLEST; tile ID = y*W + x

// our DIRS order: 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE.
// A tile owns its W, SW and SE river edges; the other three belong to the
// neighbour on that side (Tile.cs:4430 — isRiverNE() reads the NE tile's SW).
var RIVER_OWN = { 3: 'RiverW', 4: 'RiverSW', 5: 'RiverSE' };
var RIVER_NEIGHBOUR = { 0: ['RiverW', 1, 0], 1: ['RiverSW', 1, -1], 2: ['RiverSE', 0, -1] };

function riverEdges(pz) {
  var out = {};   // "q,r" -> {RiverW:1, ...}
  function set(q, r, tag) { (out[q + ',' + r] = out[q + ',' + r] || {})[tag] = 1; }
  (pz.tiles || []).forEach(function (t) {
    (t.river || []).forEach(function (d) {
      if (RIVER_OWN[d]) return set(t.q, t.r, RIVER_OWN[d]);
      var n = RIVER_NEIGHBOUR[d];
      if (n) set(t.q + n[1], t.r + n[2], n[0]);
    });
  });
  return out;
}

function setTag(body, tag, value) {
  var re = new RegExp('<' + tag + '>[^<]*</' + tag + '>');
  if (re.test(body)) return body.replace(re, '<' + tag + '>' + value + '</' + tag + '>');
  return body.replace(/<Height>[^<]*<\/Height>/,
    function (m) { return m + '<' + tag + '>' + value + '</' + tag + '>'; });
}
function dropTag(body, tag) {
  return body
    .replace(new RegExp('<' + tag + '>[\\s\\S]*?</' + tag + '>', 'g'), '')
    .replace(new RegExp('<' + tag + ' ?/>', 'g'), '');
}

function rewriteTiles(xml, pz, res, cyPar) {
  var cx = res.center[0], cy = res.center[1];
  var radius = pz.radius != null ? pz.radius : 3;
  var byKey = {};
  (pz.tiles || []).forEach(function (t) { byKey[t.q + ',' + t.r] = t; });
  var rivers = riverEdges(pz);
  var stats = { inside: 0, ocean: 0, trees: 0, riverEdges: 0 };

  var parts = xml.split('<Tile ID="');
  for (var i = 1; i < parts.length; i++) {
    var chunk = parts[i];
    var close = chunk.indexOf('</Tile>');
    if (close < 0) continue;
    var id = parseInt(chunk.slice(0, chunk.indexOf('"')), 10);
    var head = chunk.slice(0, close);
    var tail = chunk.slice(close);
    var bodyStart = head.indexOf('>') + 1;
    var body = head.slice(bodyStart);

    var a = fromGrid((id % MAP_W) - cx, Math.floor(id / MAP_W) - cy, cyPar);
    var inside = Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(a.q + a.r)) <= radius;
    var t = inside ? (byKey[a.q + ',' + a.r] || {}) : null;

    var terrain = inside ? (t.terrain || 'TERRAIN_TEMPERATE') : 'TERRAIN_WATER';
    var height = inside ? (t.height || 'HEIGHT_FLAT') : 'HEIGHT_FLAT';
    var veg = inside ? (t.vegetation || null) : null;

    body = setTag(body, 'Terrain', terrain);
    body = setTag(body, 'Height', height);
    body = dropTag(body, 'Vegetation');
    if (veg) { body = setTag(body, 'Vegetation', veg); stats.trees++; }

    // resources, ruins, tribe camps and city sites are scenery the puzzle
    // never had — and a city site under a unit changes what the tile is worth
    ['Resource', 'TribeSite', 'Improvement', 'RevealedImprovement',
     'CitySite', 'RevealedCitySite'].forEach(function (tag) { body = dropTag(body, tag); });

    // the remembered copy each team carries has to agree with the new tile,
    // or the player sees the map they "remember" instead of the one that is there
    body = body.replace(/Terrain="[^"]*"/g, 'Terrain="' + terrain + '"')
               .replace(/Height="[^"]*"/g, 'Height="' + height + '"');
    body = dropTag(body, 'RevealedVegetation');

    var edges = (inside && rivers[a.q + ',' + a.r]) || {};
    ['RiverW', 'RiverSW', 'RiverSE'].forEach(function (tag) {
      var on = edges[tag] ? 1 : 0;
      if (on) stats.riverEdges++;
      var re = new RegExp('<' + tag + '>[^<]*</' + tag + '>');
      if (re.test(body)) body = body.replace(re, '<' + tag + '>' + on + '</' + tag + '>');
      else if (on) body = body.replace(/<InitSeed>/, '<' + tag + '>1</' + tag + '><InitSeed>');
    });

    if (inside) stats.inside++; else stats.ocean++;
    parts[i] = chunk.slice(0, bodyStart) + body + tail;
  }
  var out = parts.join('<Tile ID="');

  // the puzzle's own budgets (yields are stored ×10)
  if (pz.orders != null) {
    out = out.replace(/<YIELD_ORDERS>\d+<\/YIELD_ORDERS>/g,
      '<YIELD_ORDERS>' + (pz.orders * 10) + '</YIELD_ORDERS>');
  }
  if (pz.training != null) {
    out = out.replace(/<YIELD_TRAINING>\d+<\/YIELD_TRAINING>/g,
      '<YIELD_TRAINING>' + (pz.training * 10) + '</YIELD_TRAINING>');
  }
  return { xml: out, stats: stats };
}

// Rewrite the tiles inside the emitted .zip, in place.
function makeFaithful(outPath, pz, res, cyPar) {
  var work = outPath + '.work';
  cp.execSync('rm -rf ' + JSON.stringify(work) + ' && mkdir -p ' + JSON.stringify(work));
  cp.execSync('unzip -q -o ' + JSON.stringify(outPath) + ' -d ' + JSON.stringify(work));
  var entry = fs.readdirSync(work).filter(function (f) { return /\.xml$/.test(f); })[0];
  if (!entry) throw new Error('no .xml inside the emitted save');
  var file = path.join(work, entry);
  var r = rewriteTiles(fs.readFileSync(file, 'utf8'), pz, res, cyPar);
  fs.writeFileSync(file, r.xml, 'utf8');
  fs.unlinkSync(outPath);
  cp.execSync('cd ' + JSON.stringify(work) + ' && zip -q -X ' + JSON.stringify(outPath) + ' ' + JSON.stringify(entry));
  cp.execSync('rm -rf ' + JSON.stringify(work));
  return r.stats;
}

// Read the finished save back and check every play-area tile against the
// puzzle: terrain, height, trees and river edges. This is the check that would
// have caught the export shipping a board the puzzle never described.
function auditBoard(pz, res, outPath, cyPar) {
  var xml;
  try {
    xml = cp.execSync('unzip -p ' + JSON.stringify(outPath), {
      encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) { return { skipped: 'could not read back the save (' + e.message + ')' }; }
  var T = {};
  xml.split('<Tile ID="').slice(1).forEach(function (chunk) {
    var id = parseInt(chunk.slice(0, chunk.indexOf('"')), 10);
    var end = chunk.indexOf('</Tile>');
    var body = end > 0 ? chunk.slice(0, end) : chunk;
    function tag(t) { var m = new RegExp('<' + t + '>([^<]*)</' + t + '>').exec(body); return m ? m[1] : null; }
    T[id] = { terrain: tag('Terrain'), height: tag('Height'), veg: tag('Vegetation'),
              RiverW: tag('RiverW'), RiverSW: tag('RiverSW'), RiverSE: tag('RiverSE') };
  });
  if (!Object.keys(T).length) return { skipped: 'no tiles parsed from the save' };

  var cx = res.center[0], cy = res.center[1];
  var radius = pz.radius != null ? pz.radius : 3;
  var byKey = {};
  (pz.tiles || []).forEach(function (t) { byKey[t.q + ',' + t.r] = t; });
  var rivers = riverEdges(pz);
  var bad = [], n = 0, oceanRing = 0;

  for (var q = -radius; q <= radius; q++) {
    for (var r = -radius; r <= radius; r++) {
      if (Math.abs(q + r) > radius) continue;
      var g = toGrid(q, r, cyPar);
      var got = T[(cy + g.dy) * MAP_W + (cx + g.dx)];
      if (!got) continue;
      n++;
      var t = byKey[q + ',' + r] || {};
      var want = {
        terrain: t.terrain || 'TERRAIN_TEMPERATE',
        height: t.height || 'HEIGHT_FLAT',
        veg: t.vegetation || null,
      };
      if (got.terrain !== want.terrain) bad.push(q + ',' + r + ' terrain ' + got.terrain);
      else if (got.height !== want.height) bad.push(q + ',' + r + ' height ' + got.height);
      else if ((got.veg || null) !== want.veg) bad.push(q + ',' + r + ' vegetation ' + got.veg);
      var edges = rivers[q + ',' + r] || {};
      ['RiverW', 'RiverSW', 'RiverSE'].forEach(function (tag) {
        var on = got[tag] === '1';
        if (on !== !!edges[tag]) bad.push(q + ',' + r + ' ' + tag + (on ? ' extra' : ' missing'));
      });
    }
  }
  // the ring just outside the board should be ocean, or it isn't an island
  for (var d = 0; d < 6; d++) {
    var edge = toGrid((radius + 1) * [1, 1, 0, -1, -1, 0][d], (radius + 1) * [0, -1, -1, 0, 1, 1][d], cyPar);
    var e = T[(cy + edge.dy) * MAP_W + (cx + edge.dx)];
    if (e && e.terrain === 'TERRAIN_WATER') oceanRing++;
  }
  return { n: n, bad: bad, oceanRing: oceanRing };
}

// Load the emitted file back through the game's own save loader (the same
// path Old World uses). Anything malformed fails here rather than in front of
// a player staring at a load screen.
function loadTest(outPath) {
  var r = cp.spawnSync('dotnet', [DLL, '--combatserver', '--save', outPath], {
    cwd: HARNESS, encoding: 'utf8', input: '__QUIT__\n', maxBuffer: 32 * 1024 * 1024,
  });
  return /\{"ready":true\}/.test(r.stdout || '');
}

function main() {
  var argv = process.argv.slice(2);
  if (!argv.length) {
    console.error('usage: node tools/export_save.js <puzzle-id|submission.json> [--out file.zip]');
    process.exit(2);
  }
  var target = argv[0];
  var outIdx = argv.indexOf('--out');
  var pz = loadPuzzle(target);
  // default output lands in the Dropbox folder that syncs to the Windows box
  var outPath = outIdx > 0 ? argv[outIdx + 1]
    : path.join(process.env.HOME, 'Dropbox', 'cc', 'owpuzzle-saves',
                'owpuzzle-' + (pz.id || 'puzzle') + '.zip');

  if (!fs.existsSync(DLL)) {
    console.error('engine harness not built: ' + DLL);
    console.error('build it with: cd ' + HARNESS + ' && make');
    process.exit(1);
  }

  // The arena centre's row parity is the harness's choice, so try one, read
  // back what it picked, and re-emit if the guess was wrong.
  var res = null, cyPar = 0, spec = null;
  for (var attempt = 0; attempt < 3; attempt++) {
    spec = buildSpec(pz, cyPar);
    res = runHarness(pz, spec, outPath);
    var actual = ((res.center[1] % 2) + 2) % 2;
    if (actual === cyPar) break;
    cyPar = actual;
  }

  var check = verify(pz, res, cyPar);
  var faithful = makeFaithful(outPath, pz, res, cyPar);
  var lost = dropped(pz);

  console.log('puzzle : ' + (pz.name || pz.id) + '  (' + (pz.units || []).length + ' units, '
    + (pz.orders != null ? pz.orders + ' orders, ' : '') + (pz.objective ? pz.objective.kind : '?') + ')');
  console.log('save   : ' + outPath + '  (' + (fs.statSync(outPath).size / 1024).toFixed(1) + ' KB)');
  console.log('arena  : centre ' + res.center.join(',') + ' (row parity ' + cyPar + '), turn ' + res.turn);
  console.log('board  : ' + faithful.inside + ' tiles rewritten to the puzzle ('
    + faithful.trees + ' wooded, ' + faithful.riverEdges + ' river edges), '
    + faithful.ocean + ' tiles beyond it turned to ocean');
  console.log('dropped: ' + (lost.length ? lost.join(', ') : 'nothing')
    + '  [always: the objective — the save has no win condition]');
  var audit = auditBoard(pz, res, outPath, cyPar);
  if (audit.skipped) {
    console.log('tiles  : not audited — ' + audit.skipped);
  } else {
    console.log('tiles  : ' + (audit.bad.length
      ? 'MISMATCH on ' + audit.bad.length + ' — ' + audit.bad.slice(0, 4).join('; ')
      : 'OK — all ' + audit.n + ' play-area tiles match terrain, height, trees and rivers')
      + '; ' + audit.oceanRing + '/6 surrounding tiles are ocean');
    if (audit.bad.length) process.exitCode = 1;
  }
  console.log('geometry: ' + (check.ok
    ? 'OK — all ' + (check.n * (check.n - 1) / 2) + ' pairwise hex distances match'
    : 'MISMATCH — ' + check.why));
  var loads = loadTest(outPath);
  console.log('load    : ' + (loads
    ? 'OK — the engine\'s own save loader accepts it'
    : 'FAILED — the engine could not load the file back'));
  if (!check.ok || !loads) process.exit(1);
}

main();
