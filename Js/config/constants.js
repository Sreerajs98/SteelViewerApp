/**
 * constants.js
 * Single source of truth for every physical constant in the system.
 * Change a value here and it propagates to ALL engines automatically.
 * No magic numbers anywhere else in the codebase.
 */
'use strict';

const CONSTANTS = {

    // ?? Container defaults (40-ft HC, can be overridden by the scene JSON) ??
    CONTAINER: {
        LENGTH_MM: 12000,
        WIDTH_MM: 2350,
        HEIGHT_MM: 2690,
        MAX_WEIGHT_KG: 26000,
    },

    // ?? Physical clearances & tolerances ????????????????????????????????????
    DUNNAGE_MM: 75,   // vertical gap under floor-layer beams (forklift access)
    NESTING_CLEARANCE: 2,   // mm between nested C/Z profiles (prevents paint damage)
    NESTING_GAP: 1,   // mm lateral gap between nested C/Z profiles
    MIN_SUPPORT_RATIO: 0.80,  // ?80% of an item's footprint must rest on something solid
    COG_TOLERANCE: 0.10,  // ±10% of container centreline before a balance warning fires

    // ?? Three.js world scale ?????????????????????????????????????????????????
    SCALE: 0.001,   // mm ? world units  (1 world unit = 1 m)

    // ?? Load-layer priorities (lower = placed first / closer to floor) ????????
    LAYER: {
        FLOOR: 0,   // I-beams, H-beams, columns, rafters
        MIDDLE: 1,   // C-channels, Z-purlins, L-angles, RHS
        TOP: 2,   // Plates, round rods
    },

    // ?? Priority scorer weights ???????????????????????????????????????????????
    SCORE_WEIGHT: {
        LENGTH: 0.4,
        WEIGHT: 5.0,
        VOLUME: 0.2,
        LONG_MEMBER: 5000,
        NO_STACK: 3000,
        NEEDS_FORK: 2000,
    },

    // ?? Geometry cap (visual sanity for geometry-estimated items) ????????????
    MAX_ROD_RADIUS_MM: 150,  // cap on visual rod radius
    MAX_BUNDLE_HEIGHT_FRACTION: 0.40,  // bundle ? 40 % of container height

    // ?? Overflow zone position (outside container, towards negative X) ????????
    OVERFLOW_X_OFFSET_MM: -2500,  // start of overflow staging area
    OVERFLOW_ROW_GAP_MM: 300,

    // ?? C-shape fill factors for weight-estimated items ??????????????????????
    FILL_FACTORS: {
        plate: 1.00,
        rod: 1.00,
        i_beam: 0.20,
        h_beam: 0.20,
        c_channel: 0.08,
        z_channel: 0.08,
        l_angle: 0.15,
        rhs: 0.30,
        unknown: 0.35,
    },

    // ?? Colours (hex numbers, used by GeometryRegistry) ?????????????????????
    COLORS: {
        i_beam: 0x4a90d9,
        h_beam: 0x4a90d9,
        c_channel: 0xb07bdb,
        z_channel: 0xb07bdb,
        l_angle: 0xb07bdb,
        plate: 0xe8993a,
        rod: 0x2dc98a,
        rhs: 0x5ab0c9,
        unknown: 0x888890,
        overflow: 0xe24b4a,
        selected_ok: 0xff8800,
        selected_bad: 0xff0000,
        edge: 0x000000,   // black borders on every mesh
        container: 0xffffff,
    },

    SHAPE_LABELS: {
        i_beam: 'I-beam / H-beam',
        h_beam: 'H-beam',
        c_channel: 'C-channel (box nested)',
        z_channel: 'Z-purlin (contour nested)',
        l_angle: 'L-angle',
        plate: 'Plate stack',
        rod: 'Round rod (hex bundle)',
        rhs: 'Rectangular hollow tube',
        unknown: 'Other',
    },
};

// Make immutable so no module accidentally mutates global config
Object.freeze(CONSTANTS);
Object.freeze(CONSTANTS.CONTAINER);
Object.freeze(CONSTANTS.LAYER);
Object.freeze(CONSTANTS.SCORE_WEIGHT);
Object.freeze(CONSTANTS.FILL_FACTORS);
Object.freeze(CONSTANTS.COLORS);
Object.freeze(CONSTANTS.SHAPE_LABELS);