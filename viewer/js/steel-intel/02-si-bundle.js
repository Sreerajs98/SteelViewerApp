/* 02-si-bundle.js — Steel Intelligence Layer: logical bundles (metadata only)
 *
 * Builds SI bundles from existing packUnits. Does not merge geometry, remesh,
 * alter nestPieces, dimensions, Group By, or packer seats.
 *
 * Optional: 00-si-types.js, 01-si-classify.js
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  var BT = SI.BUNDLE_TYPE || {};
  var PC = SI.PROFILE_CLASS || {};

  var BUNDLE = {
    twin_beam: BT.TWIN_BEAM || 'twin_beam',
    solo_beam: BT.SOLO_BEAM || 'solo_beam',
    nest_z: BT.NEST_Z || 'nest_z',
    nest_c: BT.NEST_C || 'nest_c',
    nest_l: BT.NEST_L || 'nest_l',
    plate_stack: BT.PLATE_STACK || 'plate_stack',
    rhs_unit: BT.RHS_UNIT || 'rhs_unit',
    filler: BT.FILLER || 'filler',
    leftover: BT.LEFTOVER || 'leftover',
  };

  var PROFILE = {
    assembly: (PC && PC.ASSEMBLY) || 'assembly',
    i_beam: (PC && PC.I_BEAM) || 'i_beam',
    h_beam: (PC && PC.H_BEAM) || 'h_beam',
    channel_z: (PC && PC.CHANNEL_Z) || 'channel_z',
    channel_c: (PC && PC.CHANNEL_C) || 'channel_c',
    angle: (PC && PC.ANGLE) || 'angle',
    plate: (PC && PC.PLATE) || 'plate',
    rhs: (PC && PC.RHS) || 'rhs',
    chs: (PC && PC.CHS) || 'chs',
    rod: (PC && PC.ROD) || 'rod',
    bent_rod: (PC && PC.BENT_ROD) || 'bent_rod',
    loose: (PC && PC.LOOSE) || 'loose',
    unknown: (PC && PC.UNKNOWN) || 'unknown',
  };

  // Short id prefixes (stable, human-readable)
  var ID_PREFIX = {
    twin_beam: 'twin',
    solo_beam: 'solo',
    nest_z: 'nest',
    nest_c: 'nest',
    nest_l: 'nest',
    plate_stack: 'plate',
    rhs_unit: 'rhs',
    filler: 'filler',
    leftover: 'left',
  };

  // ── Internals ─────────────────────────────────────────────────────────────

  function str(v) {
    return v == null ? '' : String(v);
  }

  function lower(v) {
    return str(v).toLowerCase();
  }

  function num(v, fallback) {
    var n = +v;
    return (n > 0 && isFinite(n)) ? n : (fallback || 0);
  }

  function unitLengthMm(pu) {
    if (!pu) return 0;
    return Math.max(
      num(pu.lengthMaxMm),
      num(pu.lengthMm),
      num(pu.packFootprintL),
      num(pu.packLengthMm),
      pu.stableBundleMm ? num(pu.stableBundleMm.l) : 0,
      0
    );
  }

  function unitSect(pu) {
    return {
      H: num(pu && pu.sectH),
      W: num(pu && pu.sectW),
      T: num(pu && pu.sectT),
    };
  }

  function unitShapeKey(pu) {
    return lower((pu && (pu.shapeKey || pu.profileShape)) || '');
  }

  function unitGroupKind(pu) {
    return lower((pu && pu.groupKind) || '');
  }

  function stagingId(pu, index) {
    var id = (pu && (pu.stagingGroupId || pu.groupId)) || '';
    if (id) return str(id);
    return 'U' + index;
  }

  function setIndex(pu, index) {
    var i = pu && pu.packUnitIndex;
    if (i != null && isFinite(+i)) return Math.max(0, Math.floor(+i));
    return index;
  }

  /**
   * Stable mark family prefix (e.g. RF, CL, PL) — weak pairing signal.
   * @param {object} pu
   * @returns {string}
   */
  function getMarkFamily(pu) {
    var m = '';
    if (pu) {
      if (pu.marks && pu.marks.length) m = str(pu.marks[0]);
      else m = str(pu.mark);
    }
    m = m.trim().toUpperCase();
    // Strip display suffixes like " · set 1"
    m = m.replace(/\s*·\s*SET\s*\d+.*$/i, '').trim();
    var pref = m.match(/^([A-Z]{1,6})/);
    return pref ? pref[1] : '';
  }

  /**
   * Stable bundle id: {prefix}:{stagingGroupId}:set{packUnitIndex}
   * @param {string} bundleType
   * @param {string} stagingGroupId
   * @param {number} packUnitIndex
   * @returns {string}
   */
  function createBundleId(bundleType, stagingGroupId, packUnitIndex) {
    var prefix = ID_PREFIX[bundleType] || lower(bundleType) || 'bundle';
    var gid = str(stagingGroupId || 'G').replace(/[^\w.\-]+/g, '_').slice(0, 48);
    var set = (packUnitIndex != null && isFinite(+packUnitIndex))
      ? Math.max(0, Math.floor(+packUnitIndex))
      : 0;
    // Keep family in nest ids when short prefix collapses z/c/l
    if (bundleType === BUNDLE.nest_z
        || bundleType === BUNDLE.nest_c
        || bundleType === BUNDLE.nest_l) {
      return prefix + '_' + bundleType.replace('nest_', '')
        + ':' + gid + ':set' + set;
    }
    return prefix + ':' + gid + ':set' + set;
  }

  /**
   * Length tolerance by profile family.
   * @param {string} profileClass
   * @returns {number} mm
   */
  function lengthTolMm(profileClass) {
    if (profileClass === PROFILE.assembly) return 150;
    return 100; // beams
  }

  /**
   * Score twin suitability (higher = better). -1 = reject.
   * @param {object} a  row { pu, cls, index }
   * @param {object} b
   * @returns {number}
   */
  function twinScore(a, b) {
    if (!a || !b || !a.pu || !b.pu) return -1;
    var ca = a.cls || {};
    var cb = b.cls || {};
    if (ca.fitVerdict === 'oversize_plan' || cb.fitVerdict === 'oversize_plan')
      return -1;

    var pa = ca.profileClass;
    var pb = cb.profileClass;
    var beamFam = function (p) {
      return p === PROFILE.assembly || p === PROFILE.i_beam || p === PROFILE.h_beam;
    };
    if (!beamFam(pa) || !beamFam(pb)) return -1;
    // Same family band: assembly↔assembly, or beam↔beam (i/h interchangeable)
    var aAsm = pa === PROFILE.assembly;
    var bAsm = pb === PROFILE.assembly;
    if (aAsm !== bAsm) return -1;

    var La = unitLengthMm(a.pu);
    var Lb = unitLengthMm(b.pu);
    var dL = Math.abs(La - Lb);
    var tol = Math.max(lengthTolMm(pa), lengthTolMm(pb));
    if (dL > tol) return -1;

    var sa = unitSect(a.pu);
    var sb = unitSect(b.pu);
    if (sa.H > 0 && sb.H > 0 && Math.abs(sa.H - sb.H) > Math.max(5, sa.H * 0.02))
      return -1;
    if (sa.W > 0 && sb.W > 0 && Math.abs(sa.W - sb.W) > Math.max(5, sa.W * 0.02))
      return -1;

    var score = 1000 - dL;
    if (unitShapeKey(a.pu) && unitShapeKey(a.pu) === unitShapeKey(b.pu))
      score += 200;
    var fa = getMarkFamily(a.pu);
    var fb = getMarkFamily(b.pu);
    if (fa && fb && fa === fb) score += 150;
    score += Math.min(La, Lb) * 0.001;
    return score;
  }

  /**
   * Find best unpaired twin mate for row in pool.
   * @param {object} row
   * @param {object[]} pool  rows still unpaired
   * @returns {object|null} mate row
   */
  function findTwinCandidate(row, pool) {
    if (!row || !pool || !pool.length) return null;
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < pool.length; i++) {
      var other = pool[i];
      if (!other || other === row || other._paired) continue;
      if (other.index === row.index) continue;
      var sc = twinScore(row, other);
      if (sc > bestScore) {
        bestScore = sc;
        best = other;
      }
    }
    return bestScore >= 0 ? best : null;
  }

  /**
   * Member identity for load-plan / hints resolve.
   * packUnitIndex = 1-based "set N"; arrayIndex = 0-based in group.packUnits.
   * @param {object} pu
   * @param {number} index  flat packUnits index
   * @param {number} [arrayIndex]
   * @param {string} [groupId]
   */
  function memberRef(pu, index, arrayIndex, groupId) {
    var gid = groupId || stagingId(pu, index);
    var set = setIndex(pu, index);
    var arr = (arrayIndex != null && isFinite(+arrayIndex))
      ? Math.max(0, Math.floor(+arrayIndex))
      : null;
    return {
      stagingGroupId: gid,
      packUnitIndex: set,
      arrayIndex: arr,
      mark: pu ? (pu.mark || null) : null,
      unitIndex: index,
    };
  }

  /**
   * Singleton bundleType for an unmatched (non-twin) packUnit.
   * @param {object} pu
   * @param {object} cls
   * @returns {string}
   */
  function singletonBundleType(pu, cls) {
    var c = cls || emptyClass();
    if (c.fitVerdict === 'oversize_plan') return BUNDLE.leftover;
    if (isBeamProfile(c.profileClass)) return BUNDLE.solo_beam;
    var nestType = nestBundleType(pu, c);
    if (nestType) return nestType;
    if (isPlateUnit(pu, c)) return BUNDLE.plate_stack;
    if (isRhsUnit(pu, c)) return BUNDLE.rhs_unit;
    return BUNDLE.filler;
  }

  /**
   * Default loadRole / reason extras for a singleton type.
   * @param {string} bundleType
   * @param {object} cls
   * @param {object} pu
   * @returns {object}
   */
  function singletonExtras(bundleType, cls, pu) {
    var c = cls || emptyClass();
    if (bundleType === BUNDLE.leftover) {
      return {
        loadRole: 'leftover_candidate',
        reason: (c.reason || '') + '; leftover bundle',
      };
    }
    if (bundleType === BUNDLE.solo_beam) {
      return {
        loadRole: 'floor_anchor',
        reason: (c.reason || '') + '; solo beam',
      };
    }
    if (bundleType === BUNDLE.nest_z
        || bundleType === BUNDLE.nest_c
        || bundleType === BUNDLE.nest_l) {
      return {
        loadRole: 'nest_strip',
        reason: (c.reason || '') + '; nest identity bundle',
      };
    }
    if (bundleType === BUNDLE.plate_stack) {
      return {
        loadRole: 'plate_deck',
        reason: (c.reason || '') + '; plate stack identity',
      };
    }
    if (bundleType === BUNDLE.rhs_unit) {
      return {
        loadRole: c.loadRole || 'filler',
        lotId: rhsLotId(pu),
        reason: (c.reason || '') + '; rhs unit (no merge)',
      };
    }
    return {
      loadRole: c.loadRole || 'filler',
      reason: (c.reason || '') + '; filler',
    };
  }

  function emptyClass() {
    return {
      profileClass: PROFILE.unknown,
      loadRole: 'filler',
      stackPolicy: 'never',
      fitVerdict: 'fits_floor',
      reason: '',
    };
  }

  function resolveClass(pu, cls, parentHint) {
    if (cls && cls.profileClass) return cls;
    if (typeof SI.classifyPackUnit === 'function') {
      try {
        return SI.classifyPackUnit(pu, parentHint || null);
      } catch (_) { /* */ }
    }
    return emptyClass();
  }

  /**
   * Basic priority band (metadata only — not a load sequence).
   * @param {string} bundleType
   * @param {object} cls
   * @returns {number}
   */
  function bundlePriority(bundleType, cls) {
    if (bundleType === BUNDLE.leftover
        || (cls && cls.fitVerdict === 'oversize_plan')) return 90;
    if (bundleType === BUNDLE.twin_beam) return 10;
    if (bundleType === BUNDLE.solo_beam) return 15;
    if (bundleType === BUNDLE.nest_z
        || bundleType === BUNDLE.nest_c
        || bundleType === BUNDLE.nest_l) return 30;
    if (bundleType === BUNDLE.plate_stack) return 40;
    if (bundleType === BUNDLE.rhs_unit) return 50;
    return 60;
  }

  /**
   * Optional RHS lot key (does not merge units).
   * @param {object} pu
   * @returns {string}
   */
  function rhsLotId(pu) {
    var sk = unitShapeKey(pu) || 'rhs';
    var s = unitSect(pu);
    var L = unitLengthMm(pu);
    var Lband = Math.round(L / 100) * 100;
    var H = Math.round(s.H || 0);
    var W = Math.round(s.W || 0);
    return 'rhs_lot:' + sk + '|H' + H + '|W' + W + '|L' + Lband;
  }

  function isBeamProfile(pc) {
    return pc === PROFILE.assembly
      || pc === PROFILE.i_beam
      || pc === PROFILE.h_beam;
  }

  function nestBundleType(pu, cls) {
    var gk = unitGroupKind(pu);
    if (gk === 'nest_z') return BUNDLE.nest_z;
    if (gk === 'nest_c') return BUNDLE.nest_c;
    if (gk === 'nest_l') return BUNDLE.nest_l;
    var pc = cls && cls.profileClass;
    if (pc === PROFILE.channel_z) return BUNDLE.nest_z;
    if (pc === PROFILE.channel_c) return BUNDLE.nest_c;
    if (pc === PROFILE.angle) return BUNDLE.nest_l;
    return null;
  }

  function isPlateUnit(pu, cls) {
    var gk = unitGroupKind(pu);
    if (gk === 'stack_plate') return true;
    return !!(cls && cls.profileClass === PROFILE.plate);
  }

  function isRhsUnit(pu, cls) {
    var gk = unitGroupKind(pu);
    if (gk === 'bundle_rhs') return true;
    var pc = cls && cls.profileClass;
    return pc === PROFILE.rhs || pc === PROFILE.chs;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Create logical SI bundles from existing packUnits (metadata only).
   * Every input packUnit belongs to exactly one bundle (no geometry merge).
   *
   * @param {object[]} packUnits
   * @param {object[]} classifiedMap  parallel to packUnits; each
   *   { profileClass, loadRole, stackPolicy, fitVerdict, reason? }
   * @param {object} [opts]
   * @param {object[]} [opts.parents]  staging groups parallel to packUnits
   * @param {object[]} [opts.rows]     collectPackUnits rows (arrayIndex, group)
   * @returns {{ bundles: object[], unitHints: object[] }}
   */
  function createBundles(packUnits, classifiedMap, opts) {
    var units = packUnits || [];
    var classes = classifiedMap || [];
    var options = opts || {};
    var parents = options.parents || [];
    var metaRows = options.rows || [];
    var rows = [];
    var i;

    for (i = 0; i < units.length; i++) {
      var pu = units[i];
      if (!pu) continue;
      var parent = parents[i] || (metaRows[i] && metaRows[i].group) || null;
      var cls = resolveClass(pu, classes[i], parent);
      var arrIdx = (metaRows[i] && metaRows[i].arrayIndex != null)
        ? metaRows[i].arrayIndex
        : null;
      var gid = (parent && parent.id)
        || (pu && pu.stagingGroupId)
        || stagingId(pu, i);
      if (pu && !pu.stagingGroupId && gid) pu.stagingGroupId = gid;
      rows.push({
        pu: pu,
        cls: cls,
        index: i,
        arrayIndex: arrIdx,
        groupId: gid,
        _paired: false,
      });
    }

    var bundles = [];
    var hintByIndex = {};

    function refFor(row) {
      return memberRef(row.pu, row.index, row.arrayIndex, row.groupId);
    }

    function pushSingleton(row, bundleType, extraHint) {
      if (!row || row._bundled) return;
      var pu = row.pu;
      var cls = row.cls || emptyClass();
      var gid = row.groupId || stagingId(pu, row.index);
      var set = setIndex(pu, row.index);
      var bid = createBundleId(bundleType, gid, set);
      var b = {
        bundleId: bid,
        bundleType: bundleType,
        members: [refFor(row)],
        priority: bundlePriority(bundleType, cls),
        loadSeqStart: 0,
      };
      if (extraHint && extraHint.lotId) b.lotId = extraHint.lotId;
      bundles.push(b);
      row._bundled = true;
      row._paired = true;

      hintByIndex[row.index] = Object.assign({
        profileClass: cls.profileClass,
        loadRole: cls.fitVerdict === 'oversize_plan'
          ? 'leftover_candidate'
          : cls.loadRole,
        stackPolicy: cls.stackPolicy,
        fitVerdict: cls.fitVerdict,
        reason: cls.reason || '',
        bundleId: bid,
        bundleType: bundleType,
        bundleIndex: 0,
        bundleCount: 1,
        pairId: null,
        pairSide: null,
      }, extraHint || {});
    }

    // Partition beam candidates vs others
    var beamPool = [];
    var otherRows = [];

    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var cls0 = row.cls || emptyClass();
      if (cls0.fitVerdict === 'oversize_plan') {
        pushSingleton(row, BUNDLE.leftover, singletonExtras(BUNDLE.leftover, cls0, row.pu));
        continue;
      }
      if (isBeamProfile(cls0.profileClass)) {
        beamPool.push(row);
      } else {
        otherRows.push(row);
      }
    }

    // A) Twin matching among beams / assemblies
    beamPool.sort(function (a, b) {
      return unitLengthMm(b.pu) - unitLengthMm(a.pu)
        || num(b.pu.weightKg || b.pu.total_weight)
          - num(a.pu.weightKg || a.pu.total_weight)
        || a.index - b.index;
    });

    for (i = 0; i < beamPool.length; i++) {
      var home = beamPool[i];
      if (!home || home._paired || home._bundled) continue;
      var mate = findTwinCandidate(home, beamPool);
      if (mate && !mate._paired && !mate._bundled) {
        home._paired = true;
        mate._paired = true;
        home._bundled = true;
        mate._bundled = true;

        // Heavier / longer = home
        var homeRow = home;
        var mateRow = mate;
        var Lh = unitLengthMm(home.pu);
        var Lm = unitLengthMm(mate.pu);
        var Wh = num(home.pu.weightKg || home.pu.total_weight);
        var Wm = num(mate.pu.weightKg || mate.pu.total_weight);
        if (Lm > Lh + 1 || (Math.abs(Lm - Lh) <= 1 && Wm > Wh)) {
          homeRow = mate;
          mateRow = home;
        }

        var gidH = homeRow.groupId || stagingId(homeRow.pu, homeRow.index);
        var setH = setIndex(homeRow.pu, homeRow.index);
        var bid = createBundleId(BUNDLE.twin_beam, gidH, setH);
        var clsH = homeRow.cls || emptyClass();
        var clsM = mateRow.cls || emptyClass();

        bundles.push({
          bundleId: bid,
          bundleType: BUNDLE.twin_beam,
          members: [
            refFor(homeRow),
            refFor(mateRow),
          ],
          priority: bundlePriority(BUNDLE.twin_beam, clsH),
          loadSeqStart: 0,
        });

        hintByIndex[homeRow.index] = {
          profileClass: clsH.profileClass,
          loadRole: 'floor_anchor',
          stackPolicy: clsH.stackPolicy,
          fitVerdict: clsH.fitVerdict,
          reason: (clsH.reason || '') + '; twin home',
          bundleId: bid,
          bundleType: BUNDLE.twin_beam,
          bundleIndex: 0,
          bundleCount: 2,
          pairId: bid,
          pairSide: 'home',
        };
        hintByIndex[mateRow.index] = {
          profileClass: clsM.profileClass,
          loadRole: 'twin_mate',
          stackPolicy: clsM.stackPolicy,
          fitVerdict: clsM.fitVerdict,
          reason: (clsM.reason || '') + '; twin far',
          bundleId: bid,
          bundleType: BUNDLE.twin_beam,
          bundleIndex: 1,
          bundleCount: 2,
          pairId: bid,
          pairSide: 'far',
        };
      } else {
        pushSingleton(home, BUNDLE.solo_beam, singletonExtras(BUNDLE.solo_beam, home.cls, home.pu));
      }
    }

    // B–E) Nests, plates, RHS, fillers (one packUnit = one bundle; no merge)
    for (i = 0; i < otherRows.length; i++) {
      var r = otherRows[i];
      if (r._bundled) continue;
      var c = r.cls || emptyClass();
      var bt = singletonBundleType(r.pu, c);
      pushSingleton(r, bt, singletonExtras(bt, c, r.pu));
    }

    // Coverage: every packUnit must belong to exactly one bundle
    for (i = 0; i < rows.length; i++) {
      var uncovered = rows[i];
      if (!uncovered || uncovered._bundled) continue;
      var uc = uncovered.cls || emptyClass();
      var ubt = singletonBundleType(uncovered.pu, uc);
      pushSingleton(uncovered, ubt, singletonExtras(ubt, uc, uncovered.pu));
    }

    // Stable unitHints array aligned to original packUnits indices
    var unitHints = [];
    for (i = 0; i < units.length; i++) {
      if (hintByIndex[i]) {
        unitHints.push(hintByIndex[i]);
      } else if (units[i]) {
        // Defensive — coverage pass should have prevented this
        var dCls = resolveClass(units[i], classes[i], parents[i] || null);
        var dBt = singletonBundleType(units[i], dCls);
        var dGid = (parents[i] && parents[i].id)
          || stagingId(units[i], i);
        var dSet = setIndex(units[i], i);
        var dBid = createBundleId(dBt, dGid, dSet);
        var dExtras = singletonExtras(dBt, dCls, units[i]);
        bundles.push({
          bundleId: dBid,
          bundleType: dBt,
          members: [memberRef(
            units[i],
            i,
            metaRows[i] && metaRows[i].arrayIndex,
            dGid
          )],
          priority: bundlePriority(dBt, dCls),
          loadSeqStart: 0,
          lotId: dExtras.lotId || null,
        });
        var dHint = Object.assign({
          profileClass: dCls.profileClass,
          loadRole: dCls.loadRole,
          stackPolicy: dCls.stackPolicy,
          fitVerdict: dCls.fitVerdict,
          reason: (dCls.reason || '') + '; coverage singleton',
          bundleId: dBid,
          bundleType: dBt,
          bundleIndex: 0,
          bundleCount: 1,
          pairId: null,
          pairSide: null,
        }, dExtras);
        hintByIndex[i] = dHint;
        unitHints.push(dHint);
      } else {
        unitHints.push(null);
      }
    }

    // Sort bundles by priority then id (deterministic; not loadSeq)
    bundles.sort(function (a, b) {
      return (a.priority - b.priority)
        || str(a.bundleId).localeCompare(str(b.bundleId));
    });

    return {
      bundles: bundles,
      unitHints: unitHints,
    };
  }

  // Expose
  SI.createBundleId = createBundleId;
  SI.findTwinCandidate = findTwinCandidate;
  SI.getMarkFamily = getMarkFamily;
  SI.createBundles = createBundles;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
