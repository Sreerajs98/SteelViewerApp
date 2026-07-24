/**
 * extremePointEngine.js
 * Extreme-Points (EP) tracking for the 3D bin packer.
 *
 * An "extreme point" is a corner where a new box could plausibly begin:
 *   - (x+l, y, z)  — just to the right of a placed box
 *   - (x, y+h, z)  — directly on top of a placed box
 *   - (x, y, z+w)  — directly behind a placed box (along container width)
 *
 * Rules:
 *   1. Start with one EP at (0, dunnage_mm, 0) — floor level, back-left corner.
 *   2. After placing a box, add the three new EPs.
 *   3. Remove the EP that was just consumed.
 *   4. Remove any EP that lies strictly inside the newly placed box (buried).
 *   5. Deduplicate EPs that are within 1 mm of each other.
 *
 * Scoring (lower = preferred):
 *   score = y * 1e12 + x * 1e3 + z
 *   ? lowest height first (gravity), then leftmost, then furthest back.
 *
 * Left/right balance adjustment:
 *   If left side is heavier, prefer larger z (right side) and vice versa.
 *   The balance bias is added to the z component of the score.
 */
'use strict';

/**
 * Create a fresh EP set for a new container.
 * @param {number} floorY  - dunnage clearance (mm)
 */
function createEPSet(floorY) {
    return {
        points: [{ x: 0, y: floorY, z: 0 }],
        _floorY: floorY,
    };
}

/**
 * After placing a box at (ep.x, ep.y, ep.z) with extents (l, h, w),
 * update the EP set: remove consumed/buried EPs, add 3 new ones.
 */
function updateEPs(epSet, usedEP, box, placedItems) {
    const { x, y, z, l, h, w } = box;
    const TOL = 1e-6;

    // Remove the used EP and any EP buried inside the box
    epSet.points = epSet.points.filter(p => {
        if (Math.abs(p.x - usedEP.x) < 1 && Math.abs(p.y - usedEP.y) < 1 && Math.abs(p.z - usedEP.z) < 1)
            return false;
        // Buried inside box (strictly interior)
        if (p.x >= x - TOL && p.x < x + l - TOL &&
            p.y >= y - TOL && p.y < y + h - TOL &&
            p.z >= z - TOL && p.z < z + w - TOL)
            return false;
        return true;
    });

    // Add 3 new candidate EPs at the box's three exposed corners
    const candidates = [
        { x: x + l, y, z },
        { x, y: y + h, z },
        { x, y, z: z + w },
    ];

    for (const cand of candidates) {
        // Check it's inside the container (will be validated against spec later)
        // Just don't add EPs at exactly the container boundary — they'd never be usable
        if (cand.x < 0 || cand.y < 0 || cand.z < 0) continue;

        // Don't add if buried inside any ALREADY placed item
        let buried = false;
        for (const it of placedItems) {
            const ib = it._box;
            if (cand.x >= ib.x - TOL && cand.x < ib.x + ib.l - TOL &&
                cand.y >= ib.y - TOL && cand.y < ib.y + ib.h - TOL &&
                cand.z >= ib.z - TOL && cand.z < ib.z + ib.w - TOL) {
                buried = true; break;
            }
        }
        if (buried) continue;

        // Deduplicate
        const dup = epSet.points.some(p =>
            Math.abs(p.x - cand.x) < 1 &&
            Math.abs(p.y - cand.y) < 1 &&
            Math.abs(p.z - cand.z) < 1
        );
        if (!dup) epSet.points.push(cand);
    }
}

/**
 * Sort EPs: lowest Y (floor-first) ? smallest X (left-to-right) ? smallest Z.
 * An optional balanceBiasZ (>0 if left-heavy, <0 if right-heavy) shifts
 * preference toward the lighter side without fully overriding gravity.
 */
function sortedEPs(epSet, balanceBiasZ) {
    const bias = balanceBiasZ || 0;
    return epSet.points.slice().sort((a, b) => {
        const scoreA = a.y * 1e12 + a.x * 1e3 + (a.z + bias);
        const scoreB = b.y * 1e12 + b.x * 1e3 + (b.z + bias);
        return scoreA - scoreB;
    });
}