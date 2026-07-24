/**
 * main.js
 * Central orchestrator. The C# WinForms host calls these two functions:
 *
 *   loadSceneFromDotNet(jsonString)
 *     Called after C# parses the IFC/Excel file.
 *     Shows the STAGING VIEW — all bundles outside the container.
 *
 *   packAndRender()
 *     Called when the user clicks "Optimize packing" in the C# UI.
 *     Runs the full packing engine and shows items inside the container.
 *
 * Everything else is internal to the JS side.
 *
 * Data flow:
 *   C# JSON ? buildEnrichedItems ? optimizePacking
 *         ? containers + overflowItems ? Three.js renderer
 */
'use strict';

// ?? Module globals ????????????????????????????????????????????????????????????

let _rawScene = null;   // raw JSON from C#
let _enrichedItems = [];     // after itemProperties.enrichItem()
let _packingResult = null;   // after optimizePacking()
let _currentContainer = 0;

// Three.js core
let _renderer, _scene, _camera, _orbit;
let _clickable = [];         // [{ mesh, item, isOverflow, inContainer }]
let _selected = null;
let _contBounds = null;       // { L, W, H } in world units (for clamping)
let _containerSpec = null;     // the spec object used for packing

// Rotation-preview widget
let _rwScene, _rwCam, _rwRenderer, _rwControls, _rwMesh, _rwRot;
let _rwReady = false;

// ?? Boot: Three.js ???????????????????????????????????????????????????????????

function _initThree() {
    const canvas = document.getElementById('c');
    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setClearColor(0x0d0e12);
    _renderer.setPixelRatio(window.devicePixelRatio);

    _scene = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(42, 1, 0.05, 500);
    _camera.position.set(10, 7, 14);

    _orbit = new THREE.OrbitControls(_camera, canvas);
    _orbit.enableDamping = true;
    _orbit.dampingFactor = 0.08;

    _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 0.75); d1.position.set(6, 14, 9); _scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.25); d2.position.set(-6, -4, -9); _scene.add(d2);
    _scene.add(new THREE.GridHelper(80, 80, 0x181b24, 0x181b24));

    _resize();
    window.addEventListener('resize', _resize);
    canvas.addEventListener('mousedown', () => { _dragMoved = false; });
    canvas.addEventListener('mousemove', () => { _dragMoved = true; });
    canvas.addEventListener('click', _onClick);
    window.addEventListener('keydown', _onKey);

    (function loop() { requestAnimationFrame(loop); _orbit.update(); _renderer.render(_scene, _camera); })();
}

let _dragMoved = false;

function _resize() {
    const W = window.innerWidth - 265, H = window.innerHeight - 50;
    _renderer.setSize(W, H);
    _camera.aspect = W / H;
    _camera.updateProjectionMatrix();
}

// ?? Public API (called by C#) ????????????????????????????????????????????????

/**
 * Called by C# after it has parsed the IFC/Excel file into JSON.
 * Shows the STAGING VIEW: bundles outside the (empty) container.
 *
 * @param {string} jsonString - JSON.stringify of the SceneData object
 */
function loadSceneFromDotNet(jsonString) {
    try {
        _rawScene = JSON.parse(jsonString);
        _containerSpec = {
            length_mm: _rawScene.container.lengthMm || CONSTANTS.CONTAINER.LENGTH_MM,
            width_mm: _rawScene.container.widthMm || CONSTANTS.CONTAINER.WIDTH_MM,
            height_mm: _rawScene.container.heightMm || CONSTANTS.CONTAINER.HEIGHT_MM,
            max_weight_kg: _rawScene.container.maxWeightKg || CONSTANTS.CONTAINER.MAX_WEIGHT_KG,
        };

        // Enrich all raw items (weight correction, shape detection, priority)
        _enrichedItems = buildEnrichedItems(_rawScene.items || []);

        // Build bundles for staging preview (no placement yet)
        const { packable, oversized } = groupAndSplit(_enrichedItems, _containerSpec);
        const allBundles = [...packable, ...oversized];

        _buildStagingScene(allBundles);
        _renderStagingPanel(allBundles);

        // Tell C# that staging is ready so it can enable the "Optimize" button
        window.chrome?.webview?.postMessage(JSON.stringify({
            type: 'stagingReady',
            bundleCount: allBundles.length,
            totalPieces: _enrichedItems.reduce((s, it) => s + it.qty, 0),
            totalWeight: _enrichedItems.reduce((s, it) => s + it.totalWeightKg, 0).toFixed(1),
        }));
    } catch (err) {
        console.error('[SteelPacking] loadSceneFromDotNet error:', err);
    }
}

