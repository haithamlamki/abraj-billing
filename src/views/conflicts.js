// Conflicts view — renders the "Hours Conflict Detected" panel that appears
// when merging produces same-rig / same-date discrepancies.
//
// Exports:
//  buildConflictRowHTML(c, mergedTotal)         — pure <tr>, no DOM
//  buildConflictsHTML(rigNum, conflicts, mergedRows) — pure panel HTML string
//  renderConflicts(rigNum, conflicts, mergedRows, onAction) — DOM writer
//
// Resolution logic (replaceRigRowFromConflict, resolveAllConflicts) stays in
// main.js because it touches rigStore, autoSave, and the step/navigation stack.

import { safeNum, fmtNum } from '../utils.js';
import { rowTotal } from '../merge.js';

/**
 * Build a single <tr> for one conflict entry.
 * Pure — no DOM access, safe to call from Vitest.
 *
 * @param {{ date: string,
 *           existingSource: string, existingTotal: number,
 *           newSource: string, newTotal: number }} c
 * @param {number} mergedTotal  — current merged row total (0 when row absent)
 * @returns {string}
 */
export function buildConflictRowHTML(c, mergedTotal) {
  const diffRaw = safeNum(c.newTotal) - safeNum(c.existingTotal);
  const diff = diffRaw.toFixed(1);
  const diffLabel = diffRaw > 0 ? `+${diff}h` : `${diff}h`;
  const hasPdf =
    String(c.newSource || '').includes('PDF') ||
    String(c.existingSource || '').includes('PDF');
  const rec = hasPdf ? 'Use PDF' : 'Manual Review';

  return `<tr class="conf-row">
    <td style="white-space:nowrap">${c.date}</td>
    <td>${c.existingSource || ''}</td>
    <td class="num">${fmtNum(safeNum(c.existingTotal), 1)}h</td>
    <td>${c.newSource || ''}</td>
    <td class="num">${fmtNum(safeNum(c.newTotal), 1)}h</td>
    <td class="num" style="color:var(--red)">${diffLabel}</td>
    <td class="num" style="font-weight:700;color:var(--cyan)">${fmtNum(mergedTotal, 1)}h</td>
    <td>${rec}</td>
  </tr>`;
}

/**
 * Build the complete conflicts panel HTML (header alert + table + buttons).
 * Pure — no DOM access.
 *
 * @param {number}   rigNum
 * @param {Object[]} conflicts   — array of conflict objects from mergeRowsIntoRig
 * @param {Object[]} mergedRows  — current rows for this rig (used for "Current Merged" column)
 * @returns {string}
 */
export function buildConflictsHTML(rigNum, conflicts, mergedRows) {
  const rowIndex = Object.fromEntries((mergedRows || []).map(r => [r.date, r]));

  const rows = conflicts.map(c => {
    const merged = rowIndex[c.date];
    const mergedTotal = merged ? rowTotal(merged) : 0;
    return buildConflictRowHTML(c, mergedTotal);
  }).join('');

  return `<div style="padding:16px">
    <div style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:14px;margin-bottom:16px">
      <strong style="color:var(--red);font-size:.95rem">Hours Conflict Detected — ${conflicts.length} day(s)</strong>
      <div style="color:var(--text2);font-size:.82rem;margin-top:4px">Choose how to resolve same-rig/same-date differences. Recommended default: use PDF if it is the signed final billing document.</div>
    </div>
    <table class="result-table" style="min-width:auto">
      <thead>
        <tr>
          <th>Date</th><th>Existing Source</th><th>Existing Hrs</th>
          <th>New Source</th><th>New Hrs</th><th>Diff</th>
          <th>Current Merged</th><th>Recommended</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn btn-sm" data-conflict-action="manual">Manual Edit</button>
      <button class="btn btn-sm" data-conflict-action="excel">Use Excel</button>
      <button class="btn btn-sm btn-green" data-conflict-action="pdf">Use PDF</button>
      <button class="btn btn-primary btn-sm" data-conflict-action="merge">Keep Current Merge</button>
    </div>
  </div>`;
}

/**
 * Write the conflicts panel into #resultScroll and wire the action buttons.
 *
 * @param {number}   rigNum
 * @param {Object[]} conflicts
 * @param {Object[]} mergedRows  — current rows for this rig
 * @param {Function} onAction    — (strategy: string) => void
 */
export function renderConflicts(rigNum, conflicts, mergedRows, onAction) {
  const scroll = document.getElementById('resultScroll');
  if (!scroll) return;
  scroll.innerHTML = buildConflictsHTML(rigNum, conflicts, mergedRows);
  scroll.querySelectorAll('[data-conflict-action]').forEach(btn => {
    btn.addEventListener('click', () => onAction(btn.dataset.conflictAction));
  });
}
