// Rig store — the in-memory dictionary of { [rigNum]: { meta, rows, files } }
// keyed by rig number. main.js owns the single instance; this module is a
// catalogue of pure mutations + selectors so call sites stop poking the shape
// directly and so we have a place to add invariants (e.g. always sort rows
// after merging) once instead of at 10 call sites.
//
// All mutations take the store as the first argument and mutate in place.
// They return either the affected rig entry or a small status value, never a
// new copy of the whole store — the rigStore identity is shared with the
// rest of the app via main.js.

import { safeNum, safeStr } from '../utils.js';
import { RIG_CUST } from '../constants.js';
import { parseDate } from '../dates.js';

/** Build an empty store. Useful for tests and JSON import resets. */
export function createRigStore() { return {}; }

/** Drop every rig entry without breaking the store identity. */
export function clearRigs(store) {
  for (const k of Object.keys(store)) delete store[k];
}

/** Ensure store[rig] exists with the canonical shape. Returns the entry. */
export function ensureRig(store, rig) {
  if (!store[rig]) store[rig] = { meta: {}, rows: [], files: [] };
  return store[rig];
}

/** Read access — null when the rig has no entry. */
export function getRig(store, rig) {
  return store[rig] || null;
}

/** Set the rig's metadata (customer/well/contract/po) wholesale. */
export function setRigMeta(store, rig, meta) {
  const entry = ensureRig(store, rig);
  entry.meta = { ...meta };
  return entry;
}

/**
 * Merge metadata in priority order: incoming > existing > RIG_CUST default.
 * Used by the silent batch-merge path so a later file with empty fields
 * doesn't blank out earlier good values.
 */
export function setRigMetaFallback(store, rig, partial = {}, defaults = {}) {
  const entry = ensureRig(store, rig);
  entry.meta = {
    customer:
      partial.customer || entry.meta.customer || defaults.customer || RIG_CUST[rig] || '',
    well:     partial.well     || entry.meta.well     || defaults.well     || '',
    contract: partial.contract || entry.meta.contract || defaults.contract || '',
    po:       partial.po       || entry.meta.po       || defaults.po       || '',
  };
  return entry;
}

/** Append fileName to the rig's files[] unless already present. No-op if the
 *  rig has no entry yet. */
export function addFileToRig(store, rig, fileName) {
  if (!fileName) return;
  const entry = store[rig];
  if (!entry) return;
  if (!entry.files.includes(fileName)) entry.files.push(fileName);
}

/** Replace the row whose date matches `row.date`. Returns true on hit. */
export function replaceRowByDate(store, rig, row) {
  const entry = store[rig];
  if (!entry) return false;
  const idx = entry.rows.findIndex(r => r.date === row.date);
  if (idx < 0) return false;
  entry.rows[idx] = { ...row };
  return true;
}

/** Append `row` only if no existing row already has that date. Returns true
 *  if appended. Used by the consolidated-Excel reload path which bypasses
 *  the regular merge logic. */
export function appendRowIfNew(store, rig, row) {
  const entry = ensureRig(store, rig);
  if (entry.rows.some(r => r.date === row.date)) return false;
  entry.rows.push(row);
  return true;
}

/** Sort the rig's rows in chronological order. */
export function sortRowsByDate(store, rig) {
  const entry = store[rig];
  if (!entry) return;
  entry.rows.sort((a, b) => (parseDate(a.date) || 0) - (parseDate(b.date) || 0));
}

/** Restore a rig from a saved snapshot (JSON import / autoLoad). */
export function restoreRig(store, rig, data) {
  store[rig] = {
    meta: data.meta || {},
    rows: data.rows || [],
    files: data.files || [],
  };
  return store[rig];
}

/**
 * Compute the headline stats shown in the bottom export bar:
 *   { rigs, rows, operatingHours }
 * — rigs counts only entries with at least one row.
 */
export function aggregateStats(store) {
  let rigs = 0, rows = 0, operatingHours = 0;
  for (const entry of Object.values(store)) {
    if (entry && entry.rows && entry.rows.length) {
      rigs++;
      rows += entry.rows.length;
      operatingHours += entry.rows.reduce((s, r) => s + safeNum(r.operating), 0);
    }
  }
  return { rigs, rows, operatingHours };
}

/** True when the rig has any extracted rows. */
export function hasData(store, rig) {
  const entry = store[rig];
  return !!(entry && entry.rows && entry.rows.length);
}

/** Update metadata fields, only when the incoming value is truthy. Used by
 *  the consolidated-Excel reload so an absent column doesn't blank out a
 *  previously-good value. Customer is special-cased: it's written even when
 *  empty so callers can use the `customer || RIG_CUST[rig]` fallback chain
 *  upstream and have the result land in the store. */
export function updateRigMetaFields(store, rig, partial) {
  const entry = ensureRig(store, rig);
  if (partial.customer !== undefined) entry.meta.customer = safeStr(partial.customer);
  if (partial.well)     entry.meta.well     = safeStr(partial.well);
  if (partial.contract) entry.meta.contract = safeStr(partial.contract);
  if (partial.po)       entry.meta.po       = safeStr(partial.po);
}
