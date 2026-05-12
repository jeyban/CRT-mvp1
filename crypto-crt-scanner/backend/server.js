/**
 * server.js — Main Express Server Entry Point
 *
 * Starts the Express API server and registers scheduled scans.
 * Frontend fetches from this server to display CRT alerts.
 */

const express = require("express");
const cors = require("cors");
const scannerRoutes = require("./routes/scanner");
const { startScheduler, runScan } = require("./services/scheduler");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────

app.use(cors({
  origin: true,
  methods: ["GET", "POST"],
  credentials: true,
}));

app.options("*", cors());
app.use(express.json());

// ─── Request logging ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────
app.use("/api", scannerRoutes);

app.get("/", (req, res) => {
  res.json({
    name: "Crypto CRT Scanner API",
    version: "1.0.0",
    docs: "/api/status",
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 CRT Scanner API running on port ${PORT}`);

  // Start cron schedulers
  startScheduler();

  // ── Run ALL three scans on every startup ────────────────────────────────
  // IMPORTANT: Render free tier shuts down after 15min of inactivity.
  // When it wakes up, in-memory alerts are wiped. Running all scans on boot
  // ensures the dashboard always has fresh data immediately after wakeup.
  console.log("▶ Running startup scans for all timeframes (1H → 4H → 1D)...");
  runScan("1h")
    .then(() => runScan("4h"))
    .then(() => runScan("1d"))
    .then(() => console.log("✅ All startup scans complete."))
    .catch(console.error);
});

module.exports = app;
