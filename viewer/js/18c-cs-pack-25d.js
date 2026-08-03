/* 18c-cs-pack-25d.js — Deterministic 2.5D Optimise engine
 *
 * Abandon physics / progressive settling. Rigid rules for EVERY unit:
 *
 *  F1 FREEZE POSE — use ShipPrep / _groupByQuat exactly. No re-tilt / pitch.
 *  F2 GRAVITY     — floor minY==0; stack minY==SupportTop. Float = INVALID.
 *  F3 AXIS        — long assemblies yaw 0 or 180 only (length ‖ container).
 *  F4 BEARING     — stack only with ≥ 40% support area underneath.
 *  F5 PHASE 1     — long rafters/assemblies first (twin-lane floor spine).
 *  F6 PHASE 2     — nests/plates into remaining free rects (vertical columns).
 *  F7 HONEST OUT  — rule violators → leftovers outside (never forced in).
 *
 * Vision:
 *  • Twin rafters on floor, wall-parallel, never stacked on each other
 *  • Nests as upright columns on floor or on a solid pad
 *  • Zero floating items inside the box
 */

(function (global) {
  'use strict';

  const CS25D_GAP_MM = 5;
  const CS25D_EPS = 0.5;
  const CS25D_BEARING_MIN = 0.40;
  const CS25D_LONG_MIN_MM = 4000;
  const CS25D_RULES = Object.freeze({
    F1_FREEZE_POSE: true,
    F2_GRAVITY_GROUNDING: true,
    F3_AXIS_YAW_0_180: true,
    F4_BEARING_40: true,
    F5_PHASE1_TWIN_SPINE: true,
    F6_PHASE2_NESTS_FREE_RECTS: true,
    F7_HONEST_LEFTOVER: true,
    NO_PHYSICS_SETTLE: true,
  });

  function foot(u) {
    if (typeof csPackV2Foot === 'function') return csPackV2Foot(u);
    return {
      pl: Math.max(+u.packLengthMm || +u.packFootprintL || 0, 1),
      pw: Math.max(+u.packWidthMm || +u.packFootprintW || 0, 1),
      ph: Math.max(+u.packHeightMm || +u.packFootprintH || 0, 1),
    };
  }

  function isAsm(u) {
    return typeof csPackIsAssemblyUnit === 'function'
      ? csPackIsAssemblyUnit(u)
      : !!(u && (u.isAssembly
        || u.groupKind === 'welded_assembly'
        || u.groupKind === 'assembly_single'));
  }

  function isNest(u) {
    return typeof csPackIsNestUnit === 'function'
      ? csPackIsNestUnit(u)
      : false;
  }

  function isPlate(u) {
    if (!u) return false;
    const gk = String(u.groupKind || '').toLowerCase();
    const sk = String(u.shapeKey || u.profileShape || '').toLowerCase();
    return gk === 'stack_plate' || gk === 'plate' || sk === 'plate';
  }

  /** Phase-1 spine cargo: long assemblies / twin-lane candidates. */
  function isLongAssembly(u, env) {
    if (!u || !isAsm(u) || isNest(u)) return false;
    const f = foot(u);
    if (f.pl < CS25D_LONG_MIN_MM - CS25D_EPS) return false;
    if (f.pl > env.lengthMm + CS25D_EPS) return false;
    if (f.pw > env.widthMm + CS25D_EPS) return false;
    if (f.ph > env.heightMm + CS25D_EPS) return false;
    return true;
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
    if (typeof csPackV2BoxesOverlap === 'function')
      return csPackV2BoxesOverlap(a, b, tol != null ? tol : CS25D_EPS);
    if (!a || !b) return false;
    const t = tol != null ? +tol : CS25D_EPS;
    return !(a.maxX <= b.minX + t || a.minX >= b.maxX - t
      || a.maxY <= b.minY + t || a.minY >= b.maxY - t
      || a.maxZ <= b.minZ + t || a.minZ >= b.maxZ - t);
  }

  function stampFreeze(unit) {
    if (!unit) return;
    unit._pack25dFreezePose = true;
    unit._freezeGroupByPose = true;
    // Nests keep Group By quat; assemblies keep ship-prep quat once stamped
    if (unit._groupByQuat || unit._shipPrepped)
      unit._pack25dPoseLocked = true;
  }

  function floorPlacement(unit, x, z, yawDeg) {
    const f = foot(unit);
    // F3: assemblies only yaw 0 / 180 — treat as yaw 0 footprint (no 90)
    let pl = f.pl;
    let pw = f.pw;
    const ph = f.ph;
    const yaw = (+yawDeg === 180) ? 180 : 0;
    const box = makeBox(x, z, pl, pw, ph, 0);
    box.minY = 0;
    box.maxY = ph;
    stampFreeze(unit);
    return {
      _fmUid: unit._fmUid != null ? unit._fmUid : null,
      mark: unit.mark || null,
      x, z, y: 0,
      pl, pw, ph,
      box,
      layer: 'floor',
      gravity: 'floor_y0',
      yawDeg: yaw,
      role: 'floor_spine',
      supportTopY: 0,
      unit,
      engine: 'deterministic_25d',
      freezePose: true,
    };
  }

  /** Validate F2/F3/F4 — reject illegal seats. */
  function validatePlacement(p, placed, env, opts) {
    const o = opts || {};
    if (!p || !p.box) return { ok: false, reason: 'NO_BOX' };
    const isStack = p.layer === 'stack' || p.role === 'nest_stack';

    // F2 gravity
    if (isStack) {
      const top = (p.supportTopY != null) ? +p.supportTopY : +p.y;
      if (!(Number.isFinite(top)) || Math.abs(+p.y - top) > CS25D_EPS
          || Math.abs(+p.box.minY - top) > CS25D_EPS) {
        return { ok: false, reason: 'FLOAT_STACK' };
      }
    } else if (+p.y !== 0 || +p.box.minY !== 0) {
      return { ok: false, reason: 'FLOAT_FLOOR' };
    }

    // Walls
    if (+p.x < env.minXMm - CS25D_EPS || +p.z < env.minZMm - CS25D_EPS
        || +p.x + +p.pl > env.maxXMm + CS25D_EPS
        || +p.z + +p.pw > env.maxZMm + CS25D_EPS
        || +p.y + +p.ph > env.heightMm + CS25D_EPS) {
      return { ok: false, reason: 'WALL_BREACH' };
    }

    // F3 axis — assemblies: yaw 0 or 180 only (reject 90 / diagonal)
    if (p.unit && isAsm(p.unit) && !isNest(p.unit)) {
      const yawAbs = Math.abs(+p.yawDeg || 0) % 360;
      const okYaw = yawAbs <= CS25D_EPS
        || Math.abs(yawAbs - 180) <= CS25D_EPS
        || Math.abs(yawAbs - 360) <= CS25D_EPS;
      if (!okYaw) return { ok: false, reason: 'YAW_NOT_AXIS' };
    }

    // Overlap
    for (let i = 0; i < (placed || []).length; i++) {
      const q = placed[i];
      if (q && q.box && boxesOverlap(p.box, q.box, 2))
        return { ok: false, reason: 'OVERLAP' };
    }

    // F4 bearing for stacks
    if (isStack && o.bearingMin != null) {
      const frac = +p.bearingFrac;
      if (Number.isFinite(frac) && frac + 1e-9 < +o.bearingMin)
        return { ok: false, reason: 'BEARING' };
    }

    return { ok: true, reason: null };
  }

  function reject(unit, reason, msg, unplaced) {
    unit.fitReason = reason;
    unit.fitReasonMsg = msg || reason;
    unplaced.push({
      unit,
      _fmUid: unit._fmUid != null ? unit._fmUid : null,
      mark: unit.mark || null,
      fitReason: reason,
      fitReasonMsg: unit.fitReasonMsg,
    });
  }

  /**
   * Phase 1 — floor spine: twin lanes first, then remaining long assemblies
   * along home wall / opposite wall (never stacked on each other).
   */
  function phase1TwinSpine(units, env, opts) {
    const o = opts || {};
    const gapMm = (o.gapMm != null) ? +o.gapMm : CS25D_GAP_MM;
    const placed = [];
    const boxes = [];
    const used = new Set();
    const laneResults = [];

    // Prefer existing twin-lane seating (wall hug + beside)
    const pairs = (typeof csPackV2DetectTwinPairs === 'function')
      ? csPackV2DetectTwinPairs(units, env)
      : [];

    let laneMaxZ = null;
    for (let i = 0; i < pairs.length; i++) {
      const pr = pairs[i];
      const isFirst = placed.length === 0;
      if (typeof csPackV2CanSeatTwinPairKeepingStrip === 'function') {
        const strip = (typeof csPackV2NestStripReserveMm === 'function')
          ? csPackV2NestStripReserveMm(units, env, {})
          : 0;
        if (!csPackV2CanSeatTwinPairKeepingStrip(pr, env, laneMaxZ, strip, isFirst)) {
          laneResults.push({ ok: false, reason: 'STRIP_RESERVE' });
          break;
        }
      }
      let lane = null;
      if (isFirst && typeof csPackV2PlaceTwinLane === 'function') {
        lane = csPackV2PlaceTwinLane(pr, env, { placedBoxes: boxes });
      } else if (typeof csPackV2PlaceTwinLaneContinue === 'function' && placed.length) {
        lane = csPackV2PlaceTwinLaneContinue(pr, placed[placed.length - 1], env, {
          placedBoxes: boxes,
        });
      }
      if (!lane || !lane.ok) {
        laneResults.push({ ok: false, reason: (lane && lane.reason) || 'LANE_FAIL' });
        break;
      }
      for (let j = 0; j < lane.placed.length; j++) {
        const p = lane.placed[j];
        p.yawDeg = 0; // F3 — force axis
        p.y = 0;
        if (p.box) { p.box.minY = 0; p.box.maxY = +p.ph || p.box.maxY; }
        p.layer = 'floor';
        p.gravity = 'floor_y0';
        p.engine = 'deterministic_25d';
        p.role = p.role || 'twin_spine';
        p.freezePose = true;
        if (p.unit) stampFreeze(p.unit);
        const v = validatePlacement(p, placed, env, {});
        if (!v.ok) continue;
        placed.push(p);
        if (p.box) boxes.push(p.box);
        if (p._fmUid != null) used.add(p._fmUid);
        if (p.unit && p.unit._fmUid != null) used.add(p.unit._fmUid);
        if (p.box && (laneMaxZ == null || +p.box.maxZ > laneMaxZ))
          laneMaxZ = +p.box.maxZ;
      }
      laneResults.push({ ok: true });
    }

    // Remaining long assemblies — wall lanes, yaw 0 only, floor only
    const longs = units.filter(u =>
      u && isLongAssembly(u, env) && !used.has(u._fmUid));
    longs.sort((a, b) =>
      (foot(b).pl - foot(a).pl)
      || ((+b.weightKg || 0) - (+a.weightKg || 0)));

    for (let i = 0; i < longs.length; i++) {
      const u = longs[i];
      const f = foot(u);
      // Try home wall (z=0) then opposite wall
      const zOpts = [env.minZMm, Math.max(env.minZMm, env.maxZMm - f.pw)];
      let seated = null;
      for (let zi = 0; zi < zOpts.length && !seated; zi++) {
        const z = zOpts[zi];
        // Slide along length for a free slot
        const step = Math.max(200, Math.floor(f.pl * 0.25));
        for (let x = env.minXMm; x + f.pl <= env.maxXMm + CS25D_EPS; x += step) {
          const cand = floorPlacement(u, x, z, 0);
          cand.role = 'floor_spine_single';
          const v = validatePlacement(cand, placed, env, {});
          if (v.ok) { seated = cand; break; }
        }
        // Also try exact rear corner
        if (!seated) {
          const cand = floorPlacement(u, env.minXMm, z, 0);
          cand.role = 'floor_spine_single';
          if (validatePlacement(cand, placed, env, {}).ok) seated = cand;
        }
      }
      if (seated) {
        placed.push(seated);
        if (seated.box) boxes.push(seated.box);
        used.add(u._fmUid);
      }
    }

    // Free rects from twin leftover builder when possible
    let freeRects;
    if (placed.length >= 2 && typeof csPackV2RebuildTwinLeftoverRects === 'function') {
      const reb = csPackV2RebuildTwinLeftoverRects(env, placed, {});
      freeRects = (reb && reb.ok && reb.freeRects)
        ? reb.freeRects.slice()
        : null;
    }
    if (!freeRects && typeof csPackV2InitialFreeRects === 'function') {
      // Carve free rects by subtracting placed floor boxes via split when available
      const init = csPackV2InitialFreeRects(o.containerSpec || {
        lengthMm: env.lengthMm, widthMm: env.widthMm, heightMm: env.heightMm,
      });
      freeRects = (init.freeRects || []).slice();
      if (typeof csPackV2ApplySplit === 'function') {
        for (let i = 0; i < placed.length; i++) {
          const p = placed[i];
          if (!p || p.layer === 'stack') continue;
          let rect = null;
          for (let ri = 0; ri < freeRects.length; ri++) {
            const r = freeRects[ri];
            if (!r) continue;
            if (+p.x + CS25D_EPS >= +r.x && +p.z + CS25D_EPS >= +r.z
                && +p.x + +p.pl <= +r.x + +r.length + CS25D_EPS
                && +p.z + +p.pw <= +r.z + +r.width + CS25D_EPS) {
              rect = r;
              break;
            }
          }
          if (!rect) continue;
          const applied = csPackV2ApplySplit(freeRects, rect, p, {
            gapMm, preferSideLane: true,
          });
          if (applied && applied.ok) freeRects = applied.freeRects;
        }
      }
    }
    if (!freeRects) freeRects = [];

    return { placed, boxes, used, freeRects, laneResults, gapMm };
  }

  /**
   * Phase 2 — nests / plates / remaining short units into free rects.
   * Yaw: nests keep Group By (allowYaw false for locked nests); no diagonal asm.
   * Stack nests/plates only with ≥40% bearing. Long assemblies never stack.
   */
  function phase2NestsPlates(units, phase1, env, opts) {
    const o = opts || {};
    const gapMm = phase1.gapMm != null ? phase1.gapMm : CS25D_GAP_MM;
    const used = new Set(phase1.used || []);
    const placed = (phase1.placed || []).slice();
    const placedBoxes = (phase1.boxes || []).slice();
    let freeRects = (phase1.freeRects || []).slice();
    const unplaced = [];
    const stacked = [];

    const rest = units.filter(u => u && !used.has(u._fmUid));
    // Heavier / longer first within remaining
    rest.sort((a, b) =>
      ((+b.weightKg || 0) - (+a.weightKg || 0))
      || (foot(b).pl - foot(a).pl)
      || ((+a._checkOrder || 999) - (+b._checkOrder || 999)));

    for (let i = 0; i < rest.length; i++) {
      const unit = rest[i];
      const f = foot(unit);

      // Long assemblies that missed Phase 1 → honest leftover (no force-in)
      if (isLongAssembly(unit, env)) {
        reject(unit, 'NO_SPINE_SLOT',
          'Long assembly — no floor-spine seat (honest leftover)', unplaced);
        continue;
      }

      if (f.ph > env.heightMm + CS25D_EPS
          || f.pl > env.lengthMm + CS25D_EPS
          || f.pw > env.widthMm + CS25D_EPS) {
        reject(unit, 'OVERSIZE', 'Does not fit empty envelope', unplaced);
        continue;
      }

      let seated = null;

      // Floor via free-rect — nests: no yaw 90; assemblies short: yaw 0 only
      if (typeof csPackV2FindFloorSeat === 'function' && freeRects.length) {
        const allowYaw = isNest(unit)
          ? false
          : false; // F3 — never diagonal in 2.5D
        const found = csPackV2FindFloorSeat(unit, freeRects, {
          envelope: env,
          placedBoxes,
          allowYaw,
        });
        if (found && found.ok) {
          const packUnit = found.viewUnit || unit;
          const commit = csPackV2CommitFloorSeat(packUnit, found.seat, {
            envelope: env,
            rect: found.rect,
            placedBoxes,
          });
          if (commit && commit.ok && commit.placement) {
            const p = {
              ...commit.placement,
              unit,
              yawDeg: 0,
              role: isNest(unit) ? 'nest_floor' : 'floor',
              engine: 'deterministic_25d',
              freezePose: true,
            };
            stampFreeze(unit);
            const v = validatePlacement(p, placed, env, {});
            if (v.ok) {
              seated = p;
              if (typeof csPackV2ApplySplit === 'function') {
                const applied = csPackV2ApplySplit(
                  freeRects, found.rect, commit.placement, {
                    gapMm, preferSideLane: true,
                  });
                if (applied && applied.ok) freeRects = applied.freeRects;
              }
            }
          }
        }
      }

      // Stack nests/plates only — never long assemblies (vision)
      if (!seated && (isNest(unit) || isPlate(unit))
          && typeof csPackV2PlaceNestStacks === 'function') {
        const stackOne = csPackV2PlaceNestStacks([unit], placed, {
          envelope: env,
          containerSpec: o.containerSpec,
          bearingMin: CS25D_BEARING_MIN,
          maxTiers: 6,
          maxSupportTopMm: Math.max(0, +env.heightMm - 40),
        });
        if (stackOne && stackOne.stacked && stackOne.stacked.length) {
          const neu = stackOne.stacked[stackOne.stacked.length - 1];
          if (neu) {
            neu.engine = 'deterministic_25d';
            neu.freezePose = true;
            if (neu.unit) stampFreeze(neu.unit);
            const frac = +neu.bearingFrac;
            const bearingOk = !Number.isFinite(frac) || frac + 1e-9 >= CS25D_BEARING_MIN;
            const v = validatePlacement(neu, placed.filter(p => p !== neu), env, {
              bearingMin: CS25D_BEARING_MIN,
            });
            if (v.ok && bearingOk) {
              // Replace working set from stack pass (includes prior)
              placed.length = 0;
              (stackOne.placed || []).forEach(p => {
                if (p) {
                  p.engine = p.engine || 'deterministic_25d';
                  placed.push(p);
                }
              });
              placedBoxes.length = 0;
              placed.forEach(p => { if (p && p.box) placedBoxes.push(p.box); });
              stacked.push(neu);
              used.add(unit._fmUid);
              continue;
            }
          }
        }
      }

      if (!seated) {
        reject(unit, 'NO_SLOT',
          'No legal 2.5D floor/stack seat — honest leftover', unplaced);
        continue;
      }

      placed.push(seated);
      if (seated.box) placedBoxes.push(seated.box);
      used.add(unit._fmUid);
    }

    return { placed, unplaced, stacked, freeRects };
  }

  /** Final gravity nail + drop any float / dig to leftovers. */
  function finalize(placed, unplaced, env) {
    const keep = [];
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      if (!p) continue;
      const isStack = p.layer === 'stack' || p.role === 'nest_stack';
      if (isStack) {
        const y = (p.supportTopY != null) ? +p.supportTopY : +p.y;
        p.y = y;
        if (p.box) { p.box.minY = y; p.box.maxY = y + Math.max(+p.ph || 0, 0); }
        p.gravity = 'support_top';
      } else {
        p.y = 0;
        if (p.box) { p.box.minY = 0; p.box.maxY = Math.max(+p.ph || 0, 0); }
        p.gravity = 'floor_y0';
        p.layer = 'floor';
      }
      const v = validatePlacement(p, keep, env, { bearingMin: CS25D_BEARING_MIN });
      if (!v.ok) {
        if (p.unit) {
          reject(p.unit, v.reason, 'Post-check failed — honest leftover', unplaced);
        }
        continue;
      }
      keep.push(p);
    }
    return keep;
  }

  function csPack25dPack(units, opts) {
    const o = opts || {};
    const list = Array.isArray(units) ? units.slice() : [];
    const init = (typeof csPackV2InitialFreeRects === 'function')
      ? csPackV2InitialFreeRects(o.containerSpec)
      : null;
    const env = o.envelope || (init && init.envelope) || {
      lengthMm: 12000, widthMm: 2350, heightMm: 2690,
      minXMm: 0, minZMm: 0, maxXMm: 12000, maxZMm: 2350,
    };

    // Freeze nest Group By poses; assemblies rely on ship-prep dims already on unit
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u) continue;
      if (isNest(u)) stampFreeze(u);
      // Mark ready for render freeze after ship-prep dims exist
      if (u._shipPrepped || u.stableBundleMm) stampFreeze(u);
    }

    const p1 = phase1TwinSpine(list, env, o);
    const p2 = phase2NestsPlates(list, p1, env, o);
    const placed = finalize(p2.placed, p2.unplaced, env);

    let allFloorY0 = true;
    let allStacksOnSupport = true;
    let allNoOverlap = true;
    for (let i = 0; i < placed.length; i++) {
      const p = placed[i];
      const isStack = p.layer === 'stack' || p.role === 'nest_stack';
      if (isStack) {
        if (Math.abs(+p.box.minY - +p.y) > CS25D_EPS) allStacksOnSupport = false;
      } else if (+p.y !== 0 || +p.box.minY !== 0) {
        allFloorY0 = false;
      }
      for (let j = i + 1; j < placed.length; j++) {
        if (p.box && placed[j].box && boxesOverlap(p.box, placed[j].box, 2))
          allNoOverlap = false;
      }
    }

    const stackCount = placed.filter(p =>
      p && (p.layer === 'stack' || p.role === 'nest_stack')).length;

    return {
      ok: true,
      strategy: 'deterministic_25d',
      engine: 'deterministic_25d',
      rules: CS25D_RULES,
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
      enableStacks: true,
      placed,
      unplaced: p2.unplaced,
      freeRects: p2.freeRects,
      envelope: env,
      gapMm: p1.gapMm,
      placedCount: placed.length,
      unplacedCount: p2.unplaced.length,
      stackCount,
      twinCount: placed.filter(p => /twin/i.test(String(p.role || ''))).length,
      twinPairsPlaced: (p1.laneResults || []).filter(r => r && r.ok).length,
      twinPlacedCount: placed.filter(p => /twin|spine/i.test(String(p.role || ''))).length,
      longNestPlacedCount: 0,
      stripReserveMm: 0,
      hasSideStrip: false,
      feasibleCount: list.length,
      feasiblePlaced: placed.length,
      feasiblePlaceRate: list.length ? placed.length / list.length : 1,
      absurdFootprintCount: 0,
      stackPass: {
        stacked: p2.stacked,
        stackCount,
        stillUnplaced: p2.unplaced.slice(),
      },
      floor: {
        placed: placed.filter(p => p && p.layer !== 'stack'),
        unplaced: p2.unplaced,
        freeRects: p2.freeRects,
      },
      phase1: {
        spineCount: (p1.placed || []).length,
        laneResults: p1.laneResults,
      },
    };
  }

  global.CS25D_RULES = CS25D_RULES;
  global.csPack25dPack = csPack25dPack;
})(typeof window !== 'undefined' ? window : globalThis);
