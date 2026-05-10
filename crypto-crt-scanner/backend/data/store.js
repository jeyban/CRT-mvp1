/**
 * store.js — In-memory data store
 * Holds the latest CRT alerts per timeframe.
 * Resets on each scan run to always show fresh results.
 */

const store = {
  // Each timeframe holds an array of alert objects
  "1h": [],
  "4h": [],
  "1d": [],

  // Track the last time each timeframe was scanned
  lastScan: {
    "1h": null,
    "4h": null,
    "1d": null,
  },
};

/**
 * Replace alerts for a given timeframe with fresh results.
 * @param {string} tf - Timeframe: "1h", "4h", or "1d"
 * @param {Array}  alerts - Array of alert objects from CRT scan
 */
function setAlerts(tf, alerts) {
  store[tf] = alerts;
  store.lastScan[tf] = new Date().toISOString();
}

/**
 * Get all alerts for a given timeframe.
 * @param {string} tf - Timeframe
 * @returns {Array}
 */
function getAlerts(tf) {
  return store[tf];
}

/**
 * Get a summary of all timeframes for the /api/alerts endpoint.
 */
function getAllAlerts() {
  return {
    "1h": store["1h"],
    "4h": store["4h"],
    "1d": store["1d"],
    lastScan: store.lastScan,
  };
}

module.exports = { setAlerts, getAlerts, getAllAlerts };
