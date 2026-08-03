/* Measures whether the seated load obeys real loading rules:
 *
 *  1. heavy at the base   - no heavier piece resting on a lighter one
 *  2. gravity             - every piece supported, nothing floating
 *  3. space optimisation  - how much of the container height is actually used
 *
 * Also counts why the stack pass refused each leftover, so it is clear whether
 * stacking is limited by geometry or by a rule.
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

  const out = await page.evaluate(() => {
    const spec = (rawScene && rawScene.containerSpec)
      || { lengthMm: 12000, widthMm: 2350, heightMm: 2690 };
    const units = csPackV2BuildUnits(assemblyGroups || [], {
      containerSpec: spec, checkedOnly: false });
    const opt = csPackV2RunOptimise({ units, containerSpec: spec, enableStacks: true });
    const pack = opt.pack || (opt.layout && opt.layout.packV2) || null;
    const placed = (pack && pack.placed) || [];

    const kg = (p) => Math.max(
      +p.weightKg || 0,
      +(p.unit && p.unit.weightKg) || 0,
      +(p.unit && p.unit.total_weight) || 0, 0);

    const byUid = {};
    placed.forEach(p => { if (p && p._fmUid != null) byUid[p._fmUid] = p; });

    // 1. heavy at base
    const inversions = [];
    let stacked = 0;
    placed.forEach(p => {
      if (!p || p.layer !== 'stack') return;
      stacked++;
      const sup = (p.supportUid != null) ? byUid[p.supportUid] : null;
      if (!sup) return;
      const wTop = kg(p);
      const wBase = kg(sup);
      if (wTop > wBase + 1) {
        inversions.push({
          top: p.mark, topKg: Math.round(wTop),
          base: sup.mark, baseKg: Math.round(wBase),
          ratio: +(wTop / Math.max(wBase, 1)).toFixed(2),
        });
      }
    });

    // 2. gravity: floating / unsupported
    const floating = [];
    placed.forEach(p => {
      if (!p || !p.box) return;
      const minY = +p.box.minY;
      if (minY <= 1) return;
      const sup = (p.supportUid != null) ? byUid[p.supportUid] : null;
      const topY = sup && sup.box ? +sup.box.maxY : null;
      if (topY == null || Math.abs(topY - minY) > 2) {
        floating.push({
          mark: p.mark, minY: Math.round(minY),
          supportTopY: topY == null ? null : Math.round(topY),
          role: p.role || null,
        });
      }
    });

    // 3. space + weight distribution
    let maxTop = 0;
    let totKg = 0;
    let momentKg = 0;
    let floorKg = 0;
    let stackKg = 0;
    let usedVol = 0;
    placed.forEach(p => {
      if (!p || !p.box) return;
      const w = kg(p);
      const cy = (+p.box.minY + +p.box.maxY) / 2;
      maxTop = Math.max(maxTop, +p.box.maxY);
      totKg += w;
      momentKg += w * cy;
      if (p.layer === 'stack') stackKg += w; else floorKg += w;
      usedVol += Math.max(+p.pl || 0, 0) * Math.max(+p.pw || 0, 0) * Math.max(+p.ph || 0, 0);
    });

    // why the stack pass refused things
    const env = csPackV2FloorEnvelope(spec);
    const sup = csPackV2BuildSupportMap(placed, env, { containerSpec: spec });
    const supportRejects = {};
    (sup.rejected || []).forEach(r => {
      const k = r.reason || 'OTHER';
      supportRejects[k] = (supportRejects[k] || 0) + 1;
    });

    const leftUids = new Set((pack && pack.unplaced || [])
      .map(u => (u && (u._fmUid != null ? u._fmUid : (u.unit && u.unit._fmUid)))));
    const leftovers = units.filter(u => u && leftUids.has(u._fmUid));
    const candReasons = {};
    leftovers.forEach(u => {
      let bestReason = 'NO_SUPPORT';
      for (const s of (sup.supports || [])) {
        const c = csPackV2IsStackCandidate(u, s, env, { containerSpec: spec });
        if (c.ok) { bestReason = 'OK'; break; }
        bestReason = c.reason || bestReason;
        if (bestReason === 'OK') break;
      }
      candReasons[bestReason] = (candReasons[bestReason] || 0) + 1;
    });

    const rep = opt.report || {};
    return {
      spec,
      cap: {
        capKg: spec.maxWeightKg,
        reportWeightKg: rep.weightKg,
        reportPlaced: rep.placedCount,
        reportUnplaced: rep.unplacedCount,
        capped: rep.weightCappedCount,
        cappedKg: rep.weightCappedKg,
        uniqueUids: new Set(placed.map(p => p && p._fmUid)).size,
      },
      placedCount: placed.length,
      stackedCount: stacked,
      supportCount: (sup.supports || []).length,
      supportRejects,
      leftoverCount: leftovers.length,
      leftoverStackReasons: candReasons,
      inversionCount: inversions.length,
      inversions: inversions.slice(0, 10),
      floatingCount: floating.length,
      floating: floating.slice(0, 8),
      loadTopMm: Math.round(maxTop),
      heightUsedPct: +(maxTop / spec.heightMm * 100).toFixed(1),
      cogMm: totKg > 0 ? Math.round(momentKg / totKg) : 0,
      cogPctOfLoadHeight: (totKg > 0 && maxTop > 0)
        ? +((momentKg / totKg) / maxTop * 100).toFixed(1) : 0,
      totKg: Math.round(totKg),
      floorKg: Math.round(floorKg),
      stackKg: Math.round(stackKg),
      volumeUsedPct: +(usedVol / (spec.lengthMm * spec.widthMm * spec.heightMm) * 100).toFixed(1),
    };
  });

  const o = out;
  console.log(`container ${o.spec.lengthMm}x${o.spec.widthMm}x${o.spec.heightMm}`);
  console.log(`placed ${o.placedCount}  stacked ${o.stackedCount}  supports ${o.supportCount}`);
  console.log(`cap: ${JSON.stringify(o.cap)}`);
  console.log('');
  console.log(`1. heavy at base : ${o.inversionCount} inversions (heavier resting on lighter)`);
  o.inversions.forEach(v => console.log(`     ${v.top} ${v.topKg}kg on ${v.base} ${v.baseKg}kg  (x${v.ratio})`));
  console.log(`2. gravity       : ${o.floatingCount} floating / unsupported`);
  o.floating.forEach(v => console.log(`     ${v.mark} minY=${v.minY} supportTop=${v.supportTopY} role=${v.role}`));
  console.log(`3. space         : load top ${o.loadTopMm} mm = ${o.heightUsedPct}% of height`);
  console.log(`                   volume used ${o.volumeUsedPct}%`);
  console.log(`   centre of grav: ${o.cogMm} mm (${o.cogPctOfLoadHeight}% of load height)`);
  console.log(`   weight floor/stack: ${o.floorKg} / ${o.stackKg} kg of ${o.totKg} kg`);
  console.log('');
  console.log(`support map rejects   : ${JSON.stringify(o.supportRejects)}`);
  console.log(`leftovers ${o.leftoverCount}, why not stacked: ${JSON.stringify(o.leftoverStackReasons)}`);
  console.log('\npageErrors:', errs.length ? errs.slice(0, 4) : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
