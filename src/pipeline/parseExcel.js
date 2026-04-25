// Excel workbook → per-sheet { formatted, raw } maps.
//
// Reads the workbook twice (once with formatted strings, once with raw values)
// because the downstream extractor needs both: formatted for human-readable
// dates / numbers, raw for serial dates and unrounded numerics. Sheets that
// look ancillary (diesel, discount, ticket, fuel, 4%) are skipped at the
// name level. Sheets that survive get a header-row probe; those with no
// detectable header AND fewer than 6 rows are dropped as boilerplate.
//
// The orchestrator returns a plain data object — it never touches the DOM
// or the global state. main.js wires the resulting maps into currentRawSheets
// and updates the sheet picker.

import { findHeaderRow } from '../detection.js';

/** Sheet names that are ancillary in real-world Abraj workbooks. */
export const EXCLUDED_SHEET_NAME_PATTERN = /diesel|discount|ticket|fuel|4%/i;

/** Minimum row count to accept a sheet that has no detectable header row. */
const MIN_ROWS_WITHOUT_HEADER = 6;

/**
 * Decide whether a sheet looks like a billing table.
 *
 * @param {{ formatted: any[][], raw: any[][] }} sheet
 * @returns {boolean}
 */
export function looksLikeBillingSheet(sheet) {
  const useData = sheet.formatted && sheet.formatted.length ? sheet.formatted : sheet.raw;
  const hr = findHeaderRow(useData);
  return hr >= 0 || (sheet.formatted && sheet.formatted.length > MIN_ROWS_WITHOUT_HEADER);
}

/**
 * Parse an Excel buffer into per-sheet formatted+raw maps. Returns billing-
 * looking sheets alongside the names of the ones we skipped (so callers can
 * surface why nothing matched).
 *
 * @param {ArrayBuffer} buf
 * @param {{ XLSX: any, log?: Function }} deps
 * @returns {{
 *   sheets: Object<string, { formatted: any[][], raw: any[][] }>,
 *   billingSheetNames: string[],
 *   skippedByName: string[],
 *   skippedAsBoilerplate: string[],
 * }}
 */
export function parseExcelBuffer(buf, { XLSX, log = () => {} }) {
  const wb = XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
  const wbRaw = XLSX.read(buf, { type: 'array', cellDates: false, raw: true });

  const sheets = {};
  const billingSheetNames = [];
  const skippedByName = [];
  const skippedAsBoilerplate = [];

  for (const sn of wb.SheetNames) {
    if (EXCLUDED_SHEET_NAME_PATTERN.test(sn)) {
      skippedByName.push(sn);
      continue;
    }
    const formatted = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null, raw: false });
    const raw = XLSX.utils.sheet_to_json(wbRaw.Sheets[sn], { header: 1, defval: null, raw: true });
    const sheet = { formatted, raw };
    if (looksLikeBillingSheet(sheet)) {
      sheets[sn] = sheet;
      billingSheetNames.push(sn);
    } else {
      skippedAsBoilerplate.push(sn);
      log(`  Skipping sheet "${sn}" (no billing table found)`, 'info');
    }
  }

  return { sheets, billingSheetNames, skippedByName, skippedAsBoilerplate };
}
