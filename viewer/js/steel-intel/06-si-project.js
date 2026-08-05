/* 06-si-project.js — Steel Intelligence Layer: project hints → packer contract
 *
 * Writes only allowed staging fields from packUnit.siHints / group.siHints.
 * Does not call Optimise / PackHuman, alter geometry, Group By identity,
 * footprints, nestPieces, or free-rects.
 *
 * Optional: 00–05 steel-intel modules
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  // ── Internals ─────────────────────────────────────────────────────────────

  function str(v) {
    return v == null ? '' : String(v);
  }

  function lower(v) {
    return str(v).toLowerCase();
  }

  function isFiniteNumber(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /**
   * True when bundleType is a nest family or twin_beam.
   * @param {string} bundleType
   * @returns {boolean}
   */
  function needsBundlePreserve(bundleType) {
    var t = lower(bundleType);
    if (!t) return false;
    if (t === 'twin_beam') return true;
    if (t.indexOf('nest') === 0) return true; // nest_z / nest_c / nest_l / nest_*
    return false;
  }

  /**
   * Project one unit's siHints onto allowed packer-contract fields.
   * Does not touch dimensions, groupKind, shapeKey, nestPieces, footprints.
   *
   * @param {object} packUnit
   * @param {object} [group]
   * @param {object} [hint]  defaults to packUnit.siHints
   * @returns {{ changed: boolean, fields: string[], hint: object|null }}
   */
  function projectUnitHint(packUnit, group, hint) {
    var h = hint || (packUnit && packUnit.siHints) || null;
    var fields = [];
    if (!packUnit || !h) {
      return { changed: false, fields: fields, hint: h };
    }

    // A) Ordering — SI loadSeq is authoritative for Optimise.
    // Packer BuildUnits uses: g.checkOrder || pu._checkOrder
    // so multi-PU groups must not keep a non-zero group.checkOrder.
    if (isFiniteNumber(+h.loadSeq) && +h.loadSeq > 0) {
      var seq = Math.floor(+h.loadSeq);
      if (packUnit._checkOrder !== seq) {
        packUnit._checkOrder = seq;
        fields.push('_checkOrder');
      }
      if (group && group.packUnits) {
        var nPu = group.packUnits.length;
        if (nPu === 1) {
          // Single unit: group order may equal loadSeq
          if (group.checkOrder !== seq) {
            group.checkOrder = seq;
            fields.push('group.checkOrder');
          }
        } else if (nPu > 1) {
          // Multi-unit: clear group order so pu._checkOrder wins
          if (group.checkOrder !== 0) {
            group.checkOrder = 0;
            fields.push('group.checkOrder');
          }
        }
      }
    }

    // B) Bundle preservation (nests / twin_beam)
    if (needsBundlePreserve(h.bundleType)) {
      if (packUnit._keepGroupByBundle !== true) {
        packUnit._keepGroupByBundle = true;
        fields.push('_keepGroupByBundle');
      }
    }

    // C) Pose protection — no geometry; optional freeze flag only
    var pairSide = h.pairSide != null && str(h.pairSide) !== '';
    var isL0 = lower(h.layerIntent) === 'l0';
    if (pairSide || isL0) {
      if (packUnit._freezeGroupByPose !== true) {
        packUnit._freezeGroupByPose = true;
        fields.push('_freezeGroupByPose');
      }
    }

    // D) Oversize — do not modify dimensions
    if (lower(h.fitVerdict) === 'oversize_plan') {
      if (packUnit.siProjectionStatus !== 'oversize') {
        packUnit.siProjectionStatus = 'oversize';
        fields.push('siProjectionStatus');
      }
    }

    return {
      changed: fields.length > 0,
      fields: fields,
      hint: h,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Project SI hints on assemblyGroups into allowed packer contract fields.
   *
   * Allowed writes:
   *   packUnit._checkOrder          ← hint.loadSeq (when set)
   *   group.checkOrder              ← loadSeq if 1 PU; 0 if multi-PU
   *                                   (so BuildUnits uses pu._checkOrder)
   *   packUnit._keepGroupByBundle   ← nest* / twin_beam
   *   packUnit._freezeGroupByPose   ← pairSide or layerIntent L0
   *   packUnit.siProjectionStatus   ← "oversize" when fitVerdict oversize_plan
   *
   * @param {object[]} assemblyGroups
   * @returns {{
   *   projectedGroups: object[],
   *   projectedUnits: object[],
   *   changedCount: number
   * }}
   */
  function projectHintsToPacker(assemblyGroups) {
    var groups = assemblyGroups || [];
    var projectedGroups = [];
    var projectedUnits = [];
    var changedCount = 0;
    var seenGroup = {};

    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi];
      if (!g) continue;
      var pus = g.packUnits || [];
      var groupTouched = false;

      for (var pi = 0; pi < pus.length; pi++) {
        var pu = pus[pi];
        if (!pu) continue;
        var hint = pu.siHints || null;
        if (!hint && g.siHints && pus.length === 1) hint = g.siHints;

        var res = projectUnitHint(pu, g, hint);
        if (res.changed) {
          changedCount += res.fields.length;
          groupTouched = true;
        }

        projectedUnits.push({
          stagingGroupId: g.id || null,
          packUnitIndex: (pu.packUnitIndex != null) ? pu.packUnitIndex : pi,
          mark: pu.mark || null,
          fields: res.fields.slice(),
          _checkOrder: pu._checkOrder != null ? pu._checkOrder : null,
          _keepGroupByBundle: !!pu._keepGroupByBundle,
          _freezeGroupByPose: !!pu._freezeGroupByPose,
          siProjectionStatus: pu.siProjectionStatus || null,
          loadSeq: hint && hint.loadSeq != null ? hint.loadSeq : null,
        });
      }

      if (groupTouched || g.siHints) {
        if (!seenGroup[g.id || ('#' + gi)]) {
          seenGroup[g.id || ('#' + gi)] = true;
          projectedGroups.push({
            stagingGroupId: g.id || null,
            mark: g.mark || null,
            checkOrder: g.checkOrder != null ? g.checkOrder : null,
            packUnitCount: pus.length,
            siHints: g.siHints || null,
          });
        }
      }
    }

    try {
      SI.__lastProjectResult = {
        projectedGroups: projectedGroups,
        projectedUnits: projectedUnits,
        changedCount: changedCount,
      };
    } catch (_) { /* */ }

    return {
      projectedGroups: projectedGroups,
      projectedUnits: projectedUnits,
      changedCount: changedCount,
    };
  }

  SI.projectUnitHint = projectUnitHint;
  SI.projectHintsToPacker = projectHintsToPacker;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
