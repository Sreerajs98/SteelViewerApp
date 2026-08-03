/* Run the same flow a human does on localhost, then list real issues. */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5180;
const OUT = path.join(__dirname, 'out', `userissues-${PORT}`);
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

  // Fresh page like the user — check upload UI first
  const ui = await page.evaluate(() => ({
    hasTopUpload: !!document.getElementById('btnUploadTop')
      || !!document.querySelector('#fileInput'),
    hasStagingUpload: !!document.getElementById('fileInputStaging')
      || !!document.getElementById('localLoadBar'),
    hasDemoA1321: !!(document.getElementById('localLoadBar')
      && /A1321/i.test(document.getElementById('localLoadBar').innerText || '')),
    dropZoneHidden: !!(document.getElementById('dropZone')
      && document.getElementById('dropZone').classList.contains('hidden')),
    jobLabel: (document.getElementById('jobLabel') || {}).textContent || '',
  }));
  await page.screenshot({ path: path.join(OUT, '01-fresh.png') });

  // Load demo (same as user clicking A1321 / default scene)
  await page.evaluate(async () => {
    if (typeof loadSceneFromUrl === 'function')
      await loadSceneFromUrl('/scene.json');
  });
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 90000 });
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, '02-loaded.png') });

  await page.evaluate(() => { groupByShape(); });
  await sleep(6500);
  await page.screenshot({ path: path.join(OUT, '03-groupby.png') });

  // Select all + Optimise (user flow)
  await page.evaluate(() => {
    (assemblyGroups || []).forEach((g, i) => {
      g.checked = true;
      g.checkOrder = i + 1;
    });
    if (typeof renderStagingList === 'function') renderStagingList();
  });
  const pack = await page.evaluate(() => {
    const r = runOptimizeKeepingLeftovers();
    return {
      toast: r && r.toast,
      placed: (r && r.placedItems || []).length,
      leftover: (r && r.leftoverItems || []).length,
      stacks: r && r.stackCount,
    };
  });
  await sleep(3000);

  const audit = await page.evaluate(() => {
    const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const W = +(rawScene && rawScene.containerSpec && rawScene.containerSpec.widthMm) || 2350;
    const H = +(rawScene && rawScene.containerSpec && rawScene.containerSpec.heightMm) || 2690;
    const L = +(rawScene && rawScene.containerSpec && rawScene.containerSpec.lengthMm) || 12000;

    let inN = 0, outN = 0;
    let pitchedIn = 0, pitchedOut = 0, floatIn = 0, wallIn = 0, overlapSuspect = 0;
    const worstIn = [], worstOut = [], wallList = [], floatList = [];
    const boxes = [];

    (clickable || []).forEach(c => {
      const mesh = c.mesh || c;
      const it = c.item || (mesh.userData && mesh.userData.item);
      if (!it) return;
      const outside = !!(it.outsideContainer || c.outsideContainer);
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      if (!isFinite(b.min.x)) return;
      const tip = (typeof csShipPrepTipGapMm === 'function') ? csShipPrepTipGapMm(mesh) : 0;
      const l = (b.max.x - b.min.x) / sc;
      const w = (b.max.z - b.min.z) / sc;
      const h = (b.max.y - b.min.y) / sc;
      const minY = b.min.y / sc;
      const maxY = b.max.y / sc;
      const minX = b.min.x / sc, maxX = b.max.x / sc;
      const minZ = b.min.z / sc, maxZ = b.max.z / sc;
      const row = {
        mark: String(it.mark || '?').slice(0, 40),
        tip: Math.round(tip), h: Math.round(h), w: Math.round(w), l: Math.round(l),
        minY: Math.round(minY), maxY: Math.round(maxY),
      };
      if (outside) {
        outN++;
        if (tip > 80) { pitchedOut++; worstOut.push(row); }
      } else {
        inN++;
        boxes.push({ ...row, minX, maxX, minZ, maxZ, minY, maxY });
        if (tip > 80) { pitchedIn++; worstIn.push(row); }
        // Floating: not on floor and not clearly stacked on something
        if (minY > 40 && !(it._packV2FootYMm > 20)) {
          floatIn++; floatList.push(row);
        }
        if (maxY > H + 5 || maxX > L + 5 || maxZ > W + 5 || minX < -5 || minZ < -5) {
          wallIn++; wallList.push({ ...row, maxY: Math.round(maxY), maxZ: Math.round(maxZ) });
        }
      }
    });

    // crude AABB overlap among inside pieces
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        if (ox > 30 && oy > 30 && oz > 30) overlapSuspect++;
      }
    }

    worstIn.sort((a, b) => b.tip - a.tip);
    worstOut.sort((a, b) => b.tip - a.tip);

    // Staging UI numbers
    const stagingText = (document.getElementById('stagingStats')
      || document.getElementById('stagingFooter') || {}).innerText || '';
    const groups = (assemblyGroups || []).length;
    const checked = (assemblyGroups || []).filter(g => g.checked).length;
    const placedGroups = (assemblyGroups || []).filter(g =>
      /placed|floor|c1|container/i.test(String(g.state || ''))
      || g.placed || g.inContainer).length;

    // RF tips after group (ship prep quality)
    const rfTips = (assemblyGroups || [])
      .filter(g => /^RF/i.test(String(g.mark || '')))
      .map(g => {
        const pu = g.packUnits && g.packUnits[0];
        const sb = pu && pu.stableBundleMm;
        return {
          mark: String(g.mark || '').split('·')[0].trim(),
          tip: pu ? Math.round(+pu.tipGapMm || 0) : null,
          w: sb ? Math.round(+sb.w || 0) : null,
          h: sb ? Math.round(+sb.h || 0) : null,
          overW: sb ? (+sb.w > W + 1) : null,
        };
      });
    const rfOverWidth = rfTips.filter(r => r.overW);
    const rfPitchedPrep = rfTips.filter(r => r.tip != null && r.tip > 80);

    return {
      container: { L, W, H },
      groups, checked, placedGroups, stagingText: stagingText.slice(0, 240),
      inN, outN, pitchedIn, pitchedOut, floatIn, wallIn, overlapSuspect,
      worstIn: worstIn.slice(0, 8),
      worstOut: worstOut.slice(0, 8),
      wallList: wallList.slice(0, 8),
      floatList: floatList.slice(0, 8),
      rfCount: rfTips.length,
      rfOverWidth: rfOverWidth.slice(0, 10),
      rfPitchedPrep: rfPitchedPrep.slice(0, 10),
      jobLabel: (document.getElementById('jobLabel') || {}).textContent || '',
    };
  });

  // Screenshots: with leftovers, then inside-only
  await page.evaluate(() => {
    camera.position.set(-30, 55, 90);
    camera.lookAt(55, 10, 12);
    renderer.render(scene, camera);
  });
  await sleep(350);
  await page.screenshot({ path: path.join(OUT, '04-optimise-overview.png') });

  await page.evaluate(() => {
    camera.position.set(55, 18, 95);
    camera.lookAt(55, 6, 12);
    renderer.render(scene, camera);
  });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, '05-optimise-side.png') });

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
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, '06-inside-only.png') });

  // Build human issue list
  const issues = [];
  if (!ui.hasStagingUpload && !ui.hasTopUpload)
    issues.push({ sev: 'high', id: 'no-upload', msg: 'Upload / Load button not found in UI' });
  if (audit.pitchedIn > 0)
    issues.push({
      sev: 'high', id: 'pitch-inside',
      msg: `${audit.pitchedIn} pieces INSIDE container still pitched/tilted (tip > 80 mm)`,
      samples: audit.worstIn,
    });
  if (audit.pitchedOut > 0)
    issues.push({
      sev: 'med', id: 'pitch-leftover',
      msg: `${audit.pitchedOut} leftover pieces outside still look pitched — confuses the view`,
      samples: audit.worstOut,
    });
  if (audit.floatIn > 0)
    issues.push({
      sev: 'high', id: 'float',
      msg: `${audit.floatIn} pieces floating above floor without a clear stack foot`,
      samples: audit.floatList,
    });
  if (audit.wallIn > 0)
    issues.push({
      sev: 'high', id: 'wall',
      msg: `${audit.wallIn} pieces breach container walls/height`,
      samples: audit.wallList,
    });
  if (audit.overlapSuspect > 0)
    issues.push({
      sev: 'high', id: 'overlap',
      msg: `~${audit.overlapSuspect} AABB overlap pairs — pieces may intersect`,
    });
  if (audit.rfOverWidth.length)
    issues.push({
      sev: 'med', id: 'overwidth-flat',
      msg: `${audit.rfOverWidth.length} rafters are FLAT but wider than container (cannot enter as AABB) — become leftovers`,
      samples: audit.rfOverWidth,
    });
  if (pack.leftover > pack.placed)
    issues.push({
      sev: 'med', id: 'many-left',
      msg: `More leftovers than placed (${pack.leftover} out vs ${pack.placed} in) — load looks sparse / incomplete`,
    });
  if (audit.outN > 0 && audit.inN > 0)
    issues.push({
      sev: 'low', id: 'leftover-clutter',
      msg: `${audit.outN} leftovers drawn beside the box — easy to mistake for bad packing inside`,
    });
  // Density / human order qualitative
  issues.push({
    sev: 'med', id: 'sparse-floor',
    msg: 'Floor use looks sparse vs weight% — many NO_SLOT / OUTSIDE_RECT failures even with empty-looking floor',
  });
  issues.push({
    sev: 'med', id: 'cog',
    msg: 'Centre of Gravity often far off-centre (load piled to one side)',
  });

  const report = {
    port: PORT,
    ui,
    pack,
    audit: {
      jobLabel: audit.jobLabel,
      container: audit.container,
      groups: audit.groups,
      inN: audit.inN,
      outN: audit.outN,
      pitchedIn: audit.pitchedIn,
      pitchedOut: audit.pitchedOut,
      floatIn: audit.floatIn,
      wallIn: audit.wallIn,
      overlapSuspect: audit.overlapSuspect,
      rfCount: audit.rfCount,
      rfOverWidthCount: audit.rfOverWidth.length,
      rfPitchedPrepCount: audit.rfPitchedPrep.length,
      stagingText: audit.stagingText,
      worstIn: audit.worstIn,
      worstOut: audit.worstOut,
      rfOverWidth: audit.rfOverWidth,
    },
    issues,
    out: OUT,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
