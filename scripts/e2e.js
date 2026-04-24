import puppeteer from 'puppeteer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const URL = process.env.URL || 'http://localhost:5173/';
const FIXTURE = resolve('fixtures/204_March_2026.xlsx');

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

// Set billing period to March 2026 so the fixture dates match
await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 500));

console.log('--- Uploading 204_March_2026.xlsx ---');
const input = await page.$('#fileInput');
await input.uploadFile(FIXTURE);
await new Promise(r => setTimeout(r, 1500));

// Should now be on Step 2: preview + mapping
const afterUpload = await page.evaluate(() => ({
  step: document.querySelector('.step.active')?.id,
  previewShown: document.getElementById('panelPreview').style.display !== 'none',
  fileName: document.getElementById('previewFileName')?.textContent,
  detectedHeaderRow: document.getElementById('detectedHeaderRowNum')?.textContent,
  metaRig: document.getElementById('metaRig')?.value,
  metaCust: document.getElementById('metaCust')?.value,
  metaWell: document.getElementById('metaWell')?.value,
  metaContract: document.getElementById('metaContract')?.value,
  metaPO: document.getElementById('metaPO')?.value,
  mapStatus: document.getElementById('mapStatus')?.textContent,
  mappedDate: document.getElementById('sel-date')?.value,
  mappedOperating: document.getElementById('sel-operating')?.value,
  mappedRigMove: document.getElementById('sel-rig_move')?.value,
  mappedOperation: document.getElementById('sel-operation')?.value,
  mappedRemarks: document.getElementById('sel-remarks')?.value,
}));
console.log('  after upload:', afterUpload);

console.log('--- Click Extract ---');
await page.click('#btnExtract');
await new Promise(r => setTimeout(r, 800));

const afterExtract = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#resultScroll tbody tr'));
  return {
    step: document.querySelector('.step.active')?.id,
    resultShown: document.getElementById('panelResult').style.display !== 'none',
    resultTitle: document.getElementById('resultTitle')?.textContent,
    rowCount: rows.length,
    firstRowDate: rows[0]?.querySelector('[data-key="date"]')?.textContent?.trim(),
    lastRowDate: rows[rows.length - 1]?.querySelector('[data-key="date"]')?.textContent?.trim(),
    timelineCellCount: document.querySelectorAll('#resultTimeline [data-scroll-day]').length,
    confidenceStripPresent: document.getElementById('resultWarnings')?.textContent.includes('Extraction Confidence'),
    confidenceScore: document.getElementById('resultWarnings')?.textContent.match(/Confidence:\s*(\d+)%/)?.[1],
  };
});
console.log('  after extract:', afterExtract);

console.log('--- Click Save & continue ---');
await page.evaluate(() => window.acceptData());
await new Promise(r => setTimeout(r, 700));

const afterAccept = await page.evaluate(() => ({
  sRigs: document.getElementById('sRigs').textContent,
  sRows: document.getElementById('sRows').textContent,
  sOper: document.getElementById('sOper').textContent,
  rig204Days: document.querySelector('#ri-204 .r-days')?.textContent,
  rig204Classes: document.querySelector('#ri-204')?.className,
}));
console.log('  after accept:', afterAccept);

console.log('--- Open Executive Summary ---');
await page.evaluate(() => window.showAppView('summary'));
await new Promise(r => setTimeout(r, 800));

const summary = await page.evaluate(() => ({
  kpiSubmittedDays: document.getElementById('kpiSubmittedDays')?.textContent,
  kpiOperating: document.getElementById('kpiOperating')?.textContent,
  kpiReduced: document.getElementById('kpiReduced')?.textContent,
  kpiMissingHrs: document.getElementById('kpiMissingHrs')?.textContent,
  kpiTotalBilled: document.getElementById('kpiTotalBilled')?.textContent,
  kpiFullRigs: document.getElementById('kpiFullRigs')?.textContent,
  kpiCriticalExceptions: document.getElementById('kpiCriticalExceptions')?.textContent,
  rig204RowInTable: Array.from(document.querySelectorAll('#summaryRigTable tr'))
    .find(tr => tr.textContent.includes('204'))?.textContent.replace(/\s+/g, ' ').trim(),
  partialExceptionForRig204: Array.from(document.querySelectorAll('#summaryExceptionTable tr'))
    .find(tr => tr.textContent.includes('204') && tr.textContent.includes('Partial'))?.textContent.replace(/\s+/g, ' ').trim(),
}));
console.log('  summary:', summary);

await browser.close();

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exit(1);
}
console.log('\nE2E OK.');
