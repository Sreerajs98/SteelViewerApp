/**
 * GeometryRegistry.js
 * Factory for all high-fidelity steel profile meshes.
 *
 * Architecture mandates:
 *  1. VERTEX-BASED geometry only — NO Box/Cylinder for C/Z/I profiles.
 *     I-beams, C-channels, Z-purlins, L-angles, RHS are built from
 *     extruded 2D cross-section polygons (THREE.ExtrudeGeometry).
 *  2. IMMUTABILITY — dimensions are baked into the geometry at creation.
 *     Scale is never used.  Object3D.scale is always (1,1,1).
 *  3. BLACK BORDERS — every mesh MUST have an EdgesGeometry LineSegments
 *     overlay so nested / stacked pieces remain visually distinct.
 *  4. THREE.DoubleSide material so cross-sections are visible from both ends.
 *  5. Opacity ? 0.9 so depth cues remain while pieces can overlap (staging).
 */
'use strict';

// ?????????????????????????????????????????????????????????????????????????????
// Shared helpers
// ?????????????????????????????????????????????????????????????????????????????

const SC = CONSTANTS.SCALE;          // mm ? Three.js world units
const EC = CONSTANTS.COLORS;

/**
 * Extrude a 2D closed polygon shape along the LENGTH axis (world X).
 * The shape is drawn in the Y-Z plane (cross-section end-on view).
 * Rotation.y = ?/2 aligns extrusion depth with world X.
 *
 * IMMUTABLE: no scale.  Geometry uses exact vertex coordinates.
 *
 * @param {THREE.Shape} shape2D
 * @param {number}      lengthMm
 * @param {number}      colorHex
 * @param {number}      [opacity=0.92]
 * @returns {THREE.Group}  group containing the mesh + black edge overlay
 */
function extrudeProfile(shape2D, lengthMm, colorHex, opacity) {
    const L = Math.max(lengthMm * SC, 0.05);
    const geo = new THREE.ExtrudeGeometry(shape2D, { depth: L, bevelEnabled: false });
    geo.translate(0, 0, -L / 2);   // centre on origin

    const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        opacity: opacity ?? 0.92,
        transparent: true,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.y = Math.PI / 2;

    // Mandatory BLACK BORDER (spec §1 VISUAL CLARITY)
    const edgeGeo = new THREE.EdgesGeometry(geo, 15);  // 15° crease angle
    const edgeMat = new THREE.LineBasicMaterial({ color: EC.edge, opacity: 0.85, transparent: true });
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    mesh.add(edges);

    return mesh;
}

/**
 * Create a mesh group and add mandatory black EdgesGeometry overlay.
 * Used for box/cylinder shapes where ExtrudeGeometry isn't used.
 */
function meshWithEdges(geo, colorHex, opacity) {
    const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        opacity: opacity ?? 0.92,
        transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const edgeMat = new THREE.LineBasicMaterial({ color: EC.edge, opacity: 0.8, transparent: true });
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 15), edgeMat));
    return mesh;
}

// ?????????????????????????????????????????????????????????????????????????????
// I-Beam / H-Beam
// Standard hot-rolled I cross-section: two flanges + web.
// ?????????????????????????????????????????????????????????????????????????????

function makeIBeam(lengthMm, heightMm, widthMm, flangeT, webT, colorHex, opacity) {
    const H = Math.max(heightMm * SC, 0.06);
    const W = Math.max(widthMm * SC, 0.06);
    const ft = Math.max((flangeT > 0 ? flangeT : heightMm * 0.12) * SC, 0.012);
    const wt = Math.max((webT > 0 ? webT : widthMm * 0.08) * SC, 0.008);
    const hw = W / 2, hh = H / 2;

    const s = new THREE.Shape();
    s.moveTo(-hw, hh);
    s.lineTo(hw, hh);
    s.lineTo(hw, hh - ft);
    s.lineTo(wt / 2, hh - ft);
    s.lineTo(wt / 2, -hh + ft);
    s.lineTo(hw, -hh + ft);
    s.lineTo(hw, -hh);
    s.lineTo(-hw, -hh);
    s.lineTo(-hw, -hh + ft);
    s.lineTo(-wt / 2, -hh + ft);
    s.lineTo(-wt / 2, hh - ft);
    s.lineTo(-hw, hh - ft);
    s.closePath();

    return extrudeProfile(s, lengthMm, colorHex ?? EC.i_beam, opacity);
}

