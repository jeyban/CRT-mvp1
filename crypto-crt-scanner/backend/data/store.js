/**
 * store.js — Alert Store with Supabase Persistence
 *
 * setAlerts(tf, alerts)     — saves to memory AND Supabase (auto scans only)
 * setMemoryOnly(tf, alerts) — saves to memory ONLY (manual scans, no history)
 * getAlerts(tf)             — reads memory, falls back to Supabase on empty
 * getAllAlerts()            — returns all timeframes
 * getHistory(tf, days)      — reads history from Supabase
 *
 * Supabase table SQL (run once in Supabase SQL editor):
 * ──────────────────────────────────────────────────────
 *   CREATE TABLE crt_alerts (
 *     id            TEXT PRIMARY KEY,
 *     symbol        TEXT NOT NULL,
 *     timeframe     TEXT NOT NULL,
 *     direction     TEXT NOT NULL,
 *     c1_high       NUMERIC,
 *     c1_low        NUMERIC,
 *     c2_high       NUMERIC,
 *     c2_low        NUMERIC,
 *     sweep_level   NUMERIC,
 *     current_price NUMERIC,
 *     scanned_at    TIMESTAMPTZ DEFAULT now(),
 *     raw           JSONB
 *   );
 *   CREATE INDEX ON crt_alerts (timeframe, scanned_at DESC);
 * ──────────────────────────────────────────────────────
 */

const { createClient } = require("@supabase/supabase-js");

// Supabase client — env vars set in Render dashboard
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = {
  "4h":     [],
  "1d":     [],
  lastScan: { "4h": null, "1d": null },
};

// ── setAlerts — AUTO scan only, saves to Supabase ─────────────────────────────
async function setAlerts(tf, alerts) {
  // Always update memory
  cache[tf]          = alerts;
  cache.lastScan[tf] = new Date().toISOString();

  if (!alerts || alerts.length === 0) {
    console.log(`[Store] No alerts to save for ${tf}`);
    return;
  }

  // Save to Supabase
  const rows = alerts.map(a => ({
    id:            a.id,
    symbol:        a.symbol,
    timeframe:     a.timeframe,
    direction:     a.direction,
    c1_high:       a.c1High,
    c1_low:        a.c1Low,
    c2_high:       a.c2High,
    c2_low:        a.c2Low,
    sweep_level:   a.sweepLevel,
    current_price: a.currentPrice,
    scanned_at:    a.timestamp,
    raw:           a,
  }));

  const { error } = await supabase
    .from("crt_alerts")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("[Store] Supabase upsert error:", error.message);
  } else {
    console.log(`[Store] ✅ Saved ${rows.length} alerts to Supabase (${tf})`);
  }
}

// ── setMemoryOnly — MANUAL scan only, does NOT touch Supabase ────────────────
function setMemoryOnly(tf, alerts) {
  cache[tf]          = alerts;
  cache.lastScan[tf] = new Date().toISOString();
  console.log(`[Store] Manual scan — ${alerts.length} alerts in memory only (not saved to DB)`);
}

// ── getAlerts — memory first, fallback to Supabase on empty ──────────────────
async function getAlerts(tf) {
  if (cache[tf] && cache[tf].length > 0) {
    return cache[tf];
  }

  // Empty memory — try loading last scan from Supabase
  try {
    const { data, error } = await supabase
      .from("crt_alerts")
      .select("raw")
      .eq("timeframe", tf)
      .order("scanned_at", { ascending: false })
      .limit(300);

    if (error) throw error;

    if (data && data.length > 0) {
      cache[tf] = data.map(r => r.raw).filter(Boolean);
      console.log(`[Store] Loaded ${cache[tf].length} alerts from Supabase (${tf})`);
    }
  } catch (err) {
    console.error("[Store] Supabase read error:", err.message);
  }

  return cache[tf] || [];
}

// ── getAllAlerts — used by /api/alerts ────────────────────────────────────────
async function getAllAlerts() {
  const [alerts4h, alerts1d] = await Promise.all([
    getAlerts("4h"),
    getAlerts("1d"),
  ]);

  return {
    "4h":     alerts4h,
    "1d":     alerts1d,
    lastScan: cache.lastScan,
  };
}

// ── getHistory — reads from Supabase for the History tab ─────────────────────
async function getHistory(tf, days = 7) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    let query = supabase
      .from("crt_alerts")
      .select("*")
      .gte("scanned_at", since)
      .order("scanned_at", { ascending: false });

    if (tf && tf !== "all") {
      query = query.eq("timeframe", tf);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error("[Store] History fetch error:", err.message);
    return [];
  }
}

module.exports = { setAlerts, setMemoryOnly, getAlerts, getAllAlerts, getHistory };
