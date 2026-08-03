/* Traces the payload budget: what the whole job weighs, what was admitted,
 * what the pack actually seated, and what the cap still had to unload. */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5181;
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
  await sleep(1200);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const out = await page.evaluate(() => {
    const spec = csPackV2ContainerSpec(rawScene && rawScene.containerSpec);
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const kgU = csPackV2UnitWeightKg;
    const jobTotalKg = units.reduce((s, u) => s + kgU(u), 0);
    const bare = csPackV2PackWithTwins(units, {
      containerSpec: spec, enableStacks: true });
    const bareKg = (bare.placed || []).reduce((s, p) => s + kgU(p.unit || p), 0);
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    const rep = opt.report || {};
    const placedKg = (opt.placedItems || [])
      .map(it => csPackV2UnitWeightKg(it))
      .reduce((a, b) => a + b, 0);
    const top = (opt.placedItems || [])
      .map(it => ({ mark: it.mark, kg: Math.round(csPackV2UnitWeightKg(it)) }))
      .sort((a, b) => b.kg - a.kg).slice(0, 6);
    return {
      capKg: spec.maxWeightKg,
      jobUnits: units.length,
      jobTotalKg: Math.round(jobTotalKg),
      geometricPlaced: bare.placed.length,
      geometricKg: Math.round(bareKg),
      geometricStacks: (bare.placed || []).filter(p => p && p.layer === 'stack').length,
      geometricStackKg: Math.round((bare.placed || [])
        .filter(p => p && p.layer === 'stack')
        .reduce((s, p) => s + kgU(p.unit || p), 0)),
      finalStacks: (((opt.pack && opt.pack.placed) || [])
        .filter(p => p && p.layer === 'stack')).length,
      finalPlaced: rep.placedCount,
      finalPlacedKg: Math.round(placedKg),
      capped: rep.weightCappedCount,
      cappedKg: Math.round(rep.weightCappedKg || 0),
      heaviestAboard: top,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
