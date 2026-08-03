/* Verify hybrid binpack bridge: rules loaded, sequential order, no float/overlap. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5180;
const OUT = path.join(__dirname, 'out', `binpack-${PORT}`);
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  page.on('console', m => {
    const t = m.text();
    if (/error|binpack|Optimise|Pack/i.test(t)) console.log('PAGE:', t);
  });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(800);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4000);

  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g, i) => {
      g.checked = i < 16;
      g.checkOrder = i < 16 ? (i + 1) : 0;
    });
    if (typeof refreshStagingPanel === 'function') refreshStagingPanel();
  });

  const boot = await page.evaluate(() => ({
    hasLib: !!(typeof BinPacking3D !== 'undefined' && BinPacking3D),
    hasBridge: typeof csBinPackPackHuman === 'function',
    available: typeof csBinPackAvailable === 'function' && csBinPackAvailable(),
    rules: typeof CS_BINPACK_RULES !== 'undefined' ? CS_BINPACK_RULES : null,
    ruleCount: typeof CS_BINPACK_RULES !== 'undefined'
      ? Object.keys(CS_BINPACK_RULES).length : 0,
  }));

  const packInfo = await page.evaluate(() => {
    try {
      const opt = runOptimizeKeepingLeftovers();
      const pack = opt && opt.layout && opt.layout.packV2;
      const placed = (pack && pack.placed) || [];
      return {
        toast: opt && opt.toast,
        strategy: pack && pack.strategy,
        engine: pack && pack.engine,
        placed: (opt && opt.placedItems || []).length,
        leftover: (opt && opt.leftoverItems || []).length,
        stackCount: pack && pack.stackCount,
        gapMm: pack && pack.gapMm,
        designOk: pack && pack.designOk,
        allFloorY0: pack && pack.allFloorY0,
        allNoOverlap: pack && pack.allNoOverlap,
        allStacksOnSupport: pack && pack.allStacksOnSupport,
        seats: placed.slice(0, 12).map(p => ({
          mark: p.mark,
          order: p.unit && p.unit._checkOrder,
          x: Math.round(p.x),
          z: Math.round(p.z),
          y: Math.round(p.y),
          pl: Math.round(p.pl),
          pw: Math.round(p.pw),
          ph: Math.round(p.ph),
          layer: p.layer,
          yaw: p.yawDeg,
        })),
      };
    } catch (e) {
      return { err: String(e && e.message || e) };
    }
  });
  await sleep(2000);

  const mesh = await page.evaluate(() => {
    const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const inside = [];
    let floatCount = 0;
    let wallBreach = 0;
    const L = +(rawScene.containerSpec && rawScene.containerSpec.lengthMm) || 12000;
    const W = +(rawScene.containerSpec && rawScene.containerSpec.widthMm) || 2350;
    const H = +(rawScene.containerSpec && rawScene.containerSpec.heightMm) || 2690;
    (clickable || []).forEach(c => {
      if (!c || !c.mesh || !c.item || c.outsideContainer) return;
      c.mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(c.mesh);
      if (!isFinite(b.min.x)) return;
      const minY = b.min.y / sc;
      const maxY = b.max.y / sc;
      const minX = b.min.x / sc;
      const maxX = b.max.x / sc;
      const minZ = b.min.z / sc;
      const maxZ = b.max.z / sc;
      if (minY > 8) floatCount++;
      if (minX < -5 || maxX > L + 5 || minZ < -5 || maxZ > W + 5 || maxY > H + 5)
        wallBreach++;
      inside.push({
        mark: c.item.mark,
        minY: Math.round(minY),
        h: Math.round(maxY - minY),
        w: Math.round(maxZ - minZ),
        l: Math.round(maxX - minX),
      });
    });
    return { inside: inside.length, floatCount, wallBreach, sample: inside.slice(0, 8) };
  });

  await page.screenshot({ path: path.join(OUT, 'top.png') });
  const report = { boot, packInfo, mesh, port: PORT, at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
