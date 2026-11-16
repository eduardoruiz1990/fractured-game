import { Enemy } from './Enemy.js';

// Patch 135 (V2 plan D4): THE PHOTOCOPY — the splitting archetype, introduced on
// floor 2. A shuffling paper figure; killing a full-size one tears it into two smaller,
// faster copies (generation 2), which do not split again. Combat.js does the split on
// death, like the Rorschach's, so the copies are ordinary spawns from the pool.
export const SPLITTER_HP = [0, 34, 12];      // by generation
export const SPLITTER_SPEED = [0, 1.35, 2.2];

export class Splitter extends Enemy {
    constructor() {
        super('SPLITTER', 4, '#d8cfb8', 'scavenger_hurt');
        this.generation = 1;
    }

    init(id, x, y, stress = 1, generation = 1) {
        this.generation = generation === 2 ? 2 : 1;
        this.phase = Math.random() * Math.PI * 2;
        this.variant = null;
        this.variantTint = null;
        const s = Number.isFinite(stress) ? stress : 1;
        return this.initBase(id, x, y, SPLITTER_HP[this.generation], SPLITTER_SPEED[this.generation] * s);
    }

    update(state, game) {
        this.phase += 0.08;
        const dx = state.player.x - this.x, dy = state.player.y - this.y;
        const d = Math.max(Math.hypot(dx, dy), 0.001);
        // A shuffling approach: a sideways sway on top of a straight chase.
        const sway = Math.sin(this.phase) * 0.45;
        this.vx = (dx / d) * this.speed + (-dy / d) * this.speed * sway;
        this.vy = (dy / d) * this.speed + (dx / d) * this.speed * sway;
        const reach = this.generation === 1 ? 22 : 16;
        if (d < reach + state.player.radius && state.frame % 15 === 0
            && (!state.player.dash || !state.player.dash.active)) {
            game.takeDamage(this.damage, this.type);
        }
        this.applyMovement(state, game);
    }
}
