// Dev helper: screenshot a page via Playwright. node scripts/shot.cjs <url> <out.png> [waitExpr]
const { chromium } = require('playwright');
(async () => {
  const [url, out, wait = 'window.done'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 700 } });
  page.on('console', (m) => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(url);
  await page.waitForFunction(wait, null, { timeout: 120000 });
  const info = await page.evaluate(() => ({ buildMs: window.buildMs, info: window.info }));
  console.log(JSON.stringify(info));
  await page.screenshot({ path: out });
  await browser.close();
})();
