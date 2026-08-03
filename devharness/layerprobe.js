/* Verify layer-by-layer: stacks > 0, height used, fewer pure-floor leftovers. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5180;
const OUT = path.join(__dirname, 'out', `layerprobe-${PORT}`);
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 300000,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  page.on('dialog', async d => { try { await d.dismiss(); } catch (_) {} });
  await page.goto(`http://127.0.0.1:${PORT}/Viewer3D.html`,
    { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => rawScene && (rawScene.items || []).length > 0, { timeout: 90000 });
  await sleep(1000);
  await page.evaluate(() => { groupByShape(); });
  await sleep(6000);
  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g, i) => { g.checked = true; g.checkOrder = i + 1; });
  });
  const pack = await page.evaluate(() => {
    const r = runOptimizeKeepingLeftovers();
    return {
      toast: r && r.toast,
      placed: (r && r.placedItems || []).length,
      left: (r && r.leftoverItems || []).length,
      stacks: r && r.stackCount,
      strategy: r && r.layout && r.layout.packStrategy,
    };
  });
  await sleep(2500);

  const audit = await page.evaluate(() => {
    const sc = SCALE || 0.01;
    const H = +(rawScene.containerSpec && rawScene.containerSpec.heightMm) || 2690;
    let floorN = 0, stackN = 0, maxY = 0, pitched = 0, wall = 0;
    const yBuckets = { '0-300': 0, '300-800': 0, '800-1500': 0, '1500+': 0 };
    (clickable || []).forEach(c => {
      const mesh = c.mesh || c;
      const it = c.item || (mesh.userData && mesh.userData.item);
      if (!it || it.outsideContainer || c.outsideContainer) return;
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      const tip = csShipPrepTipGapMm(mesh);
      const minY = b.min.y / sc;
      const top = b.max.y / sc;
      maxY = Math.max(maxY, top);
      if (tip > 80) pitched++;
      if (top > H + 5) wall++;
      if (minY <= 40) floorN++; else stackN++;
      if (minY < 300) yBuckets['0-300']++;
      else if (minY < 800) yBuckets['300-800']++;
      else if (minY < 1500) yBuckets['800-1500']++;
      else yBuckets['1500+']++;
    });
    return {
      floorN, stackN, maxY: Math.round(maxY), heightUsedPct: Math.round(100 * maxY / H),
      pitched, wall, yBuckets, H,
    };
  });

  await page.evaluate(() => {
    (clickable || []).forEach(c => {
      const mesh = c.mesh || c;
      const it = c.item || (mesh.userData && mesh.userData.item);
      if (it && (it.outsideContainer || c.outsideContainer)) mesh.visible = false;
    });
    camera.position.set(-35, 40, 70);
    camera.lookAt(55, 8, 12);
    renderer.render(scene, camera);
  });
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, 'layers.png') });

  await page.evaluate(() => {
    camera.position.set(60, 12, 90);
    camera.lookAt(60, 8, 12);
    renderer.render(scene, camera);
  });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'side.png') });

  const out = { pack, audit, out: OUT };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
