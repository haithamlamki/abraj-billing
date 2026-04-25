import { safeStr } from './utils.js';

/**
 * Merge formatted and raw header rows into a single normalised header array.
 *
 * Spreadsheet parsers sometimes produce a "formatted" row where date-valued
 * cells render as "01/02/2026" instead of the original header text. This
 * function detects that case (fmtRow cell looks like a date, rawRow cell does
 * NOT start with a digit) and keeps the raw text instead.
 *
 * @param {any[]} fmtRow - Formatted header row (may contain date-formatted cells)
 * @param {any[]} rawRow - Raw header row (cell values before number-formatting)
 * @returns {string[]} Normalised header row safe to pass to autoMapHeaders()
 */
export function normalizeHeaderRow(fmtRow = [], rawRow = []) {
  const maxLen = Math.max(fmtRow.length, rawRow.length);
  const hRow = [];
  for (let i = 0; i < maxLen; i++) {
    const fv = safeStr(fmtRow[i]).replace(/\n/g, ' ');
    const rv = safeStr(rawRow[i]).replace(/\n/g, ' ');
    // When the formatted cell looks like a date (e.g. "01/02/2026") but the
    // raw cell holds real header text, prefer the raw value.
    if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(fv) && rv && !/^\d/.test(rv)) {
      hRow.push(rv);
    } else if (!fv && rv) {
      hRow.push(rv);
    } else {
      hRow.push(fv || rv);
    }
  }
  return hRow;
}

/**
 * Scan the row immediately above the header for two-row combined headings.
 *
 * Some sheets split a single logical column header across two rows, e.g.:
 *   row N−1:  "Total"        row N:  "Hrs"   → total_hrs
 *   row N−1:  "Operation"    row N:  "Hrs"   → operation (fallback)
 *
 * Mutates `detected` in-place and returns it for convenience.
 *
 * @param {Object}   detected  - autoMapHeaders result (mutated)
 * @param {string[]} prevRow   - Row above the header, values coerced to string
 * @param {string[]} hRow      - Normalised header row
 * @param {Function} [log]     - Optional logger (msg, cls) => void
 * @returns {Object} detected  - Same reference as the input
 */
export function applyAboveRowHints(detected, prevRow, hRow, log = () => {}) {
  for (let c = 0; c < prevRow.length; c++) {
    if (!prevRow[c] || !hRow[c]) continue;
    const combined = (prevRow[c] + ' ' + hRow[c]).toLowerCase();
    if (/(total\s*h|total\s*hrs)/.test(combined) && detected.total_hrs === undefined) {
      detected.total_hrs = c;
      log(`  Combined header: Col ${c + 1} = "${prevRow[c]} ${hRow[c]}" -> total_hrs`, 'info');
    }
    if (/operation/i.test(combined) && detected.operation === undefined) {
      detected.operation = c;
    }
  }
  return detected;
}

