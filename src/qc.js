import { safeNum, safeStr } from './utils.js';
import { HR_KEYS, RIGS as DEFAULT_RIGS, RIG_CUST } from './constants.js';
import { getDaysInMonth, parseDate, dateForDay } from './dates.js';
import { rowTotal } from './merge.js';

export function getRigMeta(rigStore, rig) {
  const store = rigStore[rig] || {};
  return {
    customer: (store.meta && store.meta.customer) || RIG_CUST[rig] || '',
    well: (store.meta && store.meta.well) || '',
    contract: (store.meta && store.meta.contract) || '',
    po: (store.meta && store.meta.po) || '',
  };
}

export function issueAction(issue) {
  if (issue === 'Missing Full Day') return 'Request missing daily submission';
  if (issue === 'Partial Submission') return 'Verify sheet and complete missing hours';
  if (issue === 'Over 24 Hours') return 'Check duplicate or wrong hour mapping';
  if (issue === 'Duplicate Date') return 'Review duplicate entries and keep final approved source';
  if (issue === 'Invalid Date') return 'Correct date/month/year before billing';
  return 'Review';
}

export function getDayMap(store, billingYear, billingMonth) {
  const map = {};
  const duplicates = [];
  const invalid = [];
  if (!store || !store.rows) return { map, duplicates, invalid };

  for (const row of store.rows) {
    const d = parseDate(row.date);
    if (!d || d.getFullYear() !== billingYear || (d.getMonth() + 1) !== billingMonth) {
      invalid.push(row);
      continue;
    }
    const day = d.getDate();
    if (!map[day]) map[day] = [];
    map[day].push(row);
  }
  for (const [day, rows] of Object.entries(map)) {
    if (rows.length > 1) duplicates.push({ day: parseInt(day), rows });
  }
  return { map, duplicates, invalid };
}

export function normalizeExtractedData(rigStore, rigs = DEFAULT_RIGS) {
  const records = [];
  for (const rig of rigs) {
    const store = rigStore[rig];
    if (!store || !store.rows || !store.rows.length) continue;
    const meta = store.meta || {};
    for (const row of store.rows) {
      const normalized = {
        rig,
        customer: meta.customer || RIG_CUST[rig] || '',
        well: meta.well || '',
        contract: meta.contract || '',
        po: meta.po || '',
        date: row.date,
        operating: safeNum(row.operating),
        reduced: safeNum(row.reduced),
        breakdown: safeNum(row.breakdown),
        special: safeNum(row.special),
        force_maj: safeNum(row.force_maj),
        zero_rate: safeNum(row.zero_rate),
        standby: safeNum(row.standby),
        repair: safeNum(row.repair),
        rig_move: safeNum(row.rig_move),
        obm_oper: safeNum(row.obm_oper),
        operation: safeStr(row.operation),
        remarks: safeStr(row.remarks),
      };
      const calculated = HR_KEYS.reduce((sum, key) => sum + safeNum(normalized[key]), 0);
      normalized.total_hrs = safeNum(row.total_hrs) || calculated;
      normalized.day = parseDate(normalized.date)?.getDate() || null;
      normalized.qc_status = normalized.total_hrs >= 23.5
        ? 'Complete'
        : normalized.total_hrs > 0
          ? 'Partial'
          : 'Missing';
      normalized.missing_hrs = Math.max(0, 24 - normalized.total_hrs);
      records.push(normalized);
    }
  }
  records.sort((a, b) =>
    (a.rig - b.rig) || ((parseDate(a.date) || 0) - (parseDate(b.date) || 0))
  );
  return records;
}

