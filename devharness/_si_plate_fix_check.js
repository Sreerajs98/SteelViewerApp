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
  const wlogs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/^\[weight-unit\]/.test(t)) wlogs.push(t);
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('dialog', async (d) => { try { await d.dismiss(); } catch (_) { /* */ } });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => rawScene && (rawScene.items || []).length, { timeout: 60000 });
  await sleep(800);

  const rawAfterLoad = await page.evaluate(() => {
    const it = (rawScene.items || []).find((x) => x && x.mark === 'D2-DSH101');
    return it && {
      mark: it.mark,
      lengthMm: it.lengthMm,
      widthMm: it.widthMm,
      heightMm: it.heightMm,
      sectT: it.sectT,
      sectH: it.sectH,
      sectW: it.sectW,
      unitWeightKg: it.unitWeightKg,
      _weightWasScaled: !!it._weightWasScaled,
      estimateNow: estimateBboxSteelKg(it),
      resolved: resolvePlateSectionDims(it),
      planWidth: resolvePlatePlanWidthMm(it, 0),
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

  const out = await page.evaluate(() => {
    const fix = window.__siPlateSectionFix || {};
    const pick = (arr) => (arr || []).filter((r) =>
      /DSH101|PL1\.5\*2270/.test(String(r.mark || '')));
    const trace = window.csPackV2DebugWeightTrace(71, 76).map((r) => ({
      loadSeq: r.loadSeq,
      mark: r.mark,
      thickness: r.thickness,
      length: r.length,
      width: r.width,
      quantity: r.quantity,
      sourceWeight: r.sourceWeight,
      rawUnitWeightKg: r.chain.rawUnitWeightKg[0],
      bboxEstimateKg: r.chain.bboxEstimateKg,
      groupWeightKg: r.chain.group.weightKg,
    }));
    const s = window.__siPackSummary || {};
    return {
      weightEstimateRows: pick(fix.weightEstimate).slice(0, 3),
      planWidthRows: pick(fix.planWidth).slice(0, 3),
      bundleWidthRows: (fix.bundleWidth || []).slice(0, 6),
      weightEstimateTotal: (fix.weightEstimate || []).length,
      planWidthTotal: (fix.planWidth || []).length,
      bundleWidthTotal: (fix.bundleWidth || []).length,
      trace: trace,
      summary: {
        totalUnits: s.totalUnits,
        placedCount: s.placedCount,
        unplacedCount: s.unplacedCount,
        stackedCount: s.stackedCount,
        rearReserved: s.rearPocketReservedCount,
        rearPlaced: s.rearPocketPlacedCount,
        placementPct: s.placementPct,
        unplacedByReason: (s.unplaced || []).reduce((m, u) => {
          const k = u.fitReason || 'null';
          m[k] = (m[k] || 0) + 1;
          return m;
        }, {}),
      },
    };
  });

  console.log('RAW AFTER LOAD:');
  console.log(JSON.stringify(rawAfterLoad, null, 2));
  console.log('\nRESULT:');
  console.log(JSON.stringify(out, null, 2));
  console.log('\n[weight-unit] lines for DSH101:',
    wlogs.filter((l) => /DSH101/.test(l)).length,
    '| total:', wlogs.length);
  await browser.close();
})().catch((e) => {
  console.error((e && e.stack) || e);
  process.exit(1);
});
