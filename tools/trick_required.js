#!/usr/bin/env node
// Is the trick REQUIRED, or merely available?
//
// Three of five drafts in one sitting died because the verifier found a duller
// line that reached the same ceiling without the idea the puzzle was built
// around. That question was answered by hand until now: delete the key move,
// re-search, squint. This does it mechanically.
//
// The method is NOT "search for the best line" — we already have three tools
// for that. It is: collect many STRUCTURALLY DIFFERENT lines that all reach the
// ceiling, then intersect them.
//
//   * an action in EVERY optimal line is FORCED — the puzzle cannot be solved
//     without it, which is exactly what "required" means
//   * an action the intended line uses that some other optimal line omits is
//     DECORATIVE — the trick is available, not required, and the puzzle is
//     telling the player a lesson they can ignore
//
// Novelty search is what makes the collection diverse: plain DFS returns a
// thousand rotations of one idea, and an intersection over near-identical
// lines reports everything as forced. We keep a line only when its behaviour
// descriptor is far enough from everything in the archive.
//
// Usage:
//   node tools/trick_required.js <puzzle.json|submission.json|puzzleId> [opts]
//     --target=<strength>   what counts as optimal (default: objective.count)
//     --seconds=<n>         search budget (default 120)
//     --line=<file.json>    the intended line, to report per-action verdicts
//     --archive=<n>         max diverse lines to keep (default 400)
//     --novelty=<0..1>      min descriptor distance to admit a line (default 0.15)
'use strict';
var fs = require('fs');
var path = require('path');
var E = require(path.join(__dirname, '..', 'web', 'engine.js'));

// ---------- args ----------
var args = process.argv.slice(2);
var opts = {};
var target0 = null;
args.filter(function (a) { return a.startsWith('--'); }).forEach(function (a) {
  var m = /^--([^=]+)=?(.*)$/.exec(a);
  opts[m[1]] = m[2] === '' ? true : m[2];
});
var ref = args.filter(function (a) { return !a.startsWith('--'); })[0];
if (!ref) {
  console.error('usage: node tools/trick_required.js <puzzle.json|puzzleId> [--target=N] [--seconds=N] [--line=f.json]');
  process.exit(2);
}

function loadPuzzleArg(ref) {
  if (ref.endsWith('.json')) {
    var raw = JSON.parse(fs.readFileSync(ref, 'utf8'));
    return raw.puzzle || raw;
  }
  var PUZZLES = require(path.join(__dirname, '..', 'web', 'puzzles.js'));
  var p = PUZZLES.filter(function (x) { return x.id === ref; })[0];
  if (!p) { console.error('no such puzzle: ' + ref); process.exit(2); }
  return p;
}

var P = loadPuzzleArg(ref);
var SECONDS = Number(opts.seconds || 120);
var ARCHIVE_MAX = Number(opts.archive || 400);
var NOVELTY = Number(opts.novelty || 0.15);
var TARGET = opts.target ? Number(opts.target)
  : (P.objective && P.objective.count) || null;

// Play conditions: the pool a player actually gets (par + slack), and the
// author's training budget. A ceiling proven under the wrong budget is a
// ceiling for a puzzle nobody is playing.
var INIT = E.loadPuzzle(P, { play: true });

if (!TARGET) {
  console.error('no target strength: puzzle has no objective.count — pass --target=<strength>');
  process.exit(2);
}

console.log('== ' + (P.name || P.id) + '  target ' + (TARGET / 10) + ' STR' +
  '  pool ' + INIT.orders + ' orders, training ' + INIT.training);

