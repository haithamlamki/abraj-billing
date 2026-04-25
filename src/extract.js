import { safeNum, safeStr } from './utils.js';
import { toDateStr } from './dates.js';
import { classifyRows, isFooterRow } from './detection.js';

export function extractRows({ rawData, formatted, headerRow, map, billingYear, billingMonth }) {
  const useRaw = rawData;
  const useFmt = formatted && formatted.length ? formatted : rawData;
  const useFmtFull = useFmt;

  const sections = classifyRows(useFmtFull, headerRow);
  const dIdx = map.date !== undefined ? map.date : 0;
  const totalIdx = map.total_hrs;

  const rows = [];

  for (let r = headerRow + 1; r < useRaw.length; r++) {
    if (r > sections.dataEnd) break;
    const row = useRaw[r] || [];
    const fmtRow = useFmt[r] || [];

    if (isFooterRow(fmtRow, dIdx)) break;

    let dateStr = toDateStr(row[dIdx], billingYear, billingMonth);
    if (!dateStr && fmtRow[dIdx]) {
      dateStr = toDateStr(fmtRow[dIdx], billingYear, billingMonth);
    }
    if (!dateStr) continue;

    const fileTotal = totalIdx !== undefined ? safeNum(row[totalIdx]) : 0;
    if (fileTotal > 24.5) break;

    const firstVal = safeStr(fmtRow[dIdx] ?? row[dIdx]).toLowerCase();
    if (/^(hrs|days|daily|total$|net|amount|hour)/.test(firstVal)) break;

    // map[key] is normally a single column index; for hour-bucket fields that
    // can have multiple source columns (e.g. PREVENTIVE + RAPAIR + EQUIPMENT
    // all collapse into "repair" per ops team), it can also be an array of
    // indices that get summed.
    const gn = key => {
      const v = map[key];
      if (v === undefined) return 0;
      if (Array.isArray(v)) return v.reduce((s, idx) => s + safeNum(row[idx]), 0);
      return safeNum(row[v]);
    };
    const gs = key => {
      const v = map[key];
      if (v === undefined) return '';
      const idx = Array.isArray(v) ? v[0] : v;
      return safeStr(fmtRow[idx] ?? row[idx]);
    };

    const operating = gn('operating');
    const reduced = gn('reduced');
    const breakdown = gn('breakdown');
    const special = gn('special');
    const force_maj = gn('force_maj');
    const zero_rate = gn('zero_rate');
    const standby = gn('standby');
    const repair = gn('repair');
    const rig_move = gn('rig_move');

    const calcTotal = operating + reduced + breakdown + special + force_maj +
      zero_rate + standby + repair + rig_move;

    rows.push({
      date: dateStr,
      operating, reduced, breakdown, special, force_maj, zero_rate,
      standby, repair, rig_move,
      total_hrs: calcTotal,
      obm_oper: gn('obm_oper'),
      obm_red: gn('obm_red'),
      obm_bd: gn('obm_bd'),
      obm_spe: gn('obm_spe'),
      obm_zero: gn('obm_zero'),
      operation: gs('operation'),
      total_hrs_repair: gn('total_hrs_repair'),
      remarks: gs('remarks'),
    });
  }

  return { rows, sections };
}
