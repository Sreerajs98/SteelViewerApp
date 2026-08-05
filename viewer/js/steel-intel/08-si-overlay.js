/* 08-si-overlay.js — Steel Intelligence Layer: load-plan visualization (read-only)
 *
 * Displays SI metadata labels over placed meshes. Reads packUnit.siHints only.
 * Does not mutate packUnits, geometry, Group By, packer, or Optimise.
 *
 * Public: SteelIntel.showLoadOverlay() / SteelIntel.hideLoadOverlay()
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  var ROOT_ID = 'si-load-overlay-root';
  var STYLE_ID = 'si-load-overlay-style';
  var state = {
    visible: false,
    labels: [],       // { el, mesh, item, hints, world }
    raf: 0,
    onClick: null,
    onKey: null,
    selectedKey: null,
  };

  function str(v) {
    return v == null ? '' : String(v);
  }

  function lower(v) {
    return str(v).toLowerCase();
  }

  function esc(s) {
    return str(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Resolve packUnit.siHints for a layout/clickable item (read-only).
   * @param {object} item
   * @returns {{ packUnit: object|null, hints: object|null, group: object|null }}
   */
  function resolveSiHints(item) {
    var out = { packUnit: null, hints: null, group: null };
    if (!item) return out;
    try {
      if (typeof assemblyGroups === 'undefined' || !assemblyGroups) return out;
      var gid = item.stagingGroupId || item.groupId || null;
      var setIdx = item.packUnitIndex;
      var mark = item.mark || null;

      for (var i = 0; i < assemblyGroups.length; i++) {
        var g = assemblyGroups[i];
        if (!g) continue;
        if (gid && g.id !== gid) continue;
        var pus = g.packUnits || [];
        var pu = null;

        if (setIdx != null) {
          for (var j = 0; j < pus.length; j++) {
            if (pus[j] && +pus[j].packUnitIndex === +setIdx) {
              pu = pus[j];
              break;
            }
          }
        }
        if (!pu && pus.length === 1) pu = pus[0];
        if (!pu && mark) {
          for (var k = 0; k < pus.length; k++) {
            if (pus[k] && pus[k].mark === mark) {
              pu = pus[k];
              break;
            }
          }
        }
        if (pu && pu.siHints) {
          out.packUnit = pu;
          out.hints = pu.siHints;
          out.group = g;
          return out;
        }
        if (gid && g.id === gid) {
          out.group = g;
        }
      }
    } catch (_) { /* */ }
    return out;
  }

  function typeColor(bundleType) {
    var t = lower(bundleType);
    if (t === 'twin_beam') return '#1f6feb';
    if (t === 'solo_beam') return '#0969da';
    if (t.indexOf('nest_') === 0) return '#1a7f37';
    if (t === 'plate_stack') return '#9a6700';
    if (t === 'rhs_unit' || t === 'rhs_lot') return '#8250df';
    if (t === 'leftover') return '#cf222e';
    if (t === 'filler') return '#6e7781';
    return '#57606a';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + ROOT_ID + '{',
      '  position:fixed;inset:0;z-index:9200;pointer-events:none;',
      '  font-family:"IBM Plex Mono","Cascadia Mono",Consolas,monospace;',
      '}',
      '#' + ROOT_ID + ' .si-ov-banner{',
      '  position:absolute;top:10px;left:50%;transform:translateX(-50%);',
      '  pointer-events:auto;background:rgba(18,22,28,.92);color:#e6edf3;',
      '  border:1px solid rgba(230,237,243,.18);padding:6px 14px;font-size:12px;',
      '  letter-spacing:.02em;white-space:nowrap;',
      '}',
      '#' + ROOT_ID + ' .si-ov-banner button{',
      '  margin-left:12px;background:#21262d;color:#e6edf3;border:1px solid #30363d;',
      '  padding:2px 8px;cursor:pointer;font:inherit;',
      '}',
      '#' + ROOT_ID + ' .si-ov-label{',
      '  position:absolute;transform:translate(-50%,-120%);pointer-events:auto;',
      '  background:rgba(13,17,23,.88);color:#f0f3f6;border:1px solid;',
      '  padding:3px 7px;font-size:11px;line-height:1.35;cursor:pointer;',
      '  white-space:nowrap;user-select:none;',
      '  box-shadow:0 2px 8px rgba(0,0,0,.35);',
      '}',
      '#' + ROOT_ID + ' .si-ov-label:hover,',
      '#' + ROOT_ID + ' .si-ov-label.si-ov-selected{',
      '  background:rgba(22,27,34,.96);filter:brightness(1.08);',
      '}',
      '#' + ROOT_ID + ' .si-ov-label .si-ov-seq{',
      '  font-weight:700;margin-right:6px;',
      '}',
      '#' + ROOT_ID + ' .si-ov-label .si-ov-meta{',
      '  opacity:.9;',
      '}',
      '#' + ROOT_ID + ' .si-ov-panel{',
      '  position:absolute;right:12px;bottom:12px;width:min(360px,92vw);',
      '  max-height:55vh;overflow:auto;pointer-events:auto;',
      '  background:rgba(13,17,23,.94);color:#e6edf3;',
      '  border:1px solid rgba(230,237,243,.2);padding:12px 14px;font-size:12px;',
      '  line-height:1.45;',
      '}',
      '#' + ROOT_ID + ' .si-ov-panel h3{',
      '  margin:0 0 8px;font-size:13px;font-weight:600;color:#fff;',
      '}',
      '#' + ROOT_ID + ' .si-ov-panel .si-ov-row{',
      '  display:grid;grid-template-columns:110px 1fr;gap:4px 8px;margin:3px 0;',
      '}',
      '#' + ROOT_ID + ' .si-ov-panel .si-ov-k{color:#8b949e;}',
      '#' + ROOT_ID + ' .si-ov-panel .si-ov-v{color:#e6edf3;word-break:break-word;}',
      '#' + ROOT_ID + ' .si-ov-empty{opacity:.7;font-style:italic;}',
    ].join('\n');
    document.head.appendChild(style);
  }

  function getRoot() {
    var root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = [
      '<div class="si-ov-banner">',
      '  SI Load Overlay',
      '  <button type="button" data-si-ov-close>Hide</button>',
      '</div>',
      '<div class="si-ov-panel" data-si-ov-panel>',
      '  <div class="si-ov-empty">Click a label or placed item to inspect siHints.</div>',
      '</div>',
    ].join('');
    document.body.appendChild(root);
    var closeBtn = root.querySelector('[data-si-ov-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hideLoadOverlay();
      });
    }
    return root;
  }

  function clearLabels() {
    for (var i = 0; i < state.labels.length; i++) {
      var L = state.labels[i];
      if (L && L.el && L.el.parentNode) L.el.parentNode.removeChild(L.el);
    }
    state.labels = [];
  }

  function entryKey(item, hints) {
    return str((item && item.stagingGroupId) || '')
      + '#' + str(item && item.packUnitIndex)
      + '#' + str(hints && hints.bundleId)
      + '#' + str(hints && hints.loadSeq);
  }

  /**
   * TEMP SI debug — click resolution snapshot.
   * @param {object} entry  clickable entry or label row { mesh, item }
   * @param {object} resolved  from resolveSiHints
   * @param {string} via  'label' | 'scene'
   */
  function logClickResolve(entry, resolved, via) {
    var item = entry && entry.item;
    var mesh = entry && entry.mesh;
    var pu = resolved && resolved.packUnit;
    var g = resolved && resolved.group;
    var h = resolved && resolved.hints;
    var row = {
      via: via || '?',
      meshUuid: mesh && mesh.uuid ? mesh.uuid : null,
      itemStagingGroupId: item ? item.stagingGroupId : null,
      itemPackUnitIndex: item ? item.packUnitIndex : null,
      itemMark: item ? item.mark : null,
      itemLoadSeq: item && item.siHints ? item.siHints.loadSeq : null,
      resolvedPackUnitIndex: pu ? pu.packUnitIndex : null,
      resolvedGroupId: (g && g.id) || (pu && pu.stagingGroupId) || null,
      resolvedLoadSeq: h ? h.loadSeq : null,
      match: !!(h && item && item.siHints
        && +h.loadSeq === +item.siHints.loadSeq),
    };
    try {
      console.log('[SI-click]', row);
      if (typeof window !== 'undefined') {
        if (!window.__siClickTrace) window.__siClickTrace = [];
        window.__siClickTrace.push(row);
      }
    } catch (_) { /* */ }
    return row;
  }

  function buildLabels() {
    clearLabels();
    var root = getRoot();
    var list = [];
    try {
      if (typeof clickable !== 'undefined' && clickable && clickable.length) {
        list = clickable;
      }
    } catch (_) { /* */ }

    var made = 0;
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      if (!entry || !entry.mesh || !entry.item) continue;

      var resolved = resolveSiHints(entry.item);
      var hints = resolved.hints;
      if (!hints) continue;

      var el = document.createElement('div');
      el.className = 'si-ov-label';
      el.style.borderColor = typeColor(hints.bundleType);
      el.dataset.siKey = entryKey(entry.item, hints);
      el.innerHTML =
        '<span class="si-ov-seq">#' + esc(hints.loadSeq) + '</span>'
        + '<span class="si-ov-meta">'
        + esc(hints.bundleType || '?')
        + ' · ' + esc(hints.zonePref || '—')
        + ' · ' + esc(hints.layerIntent || '—')
        + '</span>';

      el.addEventListener('click', (function (ent, h, pu, g, res) {
        return function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          logClickResolve(ent, res, 'label');
          showDetail(ent.item, h, pu, g);
          highlightLabel(entryKey(ent.item, h));
        };
      })(entry, hints, resolved.packUnit, resolved.group, resolved));

      root.appendChild(el);
      state.labels.push({
        el: el,
        mesh: entry.mesh,
        item: entry.item,
        hints: hints,
        packUnit: resolved.packUnit,
        group: resolved.group,
      });
      made += 1;
    }
    return made;
  }

  function highlightLabel(key) {
    state.selectedKey = key;
    for (var i = 0; i < state.labels.length; i++) {
      var L = state.labels[i];
      if (!L || !L.el) continue;
      if (L.el.dataset.siKey === key) L.el.classList.add('si-ov-selected');
      else L.el.classList.remove('si-ov-selected');
    }
  }

  function rowHtml(k, v) {
    return '<div class="si-ov-row"><span class="si-ov-k">'
      + esc(k) + '</span><span class="si-ov-v">'
      + esc(v == null || v === '' ? '—' : v) + '</span></div>';
  }

  /**
   * Show SI metadata panel for one item (read-only).
   */
  function showDetail(item, hints, packUnit, group) {
    var root = getRoot();
    var panel = root.querySelector('[data-si-ov-panel]');
    if (!panel) return;
    var h = hints || {};
    var mark = (item && item.mark)
      || (packUnit && packUnit.mark)
      || '—';
    panel.innerHTML =
      '<h3>SI · ' + esc(mark) + '</h3>'
      + rowHtml('loadSeq', h.loadSeq)
      + rowHtml('bundleType', h.bundleType)
      + rowHtml('zonePref', h.zonePref)
      + rowHtml('layerIntent', h.layerIntent)
      + rowHtml('bundleId', h.bundleId)
      + rowHtml('loadRole', h.loadRole)
      + rowHtml('stackPolicy', h.stackPolicy)
      + rowHtml('pairSide', h.pairSide)
      + rowHtml('profileClass', h.profileClass)
      + rowHtml('fitVerdict', h.fitVerdict)
      + rowHtml('_checkOrder', packUnit ? packUnit._checkOrder : (item && item._checkOrder))
      + rowHtml('stagingGroupId', (item && item.stagingGroupId) || (group && group.id))
      + rowHtml('packUnitIndex', item && item.packUnitIndex)
      + rowHtml('reason', h.reason);
    // TEMP SI debug — last displayed panel values
    try {
      if (typeof window !== 'undefined') {
        window.__siLastDetail = {
          mark: mark,
          displayedLoadSeq: h.loadSeq != null ? +h.loadSeq : null,
          itemLoadSeq: item && item.siHints ? +item.siHints.loadSeq : null,
          stagingGroupId: (item && item.stagingGroupId) || (group && group.id) || null,
          packUnitIndex: item && item.packUnitIndex,
        };
      }
    } catch (_) { /* */ }
  }

  function projectLabels() {
    if (!state.visible) return;
    var cam = null;
    var ren = null;
    try {
      cam = typeof camera !== 'undefined' ? camera : null;
      ren = typeof renderer !== 'undefined' ? renderer : null;
    } catch (_) { /* */ }
    if (!cam || !ren || !ren.domElement || typeof THREE === 'undefined') {
      state.raf = requestAnimationFrame(projectLabels);
      return;
    }

    var rect = ren.domElement.getBoundingClientRect();
    var v = new THREE.Vector3();
    var box = new THREE.Box3();

    for (var i = 0; i < state.labels.length; i++) {
      var L = state.labels[i];
      if (!L || !L.el || !L.mesh) continue;
      try {
        L.mesh.updateMatrixWorld(true);
        box.setFromObject(L.mesh);
        if (!isFinite(box.min.x)) {
          L.el.style.display = 'none';
          continue;
        }
        v.set(
          (box.min.x + box.max.x) * 0.5,
          box.max.y,
          (box.min.z + box.max.z) * 0.5
        );
        v.project(cam);
        if (v.z < -1 || v.z > 1) {
          L.el.style.display = 'none';
          continue;
        }
        var x = (v.x * 0.5 + 0.5) * rect.width + rect.left;
        var y = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
        L.el.style.display = 'block';
        L.el.style.left = x + 'px';
        L.el.style.top = y + 'px';
      } catch (_) {
        L.el.style.display = 'none';
      }
    }
    state.raf = requestAnimationFrame(projectLabels);
  }

  function onSceneClick(e) {
    if (!state.visible) return;
    if (e.button != null && e.button !== 0) return;
    // Ignore UI chrome
    var t = e.target;
    if (t && t.closest && t.closest('#' + ROOT_ID + ' .si-ov-banner')) return;
    if (t && t.closest && t.closest('#' + ROOT_ID + ' .si-ov-panel')) return;
    if (t && t.closest && t.closest('#' + ROOT_ID + ' .si-ov-label')) return;

    var pick = null;
    try {
      if (typeof pickClickable === 'function') pick = pickClickable(e);
    } catch (_) { /* */ }
    if (!pick || !pick.found) return;

    var entry = pick.found;
    var resolved = resolveSiHints(entry.item);
    // TEMP SI debug — log even when outside / unresolved
    logClickResolve(entry, resolved || {}, 'scene');
    if (!resolved || !resolved.hints) return;

    showDetail(entry.item, resolved.hints, resolved.packUnit, resolved.group);
    highlightLabel(entryKey(entry.item, resolved.hints));
  }

  function onKeyDown(e) {
    if (!state.visible) return;
    if (e.key === 'Escape') hideLoadOverlay();
  }

  /**
   * Show SI load overlay over placed items (visualization only).
   * @returns {{ ok: boolean, labelCount: number, note?: string }}
   */
  function showLoadOverlay() {
    ensureStyle();
    var root = getRoot();
    root.style.display = 'block';
    state.visible = true;

    var n = buildLabels();
    var panel = root.querySelector('[data-si-ov-panel]');
    if (panel && n === 0) {
      panel.innerHTML = '<div class="si-ov-empty">'
        + 'No placed items with siHints. Run Group By → Optimise first, then call showLoadOverlay().'
        + '</div>';
    } else if (panel && n > 0) {
      panel.innerHTML = '<div class="si-ov-empty">'
        + 'Showing ' + n + ' placed labels. Click a label or item for full siHints.'
        + '</div>';
    }

    if (!state.onClick) {
      state.onClick = onSceneClick;
      document.addEventListener('click', state.onClick, true);
    }
    if (!state.onKey) {
      state.onKey = onKeyDown;
      document.addEventListener('keydown', state.onKey, true);
    }

    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = requestAnimationFrame(projectLabels);

    var result = {
      ok: n > 0,
      labelCount: n,
      note: n > 0
        ? 'SI overlay active (read-only)'
        : 'No placed siHints labels',
    };
    try { SI.__lastOverlayResult = result; } catch (_) { /* */ }
    if (typeof console !== 'undefined' && console.log) {
      console.log('[SteelIntel] showLoadOverlay →', result.labelCount, 'labels');
    }
    return result;
  }

  /**
   * Hide SI load overlay and tear down listeners (no scene mutation).
   */
  function hideLoadOverlay() {
    state.visible = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    clearLabels();
    var root = document.getElementById(ROOT_ID);
    if (root) root.style.display = 'none';

    if (state.onClick) {
      document.removeEventListener('click', state.onClick, true);
      state.onClick = null;
    }
    if (state.onKey) {
      document.removeEventListener('keydown', state.onKey, true);
      state.onKey = null;
    }
    state.selectedKey = null;
  }

  SI.showLoadOverlay = showLoadOverlay;
  SI.hideLoadOverlay = hideLoadOverlay;

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
