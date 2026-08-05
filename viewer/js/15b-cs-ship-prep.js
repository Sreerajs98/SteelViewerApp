/* 15b-cs-ship-prep.js — Real-world Ship Prep (load-ready pose)
 *
 * Industry pipeline:
 *   IFC as-built → Ship Prep (flat / nest / ground) → Group By view
 *                → Optimise (translate + yaw 0/90 only)
 *
 * Ship Prep owns pose. Optimise must not remorph _shipPrepped units.
 */

/** Classify item for ship rules. */
function csShipPrepClass(it) {
  if (!it) return 'other';
  const sk = String(it.shapeKey || it.profileShape || '').toLowerCase();
  const gk = String(it.groupKind || '').toLowerCase();
  if (gk === 'nest_z' || sk === 'z_channel' || sk === 'z_shape') return 'nest_z';
  if (gk === 'nest_c' || sk === 'c_channel') return 'nest_c';
  if (gk === 'nest_l' || sk === 'l_angle') return 'nest_l';
  if (sk === 'plate' || gk === 'stack_plate' || it.category === 'plate') return 'plate';
  if (sk === 'rod' || sk === 'bent_sag_rod' || it.category === 'rod') return 'rod';
  // Welded assemblies before bare beam — an i_beam shapeKey on a rafter must
  // still get assembly flatten, not the thin-beam ground path that left roof
  // pitch in the container.
  if (it.isAssembly || gk === 'welded_assembly' || gk === 'assembly_single'
      || (it.parts && it.parts.length >= 2))
    return 'assembly';
  if (sk === 'i_beam' || sk === 'rhs' || sk === 'chs' || it.category === 'beam')
    return 'beam';
  if (typeof csNzIsZShape === 'function' && csNzIsZShape(it)) return 'nest_z';
  return 'other';
}

function csShipPrepIsZ(it) {
  return csShipPrepClass(it) === 'nest_z';
}

/**
 * Bottom tip-gap in mm along the longest horizontal axis.
 * (Yaw 0/90 both valid — never assume world +X is length.)
 */
function csShipPrepTipGapMm(mesh) {
  if (!mesh || typeof THREE === 'undefined') return 1e9;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (!isFinite(box.min.x)) return 1e9;
  const sx = Math.max(box.max.x - box.min.x, 1e-9);
  const sz = Math.max(box.max.z - box.min.z, 1e-9);
  const alongX = sx >= sz;
  const a0 = alongX ? box.min.x : box.min.z;
  const span = alongX ? sx : sz;
  const nBin = 9;
  const bins = new Array(nBin).fill(Infinity);
  const v = new THREE.Vector3();
  let n = 0;
  mesh.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (o.isLine || o.isLineSegments) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos || pos.count < 3) return;
    const step = Math.max(1, Math.floor(pos.count / 60));
    for (let i = 0; i < pos.count && n < 1800; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const a = alongX ? v.x : v.z;
      const bi = Math.min(nBin - 1, Math.max(0, Math.floor(((a - a0) / span) * nBin)));
      if (v.y < bins[bi]) bins[bi] = v.y;
      n++;
    }
  });
  const vals = bins.filter(y => isFinite(y));
  if (vals.length < 2) return 0;
  return (Math.max(...vals) - Math.min(...vals)) / sc;
}

/** Nail mesh minY → 0. */
function csShipPrepNailGround(mesh) {
  if (!mesh || typeof THREE === 'undefined') return 0;
  mesh.updateMatrixWorld(true);
  if (typeof csNzSnapObjectToGround === 'function') {
    const s = csNzSnapObjectToGround(mesh);
    return (s && s.moved_y) || 0;
  }
  const box = new THREE.Box3().setFromObject(mesh);
  if (!isFinite(box.min.y)) return 0;
  const dy = -box.min.y;
  if (Math.abs(dy) > 1e-6) mesh.position.y += dy;
  return dy;
}

/**
 * Tip-level for assemblies (Ship Prep only — not Optimise settle).
 * Analytical pitch/roll cancel + discrete refine.
 */
