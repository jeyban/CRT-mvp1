/**
 * glScanner.js — API Routes for Gainers/Losers CRT Scanner
 *
 * All routes are prefixed with /api/gl (mounted in server.js)
 * to ensure zero collision with existing /api routes.
 *
 * GET  /api/gl/alerts          → All GL alerts (all timeframes)
 * GET  /api/gl/alerts/:tf      → GL alerts for one timeframe
 * GET  /api/gl/scan/:tf/stream → SSE streaming manual scan
 * POST /api/gl/scan/:tf        → Manual scan (blocking, returns results)
 * GET  /api/gl/status          → Health + scan state + last scan times
 * GET  /api/gl/snapshot        → Last top movers snapshot (gainers/losers list)
 */

const express = require("express");
const router  = express.Router();

const { glGetAllAlerts, glGetAlerts, glGetScanState, glGetSnapshot } = require("../data/glStore");
const { glRunManualScan, glRunScanWithStream } = require("../services/glScheduler");

const GL_VALID = ["1h", "4h", "1d"];

// ── GET /api/gl/alerts ────────────────────────────────────────────────────────
router.get("/alerts", async (req, res) => {
  try {
    const data = glGetAllAlerts();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/gl/alerts/:tf ────────────────────────────────────────────────────
router.get("/alerts/:tf", (req, res) => {
  const { tf } = req.params;
  if (!GL_VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${GL_VALID.join(", ")}` });

  const alerts    = glGetAlerts(tf);
  const scanState = glGetScanState(tf);
  res.json({ success: true, timeframe: tf, count: alerts.length, alerts, scanState });
});

// ── GET /api/gl/scan/:tf/stream ───────────────────────────────────────────────
// SSE streaming scan — emits live progress events to frontend
router.get("/scan/:tf/stream", async (req, res) => {
  const { tf } = req.params;
  if (!GL_VALID.includes(tf)) { res.status(400).end(); return; }

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (_) {}
  };

  // Keep-alive ping every 15s
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch (_) {}
  }, 15000);

  req.on("close", () => {
    clearInterval(ping);
    console.log(`[GL SSE] Client disconnected from ${tf} stream`);
  });

  try {
    const results = await glRunScanWithStream(tf, send);
    send({
      type:  "complete",
      tf,
      found: results.length,
      msg:   results.length > 0
        ? `GL scan complete — ${results.length} setups found`
        : "GL scan complete — no setups found",
      ts: Date.now(),
    });
  } catch (err) {
    send({ type: "fatal", msg: `Fatal: ${err.message}`, ts: Date.now() });
  }

  clearInterval(ping);
  res.end();
});

// ── POST /api/gl/scan/:tf ─────────────────────────────────────────────────────
// Blocking manual scan (returns results directly)
router.post("/scan/:tf", async (req, res) => {
  const { tf } = req.params;
  if (!GL_VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${GL_VALID.join(", ")}` });

  const state = glGetScanState(tf);
  if (state.running) {
    return res.json({
      success:   true,
      scanning:  true,
      message:   `GL scan already running for ${tf} — connect to SSE stream for live progress`,
      scanState: state,
    });
  }

  console.log(`[GL Route] Manual scan requested for ${tf}`);

  try {
    const results = await glRunManualScan(tf);
    res.json({
      success:   true,
      scanning:  false,
      timeframe: tf,
      found:     results.length,
      alerts:    results,
      message:   results.length > 0
        ? `GL scan complete — ${results.length} CRT setups found (UI only)`
        : `GL scan complete — no CRT setups found for ${tf}`,
    });
  } catch (err) {
    console.error(`[GL Route] Manual scan error (${tf}):`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/gl/status ────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  try {
    const data     = glGetAllAlerts();
    const snapshot = glGetSnapshot();
    res.json({
      success:    true,
      status:     "online",
      serverTime: new Date().toISOString(),
      lastScan:   data.lastScan,
      scanState:  data.scanState,
      counts: {
        "1h": data["1h"].length,
        "4h": data["4h"].length,
        "1d": data["1d"].length,
      },
      snapshot,
      schedule: {
        "1h":  "GL auto scan every hour at :15 UTC (15min after candle close)",
        "4h":  "GL auto scan at 1:15, 5:15, 9:15, 13:15, 17:15, 21:15 UTC",
        "1d":  "GL auto scan at 20:15 UTC daily",
        note:  "Results are UI-only — not saved to Supabase history",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/gl/snapshot ──────────────────────────────────────────────────────
// Returns the last fetched top movers list (for display in UI summary)
router.get("/snapshot", (req, res) => {
  const snapshot = glGetSnapshot();
  res.json({ success: true, snapshot });
});

module.exports = router;
