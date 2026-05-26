/**
 * server.js — Main Entry Point
 */

const express = require("express");
const app     = express();
const PORT    = process.env.PORT || 3001;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(function (req, res, next) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use(express.json());

// ── Request logging ───────────────────────────────────────────────────────────
app.use(function (req, res, next) {
  console.log(
    "[" + new Date().toLocaleTimeString() + "] " + req.method + " " + req.path
  );
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
const scannerRoutes = require("./routes/scanner");
app.use("/api", scannerRoutes);

app.get("/", function (req, res) {
  res.json({ name: "CRT Scanner API", version: "2.1.0", timeframes: ["4h", "1d"] });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const { startScheduler, runScan } = require("./services/scheduler");

app.listen(PORT, async function () {
  console.log("\n🚀 CRT Scanner API on port " + PORT);

  startScheduler();

  // Self-ping to keep Render free tier awake
  const SELF =
    (process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT) +
    "/api/status";
  setInterval(function () {
    fetch(SELF)
      .then((r) => console.log("[ping] " + r.status))
      .catch((e) => console.warn("[ping] failed:", e.message));
  }, 10 * 60 * 1000);
  console.log("[ping] Self-ping → " + SELF);

  // Startup scans so dashboard is never empty
  console.log("\n▶ Running startup scans...");
  try {
    await runScan("4h");
    await runScan("1d");
    console.log("✅ Startup scans complete.\n");
  } catch (e) {
    console.error("Startup scan error:", e.message);
  }
});

module.exports = app;