function csShipPrepTipLevel(mesh, keepX, keepZ) {
  if (!mesh || typeof THREE === 'undefined') return { tipGapMm: 1e9 };
  // Skip expensive tip-level search for large assemblies — they are
  // already flattened by groundOrientItem. tip > 200mm means a big
  // welded assembly (rafter/column) — just snap to ground and return.
  {
    mesh.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(mesh);
    const height = bb.max.y - bb.min.y;
    const length = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
    if (length > height * 5) {
      // Already flat (length >> height) — just nail to ground
      if (typeof csNzSnapObjectToGround === 'function') {
        csNzSnapObjectToGround(mesh);
      }
      return { tipGapMm: (typeof csShipPrepTipGapMm === 'function')
        ? csShipPrepTipGapMm(mesh) : 0 };
    }
  }
  const kx = keepX != null ? keepX : mesh.position.x;
  const kz = keepZ != null ? keepZ : mesh.position.z;
  // Shipping needs full flatten. A 35° cap left pitched rafters leaning in the
  // container (building roof angle ≈ 30–60° never cancelled). Allow a full
  // quarter-turn per step; faceDownOk still rejects standing-on-end poses.
  const maxTipRad = 90 * Math.PI / 180;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
  const tolMm = 8;

  function snapG() {
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.position.y = 0;
    mesh.updateMatrixWorld(true);
    csShipPrepNailGround(mesh);
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.updateMatrixWorld(true);
  }

  function samplePitchRoll() {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(box.min.x)) return { pitch: 0, roll: 0, tipGapMm: 1e9 };
    const x0 = box.min.x, x1 = box.max.x;
    const z0 = box.min.z, z1 = box.max.z;
    const spanX = Math.max(x1 - x0, 1e-9);
    const spanZ = Math.max(z1 - z0, 1e-9);
    const nBin = 9;
    const binsX = new Array(nBin).fill(Infinity);
    const binsZ = new Array(nBin).fill(Infinity);
    const v = new THREE.Vector3();
    let n = 0;
    mesh.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      if (o.isLine || o.isLineSegments) return;
      const pos = o.geometry.attributes && o.geometry.attributes.position;
      if (!pos || pos.count < 3) return;
      const step = Math.max(1, Math.floor(pos.count / 80));
      for (let i = 0; i < pos.count && n < 2400; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const bi = Math.min(nBin - 1, Math.max(0, Math.floor(((v.x - x0) / spanX) * nBin)));
        const bj = Math.min(nBin - 1, Math.max(0, Math.floor(((v.z - z0) / spanZ) * nBin)));
        if (v.y < binsX[bi]) binsX[bi] = v.y;
        if (v.y < binsZ[bj]) binsZ[bj] = v.y;
        n++;
      }
    });
    let iL = -1, iR = -1, jN = -1, jF = -1;
    for (let i = 0; i < nBin; i++) if (isFinite(binsX[i])) { iL = i; break; }
    for (let i = nBin - 1; i >= 0; i--) if (isFinite(binsX[i])) { iR = i; break; }
    for (let j = 0; j < nBin; j++) if (isFinite(binsZ[j])) { jN = j; break; }
    for (let j = nBin - 1; j >= 0; j--) if (isFinite(binsZ[j])) { jF = j; break; }
    let pitch = 0, roll = 0;
    if (iL >= 0 && iR > iL) {
      const xL = x0 + ((iL + 0.5) / nBin) * spanX;
      const xR = x0 + ((iR + 0.5) / nBin) * spanX;
      pitch = Math.atan2(binsX[iR] - binsX[iL], Math.max(xR - xL, 1e-9));
    }
    if (jN >= 0 && jF > jN) {
      const zN = z0 + ((jN + 0.5) / nBin) * spanZ;
      const zF = z0 + ((jF + 0.5) / nBin) * spanZ;
      roll = Math.atan2(binsZ[jF] - binsZ[jN], Math.max(zF - zN, 1e-9));
    }
    return { pitch, roll, tipGapMm: csShipPrepTipGapMm(mesh) };
  }

  function faceDownOk() {
    // Shipping rule: the longest span must lie roughly horizontal. A deep
    // I-beam on its flange is valid even when height > width — the old
    // sy <= sz*1.22 test rejected that pose and left pitched rafters leaning.
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(b.min.x)) return false;
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    const longest = Math.max(sx, sy, sz);
    // Standing on end = length up the container height
    if (sy >= longest * 0.92 && sy > Math.max(sx, sz) * 1.15) return false;
    if (typeof evaluateMeshGroupStability === 'function') {
      const ev = evaluateMeshGroupStability(mesh);
      if (ev && ev.standing_on_end) return false;
    }
    return true;
  }

  function applyAxis(axis, ang) {
    if (!(Math.abs(ang) > 1e-7)) return;
    mesh.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(axis, ang));
    mesh.rotation.setFromQuaternion(mesh.quaternion);
  }

  snapG();
  for (let iter = 0; iter < 5; iter++) {
    const env = samplePitchRoll();
    let pitch = Math.max(-maxTipRad, Math.min(maxTipRad, env.pitch));
    let roll = Math.max(-maxTipRad, Math.min(maxTipRad, env.roll));
    if (Math.abs(pitch) < 2e-4 && Math.abs(roll) < 2e-4) break;
    const q0 = mesh.quaternion.clone();
    const py0 = mesh.position.y;
    applyAxis(new THREE.Vector3(0, 0, 1), -pitch);
    applyAxis(new THREE.Vector3(1, 0, 0), -roll);
    snapG();
    if (!faceDownOk()) {
      mesh.quaternion.copy(q0);
      mesh.rotation.setFromQuaternion(q0);
      mesh.position.set(kx, py0, kz);
      snapG();
      break;
    }
    if (csShipPrepTipGapMm(mesh) <= tolMm) break;
  }

  let bestTg = csShipPrepTipGapMm(mesh);
  let bestQ = mesh.quaternion.clone();
  let bestPy = mesh.position.y;
  const tipDegs = [0.5, 1, 2, 3, 5, 8, 12, 18, 25, 35, 45, 60];
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)];
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (const axis of axes) {
      for (const d of tipDegs) {
        for (const sign of [1, -1]) {
          mesh.quaternion.copy(bestQ);
          applyAxis(axis, sign * d * Math.PI / 180);
          snapG();
          if (!faceDownOk()) continue;
          const tg = csShipPrepTipGapMm(mesh);
          if (tg < bestTg - 0.05) {
            bestTg = tg;
            bestQ = mesh.quaternion.clone();
            bestPy = mesh.position.y;
            improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }
  mesh.quaternion.copy(bestQ);
  mesh.rotation.setFromQuaternion(bestQ);
  mesh.position.set(kx, bestPy, kz);
  snapG();
  return { tipGapMm: csShipPrepTipGapMm(mesh) };
}

/**
 * Stand a deep assembly on its flange when that is the slimmer way to ship it.
 *
 * Laying a member max-flat puts its deepest face on the floor, so a 2 m deep
 * girder segment lies on its web and eats the whole container width while
 * standing barely 350 mm tall. Yards ship those on edge: web vertical, flange
 * down. Only a clearly wasteful pose is turned, and only when the turned pose
 * still fits inside the box, so genuinely flat pieces (plates, panels, shallow
 * beams already resting on a flange) are left exactly as they were.
 *
 * @returns {boolean} true when the mesh was turned
 */
/**
 * How solidly the mesh sits on the floor (0..1).
 *
 * Cleat / tab legs only touch a few bottom bins, so the score stays low. A
 * flange or web face fills most bins near minY — that is the base a human
 * would put down first.
 */
function csShipPrepFloorContactFrac(mesh) {
  if (!mesh || typeof THREE === 'undefined') return 0;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  if (!isFinite(box.min.x)) return 0;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
  const tol = 12 * sc; // 12 mm band above the floor
  const nX = 10, nZ = 8;
  const hit = new Array(nX * nZ).fill(false);
  const v = new THREE.Vector3();
  const x0 = box.min.x, z0 = box.min.z;
  const sx = Math.max(box.max.x - box.min.x, 1e-9);
  const sz = Math.max(box.max.z - box.min.z, 1e-9);
  const yFloor = box.min.y;
  let n = 0;
  mesh.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (o.isLine || o.isLineSegments) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos || pos.count < 3) return;
    const step = Math.max(1, Math.floor(pos.count / 100));
    for (let i = 0; i < pos.count && n < 4000; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      if (v.y > yFloor + tol) continue;
      const ix = Math.min(nX - 1, Math.max(0, Math.floor(((v.x - x0) / sx) * nX)));
      const iz = Math.min(nZ - 1, Math.max(0, Math.floor(((v.z - z0) / sz) * nZ)));
      hit[iz * nX + ix] = true;
      n++;
    }
  });
  let c = 0;
  for (let i = 0; i < hit.length; i++) if (hit[i]) c++;
  return c / hit.length;
}

