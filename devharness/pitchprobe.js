/* Why RF012 stays pitched after ship prep. */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5180;
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
  await sleep(800);
  await page.evaluate(() => { groupByShape(); });
  await sleep(6000);

  const out = await page.evaluate(() => {
    const g = (assemblyGroups || []).find(x => /^RF012/i.test(String(x.mark || '')));
    if (!g) return { err: 'no RF012', marks: (assemblyGroups || []).slice(0, 5).map(x => x.mark) };
    const pu = (g.packUnits || [])[0];
    if (!pu) return { err: 'no pu' };

    // Clear cache and re-run ship prep with step logging
    delete pu._groupByQuat;
    pu._freezeGroupByPose = false;
    pu._shipPrepped = false;
    delete pu.stableBundleMm;

    const steps = [];
    const sc = SCALE || 0.01;
    const snap = (tag, mesh) => {
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      steps.push({
        tag,
        tip: Math.round(csShipPrepTipGapMm(mesh)),
        l: Math.round((b.max.x - b.min.x) / sc),
        w: Math.round((b.max.z - b.min.z) / sc),
        h: Math.round((b.max.y - b.min.y) / sc),
        minY: +((b.min.y / sc).toFixed(1)),
      });
    };

    const mesh = makeShape({
      ...pu,
      _yardStraighten: true,
      assemblyShipPose: true,
      _keepGroupByBundle: false,
      _skipStability: true,
      _freezeGroupByPose: false,
    }, 0x3388ff, 1);
    if (!mesh) return { err: 'no mesh', steps };
    snap('after_makeShape', mesh);

    const keepX = mesh.position.x, keepZ = mesh.position.z;
    if (typeof straightenYardItemOnGround === 'function') {
      straightenYardItemOnGround(mesh, pu);
      snap('after_straighten', mesh);
    }
    let tip = csShipPrepTipLevel(mesh, keepX, keepZ);
    snap('after_tipLevel', mesh);
    let tipGap = tip.tipGapMm;
    if (tipGap > 25) {
      tipGap = csShipPrepForceFlat(mesh, keepX, keepZ, tipGap);
      snap('after_forceFlat', mesh);
    }
    const solid = csShipPrepPreferSolidBase(mesh, keepX, keepZ);
    snap('after_solidBase', mesh);

    // Full pipeline
    delete pu._groupByQuat;
    pu._shipPrepped = false;
    const prep = csShipPrepItem(pu);
    const posed = csShipPrepPosedMesh(pu, 0xff8800, 1);
    let posedSnap = null;
    if (posed) {
      posed.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(posed);
      posedSnap = {
        tip: Math.round(csShipPrepTipGapMm(posed)),
        l: Math.round((b.max.x - b.min.x) / sc),
        w: Math.round((b.max.z - b.min.z) / sc),
        h: Math.round((b.max.y - b.min.y) / sc),
      };
    }

    return {
      mark: g.mark,
      parts: (pu.parts || []).length,
      steps,
      solid,
      prep,
      sb: pu.stableBundleMm,
      tipMm: pu.tipGapMm,
      method: pu._shipPrepMethod,
      posedSnap,
      dims: pu._shipPrepDimsMm,
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
