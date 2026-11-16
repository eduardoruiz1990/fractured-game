import { Enemy } from './Enemy.js';

// Patch 135 (V2 plan D4): THE CRAWLSPACE — the burrowing archetype, introduced on
// floor 4. It travels under the floor, where nothing can touch it (takeDamage is
// ignored and the homing weapons skip it), surfaces under where you were standing
// with a visible warning ring, erupts, and then stays exposed and slow for a few
// seconds before it digs back in. The ring is the tell; the exposure is the window.
export const BURROW_STEPS = { travel: 150, warn: 50, exposed: 160, dig: 24 };
export const ERUPT_RADIUS = 70;

export class Burrower extends Enemy {
    constructor() {
        super('BURROWER', 14, '#8a6a46', 'scavenger_hurt');
        this.burrowState = 'burrowed';
        this.burrowTimer = 0;
        this.burrowed = true;
    }

    init(id, x, y, stress = 1) {
        this.phase = Math.random() * Math.PI * 2;
        this.variant = null;
        this.variantTint = null;
        this.burrowState = 'burrowed';
        this.burrowTimer = BURROW_STEPS.travel;
        this.burrowed = true;
        const s = Number.isFinite(stress) ? stress : 1;
        return this.initBase(id, x, y, 40 * s, 2.1);
    }

    takeDamage(amount, game, knockbackForce = 0) {
        if (this.burrowed) return;   // under the floor
        super.takeDamage(amount, game, knockbackForce);
    }

    update(state, game) {
        this.phase += 0.1;
        const px = state.player.x, py = state.player.y;
        const d = Math.max(Math.hypot(px - this.x, py - this.y), 0.001);

        if (this.burrowState === 'burrowed') {
            this.burrowed = true;
            this.vx = ((px - this.x) / d) * this.speed;
            this.vy = ((py - this.y) / d) * this.speed;
            this.burrowTimer--;
            if (d < 60 || this.burrowTimer <= 0) {
                // Surface where the player is NOW: standing still is what gets punished.
                this.x = px; this.y = py;
                this.burrowState = 'warning';
                this.burrowTimer = BURROW_STEPS.warn;
                this.vx = 0; this.vy = 0;
            }
        } else if (this.burrowState === 'warning') {
            this.vx = 0; this.vy = 0;
            this.burrowTimer--;
            if (this.burrowTimer <= 0) {
                this.burrowed = false;
                this.burrowState = 'exposed';
                this.burrowTimer = BURROW_STEPS.exposed;
                if (d < ERUPT_RADIUS + state.player.radius && (!state.player.dash || !state.player.dash.active)) {
                    game.takeDamage(this.damage, this.type);
                }
                state.cameraShake = Math.max(state.cameraShake, 8);
                game.spawnParticles(this.x, this.y, '#8a6a46', 18);
            }
        } else if (this.burrowState === 'exposed') {
            this.burrowed = false;
            this.vx = ((px - this.x) / d) * this.speed * 0.35;
            this.vy = ((py - this.y) / d) * this.speed * 0.35;
            if (d < 20 + state.player.radius && state.frame % 20 === 0
                && (!state.player.dash || !state.player.dash.active)) {
                game.takeDamage(this.damage * 0.5, this.type);
            }
            this.burrowTimer--;
            if (this.burrowTimer <= 0) { this.burrowState = 'digging'; this.burrowTimer = BURROW_STEPS.dig; }
        } else {   // digging: still exposed while it goes down
            this.vx = 0; this.vy = 0;
            this.burrowTimer--;
            if (this.burrowTimer <= 0) {
                this.burrowState = 'burrowed';
                this.burrowTimer = BURROW_STEPS.travel;
                this.burrowed = true;
            }
        }
        this.applyMovement(state, game);
    }
}
