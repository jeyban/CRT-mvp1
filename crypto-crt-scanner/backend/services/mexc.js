/**
 * mexc.js — MEXC Futures API
 *
 * getKlines(symbol, interval, limit) — fetch OHLCV candles
 * getPrice(symbol)                   — fetch latest price
 * getUsdtPairs()                     — fetch all active USDT perpetual pairs
 */

const axios = require("axios");

const BASE = "https://contract.mexc.com/api/v1/contract";

// Interval map: your timeframe string → MEXC interval value
const INTERVAL_MAP = {
  "1h":  "Hour1",
  "4h":  "Hour4",
  "1d":  "Day1",
};

/**
 * Fetch OHLCV candles from MEXC futures
 * Returns array of { time, open, high, low, close, volume } oldest-first
 */
async function getKlines(symbol, timeframe, limit = 100) {
  const interval = INTERVAL_MAP[timeframe];
  if (!interval) throw new Error(`Unknown timeframe: ${timeframe}`);

  const { data } = await axios.get(`${BASE}/kline/${symbol}`, {
    params: { interval, limit },
    timeout: 10_000,
  });

  if (!data?.data?.length) return [];

  // MEXC returns [time, open, close, high, low, vol, ...] — note: close before high/low
  return data.data.map((c) => ({
    time:   c[0],
    open:   parseFloat(c[1]),
    close:  parseFloat(c[2]),
    high:   parseFloat(c[3]),
    low:    parseFloat(c[4]),
    volume: parseFloat(c[5]),
  }));
}

/**
 * Fetch latest mark price for a symbol
 */
async function getPrice(symbol) {
  const { data } = await axios.get(`${BASE}/ticker`, {
    params: { symbol },
    timeout: 5_000,
  });
  return parseFloat(data?.data?.lastPrice ?? data?.data?.indexPrice ?? 0);
}

/**
 * Fetch all active USDT perpetual pairs
 */
async function getUsdtPairs() {
  const { data } = await axios.get(`${BASE}/detail`, { timeout: 10_000 });

  return (data?.data || [])
    .filter((c) => c.quoteCoin === "USDT" && c.state === 0)
    .map((c) => c.symbol)
    .sort();
}

// Static fallback list if API is unavailable
const FALLBACK_PAIRS = [
  "BTC_USDT","ETH_USDT","BNB_USDT","SOL_USDT","XRP_USDT",
  "ADA_USDT","AVAX_USDT","DOGE_USDT","MATIC_USDT","LINK_USDT",
  "DOT_USDT","UNI_USDT","ATOM_USDT","LTC_USDT","ETC_USDT",
  "FIL_USDT","NEAR_USDT","APT_USDT","OP_USDT","ARB_USDT",
];

module.exports = { getKlines, getPrice, getUsdtPairs, FALLBACK_PAIRS };
