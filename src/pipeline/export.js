// Export data builders — pure, no DOM, no XLSX, fully testable.
//
// Exports:
//   buildAllRowsData(rigStore, rigs)          → flat row array for Excel export
//   buildExceptionReportSheets(qcModel)        → { rigRows, exRows, dailyRows }
//   EXPORT_COL_WIDTHS                          → column-width array for the all-rigs sheet
//
// The actual XLSX.writeFile calls stay in main.js so this module has no
// dependency on the global XLSX library.

/**
 * Build the flat row array for the consolidated billing Excel export.
 *
 * @param {Object}   rigStore  — keyed by rig number
 * @param {number[]} rigs      — ordered rig list
 * @returns {Object[]} allRows
 */
export function buildAllRowsData(rigStore, rigs) {
  const allRows = [];
  for (const rig of rigs) {
    const s = rigStore[rig];
    if (!s || !s.rows.length) continue;
    for (const r of s.rows) {
      allRows.push({
        Rig:                rig,
        Customer:           s.meta.customer,
        Well:               s.meta.well,
        'Contract No':      s.meta.contract,
        'P.O':              s.meta.po,
        Date:               r.date,
        Operating:          r.operating,
        Reduced:            r.reduced,
        Breakdown:          r.breakdown,
        Special:            r.special,
        'Force Maj':        r.force_maj,
        'Zero Rate':        r.zero_rate,
        Standby:            r.standby,
        Repair:             r.repair,
        'Rig Move':         r.rig_move,
        'Total Hrs':        r.total_hrs,
        'OBM Oper':         r.obm_oper,
        'OBM Red':          r.obm_red,
        'OBM BD':           r.obm_bd,
        'OBM Spe':          r.obm_spe,
        'OBM Zero':         r.obm_zero,
        Operation:          r.operation,
        'Total Hours Repair': r.total_hrs_repair,
        Remarks:            r.remarks,
      });
    }
  }
  return allRows;
}

/** Column widths (characters) for the consolidated billing worksheet. */
export const EXPORT_COL_WIDTHS = [
  { wch: 6 },  { wch: 8 },  { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
  { wch: 9 },  { wch: 9 },  { wch: 10 }, { wch: 8 },  { wch: 10 }, { wch: 9 },
  { wch: 9 },  { wch: 8 },  { wch: 9 },  { wch: 9 },  { wch: 9 },  { wch: 8 },
  { wch: 8 },  { wch: 8 },  { wch: 8 },  { wch: 50 }, { wch: 12 }, { wch: 25 },
];

/**
 * Build the three worksheet data arrays for the QC exception report.
 *
 * @param {{ exceptions, rigSummaries, daily }} qcModel — result of buildQCModel()
 * @returns {{ rigRows, exRows, dailyRows }}
 */
export function buildExceptionReportSheets(qcModel) {
  const exRows = qcModel.exceptions.map(e => ({
    Rig:              e.rig,
    Customer:         e.customer,
    Date:             e.date,
    'Submitted Hrs':  Number(e.submitted.toFixed(2)),
    'Missing Hrs':    Number(e.missing.toFixed(2)),
    Issue:            e.issue,
    'Action Required': e.action,
    Severity:         e.severity,
  }));

  const rigRows = qcModel.rigSummaries.map(r => ({
    Rig:              r.rig,
    Customer:         r.customer,
    Well:             r.well,
    'Submitted Days': r.submittedDays,
    'Expected Days':  r.expectedDays,
    'Complete Days':  r.completeDays,
    'Missing Days':   r.missingDays,
    'Partial Days':   r.partialDays,
    'Over 24h Days':  r.overDays,
    'Submitted Hrs':  Number(r.total.toFixed(2)),
    'Missing Hrs':    Number(r.missingHrs.toFixed(2)),
    'Completion %':   Number(r.completion.toFixed(2)),
    Status:           r.status,
  }));

  const dailyRows = qcModel.daily.map(d => ({
    Day:              d.day,
    'Expected Hrs':   d.expected,
    'Submitted Hrs':  Number(d.submitted.toFixed(2)),
    'Missing Hrs':    Number(d.missing_hrs.toFixed(2)),
    'Complete Rigs':  d.completeRigs,
    'Issue Rigs':     d.issueRigs,
  }));

  return { exRows, rigRows, dailyRows };
}
