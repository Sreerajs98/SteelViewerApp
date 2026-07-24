/**
 * itemProperties.js
 * Converts a raw scene item (from C# JSON) into a fully-enriched item object.
 * The packing engine works ONLY with these properties — never with shape names.
 *
 * Input (from C# SceneBuilder):
 *   { mark, assemblyName, category, lengthMm, widthMm, heightMm,
 *     qty, unitWeightKg, profileDesc, weightEstimated }
 *
 * Output (enriched item):
 *   { ...all above, shapeKey, rule, isLongMember, canStack, loadLayer,
 *     flangeT_mm, webT_mm, lipH_mm, diam_mm, volume_mm3,
 *     unitWeightKg (corrected), priority }
 */
'use strict';

function enrichItem(raw) {
    // 1. Identify profile shape from description string + assembly name
    const profile = identifyProfile(raw.profileDesc, raw.assemblyName);
    const enriched = enrichFromDimensions(profile, raw.heightMm, raw.widthMm);
    const shapeKey = enriched.shapeKey;

    // 2. Correct geometry-estimated weights using fill factors
    let unitWeightKg = raw.unitWeightKg;
    if (raw.weightEstimated && unitWeightKg > 0) {
        const fill = CONSTANTS.FILL_FACTORS[shapeKey] ?? CONSTANTS.FILL_FACTORS.unknown;
        unitWeightKg = unitWeightKg * fill;
    }
    // Sanity cap
    if (unitWeightKg <= 0 || unitWeightKg > 50000) unitWeightKg = 1;

    // 3. Load the per-shape rule
    const rule = getRule(shapeKey);

    // 4. Compute derived physical properties
    const volume_mm3 = raw.lengthMm * raw.widthMm * raw.heightMm;
    const isLongMember = raw.lengthMm > Math.max(raw.widthMm, raw.heightMm) * 3;

    // 5. Priority score — based purely on physical properties, no shape names
    //    Higher score = placed earlier (closer to the floor / back wall)
    const priority = _calcPriority(raw, unitWeightKg, volume_mm3, rule, isLongMember);

    return {
        // identity
        mark: raw.mark,
        assemblyName: raw.assemblyName,
        profileDesc: raw.profileDesc || '',
        // shape
        shapeKey,
        flangeT_mm: enriched.flangeT_mm,
        webT_mm: enriched.webT_mm,
        lipH_mm: enriched.lipH_mm,
        diam_mm: enriched.diam_mm,
        // dimensions
        lengthMm: raw.lengthMm,
        widthMm: raw.widthMm,
        heightMm: raw.heightMm,
        // mass
        qty: raw.qty,
        unitWeightKg,
        totalWeightKg: unitWeightKg * raw.qty,
        weightEstimated: raw.weightEstimated,
        // derived
        volume_mm3,
        isLongMember,
        // rule (loading behaviour)
        canStack: rule.canStack,
        needsNesting: rule.needsNesting,
        nestingType: rule.nestingType,
        bundleMode: rule.bundleMode,
        loadLayer: rule.layer,
        requiresForklift: rule.requiresForklift,
        supportRequired: rule.supportRequired,
        // scoring
        priority,
    };
}

function _calcPriority(raw, weight, volume, rule, isLongMember) {
    const sw = CONSTANTS.SCORE_WEIGHT;
    let score = 0;
    score += raw.lengthMm * sw.LENGTH;
    score += weight * sw.WEIGHT;
    score += volume / 1e6 * sw.VOLUME;   // scale mm³ down
    if (!rule.canStack) score += sw.NO_STACK;
    if (isLongMember) score += sw.LONG_MEMBER;
    if (rule.requiresForklift) score += sw.NEEDS_FORK;
    // Layer bonus: floor items get massive priority over top-layer items
    score += (2 - rule.layer) * 10000;
    return score;
}

/**
 * Enrich a whole array of raw items and sort by descending priority.
 * Returns the sorted, enriched array — the packing engine consumes this directly.
 */
function buildEnrichedItems(rawItems) {
    return rawItems
        .map(enrichItem)
        .filter(it => it.lengthMm > 0 && it.widthMm > 0 && it.heightMm > 0 && it.unitWeightKg > 0)
        .sort((a, b) => b.priority - a.priority);
}