/**
 * Called by C# when the user clicks "Optimize packing".
 * Runs the full packing algorithm and shows items inside the container.
 */
function packAndRender() {
    try {
        if (!_enrichedItems.length) {
            console.warn('[SteelPacking] packAndRender called before loadSceneFromDotNet');
            return;
        }

        _packingResult = optimizePacking(_enrichedItems, _containerSpec);

        _currentContainer = 0;
        _buildContainerScene(_packingResult.containers[0], _packingResult.overflowItems);
        _renderContainerPanel(_packingResult);

        window.chrome?.webview?.postMessage(JSON.stringify({
            type: 'packingComplete',
            containerCount: _packingResult.containers.length,
            overflowCount: _packingResult.overflowItems.length,
        }));
    } catch (err) {
        console.error('[SteelPacking] packAndRender error:', err);
    }
}

/** Switch between containers (called from panel tab clicks). */
function selectContainer(idx) {
    if (!_packingResult) return;
    _currentContainer = idx;
    _buildContainerScene(_packingResult.containers[idx], _packingResult.overflowItems);
    _renderContainerPanel(_packingResult);
}

// ?? Scene builders ???????????????????????????????????????????????????????????

function _clearScene() {
    _clickable = [];
    _selected = null;
    _contBounds = null;
    document.getElementById('info').style.display = 'none';
    document.getElementById('rot').style.display = 'none';
    document.getElementById('nudge').style.display = 'none';
    const keep = new Set();
    _scene.children.forEach(c => { if (c instanceof THREE.GridHelper || c instanceof THREE.Light) keep.add(c); });
    [..._scene.children].filter(c => !keep.has(c)).forEach(c => _scene.remove(c));
}

/** Staging view: empty container wireframe (dashed) + bundles outside. */
function _buildStagingScene(bundles) {
    _clearScene();
    const spec = _containerSpec;
    const L = spec.length_mm * CONSTANTS.SCALE, W = spec.width_mm * CONSTANTS.SCALE, H = spec.height_mm * CONSTANTS.SCALE;

    // Empty container reference (dashed to signal "not yet loaded")
    const bGeo = new THREE.BoxGeometry(L, H, W);
    const cBox = new THREE.LineSegments(
        new THREE.EdgesGeometry(bGeo),
        new THREE.LineDashedMaterial({ color: 0x5a6280, opacity: 0.5, transparent: true, dashSize: 0.08, gapSize: 0.05 })
    );
    cBox.computeLineDistances();
    cBox.position.set(L / 2, H / 2, 0);
    _scene.add(cBox);

    // Layout bundles in staging zone (negative X)
    const stagingItems = _layoutStagingBundles(bundles, spec);

    stagingItems.forEach(it => {
        const color = CONSTANTS.COLORS[it.shapeKey] || CONSTANTS.COLORS.unknown;
        const mesh = (it.transforms || []).length > 1
            ? GeometryRegistry.bundleMesh(it, color, 0.88)
            : GeometryRegistry.singlePieceMesh(it, color, 0.88);
        mesh.position.set(it.x * CONSTANTS.SCALE, it.y * CONSTANTS.SCALE, it.z * CONSTANTS.SCALE);
        _scene.add(mesh);
        _clickable.push({ mesh, item: it, isOverflow: false, inContainer: false });
    });

    // Camera: pulled back to see both staging and empty container
    _camera.position.set(-6, 6, 14);
    _orbit.target.set(-2, 1, 0);
    _orbit.update();
}

