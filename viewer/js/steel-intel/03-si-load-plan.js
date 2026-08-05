/* 03-si-load-plan.js — Steel Intelligence Layer: logical load plan (metadata only)
 *
 * Assigns zones / layers and orders SI bundles. Does not project _checkOrder,
 * touch free-rects, call the packer, or change geometry / render.
 *
 * Optional: 00-si-types.js, 02-si-bundle.js
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  var ZONE = SI.ZONE || {
    HOME_BASE: 'Z_HOME_BASE',
    FAR_BASE: 'Z_FAR_BASE',
    CENTRE_FLOOR: 'Z_CENTRE_FLOOR',
    DOOR_CLEAR: 'Z_DOOR_CLEAR',
    REAR_POCKET: 'Z_REAR_POCKET',
    UPPER: 'Z_UPPER',
    OUT: 'Z_OUT',
  };

  var LAYER = SI.LAYER || {
    L0: 'L0',
    L1: 'L1',
    L2: 'L2',
  };

  var BT = SI.BUNDLE_TYPE || {};
  var BUNDLE = {
    twin_beam: BT.TWIN_BEAM || 'twin_beam',
    solo_beam: BT.SOLO_BEAM || 'solo_beam',
    nest_z: BT.NEST_Z || 'nest_z',
    nest_c: BT.NEST_C || 'nest_c',
    nest_l: BT.NEST_L || 'nest_l',
    plate_stack: BT.PLATE_STACK || 'plate_stack',
    rhs_unit: BT.RHS_UNIT || 'rhs_unit',
    rhs_lot: BT.RHS_LOT || 'rhs_lot',
    filler: BT.FILLER || 'filler',
    leftover: BT.LEFTOVER || 'leftover',
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
   * Resolve a staging packUnit for mass/length (read-only lookup).
   * @param {object} member
   * @returns {object|null}
   */
  function lookupPackUnit(member) {
    if (!member) return null;
    try {
      if (typeof assemblyGroups === 'undefined' || !assemblyGroups) return null;
      var gid = member.stagingGroupId;
      var setIdx = member.packUnitIndex;
      var arrIdx = member.arrayIndex;
      for (var i = 0; i < assemblyGroups.length; i++) {
        var g = assemblyGroups[i];
        if (!g) continue;
        if (gid && g.id !== gid) continue;
        var pus = g.packUnits || [];
        // packUnitIndex is 1-based "set N" — match by property, never as array index
        if (setIdx != null) {
          for (var j = 0; j < pus.length; j++) {
            if (pus[j] && +pus[j].packUnitIndex === +setIdx) return pus[j];
          }
        }
        if (arrIdx != null && pus[arrIdx]) return pus[arrIdx];
        if (pus.length === 1) return pus[0];
        if (!gid && pus.length) return pus[0];
      }
    } catch (_) { /* */ }
    return null;
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

  function unitWeightKg(pu) {
    if (!pu) return 0;
    return Math.max(num(pu.total_weight), num(pu.weightKg), 0);
  }

  /**
   * Aggregate length / weight for a bundle (max length, sum weight).
   * @param {object} bundle
   * @returns {{ L: number, Wkg: number }}
   */
  function bundleMass(bundle) {
    var L = num(bundle && bundle.lengthMm);
    var Wkg = num(bundle && bundle.weightKg);
    var members = (bundle && bundle.members) || [];
    for (var i = 0; i < members.length; i++) {
      var pu = lookupPackUnit(members[i]);
      L = Math.max(L, unitLengthMm(pu));
      Wkg += unitWeightKg(pu);
    }
    return { L: L, Wkg: Wkg };
  }

  /**
   * Infer primary load role from bundleType (metadata).
   * @param {object} bundle
   * @returns {string}
   */
  function primaryRole(bundle) {
    var t = lower(bundle && bundle.bundleType);
    if (t === BUNDLE.leftover) return 'leftover_candidate';
    if (t === BUNDLE.twin_beam) return 'floor_anchor'; // home leads; mate tagged in hints
    if (t === BUNDLE.solo_beam) return 'floor_anchor';
    if (t === BUNDLE.nest_z || t === BUNDLE.nest_c || t === BUNDLE.nest_l)
      return 'nest_strip';
    if (t === BUNDLE.plate_stack) return 'plate_deck';
    if (t === BUNDLE.rhs_unit || t === BUNDLE.rhs_lot) return 'filler';
    return 'filler';
  }

  /**
   * Long RHS heuristic for L1 vs L2 (read-only).
   * @param {object} bundle
   * @returns {boolean}
   */
  function isLongRhs(bundle) {
    var t = lower(bundle && bundle.bundleType);
    if (t !== BUNDLE.rhs_unit && t !== BUNDLE.rhs_lot) return false;
    var m = bundleMass(bundle);
    // ~half container length band
    var Lcap = 12000;
    try {
      if (typeof rawScene !== 'undefined' && rawScene && rawScene.containerSpec)
        Lcap = num(rawScene.containerSpec.lengthMm, Lcap);
    } catch (_) { /* */ }
    return m.L >= Lcap * 0.45;
  }

  /**
   * @param {string} loadRole
   * @param {object} [bundle]
   * @param {object} [memberHint]  { pairSide }
   * @returns {string} ZONE value
   */
  function assignZone(loadRole, bundle, memberHint) {
    var role = lower(loadRole);
    var side = memberHint && memberHint.pairSide
      ? lower(memberHint.pairSide) : '';

    if (role === 'leftover_candidate' || role === 'leftover')
      return ZONE.OUT || 'Z_OUT';

    if (role === 'twin_mate' || side === 'far')
      return ZONE.FAR_BASE || 'Z_FAR_BASE';

    if (role === 'floor_anchor' || side === 'home')
      return ZONE.HOME_BASE || 'Z_HOME_BASE';

    if (role === 'nest_strip')
      return ZONE.CENTRE_FLOOR || 'Z_CENTRE_FLOOR';

    if (role === 'plate_deck')
      return ZONE.REAR_POCKET || 'Z_REAR_POCKET';

    // filler: residual / upper (stackable fillers prefer upper)
    if (role === 'filler') {
      var t = lower(bundle && bundle.bundleType);
      if (t === BUNDLE.rhs_unit || t === BUNDLE.rhs_lot) {
        return isLongRhs(bundle)
          ? (ZONE.CENTRE_FLOOR || 'Z_CENTRE_FLOOR')
          : (ZONE.UPPER || 'Z_UPPER');
      }
      return ZONE.UPPER || 'Z_UPPER';
    }

    return ZONE.CENTRE_FLOOR || 'Z_CENTRE_FLOOR';
  }

  /**
   * @param {string} loadRole
   * @param {object} [bundle]
   * @returns {string} LAYER value
   */
  function assignLayer(loadRole, bundle) {
    var role = lower(loadRole);
    if (role === 'leftover_candidate' || role === 'leftover')
      return LAYER.L0 || 'L0'; // unused for place; kept for schema
    if (role === 'floor_anchor' || role === 'twin_mate')
      return LAYER.L0 || 'L0';
    if (role === 'nest_strip' || role === 'plate_deck')
      return LAYER.L1 || 'L1';
    if (role === 'filler') {
      if (isLongRhs(bundle)) return LAYER.L1 || 'L1';
      return LAYER.L2 || 'L2';
    }
    return LAYER.L1 || 'L1';
  }

  /**
   * Order priority (lower = earlier). Matches fabrication bands.
   * @param {object|string} bundleOrType
   * @returns {number}
   */
  function calculatePriority(bundleOrType) {
    var t = typeof bundleOrType === 'string'
      ? lower(bundleOrType)
      : lower(bundleOrType && bundleOrType.bundleType);

    if (t === BUNDLE.twin_beam) return 1;
    if (t === BUNDLE.solo_beam) return 2;
    if (t === BUNDLE.nest_z || t === BUNDLE.nest_c || t === BUNDLE.nest_l)
      return 3;
    if (t === BUNDLE.plate_stack) return 4;
    if (t === BUNDLE.rhs_unit || t === BUNDLE.rhs_lot) return 5;
    if (t === BUNDLE.filler) return 6;
    if (t === BUNDLE.leftover) return 7;
    return 6;
  }

  /**
   * Zone catalog (policy map — metadata only).
   * @returns {Object.<string, object>}
   */
  function buildZonesCatalog() {
    var z = {};
    z[ZONE.HOME_BASE || 'Z_HOME_BASE'] = {
      id: ZONE.HOME_BASE || 'Z_HOME_BASE',
      intent: 'Primary long anchors / twin home',
      layer: LAYER.L0 || 'L0',
    };
    z[ZONE.FAR_BASE || 'Z_FAR_BASE'] = {
      id: ZONE.FAR_BASE || 'Z_FAR_BASE',
      intent: 'Twin mate / second long lane',
      layer: LAYER.L0 || 'L0',
    };
    z[ZONE.CENTRE_FLOOR || 'Z_CENTRE_FLOOR'] = {
      id: ZONE.CENTRE_FLOOR || 'Z_CENTRE_FLOOR',
      intent: 'Nests / long secondaries',
      layer: LAYER.L1 || 'L1',
    };
    z[ZONE.REAR_POCKET || 'Z_REAR_POCKET'] = {
      id: ZONE.REAR_POCKET || 'Z_REAR_POCKET',
      intent: 'Plate decks / short floor bits',
      layer: LAYER.L1 || 'L1',
    };
    z[ZONE.DOOR_CLEAR || 'Z_DOOR_CLEAR'] = {
      id: ZONE.DOOR_CLEAR || 'Z_DOOR_CLEAR',
      intent: 'Reserved door access (sequence later)',
      layer: LAYER.L1 || 'L1',
    };
    z[ZONE.UPPER || 'Z_UPPER'] = {
      id: ZONE.UPPER || 'Z_UPPER',
      intent: 'Stack / residual fillers',
      layer: LAYER.L2 || 'L2',
    };
    z[ZONE.OUT || 'Z_OUT'] = {
      id: ZONE.OUT || 'Z_OUT',
      intent: 'Oversize leftovers — not placed',
      layer: null,
    };
    return z;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Build a logical container load plan from SI bundles (metadata only).
   * Does not set _checkOrder, call Optimise, or alter free-rects.
   *
   * @param {object[]} bundles  from SteelIntel.createBundles
   * @returns {{
   *   zones: Object.<string, object>,
   *   layers: Object.<string, object>,
   *   orderedBundles: object[],
   *   planHints: object[]
   * }}
   */
  function createLoadPlan(bundles) {
    var list = (bundles || []).slice();
    var zones = buildZonesCatalog();

    var layers = {};
    layers[LAYER.L0 || 'L0'] = {
      id: LAYER.L0 || 'L0',
      intent: 'Floor base — floor_anchor + twin_mate',
      roles: ['floor_anchor', 'twin_mate'],
    };
    layers[LAYER.L1 || 'L1'] = {
      id: LAYER.L1 || 'L1',
      intent: 'Secondary floor — nests, plates, long RHS',
      roles: ['nest_strip', 'plate_deck', 'long_rhs'],
    };
    layers[LAYER.L2 || 'L2'] = {
      id: LAYER.L2 || 'L2',
      intent: 'Top / stackable fillers',
      roles: ['filler'],
    };

    // Annotate + sort (priority → length desc → weight desc → id)
    var enriched = list.map(function (b, idx) {
      var role = primaryRole(b);
      var mass = bundleMass(b);
      var zone = assignZone(role, b, null);
      var layer = assignLayer(role, b);
      var priority = calculatePriority(b);
      return {
        bundle: b,
        index: idx,
        loadRole: role,
        zonePref: zone,
        layerIntent: layer,
        priority: priority,
        lengthMm: mass.L,
        weightKg: mass.Wkg,
      };
    });

    enriched.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (b.lengthMm !== a.lengthMm) return b.lengthMm - a.lengthMm;
      if (b.weightKg !== a.weightKg) return b.weightKg - a.weightKg;
      return str(a.bundle && a.bundle.bundleId)
        .localeCompare(str(b.bundle && b.bundle.bundleId));
    });

    var orderedBundles = [];
    var planHints = [];

    for (var i = 0; i < enriched.length; i++) {
      var e = enriched[i];
      var b = e.bundle || {};
      var members = b.members || [];

      var ordered = {
        bundleId: b.bundleId,
        bundleType: b.bundleType,
        members: members.slice(),
        priority: e.priority,
        loadSeqStart: 0, // reserved — projection later
        zonePref: e.zonePref,
        layerIntent: e.layerIntent,
        loadRole: e.loadRole,
        lengthMm: e.lengthMm,
        weightKg: e.weightKg,
        lotId: b.lotId || null,
      };

      // Twin: expose home/far member zone hints (still no _checkOrder)
      if (lower(b.bundleType) === BUNDLE.twin_beam && members.length >= 2) {
        ordered.memberZones = [
          {
            unitIndex: members[0].unitIndex,
            pairSide: 'home',
            zonePref: assignZone('floor_anchor', b, { pairSide: 'home' }),
            layerIntent: LAYER.L0 || 'L0',
            loadRole: 'floor_anchor',
          },
          {
            unitIndex: members[1].unitIndex,
            pairSide: 'far',
            zonePref: assignZone('twin_mate', b, { pairSide: 'far' }),
            layerIntent: LAYER.L0 || 'L0',
            loadRole: 'twin_mate',
          },
        ];
      }

      orderedBundles.push(ordered);

      planHints.push({
        bundleId: b.bundleId,
        bundleType: b.bundleType,
        priority: e.priority,
        zonePref: e.zonePref,
        layerIntent: e.layerIntent,
        loadRole: e.loadRole,
        aisleReserve: e.loadRole === 'filler'
          && lower(b.bundleType) === BUNDLE.filler,
        lengthMm: e.lengthMm,
        weightKg: e.weightKg,
      });
    }

    return {
      zones: zones,
      layers: layers,
      orderedBundles: orderedBundles,
      planHints: planHints,
    };
  }

  SI.assignZone = assignZone;
  SI.assignLayer = assignLayer;
  SI.calculatePriority = calculatePriority;
  SI.createLoadPlan = createLoadPlan;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
