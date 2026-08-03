/* Works out which property (or object identity) links a yard mesh's item to
 * the unit that Pack V2 later places, so the audit can compare like with like.
 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5178;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('dialog', async d => { await d.dismiss(); });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length,
    { timeout: 60000 });
  await sleep(1200);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const out = await page.evaluate(() => {
    const res = {};
    const cl = clickable || [];
    res.clickableCount = cl.length;

    // Is a yard clickable item the very same object as a group packUnit?
    let same = 0, total = 0;
    const puSet = new Set();
    (assemblyGroups || []).forEach(g => (g.packUnits || []).forEach(pu => puSet.add(pu)));
    res.packUnitCount = puSet.size;
    cl.forEach(c => { total++; if (c.item && puSet.has(c.item)) same++; });
    res.yardItemIsPackUnit = `${same}/${total}`;

    // Which id-ish fields exist on a yard item and on a packUnit?
    const idKeys = k => /uid|_id$|^id$|guid|key|mark|stagingGroupId|setIndex|__/i.test(k);
    res.yardItemKeys = cl[0] && cl[0].item
      ? Object.keys(cl[0].item).filter(idKeys) : [];
    const firstPu = [...puSet][0];
    res.packUnitKeys = firstPu ? Object.keys(firstPu).filter(idKeys) : [];

    // Tag pack units, then see what a built unit carries through
    let n = 0;
    puSet.forEach(pu => { pu.__tag = 't' + (n++); });
    cl.forEach((c, i) => { if (c.item) c.item.__clTag = 'c' + i; });

    const spec = rawScene.containerSpec;
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    res.unitCount = units.length;
    res.unitsWithPuTag = units.filter(u => u.__tag).length;
    res.unitsWithClTag = units.filter(u => u.__clTag).length;
    res.unitsWithSrcPu = units.filter(u => u._srcPackUnit).length;
    res.unitsWithSrcPuTag = units.filter(u => u._srcPackUnit && u._srcPackUnit.__tag).length;
    res.unitsWithFmUid = units.filter(u => u._fmUid != null).length;
    res.sampleUnitKeys = units[0] ? Object.keys(units[0]).filter(idKeys) : [];

    // Does the yard item carry the same uid the unit does?
    const uidOf = o => o && (o._fmUid ?? o.uid ?? o.id ?? null);
    res.yardUidsSample = cl.slice(0, 5).map(c => ({
      mark: String(c.item.mark || ''), uid: uidOf(c.item), tag: c.item.__tag || null }));
    res.unitUidsSample = units.slice(0, 5).map(u => ({
      mark: String(u.mark || ''), uid: uidOf(u), tag: u.__tag || null,
      srcTag: u._srcPackUnit ? u._srcPackUnit.__tag : null }));
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
