/* 04-si-hints.js — Steel Intelligence Layer: metadata hints + future projection
 *
 * Builds siHints for staging groups / packUnits from a load plan.
 * Does not mutate geometry, dimensions, groupKind, shapeKey, nestPieces,
 * or packer contract fields (_checkOrder, checked, footprints, freeze flags).
 *
 * Optional: 00–03 steel-intel modules, global assemblyGroups
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

  /**
   * Find staging group + packUnit for a bundle member (read-only).
   * @param {object} member
   * @returns {{ group: object|null, packUnit: object|null, groupIndex: number, unitIndex: number }}
   */
  function resolveMember(member) {
    var out = { group: null, packUnit: null, groupIndex: -1, unitIndex: -1 };
    if (!member) return out;
    try {
      if (typeof assemblyGroups === 'undefined' || !assemblyGroups) return out;
      var gid = member.stagingGroupId;
      var setIdx = member.packUnitIndex;
      var arrIdx = member.arrayIndex;

      for (var i = 0; i < assemblyGroups.length; i++) {
        var g = assemblyGroups[i];
        if (!g) continue;
        if (gid && g.id !== gid) continue;
        var pus = g.packUnits || [];
        var pu = null;
        var j = -1;

        // packUnitIndex is 1-based "set N" identity — match property first.
        // Never use it as a 0-based array subscript (multi-PU groups break).
        if (setIdx != null) {
          for (var k = 0; k < pus.length; k++) {
            if (pus[k] && +pus[k].packUnitIndex === +setIdx) {
              pu = pus[k];
              j = k;
              break;
            }
          }
        }
        if (!pu && arrIdx != null && pus[arrIdx]) {
          pu = pus[arrIdx];
          j = arrIdx;
        }
        if (!pu && pus.length === 1) {
          pu = pus[0];
          j = 0;
        }

        if (pu) {
          out.group = g;
          out.packUnit = pu;
          out.groupIndex = i;
          out.unitIndex = j;
          return out;
        }
        if (gid && g.id === gid) {
          out.group = g;
          out.groupIndex = i;
          return out;
        }
      }
    } catch (_) { /* */ }
    return out;
  }

  /**
   * Classification snapshot for a packUnit (read-only; does not stamp).
   * @param {object} pu
   * @param {object} [group]
   * @returns {object}
   */
  function classifySnapshot(pu, group) {
    if (typeof SI.classifyPackUnit === 'function') {
      try {
        return SI.classifyPackUnit(pu, group) || {};
      } catch (_) { /* */ }
    }
    return {
      profileClass: 'unknown',
      loadRole: 'filler',
      stackPolicy: 'never',
      fitVerdict: 'fits_floor',
      reason: '',
    };
  }

  /**
   * Build one unit-level siHints object (plain data — caller may assign).
   *
   * @param {object} opts
   * @param {object} [opts.packUnit]
   * @param {object} [opts.group]
   * @param {object} [opts.orderedBundle]  from createLoadPlan
   * @param {object} [opts.member]
   * @param {object} [opts.memberZone]     twin home/far override
   * @param {object} [opts.planHint]
   * @param {object} [opts.classification]
   * @returns {object} SteelIntelUnitHints-shaped object
   */
  function createUnitHint(opts) {
    var o = opts || {};
    var pu = o.packUnit || null;
    var g = o.group || null;
    var ob = o.orderedBundle || null;
    var member = o.member || null;
    var mz = o.memberZone || null;
    var ph = o.planHint || null;
    var cls = o.classification || classifySnapshot(pu, g);

    var pairSide = null;
    if (mz && mz.pairSide) pairSide = mz.pairSide;
    else if (member && member.pairSide) pairSide = member.pairSide;

    var loadRole = (mz && mz.loadRole)
      || (cls && cls.loadRole)
      || (ob && ob.loadRole)
      || (ph && ph.loadRole)
      || 'filler';

    var zonePref = (mz && mz.zonePref)
      || (ob && ob.zonePref)
      || (ph && ph.zonePref)
      || null;

    var layerIntent = (mz && mz.layerIntent)
      || (ob && ob.layerIntent)
      || (ph && ph.layerIntent)
      || null;

    var bundleIndex = 0;
    var bundleCount = 1;
    if (ob && ob.members && ob.members.length) {
      bundleCount = ob.members.length;
      if (member && member.unitIndex != null) {
        for (var i = 0; i < ob.members.length; i++) {
          if (ob.members[i] && ob.members[i].unitIndex === member.unitIndex) {
            bundleIndex = i;
            break;
          }
        }
      } else if (mz && mz.unitIndex != null) {
        for (var j = 0; j < ob.members.length; j++) {
          if (ob.members[j] && ob.members[j].unitIndex === mz.unitIndex) {
            bundleIndex = j;
            break;
          }
        }
      } else if (pairSide === 'far') {
        bundleIndex = Math.min(1, bundleCount - 1);
      }
    }

    var reasonParts = [];
    if (cls && cls.reason) reasonParts.push(cls.reason);
    if (ob && ob.bundleType) reasonParts.push('bundle=' + ob.bundleType);
    if (zonePref) reasonParts.push('zone=' + zonePref);
    if (layerIntent) reasonParts.push('layer=' + layerIntent);

    return {
      bundleId: (ob && ob.bundleId) || null,
      bundleType: (ob && ob.bundleType) || null,
      bundleIndex: bundleIndex,
      bundleCount: bundleCount,
      pairId: (ob && lower(ob.bundleType) === 'twin_beam')
        ? (ob.bundleId || null) : null,
      pairSide: pairSide,
      profileClass: (cls && cls.profileClass) || 'unknown',
      loadRole: loadRole,
      stackPolicy: (cls && cls.stackPolicy) || 'never',
      zonePref: zonePref,
      layerIntent: layerIntent,
      fitVerdict: (cls && cls.fitVerdict) || 'fits_floor',
      reason: reasonParts.join('; '),
      // loadSeq from loadPlan.orderedBundles order (metadata only; not _checkOrder)
      loadSeq: (o.loadSeq != null && isFinite(+o.loadSeq) && +o.loadSeq > 0)
        ? Math.floor(+o.loadSeq)
        : null,
      unloadSeq: null,
      aisleReserve: !!(ph && ph.aisleReserve),
    };
  }

  /**
   * Attach siHints on packUnit / group as metadata only.
   * Never writes packer contract fields.
   * @param {object} target  packUnit or group
   * @param {object} hints
   */
  function stampSiHints(target, hints) {
    if (!target || !hints) return;
    // Fresh object — do not alias mutable plan rows
    target.siHints = {
      bundleId: hints.bundleId,
      bundleType: hints.bundleType,
      bundleIndex: hints.bundleIndex,
      bundleCount: hints.bundleCount,
      pairId: hints.pairId,
      pairSide: hints.pairSide,
      profileClass: hints.profileClass,
      loadRole: hints.loadRole,
      stackPolicy: hints.stackPolicy,
      zonePref: hints.zonePref,
      layerIntent: hints.layerIntent,
      fitVerdict: hints.fitVerdict,
      reason: hints.reason,
      loadSeq: hints.loadSeq,
      unloadSeq: hints.unloadSeq,
      aisleReserve: !!hints.aisleReserve,
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Required fields on every packUnit.siHints after createHints.
   * @param {object} h
   * @returns {boolean}
   */
  function hintComplete(h) {
    if (!h) return false;
    if (!h.bundleId || !h.bundleType) return false;
    if (!(+h.loadSeq > 0)) return false;
    if (!h.zonePref || !h.layerIntent) return false;
    if (!h.loadRole || !h.stackPolicy) return false;
    return true;
  }

  /**
   * Stable fallback bundle id (does not alter createBundles membership).
   * @param {string} bundleType
   * @param {string} stagingGroupId
   * @param {number} packUnitIndex
   * @returns {string}
   */
  function fallbackBundleId(bundleType, stagingGroupId, packUnitIndex) {
    if (typeof SI.createBundleId === 'function') {
      try {
        return SI.createBundleId(bundleType, stagingGroupId, packUnitIndex);
      } catch (_) { /* */ }
    }
    var prefix = (bundleType === 'leftover') ? 'left' : 'filler';
    var gid = str(stagingGroupId || 'G').replace(/[^\w.\-]+/g, '_').slice(0, 48);
    var set = (packUnitIndex != null && isFinite(+packUnitIndex))
      ? Math.max(0, Math.floor(+packUnitIndex)) : 0;
    return prefix + ':' + gid + ':set' + set;
  }

  /**
   * Build a singleton fallback hint for a packUnit missing from orderedBundles
   * (or with incomplete siHints). Does not change bundle membership.
   *
   * @param {object} pu
   * @param {object} g
   * @param {number} packUnitIndex
   * @param {number} loadSeq
   * @returns {object}
   */
  function createFallbackUnitHint(pu, g, packUnitIndex, loadSeq) {
    var cls = classifySnapshot(pu, g);
    var oversize = lower(cls.fitVerdict) === 'oversize_plan';
    var bundleType = oversize ? 'leftover' : 'filler';
    var gid = (g && g.id) || (pu && pu.stagingGroupId) || 'G';
    var setIdx = (pu && pu.packUnitIndex != null)
      ? pu.packUnitIndex
      : packUnitIndex;
    var bundleId = fallbackBundleId(bundleType, gid, setIdx);

    var zonePref = oversize ? 'Z_OUT' : 'Z_UPPER';
    var layerIntent = oversize ? 'L2' : 'L2';
    var loadRole = oversize
      ? 'leftover_candidate'
      : (cls.loadRole || 'filler');
    var stackPolicy = cls.stackPolicy || 'never';

    var fakeBundle = {
      bundleId: bundleId,
      bundleType: bundleType,
      members: [],
      zonePref: zonePref,
      layerIntent: layerIntent,
      loadRole: loadRole,
    };

    var hint = createUnitHint({
      packUnit: pu,
      group: g,
      orderedBundle: fakeBundle,
      member: {
        stagingGroupId: gid,
        packUnitIndex: setIdx,
        mark: pu && pu.mark,
      },
      memberZone: {
        zonePref: zonePref,
        layerIntent: layerIntent,
        loadRole: loadRole,
      },
      planHint: {
        zonePref: zonePref,
        layerIntent: layerIntent,
        loadRole: loadRole,
        aisleReserve: !oversize,
      },
      classification: cls,
      loadSeq: loadSeq,
    });

    // Ensure required fields even if createUnitHint omitted any
    hint.bundleId = hint.bundleId || bundleId;
    hint.bundleType = hint.bundleType || bundleType;
    hint.loadSeq = loadSeq;
    hint.zonePref = hint.zonePref || zonePref;
    hint.layerIntent = hint.layerIntent || layerIntent;
    hint.loadRole = hint.loadRole || loadRole;
    hint.stackPolicy = hint.stackPolicy || stackPolicy;
    hint.profileClass = hint.profileClass || cls.profileClass || 'unknown';
    hint.fitVerdict = hint.fitVerdict || cls.fitVerdict || 'fits_floor';
    hint.bundleIndex = 0;
    hint.bundleCount = 1;
    hint.pairId = null;
    hint.pairSide = null;
    hint.reason = (hint.reason ? hint.reason + '; ' : '')
      + 'fallback singleton (missing from orderedBundles)';

    return hint;
  }

  function touchGroupMap(groupMap, g, hint) {
    if (!g || !g.id || !hint) return;
    if (!groupMap[g.id]) {
      groupMap[g.id] = {
        stagingGroupId: g.id,
        mark: g.mark || null,
        groupKind: g.groupKind || null,
        siHints: {
          bundleId: hint.bundleId,
          bundleType: hint.bundleType,
          profileClass: hint.profileClass,
          loadRole: hint.loadRole,
          stackPolicy: hint.stackPolicy,
          zonePref: hint.zonePref,
          layerIntent: hint.layerIntent,
          pairSide: hint.pairSide,
          fitVerdict: hint.fitVerdict,
          reason: hint.reason,
          loadSeq: hint.loadSeq,
          unitCount: 0,
        },
      };
    }
    groupMap[g.id].siHints.unitCount += 1;
    if (groupMap[g.id].siHints.loadSeq == null
        || hint.loadSeq < groupMap[g.id].siHints.loadSeq) {
      groupMap[g.id].siHints.loadSeq = hint.loadSeq;
    }
    if (hint.loadRole === 'floor_anchor' || hint.loadRole === 'twin_mate') {
      groupMap[g.id].siHints.loadRole = hint.loadRole;
      groupMap[g.id].siHints.zonePref = hint.zonePref;
      groupMap[g.id].siHints.layerIntent = hint.layerIntent;
      groupMap[g.id].siHints.pairSide = hint.pairSide;
    }
    stampSiHints(g, groupMap[g.id].siHints);
  }

  /**
   * Create SI metadata hints from a load plan.
   * Stamps packUnit.siHints / group.siHints only (metadata).
   * Ensures every staging packUnit receives complete siHints (fallback if needed).
   *
   * @param {object} loadPlan  from SteelIntel.createLoadPlan
   * @returns {{
   *   groupHints: object[],
   *   unitHints: object[],
   *   fallbackHintCount: number,
   *   coverage: { total: number, complete: number, incomplete: number }
   * }}
   */
  function createHints(loadPlan) {
    var plan = loadPlan || {};
    var ordered = plan.orderedBundles || [];
    var planHints = plan.planHints || [];
    var unitHints = [];
    var groupMap = {}; // groupId → aggregated hint
    // Continuous load sequence from orderedBundles (1…N). Metadata only.
    var nextSeq = 1;
    var covered = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var coveredKeys = {}; // fallback key set when WeakSet unavailable

    function markCovered(pu, g, setIdx) {
      if (pu && covered) {
        try { covered.add(pu); } catch (_) { /* */ }
      }
      var key = str((g && g.id) || (pu && pu.stagingGroupId) || '?')
        + '#' + String(setIdx);
      coveredKeys[key] = true;
    }

    function isCovered(pu, g, setIdx) {
      if (pu && covered) {
        try { if (covered.has(pu) && hintComplete(pu.siHints)) return true; }
        catch (_) { /* */ }
      }
      var key = str((g && g.id) || (pu && pu.stagingGroupId) || '?')
        + '#' + String(setIdx);
      if (coveredKeys[key] && pu && hintComplete(pu.siHints)) return true;
      return !!(pu && hintComplete(pu.siHints));
    }

    for (var i = 0; i < ordered.length; i++) {
      var ob = ordered[i] || {};
      var ph = planHints[i] || null;
      var members = ob.members || [];
      var memberZones = ob.memberZones || [];
      var isTwin = lower(ob.bundleType) === 'twin_beam';
      var bundleStartSeq = nextSeq;
      // Record on plan row for consumers (not packer _checkOrder)
      ob.loadSeqStart = bundleStartSeq;

      for (var m = 0; m < members.length; m++) {
        var member = members[m] || {};
        var mz = null;
        for (var z = 0; z < memberZones.length; z++) {
          if (memberZones[z]
              && memberZones[z].unitIndex === member.unitIndex) {
            mz = memberZones[z];
            break;
          }
        }
        // Fallback twin sides by member order
        if (!mz && isTwin) {
          mz = {
            unitIndex: member.unitIndex,
            pairSide: m === 0 ? 'home' : 'far',
            zonePref: m === 0 ? 'Z_HOME_BASE' : 'Z_FAR_BASE',
            layerIntent: 'L0',
            loadRole: m === 0 ? 'floor_anchor' : 'twin_mate',
          };
        }

        // loadSeq: one number per non-twin bundle; twin home / far consecutive
        var loadSeq = bundleStartSeq;
        if (isTwin) {
          var side = (mz && mz.pairSide) ? lower(mz.pairSide)
            : (m === 0 ? 'home' : 'far');
          loadSeq = (side === 'far')
            ? (bundleStartSeq + 1)
            : bundleStartSeq;
        }

        var resolved = resolveMember(member);
        var pu = resolved.packUnit;
        var g = resolved.group;
        var cls = classifySnapshot(pu, g);

        var hint = createUnitHint({
          packUnit: pu,
          group: g,
          orderedBundle: ob,
          member: member,
          memberZone: mz,
          planHint: ph,
          classification: cls,
          loadSeq: loadSeq,
        });

        // Metadata stamp only — never packer fields / _checkOrder
        if (pu) {
          stampSiHints(pu, hint);
          var setIdx0 = member.packUnitIndex != null
            ? member.packUnitIndex
            : resolved.unitIndex;
          markCovered(pu, g, setIdx0);
        }

        var unitRow = {
          stagingGroupId: member.stagingGroupId
            || (g && g.id) || null,
          packUnitIndex: member.packUnitIndex != null
            ? member.packUnitIndex
            : resolved.unitIndex,
          unitIndex: member.unitIndex != null
            ? member.unitIndex
            : resolved.unitIndex,
          mark: member.mark || (pu && pu.mark) || null,
          siHints: hint,
        };
        unitHints.push(unitRow);

        touchGroupMap(groupMap, g, hint);
      }

      // Advance continuous sequence
      if (isTwin) nextSeq = bundleStartSeq + 2;
      else nextSeq = bundleStartSeq + 1;
    }

    // ── Coverage pass: every staging packUnit must have complete siHints ──
    var fallbackHintCount = 0;
    var totalPu = 0;
    var completePu = 0;
    try {
      var groups = (typeof assemblyGroups !== 'undefined' && assemblyGroups)
        ? assemblyGroups : [];
      for (var gi = 0; gi < groups.length; gi++) {
        var grp = groups[gi];
        if (!grp) continue;
        var pus = grp.packUnits || [];
        for (var pi = 0; pi < pus.length; pi++) {
          var packU = pus[pi];
          if (!packU) continue;
          totalPu += 1;
          var setIdx = (packU.packUnitIndex != null) ? packU.packUnitIndex : pi;

          if (isCovered(packU, grp, setIdx) && hintComplete(packU.siHints)) {
            completePu += 1;
            continue;
          }

          // Missing from orderedBundles (or incomplete stamp) → singleton fallback
          var fbSeq = nextSeq;
          nextSeq += 1;
          var fbHint = createFallbackUnitHint(packU, grp, setIdx, fbSeq);
          stampSiHints(packU, fbHint);
          markCovered(packU, grp, setIdx);
          fallbackHintCount += 1;
          completePu += 1;

          unitHints.push({
            stagingGroupId: grp.id || null,
            packUnitIndex: setIdx,
            unitIndex: pi,
            mark: packU.mark || null,
            siHints: fbHint,
            fallback: true,
          });
          touchGroupMap(groupMap, grp, fbHint);
        }
      }
    } catch (_) { /* staging unavailable — skip coverage pass */ }

    var groupHints = [];
    Object.keys(groupMap).forEach(function (id) {
      groupHints.push(groupMap[id]);
    });

    var incomplete = Math.max(0, totalPu - completePu);

    return {
      groupHints: groupHints,
      unitHints: unitHints,
      fallbackHintCount: fallbackHintCount,
      coverage: {
        total: totalPu,
        complete: completePu,
        incomplete: incomplete,
      },
    };
  }

  /**
   * FUTURE adapter — prepares a dry-run projection plan.
   *
   * IMPORTANT: Must NOT write (yet):
   *   _checkOrder, checked, footprints, freeze flags
   *
   * Returns what a later Optimise hook could project; no packer mutation.
   *
   * @param {object} hintsResult  from createHints  { groupHints, unitHints }
   * @param {object} [opts]
   * @returns {{
   *   ok: boolean,
   *   dryRun: true,
   *   writesEnabled: false,
   *   planned: object[],
   *   skipped: string[],
   *   note: string
   * }}
   */
  function projectHintsToContract(hintsResult, opts) {
    var o = opts || {};
    var unitHints = (hintsResult && hintsResult.unitHints) || [];
    var planned = [];
    var skipped = [
      '_checkOrder',
      'checked',
      'packFootprintL',
      'packFootprintW',
      'packFootprintH',
      'packLengthMm',
      'packWidthMm',
      'packHeightMm',
      'stableBundleMm',
      '_freezeGroupByPose',
      '_keepGroupByBundle',
      '_shipPrepped',
      '_groupByQuat',
    ];

    for (var i = 0; i < unitHints.length; i++) {
      var row = unitHints[i];
      if (!row || !row.siHints) continue;
      var h = row.siHints;
      planned.push({
        stagingGroupId: row.stagingGroupId,
        packUnitIndex: row.packUnitIndex,
        mark: row.mark,
        // Future mapping preview only — not applied
        wouldSet: {
          // loadSeq → _checkOrder  (blocked for now)
          loadSeq: h.loadSeq,
          loadRole: h.loadRole,
          zonePref: h.zonePref,
          layerIntent: h.layerIntent,
          bundleId: h.bundleId,
          pairSide: h.pairSide,
          fitVerdict: h.fitVerdict,
        },
        applied: false,
      });
    }

    // Explicit no-write guard (even if caller passes write:true today)
    if (o.write === true) {
      return {
        ok: false,
        dryRun: true,
        writesEnabled: false,
        planned: planned,
        skipped: skipped,
        note: 'projectHintsToContract refuses writes — '
          + '_checkOrder / checked / footprints / freeze flags not enabled yet',
      };
    }

    return {
      ok: true,
      dryRun: true,
      writesEnabled: false,
      planned: planned,
      skipped: skipped,
      note: 'Dry-run only. Metadata remains on siHints; packer contract untouched.',
    };
  }

  SI.createUnitHint = createUnitHint;
  SI.createHints = createHints;
  SI.projectHintsToContract = projectHintsToContract;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
