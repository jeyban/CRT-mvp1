/**
 * scanner.js — API Routes
 *
 * GET /api/alerts          → All alerts for all timeframes
 * GET /api/alerts/:tf      → Alerts for specific timeframe (1h, 4h, 1d)
 * POST /api/scan/:tf       → Manually trigger a scan (for testing)
 * GET /api/status          → Server health + last scan times
 */

const express = require("express");
const router = express.Router();
const { getAllAlerts, getAlerts } = require("../data/store");
const { runScan } = require("../services/scheduler");

// ── GET /api/alerts ───────────────────────────────────────────────────────
// Returns all alerts for all timeframes + last scan times
router.get("/alerts", (req, res) => {
  const data = getAllAlerts();
  res.json({
    success: true,
    data,
  });
});

// ── GET /api/alerts/:tf ───────────────────────────────────────────────────
// Returns alerts for a specific timeframe
router.get("/alerts/:tf", (req, res) => {
  const { tf } = req.params;
  const validTfs = ["1h", "4h", "1d"];

  if (!validTfs.includes(tf)) {
    return res.status(400).json({
      success: false,
      error: `Invalid timeframe. Use: ${validTfs.join(", ")}`,
    });
  }

  const alerts = getAlerts(tf);
  res.json({
    success: true,
    timeframe: tf,
    count: alerts.length,
    alerts,
  });
});

// ── POST /api/scan/:tf ────────────────────────────────────────────────────
// Manually trigger a scan — great for testing without waiting for cron
router.post("/scan/:tf", async (req, res) => {
  const { tf } = req.params;
  const validTfs = ["1h", "4h", "1d"];

  if (!validTfs.includes(tf)) {
    return res.status(400).json({
      success: false,
      error: `Invalid timeframe. Use: ${validTfs.join(", ")}`,
    });
  }

  try {
    // Return immediately and run scan in background
    res.json({
      success: true,
      message: `Scan started for ${tf}. Check /api/alerts/${tf} in ~30 seconds.`,
    });

    // Run scan async (don't await — let it run in background)
    runScan(tf).catch(console.error);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/status ───────────────────────────────────────────────────────
// Health check + meta info
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
