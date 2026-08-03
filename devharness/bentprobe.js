/* Why a bundle_bent is drawn differently in the container than in the yard. */
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
    const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const dim = (m) => {
      if (!m) return null;
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      if (!isFinite(b.min.x)) return null;
      return {
        l: Math.round((b.max.x - b.min.x) / sc),
        w: Math.round((b.max.z - b.min.z) / sc),
        h: Math.round((b.max.y - b.min.y) / sc),
      };
    };
    const res = [];
    (assemblyGroups || []).forEach(g => {
      (g.packUnits || []).forEach(u => {
        if (String(u.groupKind || '') !== 'bundle_bent') return;
        if (res.length >= 2) return;
        res.push({
          mark: u.mark,
          groupKind: u.groupKind,
          shapeKey: u.shapeKey,
          qty: u.qty,
          declared: { l: u.lengthMm, w: u.widthMm, h: u.heightMm },
          packFoot: { l: u.packFootprintL, w: u.packFootprintW, h: u.packFootprintH },
          stableBundleMm: u.stableBundleMm || null,
          shipPrepDims: u._shipPrepDimsMm || null,
          hasQuat: !!u._groupByQuat,
          shipPrepped: !!u._shipPrepped,
          plainMesh: dim(makeShape({ ...u }, 0x888888, 1)),
          posedMesh: (typeof csShipPrepPosedMesh === 'function')
            ? dim(csShipPrepPosedMesh({ ...u }, 0x888888, 1)) : null,
        });
      });
    });
    return res;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
