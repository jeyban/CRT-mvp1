/**
 * glScheduler.js — Gainers/Losers CRT Scanner Scheduler
 *
 * SCOPE: Only scans Top 30 Gainers + Top 30 Losers (60 pairs max).
 * LOGIC: Uses detectCRT() and fetchKlines() from the EXISTING modules unchanged.
 * SAVES: Results are UI-only (never saved to Supabase history).
 *
 * SCHEDULES:
 *   1H  → 15 minutes after each 1H candle close (i.e. at :15 of every hour)
 *   4H  → Follow existing 4H schedule: 1:15, 5:15, 9:15, 13:15, 17:15, 21:15 UTC
 *   1D  → Follow existing 1D schedule: 20:15 UTC daily
 *
 * The 15-minute offset gives time for the candle to be confirmed closed
 * on the exchange before scanning.
 *
 * IMPORTANT: This scheduler is COMPLETELY ISOLATED from the main scheduler.
 *   - Uses glStore.js, not store.js
 *   - Has its own scan state tracking
 *   - Will never interfere with main scanner results or Supabase writes
 */

const cron            = require("node-cron");
const { fetchKlines, fetchPrice } = require("./mexc");
const { detectCRT }               = require("./crtLogic");
const { getTopMovers, invalidateCache } = require("./gainersLosers");
const {
  glSetScanState,
  glUpdateScanProgress,
  glClearScanState,
  glSetAlerts,
  glSetSnapshot,
} = require("../data/glStore");

// ── 1H interval map (mexc.js only has 4h and 1d, extend here) ─────────────────
const INTERVAL_MAP_EXT = {
  "1h": "Min60",
  "4h": "Hour4",
  "1d": "Day1",
};

// ── Delay between API calls (respect rate limits) ─────────────────────────────
const DELAY_MS = 250;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let glSchedulerStarted = false;

// ─────────────────────────────────────────────────────────────────────────────
// Core GL Scan Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs a full gainers/losers CRT scan for the given timeframe.
 *
 * @param {string}   tf    - "1h" | "4h" | "1d"
 * @param {Function} emit  - SSE emit function (optional; null for auto scans)
 * @returns {Object[]}     - Array of CRT alert objects
 */
