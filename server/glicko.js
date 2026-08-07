// Glicko-2 (http://www.glicko.net/glicko/glicko2.pdf), one-game-at-a-time.
// Ratings stored in Glicko scale (r ~1500, rd ~350); math in Glicko-2 scale.
'use strict';

const TAU = 0.5;           // volatility constraint
const SCALE = 173.7178;
const BASE = 1500;

function toG2(r, rd) { return { mu: (r - BASE) / SCALE, phi: rd / SCALE }; }
function fromG2(mu, phi) { return { rating: mu * SCALE + BASE, rd: phi * SCALE }; }

function g(phi) { return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI)); }
function E(mu, muj, phij) { return 1 / (1 + Math.exp(-g(phij) * (mu - muj))); }

// Update one player against one opponent with score s (1 win, 0 loss).
// a = {rating, rd, vol}; b = {rating, rd}; returns new {rating, rd, vol}.
function update(a, b, s) {
  const { mu, phi } = toG2(a.rating, a.rd);
  const { mu: muj, phi: phij } = toG2(b.rating, b.rd);
  const sigma = a.vol;

  const gj = g(phij);
  const Ej = E(mu, muj, phij);
  const v = 1 / (gj * gj * Ej * (1 - Ej));
  const delta = v * gj * (s - Ej);

  // volatility iteration
  const A0 = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - A0) / (TAU * TAU);
  };
  let A = A0;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(A0 - k * TAU) < 0) k++;
    B = A0 - k * TAU;
  }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 50 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const sigmaP = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
  const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muP = mu + phiP * phiP * gj * (s - Ej);

  const out = fromG2(muP, phiP);
  return { rating: out.rating, rd: Math.min(350, out.rd), vol: sigmaP };
}

module.exports = { update, BASE };
