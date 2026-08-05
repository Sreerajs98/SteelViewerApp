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
  const weightLogs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/^\[weight-unit\]/.test(t)) weightLogs.push(t);
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch (_) { /* */ } });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => rawScene && (rawScene.items || []).length, { timeout: 60000 });
  await sleep(800);

  // Raw scene view of the plate marks BEFORE grouping
  const rawView = await page.evaluate(() => {
    const hits = (rawScene.items || []).filter((it) =>
      it && /PL1\.5\*2270/.test(String(it.mark || '')));
    return {
      count: hits.length,
      sample: hits.slice(0, 4).map((it) => ({
        mark: it.mark,
        qty: it.qty,
        unitWeightKg: it.unitWeightKg,
        weight: it.weight,
        lengthMm: it.lengthMm,
        widthMm: it.widthMm,
        heightMm: it.heightMm,
        sectT: it.sectT,
        sectW: it.sectW,
        sectH: it.sectH,
        shapeKey: it.shapeKey,
        profileDesc: it.profileDesc,
        weightEstimated: it.weightEstimated,
        _weightWasScaled: it._weightWasScaled,
      })),
      estAndNorm: hits.slice(0, 1).map((it) => ({
        est: typeof estimateBboxSteelKg === 'function' ? estimateBboxSteelKg(it) : null,
        norm: typeof normalizeMassToKg === 'function'
          ? normalizeMassToKg(it.unitWeightKg, estimateBboxSteelKg(it)) : null,
      })),
    };
  });

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

  const probe = await page.evaluate(() => {
    const it = (rawScene.items || []).find((x) => x && x.mark === 'D2-DSH101');
    const est = it ? estimateBboxSteelKg(it) : null;
    return {
      item: it && {
        mark: it.mark,
        lengthMm: it.lengthMm,
        widthMm: it.widthMm,
        heightMm: it.heightMm,
        sectT: it.sectT,
        sectW: it.sectW,
        sectH: it.sectH,
        shapeKey: it.shapeKey,
        profileDesc: it.profileDesc,
        unitWeightKgNow: it.unitWeightKg,
        _weightWasScaled: it._weightWasScaled,
      },
      estimateBboxSteelKg: est,
      // Reproduce the conversion on the presumed original IFC value
      normalize_3_3: normalizeMassToKg(3.3, est),
      normalize_3_3_noEst: normalizeMassToKg(3.3, 0),
      trueSolidKg: it
        ? (it.lengthMm / 1000) * (it.widthMm / 1000) * (it.heightMm / 1000) * 7850
        : null,
      plate1p5Kg: 2.27 * 2.27 * 0.0015 * 7850,
      WEIGHT_MAX_UNIT_KG: typeof WEIGHT_MAX_UNIT_KG !== 'undefined'
        ? WEIGHT_MAX_UNIT_KG : null,
    };
  });

  console.log('PROBE (D2-DSH101):');
  console.log(JSON.stringify(probe, null, 2));
  console.log('\n[weight-unit] lines for these marks:');
  weightLogs.filter((l) => /DSH101|DJR001/.test(l)).slice(0, 6)
    .forEach((l) => console.log('  ' + l));
  console.log('total [weight-unit] lines:', weightLogs.length);
  await browser.close();
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
