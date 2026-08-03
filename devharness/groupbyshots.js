/* Screenshots of the Group By yard: a Z-purlin nest end-on and a rafter,
 * so the staging view can be compared against the container view.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5178;
const TAG = process.env.TAG || 'yard';
const SHOTS = path.join(__dirname, 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader', '--window-size=1800,1100'],
    defaultViewport: { width: 1800, height: 1100 },
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

  await page.evaluate(() => {
    window.__S = () => (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    window.__frame = (objs, fovDeg, dir) => {
      const box = new THREE.Box3();
      objs.forEach(o => box.expandByObject(o));
      if (box.isEmpty()) return null;
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const span = Math.max(s.x, s.y, s.z);
      const dist = span / (2 * Math.tan(fovDeg * Math.PI / 360)) * 1.35 + span * 0.2;
      const d = dir.clone().normalize().multiplyScalar(dist);
      camera.fov = fovDeg;
      camera.near = 0.05;
      camera.far = 200000;
      camera.position.copy(c.clone().add(d));
      camera.updateProjectionMatrix();
      camera.lookAt(c);
      if (typeof controls !== 'undefined' && controls) {
        controls.target.copy(c); controls.update();
      }
      const S = window.__S();
      return {
        Lmm: Math.round(s.x / S), Hmm: Math.round(s.y / S), Wmm: Math.round(s.z / S),
      };
    };
  });

  const pick = async (label, filterSrc, dir, fov, count) => {
    const info = await page.evaluate((src, dx, dy, dz, fovDeg, n) => {
      // eslint-disable-next-line no-new-func
      const f = new Function('c', 'return (' + src + ')(c);');
      const hits = (clickable || []).filter(c => c && c.mesh && c.item && f(c));
      if (!hits.length) return { found: 0 };
      const objs = hits.slice(0, n).map(c => c.mesh);
      const dims = window.__frame(objs, fovDeg, new THREE.Vector3(dx, dy, dz));
      return {
        found: hits.length,
        marks: hits.slice(0, n).map(c => String(c.item.mark || '')),
        qty: hits.slice(0, n).map(c => c.item.qty || 1),
        dims,
      };
    }, filterSrc, dir[0], dir[1], dir[2], fov, count);
    await sleep(1000);
    await page.screenshot({ path: path.join(SHOTS, `${TAG}-${label}.png`) });
    console.log(label + ': ' + JSON.stringify(info));
  };

  const isZ = "c => String(c.item.groupKind||'')==='nest_z'"
    + " || String(c.item.shapeKey||'')==='z_channel'";
  const isAsm = "c => String(c.item.groupKind||'')==='welded_assembly'"
    + " || !!c.item.isAssembly || (c.item.parts && c.item.parts.length>1)";

  await pick('znest-endon', isZ, [-1, 0.12, 0.02], 3.5, 1);
  await pick('znest-iso', isZ, [-0.9, 0.55, 1], 9, 3);
  await pick('rafter-endon', isAsm, [-1, 0.12, 0.02], 3.5, 1);
  await pick('rafter-iso', isAsm, [-0.9, 0.5, 1], 9, 2);

  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
