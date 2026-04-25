// Fleet Overview view — builds the per-rig day-cell timeline bars and the
// compact fleet grid (#fleetOverview / #fleetGrid).
//
// Exports:
//  buildTimelineHTML(rigEntry, year, month)          — pure HTML + stats, no DOM
//  buildFleetMissingHTML(qc)                         — pure missing-rigs text, no DOM
//  renderFleetOverview(rigStore, year, month, rigs, onSelectRig) — DOM updater
//
// main.js keeps updateFleetOverview() as a one-line wrapper that passes its
// module-level globals (rigStore, billingYear, billingMonth, RIGS, selectRig).

import { safeNum } from '../utils.js';
import { getDayMap, buildQCModel } from '../qc.js';
import { rowTotal } from '../merge.js';
import { getDaysInMonth, getMonthName } from '../dates.js';

/**
 * Build the 31-cell day timeline for one rig entry.
 * Pure — takes explicit year/month instead of reading module globals.
 *
 * @param {{ rows: Object[] }|null} rigEntry  — rigStore[rig], or null/undefined
 * @param {number} year
 * @param {number} month   1-12
 * @returns {{ html: string, missingDays: number, incompleteDays: number,
 *             overDays: number, missingHrs: number }}
 */
export function buildTimelineHTML(rigEntry, year, month) {
  const { map } = getDayMap(rigEntry || { rows: [] }, year, month);
  const monthName = getMonthName(month);
  const days = getDaysInMonth(year, month);
  let html = '<div class="timeline-31">';
  let missingHrs = 0, missingDays = 0, incompleteDays = 0, overDays = 0;

  for (let d = 1; d <= days; d++) {
    const rows = map[d] || [];
    const total = rows.reduce((s, r) => s + rowTotal(r), 0);
    const operating = rows.reduce((s, r) => s + safeNum(r.operating), 0);
    if (total >= 23.5 && total <= 24.5) {
      html += `<div class="day-cell full" title="${monthName} ${d}: ${total.toFixed(1)}h total, ${operating.toFixed(1)}h oper"></div>`;
    } else if (total > 24.5) {
      html += `<div class="day-cell partial-day" style="background:var(--purple)" title="${monthName} ${d}: ${total.toFixed(1)}h total — OVER 24h, review duplicate/mapping"></div>`;
      overDays++;
    } else if (total > 0) {
      const gap = 24 - total;
      html += `<div class="day-cell partial-day" title="${monthName} ${d}: ${total.toFixed(1)}h total — ${gap.toFixed(1)}h missing"></div>`;
      missingHrs += gap;
      incompleteDays++;
    } else {
      html += `<div class="day-cell missing" title="${monthName} ${d}: NO DATA — 24 hrs missing"></div>`;
      missingHrs += 24;
      missingDays++;
    }
  }
  html += '</div>';
  return { html, missingDays, incompleteDays, overDays, missingHrs };
}

/**
 * Build the "missing / partial" summary line beneath the fleet grid.
 * Pure — takes the QC model returned by buildQCModel.
 *
 * @param {{ reviewRigs: number, rigSummaries: Object[] }} qc
 * @returns {string}  inner HTML for #fleetMissing
 */
export function buildFleetMissingHTML(qc) {
  if (!qc.reviewRigs) {
    return '<span style="color:var(--green)">All rigs complete for the full month.</span>';
  }
  return qc.rigSummaries
    .filter(r => r.status !== 'Complete')
    .slice(0, 10)
    .map(r =>
      `<span style="color:var(--orange)">Rig ${r.rig}: ${r.missingDays} missing + ${r.partialDays} partial + ${r.overDays} over (${r.missingHrs.toFixed(0)}h)</span>`,
    )
    .join(' · ');
}

/**
 * Re-render the fleet overview panel (#fleetOverview / #fleetGrid).
 *
 * @param {Object}   rigStore    — the full rig store (keyed by rig number)
 * @param {number}   year
 * @param {number}   month       1-12
 * @param {number[]} rigs        — ordered rig list (from RIGS constant)
 * @param {Function} onSelectRig — (rigNum: number) => void  (selectRig in main.js)
 */
export function renderFleetOverview(rigStore, year, month, rigs, onSelectRig) {
  const panel = document.getElementById('fleetOverview');
  if (!panel) return;
  panel.style.display = '';

  const grid = document.getElementById('fleetGrid');
  grid.innerHTML = '';
  const qc = buildQCModel(rigStore, year, month, rigs);

  for (const r of qc.rigSummaries) {
    let bg = 'rgba(239,68,68,.15)', color = 'var(--red)';
    if (r.status === 'Complete') { bg = 'rgba(16,185,129,.2)'; color = 'var(--green)'; }
    else if (r.submittedDays > 0) { bg = 'rgba(245,158,11,.15)'; color = 'var(--orange)'; }

    const cell = document.createElement('div');
    cell.style.cssText = `background:${bg};border-radius:3px;padding:2px 4px;text-align:center;cursor:pointer;flex:1;min-width:0`;
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-label', `Rig ${r.rig} — ${r.status}, ${r.submittedDays} of ${qc.daysInMonth} days`);
    cell.innerHTML = `<div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.65rem;color:${color}">${r.rig}</div><div style="font-size:.45rem;color:var(--text3)">${r.submittedDays}/${qc.daysInMonth}</div>`;
    cell.title = `Rig ${r.rig}: ${r.status}; ${r.missingDays} missing, ${r.partialDays} partial, ${r.missingHrs.toFixed(1)} missing hrs`;
    cell.addEventListener('click', () => onSelectRig(r.rig));
    cell.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectRig(r.rig); }
    });
    grid.appendChild(cell);
  }

  const summary = document.getElementById('fleetSummary');
  if (summary) {
    summary.textContent = `${qc.fullRigs}/${rigs.length} complete · ${qc.reviewRigs} need review · ${qc.missingHrs.toFixed(0)}h missing`;
  }
  const miss = document.getElementById('fleetMissing');
  if (miss) {
    miss.style.display = 'block';
    miss.innerHTML = buildFleetMissingHTML(qc);
  }
}
