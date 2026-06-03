/**
 * glStore.js — In-Memory Store for Gainers/Losers Scanner
 *
 * Completely separate from store.js to avoid any interference with
 * the main CRT scanner's auto/manual cache or Supabase writes.
 *
 * Results are UI-only (manual scan results, never saved to DB).
 * The gainers/losers scanner is always "manual" from the DB's perspective.
 */

// ── In-memory caches per timeframe ───────────────────────────────────────────
const glCache = {
  "1h": null,
  "4h": null,
  "1d": null,
};

const glScannedAt = {
  "1h": null,
  "4h": null,
  "1d": null,
};

// ── Scan state (mirrors main store pattern) ────────────────────────────────────
const glScanState = {
  "1h": { running: false, startedAt: null, type: null, progress: null },
  "4h": { running: false, startedAt: null, type: null, progress: null },
  "1d": { running: false, startedAt: null, type: null, progress: null },
};

// ── Last top-movers snapshot (for display in summary) ─────────────────────────
let lastSnapshot = { gainers: [], losers: [], fetchedAt: null };

// ─────────────────────────────────────────────────────────────────────────────
// Scan state management
// ─────────────────────────────────────────────────────────────────────────────

function glSetScanState(tf, type, totalPairs) {
  glScanState[tf] = {
    running:   true,
    startedAt: new Date().toISOString(),
    type,
    progress:  { scanned: 0, total: totalPairs || 0, found: 0, errors: 0 },
  };
  console.log(`[GLStore] Scan state SET — GL ${tf} ${type} (${totalPairs} pairs)`);
}

function glUpdateScanProgress(tf, delta) {
  if (!glScanState[tf] || !glScanState[tf].running) return;
  const p = glScanState[tf].progress;
  if (delta.scanned) p.scanned += delta.scanned;
  if (delta.found)   p.found   += delta.found;
  if (delta.errors)  p.errors  += delta.errors;
}

function glClearScanState(tf) {
  glScanState[tf] = { running: false, startedAt: null, type: null, progress: null };
  console.log(`[GLStore] Scan state CLEARED — GL ${tf}`);
}

function glGetScanState(tf) {
  return glScanState[tf] || { running: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result management
// ─────────────────────────────────────────────────────────────────────────────

function glSetAlerts(tf, alerts) {
  glCache[tf]      = alerts;
  glScannedAt[tf]  = new Date().toISOString();
  console.log(`[GLStore] Stored ${alerts.length} GL alerts for ${tf}`);
}

function glGetAlerts(tf) {
  return glCache[tf] || [];
}

function glGetAllAlerts() {
  return {
    "1h":      glCache["1h"] || [],
    "4h":      glCache["4h"] || [],
    "1d":      glCache["1d"] || [],
    lastScan:  { "1h": glScannedAt["1h"], "4h": glScannedAt["4h"], "1d": glScannedAt["1d"] },
    scanState: {
      "1h": glGetScanState("1h"),
      "4h": glGetScanState("4h"),
      "1d": glGetScanState("1d"),
    },
  };
}

function glSetSnapshot(snapshot) {
  lastSnapshot = { ...snapshot, fetchedAt: new Date().toISOString() };
}

function glGetSnapshot() {
  return lastSnapshot;
}

module.exports = {
  glSetScanState,
  glUpdateScanProgress,
  glClearScanState,
  glGetScanState,
  glSetAlerts,
  glGetAlerts,
  glGetAllAlerts,
  glSetSnapshot,
  glGetSnapshot,
};
