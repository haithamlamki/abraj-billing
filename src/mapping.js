import { safeStr } from './utils.js';

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
    if (/(standby|stacking)/i.test(tNoSpace) && map.standby === undefined) { map.standby = i; continue; }
    if (/repairrate/i.test(tNoSpace) && map.repair === undefined) { map.repair = i; continue; }
    if (/(rigmove|movestat|^move)/i.test(tNoSpace) || /(rig\s*move|move\s*stat|rig\s*moves)/i.test(t)) {
      map.rig_move = i;
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

    if (/(operations?\s*summary|^operations?$|^description$)/i.test(raw)) { map.operation = i; continue; }

    if (/(total\s*hours?\s*repair|daily\s*repair|hours?\s*repair)/i.test(t)) { map.total_hrs_repair = i; continue; }
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
