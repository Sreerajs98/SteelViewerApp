/**
 * loadingRules.js
 * Per-shape loading behaviour rules.
 * The packing engine reads ONLY these rules — it never switch-cases on shape names.
 * To add a new profile type (Sigma, Hat, Crane Girder...) just add a new entry here.
 * Nothing else changes.
 */
'use strict';

/**
 * @typedef {Object} ShapeRule
 * @property {number}  layer          - 0=floor 1=middle 2=top
 * @property {boolean} canStack       - can identical pieces stack on top of each other?
 * @property {boolean} needsNesting   - use nesting math (C/Z contour or box-pairing)?
 * @property {string}  nestingType    - 'box_pair' | 'contour' | 'hex' | 'flat' | 'grid'
 * @property {boolean} isLongMember   - always placed along container length axis?
 * @property {boolean} requiresForklift - forklift / crane needed?
 * @property {number}  supportRequired - minimum % of footprint that must be supported
 * @property {string}  bundleMode     - 'pair' (C) | 'contour' (Z) | 'hex' (rod) | 'grid' | 'stack'
 */

const LOADING_RULES = {

    i_beam: {
        layer: 0,
        canStack: true,
        needsNesting: false,
        nestingType: 'grid',
        isLongMember: true,
        requiresForklift: true,
        supportRequired: 0.80,
        bundleMode: 'grid',
    },

    h_beam: {
        layer: 0,
        canStack: true,
        needsNesting: false,
        nestingType: 'grid',
        isLongMember: true,
        requiresForklift: true,
        supportRequired: 0.80,
        bundleMode: 'grid',
    },

    c_channel: {
        layer: 1,
        canStack: true,
        needsNesting: true,
        nestingType: 'box_pair',
        isLongMember: true,
        requiresForklift: false,
        supportRequired: 0.70,
        bundleMode: 'pair',
    },

    z_channel: {
        layer: 1,
        canStack: true,
        needsNesting: true,
        nestingType: 'contour',
        isLongMember: true,
        requiresForklift: false,
        supportRequired: 0.70,
        bundleMode: 'contour',
    },

    l_angle: {
        layer: 1,
        canStack: true,
        needsNesting: false,
        nestingType: 'grid',
        isLongMember: true,
        requiresForklift: false,
        supportRequired: 0.70,
        bundleMode: 'grid',
    },

    rhs: {
        layer: 1,
        canStack: true,
        needsNesting: false,
        nestingType: 'grid',
        isLongMember: true,
        requiresForklift: false,
        supportRequired: 0.75,
        bundleMode: 'grid',
    },

    plate: {
        layer: 2,
        canStack: true,
        needsNesting: false,
        nestingType: 'flat',
        isLongMember: false,
        requiresForklift: false,
        supportRequired: 0.90,
        bundleMode: 'stack',
    },

    rod: {
        layer: 2,
        canStack: true,
        needsNesting: true,
        nestingType: 'hex',
        isLongMember: true,
        requiresForklift: false,
        supportRequired: 0.65,
        bundleMode: 'hex',
    },

    unknown: {
        layer: 1,
        canStack: true,
        needsNesting: false,
        nestingType: 'grid',
        isLongMember: true,
        requiresForklift: false,
        supportRequired: 0.75,
        bundleMode: 'grid',
    },
};

/**
 * Returns the rule for a given shape key.
 * Falls back to 'unknown' if the key isn't registered,
 * so new profiles degrade gracefully instead of crashing.
 */
function getRule(shapeKey) {
    return LOADING_RULES[shapeKey] || LOADING_RULES.unknown;
}

Object.freeze(LOADING_RULES);