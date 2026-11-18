// src/core/Rig.js
//
// Patch 171: jointed procedural rigs. Pure maths and a little state, no canvas: the
// Renderer draws with what these return. Two tools:
//
//   ik2()        a two-bone limb (hip-knee-foot, shoulder-elbow-hand): given where the
//                limb starts and where its end should be, where the middle joint goes.
//   WalkerRig    feet that are PLANTED in the world. A foot stays where it was put
//                while the body moves over it, and steps only when it is left too far
//                behind, alternating with its neighbours. That is what makes a
//                many-legged body read as walking instead of sliding.

/**
 * Two-bone inverse kinematics. Returns the joint (kx, ky) and the reachable end
 * (ex, ey; the target pulled in if it is farther than the limb is long).
 * `bend` is +1 or -1: which side the joint folds to.
 */
export function ik2(ax, ay, tx, ty, l1, l2, bend = 1) {
    let dx = tx - ax, dy = ty - ay;
    let d = Math.hypot(dx, dy);
    if (!(d > 0.0001)) { dx = 0.0001; dy = 0; d = 0.0001; }
    const max = l1 + l2 - 0.01;
    const min = Math.abs(l1 - l2) + 0.01;
    let use = d;
    if (use > max) use = max;
    if (use < min) use = min;
    const ux = dx / d, uy = dy / d;
    const a = (l1 * l1 - l2 * l2 + use * use) / (2 * use);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    return {
        kx: ax + ux * a - uy * h * bend,
        ky: ay + uy * a + ux * h * bend,
        ex: ax + ux * use,
        ey: ay + uy * use
    };
}

const easeInOut = (t) => t * t * (3 - 2 * t);

export class WalkerRig {
    /**
     * @param {number} legs      how many
     * @param {number} restR     how far from the body's centre a foot rests
     * @param {number} stepLen   how far a foot may be left behind before it steps
     * @param {number} stepTime  render frames a step takes
     */
    constructor(legs, restR, stepLen, stepTime = 9) {
        this.n = legs;
        this.restR = restR;
        this.stepLen = stepLen;
        this.stepTime = stepTime;
        this.feet = [];
        for (let i = 0; i < legs; i++) this.feet.push({ x: 0, y: 0, sx: 0, sy: 0, tx: 0, ty: 0, t: 1, lift: 0 });
        this.placed = false;
        this.lastX = 0; this.lastY = 0;
    }

    /** Where leg i rests, in the world, for a body at (x, y) turned by `turn`. */
    restOf(i, x, y, turn, spread) {
        const a = (i / this.n) * Math.PI * 2 + Math.PI / this.n + turn;
        const r = this.restR * spread;
        return [x + Math.cos(a) * r, y + Math.sin(a) * r, a];
    }

    /**
     * Advance one render frame. `spread` widens the stance (bracing), 1 = normal.
     * Total: a non-finite position re-plants the feet rather than poisoning them.
     */
    update(x, y, turn = 0, spread = 1) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const moved = Math.hypot(x - this.lastX, y - this.lastY);
        const vx = x - this.lastX, vy = y - this.lastY;
        // first frame, or a teleport (leash, pool reuse): plant every foot at rest
        if (!this.placed || moved > this.restR * 3) {
            for (let i = 0; i < this.n; i++) {
                const [rx, ry] = this.restOf(i, x, y, turn, spread);
                const f = this.feet[i];
                f.x = f.sx = f.tx = rx; f.y = f.sy = f.ty = ry; f.t = 1; f.lift = 0;
            }
            this.placed = true;
            this.lastX = x; this.lastY = y;
            return;
        }
        this.lastX = x; this.lastY = y;
        const sp = Math.min(1, moved / 3);
        for (let i = 0; i < this.n; i++) {
            const f = this.feet[i];
            const [rx, ry] = this.restOf(i, x, y, turn, spread);
            if (f.t < 1) {
                f.t = Math.min(1, f.t + 1 / this.stepTime);
                // the target keeps up with the body while the foot is in the air
                f.tx = rx + vx * this.stepTime * 0.6; f.ty = ry + vy * this.stepTime * 0.6;
                const e = easeInOut(f.t);
                f.x = f.sx + (f.tx - f.sx) * e;
                f.y = f.sy + (f.ty - f.sy) * e;
                f.lift = Math.sin(f.t * Math.PI);
            } else {
                f.lift = 0;
                const off = Math.hypot(f.x - rx, f.y - ry);
                // neighbours on the ground: legs step in two alternating groups
                const a = this.feet[(i + 1) % this.n], b = this.feet[(i + this.n - 1) % this.n];
                const neighboursDown = a.t >= 1 && b.t >= 1;
                if (off > this.stepLen * (1 - sp * 0.35) && (neighboursDown || off > this.stepLen * 1.8)) {
                    f.sx = f.x; f.sy = f.y; f.t = 0;
                    f.tx = rx + vx * this.stepTime * 0.6; f.ty = ry + vy * this.stepTime * 0.6;
                }
            }
        }
    }
}
