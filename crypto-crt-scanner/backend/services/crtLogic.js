/**
 * crtLogic.js — CRT Pattern Detection
 *
 * Your CRT rules (from README):
 *   Bullish: C2_high > C1_high  AND  currentPrice < C1_high
 *            → C2 swept above C1 high, price reclaimed back below
 *
 *   Bearish: C2_low < C1_low  AND  currentPrice > C1_low
 *            → C2 swept below C1 low, price reclaimed back above
 *
 * No candle close required — live price is used as currentPrice.
 */

/**
 * detectCRT — checks one symbol's candles for a CRT setup
 *
 * @param {string} symbol        e.g. "BTCUSDT"
 * @param {string} timeframe     e.g. "4h"
 * @param {Array}  candles       OHLCV array, oldest first
 *                               each: { open, high, low, close, volume, time }
 * @param {number} currentPrice  latest live price
 * @returns {object|null}        alert object or null
 */
function detectCRT(symbol, timeframe, candles, currentPrice) {
  if (!candles || candles.length < 3) return null;

  // C1 = second-to-last closed candle
  // C2 = last closed candle (the sweep candle)
  // Current price is the live price on the forming candle
  const c1 = candles[candles.length - 3];
  const c2 = candles[candles.length - 2];

  if (!c1 || !c2) return null;

  const c1High = parseFloat(c1.high);
  const c1Low  = parseFloat(c1.low);
  const c2High = parseFloat(c2.high);
  const c2Low  = parseFloat(c2.low);
  const price  = parseFloat(currentPrice);

  // ── Bullish CRT ─────────────────────────────────────────────────────────────
  // C2 swept ABOVE C1 high → price has now reclaimed BELOW C1 high
  if (c2High > c1High && price < c1High) {
    return buildAlert({
      symbol,
      timeframe,
      direction:    "bullish",
      c1High,
      c1Low,
      c2High,
      c2Low,
      sweepLevel:   c1High,   // the level that was swept
      currentPrice: price,
      c1,
      c2,
    });
  }

  // ── Bearish CRT ─────────────────────────────────────────────────────────────
  // C2 swept BELOW C1 low → price has now reclaimed ABOVE C1 low
  if (c2Low < c1Low && price > c1Low) {
    return buildAlert({
      symbol,
      timeframe,
      direction:    "bearish",
      c1High,
      c1Low,
      c2High,
      c2Low,
      sweepLevel:   c1Low,    // the level that was swept
      currentPrice: price,
      c1,
      c2,
    });
  }

  return null;
}

function buildAlert({ symbol, timeframe, direction, c1High, c1Low, c2High, c2Low, sweepLevel, currentPrice, c1, c2 }) {
  const id = `${symbol}_${timeframe}_${direction}_${c2.time}`;

  return {
    id,
    symbol,
    timeframe,
    direction,
    c1High,
    c1Low,
    c2High,
    c2Low,
    sweepLevel,
    currentPrice,
    c1OpenTime:  c1.time,
    c2OpenTime:  c2.time,
    timestamp:   new Date().toISOString(),
  };
}

module.exports = { detectCRT };
