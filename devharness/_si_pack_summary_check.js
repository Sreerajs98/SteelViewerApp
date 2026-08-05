const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5178;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  const printed = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/pack summary|csPackV2DebugPackSummary|^total units|^placed |^unplaced |^stacked |^Z_REAR_POCKET|^placement /.test(t)) {
      printed.push(t);
    }
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch (_) { /* */ } });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => rawScene && (rawScene.items || []).length, { timeout: 60000 });
  await sleep(800);
  await page.evaluate(() => groupByShape());
  for (let i = 0; i < 50; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      (assemblyGroups || []).forEach((g) => { c += (g.packUnits || []).length; });
      return c;
    });
    if (n > 0) break;
    await sleep(400);
  }
  await sleep(1500);
  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g) => {
      if (g && g.state !== 'oversized') g.checked = true;
    });
    if (typeof renumberCheckOrderByWeight === 'function') renumberCheckOrderByWeight();
  });
  await page.evaluate(async () => { await runOptimizeKeepingLeftovers(); });
  await sleep(3000);

  const r = await page.evaluate(() => {
    const auto = window.__siPackSummary || null;
    const manual = window.csPackV2DebugPackSummary();
    return {
      autoRanOnOptimise: !!auto,
      summary: manual && {
        totalUnits: manual.totalUnits,
        placedCount: manual.placedCount,
        unplacedCount: manual.unplacedCount,
        stackedCount: manual.stackedCount,
        rearPocketReservedCount: manual.rearPocketReservedCount,
        rearPocketPlacedCount: manual.rearPocketPlacedCount,
        placementPct: manual.placementPct,
        unplacedListLen: (manual.unplaced || []).length,
        unplacedFirst8: (manual.unplaced || []).slice(0, 8),
        unplacedRear: (manual.unplaced || [])
          .filter((u) => u.zonePref === 'Z_REAR_POCKET'),
        unplacedByReason: (manual.unplaced || []).reduce((m, u) => {
          const k = u.fitReason || 'null';
          m[k] = (m[k] || 0) + 1;
          return m;
        }, {}),
      },
      weightCap: (() => {
        const p = window.__lastPackV2Optimise && window.__lastPackV2Optimise.pack;
        return p ? {
          capKg: p.weightCapKg,
          loadKg: p.weightLoadKg,
          evictedCount: p.weightEvictedCount,
          evictedKg: p.weightEvictedKg,
        } : null;
      })(),
      consistent: manual
        && manual.placedCount + manual.unplacedCount === manual.totalUnits,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  console.log('\n--- console lines captured ---');
  printed.slice(0, 12).forEach((l) => console.log(l));
  await browser.close();
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
