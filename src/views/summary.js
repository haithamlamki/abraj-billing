// Executive Summary view — renders the QC / analytics tab (Step 1 → Summary).
//
// Pure builders (no DOM, fully testable):
//   buildRigTableHTML(rigRows, daysInMonth)
//   buildCustomerTableHTML(customerRows)
//   buildExceptionTableHTML(exceptions)
//   buildRecordsTableHTML(records)
//   buildHeatmapHTML(rigs, rigStore, year, month)
//
// DOM renderer:
//   renderSummary(model, rigStore, year, month, rigs, Chart)
//
// Chart instances are kept in module-local SUMMARY_CHARTS so they can be
// destroyed before a redraw (avoids "Canvas is already in use" Chart.js error).

import { escapeHtml, fmtNum } from '../utils.js';
import { getDayMap } from '../qc.js';
import { rowTotal } from '../merge.js';

// ── module-private chart registry ────────────────────────────────────────────
const SUMMARY_CHARTS = {};

function destroyChart(id) {
  if (SUMMARY_CHARTS[id]) { SUMMARY_CHARTS[id].destroy(); delete SUMMARY_CHARTS[id]; }
}

function makeChart(id, config, Chart) {
  const canvas = document.getElementById(id);
  if (!canvas || !Chart) return;
  destroyChart(id);
  SUMMARY_CHARTS[id] = new Chart(canvas, config);
}

// ── pure HTML builders ────────────────────────────────────────────────────────

/**
 * @param {{ rig, customer, days, total, missingHrs, status }[]} rigRows
 * @param {number} daysInMonth
 * @returns {string}
 */
export function buildRigTableHTML(rigRows, daysInMonth) {
  return rigRows.map(r => {
    const cls = r.status === 'Complete' ? 'qc-ok' : r.status === 'Partial' ? 'qc-warn' : 'qc-bad';
    return `<tr>
      <td><strong>${r.rig}</strong></td>
      <td>${escapeHtml(r.customer)}</td>
      <td>${r.days}/${daysInMonth}</td>
      <td class="num">${fmtNum(r.total, 1)}</td>
      <td class="num" style="color:${r.missingHrs > 0 ? 'var(--red)' : 'var(--green)'}">${fmtNum(r.missingHrs, 1)}</td>
      <td><span class="qc-badge ${cls}">${escapeHtml(r.status)}</span></td>
    </tr>`;
  }).join('');
}

/**
 * @param {{ customer, rigs, operating, total, missingHrs }[]} customerRows
 * @returns {string}
 */
export function buildCustomerTableHTML(customerRows) {
  return customerRows.map(c =>
    `<tr>
      <td><strong>${escapeHtml(c.customer)}</strong></td>
      <td class="num">${c.rigs}</td>
      <td class="num">${fmtNum(c.operating, 1)}</td>
      <td class="num">${fmtNum(c.total, 1)}</td>
      <td class="num" style="color:${c.missingHrs > 0 ? 'var(--red)' : 'var(--green)'}">${fmtNum(c.missingHrs, 1)}</td>
    </tr>`,
  ).join('');
}

/**
 * @param {{ severity, rig, customer, date, submitted, missing, issue, action }[]} exceptions
 * @returns {string}
 */
export function buildExceptionTableHTML(exceptions) {
  const rows = exceptions.slice(0, 1200);
  const overflow = exceptions.length > 1200
    ? `<tr><td colspan="7" style="text-align:center;color:var(--text3)">Showing first 1,200 of ${exceptions.length} exceptions</td></tr>`
    : '';
  return rows.map(e =>
    `<tr class="${e.severity === 'critical' ? 'bad-row' : 'conf-row'}">
      <td>${e.rig}</td>
      <td>${escapeHtml(e.customer)}</td>
      <td>${escapeHtml(e.date)}</td>
      <td class="num">${fmtNum(e.submitted, 1)}</td>
      <td class="num">${fmtNum(e.missing, 1)}</td>
      <td><span class="qc-badge ${e.severity === 'critical' ? 'qc-bad' : 'qc-warn'}">${escapeHtml(e.issue)}</span></td>
      <td>${escapeHtml(e.action)}</td>
    </tr>`,
  ).join('') + overflow;
}

/**
 * @param {{ rig, customer, well, date, operating, reduced, breakdown, rig_move,
 *           total_hrs, qc_status, missing_hrs }[]} records
 * @returns {string}
 */
