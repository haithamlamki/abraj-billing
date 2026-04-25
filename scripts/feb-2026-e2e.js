// Feb 2026 corpus end-to-end test (full corpus, folder-aware rig detection).
//
// Strategy:
//   1. Walk the OneDrive corpus.
//   2. For every billing-looking PDF, derive the rig number from the parent
//      folder ("Rig 104" → 104) and copy the file into a temp dir with the rig
//      number as a filename prefix. The app reads the prefix and assigns the
//      file to the right rig store, even when the original filename has no
//      "Rig###" token.
//   3. Drop them all as a single batch into the running dev server.
//   4. Wait for batch completion, then build a per-rig report including a
//      sample of Rig 104's daily rows for diagnosis.
//
// Run:
//   npm run dev   # in another terminal — note the port
//   URL=http://localhost:5174/ node scripts/feb-2026-e2e.js

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const URL = process.env.URL || 'http://localhost:5173/';
const ROOT = process.env.FEB_ROOT
  || 'C:/Users/80128/OneDrive - abrajoman.com/Desktop/3.2026/2. Billing sheets for all Rigs Feb 2026';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// Skip clearly non-billing variants. The app also has its own runtime skip
// (Move / Docusign / Ticket-only), but mirroring keeps the upload count tight.
// IMPORTANT: keep "*sign.pdf" / "Docusign*" / "approved" — for several rigs
// (108, 207, 208, 304) those are the ONLY billing files in the folder.
function shouldUpload(p) {
  const base = path.basename(p);
  if (!/\.pdf$/i.test(base)) return false;
  if (/\bmove\b/i.test(base)) return false;   // app skips these too
  if (/penalty/i.test(base)) return false;    // not daily billing rows
  if (/\bticket\b/i.test(base) && !/billing/i.test(base)) return false;
  return true;
}

// "Rig 104" / "Rig104" → 104.  Returns null if the path has no rig folder.
function rigFromPath(p) {
  const m = p.match(/Rig\s*(\d{3})/i);
  return m ? m[1] : null;
}

const allFiles = walk(ROOT);
const candidates = allFiles.filter(shouldUpload);
console.log(`Found ${allFiles.length} files total, ${candidates.length} candidate billing PDFs`);

// Stage: copy candidates into temp dir with "<rig>_<basename>" so the app's
// filename detector picks up the rig.
const stageDir = path.join(os.tmpdir(), `abraj-feb-${Date.now()}`);
fs.mkdirSync(stageDir, { recursive: true });
const staged = [];
const skippedNoRig = [];
for (const p of candidates) {
  const rig = rigFromPath(p);
  if (!rig) { skippedNoRig.push(p); continue; }
  const base = path.basename(p);
  // Avoid duplicate basenames within the same rig (different wells can share)
  let dest = path.join(stageDir, `${rig}_${base}`);
  let n = 2;
  while (fs.existsSync(dest)) {
    dest = path.join(stageDir, `${rig}_${n}_${base}`);
    n++;
  }
  fs.copyFileSync(p, dest);
  staged.push(dest);
}
console.log(`Staged ${staged.length} PDFs to ${stageDir}`);
if (skippedNoRig.length) console.log(`Skipped ${skippedNoRig.length} files with no Rig folder (${skippedNoRig.slice(0, 3).map(p => path.basename(p)).join(', ')}...)`);

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on('dialog', async d => { await d.accept(); });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

// Clear any auto-loaded session so this run is a clean slate.
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await page.select('#monthSelect', '2');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 300));

console.log(`--- Dropping ${staged.length} PDFs as one batch ---`);
const t0 = Date.now();
const input = await page.$('#fileInput');
await input.uploadFile(...staged);

