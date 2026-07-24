/**
 * balanceChecker.js
 * Centre of Gravity (CoG) calculation and load-balance warnings.
 *
 * CoG_x = ?(mass_i * x_i) / ? mass_i
 * CoG_z = ?(mass_i * z_i) / ? mass_i
 *
 * Both are expressed as fractions of the container's half-width / half-length
 * (so 0 = perfect centre, 1 = at the wall). A warning fires if |CoG| > tolerance.
 *
 * Left/Right balance:
 *   left_fraction  = total weight of items with z < 0 / total weight
 *   right_fraction = 1 - left_fraction
 *   Warning if max(left, right) > 0.55 (55:45 target)
 *
 * Front/Back balance:
 *   back_fraction  = items with x > half_length / total weight
 *   Warning if max(front, back) > 0.55
 */
'use strict';

/**
 * @param {object[]} placedItems  - items with { x, y, z, weight, ... }
 * @param {object}   spec         - { length_mm, width_mm, height_mm }
 * @returns {object} balance report
 */
function computeBalance(placedItems, spec) {
    let totalMass = 0;
    let cogX = 0, cogZ = 0;
    let leftW = 0, rightW = 0, frontW = 0, backW = 0;
    const halfL = spec.length_mm / 2;
    const halfW = spec.width_mm / 2;

    for (const it of placedItems) {
        const m = it.weight ?? it.weight_kg ?? 0;
        if (m <= 0) continue;
        totalMass += m;
        cogX += m * it.x;
        cogZ += m * it.z;

        if (it.z < 0) leftW += m; else rightW += m;
        if (it.x < halfL) frontW += m; else backW += m;
    }

    if (totalMass <= 0) {
        return {
            totalMass: 0, cogX: 0, cogZ: 0,
            leftPct: 50, rightPct: 50, frontPct: 50, backPct: 50,
            leftRightOk: true, frontBackOk: true,
            cogOffsetX: 0, cogOffsetZ: 0,
        };
    }

    cogX /= totalMass;
    cogZ /= totalMass;

    const leftPct = (leftW / totalMass) * 100;
    const rightPct = (rightW / totalMass) * 100;
    const frontPct = (frontW / totalMass) * 100;
    const backPct = (backW / totalMass) * 100;

    // Normalised offsets: 0 = centred, 1 = at wall
    const cogOffsetX = (cogX - halfL) / halfL;   // +ve = towards back wall
    const cogOffsetZ = cogZ / halfW;              // +ve = towards right side

    const TOL = CONSTANTS.COG_TOLERANCE;
    const leftRightOk = Math.max(leftPct, rightPct) / 100 <= 0.55;
    const frontBackOk = Math.max(frontPct, backPct) / 100 <= 0.55;
    const cogOk = Math.abs(cogOffsetX) <= TOL && Math.abs(cogOffsetZ) <= TOL;

    const warnings = [];
    if (!leftRightOk)
        warnings.push(`? L/R imbalance: Left ${leftPct.toFixed(1)}% / Right ${rightPct.toFixed(1)}%`);
    if (!frontBackOk)
        warnings.push(`? F/B imbalance: Front ${frontPct.toFixed(1)}% / Back ${backPct.toFixed(1)}%`);
    if (!cogOk)
        warnings.push(`? CoG offset: X=${(cogOffsetX * 100).toFixed(1)}% Z=${(cogOffsetZ * 100).toFixed(1)}%`);

    return {
        totalMass,
        cogX, cogZ,
        leftPct: +leftPct.toFixed(1), rightPct: +rightPct.toFixed(1),
        frontPct: +frontPct.toFixed(1), backPct: +backPct.toFixed(1),
        leftRightOk, frontBackOk, cogOk,
        cogOffsetX, cogOffsetZ,
        warnings,
    };
}