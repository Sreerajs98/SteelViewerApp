/* Ad-hoc probe: loads scene + Group By, then dumps what is actually in the
 * rendered yard so the camera can be aimed and geometry inspected.
 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5178;
const URL = `http://127.0.0.1:${PORT}/Viewer3D.html`;
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader', '--window-size=1800,1100'],
    defaultViewport: { width: 1800, height: 1100 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('dialog', async d => { console.log('[dialog]', d.message()); await d.dismiss(); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(1200);
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const dump = await page.evaluate(() => {
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const list = (typeof clickable !== 'undefined' && clickable) ? clickable : [];
    const kinds = {};
    list.forEach(c => {
      const k = String(c?.item?.groupKind || c?.item?.shapeKey || 'none');
      kinds[k] = (kinds[k] || 0) + 1;
    });
    const zs = list.filter(c => c && c.mesh && c.item
      && (String(c.item.groupKind || '') === 'nest_z'
        || String(c.item.shapeKey || '') === 'z_channel'));
    const rows = zs.slice(0, 8).map(c => {
      c.mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(c.mesh);
      return {
        mark: String(c.item.mark || ''),
        qty: c.item.qty,
        children: c.mesh.children.length,
        Lmm: Math.round((b.max.x - b.min.x) / S),
        Hmm: Math.round((b.max.y - b.min.y) / S),
        Wmm: Math.round((b.max.z - b.min.z) / S),
        pos: [Math.round(c.mesh.position.x), Math.round(c.mesh.position.y),
          Math.round(c.mesh.position.z)],
      };
    });
    return {
      clickableCount: list.length,
      kinds,
      zCount: zs.length,
      rows,
      cameraPos: (typeof camera !== 'undefined' && camera)
        ? [camera.position.x, camera.position.y, camera.position.z] : null,
      hasControls: typeof controls !== 'undefined' && !!controls,
    };
  });
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
