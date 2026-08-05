const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = 5178;
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
  page.on('dialog', async (d) => {
    try { await d.dismiss(); } catch (_) { /* */ }
  });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await page.evaluate(() => {
    const quiet = new Set([
      '[SI-zone-debug]', '[SI-seat-score]', '[SI-order]', '[SI-pack-order]',
      '[SI-placed-xyz]', '[SI-render]', '[SI-zone-occupancy]', '[SI-reservation]',
      '[SI-rear-skip]', '[SI-rear-pocket-order]', '[SI-critical-rear]',
    ]);
    const orig = console.log;
    console.log = function () {
      if (quiet.has(arguments[0])) return;
      return orig.apply(console, arguments);
    };
  });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => rawScene && (rawScene.items || []).length,
    { timeout: 60000 }
  );
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
  await page.evaluate(async () => {
    await runOptimizeKeepingLeftovers();
  });
  await sleep(3000);
  const r = await page.evaluate(() => {
    const promo = window.__siCriticalRearPromotion || null;
    const target = (promo && promo.promotedSeqs) || [];
    const all = window.__siPlacedXyzAll || [];
    const placedCritical = all.filter((x) =>
      x && x.loadSeq != null && target.indexOf(+x.loadSeq) >= 0);
    const skipFinal = (window.__siRearSkipTrace || []).filter((x) =>
      x && target.indexOf(+x.loadSeq) >= 0
      && /unplaced|placedFloor|placedStack/.test(String(x.stage || '')));
    const rearPlaced = all.filter((x) => x && x.zonePref === 'Z_REAR_POCKET');
    const trace = window.__siPackOrderTrace || {};
    return {
      promotion: promo && {
        beforeIndex: promo.beforeIndex,
        afterIndex: promo.afterIndex,
        promotedSeqs: promo.promotedSeqs,
        detail: promo.detail,
      },
      placedCount: trace.placedCount,
      unplacedCount: trace.unplacedCount,
      placedCritical: placedCritical.map((p) => ({
        ls: p.loadSeq, x: Math.round(p.x), z: Math.round(p.z), xBand: p.xBand,
      })),
      criticalOutcomes: skipFinal.map((x) => ({
        stage: x.stage,
        loadSeq: x.loadSeq,
        floorFailReason: x.floorFailReason || null,
        stackFailReason: x.stackFailReason || null,
        x: x.x != null ? Math.round(x.x) : null,
        z: x.z != null ? Math.round(x.z) : null,
      })),
      rearPocketPlacedCount: rearPlaced.length,
      rearPocketXRange: rearPlaced.length ? {
        min: Math.round(Math.min(...rearPlaced.map((p) => p.x))),
        max: Math.round(Math.max(...rearPlaced.map((p) => p.x))),
      } : null,
      firstFivePlacedByLoadSeq: all.slice(0, 5).map((p) => ({
        ls: p.loadSeq, x: Math.round(p.x), z: Math.round(p.z), zone: p.zonePref,
      })),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
