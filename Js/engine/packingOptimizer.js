/**
 * packingOptimizer.js
 * The main 3D bin-packing algorithm:
 *   Extreme-Points + Layer-Priority + Support Validation + Overflow Zone.
 *
 * Inputs: enriched items ? grouped bundles ? placed in containers.
 * Outputs: { containers[], overflowItems[] } ready for the renderer.
 *
 * Overflow logic (spec §Overflow Handling):
 *   Any bundle that cannot fit inside the container (too big or last container
 *   is full + weight limit reached) is placed in an OVERFLOW ZONE to the left
 *   of the container (at negative X), rendered at full size so the user sees
 *   the excess load clearly. Nothing is hidden or discarded.
 */
'use strict';

/**
 * @param {object[]} enrichedItems  - sorted, enriched items
 * @param {object}   spec           - { length_mm, width_mm, height_mm, max_weight_kg }
 * @returns {{ containers: object[], overflowItems: object[] }}
 */
function optimizePacking(enrichedItems, spec) {

    // Phase 1: group + split into bundles
    const { packable, oversized } = groupAndSplit(enrichedItems, spec);

    // Phase 2: sort by load layer (floor first), then descending volume
    packable.sort((a, b) =>
        a.loadLayer - b.loadLayer || -(a.bundleL * a.bundleW * a.bundleH - b.bundleL * b.bundleW * b.bundleH)
    );

    // Phase 3: Extreme-Points packing across containers
    const containers = [];
    const overflowItems = [...oversized];   // items that can never fit in one container

    for (const bundle of packable) {
        let placed = false;

        for (const cont of containers) {
            const result = _tryPlace(cont, bundle, spec);
            if (result) {
                _doPlace(cont, bundle, result.ep, result.orient, spec);
                placed = true;
                break;
            }
        }

        if (!placed) {
            // Open a new container
            const floorY = bundle.loadLayer === CONSTANTS.LAYER.FLOOR ? spec.dunnage_mm : 0;
            const newCont = _newContainer(spec, floorY);
            const orients = validOrientations(bundle, spec);

            if (!orients.length) {
                overflowItems.push(bundle);
                continue;
            }

            containers.push(newCont);
            _doPlace(newCont, bundle, newCont.epSet.points[0], orients[0], spec);
        }
    }

    // Phase 4: format output for the renderer
    const cv = spec.length_mm * spec.width_mm * spec.height_mm;
    const outContainers = containers.map((c, i) => ({
        containerNumber: i + 1,
        length_mm: spec.length_mm, width_mm: spec.width_mm, height_mm: spec.height_mm,
        max_weight_kg: spec.max_weight_kg,
        used_weight_kg: +c.weightUsed.toFixed(2),
        weight_pct: +(c.weightUsed / spec.max_weight_kg * 100).toFixed(1),
        volume_pct: +(c.items.reduce((s, it) => s + it._box.l * it._box.h * it._box.w, 0) / cv * 100).toFixed(1),
        balance: computeBalance(c.items.map(it => ({ x: it.x, z: it.z, weight: it.weight })), spec),
        items: c.items.map(it => { const { _box, ...clean } = it; return { ...clean, ...it }; }),
    }));

    return {
        containers: outContainers,
        overflowItems: _layoutOverflow(overflowItems, spec),
    };
}

// ?????????????????????????????????????????????????????????????????????????????
// Internal helpers
// ?????????????????????????????????????????????????????????????????????????????

function _newContainer(spec, floorY) {
    return {
        weightUsed: 0,
        items: [],
        epSet: createEPSet(floorY),
        layerTopY: {},
        leftWeight: 0,
        rightWeight: 0,
        frontWeight: 0,
        backWeight: 0,
    };
}

/**
 * Try to find a valid EP + orientation for the bundle in this container.
 * Returns { ep, orient } or null.
 */
function _tryPlace(cont, bundle, spec) {
    if (cont.weightUsed + bundle.weight > spec.max_weight_kg) return null;

    const orients = validOrientations(bundle, spec);
    if (!orients.length) return null;

    const layer = bundle.loadLayer ?? CONSTANTS.LAYER.MIDDLE;
    const minY = layer > 0 ? (cont.layerTopY[layer - 1] || 0) : 0;
    const floorY = cont.epSet._floorY;
    const biasZ = cont.rightWeight - cont.leftWeight > 0 ? -50 : 50;  // bias toward lighter side

    // Two-pass: first enforce layer constraint, then relax if nothing fits
    for (const enforceLayer of [true, false]) {
        const eps = sortedEPs(cont.epSet, biasZ);

        for (const ep of eps) {
            if (enforceLayer && ep.y + 1e-6 < minY) continue;

            for (const o of orients) {
                const { packL, packW, packH } = o;
                if (ep.x + packL > spec.length_mm + 1e-6) continue;
                if (ep.y + packH > spec.height_mm + 1e-6) continue;
                if (ep.z + packW > spec.width_mm + 1e-6) continue;

                const testBox = { x: ep.x, y: ep.y, z: ep.z, l: packL, h: packH, w: packW };
                const reqSup = bundle.supportRequired ?? CONSTANTS.MIN_SUPPORT_RATIO;

                if (!canPlace(cont.items, testBox, floorY, reqSup)) continue;

                return { ep, orient: o };
            }
        }
    }

    return null;
}

