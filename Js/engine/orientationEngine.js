/**
 * orientationEngine.js
 * Determines valid axis-aligned orientations for a bundle.
 *
 * Rules (matching physical reality):
 * - Multi-piece bundles (qty > 1): NATURAL orientation only.
 *   The visual grid drawn by GeometryRegistry always assumes the bundle sits
 *   with its length along container X, width along Z, height along Y.
 *   Rotating it would misalign the rendered grid with the packing bounding box.
 *
 * - Single pieces with isLongMember=true: natural + rolled (swap H?W).
 *   Never turn the length axis sideways for a 12m rafter.
 *
 * - Single pieces with isLongMember=false (short plates, small angles):
 *   All 6 axis permutations are tried.
 *
 * Orientation is expressed as (packL, packW, packH) — the extents of the
 * bounding box in the (x, z, y) packing axes respectively.
 * A returned orientation fits inside the container.
 */
'use strict';

/**
 * @param {object} bundle  - from computeBundle() / groupingEngine
 * @param {object} spec    - { length_mm, width_mm, height_mm }
 * @returns {Array<{packL, packW, packH}>}  orientations that fit
 */
function validOrientations(bundle, spec) {
    const { bundleL: L, bundleW: W, bundleH: H } = bundle;
    const seen = new Set();
    const result = [];

    function add(pL, pW, pH) {
        const key = `${Math.round(pL)},${Math.round(pW)},${Math.round(pH)}`;
        if (seen.has(key)) return;
        if (pL <= spec.length_mm + 1e-6 &&
            pW <= spec.width_mm + 1e-6 &&
            pH <= spec.height_mm + 1e-6) {
            seen.add(key);
            result.push({ packL: pL, packW: pW, packH: pH });
        }
    }

    const isMulti = bundle.qty > 1;

    if (isMulti) {
        // Multi-piece bundles: ONLY natural orientation
        add(L, W, H);
        return result;
    }

    // Single piece
    add(L, W, H);          // natural
    add(L, H, W);          // rolled (swap H?W)

    const maxDim = Math.max(L, W, H);
    if (maxDim <= spec.width_mm) {
        // Short enough to tip in plan — try all 6 permutations
        add(W, L, H);
        add(W, H, L);
        add(H, L, W);
        add(H, W, L);
    }

    return result;
}