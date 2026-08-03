/* Compares, per placed unit, the footprint Pack V2 reserved against the
 * bounding box of the mesh the renderer actually drew. Any unit where the
 * mesh is bigger than the reservation is a load plan that cannot be trusted.
 */
const fs = require('fs');
const path = require('path');

const tag = process.argv[2] || 'a1';
const rep = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'shots', `${tag}-report.json`), 'utf8'));
const rows = rep.audit.rows || [];
const spec = rep.pack.spec;

const TOL = 25;
const bad = [];
rows.forEach(r => {
  const dl = r.mesh.l - r.foot.l;
  const dh = r.mesh.h - r.foot.h;
  const dw = r.mesh.w - r.foot.w;
  const worst = Math.max(dl, dh, dw);
  if (worst > TOL) bad.push({ ...r, dl, dh, dw, worst });
});
bad.sort((a, b) => b.worst - a.worst);

const byKind = {};
rows.forEach(r => {
  const k = r.kind || 'none';
  byKind[k] = byKind[k] || { n: 0, oversize: 0, maxOver: 0 };
  byKind[k].n++;
  const worst = Math.max(r.mesh.l - r.foot.l, r.mesh.h - r.foot.h, r.mesh.w - r.foot.w);
  if (worst > TOL) {
    byKind[k].oversize++;
    byKind[k].maxOver = Math.max(byKind[k].maxOver, worst);
  }
});

console.log(`container: ${spec.lengthMm}x${spec.widthMm}x${spec.heightMm} mm, `
  + `maxWeight ${spec.maxWeightKg} kg`);
console.log(`loaded: ${rep.pack.weightKg} kg (${rep.pack.weightUtilizationPct}% of cap)`);
console.log(`placed units: ${rows.length}`);
console.log('\nmesh bigger than reserved footprint, by kind:');
Object.entries(byKind).forEach(([k, v]) =>
  console.log(`  ${k.padEnd(16)} ${String(v.oversize).padStart(3)}/${String(v.n).padEnd(3)}`
    + ` worst +${v.maxOver} mm`));

console.log('\nworst offenders:');
bad.slice(0, 12).forEach(r =>
  console.log(`  ${r.mark.padEnd(24)} ${r.kind.padEnd(16)} qty${String(r.qty).padStart(3)}`
    + `  mesh ${r.mesh.l}x${r.mesh.w}x${r.mesh.h}`
    + `  foot ${r.foot.l}x${r.foot.w}x${r.foot.h}`
    + `  over L${r.dl} W${r.dw} H${r.dh}`));

// Width pressure: how much total width the meshes demand vs the container
const zSpan = rows.reduce((m, r) => Math.max(m, r.box.maxZ), -1e9);
const zMin = rows.reduce((m, r) => Math.min(m, r.box.minZ), 1e9);
console.log(`\nZ extent of load: ${Math.round(zMin)} .. ${Math.round(zSpan)} mm `
  + `(container allows ${-spec.widthMm / 2} .. ${spec.widthMm / 2})`);
