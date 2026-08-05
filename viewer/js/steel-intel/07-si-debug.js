/* 07-si-debug.js — Steel Intelligence Layer: console debug inspection
 *
 * Read-only runtime inspector. Prints SI load-plan / hint / projection state.
 * Does not mutate packUnits, geometry, Group By, packer, or Optimise.
 *
 * Public: SteelIntel.debugLoadPlan()
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  function str(v) {
    return v == null ? '' : String(v);
  }

  function lower(v) {
    return str(v).toLowerCase();
  }

  /**
   * Collect staging packUnits (refs only — no mutation).
   * @returns {Array<{ group: object, packUnit: object, arrayIndex: number }>}
   */
  function collectRows() {
    var rows = [];
    try {
      if (typeof assemblyGroups === 'undefined' || !assemblyGroups) return rows;
      for (var gi = 0; gi < assemblyGroups.length; gi++) {
        var g = assemblyGroups[gi];
        if (!g) continue;
        var pus = g.packUnits || [];
        for (var pi = 0; pi < pus.length; pi++) {
          if (!pus[pi]) continue;
          rows.push({ group: g, packUnit: pus[pi], arrayIndex: pi });
        }
      }
    } catch (_) { /* */ }
    return rows;
  }

  /**
   * Prefer last annotate result bundles; else rebuild summary from siHints.
   * @param {object[]} rows
   * @returns {{ byType: Object.<string, { count: number, members: number }>, bundles: object[] }}
   */
  function bundleSummary(rows) {
    var byType = {};
    var bundles = [];
    var last = SI.__lastAnnotateResult || null;
    if (last && last.bundles && last.bundles.length) {
      bundles = last.bundles;
      for (var i = 0; i < bundles.length; i++) {
        var b = bundles[i] || {};
        var t = str(b.bundleType || 'unknown');
        if (!byType[t]) byType[t] = { count: 0, members: 0 };
        byType[t].count += 1;
        byType[t].members += (b.members && b.members.length) || 0;
      }
      return { byType: byType, bundles: bundles };
    }

    // Fallback: derive from stamped siHints (still read-only)
    var seen = {};
    for (var r = 0; r < rows.length; r++) {
      var h = rows[r].packUnit && rows[r].packUnit.siHints;
      if (!h || !h.bundleId) continue;
      var id = str(h.bundleId);
      if (!seen[id]) {
        seen[id] = {
          bundleId: id,
          bundleType: h.bundleType || 'unknown',
          members: [],
        };
      }
      seen[id].members.push({
        mark: rows[r].packUnit.mark || null,
        packUnitIndex: rows[r].packUnit.packUnitIndex,
      });
    }
    Object.keys(seen).forEach(function (id) {
      var bb = seen[id];
      bundles.push(bb);
      var tt = str(bb.bundleType);
      if (!byType[tt]) byType[tt] = { count: 0, members: 0 };
      byType[tt].count += 1;
      byType[tt].members += bb.members.length;
    });
    return { byType: byType, bundles: bundles };
  }

  /**
   * Ordered sequence rows from siHints (read-only).
   * @param {object[]} rows
   * @returns {object[]}
   */
  function sequenceRows(rows) {
    var seq = [];
    for (var i = 0; i < rows.length; i++) {
      var pu = rows[i].packUnit;
      var h = pu && pu.siHints;
      if (!h) continue;
      seq.push({
        loadSeq: h.loadSeq != null ? +h.loadSeq : null,
        mark: pu.mark || null,
        bundleId: h.bundleId || null,
        bundleType: h.bundleType || null,
        zonePref: h.zonePref || null,
        layerIntent: h.layerIntent || null,
      });
    }
    seq.sort(function (a, b) {
      var la = a.loadSeq != null ? a.loadSeq : 1e9;
      var lb = b.loadSeq != null ? b.loadSeq : 1e9;
      if (la !== lb) return la - lb;
      return str(a.mark).localeCompare(str(b.mark));
    });
    return seq;
  }

  /**
   * Twin home/far pairs from siHints.
   * @param {object[]} rows
   * @returns {object[]}
   */
  function twinValidation(rows) {
    var byId = {};
    for (var i = 0; i < rows.length; i++) {
      var pu = rows[i].packUnit;
      var h = pu && pu.siHints;
      if (!h || lower(h.bundleType) !== 'twin_beam') continue;
      var id = str(h.pairId || h.bundleId);
      if (!id) continue;
      if (!byId[id]) byId[id] = { bundleId: id };
      var side = lower(h.pairSide);
      if (side === 'home') {
        byId[id].homeMark = pu.mark || null;
        byId[id].homeSeq = h.loadSeq != null ? +h.loadSeq : null;
      } else if (side === 'far') {
        byId[id].mateMark = pu.mark || null;
        byId[id].mateSeq = h.loadSeq != null ? +h.loadSeq : null;
      }
    }
    var list = [];
    Object.keys(byId).forEach(function (id) {
      var t = byId[id];
      var ok = (t.homeSeq != null && t.mateSeq != null)
        && (t.mateSeq === t.homeSeq + 1);
      list.push({
        bundleId: t.bundleId,
        homeMark: t.homeMark || null,
        mateMark: t.mateMark || null,
        homeSeq: t.homeSeq != null ? t.homeSeq : null,
        mateSeq: t.mateSeq != null ? t.mateSeq : null,
        ok: ok,
      });
    });
    list.sort(function (a, b) {
      return (a.homeSeq || 0) - (b.homeSeq || 0)
        || str(a.bundleId).localeCompare(str(b.bundleId));
    });
    return list;
  }

  /**
   * Projection check rows (read-only).
   * @param {object[]} rows
   * @returns {object[]}
   */
  function projectionRows(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var pu = rows[i].packUnit;
      var h = pu && pu.siHints;
      var loadSeq = h && h.loadSeq != null ? +h.loadSeq : null;
      var checkOrder = pu && pu._checkOrder != null ? +pu._checkOrder : null;
      out.push({
        mark: pu ? (pu.mark || null) : null,
        _checkOrder: checkOrder,
        loadSeq: loadSeq,
        match: (loadSeq != null && checkOrder != null && checkOrder === loadSeq),
      });
    }
    out.sort(function (a, b) {
      return (a.loadSeq || 0) - (b.loadSeq || 0)
        || str(a.mark).localeCompare(str(b.mark));
    });
    return out;
  }

  /**
   * Leftover / oversize summary (read-only).
   * @param {object[]} rows
   * @returns {{ count: number, items: object[], byReason: Object.<string, number> }}
   */
  function leftoverSummary(rows) {
    var items = [];
    var byReason = {};
    for (var i = 0; i < rows.length; i++) {
      var pu = rows[i].packUnit;
      var h = pu && pu.siHints;
      if (!h) continue;
      var isLeft = lower(h.bundleType) === 'leftover'
        || lower(h.fitVerdict) === 'oversize_plan'
        || lower(h.loadRole) === 'leftover_candidate';
      if (!isLeft) continue;
      var reason = str(h.reason || h.fitVerdict || h.bundleType || 'leftover');
      items.push({
        mark: pu.mark || null,
        bundleId: h.bundleId || null,
        loadSeq: h.loadSeq != null ? +h.loadSeq : null,
        fitVerdict: h.fitVerdict || null,
        reason: reason,
      });
      byReason[reason] = (byReason[reason] || 0) + 1;
    }
    items.sort(function (a, b) {
      return (a.loadSeq || 0) - (b.loadSeq || 0)
        || str(a.mark).localeCompare(str(b.mark));
    });
    return { count: items.length, items: items, byReason: byReason };
  }

  function printSection(title) {
    console.log('');
    console.log('── ' + title + ' ──');
  }

  /**
   * Console debug dump of current SI staging state.
   * Read-only — never mutates packUnits / geometry / packer.
   *
   * @returns {object} structured summary (also printed)
   */
  function debugLoadPlan() {
    var rows = collectRows();
    var bundles = bundleSummary(rows);
    var sequence = sequenceRows(rows);
    var twins = twinValidation(rows);
    var projection = projectionRows(rows);
    var leftovers = leftoverSummary(rows);

    var projMatch = 0;
    for (var p = 0; p < projection.length; p++) {
      if (projection[p].match) projMatch += 1;
    }
    var twinOk = 0;
    for (var t = 0; t < twins.length; t++) {
      if (twins[t].ok) twinOk += 1;
    }

    console.log('');
    console.log('========== SteelIntel.debugLoadPlan ==========');

    // 1) Total packUnits
    printSection('1. Total packUnits');
    console.log('packUnits:', rows.length);

    // 2) Bundle summary
    printSection('2. Bundle summary (bundleType : count  [members])');
    var typeKeys = Object.keys(bundles.byType).sort();
    if (!typeKeys.length) {
      console.log('(no bundles / siHints — run Optimise or siAnnotateStagingForOptimise first)');
    }
    for (var ti = 0; ti < typeKeys.length; ti++) {
      var tk = typeKeys[ti];
      var tv = bundles.byType[tk];
      console.log(
        tk + ' : ' + tv.count
          + '   members=' + tv.members
      );
    }
    console.log('bundleCount:', bundles.bundles.length);

    // 3) Sequence
    printSection('3. Sequence (loadSeq | mark | bundleId | bundleType | zonePref | layerIntent)');
    for (var si = 0; si < sequence.length; si++) {
      var s = sequence[si];
      console.log(
        [s.loadSeq, s.mark, s.bundleId, s.bundleType, s.zonePref, s.layerIntent]
          .join(' | ')
      );
    }
    console.log('sequence rows:', sequence.length);

    // 4) Twin validation
    printSection('4. Twin validation (home mark | mate mark | home seq | mate seq | ok)');
    for (var tw = 0; tw < twins.length; tw++) {
      var pair = twins[tw];
      console.log(
        [
          pair.homeMark,
          pair.mateMark,
          pair.homeSeq,
          pair.mateSeq,
          pair.ok ? 'OK' : 'FAIL',
          pair.bundleId,
        ].join(' | ')
      );
    }
    console.log('twins:', twins.length, ' ok:', twinOk, ' bad:', twins.length - twinOk);

    // 5) Projection
    printSection('5. Projection (_checkOrder | siHints.loadSeq | match)');
    for (var pr = 0; pr < projection.length; pr++) {
      var row = projection[pr];
      console.log(
        [row.mark, row._checkOrder, row.loadSeq, row.match ? 'OK' : 'MISMATCH']
          .join(' | ')
      );
    }
    console.log(
      'projection match:', projMatch + '/' + projection.length
    );

    // 6) Leftover summary
    printSection('6. Leftover summary');
    console.log('count:', leftovers.count);
    var reasonKeys = Object.keys(leftovers.byReason).sort();
    if (!reasonKeys.length) {
      console.log('(none)');
    } else {
      for (var ri = 0; ri < reasonKeys.length; ri++) {
        var rk = reasonKeys[ri];
        console.log('  ' + leftovers.byReason[rk] + ' × ' + rk);
      }
    }

    console.log('');
    console.log('========== end debugLoadPlan ==========');
    console.log('');

    var summary = {
      packUnits: rows.length,
      bundleSummary: bundles.byType,
      bundleCount: bundles.bundles.length,
      sequence: sequence,
      twins: twins,
      twinOk: twinOk,
      twinBad: twins.length - twinOk,
      projection: projection,
      projectionMatch: projMatch,
      leftovers: leftovers,
      source: (SI.__lastAnnotateResult && SI.__lastAnnotateResult.bundles)
        ? '__lastAnnotateResult'
        : 'siHints',
    };

    // Also attach for DevTools expand
    try { SI.__lastDebugLoadPlan = summary; } catch (_) { /* */ }

    return summary;
  }

  SI.debugLoadPlan = debugLoadPlan;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
