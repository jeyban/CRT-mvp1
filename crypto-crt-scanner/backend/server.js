/**
 * server.js — Main Entry Point
 *
 * DEPLOYMENT FIXES:
 *  1. Startup scans run AFTER the server is listening (non-blocking)
 *     Previously: await runScan() INSIDE app.listen() callback blocked
 *     the port from being marked "ready" on Render, causing health check
 *     failures and the service being killed before it ever accepted requests.
 *
 *  2. CORS explicitly allows the Vercel frontend origin.
 *
 *  3. /healthz route added — Render's health check hits this before /api/status.
 *
 *  4. Unhandled rejection guard so one bad scan doesn't crash the process.
 */

const express = require("express");
const app     = express();
const PORT    = process.env.PORT || 3001;

// ── CORS — must be FIRST ───────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://crt-mvp1.vercel.app",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(function(req, res, next) {
  var origin = req.headers.origin;
  // Allow the known Vercel frontend, or any request with no origin (Render health checks, curl)
  if (!origin || ALLOWED_ORIGINS.indexOf(origin) !== -1) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else {
    // Fallback: allow all during development — tighten this in production if needed
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

app.use(express.json());

// ── Request logging ────────────────────────────────────────────────────────────
app.use(function(req, res, next) {
  console.log("[" + new Date().toLocaleTimeString() + "] " + req.method + " " + req.path);
  next();
});

// ── Health check — Render pings this to confirm the service is up ─────────────
// Must respond FAST (< 30s) or Render marks the deploy as failed.
// This route intentionally does nothing heavy.
app.get("/healthz", function(req, res) {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
const scannerRoutes = require("./routes/scanner");
app.use("/api", scannerRoutes);

app.get("/", function(req, res) {
  res.json({ name: "CRT Scanner API", version: "2.0.0", timeframes: ["4h", "1d"] });
});

// ── Unhandled rejection guard — prevents one bad scan from crashing process ───
process.on("unhandledRejection", function(reason) {
  console.error("[UNHANDLED REJECTION]", reason);
  // Do NOT exit — keep the server alive
});

// ── Start ─────────────────────────────────────────────────────────────────────
const { startScheduler, runScan } = require("./services/scheduler");

app.listen(PORT, function() {
  console.log("\n🚀 CRT Scanner API on port " + PORT);
  console.log("   Health check: GET /healthz");
  console.log("   Status:       GET /api/status\n");

  // Start cron schedules
  startScheduler();

  // Self-ping every 10 minutes to keep Render free tier awake
  var SELF = (process.env.RENDER_EXTERNAL_URL || "http://localhost:" + PORT) + "/healthz";
  setInterval(function() {
    fetch(SELF)
      .then(function(r) { console.log("[ping] " + r.status); })
      .catch(function(e) { console.warn("[ping] failed:", e.message); });
  }, 10 * 60 * 1000);
  console.log("[ping] Self-ping registered → " + SELF);

  // FIX: run startup scans OUTSIDE the listen callback via setImmediate
  // This lets the port bind and health check pass BEFORE scans start.
  // Render requires the port to respond within ~30s of startup.
  setImmediate(function() {
    console.log("\n▶ Running startup scans (non-blocking)…");
    runScan("4h")
      .then(function() { return runScan("1d"); })
      .then(function() { console.log("✅ Startup scans complete.\n"); })
      .catch(function(e) { console.error("Startup scan error:", e.message); });
  });
});

module.exports = app;
