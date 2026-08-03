/* Reads the scene JSON the C# side produces and reports what the IFC actually
 * says about a given mark, including how its assembly parts are positioned.
 */
const fs = require('fs');
const path = require('path');

const SCENE = path.join(__dirname, '..', 'bin', 'Debug', 'net8.0-windows',
  '_scene_cache.json');
const want = (process.argv[2] || 'RF012').toUpperCase();

const scene = JSON.parse(fs.readFileSync(SCENE, 'utf8'));
const items = scene.items || [];
console.log(`scene items: ${items.length}`);
console.log(`containerSpec: ${JSON.stringify(scene.containerSpec)}`);

const hits = items.filter(it => {
  const marks = [it.mark, ...(it.marks || [])].map(m => String(m || '').toUpperCase());
  return marks.some(m => m.includes(want));
});
console.log(`\nitems matching "${want}": ${hits.length}`);

hits.slice(0, 2).forEach(it => {
  console.log('\n--- ' + it.mark + ' ---');
  console.log(`category      : ${it.category}`);
  console.log(`profileShape  : ${it.profileShape}  profileDesc: ${it.profileDesc}`);
  console.log(`declared dims : L${it.lengthMm} W${it.widthMm} H${it.heightMm}`);
  console.log(`section       : sectH${it.sectH} sectW${it.sectW} sectT${it.sectT}`);
  console.log(`qty ${it.qty}  weightKg ${it.weightKg}`);
  console.log(`isAssembly    : ${it.isAssembly}   parts: ${(it.parts || []).length}`);
  console.log(`pathPointsMm  : ${it.pathPointsMm ? JSON.stringify(it.pathPointsMm) : 'none'}`);

  const parts = it.parts || [];
  if (parts.length) {
    console.log(`\nfirst 6 parts:`);
    parts.slice(0, 6).forEach((p, i) => {
      const keys = Object.keys(p).join(',');
      console.log(`  [${i}] name=${p.name} L${p.lengthMm} W${p.widthMm} H${p.heightMm}`
        + ` pos=${JSON.stringify(p.posMm || p.position || p.originMm || null)}`
        + ` keys=${keys}`);
    });

    // Overall extent implied by part positions, if present
    const nums = { x: [], y: [], z: [] };
    parts.forEach(p => {
      const q = p.posMm || p.position || p.originMm;
      if (q && typeof q === 'object') {
        if (isFinite(q.x)) nums.x.push(+q.x);
        if (isFinite(q.y)) nums.y.push(+q.y);
        if (isFinite(q.z)) nums.z.push(+q.z);
      }
    });
    ['x', 'y', 'z'].forEach(a => {
      if (nums[a].length) {
        console.log(`  part ${a} span: ${Math.min(...nums[a]).toFixed(0)}`
          + ` .. ${Math.max(...nums[a]).toFixed(0)}`
          + ` (${(Math.max(...nums[a]) - Math.min(...nums[a])).toFixed(0)} mm)`);
      }
    });
  }
});
