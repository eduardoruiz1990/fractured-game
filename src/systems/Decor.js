// src/systems/Decor.js
//
// Patch 177: set dressing. Until now a floor was one repeating tile pattern and a
// room's walls, so every room of a floor was the same empty plane. This places
// furniture and fixtures on it: each floor has its own props (the Office has desks and
// toppled chairs, the Inkblots have easels and spilled ink...), and some cells hold a
// LAMP, a pool of warm light that cuts the dark and gives a room landmarks.
//
// Decor is decoration only: nothing here collides, blocks light or touches gameplay.
//
// It is also stateless. The world is cut into cells; whether a cell holds a prop, which
// one, where in the cell and how it is turned are all a hash of (cell, floor, room).
// So nothing is stored, nothing is pooled, a room always looks the same while you are
// in it, and two rooms of one floor differ. Pure module: no imports, no canvas.

export const DECOR_CELL = 230;          // world units per cell
export const LAMP_RADIUS = 175;         // how far a lamp's pool of light reaches

/** Prop ids per biome (index = paletteIndexForFloor). Drawn by Renderer.drawDecorProp. */
export const DECOR_SETS = [
    ['desk', 'chair', 'cabinet', 'papers'],          // 1 The Office
    ['easel', 'inkpool', 'mirror', 'cards'],         // 2 The Inkblots
    ['post', 'grate', 'fence', 'tally'],             // 3 The Panopticon
    ['pod', 'roots', 'spores', 'ribs'],              // 4 The Amalgamation
    ['drafting', 'column', 'setsquare', 'scaffold']  // 5 The Architect
];

// a small integer hash -> [0, 1)
function hash(a, b, c, d) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    h = h ^ (h >>> 16);
    return ((h >>> 0) % 100000) / 100000;
}

/**
 * What stands in cell (cx, cy) on this floor and room, or null.
 * { kind: 'prop'|'lamp', id, x, y, rot, scale, seed }
 */
export function decorForCell(cx, cy, paletteIndex, floor, room) {
    const f = (floor | 0) * 31 + (room | 0);
    const r = hash(cx, cy, f, 1);
    if (r > 0.46) return null;                         // a little under half the cells hold something
    const ox = (hash(cx, cy, f, 2) - 0.5) * DECOR_CELL * 0.6;
    const oy = (hash(cx, cy, f, 3) - 0.5) * DECOR_CELL * 0.6;
    const x = (cx + 0.5) * DECOR_CELL + ox, y = (cy + 0.5) * DECOR_CELL + oy;
    const seed = hash(cx, cy, f, 4);
    if (r < 0.11) return { kind: 'lamp', id: 'lamp', x, y, rot: 0, scale: 1, seed };
    const set = DECOR_SETS[Math.max(0, Math.min(DECOR_SETS.length - 1, paletteIndex | 0))];
    const id = set[Math.floor(hash(cx, cy, f, 5) * set.length) % set.length];
    return { kind: 'prop', id, x, y, rot: (hash(cx, cy, f, 6) - 0.5) * 1.2, scale: 0.9 + hash(cx, cy, f, 7) * 0.35, seed };
}

/**
 * Calls fn(item) for every piece of decor whose cell touches the rectangle.
 * `clear` is an optional (x, y) => boolean: decor is skipped where it returns false
 * (the spot where the player starts, a door, a wall).
 */
export function forEachDecor(left, top, right, bottom, paletteIndex, floor, room, fn, clear) {
    if (![left, top, right, bottom].every(Number.isFinite)) return;
    const x0 = Math.floor(left / DECOR_CELL) - 1, x1 = Math.floor(right / DECOR_CELL) + 1;
    const y0 = Math.floor(top / DECOR_CELL) - 1, y1 = Math.floor(bottom / DECOR_CELL) + 1;
    if ((x1 - x0) * (y1 - y0) > 400) return;           // a degenerate view: draw nothing rather than thousands
    for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
            const d = decorForCell(cx, cy, paletteIndex, floor, room);
            if (!d) continue;
            if (clear && !clear(d.x, d.y)) continue;
            fn(d);
        }
    }
}