// ---------- the admissible bound ----------
// Two bounds, both admissible, so their min is admissible too.
//
// (1) ORDERS. Every kill costs at least one order, so at most `orders` more
//     reds can die. This is what compute_ceilings uses. It is correct and
//     very loose: it never notices that the units are spent.
//
// (2) COOLDOWN. Attacking sets cooldown='ATTACK' (engine.js:1074), and nothing
//     clears it for the rest of the turn — canAttack rejects any cooldown that
//     is not 'ROUT' (engine.js:779), canMove rejects every cooldown at all
//     (engine.js:679). So a unit on ATTACK cooldown can NEVER act again, and a
//     state where no blue unit can act kills nothing more, whatever the order
//     pool says. Measured on Bottleneck's end state: bound (1) says 570 with 5
//     orders left, bound (2) says 290, and 290 is the truth.
//
// NOT done here, deliberately: bounding a ROUT unit to the targets it can hit
// from where it stands. A rout ADVANCES the unit into the tile it just cleared
// (engine.js:1058) and it may attack again from there, so its reachable set
// grows as it chains. Restricting it to today's targets would be inadmissible
// — it would prune real lines — which is the one thing a bound may never do.
function stillActs(s, u) {
  return u.player === 0 && u.hp > 0 && (E.canAttack(s, u) || E.canMove(s, u));
}
function bound(s) {
  var cur = E.strKilledOf(s);
  var live = s.units.filter(function (u) { return u.player === 1 && u.hp > 0; })
    .map(function (u) { return E.DATA.units[u.type].iStrength; })
    .sort(function (a, b) { return b - a; });
  if (!live.length) return cur;
  var anyActor = s.units.some(function (u) { return stillActs(s, u); });
  if (!anyActor) return cur;                       // bound (2) at its sharpest
  var k = Math.min(live.length, s.orders);         // bound (1)
  var b = cur;
  for (var i = 0; i < k; i++) b += live[i];
  return b;
}

// ---------- behaviour descriptor ----------
// What makes two lines "the same idea"? Not their order — the same three blows
// in a different sequence is one idea. We describe a line by the SET of things
// it did and where it stood, so permutations collapse and genuinely different
// shapes stay apart.
function actionSig(s, a) {
  if (a.type === 'attack') return 'A:' + a.unit + '>' + a.target;
  if (a.type === 'move') return 'M:' + a.unit + '@' + a.q + ',' + a.r;
  return a.type + ':' + a.unit;
}
function descriptorOf(line) {
  var set = {};
  line.forEach(function (x) { set[x.sig] = true; });
  return Object.keys(set).sort();
}
function jaccard(a, b) {
  var A = {}, n = 0, i;
  for (i = 0; i < a.length; i++) A[a[i]] = true;
  for (i = 0; i < b.length; i++) if (A[b[i]]) n++;
  var union = a.length + b.length - n;
  return union === 0 ? 0 : 1 - n / union;
}

// ---------- novelty-gated collection ----------
var archive = [];        // [{desc, line, str, orders}]
var canConcludeFromSeeds = false;
var deadline = Date.now() + SECONDS * 1000;
var nodes = 0, hits = 0, timedOut = false, exhausted = true;
var seen = new Set();

function novelEnough(desc) {
  // distance to the nearest archived descriptor; the archive is small enough
  // that a linear scan is cheaper than any index we would have to maintain
  var best = 1;
  for (var i = 0; i < archive.length; i++) {
    var d = jaccard(desc, archive[i].desc);
    if (d < best) best = d;
    if (best === 0) return false;
  }
  return best >= NOVELTY;
}

function record(line, str, ordersUsed) {
  hits++;
  var desc = descriptorOf(line);
  if (archive.length >= ARCHIVE_MAX) return;
  if (!novelEnough(desc)) return;
  archive.push({ desc: desc, line: line.slice(), str: str, orders: ordersUsed });
}