/** Packed view: items inside container + overflow zone outside. */
function _buildContainerScene(cont, overflowItems) {
    _clearScene();
    const spec = _containerSpec;
    const SC = CONSTANTS.SCALE;
    const L = spec.length_mm * SC, W = spec.width_mm * SC, H = spec.height_mm * SC;
    _contBounds = { L, W, H };

    // Container wireframe (solid white — it's being loaded now)
    const bGeo = new THREE.BoxGeometry(L, H, W);
    const cBox = new THREE.LineSegments(
        new THREE.EdgesGeometry(bGeo),
        new THREE.LineBasicMaterial({ color: CONSTANTS.COLORS.container, opacity: 0.3, transparent: true })
    );
    cBox.position.set(L / 2, H / 2, 0);
    _scene.add(cBox);

    // Items inside container
    cont.items.forEach(it => {
        const color = CONSTANTS.COLORS[it.shapeKey] || CONSTANTS.COLORS.unknown;
        const mesh = (it.transforms || []).length > 1
            ? GeometryRegistry.bundleMesh(it, color, 0.9)
            : GeometryRegistry.singlePieceMesh(it, color, 0.9);
        // Centre of bundle: packing coord (x,y,z) - width_mm/2 for z world
        mesh.position.set(it.x * SC, it.y * SC, (it.z - spec.width_mm / 2) * SC);
        _scene.add(mesh);
        _clickable.push({ mesh, item: it, isOverflow: false, inContainer: true });
    });

    // Overflow items outside (full size, red tint)
    overflowItems.forEach(it => {
        const mesh = GeometryRegistry.singlePieceMesh(it, CONSTANTS.COLORS.overflow, 0.65);
        mesh.position.set(it.x * SC, it.y * SC, it.z * SC);
        _scene.add(mesh);
        _clickable.push({ mesh, item: it, isOverflow: true, inContainer: false });
    });

    // Camera: frame the loaded container
    _camera.position.set(L * 1.2 + 5, H + 4, W + 8);
    _orbit.target.set(L / 2, H / 3, 0);
    _orbit.update();
}

// ?? Staging layout helper ?????????????????????????????????????????????????????

function _layoutStagingBundles(bundles, spec) {
    const BOUNDARY = -500;    // right edge of nearest staging row (500mm before container)
    const ROW_Z = spec.width_mm * 4;
    const GAP = 300;
    const items = [];
    let curZ = 0;
    let rowRightX = BOUNDARY;
    let rowMaxL = 0;

    const ordered = [...bundles].sort((a, b) =>
        a.shapeKey.localeCompare(b.shapeKey) || b.bundleL - a.bundleL
    );

    for (const b of ordered) {
        if (curZ + b.bundleW > ROW_Z) {
            rowRightX -= rowMaxL + GAP;
            curZ = 0; rowMaxL = 0;
        }
        items.push({
            ...b,
            shapeKey: b.shapeKey,
            unitLengthMm: b.unitLengthMm, unitWidthMm: b.unitWidthMm, unitHeightMm: b.unitHeightMm,
            flangeT_mm: b.flangeT_mm, webT_mm: b.webT_mm,
            lengthMm: b.bundleL, widthMm: b.bundleW, heightMm: b.bundleH,
            x: rowRightX - b.bundleL / 2,
            y: b.bundleH / 2,
            z: -spec.width_mm / 2 + curZ + b.bundleW / 2,
        });
        curZ += b.bundleW + GAP;
        rowMaxL = Math.max(rowMaxL, b.bundleL);
    }
    return items;
}

// ?? Raycasting ???????????????????????????????????????????????????????????????

const _raycaster = new THREE.Raycaster();
const _mouse = new THREE.Vector2();

function _onClick(e) {
    if (_dragMoved) return;
    const rect = e.target.getBoundingClientRect();
    _mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    _mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.setFromCamera(_mouse, _camera);

    const hits = _raycaster.intersectObjects(_clickable.map(c => c.mesh), true);
    if (!hits.length) { _deselect(); return; }
    const hit = hits[0].object;
    const entry = _clickable.find(c => c.mesh === hit || c.mesh.getObjectById(hit.id));
    if (!entry) { _deselect(); return; }
    _select(entry);
}

function _select(entry) {
    if (_selected && _selected !== entry) _tint(_selected.mesh, 0, 0);
    _selected = entry;
    _checkFit();
    _renderInfo();
    _openRotWidget(entry);
}