export function buildQCModel(rigStore, billingYear, billingMonth, rigs = DEFAULT_RIGS) {
  const days = getDaysInMonth(billingYear, billingMonth);
  const rigSummaries = [];
  const exceptions = [];
  const daily = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    expected: rigs.length * 24,
    submitted: 0,
    operating: 0,
    missing_hrs: 0,
    completeRigs: 0,
    issueRigs: 0,
  }));

  const totals = {
    operating: 0, reduced: 0, breakdown: 0, special: 0, force_maj: 0,
    zero_rate: 0, standby: 0, repair: 0, rig_move: 0, total_hrs: 0,
  };
  const customerAgg = {};

  for (const rig of rigs) {
    const store = rigStore[rig] || { meta: { customer: RIG_CUST[rig] }, rows: [], files: [] };
    const meta = getRigMeta(rigStore, rig);
    const { map, duplicates, invalid } = getDayMap(store, billingYear, billingMonth);

    let submitted = 0, operating = 0, reduced = 0, breakdown = 0;
    let missingHrs = 0, missingDays = 0, partialDays = 0, overDays = 0;
    let completeDays = 0, submittedDays = 0;

    for (const row of (store.rows || [])) {
      for (const k of Object.keys(totals)) {
        if (k === 'total_hrs') continue;
        totals[k] += safeNum(row[k]);
      }
      totals.total_hrs += rowTotal(row);
    }

    for (const inv of invalid) {
      exceptions.push({
        rig, customer: meta.customer, date: inv.date || '',
        submitted: rowTotal(inv), missing: 24,
        issue: 'Invalid Date', action: issueAction('Invalid Date'),
        severity: 'critical',
      });
    }
    for (const dup of duplicates) {
      const total = dup.rows.reduce((s, r) => s + rowTotal(r), 0);
      exceptions.push({
        rig, customer: meta.customer, date: dateForDay(dup.day, billingYear, billingMonth),
        submitted: total, missing: Math.max(0, 24 - total),
        issue: 'Duplicate Date', action: issueAction('Duplicate Date'),
        severity: 'warning',
      });
    }

    for (let d = 1; d <= days; d++) {
      const rows = map[d] || [];
      const total = rows.reduce((s, r) => s + rowTotal(r), 0);
      const op = rows.reduce((s, r) => s + safeNum(r.operating), 0);
      submitted += total;
      operating += op;
      reduced += rows.reduce((s, r) => s + safeNum(r.reduced), 0);
      breakdown += rows.reduce((s, r) => s + safeNum(r.breakdown), 0);
      daily[d - 1].submitted += total;
      daily[d - 1].operating += op;
      if (rows.length > 0) submittedDays++;
      if (total >= 23.5 && total <= 24.5) {
        completeDays++;
        daily[d - 1].completeRigs++;
      } else if (total > 24.5) {
        overDays++;
        daily[d - 1].issueRigs++;
        exceptions.push({
          rig, customer: meta.customer, date: dateForDay(d, billingYear, billingMonth),
          submitted: total, missing: 0,
          issue: 'Over 24 Hours', action: issueAction('Over 24 Hours'),
          severity: 'critical',
        });
      } else if (total > 0) {
        const gap = 24 - total;
        partialDays++;
        missingHrs += gap;
        daily[d - 1].issueRigs++;
        exceptions.push({
          rig, customer: meta.customer, date: dateForDay(d, billingYear, billingMonth),
          submitted: total, missing: gap,
          issue: 'Partial Submission', action: issueAction('Partial Submission'),
          severity: 'warning',
        });
      } else {
        missingDays++;
        missingHrs += 24;
        daily[d - 1].issueRigs++;
        exceptions.push({
          rig, customer: meta.customer, date: dateForDay(d, billingYear, billingMonth),
          submitted: 0, missing: 24,
          issue: 'Missing Full Day', action: issueAction('Missing Full Day'),
          severity: 'critical',
        });
      }
    }

    const expected = days * 24;
    const completion = expected ? Math.max(0, Math.min(100, (submitted / expected) * 100)) : 0;
    const status = (missingDays === 0 && partialDays === 0 && overDays === 0)
      ? 'Complete'
      : (missingDays > 0 ? 'Missing Days' : (overDays > 0 ? 'Over 24h' : 'Partial'));

    rigSummaries.push({
      rig, customer: meta.customer, well: meta.well,
      submittedDays, expectedDays: days,
      total: submitted, operating, reduced, breakdown,
      missingHrs, missingDays, partialDays, overDays, completeDays,
      completion, status,
      files: (store.files || []).length,
    });

    if (!customerAgg[meta.customer]) {
      customerAgg[meta.customer] = {
        customer: meta.customer,
        rigs: new Set(),
        operating: 0, reduced: 0, breakdown: 0, total: 0,
        missingHrs: 0, exceptions: 0,
      };
    }
    customerAgg[meta.customer].rigs.add(rig);
    customerAgg[meta.customer].operating += operating;
    customerAgg[meta.customer].reduced += reduced;
    customerAgg[meta.customer].breakdown += breakdown;
    customerAgg[meta.customer].total += submitted;
    customerAgg[meta.customer].missingHrs += missingHrs;
  }

  for (const ex of exceptions) {
    if (customerAgg[ex.customer]) customerAgg[ex.customer].exceptions++;
  }
  for (const d of daily) d.missing_hrs = Math.max(0, d.expected - d.submitted);

  const records = normalizeExtractedData(rigStore, rigs);
  const expectedHours = rigs.length * days * 24;
  const submittedHours = rigSummaries.reduce((s, r) => s + r.total, 0);
  const missingHrs = rigSummaries.reduce((s, r) => s + r.missingHrs, 0);
  const fullRigs = rigSummaries.filter(r => r.status === 'Complete').length;
  const reviewRigs = rigSummaries.length - fullRigs;
  const criticalExceptions = exceptions.filter(e => e.severity === 'critical').length;
  const customerRows = Object.values(customerAgg)
    .map(c => ({ ...c, rigs: c.rigs.size }))
    .sort((a, b) => b.total - a.total);

  return {
    daysInMonth: days,
    rigSummaries,
    exceptions,
    daily,
    records,
    totals,
    expectedHours,
    submittedHours,
    missingHrs,
    fullRigs,
    reviewRigs,
    criticalExceptions,
    customerRows,
    customers: customerRows.map(c => c.customer).filter(Boolean),
    activeRigs: rigs,
    completion: expectedHours
      ? Math.max(0, Math.min(100, (submittedHours / expectedHours) * 100))
      : 0,
  };
}

