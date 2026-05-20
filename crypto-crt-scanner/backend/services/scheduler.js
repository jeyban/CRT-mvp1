/**
 * scheduler.js
 *
 * AUTO SCAN (saves to Supabase):
 *   4H → 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC
 *   1D → 8PM UTC only
 *
 * MANUAL SCAN (does NOT save to Supabase):
 *   Triggered by scan buttons on dashboard
 *   Results shown in UI only, not stored in history
 *
 * Key fix: cron jobs use { timezone: "UTC" } to ensure
 * they fire at the correct time regardless of Render server timezone.
 */

const cron = require("node-cron");
const { fetchKlines, fetchPrice, getPairs } = require("./mexc");
const { detectCRT } = require("./crtLogic");
const { setAlerts } = require("../data/store");

const DELAY_MS = 200;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Core scan engine ─────────────────────────────────────────────────────────
// saveToDb: true  = auto scan, results saved to Supabase
// saveToDb: false = manual scan, results shown in UI only
// emit: optional callback for SSE streaming (debug mode)

async function _scan(tf, saveToDb, emit) {
  const debug = typeof emit === "function";

  const log = (type, symbol, msg, extra) => {
    if (debug) emit({ type, symbol, tf, msg, extra, ts: Date.now() });
    if (["found","error","save_error","start","done","store_saved"].includes(type)) {
      console.log(`  [${tf.toUpperCase()}] ${symbol || "—"} — ${msg}`);
    }
  };

  log("start", null, `${saveToDb ? "AUTO" : "MANUAL"} scan started — ${tf.toUpperCase()}`);

  const pairs  = await getPairs();
  const alerts = [];
  let scanned  = 0;
  let errors   = 0;

  log("start", null, `Scanning ${pairs.length} perpetual pairs…`);

  for (const symbol of pairs) {
    try {
      log("scanning", symbol, `Scanning ${symbol}…`);

      log("candles", symbol, `Fetching candles…`);
      const candles = await fetchKlines(symbol, tf, 3);
      if (!candles || candles.length < 2) {
        log("skip", symbol, `No candle data`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      log("price", symbol, `Fetching live price…`);
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
        alerts.push(alert);
        log("found", symbol,
          `CRT FOUND → ${symbol} ${alert.direction}`,
          { direction: alert.direction, price, alert }
        );
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

  // ── Only save to Supabase on AUTO scans ──────────────────────────────────
  if (saveToDb) {
    try {
      await setAlerts(tf, alerts);
      log("store_saved", null,
        `Saved ${alerts.length} alerts to database (auto scan)`
      );
    } catch (storeErr) {
      log("save_error", null,
        `FAILED TO SAVE TO DB → ${storeErr.message}`
      );
    }
  } else {
    // Manual scan — update in-memory cache only so dashboard can show results
    // but do NOT write to Supabase history
    const { setMemoryOnly } = require("../data/store");
    try {
      setMemoryOnly(tf, alerts);
      log("start", null,
        `Manual scan — ${alerts.length} results shown in UI (not saved to history)`
      );
    } catch (e) {
      // setMemoryOnly might not exist on older store, just continue
    }
  }

  log("done", null,
    `Scan complete — ${scanned} scanned, ${alerts.length} found, ${errors} errors`,
    { scanned, found: alerts.length, errors }
  );

  return alerts;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/** Auto scan — saves to Supabase. Called by cron and startup. */
async function runScan(tf) {
  console.log(`\n🔍 [AUTO SCAN] ${tf.toUpperCase()} — ${new Date().toUTCString()}`);
  const results = await _scan(tf, true, null);
  console.log(`✅ [AUTO DONE] ${tf.toUpperCase()} — ${results.length} alerts saved to DB`);
  return results;
}

/** Manual scan — does NOT save to Supabase. Called by scan buttons. */
async function runManualScan(tf) {
  console.log(`\n🔍 [MANUAL SCAN] ${tf.toUpperCase()} — ${new Date().toUTCString()}`);
  const results = await _scan(tf, false, null);
  console.log(`✅ [MANUAL DONE] ${tf.toUpperCase()} — ${results.length} alerts shown in UI only`);
  return results;
}

/** Streaming scan — always manual (no DB save), emits events for debug UI */
async function runScanWithStream(tf, emit) {
  return _scan(tf, false, emit);
}

// ─── Cron Scheduler ───────────────────────────────────────────────────────────
function startScheduler() {
  console.log("⏰ Starting scheduler (UTC times)...");

  // 4H scans: 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC
  // Cron: minute=0, hours=1,5,9,13,17,21
  cron.schedule("0 1,5,9,13,17,21 * * *", () => {
    const utcHour = new Date().getUTCHours();
    console.log(`\n⏰ [CRON] 4H auto scan triggered at UTC hour ${utcHour}`);
    runScan("4h").catch(console.error);
  }, { timezone: "UTC" });

  console.log("  • 4H: 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC");

  // 1D scan: 8PM UTC only — separate from 4H
  // Cron: minute=0, hour=20
  // Note: 9PM is already in the 4H schedule — 1D runs at its OWN time (8PM)
  cron.schedule("0 20 * * *", () => {
    const utcHour = new Date().getUTCHours();
    console.log(`\n⏰ [CRON] 1D auto scan triggered at UTC hour ${utcHour}`);
    runScan("1d").catch(console.error);
  }, { timezone: "UTC" });

  console.log("  • 1D: 8PM UTC daily");
  console.log("  • Note: 4H and 1D run on completely separate schedules\n");
}

module.exports = { runScan, runManualScan, runScanWithStream, startScheduler };
