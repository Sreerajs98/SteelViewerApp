/* 05-si-run.js — Steel Intelligence Layer: pipeline entry point
 *
 * siAnnotateStagingForOptimise(assemblyGroups) runs classify → bundle →
 * load plan → hints → projectHintsToPacker.
 *
 * Does NOT call csPackV2RunOptimise, csPackV2PackHuman, or render.
 * Does NOT mutate geometry, Group By identity, or packUnit dimensions.
 * Projection may write allowed contract fields (_checkOrder, freeze flags)
 * via SteelIntel.projectHintsToPacker only.
 *
 * Requires: 01–04 steel-intel modules (00 optional for enums)
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Collect existing packUnits from staging groups (read-only list of refs).
   * Does not create packUnits or call createPackUnits.
   *
   * @param {object[]} groups  assemblyGroups
   * @returns {{
   *   packUnits: object[],
   *   parents: object[],
   *   rows: Array<{ packUnit: object, group: object, groupIndex: number, packUnitIndex: number }>
   * }}
   */
  function collectPackUnits(groups) {
    var packUnits = [];
    var parents = [];
    var rows = [];
    var list = groups || [];

    for (var gi = 0; gi < list.length; gi++) {
      var g = list[gi];
      if (!g) continue;
      var pus = g.packUnits || [];
      for (var pi = 0; pi < pus.length; pi++) {
        var pu = pus[pi];
        if (!pu) continue;
        packUnits.push(pu);
        parents.push(g);
        // Ensure SI can resolve members: staging group id + 0-based array index.
        // packUnitIndex remains the existing 1-based "set N" identity (unchanged).
        if (!pu.stagingGroupId && g.id) pu.stagingGroupId = g.id;
        rows.push({
          packUnit: pu,
          group: g,
          groupIndex: gi,
          arrayIndex: pi,
          packUnitIndex: (pu.packUnitIndex != null) ? pu.packUnitIndex : pi,
        });
      }
    }

    return {
      packUnits: packUnits,
      parents: parents,
      rows: rows,
    };
  }

  function emptyClassification() {
    return {
      profileClass: 'unknown',
      loadRole: 'filler',
      stackPolicy: 'never',
      fitVerdict: 'fits_floor',
      reason: 'classify unavailable',
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Single Steel Intelligence entry for Optimise-time annotation.
   * Metadata / analysis only — does not pack or render.
   *
   * @param {object[]} assemblyGroups  staging groups (existing packUnits)
   * @returns {{
   *   groups: object[],
   *   classifications: object[],
   *   bundles: object[],
   *   loadPlan: object|null,
   *   hints: { groupHints: object[], unitHints: object[] }|null,
   *   projection: { projectedGroups: object[], projectedUnits: object[], changedCount: number }|null,
   *   ok: boolean,
   *   error: string|null
   * }}
   */
  function siAnnotateStagingForOptimise(assemblyGroups) {
    var groups = assemblyGroups || [];
    var result = {
      groups: groups,
      classifications: [],
      bundles: [],
      loadPlan: null,
      hints: null,
      projection: null,
      ok: false,
      error: null,
    };

    try {
      // 1–2) Collect existing packUnits only
      var collected = collectPackUnits(groups);
      var packUnits = collected.packUnits;
      var parents = collected.parents;

      if (!packUnits.length) {
        result.error = 'No packUnits on assemblyGroups';
        result.hints = { groupHints: [], unitHints: [] };
        result.loadPlan = {
          zones: {},
          layers: {},
          orderedBundles: [],
          planHints: [],
        };
        result.projection = {
          projectedGroups: [],
          projectedUnits: [],
          changedCount: 0,
        };
        result.ok = true;
        return result;
      }

      // 3) Classify each packUnit (read-only return values)
      var classifiedMap = [];
      for (var i = 0; i < packUnits.length; i++) {
        var pu = packUnits[i];
        var g = parents[i] || null;
        var cls = emptyClassification();
        if (typeof SI.classifyPackUnit === 'function') {
          try {
            cls = SI.classifyPackUnit(pu, g) || cls;
          } catch (errCls) {
            cls = emptyClassification();
            cls.reason = 'classify error: '
              + (errCls && errCls.message ? errCls.message : 'unknown');
          }
        } else {
          cls.reason = 'SteelIntel.classifyPackUnit not loaded';
        }
        classifiedMap.push(cls);
      }
      result.classifications = classifiedMap;

      // 4) Bundles (metadata only)
      var bundleResult = { bundles: [], unitHints: [] };
      if (typeof SI.createBundles === 'function') {
        bundleResult = SI.createBundles(packUnits, classifiedMap, {
          parents: parents,
          rows: collected.rows,
        }) || bundleResult;
      } else {
        result.error = (result.error ? result.error + '; ' : '')
          + 'SteelIntel.createBundles not loaded';
      }
      result.bundles = bundleResult.bundles || [];

      // 5) Load plan (metadata only)
      var loadPlan = null;
      if (typeof SI.createLoadPlan === 'function') {
        loadPlan = SI.createLoadPlan(result.bundles);
      } else {
        result.error = (result.error ? result.error + '; ' : '')
          + 'SteelIntel.createLoadPlan not loaded';
        loadPlan = {
          zones: {},
          layers: {},
          orderedBundles: [],
          planHints: [],
        };
      }
      result.loadPlan = loadPlan;

      // 6) Hints (stamps siHints metadata only — no packer fields)
      var hints = { groupHints: [], unitHints: [] };
      if (typeof SI.createHints === 'function') {
        hints = SI.createHints(loadPlan) || hints;
      } else {
        result.error = (result.error ? result.error + '; ' : '')
          + 'SteelIntel.createHints not loaded';
      }
      result.hints = hints;

      // 7) Project hints → allowed packer contract fields (_checkOrder, etc.)
      var projection = {
        projectedGroups: [],
        projectedUnits: [],
        changedCount: 0,
      };
      if (typeof SI.projectHintsToPacker === 'function') {
        try {
          projection = SI.projectHintsToPacker(groups) || projection;
        } catch (errProj) {
          result.error = (result.error ? result.error + '; ' : '')
            + 'projectHintsToPacker error: '
            + (errProj && errProj.message ? errProj.message : 'unknown');
        }
      } else {
        result.error = (result.error ? result.error + '; ' : '')
          + 'SteelIntel.projectHintsToPacker not loaded';
      }
      result.projection = projection;

      // Pipeline succeeded if core steps ran; soft errors listed in result.error
      result.ok = !!(typeof SI.classifyPackUnit === 'function'
        && typeof SI.createBundles === 'function'
        && typeof SI.createLoadPlan === 'function'
        && typeof SI.createHints === 'function'
        && typeof SI.projectHintsToPacker === 'function');

      // Cache last run for console / future Optimise hook (non-authoritative)
      try {
        SI.__lastAnnotateResult = result;
      } catch (_) { /* */ }

      return result;
    } catch (err) {
      result.ok = false;
      result.error = (err && err.message) ? err.message : String(err);
      result.hints = result.hints || { groupHints: [], unitHints: [] };
      result.loadPlan = result.loadPlan || {
        zones: {},
        layers: {},
        orderedBundles: [],
        planHints: [],
      };
      result.projection = result.projection || {
        projectedGroups: [],
        projectedUnits: [],
        changedCount: 0,
      };
      return result;
    }
  }

  SI.collectPackUnits = collectPackUnits;
  SI.siAnnotateStagingForOptimise = siAnnotateStagingForOptimise;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
