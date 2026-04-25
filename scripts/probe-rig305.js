// Focused probe: drop a single PDF, capture the parsed columns and the
// auto-detected mapping. Used to diagnose why a rig ends up "partial" even
// though all 28 days extracted.
//
//   URL=http://localhost:5174/ node scripts/probe-rig305.js [path-to-pdf]

import puppeteer from 'puppeteer';
import path from 'node:path';

const URL = process.env.URL || 'http://localhost:5173/';
const FILE = process.argv[2]
  || 'C:/Users/80128/OneDrive - abrajoman.com/Desktop/3.2026/2. Billing sheets for all Rigs Feb 2026/Rig 305/KZN 553 Feb Rig305/KZN 553 Feb Rig305.pdf';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on('dialog', async d => { await d.accept(); });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
await page.select('#monthSelect', '2');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });

console.log(`--- Dropping ${path.basename(FILE)} ---`);
const input = await page.$('#fileInput');
await input.uploadFile(FILE);

// Wait for extraction
await new Promise(r => setTimeout(r, 6000));

const probe = await page.evaluate(() => {
  const logLines = Array.from(document.querySelectorAll('#logEl .log-line'))
    .map(l => l.textContent);
  const store = (window.__getRigStore && window.__getRigStore()) || {};
  const review = (window.__getReviewQueue && window.__getReviewQueue()) || [];

  const out = { logLines, rigStore: {}, reviewCards: [] };
  for (const [rig, s] of Object.entries(store)) {
    out.rigStore[rig] = {
      meta: s.meta,
      rowCount: s.rows?.length,
      firstRow: s.rows?.[0],
      filename: s.files?.[0],
    };
  }
  for (const c of review) {
    out.reviewCards.push({
      file: c.fileName,
      rig: c.rig,
      headerRow: c.headerRow,
      map: c.map,
      issues: c.issues,
      detectedHeader: c.headerRow >= 0 && c.raw && c.raw[c.headerRow]
        ? c.raw[c.headerRow].slice(0, 20).map(v => v == null ? '' : String(v).slice(0, 40))
        : null,
      sampleRow: c.rows?.[0],
    });
  }
  return out;
});

// Print the most useful bits
console.log('\n=== LOG LINES ===');
for (const l of probe.logLines) console.log('  ' + l);

console.log('\n=== RIG STORE ===');
console.log(JSON.stringify(probe.rigStore, null, 2));

console.log('\n=== REVIEW CARDS (with detected header & mapping) ===');
console.log(JSON.stringify(probe.reviewCards, null, 2));

await browser.close();
