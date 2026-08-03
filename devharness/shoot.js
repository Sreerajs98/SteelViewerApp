/* Headless capture of the viewer UI.
 *
 * Drives the same entry points the WinForms host calls (groupByShape,
 * csPackV2BuildUnits + csPackV2RunOptimise + renderContainer) and writes
 * PNGs to devharness/shots so the rendering can be inspected.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5178;
const URL = `http://127.0.0.1:${PORT}/Viewer3D.html`;
const SHOTS = path.join(__dirname, 'shots');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

function findBrowser() {
  const hit = CHROME_CANDIDATES.find(p => fs.existsSync(p));
  if (!hit) throw new Error('No Chrome/Edge binary found');
  return hit;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--window-size=1800,1100',
    ],
    defaultViewport: { width: 1800, height: 1100 },
  });

  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', r =>
    logs.push(`[reqfail] ${r.url()} — ${r.failure()?.errorText}`));
  page.on('dialog', async d => { logs.push(`[dialog] ${d.message()}`); await d.dismiss(); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

  const libs = await page.evaluate(() => ({
    three: typeof THREE !== 'undefined',
    orbit: typeof THREE !== 'undefined' && !!THREE.OrbitControls,
    groupByShape: typeof groupByShape === 'function',
    runOptimise: typeof csPackV2RunOptimise === 'function',
    buildUnits: typeof csPackV2BuildUnits === 'function',
    renderContainer: typeof renderContainer === 'function',
  }));
  console.log('libs:', JSON.stringify(libs));
  if (!libs.three) {
    console.log('LOGS:\n' + logs.join('\n'));
    throw new Error('THREE.js failed to load');
  }

  // ---- Load scene (same JSON the C# host pushes) ----
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(1500);
  const sceneInfo = await page.evaluate(() => ({
    items: rawScene.items.length,
    container: rawScene.containerSpec,
  }));
  console.log('scene:', JSON.stringify(sceneInfo));
  await page.screenshot({ path: path.join(SHOTS, '01-loaded.png') });

  // ---- Group By ----
  await page.evaluate(() => { groupByShape(); });
  await sleep(4000);
  const groupInfo = await page.evaluate(() => ({
    groups: (typeof assemblyGroups !== 'undefined' ? assemblyGroups : []).length,
    zNest: (typeof assemblyGroups !== 'undefined' ? assemblyGroups : [])
      .filter(g => String(g.groupKind || '') === 'nest_z')
      .map(g => ({
        mark: g.mark,
        qty: g.qty,
        units: (g.packUnits || []).map(pu => ({
          mark: pu.mark,
          qty: pu.qty,
          w: Math.round(+((pu.stableBundleMm && pu.stableBundleMm.w) || pu.packWidthMm || 0)),
          h: Math.round(+((pu.stableBundleMm && pu.stableBundleMm.h) || pu.packHeightMm || 0)),
        })),
      })).slice(0, 4),
  }));
  console.log('groupBy:', JSON.stringify(groupInfo, null, 2));
  await page.screenshot({ path: path.join(SHOTS, '02-groupby.png') });

  // Close-up on the Z-purlin nests in the yard
  await page.evaluate(() => {
    const zs = (typeof clickable !== 'undefined' ? clickable : [])
      .filter(c => c && c.item && String(c.item.groupKind || '') === 'nest_z' && c.mesh);
    if (!zs.length || typeof camera === 'undefined') return null;
    const box = new THREE.Box3();
    zs.slice(0, 3).forEach(c => box.expandByObject(c.mesh));
    const c0 = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z) * 0.9 + 8;
    camera.position.set(c0.x + d * 0.35, c0.y + d * 0.45, c0.z + d);
    camera.lookAt(c0);
    if (typeof controls !== 'undefined' && controls) {
      controls.target.copy(c0);
      controls.update();
    }
    return true;
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '03-groupby-zpurlin-closeup.png') });

  // ---- Optimise (same sequence as MainForm CLI soak) ----
  const packInfo = await page.evaluate(() => {
    const spec = (typeof rawScene !== 'undefined' && rawScene && rawScene.containerSpec)
      ? rawScene.containerSpec
      : { lengthMm: 12000, widthMm: 2438, heightMm: 2690 };
    (assemblyGroups || []).forEach(g => { if (g && g.state !== 'oversized') g.checked = true; });
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    if (opt && opt.layout) {
      currentLayout = opt.layout;
      currentContainerIdx = 0;
      renderContainer(0);
    }
    const rep = (opt && opt.report) || {};
    return {
      unitCount: units.length,
      placedCount: rep.placedCount,
      unplacedCount: rep.unplacedCount,
      stripReserveMm: rep.stripReserveMm,
      weightKg: rep.weightKg,
      weightUtilizationPct: rep.weightUtilizationPct,
      summary: rep.summary,
    };
  });
  console.log('optimise:', JSON.stringify(packInfo, null, 2));
  await sleep(2500);
  await page.screenshot({ path: path.join(SHOTS, '04-container.png') });

  // Container framed from the side + top
  await page.evaluate(() => {
    if (typeof camera === 'undefined') return;
    const spec = rawScene.containerSpec || { lengthMm: 12000, widthMm: 2438, heightMm: 2690 };
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const L = spec.lengthMm * S, W = spec.widthMm * S, H = spec.heightMm * S;
    const c0 = new THREE.Vector3(L / 2, H / 2, 0);
    camera.position.set(L * 0.55, H * 3.2, W * 6.5);
    camera.lookAt(c0);
    if (typeof controls !== 'undefined' && controls) {
      controls.target.copy(c0);
      controls.update();
    }
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '05-container-side.png') });

  await page.evaluate(() => {
    if (typeof camera === 'undefined') return;
    const spec = rawScene.containerSpec || { lengthMm: 12000, widthMm: 2438, heightMm: 2690 };
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const L = spec.lengthMm * S, W = spec.widthMm * S;
    const c0 = new THREE.Vector3(L / 2, 0, 0);
    camera.position.set(L / 2, Math.max(L, W) * 1.15, 0.001);
    camera.lookAt(c0);
    if (typeof controls !== 'undefined' && controls) {
      controls.target.copy(c0);
      controls.update();
    }
  });
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '06-container-top.png') });

  fs.writeFileSync(path.join(SHOTS, 'console.log'), logs.join('\n'), 'utf8');
  fs.writeFileSync(
    path.join(SHOTS, 'metrics.json'),
    JSON.stringify({ libs, sceneInfo, groupInfo, packInfo }, null, 2), 'utf8');

  const errs = logs.filter(l => l.startsWith('[pageerror]') || l.startsWith('[error]'));
  console.log(`errors: ${errs.length}`);
  errs.slice(0, 15).forEach(e => console.log('  ' + e));

  await browser.close();
  console.log('shots written to ' + SHOTS);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
