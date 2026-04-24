import { safeStr } from './utils.js';

export function findHeaderRow(rawData) {
  let bestRow = -1;
  let bestScore = 0;
  for (let r = 0; r < Math.min(rawData.length, 25); r++) {
    const row = rawData[r];
    if (!row) continue;
    const texts = row.map(v => safeStr(v).toLowerCase().replace(/\n/g, ' '));
    const rowText = texts.join('|');
    const hasDate = texts.some(t => /^date\b/.test(t.trim()));
    if (!hasDate) continue;
    let score = 3;
    if (/oper/.test(rowText)) score += 2;
    if (/reduc|stand|performance/.test(rowText)) score += 2;
    if (/breakdown/.test(rowText)) score += 2;
    if (/total.*h|total.*hrs|^hours$/.test(rowText)) score += 2;
    if (/zero|force|special|rig.*move/.test(rowText)) score += 1;
    if (/remark|operation|description/.test(rowText)) score += 1;
    if (/repair|sbm|upgrade/.test(rowText)) score += 1;
    const nonEmpty = texts.filter(t => t.length > 0).length;
    if (nonEmpty >= 4) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

export function isFooterRow(row, dateCol) {
  if (!row) return false;
  // Match original: `||` falls back for empty string too, not just null/undefined
  const v = safeStr(row[dateCol] || row[0]).toLowerCase().trim();
  return /^(hrs|hours|days|daily|total|net\s*total|subtotal|sub\s*total|amount|unit\s*rate|abraj|dsv|client|signature|non[- ]?hour)(\b|[: ]|$)/.test(v);
}

export function classifyRows(data, headerRow) {
  let dateCol = 0;
  if (headerRow >= 0 && data[headerRow]) {
    const idx = data[headerRow].findIndex(v => /^date$/i.test(safeStr(v).trim()));
    if (idx >= 0) dateCol = idx;
  }

  let dataEnd = data.length - 1;
  if (headerRow >= 0) {
    for (let r = headerRow + 1; r < data.length; r++) {
      const row = data[r];
      if (!row) continue;
      if (isFooterRow(row, dateCol)) {
        dataEnd = r - 1;
        break;
      }
    }
  }

  return {
    billingHeader: 0,
    tableHeader: headerRow,
    dataStart: headerRow + 1,
    dataEnd,
    footerStart: dataEnd + 1,
    dateCol,
  };
}

const CUSTOMER_PATTERNS = [
  { name: 'PDO', re: /\bpdo\b/ },
  { name: 'OXY', re: /\boxy\b/ },
  { name: 'OQ', re: /\boq\b/ },
  { name: 'ARA', re: /\bara\b/ },
  { name: 'Medco', re: /\bmedco\b/ },
  { name: 'BP', re: /\bbp\b/ },
];

export function detectMeta(rawData, headerRow) {
  let rig = '';
  let cust = '';
  let well = '';
  let contract = '';
  let po = '';

  for (let r = 0; r < headerRow && r < rawData.length; r++) {
    const row = rawData[r];
    if (!row) continue;
    const rowText = row.map(c => safeStr(c)).join(' ').toLowerCase();

    if (!cust) {
      const hit = CUSTOMER_PATTERNS.find(p => p.re.test(rowText));
      if (hit) cust = hit.name;
    }

    for (let c = 0; c < row.length; c++) {
      const v = safeStr(row[c]).toLowerCase();
      if (/well|wbs/.test(v) && !well) {
        for (let cc = c + 1; cc < Math.min(c + 5, row.length); cc++) {
          const wv = safeStr(row[cc]);
          if (wv && !/contract|p\.o|po:/i.test(wv)) {
            well = wv;
            break;
          }
        }
      }
      if (/contract/.test(v) && !contract) {
        for (let cc = c + 1; cc < Math.min(c + 3, row.length); cc++) {
          if (row[cc]) {
            contract = safeStr(row[cc]);
            break;
          }
        }
      }
      if (/p\.o|^po:/i.test(v) && !po) {
        for (let cc = c + 1; cc < Math.min(c + 3, row.length); cc++) {
          if (row[cc]) {
            po = safeStr(row[cc]);
            break;
          }
        }
      }
    }
  }

  return { rig, cust, well, contract, po };
}
