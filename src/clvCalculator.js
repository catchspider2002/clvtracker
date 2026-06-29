// CLV Tracker — Closing Line Value calculator. THE judging centerpiece.
// Pure, deterministic math. CLV = implied probability at close - implied probability at open.
// Positive CLV = the line shortened toward this outcome (opening odds had value on it).
//
// Kept as plain, dependency-free JS with JSDoc so it reads cleanly for judges.

/** @typedef {{home:number, draw:number, away:number}} ThreeWay */

/** Markets in display order. */
export const MARKETS = /** @type {const} */ (['home', 'draw', 'away']);

/**
 * CLV for a single market, in percentage points (2 dp).
 * @param {number} openingImplied  implied probability at open (0..1)
 * @param {number} closingImplied  implied probability at close (0..1)
 * @returns {number} CLV in pp, e.g. +9.5
 */
export function calculateCLV(openingImplied, closingImplied) {
  return Math.round((closingImplied - openingImplied) * 10000) / 100;
}

/**
 * Magnitude bucket for an absolute implied-probability move.
 * @param {number} absDelta absolute change in implied probability (0..1)
 */
export function categorizeMagnitude(absDelta) {
  if (absDelta >= 0.10) return 'major';        // 10pp+
  if (absDelta >= 0.05) return 'significant';  // 5–10pp
  if (absDelta >= 0.02) return 'minor';        // 2–5pp
  return 'negligible';                         // < 2pp
}

/**
 * Full CLV breakdown for a match.
 * @param {{implied:ThreeWay, decimal:ThreeWay}} opening
 * @param {{implied:ThreeWay, decimal:ThreeWay}} closing
 */
export function calculateMatchCLV(opening, closing) {
  /** @type {Record<string, any>} */
  const perMarket = {};
  let totalMovement = 0;
  let mostMoved = { market: 'home', abs: -1 };

  for (const m of MARKETS) {
    const absDelta = Math.abs(closing.implied[m] - opening.implied[m]);
    const clv = calculateCLV(opening.implied[m], closing.implied[m]);
    perMarket[m] = {
      openingImplied: round(opening.implied[m]),
      closingImplied: round(closing.implied[m]),
      openingDecimal: opening.decimal[m],
      closingDecimal: closing.decimal[m],
      clv,
      direction: closing.implied[m] > opening.implied[m] ? 'shortened' : 'drifted',
      magnitude: categorizeMagnitude(absDelta),
    };
    totalMovement += Math.abs(clv);
    if (absDelta > mostMoved.abs) mostMoved = { market: m, abs: absDelta };
  }

  return {
    ...perMarket,
    totalMovement: Math.round(totalMovement * 100) / 100,
    mostMovedMarket: mostMoved.market,
    verdict: generateVerdict(perMarket),
  };
}

/**
 * One-line story of what the line movement says.
 * @param {Record<string, any>} pm  per-market CLV
 */
export function generateVerdict(pm) {
  const sig = (m) => pm[m].magnitude === 'significant' || pm[m].magnitude === 'major';
  if (sig('home') && pm.home.direction === 'shortened') return 'Money moved to the home team before kickoff';
  if (sig('away') && pm.away.direction === 'shortened') return 'Late money favoured the away side';
  if (sig('draw') && pm.draw.direction === 'shortened') return 'Market anticipated a tighter contest than the open suggested';
  if (!sig('home') && !sig('draw') && !sig('away')) return 'Stable market — opening line held to close';
  return 'Mixed movement across the three outcomes';
}

const round = (x) => Math.round(x * 10000) / 10000;