/**
 * Roll the piece onto its solid face: length stays horizontal, cleats / tabs
 * must not be the only things touching the floor.
 */
function csShipPrepPreferSolidBase(mesh, keepX, keepZ) {
  if (!mesh || typeof THREE === 'undefined') return { contact: 0, tipGapMm: 1e9 };
  const kx = keepX != null ? keepX : mesh.position.x;
  const kz = keepZ != null ? keepZ : mesh.position.z;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;

  const nail = () => {
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.position.y = 0;
    mesh.updateMatrixWorld(true);
    csShipPrepNailGround(mesh);
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.updateMatrixWorld(true);
  };
  const measure = () => {
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(b.min.x)) return null;
    const l = (b.max.x - b.min.x) / sc;
    const w = (b.max.z - b.min.z) / sc;
    const h = (b.max.y - b.min.y) / sc;
    const tip = csShipPrepTipGapMm(mesh);
    const contact = csShipPrepFloorContactFrac(mesh);
    // Length must stay the long axis (no standing on end).
    if (h >= Math.max(l, w) * 0.85) return null;
    return { l, w, h, tip, contact };
  };

  nail();
  const start = measure();
  // Roll about the CURRENT length axis (world X or Z) — after tip-level the
  // long member may lie on either horizontal axis, so hard-coding Rx is wrong.
  const alongX = !start || start.l >= start.w;
  const axis = alongX
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);

  const baseQ = mesh.quaternion.clone();
  let best = null;
  let bestQ = baseQ.clone();
  // 0/90/180/270 about length — four ways to lay a long member down.
  const rolls = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (let i = 0; i < rolls.length; i++) {
    mesh.quaternion.copy(baseQ);
    if (rolls[i]) {
      mesh.quaternion.premultiply(new THREE.Quaternion()
        .setFromAxisAngle(axis, rolls[i]));
    }
    mesh.rotation.setFromQuaternion(mesh.quaternion);
    nail();
    const m = measure();
    if (!m) continue;
    // Prefer solid floor contact, then low tip, then low height (flat base).
    const score = m.contact * 1e6 - m.tip * 200 - m.h * 0.5;
    if (!best || score > best.score) {
      best = { score, ...m };
      bestQ = mesh.quaternion.clone();
    }
  }
  mesh.quaternion.copy(bestQ);
  mesh.rotation.setFromQuaternion(bestQ);
  nail();
  const final = measure() || { contact: 0, tip: 1e9, h: 0 };
  return {
    contact: final.contact,
    tipGapMm: final.tip,
    heightMm: final.h,
  };
}

/**
 * Brute-force a flat shipping seat: try pitch/roll steps and keep the pose
 * with the smallest bottom-Y span (tip gap) that is not standing on end.
 */
function csShipPrepForceFlat(mesh, keepX, keepZ, tipGap0) {
  if (!mesh || typeof THREE === 'undefined') return tipGap0 || 1e9;
  const kx = keepX != null ? keepX : mesh.position.x;
  const kz = keepZ != null ? keepZ : mesh.position.z;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;

  const nail = () => {
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.position.y = 0;
    mesh.updateMatrixWorld(true);
    csShipPrepNailGround(mesh);
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.updateMatrixWorld(true);
  };
  const tipMm = () => csShipPrepTipGapMm(mesh);
  const standingOnEnd = () => {
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(b.min.x)) return true;
    const sx = (b.max.x - b.min.x) / sc;
    const sy = (b.max.y - b.min.y) / sc;
    const sz = (b.max.z - b.min.z) / sc;
    const longest = Math.max(sx, sy, sz);
    return sy >= longest * 0.92 && sy > Math.max(sx, sz) * 1.15;
  };

  let bestTg = tipGap0 != null ? tipGap0 : tipMm();
  let bestQ = mesh.quaternion.clone();
  const baseQ = mesh.quaternion.clone();
  const deg = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
  for (let pi = 0; pi < deg.length; pi++) {
    for (const ps of [1, -1]) {
      for (let ri = 0; ri < deg.length; ri++) {
        for (const rs of [1, -1]) {
          if (deg[pi] === 0 && ps < 0) continue;
          if (deg[ri] === 0 && rs < 0) continue;
          mesh.quaternion.copy(baseQ);
          if (deg[pi]) {
            mesh.quaternion.premultiply(new THREE.Quaternion()
              .setFromAxisAngle(new THREE.Vector3(0, 0, 1), ps * deg[pi] * Math.PI / 180));
          }
          if (deg[ri]) {
            mesh.quaternion.premultiply(new THREE.Quaternion()
              .setFromAxisAngle(new THREE.Vector3(1, 0, 0), rs * deg[ri] * Math.PI / 180));
          }
          mesh.rotation.setFromQuaternion(mesh.quaternion);
          nail();
          if (standingOnEnd()) continue;
          const tg = tipMm();
          if (tg < bestTg - 0.5) {
            bestTg = tg;
            bestQ = mesh.quaternion.clone();
            if (bestTg <= 8) {
              mesh.quaternion.copy(bestQ);
              mesh.rotation.setFromQuaternion(bestQ);
              nail();
              return bestTg;
            }
          }
        }
      }
    }
  }
  mesh.quaternion.copy(bestQ);
  mesh.rotation.setFromQuaternion(bestQ);
  nail();
  return bestTg;
}

