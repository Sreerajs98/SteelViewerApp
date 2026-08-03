/* Optimise A1321, hide leftovers, screenshot inside-only + tip audit. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5180;
const OUT = path.join(__dirname, 'out', `insideview-${PORT}`);
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    protocolTimeout: 300000,
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
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 90000 });
  await sleep(1000);
  await page.evaluate(() => { groupByShape(); });
  await sleep(6000);
  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g, i) => { g.checked = true; g.checkOrder = i + 1; });
  });
  const pack = await page.evaluate(() => {
    const r = runOptimizeKeepingLeftovers();
    return { placed: (r.placedItems || []).length, left: (r.leftoverItems || []).length, toast: r.toast };
  });
  await sleep(3000);

  const audit = await page.evaluate(() => {
    const sc = SCALE || 0.01;
    let inN = 0, outN = 0, pitchIn = 0, pitchOut = 0;
    const worstIn = [], worstOut = [];
    (clickable || []).forEach(c => {
      const mesh = c.mesh || c;
      const it = c.item || (mesh.userData && mesh.userData.item);
      if (!it) return;
      const outside = !!(it.outsideContainer || c.outsideContainer);
      mesh.updateMatrixWorld(true);
      const tip = csShipPrepTipGapMm(mesh);
      const b = new THREE.Box3().setFromObject(mesh);
      const h = (b.max.y - b.min.y) / sc;
      const row = { mark: it.mark, tip: Math.round(tip), h: Math.round(h), maxY: Math.round(b.max.y / sc) };
      if (outside) {
        outN++;
        if (tip > 80) { pitchOut++; worstOut.push(row); }
      } else {
        inN++;
        if (tip > 80) { pitchIn++; worstIn.push(row); }
      }
    });
    worstIn.sort((a, b) => b.tip - a.tip);
    worstOut.sort((a, b) => b.tip - a.tip);
    return {
      inN, outN, pitchIn, pitchOut,
      worstIn: worstIn.slice(0, 8),
      worstOut: worstOut.slice(0, 8),
    };
  });

  // Hide leftovers — show only what is packed in the box
  await page.evaluate(() => {
    (clickable || []).forEach(c => {
      const mesh = c.mesh || c;
      const it = c.item || (mesh.userData && mesh.userData.item);
      if (it && (it.outsideContainer || c.outsideContainer)) mesh.visible = false;
    });
    camera.position.set(-25, 45, 80);
    camera.lookAt(55, 6, 12);
    renderer.render(scene, camera);
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT, 'inside-overview.png') });

  await page.evaluate(() => {
    camera.position.set(55, 16, 90);
    camera.lookAt(55, 5, 12);
    renderer.render(scene, camera);
  });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'inside-side.png') });

  // Show leftovers too (should now be flat)
  await page.evaluate(() => {
    (clickable || []).forEach(c => {
      const mesh = c.mesh || c;
      mesh.visible = true;
    });
    camera.position.set(-40, 60, 100);
    camera.lookAt(40, 5, 20);
    renderer.render(scene, camera);
  });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, 'with-leftovers.png') });

  const summary = { pack, audit, out: OUT };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
