/**
 * scheduler.js — Scan Orchestrator + Cron Scheduler
 *
 * Two scan modes:
 *   runScan(tf)               — silent background scan (production)
 *   runScanWithStream(tf, cb) — same logic but fires a callback per step (debug mode)
 *
 * Scan Schedule:
 *   1H  → Every hour at :15
 *   4H  → 1AM, 5AM, 9AM, 1PM, 5PM, 9PM
 *   1D  → 8PM daily
 */

const cron = require("node-cron");
const { fetchKlines, fetchPrice, USDT_PAIRS } = require("./mexc");
const { detectCRT } = require("./crtLogic");
const { setAlerts } = require("../data/store");

const DELAY_MS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Core scan logic ──────────────────────────────────────────────────────────
// emit() is optional — if provided, fires debug events to the SSE stream.
// If null, scan runs silently (production cron mode).

async function _scan(tf, emit) {
  const debug = typeof emit === "function";
  const log = (type, symbol, msg, extra) => {
    if (debug) emit({ type, symbol, tf, msg, extra, ts: Date.now() });
    if (type === "error" || type === "found" || type === "save_error") {
      console.log(`  [${tf.toUpperCase()}] ${symbol || "—"} — ${msg}`);
    }
  };

  log("start", null, `Scan started for ${tf.toUpperCase()}`);

  const alerts = [];
  let scanned = 0;
  let errors  = 0;

  for (const symbol of USDT_PAIRS) {
    try {
      // ── Step 1: announce which coin we're scanning ──────────────────────
      log("scanning", symbol, `Scanning ${symbol}…`);

      // ── Step 2: fetch candles ───────────────────────────────────────────
      log("candles", symbol, `Fetching candles…`);
      const candles = await fetchKlines(symbol, tf, 3);

      if (!candles || candles.length < 2) {
        log("skip", symbol, `No candle data — skipping`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      // ── Step 3: fetch live price ────────────────────────────────────────
      log("price", symbol, `Fetching live price…`);
      const currentPrice = await fetchPrice(symbol);

      if (!currentPrice) {
        log("skip", symbol, `No price data — skipping`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      // ── Step 4: run CRT logic ───────────────────────────────────────────
      log("checking", symbol, `Checking for CRT setup…`);
      const alert = detectCRT(symbol, tf, candles, currentPrice);

      if (alert) {
        // ── Step 5: CRT found ─────────────────────────────────────────────
        log("found", symbol,
          `CRT FOUND → ${symbol} ${alert.direction}`,
          { direction: alert.direction, price: currentPrice, alert }
        );

        try {
          alerts.push(alert);
          log("saved", symbol, `Result queued ✓`);
        } catch (saveErr) {
          log("save_error", symbol,
            `FAILED TO SAVE RESULT → ${saveErr.message}`
          );
        }
      } else {
        log("clean", symbol, `No setup found`);
      }

      scanned++;
    } catch (err) {
      // Per-coin error — log it and continue, never stop the scan
      log("error", symbol, `Error → ${err.message}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  // ── Persist final alert list to store ────────────────────────────────────
  try {
    setAlerts(tf, alerts);
    log("store_saved", null, `Store updated — ${alerts.length} alerts saved`);
  } catch (storeErr) {
    log("save_error", null,
      `FAILED TO SAVE RESULTS TO STORE → ${storeErr.message}`
    );
  }

  log("done", null,
    `Scan complete — ${scanned} scanned, ${alerts.length} found, ${errors} errors`,
    { scanned, found: alerts.length, errors }
  );

  return alerts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Silent background scan — used by cron and startup */
async function runScan(tf) {
  console.log(`\n🔍 [SCAN START] ${tf.toUpperCase()} — ${new Date().toLocaleTimeString()}`);
  const results = await _scan(tf, null);
  console.log(`✅ [SCAN DONE] ${tf.toUpperCase()} — ${results.length} alerts`);
  return results;
}

/** Streaming scan — used by the debug SSE endpoint */
async function runScanWithStream(tf, emit) {
  return _scan(tf, emit);
}

// ─── Cron Scheduler ───────────────────────────────────────────────────────────

function startScheduler() {
  console.log("⏰ Registering scan schedules...");
  cron.schedule("15 * * * *",          () => runScan("1h").catch(console.error));
  cron.schedule("0 1,5,9,13,17,21 * * *", () => runScan("4h").catch(console.error));
  cron.schedule("0 20 * * *",          () => runScan("1d").catch(console.error));
  console.log("  • 1H at :15 | 4H at 1,5,9,13,17,21 | 1D at 20:00\n");
}

module.exports = { runScan, runScanWithStream, startScheduler };
