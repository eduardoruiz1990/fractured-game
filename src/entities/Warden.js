import { Enemy } from './Enemy.js';
import { isBossType } from '../data/Config.js';

// Patch 135 (V2 plan D4): THE FIRE WARDEN — the shielding archetype, introduced on
// floor 3. Slow and sturdy, it keeps to the middle of its own crowd and holds a ward
// over every manifestation within WARDEN_SHIELD_RADIUS: they take half damage while it
// stands (Enemy.takeDamage reads `shieldTimer`). It never shields a boss or itself.
// Kill it first.
export const WARDEN_SHIELD_RADIUS = 150;
export const WARDEN_SHIELD_FACTOR = 0.5;   // mirrored in Enemy.takeDamage — CHANGE BOTH

export class Warden extends Enemy {
    constructor() {
        super('WARDEN', 6, '#e0a030', 'predator_hurt');
        this.shielding = 0;
    }

    init(id, x, y, stress = 1) {
        this.phase = Math.random() * Math.PI * 2;
        this.variant = null;
        this.variantTint = null;
        this.shielding = 0;
        const s = Number.isFinite(stress) ? stress : 1;
        return this.initBase(id, x, y, 70 * s, 0.85);
    }

    update(state, game) {
        this.phase += 0.04;
        const px = state.player.x, py = state.player.y;
        const dx = px - this.x, dy = py - this.y;
        const d = Math.max(Math.hypot(dx, dy), 0.001);

        // Ward everything near it, and steer toward the centre of that crowd so the
        // ward covers as many as it can — but always drift toward the player too.
        let cx = 0, cy = 0, n = 0;
        for (const e of state.entities) {
            if (e === this || isBossType(e.type)) continue;
            const ed = Math.hypot(e.x - this.x, e.y - this.y);
            if (ed < WARDEN_SHIELD_RADIUS) e.shieldTimer = 6;
            if (ed < 400) { cx += e.x; cy += e.y; n++; }
        }
        this.shielding = n;
        let tx = px, ty = py;
        if (n > 0) { tx = (cx / n) * 0.6 + px * 0.4; ty = (cy / n) * 0.6 + py * 0.4; }
        const td = Math.max(Math.hypot(tx - this.x, ty - this.y), 0.001);
        const keepOff = d < 140 ? -0.6 : 1;   // it does not want to be in your face
        this.vx = ((tx - this.x) / td) * this.speed * keepOff;
        this.vy = ((ty - this.y) / td) * this.speed * keepOff;

        if (d < 30 + state.player.radius && state.frame % 20 === 0
            && (!state.player.dash || !state.player.dash.active)) {
            game.takeDamage(this.damage, this.type);
        }
        this.applyMovement(state, game);
    }
}
