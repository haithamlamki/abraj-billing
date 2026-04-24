import puppeteer from 'puppeteer';
import { resolve } from 'node:path';

const URL = process.env.URL || 'http://localhost:5173/';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });

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

await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 300));

console.log('--- Test 1: drop ONE clean file → should land silently in rigStore ---');
const input = await page.$('#fileInput');
await input.uploadFile(resolve('fixtures/204_March_2026.xlsx'));
await new Promise(r => setTimeout(r, 2500));

const afterOne = await page.evaluate(() => {
  const preview = document.getElementById('panelPreview');
  const result = document.getElementById('panelResult');
  const review = document.getElementById('reviewQueue');
  return {
    step: document.querySelector('.step.active')?.id,
    previewShown: preview && preview.style.display !== 'none',
    resultShown: result && result.style.display !== 'none',
    reviewQueueVisible: !!review && review.style.display !== 'none',
    reviewCards: review ? review.querySelectorAll('.card').length : 0,
    sRigs: document.getElementById('sRigs').textContent,
    sRows: document.getElementById('sRows').textContent,
    sOper: document.getElementById('sOper').textContent,
    rig204Days: document.querySelector('#ri-204 .r-days')?.textContent,
  };
});
console.log('  after single drop:', afterOne);

const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };
if (afterOne.previewShown) fail('Preview UI should NOT be shown after drop');
if (afterOne.resultShown) fail('Result UI should NOT be shown after drop');
if (afterOne.reviewQueueVisible) fail('Review queue should be empty for a clean file');
if (afterOne.sRigs !== '1') fail(`sRigs: ${afterOne.sRigs}`);
if (afterOne.sRows !== '31') fail(`sRows: ${afterOne.sRows}`);
if (afterOne.rig204Days !== '31/31') fail(`rig 204: ${afterOne.rig204Days}`);

console.log('--- Test 2: drop 2 more clean files as a batch ---');
await input.uploadFile(
  resolve('fixtures/205_Mar_2026.xlsx'),
  resolve('fixtures/206_Mar_2026.xlsx'),
);
await new Promise(r => setTimeout(r, 5000));

const afterBatch = await page.evaluate(() => ({
  sRigs: document.getElementById('sRigs').textContent,
  sRows: document.getElementById('sRows').textContent,
  batchBanner: document.getElementById('batchBanner')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80),
  reviewCards: document.querySelectorAll('#reviewQueue .card').length,
}));
console.log('  after batch drop:', afterBatch);
if (afterBatch.sRigs !== '3') fail(`sRigs after batch: ${afterBatch.sRigs}`);
if (afterBatch.sRows !== '93') fail(`sRows after batch: ${afterBatch.sRows}`);
if (afterBatch.reviewCards !== 0) fail('review queue should be empty for clean batch');

console.log('--- Test 3: click a rig → detail view appears (editable table) ---');
await page.click('#ri-204');
await new Promise(r => setTimeout(r, 400));
const detailState = await page.evaluate(() => ({
  step: document.querySelector('.step.active')?.id,
  resultShown: document.getElementById('panelResult').style.display !== 'none',
  rowCount: document.querySelectorAll('#resultScroll tbody tr').length,
}));
console.log('  detail view:', detailState);
if (detailState.rowCount !== 31) fail(`expected 31 rows in detail view, got ${detailState.rowCount}`);

await browser.close();

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('\nAUTO-DROP E2E OK.');
