# Human Pack Plan — order → stable seat → next item

## What the screenshots show today
1. Rafters / assemblies drawn **pitched / diagonal** (building pose), not flat for shipping.
2. Some pieces **float** with empty air under them.
3. Placement ignores the staging **1, 2, 3, 4** order.
4. Light pieces are not used as last-fill; space under / between heavy pieces stays empty.

## Real-world rule (what a human does)
1. Take the next checked group in order (1, then 2, then 3…).
2. Put it in the container **horizontally**, on the floor if it fits.
3. Only put something on top when the piece below is heavier / equal and the contact is real.
4. Never leave a gap under a piece (gravity).
5. After the ordered heavy work, fill leftover gaps with light plates / nests.

## Modules

### M1 — Horizontal shipping pose
- Every assembly / bundle / nest that enters Optimise is tip-levelled flat.
- Container render uses that flat pose only (no IFC pitch, no diagonal).
- Gate: mesh AABB pitch ≈ 0; L along container X or Z only.

### M2 — Ordered sequential pack
- Input order = staging `checkOrder`, then heavier first inside the same order.
- Place **one unit at a time**. Next unit only after previous is committed or rejected.
- No twin/strip special path that jumps the order.

### M3 — Stable seat finder (per unit)
For the current unit, score candidate seats:
1. Floor (y = 0) preferred over any stack.
2. Rear-most X, then home-wall Z (load from the door side last).
3. Max floor / support contact area.
4. Horizontal yaw only (0° or 90°) — never pitch / roll.
5. Reject: overlap, outside walls, height exceed, heavier-than-base, float.

### M4 — Gravity nail
- Floor pieces: `box.minY = 0`.
- Stack pieces: `box.minY = support.topY` exactly.
- Live mesh soak fails the run if any tipGap / float > 2 mm.

### M5 — Light fill last
- After the ordered pass, remaining light plates / nests try leftover floor pockets, then stack pads.
- Payload cap keep-set still applies, but never orphans a stack.

### M6 — Verify
- Localhost screenshots: end-on + top-down for A1321 / A1410 / A0134.
- Numeric: 0 float, 0 wall, 0 clash, 0 heavy-on-light, Group-By as-is.
- Self-tests for M2–M4.
