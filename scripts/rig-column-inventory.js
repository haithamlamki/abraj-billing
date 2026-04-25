// Per-rig column inventory.
//
// For each rig folder in the Feb 2026 corpus, picks one representative
// billing PDF, drops it into the running app, and captures:
//   - the PDF columns the parser actually detected
//   - the auto-detected mapping (column → target field)
//   - any unmapped columns (potential schema gaps)
//   - sample first-day values
//
// Output: a markdown table to stdout, plus full JSON to disk.
//
//   URL=http://localhost:5174/ node scripts/rig-column-inventory.js

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.env.URL || 'http://localhost:5173/';
const ROOT = process.env.FEB_ROOT
  || 'C:/Users/80128/OneDrive - abrajoman.com/Desktop/3.2026/2. Billing sheets for all Rigs Feb 2026';
const SKIP_RIGS = new Set(['112', '211', '204']);  // per ops team — known empty/scanned

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function rigFromPath(p) {
  const m = p.match(/Rig\s*(\d{3})/i);
  return m ? m[1] : null;
}

// Pick the most "representative" PDF per rig: prefer files with "RigNNN" in
// the name (canonical); fall back to plain Feb files; skip Move/Penalty/sign-only.
function pickPrimaryPdf(files) {
  const billing = files.filter(p => {
    const b = path.basename(p);
    if (!/\.pdf$/i.test(b)) return false;
    if (/\bmove\b/i.test(b)) return false;
    if (/penalty/i.test(b)) return false;
    if (/docusign/i.test(b)) return false;
    if (/\bticket\b/i.test(b) && !/billing/i.test(b)) return false;
    return true;
  });
  if (!billing.length) return null;
  // 1st preference: "Rig###" in filename, no "sign"
  const main = billing.find(p => /Rig\d{3}/i.test(path.basename(p)) && !/sign\.pdf$/i.test(path.basename(p)));
  if (main) return main;
  // 2nd preference: not "sign", not "approved"
  const plain = billing.find(p => !/sign\.pdf$|approved\.pdf$/i.test(path.basename(p)));
  if (plain) return plain;
  // Last resort: anything
  return billing[0];
}

const TARGETS = [
  'date', 'operating', 'reduced', 'breakdown', 'special',
  'force_maj', 'zero_rate', 'standby', 'repair', 'rig_move',
  'total_hrs', 'obm_oper', 'obm_red', 'obm_bd', 'obm_spe', 'obm_zero',
  'operation', 'remarks', 'total_hrs_repair',
];

const allFiles = walk(ROOT);
const byRig = {};
for (const f of allFiles) {
  const r = rigFromPath(f);
  if (!r) continue;
  if (SKIP_RIGS.has(r)) continue;
  (byRig[r] = byRig[r] || []).push(f);
}

const rigs = Object.keys(byRig).sort();
console.log(`Inventorying ${rigs.length} rigs (skipping ${[...SKIP_RIGS].join(', ')})`);

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on('dialog', async d => { await d.accept(); });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

const inventory = [];

