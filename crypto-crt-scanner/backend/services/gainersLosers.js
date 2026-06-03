/**
 * gainersLosers.js — Fetch Top 30 Gainers and Top 30 Losers
 *
 * Uses MEXC Perpetual Futures ticker endpoint:
 *   GET /api/v1/contract/ticker
 *   Returns an array of all USDT perp tickers with `riseFallRate` (24h % change)
 *
 * This module is SEPARATE from the main scanner's getPairs().
 * It does NOT modify any existing logic — it only provides a different
 * pair list (top movers) that the gainers/losers scheduler feeds to
 * the existing detectCRT() and fetchKlines() functions unchanged.
 *
 * Cached for 5 minutes to avoid hammering the API between timeframe scans.
 */

const axios = require("axios");

const BASE = "https://contract.mexc.com/api/v1/contract";

// ── Reuse the same stock/commodity filter from mexc.js ───────────────────────
// (copied here so this module has no circular dependency)
const COMMODITY_SYMBOLS = new Set(["XAU_USDT", "XAG_USDT", "OIL_USDT"]);
const STOCK_SYMBOLS = new Set([
  "AAPL_USDT","AMZN_USDT","TSLA_USDT","GOOGL_USDT","MSFT_USDT","META_USDT",
  "NVDA_USDT","NFLX_USDT","AMD_USDT","INTC_USDT","BABA_USDT","UBER_USDT",
  "COIN_USDT","MSTR_USDT","PLTR_USDT","SHOP_USDT","SQ_USDT","PYPL_USDT",
  "SNAP_USDT","TWTR_USDT","SPOT_USDT","ABNB_USDT","RBLX_USDT","HOOD_USDT",
  "GME_USDT","AMC_USDT","BBY_USDT","F_USDT","GM_USDT","BA_USDT",
  "DIS_USDT","V_USDT","MA_USDT","JPM_USDT","GS_USDT","BAC_USDT",
  "WMT_USDT","PFE_USDT","JNJ_USDT","XOM_USDT","CVX_USDT",
  "700_USDT","9988_USDT","1810_USDT","3690_USDT","9618_USDT","2318_USDT",
  "941_USDT","388_USDT","1299_USDT","2628_USDT","3988_USDT","1398_USDT",
  "XAUUSD_USDT",
]);

function isCryptoOrCommodity(symbol) {
  if (COMMODITY_SYMBOLS.has(symbol)) return true;
  if (STOCK_SYMBOLS.has(symbol))     return false;
  const base = symbol.replace(/_USDT$/, "");
  if (/^\d+$/.test(base))         return false;
  if (base.endsWith("STOCK"))     return false;
  if (base.endsWith("ETF"))       return false;
  if (base.endsWith("INDEX"))     return false;
  return true;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
let tickerCache    = null;
let lastTickerFetch = 0;
const TICKER_TTL   = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch all ticker data from MEXC perpetuals.
 * Returns raw array of ticker objects with { symbol, riseFallRate, lastPrice, ... }
 */
async function fetchAllTickers() {
  const now = Date.now();
  if (tickerCache && (now - lastTickerFetch) < TICKER_TTL) {
    return tickerCache;
  }

  try {
    const res = await axios.get(`${BASE}/ticker`, { timeout: 12000 });
    const data = res.data && res.data.data;

    if (!Array.isArray(data) || data.length === 0) {
      console.warn("[GainersLosers] Ticker response empty or invalid");
      return tickerCache || [];
    }

    // Filter to crypto/commodity USDT perps only
    tickerCache = data.filter(t =>
      t.symbol &&
      t.symbol.endsWith("_USDT") &&
      isCryptoOrCommodity(t.symbol)
    );
    lastTickerFetch = now;
    console.log(`[GainersLosers] Fetched ${tickerCache.length} tickers`);
    return tickerCache;
  } catch (err) {
    console.error("[GainersLosers] fetchAllTickers error:", err.message);
    return tickerCache || [];
  }
}

/**
 * Get top N gainers + top N losers by 24h % change.
 *
 * @param {number} n - How many from each side (default: 30)
 * @returns {{ gainers: string[], losers: string[], snapshot: Object[] }}
 *   gainers/losers are symbol arrays.
 *   snapshot has { symbol, changePercent } for display in UI.
 */
async function getTopMovers(n = 30) {
  const tickers = await fetchAllTickers();

  if (!tickers || tickers.length === 0) {
    console.warn("[GainersLosers] No tickers available — returning empty lists");
    return { gainers: [], losers: [], snapshot: [] };
  }

  // Parse and sort by riseFallRate (24h % change)
  const parsed = tickers
    .map(t => ({
      symbol:        t.symbol,
      changePercent: parseFloat(t.riseFallRate) * 100, // API returns decimal e.g. 0.0542 = 5.42%
      lastPrice:     parseFloat(t.lastPrice) || 0,
      volume:        parseFloat(t.volume24) || 0,
    }))
    .filter(t => !isNaN(t.changePercent));

  // Sort descending for gainers, ascending for losers
  const sorted = [...parsed].sort((a, b) => b.changePercent - a.changePercent);

  const gainers = sorted.slice(0, n);
  const losers  = sorted.slice(-n).reverse(); // most negative first

  // Deduplicate (in case n*2 > total symbols)
  const gainersSet = new Set(gainers.map(t => t.symbol));
  const uniqueLosers = losers.filter(t => !gainersSet.has(t.symbol));

  const snapshot = [
    ...gainers.map(t => ({ ...t, side: "gainer" })),
    ...uniqueLosers.map(t => ({ ...t, side: "loser" })),
  ];

  console.log(
    `[GainersLosers] Top ${gainers.length} gainers, ${uniqueLosers.length} losers ` +
    `| Best: ${gainers[0]?.symbol} +${gainers[0]?.changePercent?.toFixed(2)}% ` +
    `| Worst: ${uniqueLosers[0]?.symbol} ${uniqueLosers[0]?.changePercent?.toFixed(2)}%`
  );

  return {
    gainers:  gainers.map(t => t.symbol),
    losers:   uniqueLosers.map(t => t.symbol),
    snapshot,
  };
}

/** Invalidate cache (call before a scan to get fresh data) */
function invalidateCache() {
  tickerCache    = null;
  lastTickerFetch = 0;
}

module.exports = { getTopMovers, invalidateCache };
