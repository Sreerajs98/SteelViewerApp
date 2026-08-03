/* Visual + numeric audit of the container load.
 *
 * 1. Group By  -> measures every yard bundle mesh.
 * 2. Optimise  -> renders the container and measures every placed mesh.
 * 3. Checks each placed mesh against: its own Group-By bundle size (the
 *    "place it as-is" rule), the container walls, and its neighbours.
 * 4. Writes clean screenshots with the unplaced/outside pile hidden.
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const PORT = Number(process.env.PORT) || 5178;
const URL = `http://127.0.0.1:${PORT}/Viewer3D.html`;
const TAG = process.env.TAG || 'audit';
const SHOTS = path.join(__dirname, 'shots');
const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--use-gl=angle',
      '--enable-unsafe-swiftshader', '--window-size=1800,1100'],
    defaultViewport: { width: 1800, height: 1100 },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', async d => { errs.push('dialog: ' + d.message()); await d.dismiss(); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => window.loadSceneFromUrl('/scene.json'));
  await page.waitForFunction(
    () => typeof rawScene !== 'undefined' && rawScene && (rawScene.items || []).length > 0,
    { timeout: 60000 });
  await sleep(1200);

  // Shared helpers inside the page
  await page.evaluate(() => {
    window.__S = () => (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    window.__dims = (mesh) => {
      mesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(mesh);
      const S = window.__S();
      return {
        l: (b.max.x - b.min.x) / S, h: (b.max.y - b.min.y) / S, w: (b.max.z - b.min.z) / S,
        minX: b.min.x / S, maxX: b.max.x / S,
        minY: b.min.y / S, maxY: b.max.y / S,
        minZ: b.min.z / S, maxZ: b.max.z / S,
      };
    };
    // Pack units are spread-copied on the way into the packer, so an own
    // enumerable tag survives the trip and gives us stable yard->container identity.
    window.__yardId = (it) => (it && (it.__yardId != null
      ? it.__yardId
      : (it._srcPackUnit && it._srcPackUnit.__yardId)));
  });

  // ---------- Group By ----------
  await page.evaluate(() => { groupByShape(); });
  await sleep(4500);
  const yard = await page.evaluate(() => {
    const out = {};
    let n = 0;
    (clickable || []).forEach(c => {
      if (!c || !c.mesh || !c.item) return;
      const id = 'y' + (n++);
      c.item.__yardId = id;
      const d = window.__dims(c.mesh);
      out[id] = {
        mark: String(c.item.mark || '?'),
        l: +d.l.toFixed(1), h: +d.h.toFixed(1), w: +d.w.toFixed(1),
        kids: c.mesh.children.length,
      };
    });
    return out;
  });

  // ---------- Optimise ----------
  const pack = await page.evaluate(() => {
    const spec = (rawScene && rawScene.containerSpec)
      || { lengthMm: 12000, widthMm: 2438, heightMm: 2690 };
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    currentLayout = opt.layout;
    currentContainerIdx = 0;
    renderContainer(0);
    const rep = opt.report || {};
    return {
      spec,
      unitCount: units.length,
      placed: rep.placedCount, unplaced: rep.unplacedCount,
      stripReserveMm: rep.stripReserveMm,
      weightKg: rep.weightKg, weightUtilizationPct: rep.weightUtilizationPct,
      summary: rep.summary,
    };
  });
  await sleep(2500);

  const audit = await page.evaluate((yardMap) => {
    const spec = (rawScene && rawScene.containerSpec)
      || { lengthMm: 12000, widthMm: 2438, heightMm: 2690 };
    const cont = currentLayout.containers[0];
    const inside = (clickable || []).filter(c =>
      c && c.mesh && c.item && !c.outsideContainer && !c.item.outsideContainer);

    const TOL = 25; // mm
    const halfW = spec.widthMm / 2;
    const wallOut = [];
    const shapeDrift = [];
    const rows = [];

    inside.forEach(c => {
      const it = c.item;
      const d = window.__dims(c.mesh);
      const yid = window.__yardId(it);
      const y = (yid && yardMap[yid]) || null;
      const sb = it.stableBundleMm || null;
      const row = {
        mark: String(it.mark || '?'),
        kind: String(it.groupKind || it.shapeKey || ''),
        qty: it.qty || 1,
        mesh: { l: +d.l.toFixed(0), h: +d.h.toFixed(0), w: +d.w.toFixed(0) },
        yard: y ? { l: +y.l.toFixed(0), h: +y.h.toFixed(0), w: +y.w.toFixed(0) } : null,
        stable: sb ? { l: Math.round(+sb.l || 0), h: Math.round(+sb.h || 0), w: Math.round(+sb.w || 0) } : null,
        foot: {
          l: Math.round(+it.packFootprintL || +it.packLengthMm || 0),
          h: Math.round(+it.packFootprintH || +it.packHeightMm || 0),
          w: Math.round(+it.packFootprintW || +it.packWidthMm || 0),
        },
        box: {
          minX: +d.minX.toFixed(0), maxX: +d.maxX.toFixed(0),
          minY: +d.minY.toFixed(0), maxY: +d.maxY.toFixed(0),
          minZ: +d.minZ.toFixed(0), maxZ: +d.maxZ.toFixed(0),
        },
      };
      rows.push(row);

      const over = {
        x0: d.minX < -TOL ? +(-d.minX).toFixed(0) : 0,
        x1: d.maxX > spec.lengthMm + TOL ? +(d.maxX - spec.lengthMm).toFixed(0) : 0,
        y0: d.minY < -TOL ? +(-d.minY).toFixed(0) : 0,
        y1: d.maxY > spec.heightMm + TOL ? +(d.maxY - spec.heightMm).toFixed(0) : 0,
        z0: d.minZ < -halfW - TOL ? +(-halfW - d.minZ).toFixed(0) : 0,
        z1: d.maxZ > halfW + TOL ? +(d.maxZ - halfW).toFixed(0) : 0,
      };
      const worst = Math.max(over.x0, over.x1, over.y0, over.y1, over.z0, over.z1);
      if (worst > 0) {
        wallOut.push({
          mark: row.mark, kind: row.kind, over, worst,
          meshWmm: row.mesh.w, footWmm: row.foot.w,
          meshLmm: row.mesh.l, footLmm: row.foot.l,
          meshHmm: row.mesh.h, footHmm: row.foot.h,
          box: row.box,
        });
      }

      // "Place the Group-By bundle as-is": container mesh must match yard mesh
      if (y) {
        const dl = Math.abs(d.l - y.l), dh = Math.abs(d.h - y.h), dw = Math.abs(d.w - y.w);
        const swapped = Math.abs(d.w - y.h) < TOL && Math.abs(d.h - y.w) < TOL;
        if (Math.max(dl, dh, dw) > TOL) {
          shapeDrift.push({
            mark: row.mark, kind: row.kind, qty: row.qty,
            yard: row.yard, cont: row.mesh,
            d: { l: +dl.toFixed(0), h: +dh.toFixed(0), w: +dw.toFixed(0) },
            rotated90: swapped,
          });
        }
      }
    });

    // Pairwise interpenetration (AABB, generous tolerance)
    const OV = 20;
    const boxes = inside.map(c => ({ m: String(c.item.mark || '?'), d: window.__dims(c.mesh) }));
    const clashes = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].d, b = boxes[j].d;
        const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
        const pen = Math.min(ox, oy, oz);
        if (ox > OV && oy > OV && oz > OV) {
          clashes.push({ a: boxes[i].m, b: boxes[j].m, penMm: +pen.toFixed(0) });
        }
      }
    }
    clashes.sort((p, q) => q.penMm - p.penMm);
    wallOut.sort((p, q) => q.worst - p.worst);

    const byKind = {};
    rows.forEach(r => {
      const k = r.kind || 'none';
      byKind[k] = byKind[k] || { n: 0, matched: 0 };
      byKind[k].n++;
      if (r.yard) byKind[k].matched++;
    });

    return {
      insideCount: inside.length,
      matchedYard: rows.filter(r => r.yard).length,
      byKind,
      wallOutCount: wallOut.length, wallOut: wallOut.slice(0, 12),
      shapeDriftCount: shapeDrift.length, shapeDrift: shapeDrift.slice(0, 12),
      clashCount: clashes.length, clashes: clashes.slice(0, 10),
      rows,
    };
  }, yard);

  // ---------- Clean container screenshots (hide the outside pile) ----------
  await page.evaluate(() => {
    (clickable || []).forEach(c => {
      if (c && c.mesh && (c.outsideContainer || (c.item && c.item.outsideContainer)))
        c.mesh.visible = false;
    });
  });

  // Long lens from far away ~= orthographic, so "is it outside the wall?"
  // can be judged from the picture without perspective spread.
  const shot = async (name, camFn) => {
    await page.evaluate(camFn);
    await sleep(900);
    await page.screenshot({ path: path.join(SHOTS, `${TAG}-${name}.png`) });
  };

  await page.evaluate(() => {
    window.__lens = (eye, target, fovDeg) => {
      camera.fov = fovDeg;
      camera.near = 0.1;
      camera.far = 100000;
      camera.position.set(eye.x, eye.y, eye.z);
      camera.updateProjectionMatrix();
      camera.lookAt(target);
      if (typeof controls !== 'undefined' && controls) {
        controls.target.copy(target);
        controls.update();
      }
    };
  });

  await shot('iso', () => {
    const spec = rawScene.containerSpec; const S = window.__S();
    const L = spec.lengthMm * S, H = spec.heightMm * S, W = spec.widthMm * S;
    const t = new THREE.Vector3(L / 2, H * 0.3, 0);
    const d = 900;
    window.__lens(new THREE.Vector3(t.x - d * 0.55, t.y + d * 0.42, d * 0.72), t, 9);
  });

  // Straight down the container: anything left/right of the outline is outside.
  await shot('top', () => {
    const spec = rawScene.containerSpec; const S = window.__S();
    const L = spec.lengthMm * S;
    const t = new THREE.Vector3(L / 2, 0, 0);
    window.__lens(new THREE.Vector3(L / 2, 1400, 0.001), t, 6.5);
  });

  // Looking down the length: shows width + height violations directly.
  await shot('endon', () => {
    const spec = rawScene.containerSpec; const S = window.__S();
    const L = spec.lengthMm * S, H = spec.heightMm * S;
    const t = new THREE.Vector3(L / 2, H / 2, 0);
    window.__lens(new THREE.Vector3(-1400, H / 2, 0.001), t, 2.6);
  });

  await shot('side', () => {
    const spec = rawScene.containerSpec; const S = window.__S();
    const L = spec.lengthMm * S, H = spec.heightMm * S;
    const t = new THREE.Vector3(L / 2, H / 2, 0);
    window.__lens(new THREE.Vector3(L / 2, H / 2, 1400), t, 6.5);
  });

  fs.writeFileSync(path.join(SHOTS, `${TAG}-report.json`),
    JSON.stringify({ pack, audit, errs }, null, 2), 'utf8');

  console.log('pack:', JSON.stringify(pack));
  console.log(`inside=${audit.insideCount} yardMatched=${audit.matchedYard} `
    + `outsideWalls=${audit.wallOutCount} shapeDrift=${audit.shapeDriftCount} `
    + `clashes=${audit.clashCount}`);
  console.log('byKind:', JSON.stringify(audit.byKind));
  console.log('wallOut:', JSON.stringify(audit.wallOut, null, 2));
  console.log('shapeDrift:', JSON.stringify(audit.shapeDrift, null, 2));
  console.log('pageErrors:', errs.length ? errs.slice(0, 5) : 'none');

  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