for (const rig of rigs) {
  const pdf = pickPrimaryPdf(byRig[rig]);
  if (!pdf) {
    inventory.push({ rig, file: null, error: 'no representative PDF' });
    continue;
  }

  // Reset state between rigs
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 800));
  await page.select('#monthSelect', '2');
  await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });

  // Stage the file with rig prefix so the app's name detector picks it up.
  const stageDir = path.join(os.tmpdir(), `abraj-inventory-${process.pid}`);
  fs.mkdirSync(stageDir, { recursive: true });
  const dest = path.join(stageDir, `${rig}_${path.basename(pdf)}`);
  fs.copyFileSync(pdf, dest);

  console.log(`Rig ${rig}: ${path.basename(pdf)}`);
  const input = await page.$('#fileInput');
  await input.uploadFile(dest);
  await new Promise(r => setTimeout(r, 5000));

  const data = await page.evaluate((rigNum, targets) => {
    const log = Array.from(document.querySelectorAll('#logEl .log-line')).map(l => l.textContent);
    const colsLine = log.find(l => l.includes('PDF columns:'));
    // Prefer the new "Silent map" log line; fall back to the interactive one.
    const silentLine = log.find(l => l.includes('Silent map'));
    const mapLine = silentLine || log.find(l => l.includes('Auto-map result:'));
    let pdfColumns = null;
    let autoMap = null;
    let silentHeaders = null;
    if (colsLine) {
      const m = colsLine.match(/PDF columns:\s*(.+)$/);
      if (m) pdfColumns = m[1].split('|').map(s => s.trim()).filter(Boolean);
    }
    if (mapLine) {
      // "Silent map [file]: headers=[A | B | C] map={...}"
      const sm = mapLine.match(/headers=\[(.+?)\]\s+map=(\{.*\})/);
      if (sm) {
        silentHeaders = sm[1].split('|').map(s => s.trim()).filter(Boolean);
        try { autoMap = JSON.parse(sm[2]); } catch { autoMap = sm[2]; }
      } else {
        const m = mapLine.match(/Auto-map result:\s*(\{.+\})/);
        if (m) { try { autoMap = JSON.parse(m[1]); } catch { autoMap = m[1]; } }
      }
    }
    // Use silent headers (more accurate, includes all parsed cols) over PDF-merged
    if (silentHeaders) pdfColumns = silentHeaders;
    const store = (window.__getRigStore && window.__getRigStore()[rigNum]) || null;
    const review = (window.__getReviewQueue && window.__getReviewQueue()) || [];

    const sample = store && store.rows && store.rows[0]
      ? Object.fromEntries(targets.filter(k => store.rows[0][k] !== undefined && store.rows[0][k] !== 0 && store.rows[0][k] !== '').map(k => [k, store.rows[0][k]]))
      : null;

    return {
      pdfColumns,
      autoMap,
      rowCount: store?.rows?.length || 0,
      meta: store?.meta || null,
      sampleFirstRow: sample,
      reviewIssues: review.length ? review[0].issues : null,
    };
  }, rig, TARGETS);

  // Build inverted view: target → PDF column name(s). map[key] is normally a
  // single index; for repair it can be an array of indices (multi-source sum).
  const mappedView = {};
  const mappedIndices = new Set();
  if (data.autoMap && data.pdfColumns) {
    for (const [target, v] of Object.entries(data.autoMap)) {
      if (Array.isArray(v)) {
        mappedView[target] = v.map(i => data.pdfColumns[i] || `(col ${i})`).join(' + ');
        v.forEach(i => mappedIndices.add(i));
      } else {
        mappedView[target] = data.pdfColumns[v] || `(col ${v})`;
        mappedIndices.add(v);
      }
    }
  }
  const unmapped = (data.pdfColumns || [])
    .map((name, i) => ({ name, i }))
    .filter(c => !mappedIndices.has(c.i))
    .map(c => c.name);

  inventory.push({
    rig,
    file: path.basename(pdf),
    pdfColumns: data.pdfColumns,
    autoMap: data.autoMap,
    mappedView,
    unmapped,
    rowCount: data.rowCount,
    meta: data.meta,
    sampleFirstRow: data.sampleFirstRow,
    reviewIssues: data.reviewIssues,
  });
}

await browser.close();

// Markdown table output
console.log('\n\n# Per-rig Column Inventory — Feb 2026\n');
console.log('Skipped (per ops): ' + [...SKIP_RIGS].join(', ') + '\n');
console.log('| Rig | File | Columns Detected | Mapping | Unmapped | Rows | Issues |');
console.log('|-----|------|------------------|---------|----------|------|--------|');
for (const e of inventory) {
  const cols = e.pdfColumns ? e.pdfColumns.join(' / ') : '(failed)';
  const map = e.mappedView
    ? Object.entries(e.mappedView).map(([k, v]) => `${k}=${v}`).join('; ')
    : '—';
  const unm = e.unmapped && e.unmapped.length ? e.unmapped.join(', ') : '—';
  const issues = e.reviewIssues ? e.reviewIssues.join('; ').slice(0, 60) : 'OK';
  console.log(`| ${e.rig} | ${(e.file || '').slice(0, 40)} | ${cols} | ${map} | ${unm} | ${e.rowCount} | ${issues} |`);
}

// Full JSON dump
const reportPath = path.join(os.tmpdir(), `abraj-rig-inventory-${Date.now()}.json`);
fs.writeFileSync(reportPath, JSON.stringify(inventory, null, 2));
console.log('\nFull JSON: ' + reportPath);
