/* Measure tip gap of one assembly before/after ship prep force-flat. */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5179;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1200, height: 800 },
  });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(1000);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const out = await page.evaluate(() => {
    const rows = [];
    (assemblyGroups || []).forEach(g => {
      (g.packUnits || []).forEach(u => {
        if (String(u.groupKind || '') !== 'welded_assembly') return;
        if (rows.length >= 4) return;
        // Clear yard pitch cache
        delete u._groupByQuat;
        u._freezeGroupByPose = false;
        u._shipPrepped = false;
        const before = {
          tip: u.tipGapMm, sb: u.stableBundleMm && {
            l: Math.round(u.stableBundleMm.l),
            w: Math.round(u.stableBundleMm.w),
            h: Math.round(u.stableBundleMm.h),
          },
        };
        const r = csShipPrepItem(u);
        rows.push({
          mark: u.mark,
          before,
          after: {
            tip: Math.round(u.tipGapMm || 0),
            method: r && r.method,
            sb: u.stableBundleMm && {
              l: Math.round(u.stableBundleMm.l),
              w: Math.round(u.stableBundleMm.w),
              h: Math.round(u.stableBundleMm.h),
            },
            stood: !!u._shipStoodOnEdge,
          },
        });
      });
    });
    return { hasForceFlat: typeof csShipPrepForceFlat === 'function', rows };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