// ?????????????????????????????????????????????????????????????????????????????
// C-Channel
// Web on LEFT, flanges extending to the RIGHT (opening = right).
// Mirror: web on RIGHT, opening = left (used for box-nesting pair piece).
// ?????????????????????????????????????????????????????????????????????????????

function makeChannel(lengthMm, heightMm, widthMm, flangeT, webT, colorHex, opacity, mirror) {
    const H = Math.max(heightMm * SC, 0.06);
    const W = Math.max(widthMm * SC, 0.06);
    const ft = Math.max((flangeT > 0 ? flangeT : heightMm * 0.12) * SC, 0.012);
    const wt = Math.max((webT > 0 ? webT : widthMm * 0.15) * SC, 0.010);
    const hw = W / 2, hh = H / 2;
    const sign = mirror ? -1 : 1;

    const s = new THREE.Shape();
    s.moveTo(-sign * hw, hh);
    s.lineTo(sign * hw, hh);
    s.lineTo(sign * hw, hh - ft);
    s.lineTo(-sign * hw + sign * wt, hh - ft);
    s.lineTo(-sign * hw + sign * wt, -hh + ft);
    s.lineTo(sign * hw, -hh + ft);
    s.lineTo(sign * hw, -hh);
    s.lineTo(-sign * hw, -hh);
    s.closePath();

    return extrudeProfile(s, lengthMm, colorHex ?? EC.c_channel, opacity);
}

function makeChannelMirror(lengthMm, heightMm, widthMm, flangeT, webT, colorHex, opacity) {
    return makeChannel(lengthMm, heightMm, widthMm, flangeT, webT, colorHex, opacity, true);
}

// ?????????????????????????????????????????????????????????????????????????????
// Z-Purlin
// Exact Z cross-section:
//   Top flange extends to the RIGHT of the web.
//   Bottom flange extends to the LEFT of the web.
//   Web is vertical at the centre.
//
// Mirror-Z (S-shape):
//   Top flange LEFT, bottom flange RIGHT — fits into the concave corners of the Z.
// ?????????????????????????????????????????????????????????????????????????????

function makeZPurlin(lengthMm, heightMm, widthMm, flangeT, webT, colorHex, opacity) {
    const H = Math.max(heightMm * SC, 0.06);
    const W = Math.max(widthMm * SC, 0.06);
    const ft = Math.max((flangeT > 0 ? flangeT : heightMm * 0.10) * SC, 0.010);
    const wt = Math.max((webT > 0 ? webT : widthMm * 0.12) * SC, 0.008);
    const hw = W / 2, hh = H / 2;

    const s = new THREE.Shape();
    s.moveTo(-wt / 2, hh);        // top-left of top flange at web
    s.lineTo(hw, hh);        // top-right of top flange
    s.lineTo(hw, hh - ft);   // step down to inside of top flange
    s.lineTo(wt / 2, hh - ft);   // junction: inner top flange to web
    s.lineTo(wt / 2, -hh);        // straight down (NOTE: not -hh+ft — web goes full height)
    s.lineTo(-hw, -hh);        // bottom-left of bottom flange
    s.lineTo(-hw, -hh + ft);   // inside of bottom flange
    s.lineTo(-wt / 2, -hh + ft);   // junction: inner bottom flange to web
    s.closePath();                // close up web left side

    return extrudeProfile(s, lengthMm, colorHex ?? EC.z_channel, opacity);
}

function makeZPurlinMirror(lengthMm, heightMm, widthMm, flangeT, webT, colorHex, opacity) {
    const H = Math.max(heightMm * SC, 0.06);
    const W = Math.max(widthMm * SC, 0.06);
    const ft = Math.max((flangeT > 0 ? flangeT : heightMm * 0.10) * SC, 0.010);
    const wt = Math.max((webT > 0 ? webT : widthMm * 0.12) * SC, 0.008);
    const hw = W / 2, hh = H / 2;

    const s = new THREE.Shape();
    s.moveTo(wt / 2, hh);
    s.lineTo(-hw, hh);
    s.lineTo(-hw, hh - ft);
    s.lineTo(-wt / 2, hh - ft);
    s.lineTo(-wt / 2, -hh);
    s.lineTo(hw, -hh);
    s.lineTo(hw, -hh + ft);
    s.lineTo(wt / 2, -hh + ft);
    s.closePath();

    return extrudeProfile(s, lengthMm, colorHex ?? EC.z_channel, opacity);
}