// Depth-first order decides whether this finds anything at all. Unordered,
// legalActions leads with whatever the unit list happens to offer and the
// search drowns: 250k states on Bottleneck without reaching the ceiling once.
// Kills first (biggest prize first), then real damage, then repositioning —
// and among moves, toward the enemy, because a tile that touches nothing is
// only ever a staging step.
function ordered(s) {
  var reds = s.units.filter(function (u) { return u.player === 1 && u.hp > 0; });
  function nearestRed(q, r) {
    var best = 99;
    reds.forEach(function (t) {
      var d = E.hexDistance({ q: q, r: r }, t);
      if (d < best) best = d;
    });
    return best;
  }
  return E.legalActions(s).map(function (a) {
    var score;
    if (a.type === 'attack') {
      var att = E.unitById(s, a.unit), def = E.unitById(s, a.target);
      var pv = E.previewAttack(s, a.unit, a.target);
      var worth = E.DATA.units[def.type].iStrength;
      score = pv.kills ? 1e6 + worth : 1e3 + pv.damage;
      if (pv.rout) score += 5e5;              // a rout buys another action
      void att;
    } else if (a.type === 'move') {
      score = 100 - nearestRed(a.q, a.r);
    } else {
      score = 50;
    }
    return { a: a, score: score };
  }).sort(function (x, y) { return y.score - x.score; })
    .map(function (x) { return x.a; });
}

function stateKey(s) {
  return s.orders + '|' + s.units.map(function (u) {
    return u.q + ',' + u.r + ',' + Math.max(0, u.hp) + ',' + (u.cooldown || 0) + ',' + u.steps;
  }).join(';');
}

// The intended line is a known-optimal answer; seed it so the intersection has
// something to intersect against even when the search finds nothing else. That
// is also the honest framing of the question: not "can anything reach the
// ceiling" but "can anything reach it that does NOT do what the author did".
// --line may be repeated. Every line a player or reviewer has already found is
// free evidence: two known optimal lines that differ anywhere prove that
// difference is not required, with no search at all.
var lineFiles = args.filter(function (a) { return a.startsWith('--line='); })
  .map(function (a) { return a.slice(7); });
var intendedSigs = null;
lineFiles.forEach(function (lf, idx) {
  var seedRaw = JSON.parse(fs.readFileSync(lf, 'utf8'));
  var seedActs = seedRaw.line || seedRaw;
  var ss = E.loadPuzzle(P, { play: true });
  var seedLine = [];
  for (var si = 0; si < seedActs.length; si++) {
    seedLine.push({ sig: actionSig(ss, seedActs[si]), act: seedActs[si] });
    ss = E.applyAction(ss, seedActs[si]);
  }
  var seedStr = E.strKilledOf(ss);
  if (seedStr >= TARGET) {
    var d = descriptorOf(seedLine);
    if (idx === 0) intendedSigs = d;
    archive.push({ desc: d, line: seedLine, str: seedStr,
      orders: INIT.orders - ss.orders, seeded: true });
    console.log('  known line ' + (idx + 1) + ': ' + (seedStr / 10) + ' STR in ' +
      (INIT.orders - ss.orders) + ' orders  (' + path.basename(lf) + ')');
  } else {
    console.log('  NOTE: ' + path.basename(lf) + ' reaches only ' + (seedStr / 10) +
      ' STR, below the target — not counted');
  }
});
// Two supplied lines already intersect into evidence, even with no search.
if (lineFiles.length >= 2) canConcludeFromSeeds = true;

(function search(s, line) {
  if (Date.now() > deadline) { timedOut = true; exhausted = false; return; }
  nodes++;
  var str = E.strKilledOf(s);
  if (str >= TARGET) { record(line, str, INIT.orders - s.orders); return; }
  if (bound(s) < TARGET) return;                 // cannot reach the ceiling
  var acts = ordered(s);
  for (var i = 0; i < acts.length; i++) {
    if (Date.now() > deadline) { timedOut = true; exhausted = false; return; }
    var ns;
    try { ns = E.applyAction(s, acts[i]); } catch (e) { continue; }
    var k = stateKey(ns);
    if (seen.has(k)) continue;
    seen.add(k);
    search(ns, line.concat([{ sig: actionSig(s, acts[i]), act: acts[i] }]));
  }
})(INIT, []);

// ---------- verdict ----------
console.log('  searched ' + nodes + ' states in ' + SECONDS + 's' +
  (timedOut ? ' (TIMED OUT — the intersection below is over the lines found, not all lines)' : ' (exhausted)') +
  ' · ' + hits + ' optimal lines reached, ' + archive.length + ' structurally distinct kept');

