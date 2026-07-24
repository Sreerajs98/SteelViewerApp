/**
 * profileIdentifier.js
 * Converts raw profile description strings (from Tekla IFC or Excel assembly names)
 * into a canonical shape key + physical parameters.
 *
 * Handles: "200Z18", "120C20", "L40*2.5", "PL5*150", "ROD12",
 *           "IPE300", "H100*50", "RHS100x50", "SHS100", etc.
 *
 * NO hardcoding in the packing engine. The engine only sees:
 *   { shapeKey, flangeT_mm, webT_mm, lipH_mm, diam_mm, isEstimated }
 */
'use strict';

/**
 * Parses a Tekla section description string and returns a canonical shape key.
 * Falls back to the assembly-name convention if the description is empty.
 *
 * @param {string} profileDesc  - e.g. "200Z18", "L40*2.5", "PL6*300", "ROD12"
 * @param {string} assemblyName - e.g. "GIRT", "COLUMN", "ROD_BRACE_ASSY"
 * @returns {{ shapeKey: string, flangeT_mm: number, webT_mm: number,
 *             lipH_mm: number, diam_mm: number }}
 */
function identifyProfile(profileDesc, assemblyName) {
    const result = _fromDescription(profileDesc)
        || _fromName(assemblyName)
        || { shapeKey: 'unknown', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    return result;
}

// ?? Description-string parser ???????????????????????????????????????????????

function _fromDescription(desc) {
    if (!desc || typeof desc !== 'string') return null;
    const d = desc.trim().toUpperCase();

    // Hardware — never ship as a standalone item
    if (/HEX_?NUT|WASHER|BOLT|SCREW/.test(d)) return null;

    // Plate: PL5*150, PL10X175
    let m = d.match(/^PL\s*([\d.]+)\s*[X*]\s*([\d.]+)/);
    if (m) return { shapeKey: 'plate', flangeT_mm: +m[1], webT_mm: 0, lipH_mm: 0, diam_mm: 0 };

    // Round rod: ROD12, D24
    m = d.match(/^(?:ROD|D)\s*([\d.]+)/);
    if (m) return { shapeKey: 'rod', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: +m[1] };

    // Z-purlin: 200Z18, 150Z15
    m = d.match(/^(\d+)\s*Z\s*([\d.]+)/);
    if (m) {
        const webH = +m[1], t = +m[2];
        return { shapeKey: 'z_channel', flangeT_mm: t, webT_mm: t, lipH_mm: webH * 0.12, diam_mm: 0 };
    }

    // C-channel: 200C25, 120C20
    m = d.match(/^(\d+)\s*C\s*([\d.]+)/);
    if (m) {
        const webH = +m[1], t = +m[2];
        return { shapeKey: 'c_channel', flangeT_mm: t, webT_mm: t, lipH_mm: 0, diam_mm: 0 };
    }

    // L-angle: L40*2.5, L50X5
    m = d.match(/^L\s*([\d.]+)\s*[X*]\s*([\d.]+)/);
    if (m) {
        const t = +m[2];
        return { shapeKey: 'l_angle', flangeT_mm: t, webT_mm: t, lipH_mm: 0, diam_mm: 0 };
    }

    // RHS / SHS: RHS100X50, SHS100
    m = d.match(/^(?:RHS|SHS)\s*([\d.]+)/);
    if (m) return { shapeKey: 'rhs', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };

    // I-beam / H-beam family: IPE300, HEA200, HEB300, UB, UC, W-section, H100*50
    m = d.match(/^(?:H|IPE|HEA|HEB|HEM|UB|UC|W)\s*([\d.]+)/);
    if (m) return { shapeKey: 'i_beam', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };

    return null;
}

// ?? Assembly-name fallback ???????????????????????????????????????????????????

function _fromName(name) {
    if (!name || typeof name !== 'string') return null;
    const n = name.toUpperCase();

    if (/ROD_?BRACE|BRACE_?ROD|^ROD/.test(n))
        return { shapeKey: 'rod', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/GIRT|PURLIN|Z_?PUR/.test(n))
        return { shapeKey: 'z_channel', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/C_?PUR|CPUR|CHANNEL/.test(n))
        return { shapeKey: 'c_channel', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/L_?ANGLE|^ANGLE|BRACE_?L/.test(n))
        return { shapeKey: 'l_angle', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/PLT|PLATE|SHIM|SHEET|STIFFENER|END_?PLT|FLANGE/.test(n))
        return { shapeKey: 'plate', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/COLUMN|RAFTER|^BEAM|GIRDER|RIDGE|EAVE/.test(n))
        return { shapeKey: 'i_beam', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/PIPE|CHS/.test(n))
        return { shapeKey: 'rod', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };
    if (/RHS|SHS|TUBE|HSS/.test(n))
        return { shapeKey: 'rhs', flangeT_mm: 0, webT_mm: 0, lipH_mm: 0, diam_mm: 0 };

    return null;
}

/**
 * Enrich a parsed profile with physical properties inferred from dimensions
 * when the description string didn't contain them directly.
 * @param {object} profile  - result of identifyProfile()
 * @param {number} heightMm - item height from IFC/Excel
 * @param {number} widthMm  - item width from IFC/Excel
 */
function enrichFromDimensions(profile, heightMm, widthMm) {
    const p = { ...profile };
    if (!p.flangeT_mm || p.flangeT_mm <= 0) p.flangeT_mm = heightMm * 0.10;
    if (!p.webT_mm || p.webT_mm <= 0) p.webT_mm = widthMm * 0.08;
    if (!p.lipH_mm || p.lipH_mm <= 0) p.lipH_mm = heightMm * 0.12;
    if (!p.diam_mm || p.diam_mm <= 0) p.diam_mm = Math.max(widthMm, heightMm);
    return p;
}