export function generateExecutiveSummary(rigStore, billingYear, billingMonth, rigs = DEFAULT_RIGS) {
  const qc = buildQCModel(rigStore, billingYear, billingMonth, rigs);
  return {
    records: qc.records,
    daysInMonth: qc.daysInMonth,
    activeRigs: qc.activeRigs,
    customers: qc.customers,
    totals: qc.totals,
    rigRows: qc.rigSummaries.map(r => ({
      rig: r.rig,
      customer: r.customer,
      days: r.submittedDays,
      total: r.total,
      operating: r.operating,
      reduced: r.reduced,
      breakdown: r.breakdown,
      missingHrs: r.missingHrs,
      missingDays: r.missingDays,
      incompleteDays: r.partialDays,
      overDays: r.overDays,
      status: r.status,
      completion: r.completion,
    })),
    daily: qc.daily,
    customerRows: qc.customerRows,
    expectedHours: qc.expectedHours,
    missingHrs: qc.missingHrs,
    qc,
  };
}

export function computeExtractionConfidence({
  rigNum,
  headerRow,
  map,
  rows,
  daysInMonth,
}) {
  let score = 100;
  const issues = [];
  if (!rigNum) { score -= 30; issues.push('rig not detected'); }
  if (headerRow < 0) { score -= 25; issues.push('header row not detected'); }
  if (!map || map.date === undefined) { score -= 25; issues.push('date column missing'); }
  if (!map || (map.operating === undefined && map.total_hrs === undefined)) {
    score -= 15;
    issues.push('no operating/total hour column mapped');
  }
  if (!rows || rows.length === 0) { score -= 30; issues.push('no daily rows extracted'); }
  if (rows && rows.length > daysInMonth) { score -= 15; issues.push('more rows than month days'); }
  const over = (rows || []).filter(r => rowTotal(r) > 24.5).length;
  if (over) { score -= Math.min(20, over * 5); issues.push(`${over} over-24h day(s)`); }
  const invalid = (rows || []).filter(r => !parseDate(r.date)).length;
  if (invalid) { score -= Math.min(25, invalid * 5); issues.push(`${invalid} invalid date(s)`); }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const status = score >= 90
    ? 'Auto Accepted'
    : score >= 70
      ? 'Accepted with Warning'
      : 'Manual Review Required';
  return { score, status, issues };
}
