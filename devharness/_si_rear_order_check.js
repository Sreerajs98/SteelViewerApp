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
      '[SI-rear-skip]', '[SI-rear-pocket-order]',
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
    const ord = window.__siRearPocketOrder || { before: [], after: [] };
    const areasMono = (ord.after || []).every((row, i, arr) =>
      i === 0 || arr[i - 1].areaMm2 + 1e-6 >= row.areaMm2);
    const placed = (window.__siPlacedXyzAll || []).filter((x) =>
      x && x.loadSeq != null && +x.loadSeq >= 71 && +x.loadSeq <= 76);
    const skipFinal = (window.__siRearSkipTrace || []).filter((x) =>
      x && x.loadSeq >= 71 && x.loadSeq <= 76
      && /unplaced|placedFloor|placedStack/.test(String(x.stage || '')));
    const first10After = (ord.after || []).slice(0, 10).map((x) => ({
      ls: x.loadSeq,
      mark: x.mark,
      area: Math.round(x.areaMm2),
      slot: x.slotIndex,
    }));
    const first10Before = (ord.before || []).slice(0, 10).map((x) => ({
      ls: x.loadSeq,
      mark: x.mark,
      area: Math.round(x.areaMm2),
      slot: x.slotIndex,
    }));
    // Where do 71-76 sit in after vs before?
    const pos = (arr) => (arr || [])
      .map((x, i) => ({ i, ls: x.loadSeq, area: Math.round(x.areaMm2), mark: x.mark }))
      .filter((x) => x.ls >= 71 && x.ls <= 76);
    return {
      rearCount: (ord.before || []).length,
      areasMonoDesc: areasMono,
      first10Before,
      first10After,
      posBefore: pos(ord.before),
      posAfter: pos(ord.after),
      placed71_76: placed.map((p) => ({
        ls: p.loadSeq, x: Math.round(p.x), z: Math.round(p.z),
      })),
      outcomes71_76: skipFinal,
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
