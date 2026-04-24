export function safeNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function safeStr(v) {
  return v == null ? '' : String(v).trim();
}

export function fmtNum(n, d = 0) {
  const num = safeNum(n);
  return num.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