if (!archive.length) {
  console.log('\n  NO line reached ' + (TARGET / 10) + ' STR' +
    (timedOut ? ' within the budget — inconclusive, raise --seconds' :
      ' — the target is not achievable, so the ceiling is wrong'));
  process.exit(1);
}

// An action in every distinct optimal line is forced — but ONLY if we actually
// looked. Intersecting one line marks all twelve of its actions "forced", which
// is not a finding, it is a tautology dressed as one. The first version of this
// tool printed exactly that for Bottleneck, calling `move -> -2,-1` REQUIRED
// while a known 14-order line reaches the same ceiling via -2,0. A tool that
// answers "is the trick required" with false confidence is worse than no tool.
var independent = archive.filter(function (a) { return !a.seeded; }).length;
var canConclude = exhausted || independent >= 1 || canConcludeFromSeeds;

var forced = archive[0].desc.filter(function (sig) {
  return archive.every(function (a) { return a.desc.indexOf(sig) >= 0; });
});
var anySig = {};
archive.forEach(function (a) { a.desc.forEach(function (s) { anySig[s] = true; }); });

if (!canConclude) {
  console.log('\n  INCONCLUSIVE — the search timed out without finding a single line of its');
  console.log('  own, so there is nothing to intersect against' +
    (archive.length ? ' but the line you supplied' : '') + '. This says nothing');
  console.log('  about whether the trick is required. Raise --seconds, or supply more');
  console.log('  known lines with repeated --line=<file> and intersect those.');
  process.exit(3);
}

console.log('\n  FORCED — in all ' + archive.length + ' distinct optimal lines' +
  (exhausted ? ' (search exhausted: this is a proof)' : ' (search incomplete: not refuted, not proven)') + ':');
if (!forced.length) console.log('    (none — every single action can be avoided by some other optimal line)');
forced.forEach(function (s) { console.log('    ' + describe(s)); });

console.log('\n  OPTIONAL — used by some optimal lines but not all: ' +
  (Object.keys(anySig).length - forced.length) + ' actions');
Object.keys(anySig).sort().forEach(function (s) {
  if (forced.indexOf(s) < 0) console.log('    ' + describe(s));
});

function describe(sig) {
  var m = /^A:(\d+)>(\d+)$/.exec(sig);
  if (m) return 'attack: ' + nameOf(+m[1]) + ' -> ' + nameOf(+m[2]);
  var mm = /^M:(\d+)@(.+)$/.exec(sig);
  if (mm) return 'move:   ' + nameOf(+mm[1]) + ' -> ' + mm[2];
  return sig;
}
function nameOf(id) {
  var u = INIT.units.filter(function (x) { return x.id === id; })[0];
  return u ? u.type.replace('UNIT_', '').toLowerCase() + '#' + id + (u.player ? '(red)' : '(blue)') : '#' + id;
}

// ---------- judge the intended line, if given ----------
if (lineFiles.length) {
  var intended = JSON.parse(fs.readFileSync(lineFiles[0], 'utf8'));
  var acts = intended.line || intended;
  var s = E.loadPuzzle(P, { play: true });
  var sigs = [];
  for (var i = 0; i < acts.length; i++) {
    sigs.push(actionSig(s, acts[i]));
    s = E.applyAction(s, acts[i]);
  }
  console.log('\n  THE INTENDED LINE (' + E.strKilledOf(s) / 10 + ' STR):');
  var decorative = 0;
  sigs.forEach(function (sig, i) {
    var isForced = forced.indexOf(sig) >= 0;
    if (!isForced) decorative++;
    console.log('    ' + (i + 1) + '. ' + (isForced ? '[REQUIRED] ' : '[avoidable] ') + describe(sig));
  });
  console.log('\n  ' + (decorative === 0
    ? 'Every action is forced: the trick is REQUIRED.'
    : decorative + ' of ' + sigs.length + ' actions are avoidable — some other optimal line ' +
      'skips them. If the puzzle\'s idea is among those, the lesson is not required.'));
}
