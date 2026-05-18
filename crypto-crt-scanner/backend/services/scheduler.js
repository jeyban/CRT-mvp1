/**
 * scheduler.js — Scan Orchestrator
 *
 * Timeframes: 4H and 1D only (1H removed)
 *
 * Schedule:
 *   4H → 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC
 *   1D → 8PM UTC daily
 */

const cron = require("node-cron");
const { fetchKlines, fetchPrice, getPairs } = require("./mexc");
const { detectCRT } = require("./crtLogic");
const { setAlerts } = require("../data/store");

const DELAY_MS = 180; // ms between each pair to stay under rate limits
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Core scan loop — shared by both silent and streaming modes.
 * @param {string}   tf    - "4h" or "1d"
 * @param {Function} emit  - optional callback for debug streaming
 */
async function _scan(tf, emit) {
  const debug = typeof emit === "function";
  const log = (type, symbol, msg, extra) => {
    if (debug) emit({ type, symbol, tf, msg, extra, ts: Date.now() });
    if (["found","error","save_error","start","done"].includes(type)) {
      console.log(`  [${tf.toUpperCase()}] ${symbol || "—"} — ${msg}`);
    }
  };

  log("start", null, `Scan started — ${tf.toUpperCase()}`);

  // Dynamically fetch all active perpetual pairs
  const pairs  = await getPairs();
  const alerts = [];
  let scanned  = 0;
  let errors   = 0;

  log("start", null, `Scanning ${pairs.length} perpetual pairs…`);

  for (const symbol of pairs) {
    try {
      log("scanning", symbol, `Scanning ${symbol}…`);
      log("candles",  symbol, `Fetching candles…`);
      const candles = await fetchKlines(symbol, tf, 3);

      if (!candles || candles.length < 2) {
        log("skip", symbol, `No candle data`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      log("price",    symbol, `Fetching live price…`);
      const price = await fetchPrice(symbol);

      if (!price) {
        log("skip", symbol, `No price data`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      log("checking", symbol, `Checking CRT setup…`);
      const alert = detectCRT(symbol, tf, candles, price);

      if (alert) {
        log("found", symbol,
          `CRT FOUND → ${symbol} ${alert.direction}`,
          { direction: alert.direction, price, alert }
        );
        try {
          alerts.push(alert);
          log("saved", symbol, `Queued ✓`);
        } catch (saveErr) {
          log("save_error", symbol, `FAILED TO SAVE RESULT → ${saveErr.message}`);
        }
      } else {
        log("clean", symbol, `No setup`);
      }

      scanned++;
    } catch (err) {
      log("error", symbol, `Error → ${err.message}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  // Persist to Supabase
  try {
    await setAlerts(tf, alerts);
    log("store_saved", null, `Saved ${alerts.length} alerts to database`);
  } catch (storeErr) {
    log("save_error", null, `FAILED TO SAVE TO DB → ${storeErr.message}`);
  }

  log("done", null,
    `Scan complete — ${scanned} scanned, ${alerts.length} found, ${errors} errors`,
    { scanned, found: alerts.length, errors }
  );

  return alerts;
}

// ── Public functions ──────────────────────────────────────────────────────────

/** Silent background scan */
async function runScan(tf) {
  console.log(`\n🔍 [SCAN START] ${tf.toUpperCase()} — ${new Date().toLocaleTimeString()}`);
  const results = await _scan(tf, null);
  console.log(`✅ [SCAN DONE] ${tf.toUpperCase()} — ${results.length} alerts found`);
  return results;
}

/** Streaming scan for debug mode */
async function runScanWithStream(tf, emit) {
  return _scan(tf, emit);
}

// ── Cron Scheduler ────────────────────────────────────────────────────────────

function startScheduler() {
  console.log("⏰ Registering scan schedules (4H + 1D only)...");

  // 4H: at 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC
  cron.schedule("0 1,5,9,13,17,21 * * *", () => {
    runScan("4h").catch(console.error);
  }, { timezone: "UTC" });
  console.log("  • 4H: 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC");

  // 1D: 8PM UTC
  cron.schedule("0 20 * * *", () => {
    runScan("1d").catch(console.error);
  }, { timezone: "UTC" });
  console.log("  • 1D: 8PM UTC daily\n");
}

module.exports = { runScan, runScanWithStream, startScheduler };
