// Result view — renders the Step-3 panel showing extracted rows for one rig.
//
// Pure builders (no DOM, fully testable):
//   buildResultSummaryHTML(rigNum, cust, well, rows, daysInMonth)
//   buildResultTimelineHTML(rows, year, month)
//   buildResultTableHTML(rows)
//   buildResultWarningsHTML(rows, daysInMonth)
//   buildConfidenceStripHTML(conf)
//
// DOM renderer:
//   renderResult(rigNum, cust, well, rows, deps)
//     deps = { year, month, queueStatus, conf, pendingSheetsCount,
//              onEditCell, onRecalcTotal, onScrollToDay }
//
// State (currentExtractedRows, currentMapping …) and orchestration
// (setStep, acceptData, goBack …) stay in main.js.

import { safeNum, escapeHtml } from '../utils.js';
import { parseDate, getDaysInMonth, getMonthName } from '../dates.js';
import { HR_KEYS } from '../constants.js';

// ──────────────────────────────────────────────────────────────────────────────
// Pure HTML builders
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the summary strip (Rig / Customer / Well / Days / Complete / …).
 * @param {number} rigNum
 * @param {string} cust
 * @param {string} well
 * @param {Object[]} rows
 * @param {number} daysInMonth
 * @returns {string}
 */
export function buildResultSummaryHTML(rigNum, cust, well, rows, daysInMonth) {
  const complete = rows.filter(r => (r.total_hrs || 0) >= 23.5).length;
  const partial  = rows.filter(r => (r.total_hrs || 0) > 0 && (r.total_hrs || 0) < 23.5).length;
  const missing  = daysInMonth - rows.length;
  const pct      = daysInMonth ? Math.round((complete / daysInMonth) * 100) : 0;
  const pctCls   = pct >= 95 ? 'ok' : pct >= 70 ? 'warn' : 'bad';

  return `
    <div class="sum-item"><span class="sum-label">Rig</span><span class="sum-val" style="color:var(--cyan)">${rigNum}</span></div>
    <div class="sum-item"><span class="sum-label">Customer</span><span class="sum-val">${escapeHtml(cust) || '—'}</span></div>
    <div class="sum-item" style="flex:1;min-width:120px"><span class="sum-label">Well</span><span class="sum-val" style="font-size:.85rem">${escapeHtml(well) || '—'}</span></div>
    <div class="sum-item"><span class="sum-label">Days</span><span class="sum-val ${pctCls}">${rows.length} / ${daysInMonth}</span></div>
    <div class="sum-item"><span class="sum-label">Complete</span><span class="sum-val ${pctCls}">${pct}%</span></div>
    ${partial > 0 ? `<div class="sum-item"><span class="sum-label">Partial</span><span class="sum-val warn">${partial}</span></div>` : ''}
    ${missing > 0 ? `<div class="sum-item"><span class="sum-label">Missing</span><span class="sum-val bad">${missing}</span></div>` : ''}
  `;
}

/**
 * Build the mini bar-chart timeline HTML.
 * @param {Object[]} rows
 * @param {number}   year
 * @param {number}   month  1-12
 * @returns {string}
 */
export function buildResultTimelineHTML(rows, year, month) {
  const daysInMonth = getDaysInMonth(year, month);
  const monthName   = getMonthName(month);

  const dayMap = {};
  for (const row of rows) {
    const d = parseDate(row.date);
    if (d) dayMap[d.getDate()] = { total: row.total_hrs || 0, operating: row.operating || 0 };
  }

  let html = '<div style="display:flex;gap:2px;align-items:end;height:40px">';
  for (let d = 1; d <= daysInMonth; d++) {
    const rec = dayMap[d];
    if (!rec) {
      html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px">
        <div style="width:100%;height:28px;background:var(--red);opacity:.25;border-radius:2px" title="${monthName} ${d}: no data"></div>
        <span style="font-size:.5rem;color:var(--red)">${d}</span></div>`;
    } else {
      const frac = Math.min(rec.total / 24, 1);
      const bg   = frac >= 0.98 ? 'var(--green)' : 'var(--orange)';
      const h    = Math.max(4, Math.round(frac * 28));
      html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:1px" title="${monthName} ${d}: ${rec.total}h${frac < 0.98 ? ` (${(24 - rec.total).toFixed(1)}h gap)` : ''}">
        <div style="width:100%;height:${28 - h}px"></div>
        <div style="width:100%;height:${h}px;background:${bg};border-radius:2px" data-scroll-day="${d}"></div>
        <span style="font-size:.5rem;color:var(--text3)">${d}</span></div>`;
    }
  }
  html += '</div>';
  return html;
}

/**
 * Build the full data table HTML (header + tbody rows + tfoot).
 * @param {Object[]} rows
 * @returns {string}
 */
