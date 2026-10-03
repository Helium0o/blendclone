// Dev helper: load the app UI in Chromium, run a JS snippet, screenshot.
// node scripts/ui-shot.cjs out.png "<js to run in page (async)>"
const { chromium } = require('playwright');
(async () => {
  const [out, code = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[console]', m.type(), m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:5173/src/index.html');
  await page.waitForFunction(() => window.carforgeApp, null, { timeout: 60000 });
  if (code) {
    const r = await page.evaluate(`(async () => { const app = window.carforgeApp; ${code} })()`);
    if (r !== undefined) console.log(Array.isArray(r) ? r.map(x => String(x).slice(0, 170)).join("\n") : JSON.stringify(r, null, 1).slice(0, 4000));
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out });
  await browser.close();
})();