async function _glScan(tf, emit) {
  const debug = typeof emit === "function";

  const send = (event) => {
    if (debug) { try { emit(event); } catch (_) {} }
  };

  const log = (type, symbol, msg, extra) => {
    send({ type, symbol, tf, msg, extra: extra || null, ts: Date.now() });
    if (["found","error","start","done","fatal","store_saved"].includes(type)) {
      console.log(`  [GL-${tf.toUpperCase()}] ${symbol || "—"} — ${msg}`);
    }
  };

  // ── 1. Fetch top movers (invalidate cache to get fresh data before scan) ───
  invalidateCache();
  let gainers, losers, snapshot;
  try {
    const result = await getTopMovers(30);
    gainers  = result.gainers;
    losers   = result.losers;
    snapshot = result.snapshot;
    glSetSnapshot({ gainers: gainers.length, losers: losers.length, snapshot });
  } catch (err) {
    log("fatal", null, `Failed to fetch top movers: ${err.message}`);
    glClearScanState(tf);
    throw err;
  }

  const pairs = [...gainers, ...losers];
  if (pairs.length === 0) {
    log("fatal", null, "No pairs returned from top movers — aborting scan");
    glClearScanState(tf);
    return [];
  }

  // ── 2. Register scan state ──────────────────────────────────────────────────
  glSetScanState(tf, "manual", pairs.length);

  log("start", null,
    `GL scan started — ${tf.toUpperCase()} — ${gainers.length} gainers + ${losers.length} losers = ${pairs.length} pairs`
  );

  const alerts  = [];
  let scanned   = 0;
  let errors    = 0;

  // ── 3. Scan each pair using existing logic ──────────────────────────────────
  for (const symbol of pairs) {
    try {
      log("scanning", symbol, `Scanning ${symbol}…`);

      // fetchKlines supports 1h via INTERVAL_MAP_EXT but mexc.js only maps 4h/1d.
      // We call the MEXC API directly here for 1h (same endpoint, different interval).
      const candles = await _fetchKlinesExt(symbol, tf, 3);
      if (!candles || candles.length < 2) {
        log("skip", symbol, "No candle data");
        errors++;
        glUpdateScanProgress(tf, { errors: 1 });
        await sleep(DELAY_MS);
        continue;
      }

      const price = await fetchPrice(symbol);
      if (!price) {
        log("skip", symbol, "No price data");
        errors++;
        glUpdateScanProgress(tf, { errors: 1 });
        await sleep(DELAY_MS);
        continue;
      }

      // ── USE EXISTING detectCRT() — NO CHANGES ──────────────────────────────
      const alert = detectCRT(symbol, tf, candles, price);

      if (alert) {
        alerts.push(alert);
        glUpdateScanProgress(tf, { scanned: 1, found: 1 });
        log("found", symbol,
          `CRT FOUND → ${symbol} ${alert.direction}`,
          { direction: alert.direction, price, alert }
        );
      } else {
        glUpdateScanProgress(tf, { scanned: 1 });
        log("clean", symbol, "No setup");
      }

      scanned++;
    } catch (err) {
      log("error", symbol, `Error → ${err.message}`);
      errors++;
      glUpdateScanProgress(tf, { errors: 1 });
    }

    await sleep(DELAY_MS);
  }

  // ── 4. Store results (UI only — never saved to Supabase) ───────────────────
  glSetAlerts(tf, alerts);
  log("store_saved", null, `${alerts.length} GL alerts stored in memory for ${tf} (UI only)`);

  glClearScanState(tf);

  log("done", null,
    `GL scan complete — ${scanned} scanned, ${alerts.length} found, ${errors} errors`,
    { scanned, found: alerts.length, errors, total: pairs.length }
  );

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended fetchKlines that supports 1h (mexc.js doesn't include 1h)
// Mirrors mexc.js fetchKlines exactly — just adds the 1h interval
// ─────────────────────────────────────────────────────────────────────────────

const axios = require("axios");
const MEXC_BASE = "https://contract.mexc.com/api/v1/contract";

async function _fetchKlinesExt(symbol, tf, limit = 3) {
  const interval = INTERVAL_MAP_EXT[tf];
  if (!interval) throw new Error(`Unknown GL timeframe: ${tf}`);

  // For 1h: interval = 3600s; 4h: 14400s; 1d: 86400s
  const intervalSeconds = tf === "1h" ? 3600 : tf === "4h" ? 4 * 3600 : 24 * 3600;
  const end   = Math.floor(Date.now() / 1000);
  const start = end - (limit + 2) * intervalSeconds;

  try {
    const res = await axios.get(`${MEXC_BASE}/kline/${symbol}`, {
      params: { interval, start, end },
      timeout: 8000,
    });

    const d = res.data && res.data.data;
    if (!d || !d.time || !Array.isArray(d.time) || d.time.length === 0) return null;

    const len  = d.time.length;
    const from = Math.max(0, len - limit);
    const candles = [];

    for (let i = from; i < len; i++) {
      candles.push({
        openTime: d.time[i],
        open:     parseFloat(d.open[i]),
        high:     parseFloat(d.high[i]),
        low:      parseFloat(d.low[i]),
        close:    parseFloat(d.close[i]),
      });
    }

    return candles.length >= 2 ? candles : null;
  } catch (err) {
    if (!err.response || err.response.status !== 404) {
      console.error(`  [GL-mexc] kline ${symbol} ${tf}: ${err.message}`);
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public functions
// ─────────────────────────────────────────────────────────────────────────────

/** Manual scan (called by POST /api/gl/scan/:tf) */
async function glRunManualScan(tf) {
  console.log(`\n🔍 [GL MANUAL SCAN] ${tf.toUpperCase()} — ${new Date().toUTCString()}`);
  const results = await _glScan(tf, null);
  console.log(`✅ [GL MANUAL DONE] ${tf.toUpperCase()} — ${results.length} alerts`);
  return results;
}

/** Streaming scan for SSE (called by GET /api/gl/scan/:tf/stream) */
async function glRunScanWithStream(tf, emit) {
  return _glScan(tf, emit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron Scheduler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the gainers/losers auto-scan cron jobs.
 * Runs at :15 (15 minutes after candle close) for all timeframes.
 *
 * 1H  → every hour at :15  (candle closes at :00, scan at :15)
 * 4H  → 1:15, 5:15, 9:15, 13:15, 17:15, 21:15 UTC
 * 1D  → 20:15 UTC daily
 *
 * Guard against double-registration.
 */
function startGLScheduler() {
  if (glSchedulerStarted) {
    console.log("⏰ GL Scheduler already running — skipping duplicate registration");
    return;
  }
  glSchedulerStarted = true;

  console.log("⏰ Starting GL (Gainers/Losers) scheduler (UTC)...");

  // ── 1H: every hour at minute 15 ────────────────────────────────────────────
  cron.schedule("15 * * * *", () => {
    const utcHour = new Date().getUTCHours();
    console.log(`\n⏰ [GL CRON] 1H auto scan at UTC hour ${utcHour}:15`);
    _glScan("1h", null).catch(console.error);
  }, { timezone: "UTC" });
  console.log("  • GL 1H: every hour at :15 UTC");

  // ── 4H: mirror main scanner hours + 15min offset ──────────────────────────
  cron.schedule("15 1,5,9,13,17,21 * * *", () => {
    const utcHour = new Date().getUTCHours();
    console.log(`\n⏰ [GL CRON] 4H auto scan at UTC hour ${utcHour}:15`);
    _glScan("4h", null).catch(console.error);
  }, { timezone: "UTC" });
  console.log("  • GL 4H: 1:15, 5:15, 9:15, 13:15, 17:15, 21:15 UTC");

  // ── 1D: mirror main scanner + 15min offset ────────────────────────────────
  cron.schedule("15 20 * * *", () => {
    console.log(`\n⏰ [GL CRON] 1D auto scan at UTC 20:15`);
    _glScan("1d", null).catch(console.error);
  }, { timezone: "UTC" });
  console.log("  • GL 1D: 20:15 UTC daily\n");
}

module.exports = {
  glRunManualScan,
  glRunScanWithStream,
  startGLScheduler,
};
