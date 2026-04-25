// Mapping UI helpers — pure HTML builders, no DOM, fully testable.
//
// Exports:
//   buildColOptionsHTML(hRow, rawRow, extraRow?)  → <option> HTML string
//   buildMappingItemHTML(tc, colOptions)           → mapping widget HTML string
//
// DOM functions (buildMappingUI, updateGroupCounts, autoMap,
// updateMapStatus, applyMapping) remain in main.js because they read/write
// live DOM <select> elements and module-level state.

import { safeStr } from '../utils.js';

/**
 * Build the <option> list for a column-mapping <select>.
 * Pure — no DOM access; suitable for Vitest.
 *
 * @param {any[]} hRow      — formatted header row cells
 * @param {any[]} rawRow    — raw header row cells (fallback labels)
 * @param {any[]} extraRow  — first data row (used to detect unlabelled extra cols)
 * @returns {string} HTML <option> elements (no surrounding <select>)
 */
export function buildColOptionsHTML(hRow = [], rawRow = [], extraRow = []) {
  const MAX_HEADER_COLS = 20;
  const MAX_EXTRA_COLS  = 25;
  const maxCols = Math.min(Math.max(hRow.length, rawRow.length), MAX_HEADER_COLS);

  let opts = '';
  for (let c = 0; c < maxCols; c++) {
    const name    = safeStr(hRow[c]).replace(/\n/g, ' ') || safeStr(rawRow[c]).replace(/\n/g, ' ') || `(Col ${c + 1})`;
    const display = name.length > 30 ? name.substring(0, 30) + '...' : name;
    opts += `<option value="${c}">Col ${c + 1}: ${display}</option>`;
  }

  // Columns past the header-row width that still contain data in the first data row.
  for (let c = maxCols; c < Math.min(extraRow.length, MAX_EXTRA_COLS); c++) {
    opts += `<option value="${c}">Col ${c + 1}: (no header)</option>`;
  }

  return opts;
}

/**
 * Build the inner HTML for one mapping widget (label + select).
 * Pure — returned string is injected into a .map-item container by the caller.
 *
 * @param {{ key: string, label: string }} tc         — TARGET_COLS entry
 * @param {string}                         colOptions — output of buildColOptionsHTML
 * @returns {string}
 */
export function buildMappingItemHTML(tc, colOptions) {
  return `<label>${tc.label}</label>
    <select id="sel-${tc.key}" data-map-key="${tc.key}">
      <option value="-1">-- not mapped --</option>
      ${colOptions}
    </select>`;
}
