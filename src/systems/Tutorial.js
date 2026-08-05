// src/systems/Tutorial.js
//
// Patch 65 — the tutorial's step machine. Patch 66 reordered it and added the hold.
//
// WHY THIS EXISTS. The tutorial used to deliver six instructions on frame 1 across
// two competing surfaces (a DOM banner in main.js and world-space ground text in
// Renderer.drawWorldItems), every one of them hardcoded to WASD/mouse/SPACE, while
// an enemy was already walking in. Mobile players — the larger and worse-converting
// half of the audience — were told to press keys they do not have.
//
// This module replaces that with ONE instruction at a time, on ONE surface (the
// banner), each advanced by the player DEMONSTRATING the previous one, with a
// generous time fallback on every step so nobody can ever be stuck.
//
// THE ORDER MATTERS (Patch 66). Both controls are taught with an empty room: the
// enemy does not spawn until the player has moved AND dashed. Combat is the first
// thing that can punish inattention, so nothing is asked of the player while
// something is walking toward them.
//
// THE HOLD (Patch 66). An instruction that arrives while the world is moving is an
// instruction nobody reads. While a step is pending, `tutorialFreeze` stops enemy AI
// — the enemy stands there, unaware, until the player does the thing being asked —
// and lifts the moment they do (or after FREEZE_CAP, so it can never be a soft lock).
// MIN_READ additionally holds every step on screen long enough to be read, so an
// instruction cannot flash past a player who happened to already be pressing the key.
//
// STATE lives on `game.state` (fields initialised in Game.init), not in this module,
// so it is rebuilt with every run and cannot survive into a normal room. This module
// is stateless: it is a reducer over state, which is also what makes it testable
// without a canvas.
//
// COPY. Written for a twelve-year-old and a fifty-year-old to read once, at a
// glance, while playing. Short sentences, common words, no lore in the instruction
// itself — the game's vocabulary (Manifestation, Grip, the Void) is introduced by
// the world and the guide, not by the line that has to teach a button. `keyboard` is
// required; `touch` is optional and falls back to `keyboard`. A step with no entry
// here renders NO banner — that is deliberate for FIGHT, which is the deliberate
// silence while the player actually fights.
export const TUTORIAL_COPY = {
    MOVE: {
        keyboard: "Use W A S D to move.",
        touch: "Slide your left thumb to move."
    },
    DASH: {
        keyboard: "Press SPACE to dash. Nothing can hit you while you dash.",
        touch: "Tap DASH to dash. Nothing can hit you while you dash."
    },
    ENGAGE: {
        keyboard: "An enemy. Point your mouse at it — your light attacks on its own.",
        touch: "An enemy. Slide your right thumb to aim — your light attacks on its own."
    },
    // FIGHT: intentionally absent. Once the player has moved, aimed and dashed, the
    // banner gets out of the way until there is something new to say.
    COLLECT: {
        keyboard: "Walk over the glowing pieces to pick them up."
    },
    ASCEND: {
        keyboard: "You gained a level. Every level, you pick a new power."
    },
    BANK: {
        keyboard: "Lucidity buys permanent upgrades. Escape alive to keep all of it — if you die, you keep half."
    },
    DOOR: {
        keyboard: "Walk into a door to move on. Each door shows what it gives you."
    }
};

// Frame budgets (60fps). These are FALLBACKS, not pacing — every step normally ends
// on the player's own action. They exist so a player who never presses the taught
// key still reaches combat, the kill and the exit.
const MOVE_FALLBACK = 900;    // 15s
const DASH_FALLBACK = 900;    // 15s — longer than the others: the enemy waits on it
const ENGAGE_FALLBACK = 1200; // 20s
const COLLECT_FALLBACK = 900; // 15s
const ASCEND_HOLD = 360;      // 6s
const BANK_HOLD = 480;        // 8s — two sentences, and the more important one

// Minimum time any instruction stays up before its gate is allowed to fire. Without
// it, a player already holding W never sees the MOVE line at all.
const MIN_READ = 60;          // 1s

// Hard ceiling on the enemy hold, so a player who cannot find the attack is never
// stuck staring at a statue.
const FREEZE_CAP = 420;       // 7s

const MOVE_REQUIRED_PX = 140;

export class Tutorial {
    /** Called from Game.init's state literal path; also self-heals a resumed state. */
    static reset(state) {
        state.tutorialStep = 'MOVE';
        state.tutorialTimer = 0;
        state.tutorialMoved = 0;
        state.tutorialLastX = null;
        state.tutorialLastY = null;
        state.tutorialCombatReady = false;
        state.tutorialEnemySeen = false;
        state.tutorialDashed = false;
        state.tutorialAscendShown = false;
        state.tutorialFreeze = false;
    }

    static go(state, step) {
        state.tutorialStep = step;
        state.tutorialTimer = 0;
    }

