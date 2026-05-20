/**
 * scanner.js — API Routes
 *
 * GET  /api/alerts           → Latest alerts (memory + Supabase fallback)
 * GET  /api/alerts/:tf       → Latest alerts for one timeframe
 * POST /api/scan/:tf         → Manual scan (UI only, NOT saved to DB)
 * GET  /api/scan/:tf/stream  → SSE streaming scan (debug, NOT saved to DB)
 * GET  /api/history          → All history from Supabase
 * GET  /api/history/:tf      → History for one timeframe
 * GET  /api/status           → Health check + last scan times
 */

const express = require("express");
const router  = express.Router();
const { getAllAlerts, getAlerts, getHistory } = require("../data/store");
const { runManualScan, runScanWithStream } = require("../services/scheduler");

const VALID = ["4h", "1d"];

// ── GET /api/alerts ───────────────────────────────────────────────────────────
router.get("/alerts", async (req, res) => {
  try {
    const data = await getAllAlerts();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/alerts/:tf ───────────────────────────────────────────────────────
router.get("/alerts/:tf", async (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${VALID.join(", ")}` });

  const alerts = await getAlerts(tf);
  res.json({ success: true, timeframe: tf, count: alerts.length, alerts });
});

// ── POST /api/scan/:tf ────────────────────────────────────────────────────────
// MANUAL SCAN — fires runManualScan which skips Supabase save
router.post("/scan/:tf", async (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${VALID.join(", ")}` });

  // Respond immediately, scan runs in background
  res.json({
    success: true,
    message: `Manual scan started for ${tf} — results will appear in UI only (not saved to history)`,
  });

  // Run manual scan in background — no DB save
  runManualScan(tf).catch(console.error);
});

// ── GET /api/scan/:tf/stream ─────────────────────────────────────────────────
// STREAMING MANUAL SCAN — SSE events, no DB save
router.get("/scan/:tf/stream", async (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf)) { res.status(400).end(); return; }

  res.setHeader("Content-Type",      "text/event-stream");
  res.setHeader("Cache-Control",     "no-cache");
  res.setHeader("Connection",        "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch (_) {}
  };

  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => clearInterval(ping));

  try {
    await runScanWithStream(tf, send);
  } catch (err) {
    send({ type: "fatal", msg: `Fatal: ${err.message}`, ts: Date.now() });
  }

  clearInterval(ping);
  res.end();
});

// ── GET /api/history ──────────────────────────────────────────────────────────
router.get("/history", async (req, res) => {
  const days = parseInt(req.query.days) || 7;
  const data = await getHistory("all", days);
  res.json({ success: true, count: data.length, days, data });
});

// ── GET /api/history/:tf ──────────────────────────────────────────────────────
router.get("/history/:tf", async (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${VALID.join(", ")}` });

  const days = parseInt(req.query.days) || 7;
  const data = await getHistory(tf, days);
  res.json({ success: true, timeframe: tf, count: data.length, days, data });
});

// ── GET /api/status ───────────────────────────────────────────────────────────
router.get("/status", async (req, res) => {
  try {
    const { lastScan } = await getAllAlerts();
    res.json({
      success:    true,
      status:     "online",
      serverTime: new Date().toISOString(),
      utcTime:    new Date().toUTCString(),
      lastScan,
      schedule: {
        "4h": "AUTO scan at 1AM, 5AM, 9AM, 1PM, 5PM, 9PM UTC — saved to DB",
        "1d": "AUTO scan at 8PM UTC daily — saved to DB",
        manual: "Manual scans shown in UI only, NOT saved to history",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
