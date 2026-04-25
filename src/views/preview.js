// Preview view — renders the Step-2 raw-data table that lets the user verify
// and override the detected header row before extraction.
//
// Exports:
//   buildPreviewTableHTML(useData, headerRow) — pure HTML string, no DOM
//   renderPreviewTable(data, rawData, headerRow, onClickRow) — DOM writer
//
// Row-click handling (clickRow → update currentHeaderRow + re-render) stays
// in main.js because it must mutate module-level state.

import { safeStr } from '../utils.js';
import { classifyRows } from '../detection.js';

/** Maximum rows shown in the preview table. */
const MAX_PREVIEW_ROWS = 60;
/** Maximum columns shown in the preview table. */
const MAX_PREVIEW_COLS = 20;

/**
 * Return the HTML string for the preview table.
 * Pure — no DOM access, safe to call from Vitest.
 *
 * @param {any[][]} useData    — 2-D array of cell values (formatted preferred)
 * @param {number}  headerRow  — 0-based index of the detected header row (-1 = unknown)
 * @returns {string}
 */
export function buildPreviewTableHTML(useData, headerRow) {
  const sections   = classifyRows(useData, headerRow);
  const maxRows    = Math.min(useData.length, MAX_PREVIEW_ROWS);
  let   maxCols    = 0;

  for (let r = 0; r < maxRows; r++) {
    if (useData[r]) maxCols = Math.max(maxCols, useData[r].length);
  }
  maxCols = Math.min(maxCols, MAX_PREVIEW_COLS);

  // Header row
  let html = '<table class="preview-table"><thead><tr><th class="row-num">#</th><th style="width:60px">Section</th>';
  for (let c = 0; c < maxCols; c++) html += `<th>Col ${c + 1}</th>`;
  html += '</tr></thead><tbody>';

  for (let r = 0; r < maxRows; r++) {
    const row      = useData[r] || [];
    const isHeader = r === headerRow;

    let sectionLabel = '';
    let rowStyle     = '';

    if (headerRow >= 0) {
      if (r < headerRow) {
        sectionLabel = '<span style="color:var(--blue);font-size:.55rem">HEADER</span>';
        rowStyle     = 'background:rgba(59,130,246,.06)';
      } else if (r === headerRow) {
        sectionLabel = '<span style="color:var(--cyan);font-size:.55rem;font-weight:700">TABLE HDR</span>';
        rowStyle     = 'background:rgba(6,182,212,.15)';
      } else if (r <= sections.dataEnd) {
        sectionLabel = '<span style="color:var(--green);font-size:.55rem">DATA</span>';
      } else {
        sectionLabel = '<span style="color:var(--text3);font-size:.55rem">FOOTER</span>';
        rowStyle     = 'background:rgba(100,116,139,.08);opacity:.6';
      }
    }

    html += `<tr class="${isHeader ? 'header-row' : ''}" data-row="${r}" style="cursor:pointer;${rowStyle}">`;
    html += `<td class="row-num">${r + 1}</td>`;
    html += `<td style="text-align:center">${sectionLabel}</td>`;

    for (let c = 0; c < maxCols; c++) {
      const v       = c < row.length ? safeStr(row[c]).replace(/\n/g, ' ') : '';
      const display = v.length > 40 ? v.substring(0, 40) + '...' : v;
      html += `<td title="${v.replace(/"/g, '&quot;')}">${display}</td>`;
    }
    html += '</tr>';
  }

  if (useData.length > MAX_PREVIEW_ROWS) {
    html += `<tr><td colspan="${maxCols + 2}" style="text-align:center;color:var(--text3)">... ${useData.length - MAX_PREVIEW_ROWS} more rows</td></tr>`;
  }

  html += '</tbody></table>';
  return html;
}

/**
 * Render the preview table into #previewScroll and wire row-click handlers.
 *
 * @param {any[][]} data        — formatted sheet data (may be empty)
 * @param {any[][]} rawData     — raw sheet data (fallback when formatted is empty)
 * @param {number}  headerRow   — 0-based index (-1 = not detected)
 * @param {Function} onClickRow — (rowIdx: number) => void
 */
export function renderPreviewTable(data, rawData, headerRow, onClickRow) {
  const useData = data && data.length ? data : rawData;
  const scroll  = document.getElementById('previewScroll');
  if (!scroll) return;

  scroll.innerHTML = buildPreviewTableHTML(useData, headerRow);
  scroll.querySelectorAll('tr[data-row]').forEach(tr => {
    tr.addEventListener('click', () => onClickRow(parseInt(tr.dataset.row, 10)));
  });
}
