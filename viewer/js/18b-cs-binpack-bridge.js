/* 18b-cs-binpack-bridge.js — Hybrid packer: ship-prep pose + binpackingjs seats
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  PACKING RULES — DO NOT MISS ANY (bridge must enforce every line)        ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║  R01 Group by Shape first (caller). Staging checkOrder = 1,2,3…          ║
 * ║  R02 Ship-prep owns pose: horizontal/flat preferred, solid base          ║
 * ║      (web/flange down — not cleats-only). Bridge NEVER remorphs pose.    ║
 * ║  R03 If flat AABB will not enter the box → ship-prep rotate-to-fit       ║
 * ║      (flattest pose that fits). Packer uses THAT L×W×H only.             ║
 * ║  R04 Nests / Group By bundles: keep nest arrangement (unit AABB only).   ║
 * ║  R05 Place #1 on the floor first, straight, footY = 0 (no float).        ║
 * ║  R06 Same row: try #2 beside #1, then next along the row (order kept).   ║
 * ║  R07 Gap ~touch (~5 mm). No large air strips between neighbours.         ║
 * ║  R08 Floor full → next layer ON TOP of heavier/equal pad (not outside).  ║
 * ║  R09 NO overlap (AABB). Pieces may touch; they must not interpenetrate.  ║
 * ║  R10 NO wall / height breach (inside clear length×width×height).         ║
 * ║  R11 Heavy base, light on top (stack only on ≥ weight support).          ║
 * ║  R12 Leftovers outside: grounded neat row (existing leftover apply).     ║
 * ║  R13 Viewer draws the SAME ship-prep pose Optimise reserved              ║
 * ║      (csShipPrepPosedMesh / fit flags). Packer adds Y-yaw 0|90 only.     ║
 * ║  R14 ONLY upright rotations: WHD (yaw0) and DHW (yaw90). No tip/flip.    ║
 * ║  R15 Order is sacred: NEVER volume-sort. Sequential 1→2→3…               ║
 * ║  R16 Weight cap still enforced by Pack V2 after seats are applied.       ║
 * ║  R17 Absurd / oversize footprints → honest leftover (not force-in).      ║
 * ║  R18 Gravity nail: floor y=0; stacks sit on supportTopY.                 ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Architecture:
 *   Ship-prep → unit packLength/Width/Height
 *     → sequential binpackingjs-style pivot seats (order preserved)
 *       → Pack V2 placement objects → apply / leftovers / weight cap
 *
 * Depends on: viewer/js/vendor/binpackingjs-3d.iife.js → window.BinPacking3D
 *             18-cs-pack-v2.js helpers (csPackV2Foot, MakeBox, …)
 */