function _deselect() {
    if (_selected) _tint(_selected.mesh, 0, 0);
    _selected = null;
    document.getElementById('info').style.display = 'none';
    document.getElementById('rot').style.display = 'none';
    document.getElementById('nudge').style.display = 'none';
}

function _tint(mesh, hex, intensity) {
    mesh.traverse(o => {
        if (o.material?.emissive) {
            o.material.emissive.setHex(hex);
            if (intensity !== undefined && o.material.emissiveIntensity !== undefined)
                o.material.emissiveIntensity = intensity;
        }
    });
}

// ?? Fit check ????????????????????????????????????????????????????????????????

function _checkFit() {
    if (!_selected) return;
    if (!_selected.inContainer || !_contBounds) {
        _tint(_selected.mesh, CONSTANTS.COLORS.selected_ok, 0.5);
        _selected.fitProblem = null;
        return;
    }

    const { L, W, H } = _contBounds;
    _selected.mesh.updateMatrixWorld(true);
    const selfBox = new THREE.Box3().setFromObject(_selected.mesh);
    const contBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -W / 2 - 0.5), new THREE.Vector3(L + 0.5, H + 0.5, W / 2 + 0.5));

    if (!contBox.containsBox(selfBox)) {
        _selected.fitProblem = 'outside container walls';
        _tint(_selected.mesh, CONSTANTS.COLORS.selected_bad, 0.7); return;
    }
    for (const o of _clickable) {
        if (o === _selected || o.isOverflow) continue;
        o.mesh.updateMatrixWorld(true);
        if (selfBox.intersectsBox(new THREE.Box3().setFromObject(o.mesh))) {
            _selected.fitProblem = `overlaps ${o.item.mark}`;
            _tint(_selected.mesh, CONSTANTS.COLORS.selected_bad, 0.7); return;
        }
    }
    _selected.fitProblem = null;
    _tint(_selected.mesh, CONSTANTS.COLORS.selected_ok, 0.55);
}

// ?? Info panel ???????????????????????????????????????????????????????????????

function _renderInfo() {
    if (!_selected) return;
    const it = _selected.item;
    const el = document.getElementById('info'); el.style.display = 'block';
    document.getElementById('nudge').style.display = 'block';

    document.getElementById('iMark').textContent = it.mark || '?';
    document.getElementById('iShape').textContent =
        `${CONSTANTS.SHAPE_LABELS[it.shapeKey] || it.shapeKey}  ·  ${it.qty || 1} pcs`;
    document.getElementById('iDims').textContent =
        `L=${Math.round(it.lengthMm || it.unitLengthMm)} W=${Math.round(it.widthMm || it.unitWidthMm)} H=${Math.round(it.heightMm || it.unitHeightMm)} mm`;
    document.getElementById('iWt').textContent = `Weight: ${(it.weight || 0).toFixed(1)} kg`;
    _updateCoords();
    _updateFitLabel();
}

function _updateCoords() {
    if (!_selected) return;
    const p = _selected.mesh.position, SC = CONSTANTS.SCALE;
    document.getElementById('iCoords').textContent =
        `X=${(p.x / SC).toFixed(0)}  Y=${(p.y / SC).toFixed(0)}  Z=${(p.z / SC).toFixed(0)} mm`;
}

function _updateFitLabel() {
    if (!_selected) return;
    const el = document.getElementById('iFit');
    if (_selected.fitProblem) {
        el.className = 'fit bad'; el.textContent = `? ${_selected.fitProblem}`;
    } else {
        el.className = 'fit ok'; el.textContent = '? Fits — no overlap';
    }
}

// ?? Keyboard nudge (arrow keys) with container-boundary clamping ??????????????

