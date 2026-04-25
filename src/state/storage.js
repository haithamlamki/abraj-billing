// Persistence layer — pure functions for browser-side state save/load and
// JSON import/export. Decoupled from DOM and rigStore mutation so the logic
// can be unit-tested without a browser.
//
// Conventions:
//  - Pure functions take rigStore + month/year, return data; they never read
//    or mutate module-level state in main.js.
//  - Side-effecting functions (the localStorage I/O) wrap a `storage` arg that
//    defaults to `globalThis.localStorage` so tests can pass a stub.

import { RIGS, RIG_CUST } from '../constants.js';

export const STORAGE_KEY = 'abraj_billing_extractor_data';

/**
 * Build the payload that gets written to localStorage. Strips the internal
 * `_source` marker (recomputed on next merge) and only includes rigs with rows.
 *
 * @param {Object} rigStore - { [rigNum]: { meta, rows, files } }
 * @param {number} billingMonth - 1-12
 * @param {number} billingYear
 * @param {number[]} [allowedRigs] - rigs to include (defaults to RIGS)
 * @returns {{ rigs: Object, billingMonth: number, billingYear: number, savedAt: string }}
 */
export function buildStoragePayload(rigStore, billingMonth, billingYear, allowedRigs = RIGS) {
  const data = {};
  for (const rig of allowedRigs) {
    const entry = rigStore[rig];
    if (entry && entry.rows && entry.rows.length > 0) {
      data[rig] = {
        meta: entry.meta,
        rows: entry.rows.map(r => {
          const c = { ...r };
          delete c._source;
          return c;
        }),
        files: entry.files,
      };
    }
  }
  return { savedAt: new Date().toISOString(), billingMonth, billingYear, rigs: data };
}

/**
 * Build the payload for a JSON file download/share. Differs from the storage
 * payload in that it tags a version and exportedAt, and falls back to RIG_CUST
 * for missing customer metadata.
 */
export function buildJsonExportPayload(rigStore, billingMonth, billingYear, allowedRigs = RIGS) {
  const payload = {
    version: '2.0-qc',
    exportedAt: new Date().toISOString(),
    billingMonth,
    billingYear,
    rigs: {},
  };
  for (const rig of allowedRigs) {
    const entry = rigStore[rig];
    if (entry && entry.rows && entry.rows.length) {
      // Always backfill missing customer from RIG_CUST, even if other meta
      // fields (well/contract/po) are present.
      const meta = { ...(entry.meta || {}) };
      if (!meta.customer) meta.customer = RIG_CUST[rig] || '';
      payload.rigs[rig] = { meta, rows: entry.rows, files: entry.files || [] };
    }
  }
  return payload;
}

/**
 * Parse an imported JSON file (either a storage snapshot or an export payload).
 * Returns the rig entries keyed by rig number, plus the saved month/year.
 * Unknown rigs (not in `allowedRigs`) are dropped silently.
 *
 * @returns {{ rigs: Object, billingMonth: number|null, billingYear: number|null, count: number }}
 */
export function parseJsonImport(jsonText, allowedRigs = RIGS) {
  const data = JSON.parse(jsonText);
  const allowed = new Set(allowedRigs);
  const out = { rigs: {}, billingMonth: null, billingYear: null, count: 0 };
  if (data.billingMonth) out.billingMonth = Number(data.billingMonth);
  if (data.billingYear) out.billingYear = Number(data.billingYear);
  const rigs = data.rigs || {};
  for (const [rig, val] of Object.entries(rigs)) {
    const r = parseInt(rig);
    if (!allowed.has(r)) continue;
    out.rigs[r] = {
      meta: val.meta || { customer: RIG_CUST[r] || '' },
      rows: val.rows || [],
      files: val.files || ['json-import'],
    };
    out.count++;
  }
  return out;
}

// ---------- localStorage I/O ----------
// All take a `storage` arg defaulting to globalThis.localStorage so tests can
// pass a Map-like stub. In the browser the default is just localStorage.

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/**
 * Save the rigStore to localStorage. Returns the number of rigs persisted (0
 * if there was nothing to save), or -1 on error.
 */
export function saveToStorage(rigStore, billingMonth, billingYear, storage = defaultStorage()) {
  if (!storage) return -1;
  try {
    const payload = buildStoragePayload(rigStore, billingMonth, billingYear);
    const count = Object.keys(payload.rigs).length;
    if (count === 0) return 0;
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return count;
  } catch {
    return -1;
  }
}

/**
 * Load the saved snapshot. Returns null if nothing saved or parse fails.
 */
export function loadFromStorage(storage = defaultStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.rigs) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearStorage(storage = defaultStorage()) {
  if (!storage) return;
  storage.removeItem(STORAGE_KEY);
}
