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

// CORS fix: use origin: true to reflect any origin (works for all frontends)
app.use(cors({
  origin: true,
  methods: ["GET", "POST"],
  credentials: true,
}));

// Handle CORS preflight requests for all routes
app.options("*", cors());

app.use(express.json());

// ─── Request logging (simple, no libraries needed) ────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────
app.use("/api", scannerRoutes);

// Root endpoint — quick sanity check
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
  console.log(`   http://localhost:${PORT}\n`);

  // Start cron schedulers
  startScheduler();

  // Optional: run an initial 1H scan on boot so dashboard isn't empty
  console.log("▶ Running initial 1H scan on startup...");
  runScan("1h").catch(console.error);
});

module.exports = app;