function csShipPrepStandOnEdge(mesh, it) {
  if (!mesh || !it || typeof THREE === 'undefined') return false;
  const isAsm = !!(it.isAssembly
    || it.groupKind === 'welded_assembly'
    || it.groupKind === 'assembly_single');
  if (!isAsm) return false;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;

  let Wcap = 2438;
  let Hcap = 2690;
  try {
    if (typeof rawScene !== 'undefined' && rawScene && rawScene.containerSpec) {
      if (+rawScene.containerSpec.widthMm > 500) Wcap = +rawScene.containerSpec.widthMm;
      if (+rawScene.containerSpec.heightMm > 500) Hcap = +rawScene.containerSpec.heightMm;
    }
  } catch (_) { /* */ }

  const measure = () => {
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(b.min.x)) return null;
    return { w: (b.max.z - b.min.z) / sc, h: (b.max.y - b.min.y) / sc };
  };
  const flat = measure();
  if (!flat) return false;

  const keepQ = mesh.quaternion.clone();
  const keepY = mesh.position.y;
  mesh.quaternion.premultiply(new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  mesh.rotation.setFromQuaternion(mesh.quaternion);
  csShipPrepNailGround(mesh);
  const edge = measure();

  // Horizontal shipping is the default. Only stand a piece on edge when the
  // flat pose cannot enter the box at all — never just because edge is narrower.
  // Standing deep girders upright for "space" is what put vertical towers in
  // the container while the operator expected every piece to lie flat.
  const flatFits = flat.w <= Wcap + 1 && flat.h <= Hcap + 1;
  const edgeFits = !!edge && edge.w <= Wcap + 1 && edge.h <= Hcap + 1;
  if (flatFits || !edgeFits) {
    mesh.quaternion.copy(keepQ);
    mesh.rotation.setFromQuaternion(keepQ);
    mesh.position.y = keepY;
    mesh.updateMatrixWorld(true);
    return false;
  }
  it._shipStoodOnEdge = true;
  return true;
}

/**
 * If the current pose does not fit the container AABB, rotate to the best
 * fitting seat (lowest tip among poses that enter). Used for kinked rafters
 * whose max-flat plan is wider than the box.
 */
function csShipPrepEnsureFitsContainer(mesh, it, keepX, keepZ, tipGap0) {
  if (!mesh || typeof THREE === 'undefined') {
    return { changed: false, tipGapMm: tipGap0 || 1e9, method: null };
  }
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
  let Wcap = 2438, Hcap = 2690, Lcap = 12192;
  try {
    if (typeof rawScene !== 'undefined' && rawScene && rawScene.containerSpec) {
      if (+rawScene.containerSpec.widthMm > 500) Wcap = +rawScene.containerSpec.widthMm;
      if (+rawScene.containerSpec.heightMm > 500) Hcap = +rawScene.containerSpec.heightMm;
      if (+rawScene.containerSpec.lengthMm > 500) Lcap = +rawScene.containerSpec.lengthMm;
    }
  } catch (_) { /* */ }
  const kx = keepX != null ? keepX : mesh.position.x;
  const kz = keepZ != null ? keepZ : mesh.position.z;

  const nail = () => {
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.position.y = 0;
    mesh.updateMatrixWorld(true);
    csShipPrepNailGround(mesh);
    mesh.position.x = kx;
    mesh.position.z = kz;
    mesh.updateMatrixWorld(true);
  };
  const measure = () => {
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(b.min.x)) return null;
    const l = (b.max.x - b.min.x) / sc;
    const w = (b.max.z - b.min.z) / sc;
    const h = (b.max.y - b.min.y) / sc;
    const tip = csShipPrepTipGapMm(mesh);
    const fit = l <= Lcap + 1 && w <= Wcap + 1 && h <= Hcap + 1;
    return { l, w, h, tip, fit };
  };

  nail();
  let cur = measure();
  if (cur && cur.fit) {
    return { changed: false, tipGapMm: cur.tip, method: null };
  }

  const keepQ = mesh.quaternion.clone();
  let best = null;
  let bestQ = keepQ.clone();

  // 1) refineAssemblyGroundPose — known to find RF012 ≈ 11.6×0.87×2.4 m
  if (typeof refineAssemblyGroundPose === 'function') {
    try {
      refineAssemblyGroundPose(mesh, it || {}, null);
      mesh.position.x = kx;
      mesh.position.z = kz;
      nail();
      const m = measure();
      if (m && m.fit) {
        best = m;
        bestQ = mesh.quaternion.clone();
      }
    } catch (_) { /* */ }
  }

  // 2) Align to IFC construct axes if still needed
  if ((!best || !best.fit) && typeof alignMeshToPackFootprint === 'function') {
    mesh.quaternion.copy(keepQ);
    mesh.rotation.setFromQuaternion(keepQ);
    nail();
    let iL = +(it && it.lengthMm) || 0;
    let iW = +(it && it.widthMm) || 0;
    let iH = +(it && it.heightMm) || 0;
    if (typeof cs8NormalizeAssemblyShipAxes === 'function' && iL > 0) {
      const ax = cs8NormalizeAssemblyShipAxes(iL, iW, iH, it || {});
      if (ax) { iL = ax.l; iW = ax.w; iH = ax.h; }
    }
    if (iL > 500 && iW >= 40 && iW <= Wcap + 1 && iH >= 40 && iH <= Hcap + 1) {
      const probe = {
        ...(it || {}),
        packFootprintL: iL,
        packFootprintW: iW,
        packFootprintH: iH,
      };
      try {
        alignMeshToPackFootprint(mesh, probe);
        mesh.position.x = kx;
        mesh.position.z = kz;
        nail();
        const m = measure();
        if (m && m.fit && (!best || m.tip < best.tip - 0.5)) {
          best = m;
          bestQ = mesh.quaternion.clone();
        }
      } catch (_) { /* */ }
    }
  }

  if (best && best.fit) {
    mesh.quaternion.copy(bestQ);
    mesh.rotation.setFromQuaternion(bestQ);
    nail();
    const final = measure() || best;
    if (it) it._shipFitRotated = true;
    return {
      changed: true,
      tipGapMm: final.tip,
      method: 'assembly_ship_prep_fit_rotate',
      dims: { l: final.l, w: final.w, h: final.h },
    };
  }

  // Restore flat attempt — honest leftover
  mesh.quaternion.copy(keepQ);
  mesh.rotation.setFromQuaternion(keepQ);
  nail();
  cur = measure();
  return {
    changed: false,
    tipGapMm: cur ? cur.tip : (tipGap0 || 1e9),
    method: null,
  };
}