// ?????????????????????????????????????????????????????????????????????????????
// L-Angle
// Vertical leg on left, horizontal leg along bottom.
// ?????????????????????????????????????????????????????????????????????????????

function makeLAngle(lengthMm, heightMm, widthMm, flangeT, colorHex, opacity) {
    const H = Math.max(heightMm * SC, 0.06);
    const W = Math.max(widthMm * SC, 0.06);
    const t = Math.max((flangeT > 0 ? flangeT : Math.min(heightMm, widthMm) * 0.15) * SC, 0.010);
    const hw = W / 2, hh = H / 2;

    const s = new THREE.Shape();
    s.moveTo(-hw, hh);       // top of vertical leg
    s.lineTo(-hw + t, hh);
    s.lineTo(-hw + t, -hh + t);   // inner corner
    s.lineTo(hw, -hh + t);   // top of horizontal leg
    s.lineTo(hw, -hh);       // outer corner
    s.lineTo(-hw, -hh);
    s.closePath();

    return extrudeProfile(s, lengthMm, colorHex ?? EC.l_angle, opacity);
}

// ?????????????????????????????????????????????????????????????????????????????
// RHS — Rectangular Hollow Section (hollow tube)
// Outer rectangle minus inner rectangle hole.
// ?????????????????????????????????????????????????????????????????????????????

function makeRHS(lengthMm, heightMm, widthMm, colorHex, opacity) {
    const H = Math.max(heightMm * SC, 0.06);
    const W = Math.max(widthMm * SC, 0.06);
    const t = Math.max(Math.min(H, W) * 0.10, 0.008);
    const hw = W / 2, hh = H / 2;

    const outer = new THREE.Shape();
    outer.moveTo(-hw, hh);
    outer.lineTo(hw, hh);
    outer.lineTo(hw, -hh);
    outer.lineTo(-hw, -hh);
    outer.closePath();

    if (hw - t > 0 && hh - t > 0) {
        const hole = new THREE.Path();
        hole.moveTo(-hw + t, hh - t);
        hole.lineTo(hw - t, hh - t);
        hole.lineTo(hw - t, -hh + t);
        hole.lineTo(-hw + t, -hh + t);
        hole.closePath();
        outer.holes.push(hole);
    }

    return extrudeProfile(outer, lengthMm, colorHex ?? EC.rhs, opacity);
}

// ?????????????????????????????????????????????????????????????????????????????
// Round Rod / Bar (CylinderGeometry, capped at MAX_ROD_RADIUS_MM)
// ?????????????????????????????????????????????????????????????????????????????

function makeRod(lengthMm, diamMm, colorHex, opacity) {
    const maxR = CONSTANTS.MAX_ROD_RADIUS_MM;
    const r = Math.min(diamMm / 2, maxR) * SC;
    const L = Math.max(lengthMm * SC, 0.05);
    const geo = new THREE.CylinderGeometry(Math.max(r, 0.02), Math.max(r, 0.02), L, 14);
    const mesh = meshWithEdges(geo, colorHex ?? EC.rod, opacity);
    mesh.rotation.z = Math.PI / 2;   // lay along world X axis
    return mesh;
}

// ?????????????????????????????????????????????????????????????????????????????
// Flat Plate (box geometry — correct because a plate IS a box)
// ?????????????????????????????????????????????????????????????????????????????

function makePlate(lengthMm, widthMm, thicknessMm, colorHex, opacity) {
    const geo = new THREE.BoxGeometry(
        Math.max(lengthMm * SC, 0.05),
        Math.max(thicknessMm * SC, 0.002),
        Math.max(widthMm * SC, 0.05),
    );
    return meshWithEdges(geo, colorHex ?? EC.plate, opacity);
}

// ?????????????????????????????????????????????????????????????????????????????
// GeometryRegistry class — single entry point for the renderer
// ?????????????????????????????????????????????????????????????????????????????

class GeometryRegistry {

