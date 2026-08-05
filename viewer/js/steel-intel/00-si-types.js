/* 00-si-types.js — Steel Intelligence Layer: contracts & constants only
 *
 * No classification / bundle / planner logic.
 * Consumed later by steel-intel annotators; packer does not require this file.
 *
 * Namespace: window.SteelIntel
 */

(function (global) {
  'use strict';

  var SI = global.SteelIntel || (global.SteelIntel = {});

  // ── Enumerations (frozen string maps) ─────────────────────────────────────

  /** @enum {string} */
  SI.PROFILE_CLASS = Object.freeze({
    ASSEMBLY: 'assembly',
    I_BEAM: 'i_beam',
    H_BEAM: 'h_beam',
    CHANNEL_Z: 'channel_z',
    CHANNEL_C: 'channel_c',
    ANGLE: 'angle',
    PLATE: 'plate',
    RHS: 'rhs',
    CHS: 'chs',
    ROD: 'rod',
    BENT_ROD: 'bent_rod',
    LOOSE: 'loose',
    UNKNOWN: 'unknown',
  });

  /** @enum {string} */
  SI.LOAD_ROLE = Object.freeze({
    FLOOR_ANCHOR: 'floor_anchor',
    TWIN_MATE: 'twin_mate',
    NEST_STRIP: 'nest_strip',
    PLATE_DECK: 'plate_deck',
    FILLER: 'filler',
    LEFTOVER_CANDIDATE: 'leftover_candidate',
  });

  /** @enum {string} */
  SI.STACK_POLICY = Object.freeze({
    NEVER: 'never',
    ON_SAME_FAMILY: 'on_same_family',
    ON_FLAT_DECK: 'on_flat_deck',
    NEST_ONLY: 'nest_only',
  });

  /** @enum {string} */
  SI.BUNDLE_TYPE = Object.freeze({
    TWIN_BEAM: 'twin_beam',
    SOLO_BEAM: 'solo_beam',
    NEST_Z: 'nest_z',
    NEST_C: 'nest_c',
    NEST_L: 'nest_l',
    PLATE_STACK: 'plate_stack',
    RHS_UNIT: 'rhs_unit',
    RHS_LOT: 'rhs_lot',
    FILLER: 'filler',
    LEFTOVER: 'leftover',
  });

  /** @enum {string} */
  SI.ZONE = Object.freeze({
    HOME_BASE: 'Z_HOME_BASE',
    FAR_BASE: 'Z_FAR_BASE',
    CENTRE_FLOOR: 'Z_CENTRE_FLOOR',
    DOOR_CLEAR: 'Z_DOOR_CLEAR',
    REAR_POCKET: 'Z_REAR_POCKET',
    UPPER: 'Z_UPPER',
    OUT: 'Z_OUT',
  });

  /** @enum {string} */
  SI.LAYER = Object.freeze({
    L0: 'L0',
    L1: 'L1',
    L2: 'L2',
  });

  /** Contract / schema version for SteelIntelLoadPlan.version */
  SI.CONTRACT_VERSION = '0.1.0';

  // ── JSDoc data contracts (documentation only — no runtime classes) ────────

  /**
   * Per–packUnit Steel Intelligence hints (store on packUnit.siHints).
   * Project into packer dialect (_checkOrder, footprints, flags) before
   * csPackV2RunOptimise — PackHuman does not read siHints directly.
   *
   * @typedef {Object} SteelIntelUnitHints
   * @property {string} [profileClass]   SteelIntel.PROFILE_CLASS value
   * @property {string} [loadRole]       SteelIntel.LOAD_ROLE value
   * @property {string} [bundleId]       Stable bundle id
   * @property {string} [bundleType]     SteelIntel.BUNDLE_TYPE value
   * @property {number} [bundleIndex]    0-based index within bundle
   * @property {number} [bundleCount]    Members in bundle
   * @property {string|null} [pairId]    Twin pair id (null if unpaired)
   * @property {string|null} [pairSide]  'home' | 'far' | null
   * @property {string} [zonePref]       SteelIntel.ZONE value
   * @property {string} [layerIntent]    SteelIntel.LAYER value
   * @property {string} [stackPolicy]    SteelIntel.STACK_POLICY value
   * @property {number} [loadSeq]        Global place order (1…N)
   * @property {number} [unloadSeq]      Optional unload / door rank
   * @property {boolean} [aisleReserve]  True = avoid early door-band claim
   * @property {string} [fitVerdict]     e.g. 'fits_floor' | 'oversize_plan' | 'stack_only'
   * @property {string} [reason]         Short human-readable note
   */

  /**
   * One logical load bundle (1+ packUnits). Does not merge geometry.
   *
   * @typedef {Object} SteelIntelBundle
   * @property {string} bundleId
   * @property {string} bundleType       SteelIntel.BUNDLE_TYPE value
   * @property {Array<{stagingGroupId?: string, packUnitIndex?: number, mark?: string}>} members
   * @property {number} priority         Lower = earlier band
   * @property {number} loadSeqStart     First loadSeq assigned to members
   */

  /**
   * Full SI load plan snapshot for one Optimise run.
   *
   * @typedef {Object} SteelIntelLoadPlan
   * @property {SteelIntelBundle[]} bundles
   * @property {Object.<string, Object>} zones  Optional zone policy map keyed by ZONE
   * @property {number|string} createdAt        Timestamp when plan was built
   * @property {string} version                 e.g. SteelIntel.CONTRACT_VERSION
   */

  // Expose typedef names on namespace for console / docs discovery (no behaviour).
  SI.TYPES = Object.freeze({
    UnitHints: 'SteelIntelUnitHints',
    Bundle: 'SteelIntelBundle',
    LoadPlan: 'SteelIntelLoadPlan',
  });

  global.SteelIntel = SI;
})(typeof window !== 'undefined' ? window : this);