export function autoMapHeaders(headerCells) {
  const map = {};
  for (let i = 0; i < headerCells.length; i++) {
    const raw = safeStr(headerCells[i]);
    if (!raw) continue;
    const t = raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim();
    const tNoSpace = t.replace(/\s+/g, '');

    if (/^date$/.test(t)) { map.date = i; continue; }

    if (
      (/^oper$/.test(t) || /^operating/.test(t) || /^operating/.test(tNoSpace) ||
        /0peration/.test(tNoSpace) || /operation\s*hrs/i.test(raw)) &&
      !/operations?\s*(summary|$)/i.test(raw) &&
      !/obm/i.test(raw)
    ) {
      map.operating = i;
      continue;
    }

    if (/remark|comment/i.test(t) && map.remarks === undefined) { map.remarks = i; continue; }

    if (/(reduc|performance)/i.test(tNoSpace) && !/obm/.test(tNoSpace) && map.reduced === undefined) { map.reduced = i; continue; }
    if (/breakdown/i.test(tNoSpace) && !/obm/.test(tNoSpace) && map.breakdown === undefined) { map.breakdown = i; continue; }
    if (/(special|upgrade)/i.test(tNoSpace) && !/obm/.test(tNoSpace) && map.special === undefined) { map.special = i; continue; }
    if (/(forcemaj|forcemajor|sbmrate)/i.test(tNoSpace) && map.force_maj === undefined) { map.force_maj = i; continue; }
    if (/zero/i.test(tNoSpace) && !/obm/.test(tNoSpace) && map.zero_rate === undefined) { map.zero_rate = i; continue; }
    // "stand" alone is the truncated "STANDBY" header seen in some PDFs.
    if (/(standby|stacking|^stand$)/i.test(tNoSpace) && map.standby === undefined) { map.standby = i; continue; }
    // BP/KZN and Medco/YASMEEN PDFs collapse all maintenance-style downtime
    // into one repair bucket. Per ops team: EQUIPMENT, PREVENTIVE, and the
    // typo'd RAPAIR all map to repair (not breakdown). When more than one of
    // these columns appears in the same file (Rig 305: PREVENTIVE + RAPAIR),
    // accumulate all source indices so extract.js sums them.
    if (/(repairrate|^repair$|^rapair$|preventive|equipment)/i.test(tNoSpace)) {
      if (map.repair === undefined) map.repair = i;
      else if (Array.isArray(map.repair)) map.repair.push(i);
      else map.repair = [map.repair, i];
      continue;
    }
    // Per ops team for Rig 305: MOVING and RIG MOVE both belong to rig_move.
    // Accumulate source columns (same pattern as repair) so extract.js sums them.
    if (/(rigmove|movestat|^move|^moving$)/i.test(tNoSpace) || /(rig\s*move|move\s*stat|rig\s*moves)/i.test(t)) {
      if (map.rig_move === undefined) map.rig_move = i;
      else if (Array.isArray(map.rig_move)) map.rig_move.push(i);
      else map.rig_move = [map.rig_move, i];
      continue;
    }

    if (/(totalh|totalhrs|^total$)/i.test(tNoSpace) && !/repair/.test(tNoSpace) && map.total_hrs === undefined) {
      map.total_hrs = i;
      continue;
    }
    if (/^hours$/i.test(tNoSpace) && map.total_hrs === undefined) { map.total_hrs = i; continue; }

    if (/obm/i.test(t) && /(oper|rate)/i.test(t) && !/red|bd|spe|zero/.test(t)) { map.obm_oper = i; continue; }
    if (/obm/i.test(t) && /red/.test(t)) { map.obm_red = i; continue; }
    if (/obm/i.test(t) && /(bd|break)/.test(t)) { map.obm_bd = i; continue; }
    if (/obm/i.test(t) && /spe/.test(t)) { map.obm_spe = i; continue; }
    if (/obm/i.test(t) && /zero/.test(t)) { map.obm_zero = i; continue; }
    // Bare "OBM" with no sub-category. Several PDFs (Rigs 104, 201, 202, 208,
    // 304) collapse OBM hours into one or more unlabeled columns. Default them
    // to obm_oper and accumulate across columns so nothing is silently dropped.
    if (/^obm$/i.test(tNoSpace)) {
      if (map.obm_oper === undefined) map.obm_oper = i;
      else if (Array.isArray(map.obm_oper)) map.obm_oper.push(i);
      else map.obm_oper = [map.obm_oper, i];
      continue;
    }

    // Note: bare "OPERATION" / "OPERATIONS" is ambiguous (could be hours or
    // text). Resolved in the post-pass below.
    if (/(operations?\s*summary|^description$)/i.test(raw)) { map.operation = i; continue; }

    if (/(total\s*hours?\s*repair|daily\s*repair|hours?\s*repair)/i.test(t)) { map.total_hrs_repair = i; continue; }
  }

  // Post-pass for bare "OPERATION" / "OPERATIONS" columns. The main loop skips
  // these because they're ambiguous (Medco/YASMEEN PDFs use OPERATION for
  // numeric hours and DESCRIPTION for text; standard Abraj sheets use
  // "Operation" as the text column).
  //   - if map.operating is unset and there's an OPERATION column → numeric hours
  //   - if map.operation (text) is unset and an OPERATION column survived → text fallback
  for (let i = 0; i < headerCells.length; i++) {
    const t = safeStr(headerCells[i]).toLowerCase().trim();
    if (!/^operations?$/.test(t)) continue;
    if (map.operating === undefined) { map.operating = i; }
    else if (map.operation === undefined) { map.operation = i; }
  }

  return map;
}

export function detectUnnamedTextColumns(map, rawData, headerRow) {
  if (map.operation !== undefined) return map;
  if (headerRow < 0 || !rawData || rawData.length <= headerRow + 1) return map;

  const mappedCols = new Set(Object.values(map));
  const candidates = {};

  for (let r = headerRow + 1; r < Math.min(rawData.length, headerRow + 10); r++) {
    const row = rawData[r];
    if (!row) continue;
    for (let c = 0; c < Math.min(row.length, 30); c++) {
      if (mappedCols.has(c)) continue;
      const v = safeStr(row[c]);
      if (v.length > 15) {
        if (!candidates[c]) candidates[c] = { textCount: 0, totalLen: 0 };
        candidates[c].textCount++;
        candidates[c].totalLen += v.length;
      }
    }
  }

  // NOTE: original tiebreaker is latent-broken — `candidates[bestCol]?.totalLen`
  // with bestCol=-1 resolves to undefined, so tie-breaks always keep the first
  // column seen with the max textCount. Preserving that behavior here.
  let bestCol = -1;
  let bestScore = 0;
  for (const [col, stats] of Object.entries(candidates)) {
    if (stats.textCount > bestScore ||
        (stats.textCount === bestScore && stats.totalLen > candidates[bestCol]?.totalLen)) {
      bestScore = stats.textCount;
      bestCol = parseInt(col);
    }
  }

  if (bestCol >= 0) {
    map.operation = bestCol;
  }
  return map;
}
