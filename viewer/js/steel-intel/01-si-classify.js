/* 01-si-classify.js — Steel Intelligence Layer: packUnit classification only
 *
 * Classifies existing packUnits. Does not mutate geometry, groupKind, shapeKey,
 * profileShape, packer seats, or create bundles / twins / load plans.
 *
 * Requires (optional): viewer/js/steel-intel/00-si-types.js for enum constants.
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  var PC = SI.PROFILE_CLASS || {};
  var LR = SI.LOAD_ROLE || {};
  var SP = SI.STACK_POLICY || {};

  // Fallback string literals if 00-si-types.js not loaded yet
  var PROFILE = {
    assembly: PC.ASSEMBLY || 'assembly',
    i_beam: PC.I_BEAM || 'i_beam',
    h_beam: PC.H_BEAM || 'h_beam',
    channel_z: PC.CHANNEL_Z || 'channel_z',
    channel_c: PC.CHANNEL_C || 'channel_c',
    angle: PC.ANGLE || 'angle',
    plate: PC.PLATE || 'plate',
    rhs: PC.RHS || 'rhs',
    chs: PC.CHS || 'chs',
    rod: PC.ROD || 'rod',
    bent_rod: PC.BENT_ROD || 'bent_rod',
    loose: PC.LOOSE || 'loose',
    unknown: PC.UNKNOWN || 'unknown',
  };

  var ROLE = {
    floor_anchor: LR.FLOOR_ANCHOR || 'floor_anchor',
    nest_strip: LR.NEST_STRIP || 'nest_strip',
    plate_deck: LR.PLATE_DECK || 'plate_deck',
    filler: LR.FILLER || 'filler',
    leftover_candidate: LR.LEFTOVER_CANDIDATE || 'leftover_candidate',
  };

  var STACK = {
    never: SP.NEVER || 'never',
    on_same_family: SP.ON_SAME_FAMILY || 'on_same_family',
    on_flat_deck: SP.ON_FLAT_DECK || 'on_flat_deck',
    nest_only: SP.NEST_ONLY || 'nest_only',
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

  /**
   * Container clear size for fit checks (read-only; never mutates scene).
   * @returns {{ widthMm: number, lengthMm: number }}
   */
  function getContainerCaps() {
    var W = 2350;
    var L = 12000;
    try {
      if (typeof rawScene !== 'undefined' && rawScene && rawScene.containerSpec) {
        W = num(rawScene.containerSpec.widthMm, W);
        L = num(rawScene.containerSpec.lengthMm, L);
      }
    } catch (_) { /* */ }
    try {
      if (typeof getPackConfig === 'function') {
        var cfg = getPackConfig() || {};
        var c = cfg.container || {};
        if (num(c.widthMm)) W = num(c.widthMm, W);
        if (num(c.lengthMm)) L = num(c.lengthMm, L);
      }
    } catch (_) { /* */ }
    return { widthMm: W, lengthMm: L };
  }

  /**
   * Plan L × W × H from existing seat / length fields (read-only).
   * @param {object} pu
   * @returns {{ L: number, W: number, H: number }}
   */
  function getPlanDimensions(pu) {
    if (!pu) return { L: 0, W: 0, H: 0 };
    var sb = pu.stableBundleMm || pu.bundle_bbox || null;
    var L = Math.max(
      num(pu.packFootprintL),
      num(pu.packLengthMm),
      num(pu.lengthMaxMm),
      num(pu.lengthMm),
      sb ? num(sb.l) : 0,
      0
    );
    var W = Math.max(
      num(pu.packFootprintW),
      num(pu.packWidthMm),
      num(pu.widthMm),
      sb ? num(sb.w) : 0,
      0
    );
    var H = Math.max(
      num(pu.packFootprintH),
      num(pu.packHeightMm),
      num(pu.heightMm),
      sb ? num(sb.h) : 0,
      0
    );
    return { L: L, W: W, H: H };
  }

  /**
   * @param {object} pu
   * @param {{ widthMm: number, lengthMm: number }} [caps]
   * @returns {boolean}
   */
  function isOversizePlan(pu, caps) {
    var dim = getPlanDimensions(pu);
    var c = caps || getContainerCaps();
    var Wcap = num(c.widthMm, 2350);
    var Lcap = num(c.lengthMm, 12000);
    if (!(dim.L > 0) && !(dim.W > 0)) return false;
    return (dim.W > Wcap + 0.5) || (dim.L > Lcap + 0.5);
  }

  /**
   * Mark / profile text blob for weak pattern fallback.
   * @param {object} pu
   * @param {object} [g]
   * @returns {string}
   */
  function markBlob(pu, g) {
    var parts = [];
    if (pu) {
      parts.push(pu.mark, pu.profileDesc);
      if (pu.marks && pu.marks.length) parts.push(pu.marks.join(' '));
    }
    if (g) {
      parts.push(g.mark, g.profileDesc);
      if (g.marks && g.marks.length) parts.push(g.marks.join(' '));
    }
    return parts.filter(Boolean).join(' ').toUpperCase();
  }

  /**
   * Profile class from existing fields only.
   * Precedence: groupKind → shapeKey/profileShape → mark patterns → sect weak → unknown
   * @param {object} pu
   * @param {object} [parentGroup]
   * @returns {string}
   */
  function getProfileClass(pu, parentGroup) {
    if (!pu && !parentGroup) return PROFILE.unknown;

    var gk = lower((pu && pu.groupKind) || (parentGroup && parentGroup.groupKind));
    var sk = lower(
      (pu && (pu.shapeKey || pu.profileShape))
      || (parentGroup && (parentGroup.shapeKey || parentGroup.profileShape))
    );
    var isAsm = !!(pu && (pu.isAssembly || gk === 'welded_assembly' || gk === 'assembly_single'))
      || !!(parentGroup && (parentGroup.isAssembly || gk === 'welded_assembly'));

    // 1) groupKind
    if (gk === 'welded_assembly' || gk === 'assembly_single' || isAsm)
      return PROFILE.assembly;
    if (gk === 'nest_z') return PROFILE.channel_z;
    if (gk === 'nest_c') return PROFILE.channel_c;
    if (gk === 'nest_l') return PROFILE.angle;
    if (gk === 'stack_plate') return PROFILE.plate;
    if (gk === 'bundle_rhs') return PROFILE.rhs;
    if (gk === 'bundle_beam') return PROFILE.i_beam;
    if (gk === 'bundle_rod') return PROFILE.rod;
    if (gk === 'bundle_bent') return PROFILE.bent_rod;
    if (gk === 'loose_small') return PROFILE.loose;

    // 2) shapeKey / profileShape
    if (sk === 'z_channel') return PROFILE.channel_z;
    if (sk === 'c_channel') return PROFILE.channel_c;
    if (sk === 'l_angle') return PROFILE.angle;
    if (sk === 'plate') return PROFILE.plate;
    if (sk === 'rhs') return PROFILE.rhs;
    if (sk === 'chs') return PROFILE.chs;
    if (sk === 'i_beam') return PROFILE.i_beam;
    if (sk === 'h_beam') return PROFILE.h_beam;
    if (sk === 'rod') return PROFILE.rod;
    if (sk === 'bent_sag_rod') return PROFILE.bent_rod;

    // 3) mark / profile text patterns
    var blob = markBlob(pu, parentGroup);
    if (/\bCHS\b/.test(blob)) return PROFILE.chs;
    if (/\bRHS\b|\bSHS\b|\bHSS\b|\bTUBE\b/.test(blob)) return PROFILE.rhs;
    if (/\bUB\d|\bUC\d|\bIPE\d|\bHEA\d|\bHEB\d|\bHEM\d|\bH[_-]?BEAM\b/.test(blob))
      return PROFILE.h_beam;
    if (/\bI[_-]?BEAM\b|\bBEAM\b/.test(blob) && !/SAG/.test(blob))
      return PROFILE.i_beam;
    if (/(?:^|[^A-Z0-9])Z\d|\dZ\d|ZPUR|Z-?PURLIN/.test(blob))
      return PROFILE.channel_z;
    if (/CHANNEL|(?:^|[^A-Z0-9])C\d|\dC\d/.test(blob))
      return PROFILE.channel_c;
    if (/\bL\d|ANGLE|EQUAL.?ANGLE/.test(blob)) return PROFILE.angle;
    if (/\bPL(ATE)?\b|\bFL\d|FLAT/.test(blob)) return PROFILE.plate;
    if (/BENT|BEND/.test(blob) && /ROD|SAG/.test(blob)) return PROFILE.bent_rod;
    if (/\bROD\b|ROUND.?BAR|SAG.?ROD/.test(blob)) return PROFILE.rod;
    if (/\bRF\d|\bCL\d|RAFTER|COLUMN/.test(blob)) return PROFILE.assembly;

    // 4) section dimensions — weak support only
    var sectH = num(pu && pu.sectH) || num(parentGroup && parentGroup.sectH);
    var sectW = num(pu && pu.sectW) || num(parentGroup && parentGroup.sectW);
    var sectT = num(pu && pu.sectT) || num(parentGroup && parentGroup.sectT);
    var thin = Math.min(
      sectT > 0 ? sectT : 1e9,
      sectH > 0 ? sectH : 1e9,
      sectW > 0 ? sectW : 1e9
    );
    if (thin < 1e9 && thin <= 80 && sectH > 0 && sectW > 0
        && Math.max(sectH, sectW) >= thin * 8) {
      // Very thin vs plan — weak plate hint only when nothing else matched
      return PROFILE.plate;
    }

    // 5) unknown
    return PROFILE.unknown;
  }

  /**
   * Basic loadRole defaults from profileClass + fit (no twins / zones / order).
   * @param {string} profileClass
   * @param {string} fitVerdict
   * @param {{ L: number, W: number, H: number }} dim
   * @returns {string}
   */
  function defaultLoadRole(profileClass, fitVerdict, dim) {
    if (fitVerdict === 'oversize_plan') return ROLE.leftover_candidate;
    if (profileClass === PROFILE.assembly
        || profileClass === PROFILE.i_beam
        || profileClass === PROFILE.h_beam) {
      return ROLE.floor_anchor;
    }
    if (profileClass === PROFILE.channel_z
        || profileClass === PROFILE.channel_c
        || profileClass === PROFILE.angle) {
      return ROLE.nest_strip;
    }
    if (profileClass === PROFILE.plate) return ROLE.plate_deck;
    return ROLE.filler;
  }

  /**
   * Basic stackPolicy defaults (no twin / planner logic).
   * @param {string} profileClass
   * @param {string} loadRole
   * @param {{ L: number, W: number, H: number }} dim
   * @returns {string}
   */
  function defaultStackPolicy(profileClass, loadRole, dim) {
    if (loadRole === ROLE.leftover_candidate) return STACK.never;
    if (profileClass === PROFILE.channel_z
        || profileClass === PROFILE.channel_c
        || profileClass === PROFILE.angle) {
      return STACK.nest_only;
    }
    if (profileClass === PROFILE.plate) return STACK.on_flat_deck;
    if (profileClass === PROFILE.rhs || profileClass === PROFILE.chs) {
      return STACK.on_flat_deck;
    }
    if (profileClass === PROFILE.rod || profileClass === PROFILE.bent_rod) {
      return STACK.on_same_family;
    }
    if (profileClass === PROFILE.assembly
        || profileClass === PROFILE.i_beam
        || profileClass === PROFILE.h_beam) {
      // Flat-ish shipping height may stack later; upright / tall → never
      var H = dim.H || 0;
      var W = dim.W || 0;
      if (H > 0 && H <= 1200) return STACK.on_flat_deck;
      if (H > 0 && W > 0 && W + 0.5 >= H * 0.85 && H <= 1800)
        return STACK.on_flat_deck;
      return STACK.never;
    }
    return STACK.never;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Classify an existing packUnit (read-only).
   * @param {object} packUnit
   * @param {object} [parentGroup]  staging assemblyGroup (optional)
   * @returns {{
   *   profileClass: string,
   *   loadRole: string,
   *   stackPolicy: string,
   *   fitVerdict: string,
   *   reason: string
   * }}
   */
  function classifyPackUnit(packUnit, parentGroup) {
    var pu = packUnit || null;
    var g = parentGroup || null;
    var caps = getContainerCaps();
    var dim = getPlanDimensions(pu || {});
    var oversize = isOversizePlan(pu || {}, caps);
    var fitVerdict = oversize ? 'oversize_plan' : 'fits_floor';

    var profileClass = getProfileClass(pu, g);
    var loadRole = defaultLoadRole(profileClass, fitVerdict, dim);
    var stackPolicy = defaultStackPolicy(profileClass, loadRole, dim);

    var reasonBits = [];
    reasonBits.push('class=' + profileClass);
    if (oversize) {
      reasonBits.push(
        'oversize plan '
        + Math.round(dim.L) + '×' + Math.round(dim.W)
        + ' > floor ' + Math.round(caps.lengthMm) + '×' + Math.round(caps.widthMm)
      );
    } else {
      reasonBits.push('fits_floor');
    }
    reasonBits.push('role=' + loadRole);
    reasonBits.push('stack=' + stackPolicy);

    return {
      profileClass: profileClass,
      loadRole: loadRole,
      stackPolicy: stackPolicy,
      fitVerdict: fitVerdict,
      reason: reasonBits.join('; '),
    };
  }

  // Expose (internals available for later SI modules / tests; not packer-facing)
  SI.getProfileClass = getProfileClass;
  SI.getPlanDimensions = getPlanDimensions;
  SI.isOversizePlan = isOversizePlan;
  SI.classifyPackUnit = classifyPackUnit;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
