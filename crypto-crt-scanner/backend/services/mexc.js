/**
 * mexc.js — MEXC Perpetual Futures API
 *
 * Uses the MEXC contract API (contract.mexc.com) instead of spot.
 * Perpetual futures symbols use underscore format: BTC_USDT
 *
 * Kline endpoint:  GET https://contract.mexc.com/api/v1/contract/kline/{symbol}
 * Price endpoint:  GET https://contract.mexc.com/api/v1/contract/ticker
 * Pairs endpoint:  GET https://contract.mexc.com/api/v1/contract/detail
 */

const axios = require("axios");

const BASE = "https://contract.mexc.com/api/v1/contract";

// ── Interval map: our labels → MEXC contract interval strings ────────────────
// Contract API uses: Min1, Min5, Min15, Min30, Min60, Hour4, Hour8, Day1, Week1, Month1
const INTERVAL_MAP = {
  "4h": "Hour4",
  "1d": "Day1",
};

// ── Cached pair list (refreshed every 6 hours) ───────────────────────────────
let cachedPairs   = [];
let lastPairFetch = 0;
const PAIR_TTL    = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fetch all active USDT perpetual pairs from MEXC dynamically.
 * Falls back to a hardcoded list if the API fails.
 */
async function getPairs() {
  const now = Date.now();
  if (cachedPairs.length > 0 && now - lastPairFetch < PAIR_TTL) {
    return cachedPairs;
  }

  try {
    const res = await axios.get(`${BASE}/detail`, { timeout: 10000 });
    const all = res.data && res.data.data ? res.data.data : [];

    // Filter: only active USDT-settled perpetual contracts
    // state: 0 = enabled, quoteCoin: USDT
    const pairs = all
      .filter(c => c.quoteCoin === "USDT" && c.state === 0)
      .map(c => c.symbol) // format: BTC_USDT
      .sort();

    if (pairs.length > 50) {
      cachedPairs   = pairs;
      lastPairFetch = now;
      console.log(`[MEXC] Loaded ${pairs.length} active USDT perpetual pairs`);
      return pairs;
    }
  } catch (err) {
    console.error("[MEXC] Failed to fetch pair list:", err.message);
  }

  // Fallback: hardcoded top perpetual pairs
  console.log("[MEXC] Using fallback pair list");
  cachedPairs = FALLBACK_PAIRS;
  lastPairFetch = now;
  return cachedPairs;
}

/**
 * Fetch last N klines for a perpetual futures symbol + timeframe.
 *
 * @param {string} symbol  - e.g. "BTC_USDT"
 * @param {string} tf      - "4h" or "1d"
 * @param {number} limit   - number of candles (default 3)
 */
async function fetchKlines(symbol, tf, limit = 3) {
  const interval = INTERVAL_MAP[tf];
  if (!interval) throw new Error(`Unknown timeframe: ${tf}`);

  try {
    const res = await axios.get(`${BASE}/kline/${symbol}`, {
      params: { interval, start: 0, end: 0 },
      timeout: 8000,
    });

    const d = res.data && res.data.data;
    if (!d || !d.time || d.time.length === 0) return null;

    // Contract kline format: arrays of time[], open[], close[], high[], low[], vol[]
    const len = d.time.length;
    // Take last `limit` candles
    const start = Math.max(0, len - limit);
    const candles = [];
    for (let i = start; i < len; i++) {
      candles.push({
        openTime: d.time[i],
        open:     parseFloat(d.open[i]),
        high:     parseFloat(d.high[i]),
        low:      parseFloat(d.low[i]),
        close:    parseFloat(d.close[i]),
      });
    }
    return candles;
  } catch (err) {
    if (err.response && err.response.status !== 404) {
      console.error(`  [MEXC] kline ${symbol} ${tf}: ${err.message}`);
    }
    return null;
  }
}

/**
 * Fetch current live price for a perpetual symbol.
 */
async function fetchPrice(symbol) {
  try {
    const res = await axios.get(`${BASE}/ticker`, {
      params: { symbol },
      timeout: 5000,
    });
    const d = res.data && res.data.data;
    if (!d) return null;
    // ticker returns array or single object
    const ticker = Array.isArray(d) ? d.find(t => t.symbol === symbol) : d;
    return ticker ? parseFloat(ticker.lastPrice) : null;
  } catch (err) {
    return null;
  }
}

// ── Fallback hardcoded pairs (used if dynamic fetch fails) ───────────────────
const FALLBACK_PAIRS = [
  "BTC_USDT","ETH_USDT","BNB_USDT","SOL_USDT","XRP_USDT",
  "DOGE_USDT","ADA_USDT","AVAX_USDT","DOT_USDT","LTC_USDT",
  "LINK_USDT","UNI_USDT","ATOM_USDT","ETC_USDT","XLM_USDT",
  "BCH_USDT","FIL_USDT","APT_USDT","ARB_USDT","OP_USDT",
  "MATIC_USDT","NEAR_USDT","ALGO_USDT","VET_USDT","ICP_USDT",
  "GRT_USDT","EGLD_USDT","SAND_USDT","MANA_USDT","AXS_USDT",
  "AAVE_USDT","MKR_USDT","COMP_USDT","CRV_USDT","SNX_USDT",
  "SUSHI_USDT","DYDX_USDT","GMX_USDT","INJ_USDT","SUI_USDT",
  "SEI_USDT","TIA_USDT","WLD_USDT","FET_USDT","RENDER_USDT",
  "RUNE_USDT","STX_USDT","CFX_USDT","FLOW_USDT","ROSE_USDT",
  "ZIL_USDT","IOTA_USDT","XTZ_USDT","EOS_USDT","TRX_USDT",
  "HBAR_USDT","QNT_USDT","LDO_USDT","GALA_USDT","ENJ_USDT",
  "CHZ_USDT","BAT_USDT","STORJ_USDT","ANKR_USDT","CELR_USDT",
  "SKL_USDT","BAND_USDT","OCEAN_USDT","AGIX_USDT","TAO_USDT",
  "ONE_USDT","KLAY_USDT","DCR_USDT","ZEC_USDT","DASH_USDT",
  "XMR_USDT","NEO_USDT","IOTX_USDT","NMR_USDT","RLC_USDT",
  "COTI_USDT","CKB_USDT","SC_USDT","CVC_USDT","OXT_USDT",
  "REQ_USDT","BAL_USDT","FXS_USDT","CVX_USDT","RPL_USDT",
  "ALT_USDT","JUP_USDT","DYM_USDT","PYTH_USDT","STRK_USDT",
  "BLUR_USDT","PENDLE_USDT","WIF_USDT","BOME_USDT","POPCAT_USDT",
  "TURBO_USDT","PEPE_USDT","FLOKI_USDT","BONK_USDT","SHIB_USDT",
  "NOT_USDT","DOGS_USDT","HMSTR_USDT","EIGEN_USDT","DRIFT_USDT",
  "SAFE_USDT","LISTA_USDT","ZRO_USDT","IO_USDT","OMNI_USDT",
];

module.exports = { fetchKlines, fetchPrice, getPairs };
