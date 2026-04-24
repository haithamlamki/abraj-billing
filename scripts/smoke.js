import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5173/';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();

const errors = [];
const pageLogs = [];

page.on('pageerror', err => errors.push({ type: 'pageerror', message: err.message, stack: err.stack }));
// Benign: the app probes for pre-existing consolidated XLSX files; 404s there are expected.
const EXPECTED_404_RE = /(ALL_RIGS\.xlsx)/i;
page.on('console', msg => {
  const type = msg.type();
  const text = msg.text();
  if (type === 'error') {
    if (EXPECTED_404_RE.test(text) || text.includes('Failed to load resource')) {
      pageLogs.push({ type: 'console.error (expected)', text });
    } else {
      errors.push({ type: 'console.error', text });
    }
  } else if (type === 'warning') {
    pageLogs.push({ type: 'console.warning', text });
  }
});
page.on('requestfailed', req => {
  if (!EXPECTED_404_RE.test(req.url())) {
    errors.push({ type: 'requestfailed', url: req.url(), reason: req.failure()?.errorText });
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

// Let the app fully boot (CDN scripts, Chart.js, etc.)
await new Promise(r => setTimeout(r, 3000));

// Extract a snapshot of boot state from the DOM
const bootState = await page.evaluate(() => {
  const readTxt = id => document.getElementById(id)?.textContent || null;
  return {
    rigItems: document.querySelectorAll('#rigList .rig-item').length,
    fleetGridCells: document.querySelectorAll('#fleetGrid > div').length,
    sRigs: readTxt('sRigs'),
    sRows: readTxt('sRows'),
    sOper: readTxt('sOper'),
    stepActive: document.querySelector('.step.active')?.id,
    logLines: document.querySelectorAll('#logEl .log-line').length,
    handlersExposed: {
      onMonthYearChange: typeof window.onMonthYearChange,
      exportAll: typeof window.exportAll,
      acceptData: typeof window.acceptData,
      showAppView: typeof window.showAppView,
    },
  };
});

await browser.close();

console.log('Boot state:', JSON.stringify(bootState, null, 2));

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', JSON.stringify(e));
  process.exit(1);
}
console.log('\nOK: no runtime errors at boot.');
