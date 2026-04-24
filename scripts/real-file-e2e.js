import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5173/';
const FILE = process.argv[2];
if (!FILE) { console.error('usage: node scripts/real-file-e2e.js <path>'); process.exit(1); }

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
page.on('dialog', async d => { await d.accept(); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));

await page.select('#monthSelect', '3');
await page.$eval('#yearInput', el => { el.value = '2026'; el.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 300));

console.log(`--- Dropping ${FILE} ---`);
const input = await page.$('#fileInput');
await input.uploadFile(FILE);
await new Promise(r => setTimeout(r, 4000));

const state = await page.evaluate(() => {
  const logLines = Array.from(document.querySelectorAll('#logEl .log-line'))
    .slice(-10)
    .map(l => l.textContent);
  const reviewCards = Array.from(document.querySelectorAll('#reviewQueue .card'))
    .map(c => c.textContent.replace(/\s+/g, ' ').trim().slice(0, 400));
  return {
    sRigs: document.getElementById('sRigs').textContent,
    sRows: document.getElementById('sRows').textContent,
    sOper: document.getElementById('sOper').textContent,
    reviewCards,
    recentLog: logLines,
    ri210Days: document.querySelector('#ri-210 .r-days')?.textContent,
  };
});

console.log(JSON.stringify(state, null, 2));

await browser.close();