/** Stamp ship-prep fields onto item from live mesh. */
function csShipPrepStamp(it, mesh, cls, tipGapMm) {
  if (!it || !mesh) return;
  const sc = (typeof SCALE === 'number' && SCALE > 0) ? SCALE : 0.01;
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const q = mesh.quaternion;
  it._groupByQuat = { x: q.x, y: q.y, z: q.z, w: q.w };
  it._freezeGroupByPose = true;
  it._shipPrepped = true;
  it._shipPrepClass = cls || csShipPrepClass(it);
  it.tipGapMm = (typeof tipGapMm === 'number') ? tipGapMm : csShipPrepTipGapMm(mesh);
  it._orientLocked = true;
  try {
    it._lockedQuaternion = mesh.quaternion.clone();
  } catch (_) { /* */ }
  if (isFinite(box.min.x) && sc > 0) {
    let sb = {
      l: Math.max((box.max.x - box.min.x) / sc, 1),
      h: Math.max((box.max.y - box.min.y) / sc, 1),
      w: Math.max((box.max.z - box.min.z) / sc, 1),
      source: 'ship_prep',
      tipGapMm: it.tipGapMm,
    };
    // Mesh max-flat can still exceed 40ft W. ONLY remap to IFC construct axes
    // when the live mesh is still pitched — never when tip is already flat.
    // Replacing a flat seat (tip ~30, w ~4400) with construct axes (w=200,
    // h=2508, tip ~1790) is what put roof-pitch rafters back in the container.
    if ((sb.w > 2438 + 1 || sb.h > 2690 + 1)
        && !(it.tipGapMm <= 80 && sb.h <= Math.max(sb.l, sb.w) * 0.45)
        && typeof cs8SanitizePitchedAssemblyEnvelope === 'function') {
      const memberL = Math.max(
        +it.lengthMm || 0, +it.widthMm || 0, +it.heightMm || 0,
        +it.lengthMaxMm || 0, sb.l, 1);
      // IFC axis-swap: span often on widthMm (RF012 200×11607×2507).
      // Prefer rawScene envelope when pack-unit sectH is a Tekla plate stamp.
      let iL = +it.lengthMm || sb.l;
      let iW = +it.widthMm || sb.w;
      let iH = +it.heightMm || sb.h;
      try {
        if (typeof rawScene !== 'undefined' && rawScene && rawScene.items) {
          const marks = new Set(
            [it.mark, ...((it.marks) || [])].filter(Boolean).map(m => String(m)));
          const markRe = Array.from(marks).filter(m => m.length >= 3)
            .map(m => {
              try { return new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); }
              catch (_) { return null; }
            }).filter(Boolean);
          const hit = rawScene.items.find(r => {
            if (!r) return false;
            const rm = String(r.mark || '');
            if (marks.has(rm)) return true;
            if (((r.marks) || []).some(m => marks.has(String(m)))) return true;
            // RF012 ↔ "604.2A-6 · set 1" share marks[] on pack unit
            return markRe.some(re => re.test(rm)
              || ((r.marks) || []).some(m => re.test(String(m))));
          });
          if (hit && +hit.lengthMm > 0 && +hit.widthMm > 0 && +hit.heightMm > 0) {
            iL = +hit.lengthMm;
            iW = +hit.widthMm;
            iH = +hit.heightMm;
          }
        }
      } catch (_) { /* */ }
      if (typeof cs8NormalizeAssemblyShipAxes === 'function') {
        const ax = cs8NormalizeAssemblyShipAxes(iL, iW, iH, it);
        if (ax) { iL = ax.l; iW = ax.w; iH = ax.h; }
      }
      // Ignore Tekla plate CS stamps (mark "604.2A-6" → sectH=604/sectW=6)
      const sectW = +it.sectW || 0;
      const sectH = +it.sectH || 0;
      const unitW = +it.unitWidth || 0;
      const unitH = +it.unitHeight || 0;
      const cW = (sectW >= 40 && sectW <= 2438 && !(iW >= 80 && sectW < iW * 0.35))
        ? sectW
        : ((unitW >= 40 && unitW <= 2438) ? unitW : iW);
      const cH = (sectH >= 40 && sectH <= 2690 && !(iH >= 80 && Math.abs(sectH - iH) > 200))
        ? sectH
        : ((unitH >= 40 && unitH <= 2690) ? unitH : iH);
      const fixed = cs8SanitizePitchedAssemblyEnvelope(
        sb, it, Math.max(memberL, iL), cW, cH);
      if (fixed && fixed.w <= 2438 + 1 && fixed.h <= 2690 + 1) {
        sb = {
          l: fixed.l, w: fixed.w, h: fixed.h,
          source: 'ship_prep',
          tipGapMm: it.tipGapMm,
          pitchedFrom: fixed.pitchedFrom || { l: sb.l, w: sb.w, h: sb.h },
          constructSeat: true,
        };
        // RF/CL piece marks: always prefer rawScene IFC envelope (not Tekla CS height)
        try {
          const pieceMark = [it.mark, ...((it.marks) || [])]
            .map(m => String(m || ''))
            .find(m => /^(RF|CL)\d+/i.test(m));
          if (pieceMark && typeof rawScene !== 'undefined' && rawScene && rawScene.items
              && typeof cs8NormalizeAssemblyShipAxes === 'function') {
            const hit = rawScene.items.find(r => r && (
              String(r.mark || '') === pieceMark
              || new RegExp(`^${pieceMark}\\b`, 'i').test(String(r.mark || ''))
              || ((r.marks) || []).some(m => String(m) === pieceMark)));
            if (hit) {
              const ax = cs8NormalizeAssemblyShipAxes(
                +hit.lengthMm, +hit.widthMm, +hit.heightMm, it);
              if (ax && ax.w <= 2438 + 1 && ax.h <= 2690 + 1
                  && ax.l > 4000 && ax.h > sb.h + 50) {
                sb.l = ax.l; sb.w = ax.w; sb.h = ax.h;
                sb.fromSceneMark = pieceMark;
              }
            }
          }
        } catch (_) { /* */ }
        // Align live mesh to construct footprint when helper exists
        it.packFootprintL = sb.l;
        it.packFootprintW = sb.w;
        it.packFootprintH = sb.h;
        if (typeof alignMeshToPackFootprint === 'function') {
          try {
            alignMeshToPackFootprint(mesh, it);
            csShipPrepNailGround(mesh);
            const q2 = mesh.quaternion;
            it._groupByQuat = { x: q2.x, y: q2.y, z: q2.z, w: q2.w };
            it.tipGapMm = csShipPrepTipGapMm(mesh);
            sb.tipGapMm = it.tipGapMm;
          } catch (_) { /* */ }
        }
        // Keep the construct seat only if the posed mesh really occupies it.
        // Reserving a footprint the geometry cannot hold is what pushes pieces
        // through the container wall once they are drawn.
        let seated = null;
        try {
          mesh.updateMatrixWorld(true);
          const sBox = new THREE.Box3().setFromObject(mesh);
          if (isFinite(sBox.min.x)) {
            seated = {
              l: (sBox.max.x - sBox.min.x) / sc,
              h: (sBox.max.y - sBox.min.y) / sc,
              w: (sBox.max.z - sBox.min.z) / sc,
            };
          }
        } catch (_) { /* */ }
        const seatTol = Math.max(60, Math.min(sb.w, sb.h) * 0.15);
        const seatOk = !!seated
          && Math.abs(seated.w - sb.w) <= seatTol
          && Math.abs(seated.h - sb.h) <= seatTol
          && Math.abs(seated.l - sb.l) <= Math.max(150, sb.l * 0.05);
        const seatFits = !!seated && seated.w <= 2438 + 1 && seated.h <= 2690 + 1;
        if (seatFits) {
          // The posed mesh is what actually occupies space, whether or not it
          // landed on the construct seat. Reserve the measured envelope so the
          // packer can never seat neighbours inside a piece it under-measured.
          sb = {
            l: seated.l, w: seated.w, h: seated.h,
            source: 'ship_prep',
            tipGapMm: it.tipGapMm,
            pitchedFrom: sb.pitchedFrom,
            constructSeat: seatOk,
            constructSeatRejected: !seatOk,
          };
        } else {
          const back = sb.pitchedFrom || {};
          sb = {
            l: +back.l > 0 ? back.l : (seated ? seated.l : sb.l),
            w: +back.w > 0 ? back.w : (seated ? seated.w : sb.w),
            h: +back.h > 0 ? back.h : (seated ? seated.h : sb.h),
            source: 'ship_prep',
            tipGapMm: it.tipGapMm,
            constructSeatRejected: true,
          };
        }
      }
    }
    it.stableBundleMm = sb;
    it.packFootprintL = sb.l;
    it.packFootprintW = sb.w;
    it.packFootprintH = sb.h;
  }
  try {
    if (!mesh.userData) mesh.userData = {};
    mesh.userData._groupByQuat = { ...it._groupByQuat };
    mesh.userData._shipPrepped = true;
  } catch (_) { /* */ }
}

