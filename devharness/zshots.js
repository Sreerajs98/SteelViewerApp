/* Side-by-side proof for the Z-purlin nests: the same bundle framed end-on in
 * the Group By yard and again after Optimise seated it in the container. A nest
 * that fanned out on the way in is obvious at this angle.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5178;
const URL = `http://127.0.0.1:${PORT}/Viewer3D.html`;
const TAG = process.env.TAG || 'z';
const SHOTS = path.join(__dirname, 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader', '--window-size=1600,1000'],
    defaultViewport: { width: 1600, height: 1000 },
  });
  const page = await browser.newPage();
  page.on('dialog', async d => { await d.dismiss(); });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(1200);

  await page.evaluate(() => {
    // End-on down the length of the piece: the nest's cross-section, which is
    // where interlock spacing and any fanning shows.
    window.__frameEndOn = (meshes, fov) => {
      const box = new THREE.Box3();
      meshes.forEach(m => box.expandByObject(m));
      if (box.isEmpty()) return false;
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      const reach = Math.max(s.y, s.z) * 1.9 + s.x * 0.5 + 2;
      camera.fov = fov || 20;
      camera.near = 0.01;
      camera.far = 100000;
      camera.position.set(c.x - reach, c.y + reach * 0.18, c.z + reach * 0.05);
      camera.updateProjectionMatrix();
      camera.lookAt(c);
      if (typeof controls !== 'undefined' && controls) {
        controls.target.copy(c);
        controls.update();
      }
      return true;
    };
    window.__zMeshes = () => (clickable || [])
      .filter(c => c && c.mesh && c.item
        && String(c.item.groupKind || '') === 'nest_z'
        && !c.outsideContainer && !c.item.outsideContainer)
      .map(c => c.mesh);
  });

  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const yardOk = await page.evaluate(() => window.__frameEndOn(window.__zMeshes(), 16));
  await sleep(1000);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-1-groupby-zend.png`) });

  const info = await page.evaluate(() => {
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    return window.__zMeshes().map(m => {
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      return {
        l: +((b.max.x - b.min.x) / S).toFixed(0),
        w: +((b.max.z - b.min.z) / S).toFixed(0),
        h: +((b.max.y - b.min.y) / S).toFixed(0),
        pieces: m.children.length,
      };
    });
  });
  console.log('group by nests:', JSON.stringify(info));

  await page.evaluate(() => {
    const spec = (rawScene && rawScene.containerSpec)
      || { lengthMm: 12000, widthMm: 2350, heightMm: 2690 };
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    currentLayout = opt.layout;
    currentContainerIdx = 0;
    renderContainer(0);
  });
  await sleep(2500);

  const contInfo = await page.evaluate(() => {
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    return window.__zMeshes().map(m => {
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      return {
        l: +((b.max.x - b.min.x) / S).toFixed(0),
        w: +((b.max.z - b.min.z) / S).toFixed(0),
        h: +((b.max.y - b.min.y) / S).toFixed(0),
        pieces: m.children.length,
      };
    });
  });
  console.log('container nests:', JSON.stringify(contInfo));

  await page.evaluate(() => {
    (clickable || []).forEach(c => {
      if (c && c.mesh && (c.outsideContainer || (c.item && c.item.outsideContainer)))
        c.mesh.visible = false;
    });
  });
  await page.evaluate(() => window.__frameEndOn(window.__zMeshes(), 16));
  await sleep(1000);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-2-container-zend.png`) });

  console.log('yardFramed:', yardOk);
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
