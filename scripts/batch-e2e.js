import puppeteer from 'puppeteer';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const URL = process.env.URL || 'http://localhost:5173/';
const FIXTURES = [
  resolve('fixtures/204_March_2026.xlsx'),
  resolve('fixtures/205_Mar_2026.xlsx'),
  resolve('fixtures/206_Mar_2026.xlsx'),
];

for (const f of FIXTURES) {
  if (!existsSync(f)) {
    console.error(`Missing fixture: ${f}. Generate via: node scripts/make-fixture.js <rig>`);
    process.exit(1);
  }
}

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

const errors = [];
const EXPECTED_404_RE = /ALL_RIGS\.xlsx/i;
page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
page.on('console', msg => {
  if (msg.type() === 'error') {
    const text = msg.text();
    if (!EXPECTED_404_RE.test(text) && !text.includes('Failed to load resource')) {
      errors.push(`console.error: ${text}`);
    }
  }
});
page.on('dialog', async d => { await d.accept(); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Set billing period to March 2026
await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 500));

console.log('--- Uploading 3 fixtures at once ---');
const input = await page.$('#fileInput');
await input.uploadFile(...FIXTURES);

// Allow batch to run to completion
await new Promise(r => setTimeout(r, 6000));

const state = await page.evaluate(() => ({
  batchBannerVisible: document.getElementById('batchBanner')?.style.display !== 'none',
  batchBannerText: document.getElementById('batchBanner')?.textContent?.replace(/\s+/g, ' ').trim(),
  sRigs: document.getElementById('sRigs').textContent,
  sRows: document.getElementById('sRows').textContent,
  sOper: document.getElementById('sOper').textContent,
  rig204Days: document.querySelector('#ri-204 .r-days')?.textContent,
  rig205Days: document.querySelector('#ri-205 .r-days')?.textContent,
  rig206Days: document.querySelector('#ri-206 .r-days')?.textContent,
  logAutoAccepted: Array.from(document.querySelectorAll('#logEl .log-line.ok'))
    .map(el => el.textContent).filter(t => /Rig \d+ auto-accepted/.test(t)).length,
  activeStep: document.querySelector('.step.active')?.id,
}));

console.log('State:', JSON.stringify(state, null, 2));

// Assertions
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
if (state.sRigs !== '3') fail(`expected 3 rigs, got ${state.sRigs}`);
if (state.sRows !== '93') fail(`expected 93 rows (3 × 31), got ${state.sRows}`);
if (state.rig204Days !== '31/31') fail(`rig 204 days: ${state.rig204Days}`);
if (state.rig205Days !== '31/31') fail(`rig 205 days: ${state.rig205Days}`);
if (state.rig206Days !== '31/31') fail(`rig 206 days: ${state.rig206Days}`);
if (state.logAutoAccepted !== 3) fail(`expected 3 auto-accepted log lines, got ${state.logAutoAccepted}`);
if (!state.batchBannerText?.includes('Batch done')) fail('batch banner should show "Batch done"');

// Confirm summary view also reflects the data
await page.evaluate(() => window.showAppView('summary'));
await new Promise(r => setTimeout(r, 800));
const summary = await page.evaluate(() => ({
  kpiSubmittedDays: document.getElementById('kpiSubmittedDays')?.textContent,
  kpiFullRigs: document.getElementById('kpiFullRigs')?.textContent,
  rigRowsInTable: document.querySelectorAll('#summaryRigTable tr').length,
}));
console.log('Summary:', JSON.stringify(summary, null, 2));
if (summary.kpiSubmittedDays !== '93') fail(`summary kpiSubmittedDays: ${summary.kpiSubmittedDays}`);

await browser.close();

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('\nBATCH E2E OK.');