export function buildRecordsTableHTML(records) {
  const rows = records.slice(0, 1000);
  const overflow = records.length > 1000
    ? `<tr><td colspan="10" style="text-align:center;color:var(--text3)">Showing first 1,000 of ${records.length} records</td></tr>`
    : '';
  return rows.map(r => {
    let cls = 'qc-bad', label = 'Missing';
    if (r.total_hrs > 24.5)             { cls = 'qc-bad';  label = 'Over 24h'; }
    else if (r.qc_status === 'Complete') { cls = 'qc-ok';   label = 'Complete'; }
    else if (r.qc_status === 'Partial')  { cls = 'qc-warn'; label = `Partial -${fmtNum(r.missing_hrs, 1)}h`; }
    return `<tr>
      <td>${r.rig}</td>
      <td>${escapeHtml(r.customer)}</td>
      <td>${escapeHtml(r.well)}</td>
      <td>${escapeHtml(r.date)}</td>
      <td class="num">${fmtNum(r.operating, 1)}</td>
      <td class="num">${fmtNum(r.reduced, 1)}</td>
      <td class="num">${fmtNum(r.breakdown, 1)}</td>
      <td class="num">${fmtNum(r.rig_move, 1)}</td>
      <td class="num">${fmtNum(r.total_hrs, 1)}</td>
      <td><span class="qc-badge ${cls}">${label}</span></td>
    </tr>`;
  }).join('') + overflow;
}

/**
 * Build the rig × day heatmap grid HTML.
 * Pure — takes explicit rigStore / year / month to avoid module globals.
 *
 * @param {number[]}  rigs
 * @param {Object}    rigStore  — keyed by rig number
 * @param {number}    year
 * @param {number}    month     1-12
 * @param {number}    daysInMonth
 * @returns {string}
 */
