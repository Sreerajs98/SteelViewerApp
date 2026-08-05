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
      '[SI-rear-skip]',
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
    const target = [71, 72, 73, 74, 75, 76];
    const skip = (window.__siRearSkipTrace || []).filter((x) =>
      x && x.loadSeq != null && target.indexOf(+x.loadSeq) >= 0);
    const byStage = {};
    skip.forEach((x) => {
      const k = x.stage || '?';
      byStage[k] = (byStage[k] || 0) + 1;
    });
    const finalOutcomes = skip.filter((x) =>
      /unplaced|placedFloor|placedStack|commitFloorFailed/.test(String(x.stage || '')));
    const floorFails = skip.filter((x) => x.stage === 'FindFloorSeat');
    const placed = (window.__siPlacedXyzAll || []).filter((x) =>
      x && x.loadSeq != null && target.indexOf(+x.loadSeq) >= 0);
    const cand = (window.__siRearCandidateTrace || []).filter((x) =>
      x && x.loadSeq != null && target.indexOf(+x.loadSeq) >= 0);
    const unplacedPack = (window.__siPackOrderTrace
      && window.__siPackOrderTrace.unplacedCount) || null;

    // Also surface unplaced fitReasons from last pack if available via clickable/outside
    let unplacedHints = [];
    try {
      if (typeof clickable !== 'undefined') {
        unplacedHints = (clickable || [])
          .filter((c) => c && c.outsideContainer && c.item && c.item.siHints
            && target.indexOf(+c.item.siHints.loadSeq) >= 0)
          .map((c) => ({
            loadSeq: c.item.siHints.loadSeq,
            mark: c.item.mark,
            fitReason: c.item.fitReason || null,
            fitReasonMsg: c.item.fitReasonMsg || null,
            zonePref: c.item.siHints.zonePref,
            pl: c.item.packLengthMm || c.item.l,
            pw: c.item.packWidthMm || c.item.w,
            ph: c.item.packHeightMm || c.item.h,
          }));
      }
    } catch (_) { /* */ }

    return {
      prePackPresence: window.__siRearPrePackPresence || null,
      skipCountFor71_76: skip.length,
      byStage: byStage,
      finalOutcomes: finalOutcomes,
      floorFails: floorFails,
      placed71_76: placed,
      candidate71_76: cand,
      unplacedPackCount: unplacedPack,
      unplacedHints: unplacedHints,
      sampleEnter: skip.filter((x) => x.stage === 'PackHuman.enter').slice(0, 6),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