(function (global) {
  'use strict';

  const CSBIN_GAP_MM = 5;
  const CSBIN_EPS = 0.5;
  const CSBIN_HEADROOM_MM = 40;

  /** RULE checklist exposed for probes / UI. */
  const CS_BINPACK_RULES = Object.freeze({
    R01_GROUP_BY_SHAPE_THEN_ORDER: true,
    R02_SHIP_PREP_SOLID_BASE: true,
    R03_FIT_ROTATE_IF_FLAT_WONT_ENTER: true,
    R04_KEEP_NEST_ARRANGEMENT: true,
    R05_FIRST_ON_FLOOR_NO_FLOAT: true,
    R06_SAME_ROW_BESIDE: true,
    R07_TOUCH_GAP_MM: CSBIN_GAP_MM,
    R08_LAYER_WHEN_FLOOR_FULL: true,
    R09_NO_OVERLAP: true,
    R10_NO_WALL_HEIGHT_BREACH: true,
    R11_HEAVY_BASE_LIGHT_TOP: true,
    R12_LEFTOVERS_GROUNDED: true,
    R13_VIEWER_SAME_SHIP_POSE: true,
    R14_UPRIGHT_YAW_ONLY: true,
    R15_SEQUENTIAL_ORDER: true,
    R16_WEIGHT_CAP_AFTER: true,
    R17_OVERSIZE_LEFTOVER: true,
    R18_GRAVITY_NAIL: true,
  });

  function bpLib() {
    return global.BinPacking3D || null;
  }

  function rotTypes() {
    const lib = bpLib();
    const RT = (lib && lib.RotationType) || { WHD: 0, DHW: 3 };
    // R14 — upright only (height stays vertical)
    return [RT.WHD, RT.DHW];
  }

  function getDim(w, h, d, rotation) {
    const lib = bpLib();
    if (lib && typeof lib.getDimension === 'function')
      return lib.getDimension(w, h, d, rotation);
    // Fallback mirrors binpackingjs WHD / DHW
    if (rotation === 3) return [d, h, w];
    return [w, h, d];
  }

  function itemsHit(pos1, dim1, pos2, dim2) {
    const lib = bpLib();
    if (lib && typeof lib.itemsIntersect === 'function')
      return lib.itemsIntersect(pos1, dim1, pos2, dim2);
    // AABB intersect (strict — touching edges OK)
    return !(pos1[0] + dim1[0] <= pos2[0] + CSBIN_EPS
      || pos2[0] + dim2[0] <= pos1[0] + CSBIN_EPS
      || pos1[1] + dim1[1] <= pos2[1] + CSBIN_EPS
      || pos2[1] + dim2[1] <= pos1[1] + CSBIN_EPS
      || pos1[2] + dim1[2] <= pos2[2] + CSBIN_EPS
      || pos2[2] + dim2[2] <= pos1[2] + CSBIN_EPS);
  }

  function unitWeight(u) {
    if (typeof csPackV2UnitWeightKg === 'function')
      return csPackV2UnitWeightKg(u);
    return Math.max(+u.weightKg || 0, +u.unitWeightKg || 0, +u.weight || 0, 0);
  }

  function footOf(u) {
    if (typeof csPackV2Foot === 'function') return csPackV2Foot(u);
    return {
      pl: Math.max(+u.packLengthMm || +u.packFootprintL || 0, 1),
      pw: Math.max(+u.packWidthMm || +u.packFootprintW || 0, 1),
      ph: Math.max(+u.packHeightMm || +u.packFootprintH || 0, 1),
    };
  }

  function makeBox(x, z, pl, pw, ph, y) {
    if (typeof csPackV2MakeBox === 'function')
      return csPackV2MakeBox(x, z, pl, pw, ph, y);
    const y0 = (y != null && y >= 0) ? y : 0;
    return {
      minX: x, maxX: x + pl,
      minZ: z, maxZ: z + pw,
      minY: y0, maxY: y0 + ph,
    };
  }

  function boxesOverlap(a, b, tol) {
    const t = (tol != null) ? +tol : CSBIN_EPS;
    if (typeof csPackV2BoxesOverlap === 'function')
      return csPackV2BoxesOverlap(a, b, t);
    if (!a || !b) return false;
    return !(a.maxX <= b.minX + t || a.minX >= b.maxX - t
      || a.maxY <= b.minY + t || a.minY >= b.maxY - t
      || a.maxZ <= b.minZ + t || a.minZ >= b.maxZ - t);
  }

  function isStackable(u) {
    if (typeof csPackV2IsStackableUnit === 'function')
      return csPackV2IsStackableUnit(u);
    return true;
  }

  function isAbsurd(pl, pw, ph, unit, env) {
    if (typeof cs8IsAbsurdAssemblyFootprint === 'function')
      return cs8IsAbsurdAssemblyFootprint(pl, pw, ph, unit);
    return pw > env.widthMm + CSBIN_EPS && pl > env.widthMm * 0.5;
  }

  /**
   * Try to seat one inflated item into the bin at a pivot (bin W/H/D axes).
   * Returns packed record or null.
   */
  function tryPut(bin, source, iw, ih, id, weight, position, allowed, opts) {
    const o = opts || {};
    const allowStack = o.allowStack !== false;
    for (let ri = 0; ri < allowed.length; ri++) {
      const rotation = allowed[ri];
      const d = getDim(iw, ih, id, rotation);
      if (!allowStack && position[1] > CSBIN_EPS) continue;
      if (bin.width + CSBIN_EPS < position[0] + d[0]
          || bin.height + CSBIN_EPS < position[1] + d[1]
          || bin.depth + CSBIN_EPS < position[2] + d[2]) {
        continue;
      }
      let hit = false;
      for (let i = 0; i < bin.items.length; i++) {
        const ex = bin.items[i];
        if (itemsHit(position, d, ex.position, ex.dimension)) {
          hit = true;
          break;
        }
      }
      if (hit) continue;

      // R11 — stacking only on heavier/equal pad
      if (position[1] > CSBIN_EPS) {
        const support = findSupport(bin.items, position, d);
        if (!support) continue;
        const sw = +support.weight || 0;
        if (sw + 1e-6 < weight) continue;
      }

      const packed = {
        name: source.name,
        width: iw, height: ih, depth: id,
        weight,
        position: [position[0], position[1], position[2]],
        rotationType: rotation,
        dimension: [d[0], d[1], d[2]],
        sourceItem: source,
        _unit: source._unit,
      };
      bin.items.push(packed);
      return packed;
    }
    return null;
  }

  function findSupport(items, pos, dim) {
    // Item whose top face matches our foot Y and overlaps footprint
    let best = null;
    let bestArea = 0;
    const footY = pos[1];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const top = it.position[1] + it.dimension[1];
      if (Math.abs(top - footY) > CSBIN_EPS) continue;
      const ox0 = Math.max(pos[0], it.position[0]);
      const oz0 = Math.max(pos[2], it.position[2]);
      const ox1 = Math.min(pos[0] + dim[0], it.position[0] + it.dimension[0]);
      const oz1 = Math.min(pos[2] + dim[2], it.position[2] + it.dimension[2]);
      const area = Math.max(0, ox1 - ox0) * Math.max(0, oz1 - oz0);
      if (area > bestArea) {
        bestArea = area;
        best = it;
      }
    }
    return bestArea > CSBIN_EPS ? best : null;
  }

  /**
   * R06/R08 — pivot order: beside (Width), along row (Depth), then stack (Height).
   * Prefer floor seats before climbing.
   */
  function collectPivots(bin) {
    const pivots = [];
    if (!bin.items.length) {
      pivots.push([0, 0, 0]);
      return pivots;
    }
    // Floor / same-layer first
    for (let i = 0; i < bin.items.length; i++) {
      const ib = bin.items[i];
      const d = ib.dimension;
      const p = ib.position;
      pivots.push([p[0] + d[0], p[1], p[2]]); // Width — beside
      pivots.push([p[0], p[1], p[2] + d[2]]); // Depth — along length
    }
    // Then stack
    for (let i = 0; i < bin.items.length; i++) {
      const ib = bin.items[i];
      const d = ib.dimension;
      const p = ib.position;
      pivots.push([p[0], p[1] + d[1], p[2]]); // Height — layer up
    }
    return pivots;
  }

  /**
   * Map binpacking axes → Pack V2 viewer packer mm.
   * bin W→viewer Z, bin H→viewer Y, bin D→viewer X
   *
   * Pack V2 convention: placement.pl is ALWAYS the X-span and pw the Z-span
   * of the seated footprint (yaw 90 already swaps into pl/pw). Mesh yaw is
   * stamped separately via yawDeg.
   */
  function packedToPlacement(packed, gapMm) {
    const RT = (bpLib() && bpLib().RotationType) || { WHD: 0, DHW: 3 };
    const g = Math.max(0, +gapMm || 0);
    // Seated spans from packer dimensions (deflate floor gap)
    const zSpan = Math.max(+packed.dimension[0] - g, 1);
    const ph = Math.max(+packed.dimension[1], 1);
    const xSpan = Math.max(+packed.dimension[2] - g, 1);
    const z = +packed.position[0];
    const y = +packed.position[1];
    const x = +packed.position[2];
    const yawDeg = (packed.rotationType === RT.DHW) ? 90 : 0;
    // pl = along container length (X), pw = across width (Z)
    const pl = xSpan;
    const pw = zSpan;

    const isStack = y > CSBIN_EPS;
    const box = makeBox(x, z, pl, pw, ph, isStack ? y : 0);
    if (!isStack) {
      box.minY = 0;
      box.maxY = ph;
    }
    const placement = {
      _fmUid: packed._unit && packed._unit._fmUid != null
        ? packed._unit._fmUid : null,
      mark: (packed._unit && packed._unit.mark) || packed.name || null,
      x, z, y: isStack ? y : 0,
      pl, pw, ph,
      box,
      layer: isStack ? 'stack' : 'floor',
      gravity: isStack ? 'support_top' : 'floor_y0',
      yawDeg,
      role: isStack ? 'nest_stack' : 'floor',
      supportTopY: isStack ? y : 0,
      unit: packed._unit || null,
      engine: 'binpackingjs_sequential',
    };
    return placement;
  }

  /** Register an already-accepted Pack V2 placement into the bin AABB set. */
  function registerPlacementInBin(bin, placement, gapMm) {
    const g = Math.max(0, +gapMm || 0);
    const yaw = +placement.yawDeg || 0;
    // placement.pl/pw are seated X/Z spans (yaw already applied)
    const pl = +placement.pl || 0;
    const pw = +placement.pw || 0;
    const ph = +placement.ph || 0;
    const x = +placement.x || 0;
    const z = +placement.z || 0;
    const y = +placement.y || 0;
    const dimW = pw + g; // bin width ← viewer Z
    const dimD = pl + g; // bin depth ← viewer X
    bin.items.push({
      name: placement.mark || 'p',
      width: dimW, height: ph, depth: dimD,
      weight: unitWeight(placement.unit),
      position: [z, y, x],
      rotationType: yaw === 90 ? 3 : 0,
      dimension: [dimW, ph, dimD],
      sourceItem: { name: placement.mark || 'p', _unit: placement.unit },
      _unit: placement.unit,
    });
  }

  /**
   * Extra candidate origins so a long first piece does not starve the side lane.
   * Tries home-wall / rear / beside last floor piece (R06).
   */
  function extraFloorPivots(bin, env, foot, gapMm) {
    const out = [];
    const g = Math.max(0, +gapMm || 0);
    const iw = foot.pw + g;
    const id = foot.pl + g;
    // Empty-bin origins already covered; add side-lane + end-lane scans
    out.push([0, 0, 0]);
    out.push([iw, 0, 0]); // will clamp via tryPut bounds
    // Slide along length on home wall (z=0)
    const step = Math.max(250, Math.floor(id * 0.5));
    for (let x = 0; x + id <= bin.depth + CSBIN_EPS; x += step)
      out.push([0, 0, x]);
    // Side lane: just past max occupied Z of floor items
    let maxZ = 0;
    for (let i = 0; i < bin.items.length; i++) {
      const it = bin.items[i];
      if (it.position[1] > CSBIN_EPS) continue;
      maxZ = Math.max(maxZ, it.position[0] + it.dimension[0]);
    }
    if (maxZ > 0 && maxZ + iw <= bin.width + CSBIN_EPS) {
      for (let x = 0; x + id <= bin.depth + CSBIN_EPS; x += step)
        out.push([maxZ, 0, x]);
    }
    return out;
  }

  /**
   * Sequential human pack (R15). Uses binpackingjs geometry helpers when present.
   * Pivot seat first; if that fails, Pack V2 free-rect floor / stack (same order).
   */
  function csBinPackPackHuman(units, opts) {
    const o = opts || {};
    const enableStacks = o.enableStacks !== false;
    const gapMm = (o.gapMm != null) ? Math.max(0, +o.gapMm) : CSBIN_GAP_MM;
    const ordered = (typeof csPackV2SortHumanOrder === 'function')
      ? csPackV2SortHumanOrder(units)
      : (units || []).slice();

    const init = (typeof csPackV2InitialFreeRects === 'function')
      ? csPackV2InitialFreeRects(o.containerSpec)
      : null;
    const env = o.envelope || (init && init.envelope) || {
      lengthMm: 12000, widthMm: 2350, heightMm: 2690,
      minXMm: 0, minZMm: 0, maxXMm: 12000, maxZMm: 2350,
    };

    // binpackingjs: width×height×depth = container W×H×L
    const bin = {
      name: 'C1',
      width: +env.widthMm,
      height: Math.max(0, +env.heightMm - CSBIN_HEADROOM_MM),
      depth: +env.lengthMm,
      maxWeight: Infinity,
      items: [],
    };

    let freeRects = (init && init.freeRects) ? init.freeRects.slice() : [];
    const allowed = rotTypes();
    const placed = [];
    const unplaced = [];
    const stackedPlacements = [];
    const placedBoxes = [];
    let feasibleCount = 0;
    let feasiblePlaced = 0;
    let absurdFootprintCount = 0;
    let pivotSeats = 0;
    let freeRectSeats = 0;
    let stackSeats = 0;

    for (let i = 0; i < ordered.length; i++) {
      const unit = ordered[i];
      if (!unit) continue;
      const foot = footOf(unit);
      const absurd = isAbsurd(foot.pl, foot.pw, foot.ph, unit, env);
      if (absurd) absurdFootprintCount++;
      const feasible = foot.ph <= env.heightMm + CSBIN_EPS
        && foot.pl <= env.lengthMm + CSBIN_EPS
        && foot.pw <= env.widthMm + CSBIN_EPS
        && !absurd;
      if (feasible) feasibleCount++;

      if (!feasible) {
        const cls = (typeof csPackV2ClassifyUnplaced === 'function')
          ? csPackV2ClassifyUnplaced(unit, env, { lastFailReason: absurd ? 'ABSURD' : 'OVERSIZE' })
          : { fitReason: 'FOOTPRINT_EXCEEDS', fitReasonMsg: 'Does not fit empty envelope' };
        unit.fitReason = cls.fitReason;
        unit.fitReasonMsg = cls.fitReasonMsg;
        unplaced.push({
          unit,
          _fmUid: unit._fmUid != null ? unit._fmUid : null,
          mark: unit.mark || null,
          fitReason: cls.fitReason,
          fitReasonMsg: cls.fitReasonMsg,
        });
        continue;
      }

      // Inflate floor axes by gap so neighbours nearly touch (R07)
      const iw = foot.pw + gapMm; // bin width axis
      const ih = foot.ph;         // height — no inflate
      const id = foot.pl + gapMm; // bin depth axis
      const weight = unitWeight(unit);
      const source = {
        name: String(unit.mark || unit._fmUid || ('u' + i)),
        width: iw, height: ih, depth: id, weight,
        allowedRotations: allowed,
        _unit: unit,
      };

      const canStack = enableStacks && isStackable(unit);
      const pivots = collectPivots(bin)
        .concat(extraFloorPivots(bin, env, foot, gapMm));
      let packed = null;
      for (let p = 0; p < pivots.length; p++) {
        const pos = pivots[p];
        const isStackPivot = pos[1] > CSBIN_EPS;
        if (isStackPivot && !canStack) continue;
        packed = tryPut(bin, source, iw, ih, id, weight, pos, allowed, {
          allowStack: canStack,
        });
        if (packed) break;
      }

      let placement = null;
      if (packed) {
        packed._unit = unit;
        placement = packedToPlacement(packed, gapMm);
        placement.unit = unit;
        placement.seatHow = 'binpack_pivot';
        pivotSeats++;
        // Keep free-rects in sync — split the rect that contains this seat
        if (typeof csPackV2ApplySplit === 'function' && freeRects.length
            && placement.layer === 'floor') {
          let rect = null;
          for (let ri = 0; ri < freeRects.length; ri++) {
            const r = freeRects[ri];
            if (!r) continue;
            if (+placement.x + CSBIN_EPS >= +r.x
                && +placement.z + CSBIN_EPS >= +r.z
                && +placement.x + +placement.pl <= +r.x + +r.length + CSBIN_EPS
                && +placement.z + +placement.pw <= +r.z + +r.width + CSBIN_EPS) {
              rect = r;
              break;
            }
          }
          if (rect) {
            const applied = csPackV2ApplySplit(freeRects, rect, placement, {
              gapMm,
              preferSideLane: true,
            });
            if (applied && applied.ok) freeRects = applied.freeRects;
          }
        }
      }

      // Fallback R05/R06 — Pack V2 free-rect floor (fills gaps pivots miss)
      if (!placement && typeof csPackV2FindFloorSeat === 'function' && freeRects.length) {
        const found = csPackV2FindFloorSeat(unit, freeRects, {
          envelope: env,
          placedBoxes,
          allowYaw: o.allowYaw !== false,
        });
        if (found && found.ok) {
          const packUnit = found.viewUnit || unit;
          const commit = csPackV2CommitFloorSeat(packUnit, found.seat, {
            envelope: env,
            rect: found.rect,
            placedBoxes,
          });
          if (commit && commit.ok && commit.placement) {
            placement = {
              ...commit.placement,
              unit,
              yawDeg: found.yawDeg || 0,
              corner: found.corner || null,
              rectId: found.rect && found.rect.id,
              seatHow: 'freerect_fallback',
              engine: 'binpackingjs_sequential',
            };
            const applied = (typeof csPackV2ApplySplit === 'function')
              ? csPackV2ApplySplit(freeRects, found.rect, commit.placement, {
                gapMm,
                preferSideLane: true,
              })
              : null;
            if (applied && applied.ok) freeRects = applied.freeRects;
            registerPlacementInBin(bin, placement, gapMm);
            freeRectSeats++;
          }
        }
      }

      // Fallback R08 — stack on heavier/equal pad
      if (!placement && canStack && placed.length
          && typeof csPackV2PlaceNestStacks === 'function') {
        const humanMaxTop = Math.max(0, +env.heightMm - CSBIN_HEADROOM_MM);
        const stackOne = csPackV2PlaceNestStacks([unit], placed, {
          envelope: env,
          containerSpec: o.containerSpec,
          bearingMin: o.bearingMin,
          maxTiers: 6,
          maxSupportTopMm: humanMaxTop,
        });
        if (stackOne && stackOne.stacked && stackOne.stacked.length) {
          placed.length = 0;
          (stackOne.placed || []).forEach(p => placed.push(p));
          placedBoxes.length = 0;
          for (let b = 0; b < placed.length; b++) {
            if (placed[b] && placed[b].box) placedBoxes.push(placed[b].box);
          }
          // Rebuild bin from placed (stack pass may rewrite set)
          bin.items.length = 0;
          for (let b = 0; b < placed.length; b++)
            registerPlacementInBin(bin, placed[b], gapMm);
          stackedPlacements.push(...stackOne.stacked);
          unit.fitReason = null;
          unit.fitReasonMsg = null;
          stackSeats++;
          if (feasible) feasiblePlaced++;
          continue;
        }
      }

      if (!placement) {
        const cls = (typeof csPackV2ClassifyUnplaced === 'function')
          ? csPackV2ClassifyUnplaced(unit, env, { lastFailReason: 'NO_PIVOT' })
          : { fitReason: 'NO_SLOT', fitReasonMsg: 'No binpacking seat' };
        unit.fitReason = cls.fitReason;
        unit.fitReasonMsg = cls.fitReasonMsg;
        unplaced.push({
          unit,
          _fmUid: unit._fmUid != null ? unit._fmUid : null,
          mark: unit.mark || null,
          fitReason: cls.fitReason,
          fitReasonMsg: cls.fitReasonMsg,
        });
        continue;
      }

      // R09 — reject only real dig-ins (>2 mm penetration), not face-touch
      let digs = false;
      if (placement.box) {
        for (let bi = 0; bi < placedBoxes.length; bi++) {
          if (boxesOverlap(placement.box, placedBoxes[bi], 2)) {
            digs = true;
            break;
          }
        }
      }
      if (digs) {
        if (packed && bin.items.length && bin.items[bin.items.length - 1] === packed)
          bin.items.pop();
        else if (placement.seatHow === 'freerect_fallback' && bin.items.length)
          bin.items.pop();
        const cls = (typeof csPackV2ClassifyUnplaced === 'function')
          ? csPackV2ClassifyUnplaced(unit, env, { lastFailReason: 'OVERLAP' })
          : { fitReason: 'OVERLAP', fitReasonMsg: 'Seat overlaps existing piece' };
        unit.fitReason = 'OVERLAP';
        unit.fitReasonMsg = cls.fitReasonMsg;
        unplaced.push({
          unit,
          _fmUid: unit._fmUid != null ? unit._fmUid : null,
          mark: unit.mark || null,
          fitReason: 'OVERLAP',
          fitReasonMsg: cls.fitReasonMsg,
        });
        continue;
      }

      unit.fitReason = null;
      unit.fitReasonMsg = null;
      placed.push(placement);
      if (placement.box) placedBoxes.push(placement.box);
      if (placement.layer === 'stack') stackedPlacements.push(placement);
      if (feasible) feasiblePlaced++;
    }

    // R18 gravity nail
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (!p || !p.box) continue;
      if (p.layer === 'stack' || p.role === 'nest_stack') {
        const y = (p.supportTopY != null) ? +p.supportTopY : +p.y;
        if (Number.isFinite(y)) {
          p.y = y;
          p.box.minY = y;
          p.box.maxY = y + Math.max(+p.ph || 0, 0);
          p.gravity = 'support_top';
        }
      } else {
        p.y = 0;
        p.box.minY = 0;
        p.box.maxY = Math.max(+p.ph || 0, 0);
        p.gravity = 'floor';
        p.layer = 'floor';
      }
    }

    let allFloorY0 = true;
    let allStacksOnSupport = true;
    let allNoOverlap = true;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (!p) continue;
      const isStack = p.role === 'nest_stack' || p.layer === 'stack';
      if (isStack) {
        if (!p.box
            || Math.abs(+p.box.minY - +p.y) > CSBIN_EPS
            || (p.supportTopY != null
                && Math.abs(+p.y - +p.supportTopY) > CSBIN_EPS)) {
          allStacksOnSupport = false;
        }
      } else if (p.y !== 0 || !p.box || p.box.minY !== 0) {
        allFloorY0 = false;
      }
      for (let j = i + 1; j < placed.length; j++) {
        const q = placed[j];
        if (p.box && q && q.box && boxesOverlap(p.box, q.box))
          allNoOverlap = false;
      }
    }

    const stackCount = placed.filter(p =>
      p && (p.role === 'nest_stack' || p.layer === 'stack')).length;
    const feasiblePlaceRate = feasibleCount > 0 ? feasiblePlaced / feasibleCount : 1;

    return {
      ok: true,
      strategy: 'binpack_human_order',
      engine: 'binpackingjs_sequential',
      rules: CS_BINPACK_RULES,
      designOk: allFloorY0 && allNoOverlap && allStacksOnSupport,
      allFloorY0,
      allStacksOnSupport,
      allNoOverlap,
      stackNoTwinDig: true,
      twinGapOk: true,
      twinFloorOk: true,
      twinNoDig: true,
      stripOk: true,
      stripAcceptable: true,
      enableStacks,
      placed,
      unplaced,
      freeRects,
      envelope: env,
      gapMm,
      pivotSeats,
      freeRectSeats,
      stackSeats,
      placedCount: placed.length,
      unplacedCount: unplaced.length,
      stackCount,
      twinCount: 0,
      twinPairsPlaced: 0,
      twinPlacedCount: 0,
      longNestPlacedCount: 0,
      stripReserveMm: 0,
      hasSideStrip: false,
      feasibleCount,
      feasiblePlaced,
      feasiblePlaceRate,
      absurdFootprintCount,
      stackPass: {
        stacked: stackedPlacements,
        stackCount,
        stillUnplaced: unplaced.slice(),
      },
      floor: {
        placed: placed.filter(p => p && p.layer !== 'stack' && p.role !== 'nest_stack'),
        unplaced,
        freeRects,
        feasibleCount,
        feasiblePlaced,
        feasiblePlaceRate,
        absurdFootprintCount,
      },
    };
  }

  function csBinPackAvailable() {
    return !!(bpLib() && typeof csBinPackPackHuman === 'function');
  }

  // Exports
  global.CS_BINPACK_RULES = CS_BINPACK_RULES;
  global.csBinPackPackHuman = csBinPackPackHuman;
  global.csBinPackAvailable = csBinPackAvailable;
})(typeof window !== 'undefined' ? window : globalThis);
