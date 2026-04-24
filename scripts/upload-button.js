import puppeteer from 'puppeteer';
import { resolve } from 'node:path';

const URL = process.env.URL || 'http://localhost:5173/';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
page.on('dialog', async d => { await d.accept(); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

// Align billing period
await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 400));

// 1) The button exists and is visible in the nav
const btnState = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.nav-right .btn'));
  const upload = btns.find(b => b.textContent.trim().includes('Upload Files'));
  return {
    found: !!upload,
    text: upload?.textContent.trim(),
    classes: upload?.className,
    visible: upload ? upload.offsetParent !== null : false,
  };
});
console.log('Upload button in nav:', btnState);
if (!btnState.found) { console.error('FAIL: button not in nav'); process.exit(1); }
if (!btnState.visible) { console.error('FAIL: button not visible'); process.exit(1); }

// 2) Clicking the nav button should dispatch a click to #fileInput.
// We can't verify the OS file picker opens headlessly, but we can prove the event path works
// by uploading a file via the SAME input element after clicking the button.
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.nav-right .btn'));
  const upload = btns.find(b => b.textContent.trim().includes('Upload Files'));
  // Mark whether the hidden fileInput receives the click
  window.__fileInputClicks = 0;
  document.getElementById('fileInput').addEventListener('click', () => { window.__fileInputClicks++; }, { once: false });
  upload.click();
});
await new Promise(r => setTimeout(r, 200));
const clicks = await page.evaluate(() => window.__fileInputClicks);
console.log('fileInput received clicks:', clicks);
if (clicks !== 1) { console.error('FAIL: nav button did not trigger fileInput click'); process.exit(1); }

// 3) Upload via the same fileInput programmatically to confirm handleFiles still works
const input = await page.$('#fileInput');
await input.uploadFile(resolve('fixtures/204_March_2026.xlsx'));
await new Promise(r => setTimeout(r, 2000));

const afterOne = await page.evaluate(() => {
  const banner = document.getElementById('batchBanner');
  return {
    step: document.querySelector('.step.active')?.id,
    previewShown: document.getElementById('panelPreview').style.display !== 'none',
    // Only "active" if the element exists AND is visible.
    batchActive: !!banner && banner.style.display !== 'none',
  };
});
console.log('After uploading 1 file via button → preview shown (batch should NOT activate):', afterOne);
if (!afterOne.previewShown) { console.error('FAIL: preview not shown'); process.exit(1); }
if (afterOne.batchActive) { console.error('FAIL: batch mode should not activate for single upload'); process.exit(1); }

// 4) Now while Step 2 is visible, clicking Upload again and selecting more files
//    should *queue* them without hijacking the current preview.
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('.nav-right .btn'));
  const upload = btns.find(b => b.textContent.trim().includes('Upload Files'));
  upload.click();
});
await new Promise(r => setTimeout(r, 200));

await input.uploadFile(
  resolve('fixtures/205_Mar_2026.xlsx'),
  resolve('fixtures/206_Mar_2026.xlsx'),
);
await new Promise(r => setTimeout(r, 600));

const duringStep2 = await page.evaluate(() => {
  const banner = document.getElementById('batchBanner');
  return {
    step: document.querySelector('.step.active')?.id,
    previewShown: document.getElementById('panelPreview').style.display !== 'none',
    previewFileName: document.getElementById('previewFileName')?.textContent,
    batchActive: !!banner && banner.style.display !== 'none',
    batchBannerText: banner?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 80),
  };
});
console.log('After queuing 2 more while on Step 2:', duringStep2);
if (!duringStep2.previewShown) { console.error('FAIL: Step 2 preview was hijacked by new upload'); process.exit(1); }
if (!duringStep2.previewFileName?.includes('204_March_2026.xlsx')) {
  console.error('FAIL: current file changed unexpectedly — expected to still be 204'); process.exit(1);
}

// 5) Click Extract on the current file (manual flow), then Accept — the queued
//    files should then drain under batch mode.
await page.evaluate(() => window.applyMapping());
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => window.acceptData());
await new Promise(r => setTimeout(r, 6000));

const final = await page.evaluate(() => ({
  sRigs: document.getElementById('sRigs').textContent,
  sRows: document.getElementById('sRows').textContent,
  step: document.querySelector('.step.active')?.id,
  banner: document.getElementById('batchBanner')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100),
}));
console.log('Final state (all 3 should be loaded):', final);
if (final.sRigs !== '3') { console.error(`FAIL: expected 3 rigs, got ${final.sRigs}`); process.exit(1); }
if (final.sRows !== '93') { console.error(`FAIL: expected 93 rows, got ${final.sRows}`); process.exit(1); }

await browser.close();
console.log('\nUPLOAD-BUTTON E2E OK.');
