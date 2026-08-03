/* Checks the "place the Group By bundle as-is" rule by mark.
 *
 * Measures every bundle mesh in the Group By yard, then runs Optimise and
 * measures the mesh drawn inside the container. A bundle that was regrouped or
 * re-posed on the way in shows up as a size difference.
 */
const fs = require('fs');
const path = require('path');
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
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader'],
    defaultViewport: { width: 1400, height: 900 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { await d.dismiss(); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(1200);

  await page.evaluate(() => {
    window.__S = () => (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    window.__d = (m) => {
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      const S = window.__S();
      return {
        l: +((b.max.x - b.min.x) / S).toFixed(0),
        h: +((b.max.y - b.min.y) / S).toFixed(0),
        w: +((b.max.z - b.min.z) / S).toFixed(0),
      };
    };
    // The yard panel labels sets by piece mark while pack units are labelled by
    // section, so marks cannot join the two views. Tag the pack unit instead:
    // it is the object the Group By panel hands to Optimise.
    window.__key = (it) => (it && (it.__gbId != null
      ? it.__gbId
      : (it._srcPackUnit && it._srcPackUnit.__gbId)));
  });

  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const yard = await page.evaluate(() => {
    const out = {};
    let n = 0;
    (assemblyGroups || []).forEach(g => (g.packUnits || []).forEach(pu => {
      const id = 'g' + (n++);
      pu.__gbId = id;
      const rec = { mark: String(pu.mark || '?'), kind: String(pu.groupKind || '') };
      // The bundle the Group By stage settled on, as ship prep measured it.
      const m = (typeof csShipPrepPosedMesh === 'function')
        ? csShipPrepPosedMesh(pu, 0xffffff, 1) : null;
      if (m) Object.assign(rec, window.__d(m));
      out[id] = rec;
    }));
    return out;
  });

  const res = await page.evaluate((yardMap) => {
    const spec = (rawScene && rawScene.containerSpec)
      || { lengthMm: 12000, widthMm: 2350, heightMm: 2690 };
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    currentLayout = opt.layout;
    currentContainerIdx = 0;
    renderContainer(0);

    const rows = [];
    (clickable || []).forEach(c => {
      if (!c || !c.mesh || !c.item) return;
      if (c.outsideContainer || c.item.outsideContainer) return;
      const k = window.__key(c.item);
      const y = (k != null) ? yardMap[k] : null;
      const d = window.__d(c.mesh);
      rows.push({
        key: `${String(c.item.mark || '?')} (${k == null ? 'untagged' : k})`,
        kind: String(c.item.groupKind || ''),
        yard: (y && y.l > 0) ? y : null, cont: d,
      });
    });
    return rows;
  }, yard);

  const TOL = 25;
  const matched = res.filter(r => r.yard);
  const drift = matched.filter(r =>
    Math.abs(r.cont.l - r.yard.l) > TOL
    || Math.abs(r.cont.w - r.yard.w) > TOL
    || Math.abs(r.cont.h - r.yard.h) > TOL);
  const turned = drift.filter(r =>
    Math.abs(r.cont.w - r.yard.l) <= TOL || Math.abs(r.cont.l - r.yard.w) <= TOL);

  console.log(`inside ${res.length}, matched to a yard bundle ${matched.length}`);
  console.log(`identical to Group By: ${matched.length - drift.length}`);
  console.log(`different: ${drift.length}  (of which a pure 90 turn: ${turned.length})\n`);
  drift.slice(0, 20).forEach(r => {
    console.log(`${r.key}  ${r.kind}`);
    console.log(`  yard      ${r.yard.l} x ${r.yard.w} x ${r.yard.h}`);
    console.log(`  container ${r.cont.l} x ${r.cont.w} x ${r.cont.h}`);
  });
  const unmatched = res.filter(r => !r.yard);
  if (unmatched.length) {
    console.log(`\nno yard bundle for ${unmatched.length}: `
      + unmatched.slice(0, 6).map(r => r.key).join(', '));
  }
  console.log('\npageErrors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