export function buildResultTableHTML(rows) {
  const obmKeys  = ['obm_oper', 'obm_red', 'obm_bd', 'obm_spe', 'obm_zero'];
  const hrColors = { operating: '#10b981', reduced: '#f59e0b', breakdown: '#ef4444' };

  let html = '<table class="result-table">';
  html += '<thead><tr class="grp-hdr"><th colspan="3"></th>';
  html += '<th class="grp-hrs" colspan="9">Hour categories</th>';
  html += '<th class="grp-hrs" colspan="1">Total</th>';
  html += '<th class="grp-obm" colspan="5">OBM (Oil-Based Mud)</th>';
  html += '<th class="grp-ops" colspan="3">Description</th>';
  html += '</tr><tr>';
  html += '<th class="cat-meta">&nbsp;</th><th class="cat-meta">#</th><th class="cat-meta">Date</th>';
  html += '<th class="cat-hrs">Operating</th><th class="cat-hrs">Reduced</th><th class="cat-hrs">Breakdown</th><th class="cat-hrs">Special</th>';
  html += '<th class="cat-hrs">Force&nbsp;Maj</th><th class="cat-hrs">Zero&nbsp;Rate</th><th class="cat-hrs">Standby</th><th class="cat-hrs">Repair</th><th class="cat-hrs">Rig&nbsp;Move</th>';
  html += '<th class="cat-hrs" title="Auto-calculated: sum of all hour categories">Total *</th>';
  html += '<th class="cat-obm">Oper</th><th class="cat-obm">Red</th><th class="cat-obm">BD</th><th class="cat-obm">Spe</th><th class="cat-obm">Zero</th>';
  html += '<th class="cat-ops">Operation</th><th class="cat-ops">Repair&nbsp;Hrs</th><th class="cat-ops">Remarks</th>';
  html += '</tr></thead><tbody>';

  let totOp = 0, totRed = 0, totBD = 0, totTotal = 0;

  rows.forEach((row, i) => {
    const total = row.total_hrs || 0;
    let statusCls = 'bad', statusChar = '×';
    if (total >= 23.5)         { statusCls = 'ok';   statusChar = '✓'; }
    else if (total > 0)        { statusCls = 'warn';  statusChar = '!'; }
    totOp    += row.operating || 0;
    totRed   += row.reduced   || 0;
    totBD    += row.breakdown || 0;
    totTotal += total;

    const d       = parseDate(row.date);
    const dayAttr = d ? `data-day="${d.getDate()}"` : '';

    html += `<tr ${dayAttr} class="${statusCls === 'bad' && total > 0 ? 'invalid' : ''}" data-idx="${i}">`;
    html += `<td class="row-status ${statusCls}" title="${statusCls === 'ok' ? '24h OK' : statusCls === 'warn' ? 'Partial day (' + total + 'h)' : 'Missing hours'}">${statusChar}</td>`;
    html += `<td>${i + 1}</td>`;
    html += `<td contenteditable="true" class="editable" data-key="date" style="white-space:nowrap">${row.date}</td>`;

    for (const k of HR_KEYS) {
      const c = hrColors[k] || '';
      const v = row[k] || 0;
      html += `<td contenteditable="true" class="editable" data-key="${k}" data-row-idx="${i}" ${c ? `style="color:${c}"` : ''}>${v}</td>`;
    }

    const gap        = 24 - total;
    const totalColor = total >= 23.5 ? '#06b6d4' : total > 0 ? '#ef4444' : '#64748b';
    const gapText    = gap > 0.5 ? ` (${gap.toFixed(1)}h gap)` : '';
    html += `<td style="color:${totalColor};font-weight:700" title="Calculated: sum of all hour columns${gapText}" data-idx="${i}" data-key="total_hrs">${total}${gap > 0.5 ? ' !' : ''}</td>`;

    for (const k of obmKeys) {
      html += `<td contenteditable="true" class="editable" data-key="${k}" data-row-idx="${i}">${row[k] || 0}</td>`;
    }

    html += `<td contenteditable="true" class="editable text-cell" data-key="operation" data-row-idx="${i}" style="min-width:280px;max-width:420px;white-space:normal;line-height:1.3" title="${escapeHtml(row.operation)}">${escapeHtml(row.operation)}</td>`;
    html += `<td contenteditable="true" class="editable" data-key="total_hrs_repair" data-row-idx="${i}">${row.total_hrs_repair || 0}</td>`;
    html += `<td contenteditable="true" class="editable text-cell" data-key="remarks" data-row-idx="${i}">${escapeHtml(row.remarks)}</td>`;
    html += '</tr>';
  });

  html += `<tfoot><tr><td></td><td>Total</td><td>${rows.length} days</td>`;
  html += `<td style="color:#10b981">${totOp.toFixed(1)}</td><td style="color:#f59e0b">${totRed.toFixed(1)}</td><td style="color:#ef4444">${totBD.toFixed(1)}</td>`;
  html += `<td colspan="6"></td><td style="color:#06b6d4">${totTotal.toFixed(0)}</td><td colspan="8"></td></tr></tfoot>`;
  html += '</table>';
  return html;
}

/**
 * Build the warnings panel HTML (row-count anomalies, partial days).
 * Returns an empty string when there are no warnings.
 * @param {Object[]} rows
 * @param {number}   daysInMonth
 * @returns {string}
 */
