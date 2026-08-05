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
    window.__siRearReservationTrace = [];
    window.__siZoneOccupancyTrace = [];
    window.__siFirstRearConsumer = null;
    const quiet = new Set([
      '[SI-zone-debug]', '[SI-seat-score]', '[SI-order]', '[SI-pack-order]',
      '[SI-placed-xyz]', '[SI-render]', '[SI-zone-occupancy]', '[SI-reservation]',
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
    const rejects = window.__siRearReservationTrace || [];
    const occ = window.__siZoneOccupancyTrace || [];
    const first = window.__siFirstRearConsumer;
    const placed = (window.__siPlacedXyzAll || [])
      .filter((x) => x.zonePref === 'Z_REAR_POCKET');
    const twinsInRear = occ.filter(
      (x) => x.consumesRearZone && x.bundleType === 'twin_beam'
    );
    const byZone = {};
    rejects.forEach((x) => {
      const z = x.zonePref || 'null';
      byZone[z] = (byZone[z] || 0) + 1;
    });
    const xs = placed.map((p) => p.x);
    return {
      reservationRequired: !!(
        window.__siReservations
        && window.__siReservations.rearPocket
        && window.__siReservations.rearPocket.required
      ),
      rejectCount: rejects.length,
      rejectByZone: byZone,
      rejectSample: rejects.slice(0, 5),
      firstRearConsumer: first && {
        loadSeq: first.loadSeq,
        zonePref: first.zonePref,
        bundleType: first.bundleType,
        placedX: Math.round(first.placedX),
        mark: first.mark,
      },
      twinRearConsumers: twinsInRear.length,
      platePlaced: placed.length,
      plateXMin: xs.length ? Math.min(...xs) : null,
      plateXMax: xs.length ? Math.max(...xs) : null,
      plateSample: placed.slice(0, 8).map((p) => ({
        ls: p.loadSeq,
        x: Math.round(p.x),
        z: Math.round(p.z),
      })),
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});
