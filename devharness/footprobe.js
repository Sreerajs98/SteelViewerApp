/* For each assembly pack unit: what did ship prep measure, what footprint does
 * the packer hold, and how big is the mesh that will actually be drawn?
 */
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const PORT = Number(process.env.PORT) || 5178;
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

  const rows = await page.evaluate(() => {
    const S = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
    const dims = (m) => {
      if (!m) return null;
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      return [
        Math.round((b.max.x - b.min.x) / S),
        Math.round((b.max.z - b.min.z) / S),
        Math.round((b.max.y - b.min.y) / S),
      ];
    };
    const out = [];
    (assemblyGroups || []).forEach(g => (g.packUnits || []).forEach(pu => {
      if (String(pu.groupKind || '') !== 'welded_assembly' && !pu.isAssembly) return;
      const sb = pu.stableBundleMm || null;
      out.push({
        mark: String(pu.mark || ''),
        decl: [Math.round(+pu.lengthMm || 0), Math.round(+pu.widthMm || 0),
          Math.round(+pu.heightMm || 0)],
        sect: [Math.round(+pu.sectW || 0), Math.round(+pu.sectH || 0)],
        sb: sb ? [Math.round(+sb.l || 0), Math.round(+sb.w || 0), Math.round(+sb.h || 0)] : null,
        sbSrc: sb ? (sb.source || '') : null,
        rejected: !!(sb && sb.constructSeatRejected),
        pitchedFrom: sb && sb.pitchedFrom
          ? [Math.round(sb.pitchedFrom.l), Math.round(sb.pitchedFrom.w),
            Math.round(sb.pitchedFrom.h)] : null,
        foot: [Math.round(+pu.packFootprintL || 0), Math.round(+pu.packFootprintW || 0),
          Math.round(+pu.packFootprintH || 0)],
        posed: dims(typeof csShipPrepPosedMesh === 'function'
          ? csShipPrepPosedMesh(pu, 0x888888, 1) : null),
        parts: (pu.parts && pu.parts.length) || 0,
      });
    }));
    return out;
  });

  const f = a => Array.isArray(a) ? a.join('x') : String(a);
  const off = rows.filter(r => r.posed && r.foot
    && (Math.abs(r.posed[0] - r.foot[0]) > 25
      || Math.abs(r.posed[1] - r.foot[1]) > 25
      || Math.abs(r.posed[2] - r.foot[2]) > 25));
  console.log(`assemblies: ${rows.length}, footprint != posed mesh: ${off.length}\n`);
  console.log('mark                  declared(LWH)     sect    stableBundle(LWH)  src'
    + '            foot(LWH)         posedMesh(LWH)');
  (off.length ? off.slice(0, 14) : rows.slice(0, 10)).forEach(r => console.log(
    `${r.mark.slice(0, 21).padEnd(21)} ${f(r.decl).padEnd(17)} ${f(r.sect).padEnd(7)} `
    + `${f(r.sb).padEnd(18)} ${String(r.sbSrc).padEnd(14)} ${f(r.foot).padEnd(17)} `
    + `${f(r.posed)}${r.rejected ? '  [seat-rejected]' : ''}`));
  fs.writeFileSync(__dirname + '/shots/footprobe.json', JSON.stringify(rows, null, 2));
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
