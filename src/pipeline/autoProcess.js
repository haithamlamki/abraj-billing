// Auto-process pipeline — pure extraction logic, no DOM, fully testable.
//
// Exports:
//   extractFromSheet(sheetParams, { year, month, log? })  → extraction object
//   mergeExtractionSilently(extraction, fileName, rigStore) → merge result (no mutation)
//
// The thin wrappers in main.js supply the module-globals (billingYear, billingMonth,
// rigStore) and call Object.assign(rigStore, result.store) after merging.

import { RIG_CUST } from '../constants.js';
import { safeStr } from '../utils.js';
import { getDaysInMonth } from '../dates.js';
import { autoMapHeaders, detectUnnamedTextColumns } from '../mapping.js';
import { findHeaderRow, detectMeta } from '../detection.js';
import { mergeRowsIntoRig } from '../merge.js';
import { extractRows } from '../extract.js';
import { computeExtractionConfidence } from '../qc.js';
import { evaluateIssues } from '../review.js';
import { setRigMetaFallback } from '../state/rigStore.js';

// ─── extractFromSheet ─────────────────────────────────────────────────────────

/**
 * Run one sheet through the full extraction pipeline.
 * Pure — all context is passed explicitly; no DOM access.
 *
 * @param {{ sheetName, rawData, formatted, fileName, filenameRigHint }} sheet
 * @param {{ year: number, month: number, log?: Function }} opts
 * @returns {Object} extraction — { sheetName, fileName, rig, meta, headerRow, map,
 *                                  rows, confidence, duplicates, overHoursCount,
 *                                  issues, raw, formatted }
 */
export function extractFromSheet(
  { sheetName, rawData, formatted, fileName, filenameRigHint },
  { year, month, log = () => {} } = {},
) {
  const useData = formatted && formatted.length ? formatted : rawData;
  const headerRow = findHeaderRow(useData);
  const meta = detectMeta(useData, headerRow >= 0 ? headerRow : 10);
  const rig = filenameRigHint || (meta.rig ? parseInt(meta.rig) : null);

  let rows = [];
  let map = {};

  if (headerRow >= 0) {
    // Build a merged header row: prefer formatted text, fall back to raw.
    const fmtRow = useData[headerRow] || [];
    const rawRow = rawData[headerRow] || [];
    const hRow = [];
    const maxLen = Math.max(fmtRow.length, rawRow.length);
    for (let i = 0; i < maxLen; i++) {
      const fv = safeStr(fmtRow[i]).replace(/\n/g, ' ');
      const rv = safeStr(rawRow[i]).replace(/\n/g, ' ');
      if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(fv) && rv && !/^\d/.test(rv)) hRow.push(rv);
      else if (!fv && rv) hRow.push(rv);
      else hRow.push(fv || rv);
    }
    map = autoMapHeaders(hRow);
    detectUnnamedTextColumns(map, useData, headerRow);

    // Handle "stacked" headers where the row above has the column label.
    if (headerRow > 0) {
      const prevRow = (useData[headerRow - 1] || []).map(v => safeStr(v));
      for (let c = 0; c < prevRow.length; c++) {
        if (prevRow[c] && hRow[c]) {
          const combined = (prevRow[c] + ' ' + hRow[c]).toLowerCase();
          if (/(total\s*h|total\s*hrs)/.test(combined) && map.total_hrs === undefined) map.total_hrs = c;
          if (/operation/i.test(combined) && map.operation === undefined)            map.operation = c;
        }
      }
    }

    log(`Silent map [${fileName}]: headers=[${hRow.join(' | ')}] map=${JSON.stringify(map)}`, 'info');

    const extract = extractRows({ rawData, formatted, headerRow, map, billingYear: year, billingMonth: month });
    rows = extract.rows;
  }

  const confidence = computeExtractionConfidence({
    rigNum: rig,
    headerRow,
    map,
    rows,
    daysInMonth: getDaysInMonth(year, month),
  });

  // Detect duplicates + over-hours on extracted rows (independent of mergeRowsIntoRig).
  const seenDates = new Set();
  let duplicates = 0;
  let overHoursCount = 0;
  for (const r of rows) {
    if (seenDates.has(r.date)) duplicates++;
    seenDates.add(r.date);
    if (r.total_hrs > 24.5) overHoursCount++;
  }

  const issues = evaluateIssues({ rig, headerRow, rows, confidence, duplicates, overHoursCount });

  return {
    sheetName, fileName, rig,
    meta: {
      customer: meta.cust || (rig ? RIG_CUST[rig] : '') || '',
      well:     meta.well     || '',
      contract: meta.contract || '',
      po:       meta.po       || '',
    },
    headerRow, map, rows, confidence, duplicates, overHoursCount, issues,
    raw: rawData, formatted,
  };
}

// ─── mergeExtractionSilently ──────────────────────────────────────────────────

/**
 * Attempt a silent merge of an extraction into `rigStore`.
 * Pure — does NOT mutate `rigStore`; the caller must do:
 *   `if (result.ok) Object.assign(rigStore, result.store);`
 *
 * @param {Object} extraction  — result of extractFromSheet
 * @param {string} fileName
 * @param {Object} rigStore
 * @returns {{ ok: boolean, store?, newDays?, mergedDays?, conflicts? }}
 */
export function mergeExtractionSilently(extraction, fileName, rigStore) {
  if (!extraction.rig) return { ok: false, conflicts: [] };

  // setRigMetaFallback mutates rigStore[rig].meta in-place; caller owns the store.
  setRigMetaFallback(rigStore, extraction.rig, extraction.meta, { customer: 'PDO' });

  const sourceLabel = /\.pdf$/i.test(fileName) ? 'PDF (approved)' : 'Excel';
  const result = mergeRowsIntoRig(rigStore, extraction.rig, extraction.rows, sourceLabel, fileName);

  // result.store is a shallow copy with the new rig entry — the caller should
  // Object.assign(rigStore, result.store) to propagate the merged rows.
  return { ok: true, ...result };
}
