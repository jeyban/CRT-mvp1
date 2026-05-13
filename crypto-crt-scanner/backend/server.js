/**
 * server.js — Main Express Server Entry Point
 */

const express = require("express");
const cors = require("cors");
const scannerRoutes = require("./routes/scanner");
const { startScheduler, runScan } = require("./services/scheduler");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, methods: ["GET", "POST"], credentials: true }));
app.options("*", cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

app.use("/api", scannerRoutes);

app.get("/", (req, res) => {
  res.json({ name: "Crypto CRT Scanner API", version: "1.0.0", docs: "/api/status" });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 CRT Scanner API running on port ${PORT}`);

  startScheduler();

  // ── Run ALL THREE scans on every startup ──────────────────────────────────
  // This is critical because:
  // 1. Render free tier wipes memory on sleep/wake
  // 2. 4H only runs 6x/day, 1D only runs once — so without startup scans
  //    those panels stay empty until their cron time hits
  console.log("▶ Running startup scans: 1H → 4H → 1D...");
  runScan("1h")
    .then(() => runScan("4h"))
    .then(() => runScan("1d"))
    .then(() => console.log("✅ All startup scans complete."))
    .catch(console.error);
});

module.exports = app;
