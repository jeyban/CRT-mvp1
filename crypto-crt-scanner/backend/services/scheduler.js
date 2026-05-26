/**
 * scheduler.js — Cron Jobs + Scan Runner
 *
 * FIXES:
 *  1. isScanning flag is set/cleared via store.setScanning() with try/finally
 *     → scan can never get stuck even if it throws
 *  2. runScan()       = AUTO scan  → saves to Supabase via setAlerts()
 *  3. runManualScan() = MANUAL scan → memory only via setMemoryOnly()
 *  4. runScanWithStream() = SSE streaming manual scan
 *
 * Schedule (UTC):
 *   4H → 1AM, 5AM, 9AM, 1PM, 5PM, 9PM
 *   1D → 8PM daily
 */

const cron                            = require("node-cron");
const { getKlines, getPrice, getUsdtPairs, FALLBACK_PAIRS } = require("./mexc");
const { detectCRT }                   = require("./crtLogic");
const { setAlerts, setMemoryOnly, setScanning } = require("../data/store");

// Delay helper to avoid rate-limiting MEXC
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Core scan engine ──────────────────────────────────────────────────────────
/**
 * Scans all USDT pairs for a timeframe.
 * @param {string}   tf       "4h" or "1d"
 * @param {function} onAlert  optional callback(alert) for streaming
 * @returns {Array}  alerts found
 */
async function scanAllPairs(tf, onAlert = null) {
  let pairs;
  try {
    pairs = await getUsdtPairs();
    if (!pairs.length) throw new Error("Empty pairs list");
  } catch (err) {
    console.warn("[Scheduler] getUsdtPairs failed, using fallback:", err.message);
    pairs = FALLBACK_PAIRS;
  }

  console.log(`[Scheduler] Scanning ${pairs.length} pairs on ${tf}...`);

  const alerts = [];

  for (const symbol of pairs) {
    try {
      const [candles, price] = await Promise.all([
        getKlines(symbol, tf, 10),
        getPrice(symbol),
      ]);

      if (!candles.length || !price) continue;

      const alert = detectCRT(symbol, tf, candles, price);

      if (alert) {
        alerts.push(alert);
        console.log(`[Scheduler] ✅ ${tf} alert: ${symbol} ${alert.direction}`);
        if (onAlert) onAlert(alert);
      }
    } catch (err) {
      // Single symbol failure should never abort the whole scan
      console.warn(`[Scheduler] ${symbol} error: ${err.message}`);
    }

    await sleep(80); // 80ms between symbols — ~8s per 100 pairs
  }

  return alerts;
}

// ── runScan — AUTO scan, saves to Supabase ────────────────────────────────────
async function runScan(tf) {
  console.log(`\n[Scheduler] ▶ AUTO scan starting: ${tf}`);
  setScanning(tf, true);
  try {
    const alerts = await scanAllPairs(tf);
    await setAlerts(tf, alerts);
    console.log(`[Scheduler] ✅ AUTO scan done: ${tf} — ${alerts.length} alerts\n`);
    return alerts;
  } finally {
    // Always clears isScanning even on crash
    setScanning(tf, false);
  }
}

// ── runManualScan — MANUAL scan, memory only ──────────────────────────────────
async function runManualScan(tf) {
  console.log(`\n[Scheduler] ▶ MANUAL scan starting: ${tf}`);
  setScanning(tf, true);
  try {
    const alerts = await scanAllPairs(tf);
    setMemoryOnly(tf, alerts);
    console.log(`[Scheduler] ✅ MANUAL scan done: ${tf} — ${alerts.length} alerts\n`);
    return alerts;
  } finally {
    setScanning(tf, false);
  }
}

// ── runScanWithStream — SSE streaming manual scan ────────────────────────────
async function runScanWithStream(tf, send) {
  let pairs;
  try {
    pairs = await getUsdtPairs();
    if (!pairs.length) throw new Error("Empty pairs list");
  } catch (err) {
    console.warn("[Scheduler] getUsdtPairs failed, using fallback:", err.message);
    pairs = FALLBACK_PAIRS;
  }

  send({ type: "start", tf, total: pairs.length, ts: Date.now() });

  const alerts = [];
  let scanned  = 0;

  setScanning(tf, true);
  try {
    for (const symbol of pairs) {
      scanned++;
      try {
        const [candles, price] = await Promise.all([
          getKlines(symbol, tf, 10),
          getPrice(symbol),
        ]);

        if (candles.length && price) {
          const alert = detectCRT(symbol, tf, candles, price);
          if (alert) {
            alerts.push(alert);
            send({ type: "alert", alert, ts: Date.now() });
          }
        }
      } catch (err) {
        send({ type: "skip", symbol, reason: err.message, ts: Date.now() });
      }

      send({ type: "progress", scanned, total: pairs.length, ts: Date.now() });
      await sleep(80);
    }

    setMemoryOnly(tf, alerts);
    send({ type: "done", count: alerts.length, ts: Date.now() });
  } finally {
    setScanning(tf, false);
  }

  return alerts;
}

// ── startScheduler — cron jobs ────────────────────────────────────────────────
function startScheduler() {
  // 4H — every 4 hours at :00 (1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC)
  cron.schedule("0 1,5,9,13,17,21 * * *", async () => {
    await runScan("4h").catch(console.error);
  }, { timezone: "UTC" });

  // 1D — 8PM UTC daily
  cron.schedule("0 20 * * *", async () => {
    await runScan("1d").catch(console.error);
  }, { timezone: "UTC" });

  console.log("[Scheduler] Cron jobs registered");
  console.log("  4H → 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC");
  console.log("  1D → 8PM UTC daily");
}

module.exports = { startScheduler, runScan, runManualScan, runScanWithStream };