function _onKey(e) {
    if (!_selected) return;
    if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;

    const SC = CONSTANTS.SCALE;
    const ? = (parseFloat(document.getElementById('stepInput')?.value) || 50) * SC;
    let dx = 0, dy = 0, dz = 0;

    switch (e.key) {
        case 'ArrowLeft': dy = -?; break;
        case 'ArrowRight': dy = +?; break;
        case 'ArrowUp': dx = +?; break;
        case 'ArrowDown': dx = -?; break;
        case 'PageUp': dz = -?; break;
        case 'PageDown': dz = +?; break;
        default: return;
    }
    e.preventDefault();

    const mesh = _selected.mesh;
    mesh.position.x += dx;
    mesh.position.y += dy;
    mesh.position.z += dz;

    // Strict boundary clamping for items INSIDE the container
    if (_selected.inContainer && _contBounds) {
        mesh.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(mesh);
        const sz = new THREE.Vector3(); bb.getSize(sz);
        const { L, W, H } = _contBounds;
        mesh.position.x = Math.min(Math.max(mesh.position.x, sz.x / 2), L - sz.x / 2);
        mesh.position.y = Math.min(Math.max(mesh.position.y, sz.y / 2), H - sz.y / 2);
        mesh.position.z = Math.min(Math.max(mesh.position.z, -W / 2 + sz.z / 2), W / 2 - sz.z / 2);
    }

    _checkFit();
    _updateCoords();
    _updateFitLabel();
}

// ?? Rotation widget ???????????????????????????????????????????????????????????

function _openRotWidget(entry) {
    document.getElementById('rot').style.display = 'block';
    document.getElementById('rotTitle').textContent = `${entry.item.mark} — rotate`;

    if (!_rwReady) {
        _rwScene = new THREE.Scene(); _rwScene.background = new THREE.Color(0x060709);
        _rwCam = new THREE.PerspectiveCamera(38, 310 / 220, 0.01, 100);
        _rwCam.position.set(2, 1.4, 2);
        _rwRenderer = new THREE.WebGLRenderer({ canvas: document.getElementById('rotCanvas'), antialias: true });
        _rwRenderer.setSize(310, 220);
        _rwControls = new THREE.OrbitControls(_rwCam, _rwRenderer.domElement);
        _rwControls.enableZoom = false; _rwControls.enablePan = false;
        _rwScene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const d = new THREE.DirectionalLight(0xffffff, 0.8); d.position.set(4, 6, 5); _rwScene.add(d);
        _rwScene.add(new THREE.AxesHelper(2));
        _rwReady = true;
        (function rl() { requestAnimationFrame(rl); _rwControls.update(); _rwRenderer.render(_rwScene, _rwCam); })();
    }

    if (_rwMesh) _rwScene.remove(_rwMesh);
    const it = entry.item;
    _rwMesh = GeometryRegistry.singlePieceMesh({
        shapeKey: it.shapeKey,
        lengthMm: it.unitLengthMm || it.lengthMm,
        widthMm: it.unitWidthMm || it.widthMm,
        heightMm: it.unitHeightMm || it.heightMm,
        flangeT_mm: it.flangeT_mm,
        webT_mm: it.webT_mm,
        diam_mm: it.diam_mm,
    }, CONSTANTS.COLORS[it.shapeKey] || CONSTANTS.COLORS.unknown, 0.92);
    _rwScene.add(_rwMesh);
    _rwRot = { x: 0, y: 0, z: 0 };

    const box = new THREE.Box3().setFromObject(_rwMesh);
    const sz = new THREE.Vector3(); box.getSize(sz);
    const md = Math.max(sz.x, sz.y, sz.z) || 1;
    _rwCam.position.set(md * 2, md * 1.2, md * 2);
    _rwControls.target.set(0, 0, 0); _rwControls.update();
}

function rotPreview(axis) {
    if (!_rwMesh) return;
    _rwMesh.rotation[axis] += Math.PI / 2;
    _rwRot[axis] += Math.PI / 2;
}

function rotReset() {
    if (_rwMesh) _rwMesh.rotation.set(0, 0, 0);
    _rwRot = { x: 0, y: 0, z: 0 };
}

function rotApply() {
    if (!_selected) return;
    _selected.mesh.rotation.x += _rwRot.x;
    _selected.mesh.rotation.y += _rwRot.y;
    _selected.mesh.rotation.z += _rwRot.z;
    _rwRot = { x: 0, y: 0, z: 0 };
    if (_rwMesh) _rwMesh.rotation.set(0, 0, 0);
    _checkFit(); _renderInfo();
}

// ?? Panel ?????????????????????????????????????????????????????????????????????