/**
 * Actually place the bundle at the given EP with the given orientation,
 * update the container state.
 */
function _doPlace(cont, bundle, ep, orient, spec) {
    const { packL, packW, packH } = orient;
    const box = { x: ep.x, y: ep.y, z: ep.z, l: packL, h: packH, w: packW };

    const placed = {
        // rendering info
        mark: bundle.mark,
        assemblyName: bundle.assemblyName,
        profileDesc: bundle.profileDesc,
        shapeKey: bundle.shapeKey,
        bundleMode: bundle.bundleMode,
        qty: bundle.qty,
        // dimensions (oriented)
        lengthMm: packL, widthMm: packW, heightMm: packH,
        // unit dims (for renderer to draw individual shapes inside the bundle)
        unitLengthMm: bundle.unitLengthMm,
        unitWidthMm: bundle.unitWidthMm,
        unitHeightMm: bundle.unitHeightMm,
        flangeT_mm: bundle.flangeT_mm,
        webT_mm: bundle.webT_mm,
        lipH_mm: bundle.lipH_mm,
        diam_mm: bundle.diam_mm,
        // bundle grid
        gridCols: bundle.cols ?? 1,
        gridRows: bundle.rows ?? 1,
        transforms: bundle.transforms ?? [],
        // position (centre of bounding box, in container packing coords)
        x: ep.x + packL / 2,
        y: ep.y + packH / 2,
        z: ep.z + packW / 2,           // Note: world Z = packing_z - width_mm/2
        // physics
        weight: bundle.weight,
        loadLayer: bundle.loadLayer,
        // internal
        _box: box,
        isOverflow: false,
    };

    cont.items.push(placed);
    cont.weightUsed += bundle.weight;

    // Update layer ceiling
    const layer = bundle.loadLayer ?? CONSTANTS.LAYER.MIDDLE;
    cont.layerTopY[layer] = Math.max(cont.layerTopY[layer] || 0, ep.y + packH);

    // Update balance tracking
    const halfL = spec.length_mm / 2;
    const halfW = spec.width_mm / 2;
    if (ep.z + packW / 2 < halfW) cont.leftWeight += bundle.weight;
    else cont.rightWeight += bundle.weight;
    if (ep.x + packL / 2 < halfL) cont.frontWeight += bundle.weight;
    else cont.backWeight += bundle.weight;

    // Update extreme points
    updateEPs(cont.epSet, ep, box, cont.items);
}

/**
 * Lay out overflow items in a staging area to the left of the container.
 * They are rendered at FULL size — the user can clearly see what didn't fit.
 * Overflow placement: X < OVERFLOW_X_OFFSET_MM (negative), Y on floor, Z along row.
 */
function _layoutOverflow(bundles, spec) {
    const OUT = [];
    const OX = CONSTANTS.OVERFLOW_X_OFFSET_MM;
    const GAP = CONSTANTS.OVERFLOW_ROW_GAP_MM;
    let cursorZ = 0;
    let rowMaxL = 0;
    let rowX = OX;

    for (const b of bundles) {
        if (cursorZ + b.bundleW > spec.width_mm * 3) {
            rowX -= rowMaxL + GAP;
            cursorZ = 0;
            rowMaxL = 0;
        }

        OUT.push({
            mark: b.mark,
            assemblyName: b.assemblyName,
            profileDesc: b.profileDesc,
            shapeKey: b.shapeKey,
            bundleMode: b.bundleMode,
            qty: b.qty,
            lengthMm: b.bundleL, widthMm: b.bundleW, heightMm: b.bundleH,
            unitLengthMm: b.unitLengthMm,
            unitWidthMm: b.unitWidthMm,
            unitHeightMm: b.unitHeightMm,
            flangeT_mm: b.flangeT_mm,
            webT_mm: b.webT_mm,
            lipH_mm: b.lipH_mm,
            diam_mm: b.diam_mm,
            gridCols: b.cols ?? 1,
            gridRows: b.rows ?? 1,
            transforms: b.transforms ?? [],
            // Position: overflow zone to the left of the container
            x: rowX - b.bundleL / 2,
            y: b.bundleH / 2,
            z: -spec.width_mm / 2 + cursorZ + b.bundleW / 2,
            weight: b.weight,
            isOverflow: true,
        });

        cursorZ += b.bundleW + GAP;
        rowMaxL = Math.max(rowMaxL, b.bundleL);
    }

    return OUT;
}