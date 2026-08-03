/* Why do welded assemblies render bigger than the footprint Pack V2 reserved?
 * Dumps the ship-prep pose data per assembly pack unit and measures the mesh
 * with and without the stored Group-By quaternion applied.
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
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const dims = (mesh) => {
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      return {
        l: +((b.max.x - b.min.x) / S).toFixed(0),
        h: +((b.max.y - b.min.y) / S).toFixed(0),
        w: +((b.max.z - b.min.z) / S).toFixed(0),
      };
    };
    const asm = [];
    (assemblyGroups || []).forEach(g => (g.packUnits || []).forEach(pu => {
      if (String(pu.groupKind || '') !== 'welded_assembly' && !pu.isAssembly) return;
      if (asm.length >= 6) return;
      const rec = {
        mark: String(pu.mark || ''),
        groupKind: pu.groupKind,
        lengthMm: Math.round(+pu.lengthMm || 0),
        widthMm: Math.round(+pu.widthMm || 0),
        heightMm: Math.round(+pu.heightMm || 0),
        sectW: Math.round(+pu.sectW || 0),
        sectH: Math.round(+pu.sectH || 0),
        origL: pu._origLengthMm, origW: pu._origWidthMm, origH: pu._origHeightMm,
        partsLen: (pu.parts && pu.parts.length) || 0,
        stableBundleMm: pu.stableBundleMm
          ? { l: Math.round(+pu.stableBundleMm.l || 0), w: Math.round(+pu.stableBundleMm.w || 0),
            h: Math.round(+pu.stableBundleMm.h || 0), source: pu.stableBundleMm.source }
          : null,
        bundle_bbox: pu.bundle_bbox
          ? { l: Math.round(+pu.bundle_bbox.l || 0), w: Math.round(+pu.bundle_bbox.w || 0),
            h: Math.round(+pu.bundle_bbox.h || 0), source: pu.bundle_bbox.source }
          : null,
        hasGroupByQuat: !!(pu._groupByQuat && pu._groupByQuat.w != null),
        groupByQuat: pu._groupByQuat
          ? Object.keys(pu._groupByQuat).map(k => k + ':' + (+pu._groupByQuat[k]).toFixed(3)).join(' ')
          : null,
        shipPrepped: !!pu._shipPrepped,
        needsShipPrep: !!pu.needs_ship_prep,
        freezePose: !!pu._freezeGroupByPose,
        yardStraighten: !!pu._yardStraighten,
      };

      // Rebuild the mesh exactly the way renderContainer does for assemblies
      try {
        const shapeIt = {
          ...pu,
          lengthMm: pu._origLengthMm || pu.shippingLengthMm || pu.lengthMm,
          widthMm: pu._origWidthMm || pu.shippingWidthMm || pu.flangeWidthMm
            || pu.sectW || pu.unitWidth || pu.widthMm,
          heightMm: pu._origHeightMm || pu.shippingHeightMm || pu.sectH
            || pu.unitHeight || pu.heightMm,
          parts: pu.parts,
          isAssembly: true,
          _keepGroupByBundle: false,
          _skipStability: true,
          _freezeGroupByPose: true,
          assemblyShipPose: true,
        };
        const m1 = makeShape(shapeIt, 0x888888);
        rec.meshRaw = dims(m1);
        const m2 = makeShape(shapeIt, 0x888888);
        if (typeof applyGroupByFrozenQuat === 'function') applyGroupByFrozenQuat(m2, pu);
        rec.meshWithQuat = dims(m2);
      } catch (e) { rec.meshErr = e.message; }
      asm.push(rec);
    }));
    return asm;
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