function _renderStagingPanel(bundles) {
    document.getElementById('panelEmpty').style.display = 'none';
    document.getElementById('panelMain').style.display = 'block';
    document.getElementById('ctabs').innerHTML =
        `<div class="ctab on" style="border-color:#e8993a;color:#e8993a">Staging — not packed</div>`;

    const totalPcs = bundles.reduce((s, b) => s + (b.qty || 1), 0);
    const totalWt = bundles.reduce((s, b) => s + (b.weight || 0), 0);

    document.getElementById('pDim').textContent = `${_containerSpec.length_mm}×${_containerSpec.width_mm}×${_containerSpec.height_mm} mm`;
    document.getElementById('pPcs').textContent = `${totalPcs} pcs in ${bundles.length} bundles`;
    document.getElementById('pWt').textContent = `${totalWt.toFixed(1)} kg total`;
    document.getElementById('pVol').textContent = '— click Optimize packing';

    const sc = {};
    bundles.forEach(b => { sc[b.shapeKey] = (sc[b.shapeKey] || 0) + (b.qty || 1); });
    document.getElementById('shapes').innerHTML = Object.entries(sc)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => {
            const col = (CONSTANTS.COLORS[k] || CONSTANTS.COLORS.unknown).toString(16).padStart(6, '0');
            return `<div style="display:flex;justify-content:space-between;margin:2px 0"><span><span class="swatch" style="background:#${col}"></span>${CONSTANTS.SHAPE_LABELS[k] || k}</span><b>${v}</b></div>`;
        }).join('');
    _renderLegend();
    document.getElementById('oversizedList').innerHTML =
        '<span style="color:#4a5270">Click "Optimize packing" in the toolbar above</span>';
}

function _renderContainerPanel(result) {
    document.getElementById('panelEmpty').style.display = 'none';
    document.getElementById('panelMain').style.display = 'block';

    const { containers, overflowItems } = result;
    const c = containers[_currentContainer];

    document.getElementById('ctabs').innerHTML = containers.map((ct, i) =>
        `<div class="ctab ${i === _currentContainer ? 'on' : ''}" onclick="selectContainer(${i})">C${ct.containerNumber}</div>`
    ).join('') + (overflowItems.length
        ? `<div class="ctab" style="border-color:#e24b4a;color:#e24b4a">+${overflowItems.length} overflow</div>` : '');

    document.getElementById('pDim').textContent = `${c.length_mm}×${c.width_mm}×${c.height_mm} mm`;
    document.getElementById('pPcs').textContent = c.items.length;
    document.getElementById('pWt').textContent = `${c.used_weight_kg} kg / ${c.max_weight_kg} kg (${c.weight_pct}%)`;
    const bal = c.balance || {};
    document.getElementById('pVol').textContent = `${c.volume_pct}%  ·  L/R ${bal.leftPct || '?'}/${bal.rightPct || '?'}%`;

    // Balance warnings
    const warns = (c.balance?.warnings || []).join(' · ');
    document.getElementById('oversizedList').innerHTML = warns
        ? `<span style="color:#e8993a">${warns}</span>`
        : (overflowItems.length
            ? overflowItems.map(it => `<div>${it.mark} (${it.shapeKey})</div>`).join('')
            : '<span style="color:#4a5270">None</span>');

    const sc = {};
    c.items.forEach(it => { sc[it.shapeKey] = (sc[it.shapeKey] || 0) + (it.qty || 1); });
    document.getElementById('shapes').innerHTML = Object.entries(sc)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => {
            const col = (CONSTANTS.COLORS[k] || CONSTANTS.COLORS.unknown).toString(16).padStart(6, '0');
            return `<div style="display:flex;justify-content:space-between;margin:2px 0"><span><span class="swatch" style="background:#${col}"></span>${CONSTANTS.SHAPE_LABELS[k] || k}</span><b>${v}</b></div>`;
        }).join('');
    _renderLegend();
}

function _renderLegend() {
    document.getElementById('legend').innerHTML = Object.entries(CONSTANTS.SHAPE_LABELS).map(([k, lbl]) => {
        const col = (CONSTANTS.COLORS[k] || CONSTANTS.COLORS.unknown).toString(16).padStart(6, '0');
        return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span class="swatch" style="background:#${col}"></span><span style="color:#8a8880">${lbl}</span></div>`;
    }).join('');
}

// ?? Boot ??????????????????????????????????????????????????????????????????????
window.addEventListener('load', _initThree);