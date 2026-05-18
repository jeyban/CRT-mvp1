/**
 * server.js — Main Entry Point
 *
 * Changes from original:
 *  - Self-ping every 10 minutes (keeps Render free tier awake)
 *  - Runs 4H + 1D scans on startup (no 1H)
 *  - Loads history from Supabase on boot if memory is empty
 */

const express = require("express");
const cors    = require("cors");
const scannerRoutes = require("./routes/scanner");
const { startScheduler, runScan } = require("./services/scheduler");

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Validate required env vars ────────────────────────────────────────────────
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.warn("⚠ SUPABASE_URL or SUPABASE_KEY not set — history will not persist!");
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, methods: ["GET", "POST"], credentials: true }));
app.options("*", cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api", scannerRoutes);
app.get("/", (req, res) => {
  res.json({ name: "CRT Scanner API", version: "2.0.0", timeframes: ["4h","1d"] });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 CRT Scanner API running on port ${PORT}`);

  // Register cron schedules
  startScheduler();

  // ── Self-ping every 10 minutes to prevent Render free tier sleep ───────────
  // Render spins down services after 15min of no inbound traffic.
  // Pinging our own /api/status endpoint keeps it alive 24/7 for free.
  const SELF_URL = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/api/status`
    : `http://localhost:${PORT}/api/status`;

  setInterval(async () => {
    try {
      const res = await fetch(SELF_URL);
      console.log(`[ping] Self-ping OK (${res.status})`);
    } catch (err) {
      console.warn(`[ping] Self-ping failed: ${err.message}`);
    }
  }, 10 * 60 * 1000); // every 10 minutes

  console.log(`[ping] Self-ping registered → ${SELF_URL}`);

  // ── Run startup scans so dashboard is never empty after a restart ──────────
  console.log("\n▶ Running startup scans (4H → 1D)...");
  try {
    await runScan("4h");
    await runScan("1d");
    console.log("✅ Startup scans complete.\n");
  } catch (err) {
    console.error("Startup scan error:", err.message);
  }
});

module.exports = app;
