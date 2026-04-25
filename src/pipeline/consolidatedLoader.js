// Consolidated billing loader — pure row parser, no DOM, no XLSX, testable.
//
// Export:
//   parseConsolidatedRows(jsonRows, { year, month, rigs })
//     → { rigNum, meta, row }[]
//
// The caller (loadConsolidated in main.js) owns the XLSX.read call and the
// rigStore mutations (ensureRig, updateRigMetaFields, appendRowIfNew, sortRowsByDate).

import { safeNum, safeStr } from '../utils.js';
import { toDateStr, getMonthName } from '../dates.js';
import { RIG_CUST } from '../constants.js';

/**
 * Map a flat XLSX JSON row array (from a previously-exported consolidated
 * billing sheet) into normalised { rigNum, meta, row } objects.
 *
 * Rows for unknown rigs, non-parseable dates, or dates outside the billing
 * month are silently skipped — the returned array only contains importable entries.
 *
 * @param {Object[]} jsonRows  — output of XLSX.utils.sheet_to_json(ws, { defval: null })
 * @param {{ year: number, month: number, rigs: number[] }} opts
 * @returns {{ rigNum: number, meta: Object, row: Object }[]}
 */
export function parseConsolidatedRows(jsonRows, { year, month, rigs }) {
  const expectedSuffix = `-${getMonthName(month)}-${year}`;
  const result = [];

  for (const r of jsonRows) {
    const rigNum = parseInt(r.Rig ?? r.rig);
    if (!rigNum || !rigs.includes(rigNum)) continue;

    const dateStr = toDateStr(r.Date ?? r.date, year, month);
    if (!dateStr || !dateStr.endsWith(expectedSuffix)) continue;

    result.push({
      rigNum,
      meta: {
        customer: safeStr(r.Customer ?? r.customer) || RIG_CUST[rigNum] || '',
        well:     safeStr(r.Well     ?? r.well)     || '',
        contract: safeStr(r['Contract No'])          || '',
        po:       safeStr(r['P.O'])                  || '',
      },
      row: {
        date:             dateStr,
        operating:        safeNum(r.Operating        ?? r.operating),
        reduced:          safeNum(r.Reduced          ?? r.reduced),
        breakdown:        safeNum(r.Breakdown        ?? r.breakdown),
        special:          safeNum(r.Special          ?? r.special),
        force_maj:        safeNum(r['Force Maj']     ?? r.force_maj),
        zero_rate:        safeNum(r['Zero Rate']     ?? r.zero_rate),
        standby:          safeNum(r.Standby          ?? r.standby),
        repair:           safeNum(r.Repair           ?? r.repair),
        rig_move:         safeNum(r['Rig Move']      ?? r.rig_move),
        total_hrs:        safeNum(r['Total Hrs']     ?? r.total_hrs),
        obm_oper:         safeNum(r['OBM Oper']      ?? r.obm_oper),
        obm_red:          safeNum(r['OBM Red']       ?? r.obm_red),
        obm_bd:           safeNum(r['OBM BD']        ?? r.obm_bd),
        obm_spe:          safeNum(r['OBM Spe']       ?? r.obm_spe),
        obm_zero:         safeNum(r['OBM Zero']      ?? r.obm_zero),
        operation:        safeStr(r.Operation        ?? r.operation),
        total_hrs_repair: safeNum(r['Total Hours Repair'] ?? r.total_hrs_repair),
        remarks:          safeStr(r.Remarks          ?? r.remarks),
      },
    });
  }

  return result;
}
