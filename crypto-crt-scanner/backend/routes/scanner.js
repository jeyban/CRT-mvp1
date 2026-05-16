/**
 * scanner.js — API Routes
 *
 * GET  /api/alerts           → All alerts for all timeframes
 * GET  /api/alerts/:tf       → Alerts for specific timeframe
 * POST /api/scan/:tf         → Silent background scan (production)
 * GET  /api/scan/:tf/stream  → SSE streaming scan (debug mode)
 * GET  /api/status           → Server health
 */

const express = require("express");
const router  = express.Router();
const { getAllAlerts, getAlerts } = require("../data/store");
const { runScan, runScanWithStream } = require("../services/scheduler");

const VALID = ["1h", "4h", "1d"];

// ── GET /api/alerts ───────────────────────────────────────────────────────────
router.get("/alerts", (req, res) => {
  res.json({ success: true, data: getAllAlerts() });
});

// ── GET /api/alerts/:tf ───────────────────────────────────────────────────────
router.get("/alerts/:tf", (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${VALID.join(", ")}` });

  const alerts = getAlerts(tf);
  res.json({ success: true, timeframe: tf, count: alerts.length, alerts });
});

// ── POST /api/scan/:tf ────────────────────────────────────────────────────────
// Silent scan — fires and forgets, response returns immediately
router.post("/scan/:tf", async (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf))
    return res.status(400).json({ success: false, error: `Use: ${VALID.join(", ")}` });

  res.json({ success: true, message: `Scan started for ${tf}. Poll /api/alerts/${tf} in ~30s.` });
  runScan(tf).catch(console.error);
});

// ── GET /api/scan/:tf/stream ─────────────────────────────────────────────────
// SSE streaming scan — debug mode
// Client connects and receives a stream of scan events in real time.
// Each event is a JSON-encoded ScanEvent object.
router.get("/scan/:tf/stream", async (req, res) => {
  const { tf } = req.params;
  if (!VALID.includes(tf)) {
    res.status(400).end();
    return;
  }

  // ── Set SSE headers ────────────────────────────────────────────────────────
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // important for Render/nginx proxies
  res.flushHeaders();

  // Helper: send one SSE event
  const send = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (_) {}
  };

  // Keep-alive ping every 15s so Render doesn't kill the connection
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);

  // Clean up when client disconnects
  req.on("close", () => clearInterval(ping));

  try {
    await runScanWithStream(tf, send);
  } catch (err) {
    send({ type: "fatal", msg: `Fatal scan error: ${err.message}`, ts: Date.now() });
  }

  clearInterval(ping);
  res.end();
});

// ── GET /api/status ───────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  const { lastScan } = getAllAlerts();
  res.json({
    success: true,
    status: "online",
    serverTime: new Date().toISOString(),
    lastScan,
    schedule: {
      "1h": "Every hour at :15",
      "4h": "1AM, 5AM, 9AM, 1PM, 5PM, 9PM",
      "1d": "8PM daily",
    },
  });
});

module.exports = router;
