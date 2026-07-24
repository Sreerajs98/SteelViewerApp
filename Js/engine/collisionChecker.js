/**
 * collisionChecker.js
 * Axis-Aligned Bounding Box (AABB) intersection checks + support validation.
 *
 * Coordinate convention (packing space, all in mm):
 *   x  = position along container length  [0 … length_mm]
 *   y  = height above container floor     [0 … height_mm]
 *   z  = position across container width  [0 … width_mm]
 *
 * Every placed item stores:
 *   _box = { x, y, z, l, h, w }   (min-corner + extents)
 */
'use strict';

/**
 * True if box A and box B overlap in 3D space (AABB test).
 * We shrink each check by 1e-6 mm on each side to avoid
 * false positives from items that merely share a face.
 */
function aabbIntersects(a, b) {
    const TOL = 1e-6;
    return (
        a.x < b.x + b.l - TOL && a.x + a.l - TOL > b.x &&
        a.y < b.y + b.h - TOL && a.y + a.h - TOL > b.y &&
        a.z < b.z + b.w - TOL && a.z + a.w - TOL > b.z
    );
}

/**
 * True if testBox clashes with ANY already-placed item in the container.
 * O(n) scan — acceptable for typical container loads (<500 placed items).
 */
function hasClash(placedItems, testBox) {
    for (const it of placedItems) {
        if (aabbIntersects(testBox, it._box)) return true;
    }
    return false;
}

/**
 * Computes the fraction of testBox's bottom face (X×Z) that is resting on
 * something solid: the container floor/dunnage level, OR the top surfaces
 * of already-placed items.
 *
 * @param {object[]} placedItems
 * @param {object}   testBox   - { x, y, z, l, h, w }
 * @param {number}   floorY    - dunnage clearance (items AT this Y are on the floor)
 * @param {number}   minSupportRatio - default CONSTANTS.MIN_SUPPORT_RATIO
 * @returns {number}  ratio in [0,1]
 */
function supportRatio(placedItems, testBox, floorY, minSupportRatio) {
    // Resting on floor / dunnage bed
    if (testBox.y <= floorY + 1.0) return 1.0;

    const footprint = testBox.l * testBox.w;
    if (footprint <= 0) return 0;

    let covered = 0;
    for (const it of placedItems) {
        const ib = it._box;
        // Only items whose TOP aligns with testBox's BOTTOM (within 1 mm)
        if (Math.abs((ib.y + ib.h) - testBox.y) > 1.0) continue;

        // Overlap in X
        const ox1 = Math.max(testBox.x, ib.x);
        const ox2 = Math.min(testBox.x + testBox.l, ib.x + ib.l);
        if (ox2 <= ox1) continue;

        // Overlap in Z
        const oz1 = Math.max(testBox.z, ib.z);
        const oz2 = Math.min(testBox.z + testBox.w, ib.z + ib.w);
        if (oz2 <= oz1) continue;

        covered += (ox2 - ox1) * (oz2 - oz1);
    }

    return Math.min(covered / footprint, 1.0);
}

/**
 * True if testBox can be placed (no clash AND sufficient support).
 */
function canPlace(placedItems, testBox, floorY, reqSupport) {
    if (hasClash(placedItems, testBox)) return false;
    const sr = supportRatio(placedItems, testBox, floorY, reqSupport);
    return sr >= (reqSupport ?? CONSTANTS.MIN_SUPPORT_RATIO);
}