/**
 * Apply Ship Prep to a display mesh (rigid only).
 * @returns {{ ok, class, tipGapMm, method }}
 */
function csShipPrepMesh(mesh, it) {
  if (!mesh || !it || typeof THREE === 'undefined') {
    return { ok: false, reason: 'no_mesh' };
  }
  const cls = csShipPrepClass(it);
  const keepX = mesh.position.x;
  const keepZ = mesh.position.z;
  let method = 'nail';
  let tipGapMm = 0;

  if (cls === 'nest_z') {
    // Legacy Z nest / Rule1 — never PCA flatten
    method = 'nest_z_keep';
    // Apply Group By frozen orientation first (prevents IFC world fan spread)
    if (it._groupByQuat && typeof applyGroupByFrozenQuat === 'function') {
      applyGroupByFrozenQuat(mesh, it);
      mesh.position.x = keepX;
      mesh.position.z = keepZ;
      mesh.updateMatrixWorld && mesh.updateMatrixWorld(true);
      method = 'nest_z_groupby';
    } else if (typeof ensureStableShape === 'function' && !it._keepGroupByBundle) {
      // makeShape already built nest; just nail
    }
    csShipPrepNailGround(mesh);
    tipGapMm = csShipPrepTipGapMm(mesh);
    csShipPrepStamp(it, mesh, cls, tipGapMm);
    return { ok: true, class: cls, tipGapMm, method };
  }

  if (cls === 'assembly') {
    method = 'assembly_ship_prep';
    it._yardStraighten = true;
    it.assemblyShipPose = true;
    // Drop any yard / building pitch that was frozen onto the item — Optimise
    // must measure and draw a flat shipping pose, not the roof angle.
    try {
      delete it._groupByQuat;
      delete mesh.userData._groupByQuat;
      it._freezeGroupByPose = false;
    } catch (_) { /* */ }
    if (typeof straightenYardItemOnGround === 'function') {
      straightenYardItemOnGround(mesh, it);
    }
    const tip = csShipPrepTipLevel(mesh, keepX, keepZ);
    tipGapMm = tip.tipGapMm;
    // Tip-level alone can leave a long rafter with 100–300 mm end lift. Brute
    // search a flat seat by minimising bottom-Y span along the length.
    if (tipGapMm > 25) {
      tipGapMm = csShipPrepForceFlat(mesh, keepX, keepZ, tipGapMm);
      method = 'assembly_ship_prep_force_flat';
    }
    // Cleats / tabs must not be the only floor contact — roll onto the solid
    // web or flange so the piece can act as a real base for the next item.
    {
      const solid = csShipPrepPreferSolidBase(mesh, keepX, keepZ);
      tipGapMm = solid.tipGapMm;
      it._shipFloorContact = solid.contact;
      method = 'assembly_ship_prep_solid_base';
    }
    csShipPrepNailGround(mesh);
    tipGapMm = csShipPrepTipGapMm(mesh);
    // Prefer absolute-flat when it FITS the box. If the flat seat is wider /
    // taller than the container (kinked rafter plan), rotate to the flattest
    // pose that still enters — that is what a human does with the second image
    // (turn the piece until it goes in), instead of leaving FOOTPRINT_EXCEEDS.
    {
      const fit = csShipPrepEnsureFitsContainer(mesh, it, keepX, keepZ, tipGapMm);
      tipGapMm = fit.tipGapMm;
      if (fit.changed) method = fit.method || 'assembly_ship_prep_fit';
    }
    if (csShipPrepStandOnEdge(mesh, it)) {
      mesh.position.x = keepX;
      mesh.position.z = keepZ;
      csShipPrepNailGround(mesh);
      tipGapMm = csShipPrepTipGapMm(mesh);
      method = 'assembly_ship_prep_on_edge';
    }
    // Re-apply rafter plan yaw after tip/flat/solid (those can reintroduce chariv)
    if (typeof cstabKillRafterChariv === 'function') {
      cstabKillRafterChariv(mesh, it);
      mesh.position.x = keepX;
      mesh.position.z = keepZ;
      csShipPrepNailGround(mesh);
      tipGapMm = csShipPrepTipGapMm(mesh);
    }
    csShipPrepStamp(it, mesh, cls, tipGapMm);
    return { ok: true, class: cls, tipGapMm, method };
  }

  if (cls === 'nest_c' || cls === 'nest_l') {
    method = 'nest_ground';
    it._keepGroupByBundle = true;
    // Apply Group By frozen orientation first (prevents IFC world fan spread)
    if (it._groupByQuat && typeof applyGroupByFrozenQuat === 'function') {
      applyGroupByFrozenQuat(mesh, it);
      mesh.position.x = keepX;
      mesh.position.z = keepZ;
      mesh.updateMatrixWorld && mesh.updateMatrixWorld(true);
      method = 'nest_cl_groupby';
    }
    csShipPrepNailGround(mesh);
    tipGapMm = csShipPrepTipGapMm(mesh);
    csShipPrepStamp(it, mesh, cls, tipGapMm);
    return { ok: true, class: cls, tipGapMm, method };
  }

  // plate / rod / beam / other — same flat + solid-base rule as assemblies
  method = 'flat_ground';
  if (typeof straightenYardItemOnGround === 'function' && !csShipPrepIsZ(it)) {
    it._yardStraighten = true;
    straightenYardItemOnGround(mesh, it);
  } else if (typeof groundOrientItem === 'function') {
    groundOrientItem(it, mesh);
  }
  {
    const tip0 = csShipPrepTipLevel(mesh, keepX, keepZ);
    tipGapMm = tip0.tipGapMm;
    if (tipGapMm > 25) {
      tipGapMm = csShipPrepForceFlat(mesh, keepX, keepZ, tipGapMm);
      method = 'flat_ground_force_flat';
    }
  }
  // Every long piece (not just welded assemblies): solid face down, cleats up.
  {
    const solid = csShipPrepPreferSolidBase(mesh, keepX, keepZ);
    tipGapMm = solid.tipGapMm;
    it._shipFloorContact = solid.contact;
    method = 'flat_ground_solid_base';
  }
  csShipPrepNailGround(mesh);
  // Deep assemblies land here too when their section reads as a plain beam.
  if (csShipPrepStandOnEdge(mesh, it)) {
    mesh.position.x = keepX;
    mesh.position.z = keepZ;
    csShipPrepNailGround(mesh);
    method = 'flat_ground_on_edge';
  }
  tipGapMm = csShipPrepTipGapMm(mesh);
  csShipPrepStamp(it, mesh, cls, tipGapMm);
  return { ok: true, class: cls, tipGapMm, method };
}

