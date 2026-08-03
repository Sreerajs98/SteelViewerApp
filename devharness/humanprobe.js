/* Capture what's wrong with the current Optimise load:
 *  - mesh pitch (degrees off horizontal)
 *  - float gap under each mesh
 *  - placement order vs checkOrder
 *  - screenshots: top + side
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5178;
const OUT = path.join(__dirname, 'out', `human-${PORT}`);
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
  await sleep(1000);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  // Check first 8 staging groups so Optimise uses a real 1..N order
  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g, i) => {
      g.checked = i < 12;
      g.checkOrder = i < 12 ? (i + 1) : 0;
    });
    if (typeof refreshStagingPanel === 'function') refreshStagingPanel();
  });

  const packInfo = await page.evaluate(() => {
    try {
      if (typeof runOptimizeKeepingLeftovers === 'function') {
        const opt = runOptimizeKeepingLeftovers();
        return {
          placed: (opt && opt.placedItems || []).length,
          toast: opt && opt.toast,
          weightPct: opt && opt.layout && opt.layout.containers
            && opt.layout.containers[0]
            && opt.layout.containers[0].weightUtilizationPct,
        };
      }
    } catch (e) {
      return { err: String(e && e.message || e) };
    }
    return { err: 'no runOptimizeKeepingLeftovers' };
  });
  await sleep(2500);

  const report = await page.evaluate(() => {
    const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const items = [];
    const meshes = (typeof clickable !== 'undefined' && clickable) ? clickable : [];
    meshes.forEach((entry, i) => {
      const mesh = entry.mesh || entry;
      const it = entry.item || entry.userData && entry.userData.item || mesh.userData;
      if (!mesh || !it || it.outsideContainer) return;
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      if (!isFinite(b.min.x)) return;
      const l = (b.max.x - b.min.x) / sc;
      const w = (b.max.z - b.min.z) / sc;
      const h = (b.max.y - b.min.y) / sc;
      const minY = b.min.y / sc;
      // Pitch = tip gap along the length: sample bottom Y at ends.
      let yLo = Infinity, yHi = -Infinity, tipGap = 0;
      const v = new THREE.Vector3();
      mesh.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes && o.geometry.attributes.position;
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / 60));
        for (let k = 0; k < pos.count; k += step) {
          v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          if (v.y < yLo) yLo = v.y;
          if (v.y > yHi) yHi = v.y;
        }
      });
      // tipGapMm via bins along longest horizontal axis
      const alongX = l >= w;
      const bins = new Array(8).fill(Infinity);
      mesh.traverse(o => {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes && o.geometry.attributes.position;
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / 60));
        for (let k = 0; k < pos.count; k += step) {
          v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
          const t = alongX
            ? (v.x - b.min.x) / Math.max(b.max.x - b.min.x, 1e-9)
            : (v.z - b.min.z) / Math.max(b.max.z - b.min.z, 1e-9);
          const bi = Math.min(7, Math.max(0, Math.floor(t * 8)));
          if (v.y < bins[bi]) bins[bi] = v.y;
        }
      });
      const finite = bins.filter(x => isFinite(x));
      if (finite.length >= 2) {
        tipGap = (Math.max(...finite) - Math.min(...finite)) / sc;
      }
      const tiltDeg = alongX
        ? Math.atan2(tipGap, Math.max(l, 1)) * 180 / Math.PI
        : Math.atan2(tipGap, Math.max(w, 1)) * 180 / Math.PI;
      items.push({
        mark: it.mark,
        gk: it.groupKind,
        role: it.role || it.packRole,
        checkOrder: it._checkOrder || it.checkOrder || null,
        minY: Math.round(minY),
        h: Math.round(h),
        l: Math.round(l),
        w: Math.round(w),
        tipGapMm: Math.round(tipGap),
        tiltDeg: +tiltDeg.toFixed(1),
        // Stacks sit above the floor on purpose — only floor pieces float.
        float: minY > 5 && !(it.role === 'nest_stack' || it.packLayer === 'stack'
          || it.layer === 'stack'),
        pitched: tipGap > 40 || tiltDeg > 8,
      });
    });
    items.sort((a, b) => (b.tiltDeg - a.tiltDeg) || (b.minY - a.minY));
    return {
      n: items.length,
      floatN: items.filter(x => x.float).length,
      pitchedN: items.filter(x => x.pitched).length,
      worstTilt: items.slice(0, 8),
      worstFloat: items.filter(x => x.float).slice(0, 8),
      orderSample: items.slice().sort((a, b) =>
        (+a.checkOrder || 99) - (+b.checkOrder || 99)).slice(0, 12)
        .map(x => `${x.checkOrder}:${x.mark}`),
    };
  });

  // Screenshots
  await page.evaluate(() => {
    if (typeof camera === 'undefined' || !camera) return;
    // Top-down
    camera.position.set(60, 180, 20);
    camera.lookAt(60, 0, 12);
    camera.updateProjectionMatrix();
    if (typeof renderer !== 'undefined' && renderer && typeof scene !== 'undefined')
      renderer.render(scene, camera);
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'top.png') });

  await page.evaluate(() => {
    if (typeof camera === 'undefined' || !camera) return;
    camera.position.set(-40, 40, 30);
    camera.lookAt(60, 10, 12);
    camera.updateProjectionMatrix();
    if (typeof renderer !== 'undefined' && renderer && typeof scene !== 'undefined')
      renderer.render(scene, camera);
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'side.png') });

  console.log('pack:', JSON.stringify(packInfo));
  console.log('report:', JSON.stringify(report, null, 2));
  console.log('shots:', OUT);
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
