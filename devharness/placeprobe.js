/* Runs the real Optimise, then for every item drawn inside the container
 * reports which render path produced its mesh, the footprint the packer
 * reserved, and the envelope the mesh actually fills.
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
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);

  const rows = await page.evaluate(() => {
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const spec = (rawScene && rawScene.containerSpec)
      || { lengthMm: 12000, widthMm: 2350, heightMm: 2690 };
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    currentLayout = opt.layout;
    currentContainerIdx = 0;
    renderContainer(0);

    const dims = (m) => {
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      return {
        l: +((b.max.x - b.min.x) / S).toFixed(0),
        h: +((b.max.y - b.min.y) / S).toFixed(0),
        w: +((b.max.z - b.min.z) / S).toFixed(0),
      };
    };

    return (clickable || [])
      .filter(c => c && c.mesh && c.item && !c.outsideContainer && !c.item.outsideContainer)
      .map(c => {
        const it = c.item;
        const sb = it.stableBundleMm || null;
        return {
          mark: String(it.mark || '?'),
          kind: String(it.groupKind || ''),
          cls: (typeof csShipPrepClass === 'function') ? csShipPrepClass(it) : null,
          qty: it.qty || 1,
          shipPosed: !!it._shipPosedRender,
          useFlag: !!it._useShipPrepPose,
          prepped: !!it._shipPrepped,
          mesh: dims(c.mesh),
          foot: {
            l: Math.round(+it.packFootprintL || 0),
            w: Math.round(+it.packFootprintW || 0),
            h: Math.round(+it.packFootprintH || 0),
          },
          sb: sb ? {
            l: Math.round(+sb.l || 0), w: Math.round(+sb.w || 0), h: Math.round(+sb.h || 0),
            src: String(sb.source || ''),
            seat: !!sb.constructSeat, rejected: !!sb.constructSeatRejected,
            from: sb.pitchedFrom ? {
              l: Math.round(+sb.pitchedFrom.l || 0),
              w: Math.round(+sb.pitchedFrom.w || 0),
              h: Math.round(+sb.pitchedFrom.h || 0),
            } : null,
          } : null,
        };
      });
  });

  const TOL = 25;
  const bad = rows.filter(r => r.mesh.w - r.foot.w > TOL
    || r.mesh.h - r.foot.h > TOL || r.mesh.l - r.foot.l > TOL);

  console.log(`inside: ${rows.length}   mesh > reserved: ${bad.length}\n`);
  bad.forEach(r => {
    console.log(`${r.mark}  qty${r.qty}  kind=${r.kind} cls=${r.cls}`
      + ` shipPosed=${r.shipPosed} useFlag=${r.useFlag} prepped=${r.prepped}`);
    console.log(`  mesh ${r.mesh.l} x ${r.mesh.w} x ${r.mesh.h}`
      + `   foot ${r.foot.l} x ${r.foot.w} x ${r.foot.h}`);
    if (r.sb) {
      console.log(`  sb   ${r.sb.l} x ${r.sb.w} x ${r.sb.h}  src=${r.sb.src}`
        + ` seat=${r.sb.seat} rejected=${r.sb.rejected}`
        + (r.sb.from ? `  from ${r.sb.from.l}x${r.sb.from.w}x${r.sb.from.h}` : ''));
    } else {
      console.log('  sb   none');
    }
  });
  console.log('\npageErrors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