export function buildResultWarningsHTML(rows, daysInMonth) {
  const warnings = [];
  if (rows.length < daysInMonth)
    warnings.push({ type: 'warn', msg: `Only ${rows.length} of ${daysInMonth} days loaded — ${daysInMonth - rows.length} day(s) may be in another file.` });
  if (rows.length > daysInMonth)
    warnings.push({ type: 'bad',  msg: `${rows.length} rows but month only has ${daysInMonth} days — possible duplicates.` });
  const badTotals = rows.filter(r => r.total_hrs > 0 && Math.abs(r.total_hrs - 24) > 0.5);
  if (badTotals.length)
    warnings.push({ type: 'warn', msg: `${badTotals.length} day(s) not totaling 24h. Highlighted in the table.` });
  if (!warnings.length) return '';
  return '<div class="card" style="padding:10px 14px;margin-top:8px">' +
    warnings.map(w => `<div class="hint ${w.type === 'bad' ? 'warn' : w.type}" style="font-size:.78rem;margin-bottom:2px">&#9888; ${w.msg}</div>`).join('') +
    '</div>';
}

/**
 * Build the extraction-confidence strip HTML.
 * @param {{ score: number, status: string, issues: string[] }} conf
 * @returns {string}
 */
export function buildConfidenceStripHTML(conf) {
  const color = conf.score >= 90 ? 'var(--green)' : conf.score >= 70 ? 'var(--orange)' : 'var(--red)';
  const detail = conf.issues.length
    ? conf.issues.join(' · ')
    : 'Rig, header, mapping, dates, and daily rows look acceptable.';
  return `<div class="card" style="padding:10px 14px;margin-top:8px;border-color:${color}">
    <div class="hint" style="font-size:.78rem;color:${color};font-weight:800">Extraction Confidence: ${conf.score}% — ${conf.status}</div>
    <div class="hint" style="font-size:.72rem;color:var(--text2);margin-top:3px">${detail}</div>
  </div>`;
}

// ──────────────────────────────────────────────────────────────────────────────
// DOM renderer
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Render the Step-3 result panel for one rig into the DOM.
 *
 * @param {number}   rigNum
 * @param {string}   cust
 * @param {string}   well
 * @param {Object[]} rows
 * @param {{
 *   year: number, month: number,
 *   queueStatus: string,
 *   conf: { score: number, status: string, issues: string[] },
 *   pendingSheetsCount: number,
 *   onEditCell:    (td: HTMLElement, rowIdx: number, key: string) => void,
 *   onRecalcTotal: (rowIdx: number) => void,
 *   onScrollToDay: (day: number) => void,
 * }} deps
 */
export function renderResult(rigNum, cust, well, rows, deps) {
  const { year, month, queueStatus, conf, pendingSheetsCount,
          onEditCell, onRecalcTotal, onScrollToDay } = deps;
  const daysInMonth = getDaysInMonth(year, month);
  const monthName   = getMonthName(month);
  const complete    = rows.filter(r => (r.total_hrs || 0) >= 23.5).length;
  const partial     = rows.filter(r => (r.total_hrs || 0) > 0 && (r.total_hrs || 0) < 23.5).length;
  const missing     = daysInMonth - rows.length;

  // Summary strip
  const sumEl = document.getElementById('resultSummary');
  if (sumEl) sumEl.innerHTML = buildResultSummaryHTML(rigNum, cust, well, rows, daysInMonth);

  // Timeline title + bar chart
  const tlTitle = document.getElementById('resultTimelineTitle');
  if (tlTitle) tlTitle.textContent = `${monthName} ${year} — ${complete} full, ${partial} partial, ${missing} missing`;

  const tlEl = document.getElementById('resultTimeline');
  if (tlEl) {
    tlEl.innerHTML = buildResultTimelineHTML(rows, year, month);
    tlEl.querySelectorAll('[data-scroll-day]').forEach(el => {
      el.addEventListener('click', () => onScrollToDay(parseInt(el.dataset.scrollDay, 10)));
    });
  }

  // Result title
  const titleEl = document.getElementById('resultTitle');
  if (titleEl) titleEl.textContent = `${rows.length} rows loaded${queueStatus}`;

  // Data table
  const scroll = document.getElementById('resultScroll');
  if (scroll) {
    scroll.innerHTML = buildResultTableHTML(rows);
    scroll.querySelectorAll('[contenteditable="true"][data-row-idx]').forEach(td => {
      const idx   = parseInt(td.dataset.rowIdx, 10);
      const key   = td.dataset.key;
      const isHr  = HR_KEYS.includes(key);
      td.addEventListener('blur', () => {
        onEditCell(td, idx, key);
        if (isHr) onRecalcTotal(idx);
      });
    });
  }

  // Warnings + confidence strip
  const warnEl = document.getElementById('resultWarnings');
  if (warnEl) {
    warnEl.innerHTML = buildResultWarningsHTML(rows, daysInMonth);
    warnEl.insertAdjacentHTML('afterbegin', buildConfidenceStripHTML(conf));
  }

  // Accept-all button visibility
  const acceptBtn = document.getElementById('acceptAllBtn');
  if (acceptBtn) acceptBtn.style.display = pendingSheetsCount > 0 ? '' : 'none';
}
