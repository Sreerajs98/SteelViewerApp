/* Hypothesis test for the rafter blow-out.
 *
 * stableBundleMm (what Pack V2 reserved) is measured by csShipPrepItem, which
 * builds the mesh with one set of makeShape flags. renderContainer rebuilds it
 * with different flags and then force-sets _groupByQuat. If the base poses
 * differ, the stored quaternion lands the mesh somewhere else entirely.
 *
 * Variants measured per assembly:
 *   cur     - exactly what renderContainer does today
 *   prepArgs- ship-prep makeShape flags, then the stored quat
 *   rePrep  - ship-prep flags, then re-run the ship-prep mesh pose on a clone
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
      return [
        +((b.max.x - b.min.x) / S).toFixed(0),
        +((b.max.z - b.min.z) / S).toFixed(0),
        +((b.max.y - b.min.y) / S).toFixed(0),
      ]; // L x W x H
    };
    const res = [];
    (assemblyGroups || []).forEach(g => (g.packUnits || []).forEach(pu => {
      if (String(pu.groupKind || '') !== 'welded_assembly' && !pu.isAssembly) return;
      if (res.length >= 8) return;
      const sb = pu.stableBundleMm || {};
      const rec = {
        mark: String(pu.mark || ''),
        reserved: [Math.round(+sb.l || 0), Math.round(+sb.w || 0), Math.round(+sb.h || 0)],
      };

      // --- cur: today's renderContainer assembly branch ---
      try {
        const shapeIt = {
          ...pu,
          lengthMm: pu._origLengthMm || pu.shippingLengthMm || pu.lengthMm,
          widthMm: pu._origWidthMm || pu.shippingWidthMm || pu.flangeWidthMm
            || pu.sectW || pu.unitWidth || pu.widthMm,
          heightMm: pu._origHeightMm || pu.shippingHeightMm || pu.sectH
            || pu.unitHeight || pu.heightMm,
          parts: pu.parts, isAssembly: true,
          _keepGroupByBundle: false, _skipStability: true,
          _freezeGroupByPose: true, assemblyShipPose: true,
        };
        const m = makeShape(shapeIt, 0x888888);
        applyGroupByFrozenQuat(m, pu);
        rec.cur = dims(m);
      } catch (e) { rec.curErr = e.message; }

      // --- prepArgs: ship-prep makeShape flags + stored quat ---
      const prepArgs = () => ({
        ...pu,
        lengthMm: pu.lengthMm || pu.l || 500,
        widthMm: pu.widthMm || pu.w || 200,
        heightMm: pu.heightMm || pu.h || 200,
        qty: pu.qty || 1,
        _yardStraighten: true,
        _keepGroupByBundle: false,
        assemblyShipPose: true,
        _skipStability: false,
      });
      try {
        const m = makeShape(prepArgs(), 0x888888);
        rec.prepRaw = dims(m);
        applyGroupByFrozenQuat(m, pu);
        rec.prepArgs = dims(m);
      } catch (e) { rec.prepErr = e.message; }

      // --- rePrep: ship-prep flags, then re-run the ship-prep pose itself ---
      try {
        const m = makeShape(prepArgs(), 0x888888);
        const scratch = { ...pu };           // keep the real unit's stamps intact
        delete scratch._shipPrepped;
        delete scratch._groupByQuat;
        csShipPrepMesh(m, scratch);
        rec.rePrep = dims(m);
      } catch (e) { rec.rePrepErr = e.message; }

      res.push(rec);
    }));
    return res;
  });

  const fmt = a => Array.isArray(a) ? a.join('x') : String(a);
  console.log('mark                       reserved(LxWxH)   cur              prepArgs         rePrep');
  out.forEach(r => console.log(
    `${r.mark.padEnd(26)} ${fmt(r.reserved).padEnd(17)} ${fmt(r.cur || r.curErr).padEnd(16)} `
    + `${fmt(r.prepArgs || r.prepErr).padEnd(16)} ${fmt(r.rePrep || r.rePrepErr)}`));
  fs.writeFileSync(__dirname + '/shots/posetest.json', JSON.stringify(out, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
