/**
 * groupingEngine.js
 * Groups enriched items by mark (and profile shape + dimensions) into
 * NestBundles, then splits bundles that are too heavy or too tall for
 * the container using binary search.
 *
 * Output:  { packable: NestBundle[], oversized: NestBundle[] }
 *
 * "Oversized" here means a single piece is bigger than the container
 * in at least two dimensions in every possible orientation — these go
 * to the overflow zone, never discarded.
 */
'use strict';

/**
 * @param {object[]} enrichedItems  - from itemProperties.buildEnrichedItems()
 * @param {object}   spec           - { length_mm, width_mm, height_mm, max_weight_kg }
 * @returns {{ packable: object[], oversized: object[] }}
 */
function groupAndSplit(enrichedItems, spec) {
    // 1. Group by a key that uniquely identifies "same mark, same section"
    const groups = new Map();
    for (const it of enrichedItems) {
        const key = `${it.shapeKey}|${it.mark}|${Math.round(it.lengthMm)}|${Math.round(it.widthMm)}|${Math.round(it.heightMm)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
    }

    const packable = [];
    const oversized = [];

    for (const group of groups.values()) {
        const template = group[0];
        const totalQty = group.reduce((s, it) => s + it.qty, 0);
        const totalWt = group.reduce((s, it) => s + it.totalWeightKg, 0);

        const full = computeBundle(template, totalQty, totalWt);

        // Bundle height budget: no single bundle taller than 40 % of container
        // or 1000 mm, whichever is smaller. This preserves the 3-layer structure.
        const maxH = Math.min(spec.height_mm * CONSTANTS.MAX_BUNDLE_HEIGHT_FRACTION, 1000);

        if (_bundleFits(full, spec, maxH)) {
            packable.push(full);
            continue;
        }

        // Can a single piece fit? If not, it goes to oversized regardless.
        const single = computeBundle(template, 1, totalWt / totalQty);
        if (!_bundleFits(single, spec, spec.height_mm)) {
            oversized.push(full);
            continue;
        }

        // Binary search for the largest sub-bundle size that fits
        let lo = 1, hi = totalQty - 1, bestN = 1;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const test = computeBundle(template, mid, (totalWt / totalQty) * mid);
            if (_bundleFits(test, spec, maxH)) { bestN = mid; lo = mid + 1; }
            else hi = mid - 1;
        }

        // Split totalQty into sub-bundles of size bestN
        let remaining = totalQty;
        let idx = 0;
        while (remaining > 0) {
            const take = Math.min(bestN, remaining);
            const wt = (totalWt / totalQty) * take;
            const b = computeBundle(template, take, wt);
            if (totalQty !== take) b.mark = `${template.mark}-p${++idx}`;
            packable.push(b);
            remaining -= take;
        }
    }

    return { packable, oversized };
}


/**
 * Can this bundle fit inside the container (any axis-aligned orientation)
 * while also respecting the weight limit AND the height budget?
 *
 * We try all 6 axis permutations of (L, W, H) against (maxL, maxW, maxH).
 */
function _bundleFits(bundle, spec, maxH) {
    if (bundle.weight > spec.max_weight_kg + 1e-6) return false;
    const dims = [bundle.bundleL, bundle.bundleW, bundle.bundleH];
    const cont = [spec.length_mm, spec.width_mm, maxH];
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    for (const [i, j, k] of perms) {
        if (dims[i] <= cont[0] + 1e-6 && dims[j] <= cont[1] + 1e-6 && dims[k] <= cont[2] + 1e-6)
            return true;
    }
    return false;
}

// Export
function bundleFits(bundle, spec, maxH) { return _bundleFits(bundle, spec, maxH); }