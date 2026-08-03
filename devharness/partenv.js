/* Computes the true assembly envelope straight from the IFC part triangle data,
 * so it can be compared with what the viewer's assembly mesh builder produces.
 */
const fs = require('fs');
const path = require('path');

const SCENE = path.join(__dirname, '..', 'bin', 'Debug', 'net8.0-windows',
  '_scene_cache.json');
const want = (process.argv[2] || 'RF012').toUpperCase();
const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));

const it = (scene.items || []).find(r => {
  const marks = [r.mark, ...(r.marks || [])].map(m => String(m || '').toUpperCase());
  return marks.some(m => m.includes(want));
});
if (!it) { console.log('not found'); process.exit(0); }

console.log(`${it.mark}: declared L${it.lengthMm} W${it.widthMm} H${it.heightMm}`);
const parts = it.parts || [];
console.log(`parts: ${parts.length}`);

const applyMat = (m, x, y, z) => {
  if (!m) return [x, y, z];
  const a = Array.isArray(m) ? m : (m.elements || null);
  if (!a || a.length < 12) return [x, y, z];
  if (a.length === 16) {
    // try row-major 4x4
    return [
      a[0] * x + a[1] * y + a[2] * z + a[3],
      a[4] * x + a[5] * y + a[6] * z + a[7],
      a[8] * x + a[9] * y + a[10] * z + a[11],
    ];
  }
  return [x, y, z];
};

const acc = (label, fn) => {
  const b = { minX: 1e18, minY: 1e18, minZ: 1e18, maxX: -1e18, maxY: -1e18, maxZ: -1e18 };
  let n = 0;
  parts.forEach(p => {
    const pos = p.meshPositionsMm;
    if (!pos || !pos.length) return;
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const [x, y, z] = fn(p, +pos[i], +pos[i + 1], +pos[i + 2]);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
      if (z < b.minZ) b.minZ = z; if (z > b.maxZ) b.maxZ = z;
      n++;
    }
  });
  if (!n) { console.log(`${label}: no vertices`); return; }
  console.log(`${label}: verts ${n}  extent `
    + `X ${(b.maxX - b.minX).toFixed(0)}  `
    + `Y ${(b.maxY - b.minY).toFixed(0)}  `
    + `Z ${(b.maxZ - b.minZ).toFixed(0)}`);
};

acc('raw meshPositionsMm            ', (p, x, y, z) => [x, y, z]);
acc('+ offsetXYZ                    ',
  (p, x, y, z) => [x + (+p.offsetXMm || 0), y + (+p.offsetYMm || 0), z + (+p.offsetZMm || 0)]);
acc('+ transform (row-major 4x4)    ', (p, x, y, z) => applyMat(p.transform, x, y, z));

const p0 = parts.find(p => p.meshPositionsMm && p.meshPositionsMm.length);
if (p0) {
  console.log(`\nsample part "${p0.name}":`);
  console.log(`  declared L${p0.lengthMm} W${p0.widthMm} H${p0.heightMm}`);
  console.log(`  box      X${p0.boxXMm} Y${p0.boxYMm} Z${p0.boxZMm}`);
  console.log(`  offset   X${p0.offsetXMm} Y${p0.offsetYMm} Z${p0.offsetZMm}`);
  console.log(`  rot      X${p0.rotX} Y${p0.rotY} Z${p0.rotZ}`);
  console.log(`  hasIfcTransform ${p0.hasIfcTransform}`);
  console.log(`  transform: ${JSON.stringify(p0.transform)}`);
  console.log(`  verts ${p0.meshPositionsMm.length / 3}, idx ${(p0.meshIndices || []).length}`);
  const pos = p0.meshPositionsMm;
  let mnx = 1e18, mny = 1e18, mnz = 1e18, mxx = -1e18, mxy = -1e18, mxz = -1e18;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]);
    mny = Math.min(mny, pos[i + 1]); mxy = Math.max(mxy, pos[i + 1]);
    mnz = Math.min(mnz, pos[i + 2]); mxz = Math.max(mxz, pos[i + 2]);
  }
  console.log(`  own mesh extent X${(mxx - mnx).toFixed(0)} Y${(mxy - mny).toFixed(0)}`
    + ` Z${(mxz - mnz).toFixed(0)}`);
  console.log(`  own mesh origin  X${mnx.toFixed(0)} Y${mny.toFixed(0)} Z${mnz.toFixed(0)}`);
}
