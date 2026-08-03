/* Verify deterministic 2.5D: strategy, zero float floor, twin spine, no settle. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5180;
const OUT = path.join(__dirname, 'out', `pack25d-${PORT}`);
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
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(600);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);
  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g, i) => {
      g.checked = true;
      g.checkOrder = i + 1;
    });
  });

  const packInfo = await page.evaluate(() => {
    const opt = runOptimizeKeepingLeftovers();
    const pack = opt && opt.layout && opt.layout.packV2;
    const seats = (pack && pack.placed) || [];
    let floorFloat = 0;
    let stackFloat = 0;
    let yaw90Asm = 0;
    seats.forEach(s => {
      if (!s) return;
      const stack = s.layer === 'stack' || s.role === 'nest_stack';
      if (stack) {
        if (Math.abs(+s.y - (+s.supportTopY || +s.y)) > 1) stackFloat++;
      } else if (+s.y > 0.5 || (s.box && +s.box.minY > 0.5)) {
        floorFloat++;
      }
      if (s.unit && (s.unit.isAssembly || /assembly/i.test(String(s.unit.groupKind || '')))
          && Math.abs(Math.abs(+s.yawDeg || 0) - 90) < 1) {
        yaw90Asm++;
      }
    });
    return {
      has25d: typeof csPack25dPack === 'function',
      rules: typeof CS25D_RULES !== 'undefined' ? Object.keys(CS25D_RULES).length : 0,
      strategy: pack && pack.strategy,
      layoutStrat: opt && opt.layout && opt.layout.packStrategy,
      placed: (opt && opt.placedItems || []).length,
      leftover: (opt && opt.leftoverItems || []).length,
      stacks: pack && pack.stackCount,
      spine: pack && pack.twinPlacedCount,
      designOk: pack && pack.designOk,
      allFloorY0: pack && pack.allFloorY0,
      allNoOverlap: pack && pack.allNoOverlap,
      allStacksOnSupport: pack && pack.allStacksOnSupport,
      floorFloat, stackFloat, yaw90Asm,
      toast: opt && opt.toast,
      sample: seats.slice(0, 8).map(s => ({
        mark: s.mark, role: s.role, y: Math.round(+s.y || 0),
        yaw: s.yawDeg, pl: Math.round(+s.pl || 0), pw: Math.round(+s.pw || 0),
      })),
    };
  });
  await sleep(2000);

  const mesh = await page.evaluate(() => {
    const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    let inside = 0;
    let floorFloatMesh = 0;
    let tipHeavy = 0;
    (clickable || []).forEach(c => {
      if (!c || !c.mesh || !c.item || c.outsideContainer) return;
      inside++;
      c.mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(c.mesh);
      const minY = b.min.y / sc;
      const isStack = c.item.packLayer === 'stack' || c.item.role === 'nest_stack'
        || (c.item._packV2FootYMm != null && +c.item._packV2FootYMm > 8);
      if (!isStack && minY > 8) floorFloatMesh++;
      const tip = typeof csShipPrepTipGapMm === 'function'
        ? csShipPrepTipGapMm(c.mesh) : 0;
      if (tip > 200) tipHeavy++;
    });
    return { inside, floorFloatMesh, tipHeavy };
  });

  await page.evaluate(() => {
    try {
      camera.position.set(-30, 55, 90);
      camera.lookAt(55, 10, 12);
      renderer.render(scene, camera);
    } catch (_) { /* */ }
  });
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'overview.png') });

  const report = { packInfo, mesh, port: PORT, at: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
