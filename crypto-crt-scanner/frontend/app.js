/**
 * app.js — CRT Scanner Dashboard Logic
 *
 * - Polls the backend every 60 seconds for fresh alerts
 * - Renders separate logs for 1H, 4H, 1D timeframes
 * - Search bar filters across all timeframes
 * - Manual scan trigger buttons
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────
// Change this to your deployed backend URL before going to production
const API_BASE = window.BACKEND_URL || "http://localhost:3001/api";

// How often to auto-refresh (milliseconds)
const REFRESH_INTERVAL = 60_000; // 60 seconds

// ─── State ────────────────────────────────────────────────────────────────
let allAlerts = { "1h": [], "4h": [], "1d": [] };
let searchQuery = "";
let isScanning = { "1h": false, "4h": false, "1d": false };

// ─── DOM References ───────────────────────────────────────────────────────
const searchInput    = document.getElementById("searchInput");
const lastRefreshEl  = document.getElementById("lastRefresh");
const statusDotEl    = document.getElementById("statusDot");

// ─── Fetch All Alerts from Backend ────────────────────────────────────────
async function fetchAlerts() {
  try {
    const res = await fetch(`${API_BASE}/alerts`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (json.success) {
      allAlerts = json.data;
      renderAll();
      updateLastRefresh(json.data.lastScan);
      setOnline(true);
    }
  } catch (err) {
    console.error("Failed to fetch alerts:", err);
    setOnline(false);
  }
}

// ─── Render All Timeframe Logs ────────────────────────────────────────────
function renderAll() {
  renderLog("1h");
  renderLog("4h");
  renderLog("1d");
}

function renderLog(tf) {
  const container  = document.getElementById(`log-${tf}`);
  const countEl    = document.getElementById(`count-${tf}`);
  if (!container) return;

  const alerts = allAlerts[tf] || [];

  // Apply search filter
  const filtered = searchQuery
    ? alerts.filter((a) =>
        a.symbol.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : alerts;

  // Update count badge
  if (countEl) {
    countEl.textContent = filtered.length;
    countEl.className = filtered.length > 0
      ? "badge badge-active"
      : "badge badge-empty";
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📭</span>
        <p>${searchQuery ? "No results match your search." : "No CRT setups detected yet."}</p>
        <small>Next scan runs on schedule — or trigger manually above.</small>
      </div>`;
    return;
  }

  container.innerHTML = filtered.map(renderCard).join("");
}

// ─── Render a Single Alert Card ───────────────────────────────────────────
function renderCard(alert) {
  const isBullish  = alert.direction === "BULLISH";
  const dirClass   = isBullish ? "bullish" : "bearish";
  const dirIcon    = isBullish ? "▲" : "▼";
  const dirLabel   = isBullish ? "Bullish CRT" : "Bearish CRT";

  // Format price: show more decimals for small coins
  const fmt = (n) => {
    if (!n && n !== 0) return "—";
    if (n < 0.01) return n.toFixed(6);
    if (n < 1)    return n.toFixed(4);
    if (n < 100)  return n.toFixed(3);
    return n.toFixed(2);
  };

  const time = new Date(alert.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const sweepLabel  = isBullish ? "Swept Above" : "Swept Below";
  const sweepValue  = isBullish ? fmt(alert.c1High) : fmt(alert.c1Low);
  const reclaimDir  = isBullish ? "Below C1 High" : "Above C1 Low";

  return `
    <div class="card ${dirClass}">
      <div class="card-header">
        <div class="card-symbol">
          <span class="symbol-name">${alert.symbol.replace("USDT", "")}</span>
          <span class="symbol-pair">/USDT</span>
        </div>
        <div class="card-dir ${dirClass}">
          <span class="dir-icon">${dirIcon}</span>
          ${dirLabel}
        </div>
      </div>

      <div class="card-body">
        <div class="stat-row">
          <div class="stat">
            <label>Current Price</label>
            <value class="price-live">$${fmt(alert.currentPrice)}</value>
          </div>
          <div class="stat">
            <label>${sweepLabel}</label>
            <value>$${sweepValue}</value>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat">
            <label>C1 High</label>
            <value>$${fmt(alert.c1High)}</value>
          </div>
          <div class="stat">
            <label>C1 Low</label>
            <value>$${fmt(alert.c1Low)}</value>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat">
            <label>C2 High</label>
            <value>$${fmt(alert.c2High)}</value>
          </div>
          <div class="stat">
            <label>C2 Low</label>
            <value>$${fmt(alert.c2Low)}</value>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat">
            <label>Reclaim %</label>
            <value class="${dirClass}">${alert.reclaimPercent || "—"}%</value>
          </div>
          <div class="stat">
            <label>Now</label>
            <value>${reclaimDir}</value>
          </div>
        </div>
      </div>

      <div class="card-footer">
        <span class="tf-badge">${alert.timeframe.toUpperCase()}</span>
        <span class="scan-time">Scanned at ${time}</span>
      </div>
    </div>`;
}

// ─── Manual Scan Trigger ──────────────────────────────────────────────────
async function triggerScan(tf) {
  if (isScanning[tf]) return;

  const btn = document.getElementById(`scan-btn-${tf}`);
  if (btn) {
    isScanning[tf] = true;
    btn.disabled = true;
    btn.textContent = "Scanning…";
  }

  try {
    const res = await fetch(`${API_BASE}/scan/${tf}`, { method: "POST" });
    const json = await res.json();

    if (json.success) {
      showToast(`${tf.toUpperCase()} scan started! Results in ~30s.`);
      // Wait 35s then auto-refresh results
      setTimeout(fetchAlerts, 35_000);
    }
  } catch (err) {
    showToast("Failed to trigger scan. Is the backend running?", true);
  } finally {
    // Re-enable button after 40 seconds
    setTimeout(() => {
      isScanning[tf] = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = `Scan ${tf.toUpperCase()}`;
      }
    }, 40_000);
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────
function updateLastRefresh(lastScan) {
  if (!lastRefreshEl) return;
  const times = Object.values(lastScan || {}).filter(Boolean);
  if (times.length === 0) {
    lastRefreshEl.textContent = "Never";
    return;
  }
  const latest = times.sort().reverse()[0];
  lastRefreshEl.textContent = new Date(latest).toLocaleTimeString();
}

function setOnline(online) {
  if (!statusDotEl) return;
  statusDotEl.className = online ? "status-dot online" : "status-dot offline";
  statusDotEl.title = online ? "Backend connected" : "Backend offline";
}

function showToast(msg, isError = false) {
  const toast = document.createElement("div");
  toast.className = `toast ${isError ? "toast-error" : "toast-success"}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("toast-visible"), 10);
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ─── Search ───────────────────────────────────────────────────────────────
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderAll();
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────
fetchAlerts(); // Initial load
setInterval(fetchAlerts, REFRESH_INTERVAL); // Auto-refresh every 60s

// Expose triggerScan globally so HTML onclick works
window.triggerScan = triggerScan;