    /**
     * Build a single piece mesh (no bundling).
     * Used by the rotation preview widget and for single-piece items.
     *
     * @param {object} item - { shapeKey, lengthMm, widthMm, heightMm, flangeT_mm, webT_mm, lipH_mm, diam_mm }
     * @param {number} colorHex
     * @param {number} [opacity]
     * @returns {THREE.Object3D}
     */
    static singlePieceMesh(item, colorHex, opacity) {
        const { shapeKey: s, lengthMm: L, widthMm: W, heightMm: H,
            flangeT_mm: ft, webT_mm: wt, diam_mm: d } = item;

        if (s === 'i_beam' || s === 'h_beam') return makeIBeam(L, H, W, ft, wt, colorHex, opacity);
        if (s === 'c_channel') return makeChannel(L, H, W, ft, wt, colorHex, opacity);
        if (s === 'z_channel') return makeZPurlin(L, H, W, ft, wt, colorHex, opacity);
        if (s === 'l_angle') return makeLAngle(L, H, W, ft, colorHex, opacity);
        if (s === 'rhs') return makeRHS(L, H, W, colorHex, opacity);
        if (s === 'rod') return makeRod(L, d > 0 ? d : Math.max(W, H), colorHex, opacity);
        if (s === 'plate') return makePlate(L, W, H, colorHex, opacity);

        // Generic box for unknown profiles
        const geo = new THREE.BoxGeometry(
            Math.max(L * SC, 0.05), Math.max(H * SC, 0.05), Math.max(W * SC, 0.05)
        );
        return meshWithEdges(geo, colorHex ?? EC.unknown, opacity);
    }

    /**
     * Build a bundle mesh using the pre-computed transforms from nestingMath.js.
     * Each piece gets:
     *   - Its correct 3D cross-section mesh (NOT a box).
     *   - A black EdgesGeometry overlay.
     *   - Position / rotation from the transform record.
     *
     * C-channel box-nesting:
     *   Even-index pieces: normal C.
     *   Odd-index pieces: mirror C (rotZ=180°).
     *
     * Z-purlin contour-nesting:
     *   Uses exact ?y / ?z offsets. No rotation needed — Z profile geometry
     *   itself provides the interlocking shape.
     *
     * Rod hex-bundle:
     *   Each rod placed at (dy, dz) with d/2 Z-shift on odd rows.
     *
     * @param {object} it      - placed item from packingOptimizer
     * @param {number} colorHex
     * @param {number} [opacity]
     * @returns {THREE.Group}
     */
    static bundleMesh(it, colorHex, opacity) {
        const g = new THREE.Group();
        const transforms = it.transforms || [];
        const shown = Math.min(transforms.length, 100);  // performance cap

        const {
            shapeKey: s,
            unitLengthMm: ul, unitWidthMm: uw, unitHeightMm: uh,
            flangeT_mm: ft, webT_mm: wt, diam_mm: d,
        } = it;

        for (let i = 0; i < shown; i++) {
            const tr = transforms[i];
            let piece;

            if (s === 'c_channel') {
                // Box nesting: alternate normal ? mirror
                piece = tr.isMirror
                    ? makeChannelMirror(ul, uh, uw, ft, wt, colorHex, opacity)
                    : makeChannel(ul, uh, uw, ft, wt, colorHex, opacity);
            } else if (s === 'z_channel') {
                // Contour nesting: all pieces are normal Z (geometry does the interlocking)
                piece = makeZPurlin(ul, uh, uw, ft, wt, colorHex, opacity);
            } else if (s === 'rod') {
                const diam = d > 0 ? d : Math.max(uw, uh);
                piece = makeRod(ul, diam, colorHex, opacity);
            } else if (s === 'plate') {
                piece = makePlate(ul, uw, uh, colorHex, opacity);
            } else if (s === 'l_angle') {
                piece = makeLAngle(ul, uh, uw, ft, colorHex, opacity);
            } else if (s === 'rhs') {
                piece = makeRHS(ul, uh, uw, colorHex, opacity);
            } else {
                // i_beam, h_beam, unknown
                piece = makeIBeam(ul, uh, uw, ft, wt, colorHex, opacity);
            }

            // Apply transform (all offsets are in mm, converted to world units)
            piece.position.y = (tr.dy ?? 0) * SC;
            piece.position.z = (tr.dz ?? 0) * SC;
            if (tr.rotZ_deg && Math.abs(tr.rotZ_deg) > 0.5) {
                piece.rotation.z = (tr.rotZ_deg * Math.PI) / 180;
            }

            g.add(piece);
        }

        return g;
    }
}