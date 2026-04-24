import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5173/';
const OUT = process.env.OUT || '/tmp/billing-app.png';

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

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2500));

await page.screenshot({ path: OUT, fullPage: true });

const state = await page.evaluate(() => ({
  title: document.title,
  rigsRendered: document.querySelectorAll('#rigList .rig-item').length,
  fleetCells: document.querySelectorAll('#fleetGrid > div').length,
  monthSelected: document.getElementById('monthSelect')?.value,
  yearInput: document.getElementById('yearInput')?.value,
  stepActive: document.querySelector('.step.active')?.id,
  dropZonePresent: !!document.getElementById('dropZone'),
  logLines: document.querySelectorAll('#logEl .log-line').length,
  latestLog: document.querySelector('#logEl .log-line:last-child')?.textContent,
}));

await browser.close();

console.log('Screenshot:', OUT);
console.log('State:', JSON.stringify(state, null, 2));
if (errors.length) {
  console.error('\nErrors:', errors);
  process.exit(1);
}
console.log('OK.');
