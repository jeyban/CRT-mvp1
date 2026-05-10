/**
 * mexc.js — MEXC REST API service
 * Handles all communication with the MEXC exchange API.
 */

const axios = require("axios");

const BASE_URL = "https://api.mexc.com/api/v3";

// ─── Timeframe map: our labels → MEXC interval strings ───────────────────────
const INTERVAL_MAP = {
  "1h": "60m",
  "4h": "4h",
  "1d": "1d",
};

// ─── ~100 high-liquidity USDT pairs to scan ────────────────────────────────
const USDT_PAIRS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "LTCUSDT",
  "LINKUSDT", "UNIUSDT", "ATOMUSDT", "ETCUSDT", "XLMUSDT",
  "BCHUSDT", "FILUSDT", "APTUSDT", "ARBUSDT", "OPUSDT",
  "MATICUSDT", "NEARUSDT", "ALGOUSDT", "VETUSDT", "ICPUSDT",
  "GRTUSDT", "EGLDUSDT", "SANDUSDT", "MANAUSDT", "AXSUSDT",
  "AAVEUSDT", "MKRUSDT", "COMPUSDT", "CRVUSDT", "SNXUSDT",
  "YFIUSDT", "SUSHIUSDT", "1INCHUSDT", "DYDXUSDT", "GMXUSDT",
  "INJUSDT", "SUIUSDT", "SEIUSDT", "TIAUSDT", "PYTHUSDT",
  "WLDUSDT", "STRKUSDT", "JUPUSDT", "DYMUSDT", "ALTUSDT",
  "FETUSDT", "OCEANUSDT", "AGIXUSDT", "RENDERUSDT", "TAOUSDT",
  "RUNEUSDT", "THORUSDT", "STXUSDT", "CFXUSDT", "KLAYUSDT",
  "FLOWUSDT", "ROSEUSDT", "ZILUSDT", "ONEUSDT", "IOTAUSDT",
  "XTZUSDT", "EOSUSDT", "TRXUSDT", "HBARUSDT", "QNTUSDT",
  "LDOUSDT", "RPLUSDT", "FXSUSDT", "CVXUSDT", "BALUSDT",
  "GALAUSDT", "ENJUSDT", "CHZUSDT", "BATUSDT", "STORJUSDT",
  "COTIUSDT", "CKBUSDT", "SCUSDT", "DCRUSDT", "ZECUSDT",
  "DASHUSDT", "XMRUSDT", "WAVEUSDT", "NEOUSDT", "IOTXUSDT",
  "CVCUSDT", "NMRUSDT", "BANDUSDT", "OXTUSDT", "ANKRUSDT",
  "CELRUSDT", "SKLUSDT", "CTKUSDT", "REQUSDT", "RLCUSDT",
];

/**
 * Fetch the last N klines (candlesticks) for a symbol + timeframe.
 * We only need the last 2 candles for CRT logic (C1 + C2).
 *
 * @param {string} symbol - e.g. "BTCUSDT"
 * @param {string} tf     - e.g. "1h", "4h", "1d"
 * @param {number} limit  - number of candles to fetch (default 3 for safety)
 * @returns {Array|null}  - Array of candle objects, or null on error
 */
async function fetchKlines(symbol, tf, limit = 3) {
  const interval = INTERVAL_MAP[tf];
  if (!interval) throw new Error(`Unknown timeframe: ${tf}`);

  try {
    const response = await axios.get(`${BASE_URL}/klines`, {
      params: { symbol, interval, limit },
      timeout: 8000, // 8 second timeout per request
    });

    const raw = response.data;

    // MEXC kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    return raw.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));
  } catch (err) {
    // Log error but don't crash the whole scan
    console.error(`  [MEXC] Failed to fetch ${symbol} ${tf}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch the current live price for a symbol.
 * Uses the ticker/price endpoint for a lightweight single price.
 *
 * @param {string} symbol
 * @returns {number|null}
 */
async function fetchPrice(symbol) {
  try {
    const response = await axios.get(`${BASE_URL}/ticker/price`, {
      params: { symbol },
      timeout: 5000,
    });
    return parseFloat(response.data.price);
  } catch (err) {
    console.error(`  [MEXC] Failed to fetch price ${symbol}: ${err.message}`);
    return null;
  }
}

module.exports = { fetchKlines, fetchPrice, USDT_PAIRS };
