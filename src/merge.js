import { safeNum } from './utils.js';
import { HR_KEYS } from './constants.js';
import { parseDate } from './dates.js';

const TEXT_JOIN_MAX = 400;

export function joinText(oldVal, newVal) {
  if (!oldVal) return newVal;
  if (!newVal || oldVal === newVal) return oldVal;
  if (String(oldVal).includes(newVal)) return oldVal;
  const combined = `${oldVal} | ${newVal}`;
  return combined.length <= TEXT_JOIN_MAX ? combined : oldVal;
}

export function rowTotal(row) {
  return safeNum(row.total_hrs) || HR_KEYS.reduce((s, k) => s + safeNum(row[k]), 0);
}

function sortByDate(rows) {
  return [...rows].sort((a, b) => {
    const da = parseDate(a.date);
    const db = parseDate(b.date);
    return (da || 0) - (db || 0);
  });
}

export function mergeRowsIntoRig(rigStore, rigNum, newRows, sourceLabel, fileName) {
  const nextStore = { ...rigStore };
  const prev = nextStore[rigNum] || { meta: {}, rows: [], files: [] };
  const rows = [...prev.rows];
  const files = [...prev.files];

  const isPDFSource = sourceLabel.includes('PDF');
  let newDays = 0;
  let mergedDays = 0;
  const conflicts = [];

  for (const newRow of newRows) {
    const idx = rows.findIndex(r => r.date === newRow.date);
    if (idx >= 0) {
      const existing = { ...rows[idx] };
      const existingTotal = HR_KEYS.reduce((s, k) => s + safeNum(existing[k]), 0);
      const newTotal = HR_KEYS.reduce((s, k) => s + safeNum(newRow[k]), 0);
      const existingSource = existing._source || 'unknown';

      const hasConflict = existingTotal > 0 && newTotal > 0 &&
        Math.abs(existingTotal - newTotal) > 0.5 && existingTotal >= 23.5;
      if (hasConflict) {
        conflicts.push({
          date: newRow.date,
          existingTotal,
          existingSource,
          newTotal,
          newSource: sourceLabel,
          existing: { ...rows[idx] },
          newRow: { ...newRow },
        });
      }

      const isPartial = existingTotal < 23.5;
      const pdfOverrides = isPDFSource && existingSource === 'Excel';

      for (const key of Object.keys(newRow)) {
        if (key === 'total_hrs' || key === '_source') continue;
        const newVal = newRow[key];
        const oldVal = existing[key];
        if (typeof newVal === 'number' && newVal !== 0) {
          if (pdfOverrides) existing[key] = newVal;
          else if (isPartial) existing[key] = (oldVal || 0) + newVal;
        } else if (typeof newVal === 'string' && newVal) {
          if (pdfOverrides) existing[key] = newVal;
          else existing[key] = joinText(oldVal, newVal);
        }
      }

      const merged = HR_KEYS.reduce((s, k) => s + safeNum(existing[k]), 0);
      if (merged > 24.5) {
        conflicts.push({
          date: newRow.date,
          existingTotal,
          existingSource,
          newTotal: merged,
          newSource: 'merged',
          existing: { ...existing },
          newRow: { ...newRow },
          reason: 'overflow',
        });
      }
      existing.total_hrs = merged;
      if (isPDFSource) existing._source = 'PDF';
      rows[idx] = existing;
      mergedDays++;
    } else {
      rows.push({ ...newRow, _source: isPDFSource ? 'PDF' : 'Excel' });
      newDays++;
    }
  }

  if (fileName && !files.includes(fileName)) files.push(fileName);

  nextStore[rigNum] = {
    ...prev,
    rows: sortByDate(rows),
    files,
  };

  return { store: nextStore, newDays, mergedDays, conflicts };
}