/**
 * Measure + Ship Prep a pack unit / item via temp makeShape.
 * Stamps _shipPrepped / quat / stableBundleMm on `it`.
 */
function csShipPrepItem(it) {
  if (!it) return { ok: false, reason: 'no_item' };
  // Re-run when prior stamp still exceeds 40ft or looks like a plate-CS height
  const sb0 = it.stableBundleMm;
  const staleSeat = !!(sb0 && /ship_prep/i.test(String(sb0.source || ''))
    && (+sb0.w > 2438 + 1 || +sb0.h > 2690 + 1
      || +it.tipGapMm > 40
      || (it.sectH > 0 && Math.abs(+sb0.h - +it.sectH) < 1.5 && +sb0.h < 900)));
  if (it._shipPrepped && it._groupByQuat && sb0 && !staleSeat
      && /ship_prep|yard_straighten/i.test(String(sb0.source || ''))) {
    return {
      ok: true, class: it._shipPrepClass || csShipPrepClass(it),
      tipGapMm: it.tipGapMm || 0, method: 'cached',
    };
  }
  if (typeof makeShape !== 'function' || typeof SCALE !== 'number') {
    // Soft stamp so Optimise can still proceed with existing sb
    it._shipPrepped = !!(it._groupByQuat || it.stableBundleMm || it._freezeGroupByPose);
    return { ok: !!it._shipPrepped, method: 'soft_stamp', class: csShipPrepClass(it) };
  }
  let mesh = null;
  try {
    const cls = csShipPrepClass(it);
    // Record the exact inputs this measurement was taken with. The renderer has
    // to rebuild from these same numbers, or it measures one shape and draws
    // another — see csShipPrepPosedMesh.
    const dims = {
      l: it.lengthMm || it.l || 500,
      w: it.widthMm || it.w || 200,
      h: it.heightMm || it.h || 200,
      qty: it.qty || 1,
      cls,
    };
    it._shipPrepDimsMm = dims;
    mesh = makeShape({
      ...it,
      lengthMm: dims.l,
      widthMm: dims.w,
      heightMm: dims.h,
      qty: dims.qty,
      _yardStraighten: cls !== 'nest_z',
      _keepGroupByBundle: cls === 'nest_z' || cls === 'nest_c' || cls === 'nest_l',
      assemblyShipPose: cls === 'assembly',
      _skipStability: false,
    }, 0xffffff, 1);
    const r = csShipPrepMesh(mesh, it);
    return r;
  } catch (e) {
    try { console.warn('[ship-prep]', it.mark, e); } catch (_) { /* */ }
    return { ok: false, reason: 'exception' };
  } finally {
    if (mesh && typeof disposeTempMesh === 'function') disposeTempMesh(mesh);
    else if (mesh) {
      try {
        mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      } catch (_) { /* */ }
    }
  }
}