    /**
     * One tick. Called from Game.processGameLogic, which only runs during PLAYING —
     * so the machine freezes while the level-up card or the pause menu is open,
     * which is exactly right: those are not time the player spent ignoring us.
     */
    static update(game) {
        const s = game && game.state;
        if (!s || !s.isTutorial || !s.player) return;
        if (s.tutorialStep === undefined) Tutorial.reset(s);

        s.tutorialTimer++;

        // Distance actually travelled, not displacement — circling counts, and a
        // player who walks out and back has still demonstrated the control. Frames
        // with an implausible jump are ignored so a dash or a leash teleport cannot
        // satisfy the movement gate on its own.
        const px = s.player.x, py = s.player.y;
        if (Number.isFinite(px) && Number.isFinite(py)) {
            if (Number.isFinite(s.tutorialLastX) && Number.isFinite(s.tutorialLastY)) {
                const d = Math.hypot(px - s.tutorialLastX, py - s.tutorialLastY);
                if (d < 60) s.tutorialMoved += d;
            }
            s.tutorialLastX = px;
            s.tutorialLastY = py;
        }

        if (s.entities && s.entities.length > 0) s.tutorialEnemySeen = true;
        if (s.player.dash && s.player.dash.active) s.tutorialDashed = true;

        const step = s.tutorialStep;
        const damaged = Tutorial.enemyDamaged(s);

        // The hold. Only ENGAGE can have a live enemy on screen — MOVE and DASH are
        // taught in an empty room — so this is where it does any work. Consumed by
        // Game.processGameLogic, which skips entity AI while it is set.
        s.tutorialFreeze = (step === 'ENGAGE' && !damaged && s.tutorialTimer < FREEZE_CAP);

        // --- Overrides. The world can outrun the script: the player may kill the
        // enemy during a prompt, or level up during COLLECT. These jumps run before
        // the ordinary sequence so the banner never narrates the past.
        const killed = s.tutorialEnemySeen && (!s.entities || s.entities.length === 0);
        if (killed && (step === 'DASH' || step === 'ENGAGE' || step === 'FIGHT')) {
            s.tutorialFreeze = false;
            Tutorial.go(s, 'COLLECT');
            return;
        }
        // The level-up card is the single most important thing the tutorial teaches,
        // so its follow-up is allowed to interrupt from DOOR too — a player who
        // collects the orbs late would otherwise never be told what Lucidity is for.
        if (!s.tutorialAscendShown && s.level > 1 && (step === 'COLLECT' || step === 'DOOR')) {
            s.tutorialAscendShown = true;
            Tutorial.go(s, 'ASCEND');
            return;
        }

        const t = s.tutorialTimer;
        if (t < MIN_READ) return;   // every instruction gets read before it can pass

        switch (step) {
            case 'MOVE':
                if (s.tutorialMoved >= MOVE_REQUIRED_PX || t > MOVE_FALLBACK) Tutorial.go(s, 'DASH');
                break;

            case 'DASH':
                // Leaving this step is what lets Director.spawnWave place the enemy.
                // Both controls are learned before anything is on screen to punish
                // the player for reading.
                if (s.tutorialDashed || t > DASH_FALLBACK) {
                    s.tutorialCombatReady = true;
                    Tutorial.go(s, 'ENGAGE');
                }
                break;

            case 'ENGAGE':
                if (damaged || t > ENGAGE_FALLBACK) Tutorial.go(s, 'FIGHT');
                break;

            case 'COLLECT':
                if (t > COLLECT_FALLBACK) Tutorial.go(s, 'DOOR');
                break;

            case 'ASCEND':
                if (t > ASCEND_HOLD) Tutorial.go(s, 'BANK');
                break;

            case 'BANK':
                if (t > BANK_HOLD) Tutorial.go(s, 'DOOR');
                break;

            default:
                break;
        }
    }

    /** First damage dealt is the proof that the player has aimed, not just moved. */
    static enemyDamaged(state) {
        if (!state.entities) return false;
        for (let i = 0; i < state.entities.length; i++) {
            const e = state.entities[i];
            if (e && Number.isFinite(e.hp) && Number.isFinite(e.maxHp) && e.hp < e.maxHp) return true;
        }
        return false;
    }

    /**
     * The banner's text for this frame, or null to hide it.
     *
     * `mode` is 'touch' | 'keyboard' from InputManager.getInputMode(), resolved every
     * frame rather than once at boot: a phone that never fires a keydown reads as
     * touch immediately, and a laptop with a touchscreen switches the moment either
     * input is actually used.
     */
    static bannerCopy(state, mode) {
        if (!state || !state.isTutorial) return null;
        const line = TUTORIAL_COPY[state.tutorialStep];
        if (!line) return null;
        return (mode === 'touch' && line.touch) ? line.touch : line.keyboard;
    }
}