export function buildHeatmapHTML(rigs, rigStore, year, month, daysInMonth) {
  let html = '<div class="summary-heat-label" style="font-weight:800">Rig</div>';
  for (let d = 1; d <= daysInMonth; d++) html += `<div class="summary-day-head">${d}</div>`;

  for (const rig of rigs) {
    const store = rigStore[rig] || { rows: [] };
    const { map } = getDayMap(store, year, month);
    html += `<div class="summary-heat-label"><strong>${rig}</strong></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const total = (map[d] || []).reduce((s, r) => s + rowTotal(r), 0);
      let cls = 'missing', label = 'Missing 24h', txt = '';
      if (total >= 23.5 && total <= 24.5) {
        cls = 'full'; label = `${fmtNum(total, 1)}h complete`; txt = Math.round(total);
      } else if (total > 24.5) {
        cls = 'partial'; label = `${fmtNum(total, 1)}h OVER 24h`; txt = '!';
      } else if (total > 0) {
        cls = 'partial'; label = `${fmtNum(total, 1)}h, missing ${fmtNum(24 - total, 1)}h`; txt = Math.round(total);
      }
      html += `<div class="summary-heat-cell ${cls}" title="Rig ${rig} Day ${d}: ${label}">${txt}</div>`;
    }
  }
  return html;
}

// ── DOM renderer ──────────────────────────────────────────────────────────────

/**
 * Render the full Executive Summary panel.
 *
 * @param {Object}   model      — from generateExecutiveSummary()
 * @param {Object}   rigStore   — full rig store
 * @param {number}   year
 * @param {number}   month
 * @param {number[]} rigs
 * @param {Function|null} Chart — Chart.js constructor (null = skip charts)
 * @param {string}   monthName  — human-readable month label
 * @param {number}   totalRigs  — RIGS.length (for KPI display)
 */
export function renderSummary(model, rigStore, year, month, rigs, Chart, monthName, totalRigs) {
  const empty   = document.getElementById('summaryEmpty');
  const content = document.getElementById('summaryContent');
  if (!empty || !content) return;

  const hasData = model.records.length > 0;
  empty.style.display   = hasData ? 'none'  : 'block';
  content.style.display = hasData ? 'block' : 'none';

  const sub = document.getElementById('summarySubtitle');
  if (sub) sub.textContent = `${monthName} ${year} billing extraction QC — full-month rule for all ${totalRigs} rigs`;
  if (!hasData) return;

  // KPIs
  const t    = model.totals;
  const util = model.expectedHours ? (t.operating / model.expectedHours) * 100 : 0;
  const kpi  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  kpi('kpiActiveRigs',        totalRigs);
  kpi('kpiCustomers',         `${model.customers.length} customers`);
  kpi('kpiSubmittedDays',     fmtNum(model.records.length));
  kpi('kpiExpectedDays',      `${fmtNum(totalRigs * model.daysInMonth)} expected rig-days`);
  kpi('kpiOperating',         fmtNum(t.operating));
  kpi('kpiUtil',              `${util.toFixed(1)}% of expected fleet hours`);
  kpi('kpiReduced',           fmtNum(t.reduced));
  kpi('kpiReducedPct',        `${t.total_hrs ? (t.reduced / t.total_hrs * 100).toFixed(1) : 0}% of submitted`);
  kpi('kpiMissingHrs',        fmtNum(model.qc.missingHrs));
  const missingDays = model.qc.rigSummaries.reduce((s, r) => s + r.missingDays, 0);
  const partialDays = model.qc.rigSummaries.reduce((s, r) => s + r.partialDays, 0);
  const overDays    = model.qc.rigSummaries.reduce((s, r) => s + r.overDays,    0);
  kpi('kpiMissingDays',       `${missingDays} missing / ${partialDays} partial / ${overDays} over`);
  kpi('kpiTotalBilled',       fmtNum(t.total_hrs));
  kpi('kpiQCCompletion',      `${model.qc.completion.toFixed(1)}%`);
  kpi('kpiQCCompletionNote',  `${fmtNum(model.qc.submittedHours)} / ${fmtNum(model.qc.expectedHours)} hrs submitted`);
  kpi('kpiFullRigs',          `${model.qc.fullRigs}/${totalRigs}`);
  kpi('kpiReviewRigs',        model.qc.reviewRigs);
  kpi('kpiCriticalExceptions', model.qc.criticalExceptions);

  // Tables
  const rigBody  = document.getElementById('summaryRigTable');
  if (rigBody)  rigBody.innerHTML  = buildRigTableHTML(model.rigRows, model.daysInMonth);
  const custBody = document.getElementById('summaryCustomerTable');
  if (custBody) custBody.innerHTML = buildCustomerTableHTML(model.customerRows);
  const exBody   = document.getElementById('summaryExceptionTable');
  if (exBody)   exBody.innerHTML   = buildExceptionTableHTML(model.qc.exceptions);
  const recBody  = document.getElementById('summaryRecordsTable');
  if (recBody)  recBody.innerHTML  = buildRecordsTableHTML(model.records);

  // Heatmap
  const grid = document.getElementById('summaryHeatmap');
  if (grid) {
    grid.style.setProperty('--days', model.daysInMonth);
    grid.innerHTML = buildHeatmapHTML(rigs, rigStore, year, month, model.daysInMonth);
  }

  // Charts
  if (!Chart) return;
  const gridColor = 'rgba(148,163,184,.18)';
  const tickColor = '#94a3b8';
  const chartDefaults = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: tickColor } } },
    scales: {
      x: { ticks: { color: tickColor }, grid: { color: gridColor } },
      y: { ticks: { color: tickColor }, grid: { color: gridColor }, beginAtZero: true },
    },
  };
  makeChart('summaryHoursPie', {
    type: 'doughnut',
    data: {
      labels: ['Operating', 'Reduced', 'Breakdown', 'Rig Move', 'Zero Rate', 'Other'],
      datasets: [{
        data: [
          t.operating, t.reduced, t.breakdown, t.rig_move, t.zero_rate,
          t.special + t.force_maj + t.standby + t.repair,
        ],
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#06b6d4'],
      }],
    },
    options: { responsive: true, maintainAspectRatio: false,
               plugins: { legend: { position: 'bottom', labels: { color: tickColor } } } },
  }, Chart);
  makeChart('summaryCustomerBar', {
    type: 'bar',
    data: {
      labels: model.customerRows.map(c => c.customer),
      datasets: [
        { label: 'Operating',  data: model.customerRows.map(c => c.operating),  backgroundColor: '#10b981' },
        { label: 'Reduced',    data: model.customerRows.map(c => c.reduced),    backgroundColor: '#f59e0b' },
        { label: 'Breakdown',  data: model.customerRows.map(c => c.breakdown),  backgroundColor: '#ef4444' },
      ],
    },
    options: { ...chartDefaults,
      scales: {
        x: { stacked: true, ticks: { color: tickColor }, grid: { color: gridColor } },
        y: { stacked: true, ticks: { color: tickColor }, grid: { color: gridColor }, beginAtZero: true },
      } },
  }, Chart);
  makeChart('summaryDailyLine', {
    type: 'line',
    data: {
      labels: model.daily.map(d => d.day),
      datasets: [
        { label: 'Submitted Hours', data: model.daily.map(d => d.submitted), borderColor: '#06b6d4', backgroundColor: 'rgba(6,182,212,.15)', tension: .25, fill: true },
        { label: 'Expected Hours',  data: model.daily.map(d => d.expected),  borderColor: '#64748b', borderDash: [4, 4], tension: 0 },
      ],
    },
    options: chartDefaults,
  }, Chart);
}