// Poll until batch completes
const TIMEOUT_MS = 30 * 60 * 1000;
const POLL_MS = 3000;
const deadline = Date.now() + TIMEOUT_MS;
let lastProcessed = -1;
while (Date.now() < deadline) {
  const status = await page.evaluate(() => {
    const banner = document.getElementById('batchBanner');
    return {
      bannerVisible: banner && banner.style.display !== 'none',
      bannerText: banner ? banner.textContent.replace(/\s+/g, ' ').trim() : '',
      sRigs: document.getElementById('sRigs')?.textContent,
      sRows: document.getElementById('sRows')?.textContent,
      reviewCardCount: document.querySelectorAll('#reviewQueue .card').length,
    };
  });
  const m = status.bannerText.match(/(\d+)\s*\/\s*(\d+)\s*files/);
  const processed = m ? parseInt(m[1]) : 0;
  const total = m ? parseInt(m[2]) : staged.length;
  if (processed !== lastProcessed) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`[${elapsed}s] processed=${processed}/${total}  rigs=${status.sRigs}  rows=${status.sRows}  review=${status.reviewCardCount}`);
    lastProcessed = processed;
  }
  if (/Batch done/i.test(status.bannerText) || (!status.bannerVisible && lastProcessed >= 1)) break;
  await new Promise(r => setTimeout(r, POLL_MS));
}

console.log(`--- Batch finished in ${Math.round((Date.now() - t0) / 1000)}s. Building report. ---`);

// Pull QC + a Rig 104 sample for partial-day diagnosis.
const report = await page.evaluate(() => {
  const out = { rigs: {}, totals: {}, reviewCards: [], rig104Sample: null };
  for (const el of document.querySelectorAll('.rig-item')) {
    const num = el.querySelector('.r-num')?.textContent;
    const cust = el.querySelector('.r-cust')?.textContent;
    const days = el.querySelector('.r-days')?.textContent;
    const klass = el.className;
    if (num) out.rigs[num] = {
      cust,
      days,
      status: klass.includes('complete') ? 'complete'
            : klass.includes('partial') ? 'partial'
            : (klass.includes('has-data') ? 'has-data' : 'empty'),
    };
  }
  out.totals.sRigs = document.getElementById('sRigs')?.textContent;
  out.totals.sRows = document.getElementById('sRows')?.textContent;
  out.totals.sOper = document.getElementById('sOper')?.textContent;
  out.totals.fleetSummary = document.getElementById('fleetSummary')?.textContent;
  for (const c of document.querySelectorAll('#reviewQueue .card')) {
    out.reviewCards.push(c.textContent.replace(/\s+/g, ' ').trim().slice(0, 300));
  }

  // Diagnostic samples — for any rig with rows, dump the per-column sums and
  // any "problem" days (>24h or <23.5h on a day that's not the last).
  const fullStore = (typeof window.__getRigStore === 'function') ? window.__getRigStore() : {};
  const HR = ['operating', 'reduced', 'breakdown', 'special', 'force_maj', 'zero_rate', 'standby', 'repair', 'rig_move'];
  function rigSample(rigNum) {
    const s = fullStore[rigNum];
    if (!s || !s.rows) return null;
    const sums = {};
    for (const k of HR) sums[k] = 0;
    for (const r of s.rows) for (const k of HR) sums[k] += Number(r[k] || 0);
    const problems = s.rows.filter(r => {
      const t = Number(r.total_hrs || 0);
      return t > 24.5 || (t > 0 && t < 23.5);
    }).map(r => {
      const o = { date: r.date, total_hrs: r.total_hrs, _source: r._source };
      for (const k of HR) o[k] = r[k];
      return o;
    });
    return {
      meta: s.meta,
      rowCount: s.rows.length,
      columnSums: sums,
      avgTotalHrs: s.rows.reduce((acc, r) => acc + Number(r.total_hrs || 0), 0) / (s.rows.length || 1),
      problemDays: problems,
    };
  }
  out.rig104Sample = rigSample(104);
  out.rig305Sample = rigSample(305);

  // Dump first 30 raw rows from any "header row not detected" review card so
  // we can see what the approved-PDF layout actually looks like.
  const queue = (typeof window.__getReviewQueue === 'function') ? window.__getReviewQueue() : [];
  out.failingHeaderSamples = queue
    .filter(c => (c.issues || []).some(i => /header row not detected/i.test(i)))
    .slice(0, 4)
    .map(c => ({
      file: c.fileName,
      rig: c.rig,
      first30Rows: (c.raw || []).slice(0, 30).map(row =>
        (row || []).slice(0, 12).map(v => v == null ? '' : String(v).slice(0, 30))
      ),
    }));

  return out;
});

console.log(JSON.stringify(report, null, 2));

// Persist report to a file for easier inspection
const reportPath = path.join(stageDir, 'feb-2026-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Report written to: ${reportPath}`);

await browser.close();