/**
 * Build a display mesh in the exact pose Ship Prep measured this unit in.
 *
 * Optimise reserves packFootprint* / stableBundleMm from the mesh this pipeline
 * produces, so the renderer has to come back through the same pipeline. A
 * stored quaternion is not enough: ship prep settles part of the pose into
 * child transforms, so replaying only the root rotation onto a mesh rebuilt
 * with different makeShape inputs lands the piece somewhere else — which is how
 * a 200 mm wide rafter ended up 2.5 m wide and through the container wall.
 *
 * The unit's own packing stamps are left untouched; posing runs on a copy.
 */
function csShipPrepPosedMesh(it, color, opacity) {
  if (!it || typeof makeShape !== 'function' || typeof THREE === 'undefined') return null;
  try {
    // Replay the dims the measurement was taken with when we have them; the
    // render path substitutes section / original-IFC dims that would build a
    // different shape from the one Optimise reserved space for.
    const rec = it._shipPrepDimsMm || null;
    const cls = (rec && rec.cls) || csShipPrepClass(it);
    const freeze = !!(it._pack25dFreezePose || it._pack25dPoseLocked
      || (it._packV2Applied && it._groupByQuat && it._shipPrepped));
    const mesh = makeShape({
      ...it,
      lengthMm: (rec && rec.l) || it.lengthMm || it.l || 500,
      widthMm: (rec && rec.w) || it.widthMm || it.w || 200,
      heightMm: (rec && rec.h) || it.heightMm || it.h || 200,
      qty: (rec && rec.qty) || it.qty || 1,
      _yardStraighten: !freeze && cls !== 'nest_z',
      _keepGroupByBundle: cls === 'nest_z' || cls === 'nest_c' || cls === 'nest_l'
        || freeze,
      assemblyShipPose: cls === 'assembly',
      _skipStability: !!freeze,
      _freezeGroupByPose: freeze || !!it._freezeGroupByPose,
    }, color, opacity);
    if (!mesh) return null;
    // Deterministic 2.5D / Pack V2: replay frozen quat only — no tip/pitch search
    if (freeze && it._groupByQuat && typeof applyGroupByFrozenQuat === 'function') {
      applyGroupByFrozenQuat(mesh, it);
      if (typeof csShipPrepNailGround === 'function') csShipPrepNailGround(mesh);
      try {
        it._orientLocked = true;
        it._lockedQuaternion = mesh.quaternion.clone();
      } catch (_) { /* */ }
      return mesh;
    }
    csShipPrepMesh(mesh, { ...it });
    // After first successful prep, lock quat so later Optimise redraws freeze
    try {
      if (it._groupByQuat) {
        it._pack25dPoseLocked = true;
        it._shipPrepped = true;
      }
    } catch (_) { /* */ }
    return mesh;
  } catch (e) {
    try { console.warn('[ship-prep pose]', it.mark, e); } catch (_) { /* */ }
    return null;
  }
}

/** Ship Prep a pack unit (mutates pu). */
function csShipPrepPackUnit(pu) {
  if (!pu) return { ok: false };
  // Warehouse stubs / name-only parts: soft stamp — do not remesh (keeps W.16b/W.18d)
  const parts = pu.parts || [];
  const stubOnly = parts.length >= 2 && parts.every(p => p && !Number(p.lengthMm)
    && !p.geometry && !p.transform
    && /^(web|flange|a|b|part)$/i.test(String(p.name || 'part')));
  if (stubOnly || pu._skipShipPrepRemesh) {
    pu._shipPrepped = true;
    pu._freezeGroupByPose = true;
    pu.needs_ship_prep = false;
    if (pu.stableBundleMm && !pu.stableBundleMm.source)
      pu.stableBundleMm.source = 'ship_prep';
    return { ok: true, method: 'stub_soft', class: csShipPrepClass(pu) };
  }
  const r = csShipPrepItem(pu);
  if (r && r.ok) {
    pu._shipPrepped = true;
    pu._freezeGroupByPose = true;
    if (pu.stableBundleMm && pu.stableBundleMm.source === 'ship_prep') {
      pu.packFootprintL = pu.stableBundleMm.l;
      pu.packFootprintW = pu.stableBundleMm.w;
      pu.packFootprintH = pu.stableBundleMm.h;
    }
  }
  return r;
}

/** True if unit is ship-ready for Optimise freeze pack. */
function csShipPrepReady(u) {
  if (!u) return false;
  if (u.needs_ship_prep && !u._shipPrepped) return false;
  // Soft stamp / nest stamp / full mesh prep all set _shipPrepped
  if (u._shipPrepped) return true;
  if (u._groupByQuat && u._freezeGroupByPose) return true;
  if (u._keepGroupByBundle && (u.nestPieces || /^nest_/i.test(String(u.groupKind || ''))))
    return true;
  if (u._freezeGroupByPose && u.stableBundleMm
      && /ship_prep|yard_straighten/i.test(String(u.stableBundleMm.source || '')))
    return true;
  return false;
}
