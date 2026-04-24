import { MONTHS } from './constants.js';

export function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

export function getMonthName(month) {
  return MONTHS[month - 1];
}

export function toDateStr(val, year, month) {
  if (val == null || val === '') return null;

  if (val instanceof Date && !isNaN(val)) {
    return `${String(val.getUTCDate()).padStart(2, '0')}-${MONTHS[val.getUTCMonth()]}-${val.getUTCFullYear()}`;
  }

  if (typeof val === 'number' || (typeof val === 'string' && /^\d+(\.\d+)?$/.test(String(val).trim()))) {
    const n = Number(val);
    if (n >= 1 && n <= 31) {
      if (!year || !month) return null;
      return `${String(Math.floor(n)).padStart(2, '0')}-${MONTHS[month - 1]}-${year}`;
    }
    if (n > 40000) {
      const d = new Date((n - 25569) * 86400000);
      if (!isNaN(d)) {
        return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
      }
    }
    return null;
  }

  if (typeof val === 'string') {
    const cleaned = val.replace(/\s+/g, '').trim();

    let m = cleaned.match(/^(\d{1,2})[\-\/]([A-Za-z]{3})[\-\/](\d{2,4})$/);
    if (m) {
      const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
      if (mi >= 0) {
        const yr = m[3].length === 2 ? 2000 + parseInt(m[3]) : parseInt(m[3]);
        return `${m[1].padStart(2, '0')}-${MONTHS[mi]}-${yr}`;
      }
    }

    m = cleaned.match(/^(\d{1,2})[\-\/\.](\d{1,2})[\-\/\.](\d{4})$/);
    if (m) {
      const day = parseInt(m[1]);
      const mon = parseInt(m[2]);
      const yr = parseInt(m[3]);
      if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
        return `${String(day).padStart(2, '0')}-${MONTHS[mon - 1]}-${yr}`;
      }
    }

    m = cleaned.match(/^(\d{4})[\-\/](\d{1,2})[\-\/](\d{1,2})/);
    if (m) {
      const yr = parseInt(m[1]);
      const mon = parseInt(m[2]);
      const day = parseInt(m[3]);
      if (mon >= 1 && mon <= 12) {
        return `${String(day).padStart(2, '0')}-${MONTHS[mon - 1]}-${yr}`;
      }
    }
  }

  return null;
}

export function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
  if (mi < 0) return null;
  return new Date(parseInt(m[3]), mi, parseInt(m[1]));
}

export function dateForDay(day, year, month) {
  return `${String(day).padStart(2, '0')}-${getMonthName(month)}-${year}`;
}
