/**
 * scheduler.js — Scan Orchestrator + Cron Scheduler
 *
 * Scan Schedule:
 *   1H  → Every hour at :15 (e.g. 8:15, 9:15, 10:15...)
 *   4H  → 1AM, 5AM, 9AM, 1PM, 5PM, 9PM
 *   1D  → 8PM daily
 *
 * The scanner fetches klines + price for each pair,
 * runs CRT logic, and saves results to the in-memory store.
 */

const cron = require("node-cron");
const { fetchKlines, fetchPrice, USDT_PAIRS } = require("./mexc");
const { detectCRT } = require("./crtLogic");
const { setAlerts } = require("../data/store");

// ─── Rate limiting: delay between API calls (ms) ──────────────────────────
// MEXC has rate limits; space out requests to avoid 429 errors
const DELAY_MS = 200; // 200ms between each pair = ~20 seconds for 100 pairs

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run the full CRT scan for a specific timeframe.
 * Loops through all USDT_PAIRS, fetches data, runs logic.
 *
 * @param {string} tf - "1h", "4h", or "1d"
 */
async function runScan(tf) {
  console.log(`\n🔍 [SCAN START] Timeframe: ${tf.toUpperCase()} — ${new Date().toLocaleTimeString()}`);
  const alerts = [];
  let scanned = 0;
  let errors = 0;

  for (const symbol of USDT_PAIRS) {
    try {
      // Fetch last 3 candles (we need C1 + C2; extra candle for safety)
      const candles = await fetchKlines(symbol, tf, 3);
      if (!candles || candles.length < 2) {
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      // Fetch live price separately for real-time CRT detection
      const currentPrice = await fetchPrice(symbol);
      if (!currentPrice) {
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      // Run CRT detection
      const alert = detectCRT(symbol, tf, candles, currentPrice);

      if (alert) {
        alerts.push(alert);
        console.log(`  ✅ CRT ${alert.direction} → ${symbol} @ ${currentPrice}`);
      }

      scanned++;
    } catch (err) {
      console.error(`  ❌ Error scanning ${symbol}: ${err.message}`);
      errors++;
    }

    // Rate-limit delay between requests
    await sleep(DELAY_MS);
  }

  // Save results to store (replaces previous alerts for this timeframe)
  setAlerts(tf, alerts);

  console.log(`✅ [SCAN DONE] ${tf.toUpperCase()} — ${scanned} scanned, ${alerts.length} alerts, ${errors} errors`);
  return alerts;
}

/**
 * Register all cron jobs for scheduled scanning.
 * Call this once at server startup.
 */
function startScheduler() {
  console.log("⏰ Registering scan schedules...");

  // ── 1H Scanner: every hour at :15 minutes ─────────────────────────────
  // Cron: "15 * * * *" = at minute 15 of every hour
  cron.schedule("15 * * * *", () => {
    runScan("1h").catch(console.error);
  });
  console.log("  • 1H scanner: every hour at :15");

  // ── 4H Scanner: 1AM, 5AM, 9AM, 1PM, 5PM, 9PM ─────────────────────────
  // Cron: "0 1,5,9,13,17,21 * * *" = at minute 0, hours 1,5,9,13,17,21
  cron.schedule("0 1,5,9,13,17,21 * * *", () => {
    runScan("4h").catch(console.error);
  });
  console.log("  • 4H scanner: 1AM, 5AM, 9AM, 1PM, 5PM, 9PM");

  // ── 1D Scanner: 8PM daily ─────────────────────────────────────────────
  // Cron: "0 20 * * *" = at 8:00 PM every day
  cron.schedule("0 20 * * *", () => {
    runScan("1d").catch(console.error);
  });
  console.log("  • 1D scanner: 8PM daily");

  console.log("⏰ All schedules registered.\n");
}

module.exports = { runScan, startScheduler };
