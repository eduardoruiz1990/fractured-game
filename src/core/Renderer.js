// Patch 51c: the three catch blocks in this file swallow render exceptions and
// log them to the console only. Because drawGame() is called from INSIDE
// gameLoop's own try, those exceptions never reach main.js's handler either — so
// the crash telemetry added in Patch 50 was blind to the most likely cause of a
// "frozen game" report. Reporting into the same log closes that gap. This import
// adds no per-frame cost: errorLog is only touched when something already threw.
import { errorLog } from './ErrorLog.js';
// The arena wall drawn below is the same boundary Game.js drains Sanity past and
// Director.js clamps spawns inside — see the note on ARENA_VOID_RADIUS in Config.js.
import { ARENA_VOID_RADIUS, isBossType } from '../data/Config.js';
import { ARENA_LAYOUTS, ARENA_RISE_STEPS, ARENA_FADE_STEPS, GRID_TELEGRAPH_STEPS } from '../systems/Arena.js';   // Patch 137
// Patch 96 — THE RECURSION's look: the five biomes cycle past floor 5, with a capped
// depth escalation layered over them. The cap is a memory bound, not a taste one —
// see CYCLE_VISUAL_CAP in src/core/Endless.js.
import { paletteIndexForFloor, visualCycle, cycleGrade } from './Endless.js';
import { bossIntroLines, bossEpithet, BOSS_DEATH_SUBTITLE_STEPS } from '../data/Story.js';
import { bossTelegraphing } from './Haptics.js';   // Patch 150 (V2 plan F4)   // Patch 146 (V2 plan E4)

// Patch 109: upper bound on Renderer.spriteCache (see cacheSprite). Comfortably above
// the real working set — entity bodies x phase buckets x variants, glows per colour.
const SPRITE_CACHE_MAX = 768;

// Patch 165: how dark the unlit world is (1 = the old pitch black).
const DARKNESS_ALPHA = 0.6;
const EYE_COLOURS = {
    SCAVENGER: '#ffd24a', PREDATOR: '#ff5a48', PARASITE: '#9dff6a',
    SPLITTER: '#f4f0e0', WARDEN: '#ffb347', BURROWER: '#ffc9a0'
};

export class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        
        this.noisePattern = this.generateNoisePattern();
        this.cachedNoisePattern = this.ctx.createPattern(this.noisePattern, 'repeat');
        this.fogClouds = this.generateFogClouds();
        this.cachedFloorPatterns = this.generateFloorPatterns();
        // Patch 96: ONE extra cached pattern, built here with the other five and reused
        // by every endless floor forever. Depth changes the alpha it is drawn at, never
        // the number of cached canvases.
        this.cachedRecursionPattern = this.generateRecursionPattern();

        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        // Patch 121: the vignette's quarter-resolution buffer (see drawVignette). A
        // plain canvas, not a spriteCache entry: one buffer, rebuilt in place.
        // NOTE (Patch 122): fog must NOT get the same treatment. A per-frame offscreen
        // round trip (clear, draw, composite) was built and measured in Patch 121: it
        // was slower headless, and on a Samsung A56 it stalled each frame for 68 ms
        // and pushed the phone into a slowdown that lasted the rest of the session.
        // A buffer pays off only when it is redrawn rarely, as the vignette is.
        this.vigCanvas = document.createElement('canvas');
        this.vigCtx = this.vigCanvas.getContext('2d');
        this.vigKey = '';
        this.setQuality('high');   // Patch 115; main.js applies the player's tier at boot
        // Patch 120: per-effect switches for the playtest perf panel (src/dev/PerfOverlay.js).
        // Always all-true in shipped builds; nothing outside that panel writes them.
        this.diag = { fog: true, lights: true, vignette: true };
        // Patch 157: the Mind Hub's layers, switchable by the playtest benchmark (a
        // phone's GPU cost is invisible headless). The defaults are what ships:
        //   floor   the baked floor + furniture image (HubWorld.draw)
        //   light   the darkness mask;  tints  the flashlight tint, zone pools, beams
        //   dust    the drifting motes
        // Patch 158 removed 155's two losing variants (the ImageBitmap floor and the
        // one-path dust) after the A56 measured them; see CHANGELOG 157-158.
        this.hubDiag = { floor: true, light: true, tints: true, dust: true };
        
        // Camera zoom. 1.3 is the desktop look and the MAXIMUM — updateZoom() only
        // ever scales DOWN, on viewports too small to show a usable amount of world.
        this.zoom = 1.3;

        // Patch 71 — portrait layout. OFF unless main.js turns it on (touch device,
        // taller than wide, phone-sized). Everything below is initialised to the
        // desktop values updateZoom() will immediately recompute, so a renderer that
        // is never told about portrait behaves exactly as it did before this patch.
        this.portraitMode = false;
        this.controlBandH = 0;                       // px of canvas reserved for thumbs
        this.worldViewWidth = canvas ? canvas.width : 0;   // the part of the canvas the world uses
        this.worldViewHeight = canvas ? canvas.height : 0;
        this.cameraCenterX = this.worldViewWidth / 2;      // where the player is drawn
        this.cameraCenterY = this.worldViewHeight / 2;

        this.updateZoom();

        // Offscreen sprite cache (see getSprite/drawGlow). Lazily populated rather
        // than built at init like cachedFloorPatterns, because entity sprites are
        // keyed on runtime state (per-floor colour, flash, hp tier) that isn't
        // known until a run starts.
        this.spriteCache = new Map();
        // World is drawn at this.zoom, so sprites are supersampled to stay crisp
        // instead of being upscaled from 1:1.
        this.spriteScale = 2;

        this.legPhase = 0;
        this.lastPx = -1;
        this.lastPy = -1;
        this.lastFootstepPhase = 0;

        this.bossAnnouncementTimer = 0;
        this.hasAnnouncedBoss = false;
        
        this.renderFrame = 0;
        // Patch 74: how many fixed 60Hz simulation steps the frame being drawn covers.
        // Written by main.js's loop each frame; 1 keeps the pre-patch behaviour for any
        // path that never sets it.
        this.simStepsThisFrame = 1;

        this.rain = [];
        for(let i = 0; i < 150; i++) {
            this.rain.push({
                x: Math.random() * 3000,
                y: Math.random() * 2000,
                l: Math.random() * 25 + 10,
                v: Math.random() * 20 + 20
            });
        }
        this.lightningFlash = 0;

        this.hubDust = [];
        for(let i = 0; i < 80; i++) {
            this.hubDust.push({
                x: (Math.random() - 0.5) * 2000,
                y: (Math.random() - 0.5) * 2000,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 2 + 0.5,
                phase: Math.random() * Math.PI * 2
            });
        }
    }

    hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(255, 255, 255, ${alpha})`;
        let cleanHex = hex.replace('#', '');
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(char => char + char).join('');
        }
        if (cleanHex.length === 6) {
            const r = parseInt(cleanHex.substring(0, 2), 16);
            const g = parseInt(cleanHex.substring(2, 4), 16);
            const b = parseInt(cleanHex.substring(4, 6), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return `rgba(255, 255, 255, ${alpha})`;
    }

    // ROOM_DOOR reward-type -> {color, glowRgb, label}. Shared by the world-item
    // door render and the off-screen objective pointer, so both stay in sync when
    // a reward type is added (Patch 23 added 3 new types; before this, everything
    // but LUCIDITY rendered as the same green door with its raw enum id as text).
    // Falls back to HEAL's look for any unrecognized rewardType rather than
    // drawing with an undefined color.
    roomDoorVisual(rewardType) {
        const table = {
            LUCIDITY: { color: '#ffaa00', glowRgb: '255, 200, 100', label: 'LUCIDITY +50' },
            // "HEAL", not a bare "+50": a player reported not being able to tell
            // whether this door raised max Sanity or restored lost Sanity. It restores
            // (Combat.js ROOM_DOOR: min(maxHp, sanity + 50)), so the label says so.
            HEAL: { color: '#33ff55', glowRgb: '100, 255, 100', label: 'HEAL +50' },
            WEAPON_UPGRADE: { color: '#4499ff', glowRgb: '80, 160, 255', label: 'WEAPON UP' },
            TOKEN_DOOR: { color: '#ff8c00', glowRgb: '255, 140, 0', label: 'TOKEN' },
            RISK_REWARD: { color: '#ff3333', glowRgb: '255, 60, 60', label: 'RISK / REWARD' }
        };
        return table[rewardType] || table.HEAL;
    }

    // Per-entity animation clock. Two detuned sine terms, both offset by the
    // entity's own .phase, so same-type entities never pulse in lockstep and the
    // combined wave doesn't visibly loop the way a single sine does.
    // Range is roughly [-1.3, 1.3] — callers multiplying by an amplitude get a
    // slightly wider swing than a plain Math.sin() did.
    /**
     * Fits the camera zoom to the viewport. Call on init and on every resize.
     *
     * The world is drawn at `zoom`, so the visible world area is canvasSize / zoom.
     * With a hardcoded 1.3 that meant a desktop saw 1477x831 world px while a phone
     * in portrait (390x844 CSS px) saw only 300x649 — nearly 5x less world at the
     * SAME sprite scale, which is why everything read as enormous and the HUD
     * swallowed the play area on mobile.
     *
     * 1.3 stays the MAXIMUM, so the desktop look is unchanged; this only ever scales
     * down, and only when the viewport cannot show TARGET_W x TARGET_H world units.
     * MIN_ZOOM is a readability floor — past it, entities get too small to parse.
     * The result is clamped and always finite, so it can never feed NaN into the
     * canvas transform.
     */
    /**
     * Camera fit, and — in portrait only — the control band.
     *
     * TWO PATHS, DELIBERATELY DISJOINT. `portraitMode` is set by main.js and is false
     * for every desktop, every landscape phone and every tablet in landscape. When it
     * is false this method computes exactly what it computed before Patch 71: band 0,
     * camera centred on the canvas, `fit` measured against the full canvas height,
     * floor 0.70. No desktop viewport can reach a portrait branch, which is the point
     * — the portrait layout is additive, not a reinterpretation of the existing one.
     *
     * WHY A BAND. A 390x844 phone shows a tall slot of world, and the player's own
     * thumbs sit on the bottom corners of it. Zoom alone cannot fix that: reaching the
     * 900-unit design width on a 390px screen needs zoom 0.43, at which the player is
     * ~10 screen pixels. So the bottom ~26% is reserved for the hands instead, the
     * world is rendered into what is left, and the player is centred in THAT — the
     * camera centre moves up, so the area under the thumbs is screen the world was
     * never using.
     */
    updateZoom() {
        const MAX_ZOOM = 1.3;            // desktop, unchanged
        // Patch 165: 0.70/0.58 drew a 12-unit enemy at 7-8 px on a phone. With enemies
        // arriving at the edge of the view (Director.spawnEntity) the warning distance is
        // the screen itself, so the camera can sit close enough to read the crowd.
        const MIN_ZOOM = 0.90;
        const MIN_ZOOM_PORTRAIT = 0.86;
        const TARGET_W = 900;            // world units we want visible horizontally
        const TARGET_H = 620;            // and vertically

        const w = this.canvas ? this.canvas.width : 0;
        const h = this.canvas ? this.canvas.height : 0;
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            this.zoom = MAX_ZOOM;
            this.controlBandH = 0;
            this.worldViewWidth = Math.max(1, w);
            this.worldViewHeight = Math.max(1, h);
            this.cameraCenterX = Math.max(1, w) / 2;
            this.cameraCenterY = Math.max(1, h) / 2;
            return;
        }

        // Clamped at both ends: 140px is too little to rest a thumb in, and the band
        // must never eat more than 40% of the screen however tall the device is.
        const band = this.portraitMode
            ? Math.min(h * 0.4, Math.min(300, Math.max(140, Math.round(h * 0.26))))
            : 0;

        this.controlBandH = band;
        this.worldViewWidth = w;
        this.worldViewHeight = Math.max(1, h - band);
        this.cameraCenterX = w / 2;
        this.cameraCenterY = this.worldViewHeight / 2;

        const fit = Math.min(w / TARGET_W, this.worldViewHeight / TARGET_H);
        const floor = this.portraitMode ? MIN_ZOOM_PORTRAIT : MIN_ZOOM;
        this.zoom = Math.max(floor, Math.min(MAX_ZOOM, fit));
    }

    // Generic offscreen sprite cache, following the cachedFloorPatterns /
    // HubWorld.cachedFloor pattern. `key` MUST capture every input that changes the
    // drawing — a missed input means entities render with a stale sprite forever.
    // `drawFn` gets a context already translated to the sprite centre, so body code
    // can be moved in verbatim using the same local coordinates.
    getSprite(key, w, h, drawFn) {
        let sprite = this.spriteCache.get(key);
        if (sprite) return sprite;

        const ss = this.spriteScale;
        const c = document.createElement('canvas');
        c.width = Math.ceil(w * ss);
        c.height = Math.ceil(h * ss);
        const cx = c.getContext('2d');
        cx.scale(ss, ss);
        cx.translate(w / 2, h / 2);
        drawFn(cx);

        sprite = { canvas: c, w, h };
        this.cacheSprite(key, sprite);
        return sprite;
    }

    // Patch 109 (V2 plan B3): every spriteCache insert goes through here. The cache
    // was unbounded, so any caller whose key varied continuously (see drawGlow) grew it
    // by one canvas per frame for the whole session. Keys are supposed to be drawn from
    // small finite sets, so in normal play this never trips; it is the backstop that
    // turns a future key mistake into a little re-rendering instead of a memory leak.
    // A Map iterates in insertion order, so dropping from the front evicts the oldest.
    cacheSprite(key, sprite) {
        if (this.spriteCache.size >= SPRITE_CACHE_MAX) {
            let toDrop = Math.ceil(SPRITE_CACHE_MAX / 4);
            for (const k of this.spriteCache.keys()) {
                this.spriteCache.delete(k);
                if (--toDrop <= 0) break;
            }
        }
        this.spriteCache.set(key, sprite);
    }

    drawSprite(sprite, x = 0, y = 0) {
        this.ctx.drawImage(sprite.canvas, x - sprite.w / 2, y - sprite.h / 2, sprite.w, sprite.h);
    }

    // Radial faux-glow from a cached bitmap. The ramp is identical at every size, so
    // one sprite per (colour, alpha) scales to any radius: the pulse stays fully live
    // via the destination rect, while createRadialGradient() runs once instead of
    // once per entity per frame. Still faux-glow — no shadowBlur.
    //
    // Patch 109 (V2 plan B3): the sprite is baked at FULL alpha and the caller's alpha
    // is applied with globalAlpha at draw time. The key used to be colour + alpha, so a
    // caller passing a continuously varying alpha — the tutorial cue's `0.22 * fade` —
    // minted a new 128x128 canvas (64 KB) almost every frame and kept it forever, on
    // exactly the low-end phones a first-time player is most likely to be on. A linear
    // ramp from a@1 to 0 drawn at globalAlpha=a is the same image as a ramp from a to
    // 0, so this is visually identical and the cache is now one sprite per colour.
    drawGlow(x, y, radius, color, alpha) {
        if (!Number.isFinite(radius) || radius <= 0) return;
        if (!Number.isFinite(alpha) || alpha <= 0) return;

        const key = `glow|${color}`;
        let sprite = this.spriteCache.get(key);
        if (!sprite) {
            const R = 64;
            const c = document.createElement('canvas');
            c.width = c.height = R * 2;
            const cx = c.getContext('2d');
            const g = cx.createRadialGradient(R, R, 0, R, R, R);
            g.addColorStop(0, this.hexToRgba(color, 1));
            g.addColorStop(1, this.hexToRgba(color, 0));
            cx.fillStyle = g;
            cx.fillRect(0, 0, R * 2, R * 2);
            sprite = { canvas: c };
            this.cacheSprite(key, sprite);
        }
        // Multiplied into, not assigned: several callers draw inside a faded group.
        const prevAlpha = this.ctx.globalAlpha;
        this.ctx.globalAlpha = prevAlpha * Math.min(1, alpha);
        this.ctx.drawImage(sprite.canvas, x - radius, y - radius, radius * 2, radius * 2);
        this.ctx.globalAlpha = prevAlpha;
    }

    // `offset` shifts this call relative to the entity's own phase, for parts that
    // need a fixed relationship to each other (e.g. counter-phased body edges).
    entPulse(ent, speed = 0.1, offset = 0) {
        const p = ((ent && Number.isFinite(ent.phase)) ? ent.phase : 0) + offset;
        return Math.sin(this.renderFrame * speed + p)
             + Math.sin(this.renderFrame * speed * 3.7 + p) * 0.3;
    }

    // Patch 112 (V2 plan B4): the visible world rectangle, padded, for culling cheap
    // high-count draws (XP orbs, ink puddles, particles) that used to be drawn even when
    // nowhere near the screen. Mirrors the camera transform in drawGame exactly —
    // cameraCenter is where the player is drawn, and the world is scaled by zoom — so
    // it is right on every layout including the portrait band. The pad covers camera
    // shake and the largest culled radius; anything partly visible is still drawn.
    updateCullRect(state) {
        const z = (Number.isFinite(this.zoom) && this.zoom > 0) ? this.zoom : 1;
        const px = state.player.x, py = state.player.y;
        const pad = 120 + (Number.isFinite(state.cameraShake) ? state.cameraShake : 0);
        this.cullL = px - this.cameraCenterX / z - pad;
        this.cullR = px + (this.canvas.width - this.cameraCenterX) / z + pad;
        this.cullT = py - this.cameraCenterY / z - pad;
        this.cullB = py + (this.canvas.height - this.cameraCenterY) / z + pad;
    }

    /**
     * Patch 114 (V2 plan B6): how many simulation steps this draw represents, for the
     * few timers that live in the renderer. At least 1 — main.js skips the draw
     * entirely on a frame with no sim step, so a draw always covers >= 1 step.
     */
    drawSteps() {
        const n = this.simStepsThisFrame;
        return (Number.isFinite(n) && n >= 1) ? n : 1;
    }

    /** Patch 112: true unless (x, y) is certainly off screen. Fails open on bad data. */
    inView(x, y) {
        if (!Number.isFinite(this.cullL)) return true;
        return x >= this.cullL && x <= this.cullR && y >= this.cullT && y <= this.cullB;
    }

    // Patch 17: per-entity hit squash/recoil, driven off flashTime (set to 5 on
    // takeDamage, ticking down to 0 in Enemy.applyMovement — see Enemy.js). Widens
    // then eases back to 1,1 as flashTime decays, giving a one-frame "impact pop."
    // Scoped inside each entity branch's own local save/restore so it never touches
    // the health bar drawn after the dispatch chain in the shared outer transform.
    hitSquash(ent) {
        const t = (ent && ent.flashTime > 0) ? ent.flashTime / 5 : 0;
        return { x: 1 + t * 0.22, y: 1 - t * 0.18 };
    }

    // Patch 35 — per-floor BIOME IDENTITY.
    //
    // Before this, all five biomes drew the identical structure (a 128px grid
    // plus 40 random ellipses) and differed only in palette, so every floor
    // read as "the same room, recoloured". Each biome now has its own visual
    // language keyed to its boss: institutional tile+rust (Wastes), mirrored
    // inkblots (Divide/Rorschach), surveillance arcs+tally marks (Panopticon),
    // organic veins+cell clusters (Amalgamation), and blueprint linework
    // (Architect).
    //
    // KEEP (unchanged contract): still built ONCE at construction into
    // offscreen 512x512 canvases converted to repeat patterns — nothing here
    // runs per frame, and drawWorldItems() still just indexes patterns[floor-1].
    // The five bg/line/accent1/accent2 values are preserved EXACTLY as tuned;
    // only structure changed, plus additive optional fields (e.g. `crack`).
    //
    // SEAMS: the pattern repeats every 512px across an 8000px fill, so any
    // shape clipped at a tile edge would print a visible 512px grid over the
    // whole floor. Every scattered element therefore goes through tileWrap(),
    // which redraws it at the 8 neighbouring tile offsets so edge-crossing
    // shapes continue correctly on the opposite side. All randomness must be
    // computed OUTSIDE the tileWrap callback — sampling inside would give each
    // of the 9 copies different values and defeat the whole point.
    generateFloorPatterns() {
        const S = 512;
        const patterns = [];

        const biomes = [
            // Patch 165: every floor lifted out of near-black and given a clear hue, so a
            // biome is recognisable in the dim light outside the beam and on a phone
            // screen in daylight. Same identities, three to four times the luminance.
            { bg: '#4a3526', line: '#2b1d12', accent1: 'rgba(120, 78, 46, 0.45)', accent2: 'rgba(20, 12, 6, 0.45)', crack: 'rgba(16, 9, 4, 0.6)' }, // Floor 1: Wastes (rust and amber)
            { bg: '#2b3442', line: '#4a586e', accent1: 'rgba(140, 160, 190, 0.25)', accent2: 'rgba(8, 12, 20, 0.5)' }, // Floor 2: Divide (cold steel blue)
            { bg: '#541a20', line: '#2c0a0e', accent1: 'rgba(170, 40, 46, 0.35)', accent2: 'rgba(24, 4, 6, 0.55)' }, // Floor 3: Panopticon (crimson)
            { bg: '#1a4a2c', line: '#0c2414', accent1: 'rgba(60, 150, 80, 0.3)', accent2: 'rgba(6, 22, 10, 0.5)' }, // Floor 4: Amalgamation (toxic green)
            { bg: '#1c1830', line: '#c9972a', accent1: 'rgba(218, 165, 32, 0.16)', accent2: 'rgba(6, 4, 16, 0.6)' }  // Floor 5: Architect (midnight violet and gold)
        ];

        const tileWrap = (cx, fn) => {
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    cx.save();
                    cx.translate(ox * S, oy * S);
                    fn();
                    cx.restore();
                }
            }
        };

        // Floor 1 — THE WASTES: derelict institutional flooring. Big linoleum
        // tiles, rust pooling in the grout, hairline cracks spidering off it.
        const drawWastes = (cx, p) => {
            cx.strokeStyle = p.line;
            cx.lineWidth = 4;
            for (let i = 0; i <= S; i += 128) {
                cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, S); cx.stroke();
                cx.beginPath(); cx.moveTo(0, i); cx.lineTo(S, i); cx.stroke();
            }
            for (let i = 0; i < 26; i++) {
                const x = Math.random() * S, y = Math.random() * S;
                const r = 8 + Math.random() * 22;
                const rot = Math.random() * Math.PI;
                const fill = Math.random() > 0.5 ? p.accent1 : p.accent2;
                tileWrap(cx, () => {
                    cx.fillStyle = fill;
                    cx.beginPath();
                    cx.ellipse(x, y, r, r * 0.6, rot, 0, Math.PI * 2);
                    cx.fill();
                });
            }
            for (let i = 0; i < 14; i++) {
                const pts = [];
                let px = Math.random() * S, py = Math.random() * S, a = Math.random() * Math.PI * 2;
                pts.push([px, py]);
                for (let s = 0; s < 5; s++) {
                    a += (Math.random() - 0.5) * 1.2;
                    px += Math.cos(a) * (10 + Math.random() * 18);
                    py += Math.sin(a) * (10 + Math.random() * 18);
                    pts.push([px, py]);
                }
                tileWrap(cx, () => {
                    cx.strokeStyle = p.crack;
                    cx.lineWidth = 1.5;
                    cx.beginPath();
                    cx.moveTo(pts[0][0], pts[0][1]);
                    for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k][0], pts[k][1]);
                    cx.stroke();
                });
            }
        };

        // Floor 2 — THE DIVIDE (Rorschach): cold hairline grid bisected by a
        // fold line, with symmetric inkblots mirrored across it.
        const drawDivide = (cx, p) => {
            cx.strokeStyle = p.line;
            cx.lineWidth = 1;
            for (let i = 0; i <= S; i += 64) {
                cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, S); cx.stroke();
                cx.beginPath(); cx.moveTo(0, i); cx.lineTo(S, i); cx.stroke();
            }
            cx.strokeStyle = p.accent1;
            cx.lineWidth = 2;
            cx.beginPath(); cx.moveTo(S / 2, 0); cx.lineTo(S / 2, S); cx.stroke();

            for (let i = 0; i < 5; i++) {
                const cy = Math.random() * S;
                const lobes = [];
                const n = 4 + Math.floor(Math.random() * 3);
                for (let k = 0; k < n; k++) {
                    lobes.push({ dx: Math.random() * 90, dy: (Math.random() - 0.5) * 80, r: 10 + Math.random() * 26 });
                }
                const fill = Math.random() > 0.5 ? p.accent1 : p.accent2;
                tileWrap(cx, () => {
                    cx.fillStyle = fill;
                    for (const lb of lobes) {
                        cx.beginPath(); cx.arc(S / 2 - lb.dx, cy + lb.dy, lb.r, 0, Math.PI * 2); cx.fill();
                        cx.beginPath(); cx.arc(S / 2 + lb.dx, cy + lb.dy, lb.r, 0, Math.PI * 2); cx.fill();
                    }
                });
            }
        };

        // Floor 3 — THE PANOPTICON: concentric watch-rings and sightlines
        // radiating from a central tower, scratched over with prisoner tallies.
        const drawPanopticon = (cx, p) => {
            cx.strokeStyle = p.line;
            cx.lineWidth = 3;
            for (let r = 48; r < 300; r += 52) {
                cx.beginPath(); cx.arc(S / 2, S / 2, r, 0, Math.PI * 2); cx.stroke();
            }
            cx.strokeStyle = p.accent1;
            cx.lineWidth = 2;
            for (let k = 0; k < 12; k++) {
                const a = (k / 12) * Math.PI * 2;
                cx.beginPath();
                cx.moveTo(S / 2 + Math.cos(a) * 40, S / 2 + Math.sin(a) * 40);
                cx.lineTo(S / 2 + Math.cos(a) * 300, S / 2 + Math.sin(a) * 300);
                cx.stroke();
            }
            for (let i = 0; i < 9; i++) {
                const gx = Math.random() * S, gy = Math.random() * S;
                const count = 3 + Math.floor(Math.random() * 3);
                const rot = Math.random() * Math.PI;
                tileWrap(cx, () => {
                    cx.save();
                    cx.translate(gx, gy);
                    cx.rotate(rot);
                    cx.strokeStyle = p.accent2;
                    cx.lineWidth = 2;
                    for (let t = 0; t < count; t++) {
                        cx.beginPath(); cx.moveTo(t * 6, 0); cx.lineTo(t * 6, 18); cx.stroke();
                    }
                    cx.beginPath(); cx.moveTo(-3, 14); cx.lineTo(count * 6, 4); cx.stroke();
                    cx.restore();
                });
            }
        };

        // Floor 4 — THE AMALGAMATION: no architecture at all. Branching veins
        // that taper as they split, studded with cell clusters.
        const drawAmalgamation = (cx, p) => {
            for (let i = 0; i < 16; i++) {
                const segs = [];
                let vx = Math.random() * S, vy = Math.random() * S;
                let a = Math.random() * Math.PI * 2;
                let w = 5 + Math.random() * 4;
                for (let s = 0; s < 7; s++) {
                    const nx = vx + Math.cos(a) * (16 + Math.random() * 20);
                    const ny = vy + Math.sin(a) * (16 + Math.random() * 20);
                    segs.push({ x1: vx, y1: vy, x2: nx, y2: ny, w });
                    vx = nx; vy = ny;
                    a += (Math.random() - 0.5) * 0.9;
                    w *= 0.82;
                }
                tileWrap(cx, () => {
                    cx.strokeStyle = p.line;
                    cx.lineCap = 'round';
                    for (const sg of segs) {
                        cx.lineWidth = sg.w;
                        cx.beginPath(); cx.moveTo(sg.x1, sg.y1); cx.lineTo(sg.x2, sg.y2); cx.stroke();
                    }
                });
            }
            for (let i = 0; i < 20; i++) {
                const x = Math.random() * S, y = Math.random() * S;
                const r = 6 + Math.random() * 16;
                const fill = Math.random() > 0.5 ? p.accent1 : p.accent2;
                tileWrap(cx, () => {
                    cx.fillStyle = fill;
                    cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();
                    cx.fillStyle = p.accent2;
                    cx.beginPath(); cx.arc(x + r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2); cx.fill();
                });
            }
        };

        // Floor 5 — THE ARCHITECT: the only floor that is drafted rather than
        // decayed. Fine construction grid, layout circles, registration ticks.
        const drawArchitect = (cx, p) => {
            cx.strokeStyle = p.line;
            cx.lineWidth = 1;
            for (let i = 0; i <= S; i += 64) {
                cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, S); cx.stroke();
                cx.beginPath(); cx.moveTo(0, i); cx.lineTo(S, i); cx.stroke();
            }
            cx.strokeStyle = p.accent2;
            cx.lineWidth = 1;
            cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(S, S); cx.stroke();
            cx.beginPath(); cx.moveTo(S, 0); cx.lineTo(0, S); cx.stroke();

            cx.strokeStyle = p.accent1;
            cx.lineWidth = 1.5;
            const rings = [[128, 128, 70], [384, 384, 70], [128, 384, 44], [384, 128, 44], [256, 256, 100]];
            for (const [rx, ry, rr] of rings) {
                tileWrap(cx, () => {
                    cx.beginPath(); cx.arc(rx, ry, rr, 0, Math.PI * 2); cx.stroke();
                });
            }
            cx.strokeStyle = p.line;
            cx.lineWidth = 2;
            for (let i = 0; i <= S; i += 128) {
                cx.beginPath(); cx.moveTo(i - 6, 0); cx.lineTo(i + 6, 0); cx.stroke();
                cx.beginPath(); cx.moveTo(0, i - 6); cx.lineTo(0, i + 6); cx.stroke();
            }
        };

        const motifs = [drawWastes, drawDivide, drawPanopticon, drawAmalgamation, drawArchitect];

        for (let b = 0; b < 5; b++) {
            const c = document.createElement('canvas');
            c.width = S;
            c.height = S;
            const cx = c.getContext('2d');

            const p = biomes[b];
            cx.fillStyle = p.bg;
            cx.fillRect(0, 0, S, S);

            motifs[b](cx, p);

            patterns.push(this.ctx.createPattern(c, 'repeat'));
        }
        return patterns;
    }

    /**
     * Patch 96 — THE RECURSION overlay: the sixth pattern.
     *
     * Composited over whichever biome is showing on floors 6+, at an alpha that rises
     * with the cycle (drawWorldItems). The point is that a returning biome must not
     * read as "the same floor again" but as that floor being OVERWRITTEN — so this is
     * deliberately the Architect's own language, blueprint linework and fracture lines,
     * bleeding through the earlier floors it now contains.
     *
     * Built ONCE at construction, exactly like cachedFloorPatterns, and reused by every
     * endless floor forever. That is the whole memory story: depth changes the alpha
     * this is drawn at, never the number of cached canvases.
     *
     * Transparent background, not a filled one — it is an overlay, so the biome under
     * it has to survive. Same 512px tileWrap seam discipline as the five biomes: the
     * pattern repeats across an 8000px fill, so anything clipped at a tile edge would
     * print a visible grid over the entire floor. All randomness is sampled OUTSIDE the
     * tileWrap callback, or the nine copies disagree and the wrap achieves nothing.
     */
    generateRecursionPattern() {
        const S = 512;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const cx = c.getContext('2d');

        const tileWrap = (fn) => {
            for (let ox = -1; ox <= 1; ox++) {
                for (let oy = -1; oy <= 1; oy++) {
                    cx.save();
                    cx.translate(ox * S, oy * S);
                    fn();
                    cx.restore();
                }
            }
        };

        // Blueprint grid — the construct's underlying drawing, showing through.
        cx.strokeStyle = 'rgba(184, 134, 11, 0.35)';
        cx.lineWidth = 1;
        for (let i = 0; i <= S; i += 64) {
            cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, S); cx.stroke();
            cx.beginPath(); cx.moveTo(0, i); cx.lineTo(S, i); cx.stroke();
        }

        // Heavier construction lines on the 256 divisions, so the grid has a hierarchy
        // rather than reading as graph paper.
        cx.strokeStyle = 'rgba(197, 160, 89, 0.5)';
        cx.lineWidth = 2;
        for (let i = 0; i <= S; i += 256) {
            cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, S); cx.stroke();
            cx.beginPath(); cx.moveTo(0, i); cx.lineTo(S, i); cx.stroke();
        }

        // Fracture lines: the geometry failing where it has been drawn over itself too
        // many times. Points are computed up front, outside tileWrap, for the reason
        // in the doc comment.
        for (let i = 0; i < 10; i++) {
            const pts = [];
            let px = Math.random() * S, py = Math.random() * S;
            let a = Math.random() * Math.PI * 2;
            pts.push([px, py]);
            for (let s = 0; s < 6; s++) {
                a += (Math.random() - 0.5) * 1.6;
                px += Math.cos(a) * (18 + Math.random() * 30);
                py += Math.sin(a) * (18 + Math.random() * 30);
                pts.push([px, py]);
            }
            tileWrap(() => {
                cx.strokeStyle = 'rgba(230, 200, 140, 0.42)';
                cx.lineWidth = 1.2;
                cx.beginPath();
                cx.moveTo(pts[0][0], pts[0][1]);
                for (let k = 1; k < pts.length; k++) cx.lineTo(pts[k][0], pts[k][1]);
                cx.stroke();
            });
        }

        // Survey marks at the fracture origins — the construct measuring its own damage.
        for (let i = 0; i < 7; i++) {
            const mx = Math.random() * S, my = Math.random() * S;
            const r = 5 + Math.random() * 7;
            tileWrap(() => {
                cx.strokeStyle = 'rgba(197, 160, 89, 0.55)';
                cx.lineWidth = 1;
                cx.beginPath(); cx.arc(mx, my, r, 0, Math.PI * 2); cx.stroke();
                cx.beginPath(); cx.moveTo(mx - r - 4, my); cx.lineTo(mx + r + 4, my); cx.stroke();
                cx.beginPath(); cx.moveTo(mx, my - r - 4); cx.lineTo(mx, my + r + 4); cx.stroke();
            });
        }

        return this.ctx.createPattern(c, 'repeat');
    }

    generateNoisePattern() {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const cx = c.getContext('2d');
        const imgData = cx.createImageData(128, 128);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const val = Math.random() * 255;
            imgData.data[i] = val;     
            imgData.data[i+1] = val;   
            imgData.data[i+2] = val;   
            imgData.data[i+3] = 35;    
        }
        cx.putImageData(imgData, 0, 0);
        return c;
    }

    generateFogClouds() {
        let clouds = [];
        for(let i=0; i<30; i++) {
            clouds.push({
                x: Math.random() * 2000,
                y: Math.random() * 2000,
                r: 150 + Math.random() * 300,
                vx: (Math.random() - 0.5) * 1.5,
                vy: (Math.random() - 0.5) * 1.5,
                // Patch 36: per-cloud density and drift phase. Every cloud
                // previously rendered at one flat shared alpha, so the bank read
                // as a single uniform sheet with no depth to it.
                density: 0.35 + Math.random() * 0.65,
                phase: Math.random() * Math.PI * 2,
                driftRate: 0.004 + Math.random() * 0.01
            });
        }
        return clouds;
    }

    // Patch 36: atmosphere is per-floor, matching the biome identities Patch 35
    // gave the ground. Before this, darkness was a single flat '#010102' and fog
    // a single grey-blue on every floor — which flattened those biomes straight
    // back out the moment the lighting mask went down, since the mask covers far
    // more screen area than the floor texture ever shows through.
    //
    // Floor 2 deliberately keeps the original values: the Divide is the stark
    // grayscale floor, so "no tint" IS its identity.
    getAtmosphere(floor) {
        // Patch 96: was `min(floor, 5) - 1`, so every endless floor inherited the
        // Architect's atmosphere. Now the five come round with the cycle, and depth is
        // expressed by DEEPENING each one rather than by inventing new ones.
        const base = [
            { dark: '#0a0704', fog: '190, 172, 150', haze: 0.50 }, // 1 Wastes: warm dust
            { dark: '#010102', fog: '200, 210, 220', haze: 0.50 }, // 2 Divide: unchanged
            { dark: '#0b0202', fog: '215, 165, 165', haze: 0.55 }, // 3 Panopticon: blood haze
            { dark: '#020803', fog: '170, 205, 175', haze: 0.58 }, // 4 Amalgamation: spore bloom
            { dark: '#000000', fog: '205, 190, 150', haze: 0.42 }  // 5 Architect: gold dust, true black
        ][paletteIndexForFloor(floor)];

        // Cycle I returns the object above untouched — same reference shape, same
        // values, so floors 1-5 are unchanged to the byte.
        const grade = cycleGrade(floor);
        if (!grade) return base;

        // Patch 100: the fog takes the CYCLE'S colour rather than the biome's, which is
        // what ties the air to the floor wash — the two are the largest areas of colour
        // on screen, and they have to agree or the grade reads as a filter sitting on
        // top of the world instead of a property of it.
        //
        // `dark` and `fog` are plain fillStyle strings and `haze` a plain number; none
        // is ever used as a sprite-cache key, so unlike the enemy tints these can vary
        // freely without touching the cache-growth budget. Capped by visualCycle anyway.
        const darker = base.dark.replace(/^#([0-9a-f]{6})$/i, (_, hex) => {
            const ch = [0, 2, 4].map(i => {
                const v = Math.round(parseInt(hex.slice(i, i + 2), 16) * grade.darkScale);
                return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
            });
            return `#${ch.join('')}`;
        });
        return {
            dark: darker,
            fog: grade.fog,
            haze: Math.min(0.75, base.haze + 0.04 * (visualCycle(floor) - 1))
        };
    }

    drawMenuBackground(time, gameState) {
        if (gameState === 'TITLE') {
            // Patch 162: the cover scene paints every pixel itself; grain is lighter
            // over it, and off on LOW like the in-run grain.
            this.drawTitleScene(time);
            if (this.filmGrainEnabled !== false) { this.ctx.globalAlpha = 0.45; this.drawFilmGrain(); this.ctx.globalAlpha = 1; }
            return;
        }
        this.ctx.fillStyle = `rgba(139, 0, 0, ${0.05 + Math.sin(time * 0.001) * 0.02})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (gameState === 'MENU') this.drawMenuStorm(time);
        this.drawFilmGrain();
    }

    /**
     * Patch 162: the title screen is the store cover, alive. It replaces the red fog,
     * spinning outlines and embers (Patch 52) with the covers' composition, so a player
     * who clicked the cover lands in the same picture:
     *   - the Panopticon's eye, huge and dim, looming behind the title and following
     *     the light;
     *   - the Subject at the bottom edge, its flashlight beam sweeping slowly upward;
     *   - pairs of eyes blinking open in the dark at the edges, which shut when the
     *     beam finds them; dust that only shows inside the beam;
     *   - the floor-3 rings very faint underneath, a vignette and light grain.
     * Everything static is a sprite built once (the drawGlow pattern; the vignette is
     * rebuilt only when the canvas size changes); a frame is ~10 drawImage calls plus
     * a few dozen fillRects. No shadowBlur, composite reset before returning, nothing
     * read back. `titleAnchor` ({x, y, w}: the DOM title's centre and width in canvas
     * pixels) is written by main.js; without it the eye sits in the upper third.
     */
    titleSceneSprites() {
        if (this._title) return this._title;
        const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; };
        const t = {};
        // the eye's body (no iris): spikes, rim, sclera and veins, at 512 px
        t.eye = mk(512, 512, (c, w) => {
            const r = w * 0.27;
            c.translate(w / 2, w / 2);
            c.fillStyle = '#7a1630';
            for (let i = 0; i < 12; i++) {
                const a = i / 12 * Math.PI * 2, L = r * (i % 2 ? 1.45 : 1.8);
                c.beginPath();
                c.moveTo(Math.cos(a - 0.17) * r * 0.9, Math.sin(a - 0.17) * r * 0.9);
                c.lineTo(Math.cos(a) * L, Math.sin(a) * L);
                c.lineTo(Math.cos(a + 0.17) * r * 0.9, Math.sin(a + 0.17) * r * 0.9);
                c.closePath(); c.fill();
                if (i % 2 === 0) { c.beginPath(); c.arc(Math.cos(a) * L, Math.sin(a) * L, r * 0.05, 0, Math.PI * 2); c.fillStyle = '#c23a5c'; c.fill(); c.fillStyle = '#7a1630'; }
            }
            c.beginPath(); c.arc(0, 0, r * 1.06, 0, Math.PI * 2); c.fillStyle = '#5c0f24'; c.fill();
            c.lineWidth = r * 0.05; c.strokeStyle = '#c23a5c'; c.stroke();
            const g = c.createRadialGradient(0, -r * 0.2, r * 0.1, 0, 0, r * 0.92);
            g.addColorStop(0, '#d9b8bf'); g.addColorStop(1, '#8a5b66');
            c.beginPath(); c.arc(0, 0, r * 0.92, 0, Math.PI * 2); c.fillStyle = g; c.fill();
            c.strokeStyle = 'rgba(150, 30, 60, 0.55)'; c.lineWidth = r * 0.025;
            for (let i = 0; i < 7; i++) {
                const a = -Math.PI * 0.85 + i * 0.28;
                c.beginPath(); c.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
                c.quadraticCurveTo(Math.cos(a + 0.12) * r * 0.62, Math.sin(a + 0.12) * r * 0.62, Math.cos(a + 0.05) * r * 0.48, Math.sin(a + 0.05) * r * 0.48);
                c.stroke();
            }
        });
        t.eyeR = 512 * 0.27;   // sclera radius inside the sprite
        // a soft red bloom behind the eye, a warm one for the flashlight lens
        const glow = (rgb) => mk(256, 256, (c, w) => {
            const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
            g.addColorStop(0, `rgba(${rgb}, 1)`); g.addColorStop(0.35, `rgba(${rgb}, 0.35)`); g.addColorStop(1, `rgba(${rgb}, 0)`);
            c.fillStyle = g; c.fillRect(0, 0, w, w);
        });
        t.redGlow = glow('150, 10, 40');
        t.warmGlow = glow('255, 236, 200');
        // the beam: a wedge pointing up from the bottom centre, bright at the lens
        t.beam = mk(512, 1024, (c, w, h) => {
            const g = c.createRadialGradient(w / 2, h, 0, w / 2, h, h);
            g.addColorStop(0, 'rgba(255, 236, 200, 0.85)'); g.addColorStop(0.45, 'rgba(255, 225, 180, 0.32)');
            g.addColorStop(0.85, 'rgba(255, 215, 170, 0.06)'); g.addColorStop(1, 'rgba(255, 215, 170, 0)');
            c.beginPath(); c.moveTo(w / 2, h); c.lineTo(0, 0); c.lineTo(w, 0); c.closePath();
            c.fillStyle = g; c.fill();
        });
        t.beamHalf = Math.atan2(256, 1024);   // the wedge's half-angle
        this._title = t;
        return t;
    }

    titleVignette(W, H) {
        const v = this._titleVig;
        if (v && v.width === W && v.height === H) return v;
        const c = (v && v.getContext) ? v : document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        const g = x.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.45, Math.hypot(W, H) * 0.62);
        g.addColorStop(0, 'rgba(0, 0, 0, 0)'); g.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        this._titleVig = c;
        return c;
    }

    /**
     * Patch 163: the creatures, as sprites built once (64 px, facing +x). Same
     * silhouettes as the game's own: the Janitor's hunch and sack with one yellow eye,
     * the Hall Monitor's long low body on thin legs with red eyes, and a Photocopy (a
     * sheet with a folded corner and two holes for eyes).
     */
    titleCreatureSprites() {
        if (this._titleMobs) return this._titleMobs;
        const mk = (draw) => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d'); x.translate(32, 32); draw(x); return c; };
        this._titleMobs = [
            mk(c => {   // Janitor
                c.fillStyle = '#1a1c1a';
                c.beginPath(); c.ellipse(-9, 6, 11, 9, 0.3, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(-14, 2, 7, 5.5, 0.2, 0, Math.PI * 2); c.fill();
                c.fillStyle = '#2f332f';
                c.beginPath(); c.moveTo(13, 4); c.quadraticCurveTo(10, -11, 2, -9); c.quadraticCurveTo(-6, -6, -9, 0);
                c.quadraticCurveTo(-8, 6, -2, 8); c.quadraticCurveTo(6, 9, 13, 4); c.closePath(); c.fill();
                c.strokeStyle = '#4a4f4a'; c.lineWidth = 1.2; c.stroke();
            }),
            mk(c => {   // Hall Monitor
                c.strokeStyle = '#3a2228'; c.lineWidth = 2;
                for (const s of [-1, 1]) for (const k of [-6, 5]) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 4, s * 13); c.lineTo(k + 9, s * 15); c.stroke(); }
                c.fillStyle = '#2b1a1f';
                c.beginPath(); c.ellipse(0, 0, 17, 6, 0, 0, Math.PI * 2); c.fill();
                c.beginPath(); c.ellipse(16, 0, 6, 5, 0, 0, Math.PI * 2); c.fill();
                c.strokeStyle = '#5a3540'; c.lineWidth = 1.2; c.beginPath(); c.ellipse(0, 0, 17, 6, 0, 0, Math.PI * 2); c.stroke();
            }),
            mk(c => {   // Photocopy
                c.rotate(Math.PI / 2);
                c.fillStyle = '#b9b2a4';
                c.beginPath(); c.moveTo(-10, -14); c.lineTo(5, -14); c.lineTo(10, -9); c.lineTo(10, 14); c.lineTo(-10, 14); c.closePath(); c.fill();
                c.fillStyle = '#8c8577'; c.beginPath(); c.moveTo(5, -14); c.lineTo(5, -9); c.lineTo(10, -9); c.closePath(); c.fill();
                c.fillStyle = 'rgba(60, 56, 50, 0.6)'; for (let i = 0; i < 4; i++) c.fillRect(-7, 2 + i * 3, 12 - (i % 2) * 4, 1);
                c.fillStyle = '#1a1714'; c.fillRect(-6, -7, 4, 4); c.fillRect(2, -7, 4, 4);
            })
        ];
        return this._titleMobs;
    }

    drawTitleScene(time) {
        const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
        if (!(W > 0 && H > 0)) return;
        const S = this.titleSceneSprites();
        const MOBS = this.titleCreatureSprites();
        const m = Math.min(W, H);
        const A = this.titleAnchor;
        const calm = !!this.calmMotion;
        const t = Number.isFinite(time) ? time : 0;
        // Patch 163: a little world with its own clock. dt is clamped so a tab coming
        // back from the background does not fast-forward the creatures.
        const ts = this._ts || (this._ts = { last: t, mobs: [], parts: [], beam: null, nextSpawn: t + 400, hurt: 0 });
        const dt = Math.max(0, Math.min(50, t - ts.last));
        ts.last = t;
        const sc = Math.max(1.15, Math.min(2.4, m / 300));   // creature scale

        // the camera breathes: a slow drift of a few px over everything but the vignette
        const camX = calm ? 0 : Math.sin(t * 0.00013) * 6, camY = calm ? 0 : Math.cos(t * 0.00011) * 4;

        ctx.fillStyle = '#050304';
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.translate(camX, camY);
        const floor = this.cachedFloorPatterns && this.cachedFloorPatterns[2];
        if (floor && this.quality !== 'low') {
            const off = (t * 0.006) % 400;
            ctx.save(); ctx.translate(0, off - 400);
            ctx.globalAlpha = 0.18; ctx.fillStyle = floor; ctx.fillRect(-20, -20, W + 40, H + 440);
            ctx.restore(); ctx.globalAlpha = 1;
        }

        // --- layout: the eye above the title, the Subject pacing the bottom edge ---------
        const tx = A && Number.isFinite(A.x) ? A.x : W / 2;
        const ty = A && Number.isFinite(A.y) ? A.y : H * 0.3;
        const eyeR = Math.max(60, Math.min(W * 0.36, H * 0.24, (A && A.w > 0 ? A.w * 0.42 : W * 0.3)));
        const ex = tx, ey = Math.max(ty - eyeR * 0.42, eyeR * 0.3);
        const hy = H - Math.max(16, m * 0.04);
        const hx = W / 2 + Math.sin(t * 0.00021) * Math.min(W * 0.2, 170);
        const toEye = Math.atan2(ey - hy, ex - hx);
        const beamLen = Math.hypot(ex - hx, ey - hy) * 1.08;

        // --- the beam hunts: it turns toward the nearest creature in front of it, else sweeps
        let target = null, best = Infinity;
        for (const c of ts.mobs) {
            if (c.dead) continue;
            const d = Math.hypot(c.x - hx, c.y - hy);
            if (c.y < hy - 10 && d < beamLen * 1.1 && d < best && c.x > -20 && c.x < W + 20 && c.y > -20) { best = d; target = c; }
        }
        const idle = toEye + (calm ? 0.18 : 0.38) * Math.sin(t * 0.00028);
        const want = target ? Math.atan2(target.y - hy, target.x - hx) : idle;
        if (ts.beam === null) ts.beam = idle;
        let da = Math.atan2(Math.sin(want - ts.beam), Math.cos(want - ts.beam));
        const turn = (calm ? 0.9 : 2.0) * dt / 1000;
        ts.beam += Math.max(-turn, Math.min(turn, da));
        ts.beam = Math.max(-Math.PI + 0.2, Math.min(-0.2, ts.beam));
        const ang = ts.beam;
        const inBeam = (x, y) => {
            const d = Math.hypot(x - hx, y - hy);
            if (d > beamLen) return false;
            let a = Math.atan2(y - hy, x - hx) - ang;
            a = Math.atan2(Math.sin(a), Math.cos(a));
            return Math.abs(a) < S.beamHalf * 0.9;
        };

        // --- the eye, with a heartbeat ------------------------------------------------------
        const beat = (p => Math.exp(-p * 9) + 0.6 * Math.exp(-Math.max(0, p - 0.22) * 9) * (p > 0.22 ? 1 : 0))((t % 1600) / 1600);
        const pulse = calm ? 0.3 : beat;
        ctx.globalAlpha = 0.45 + 0.25 * pulse;
        const gr = eyeR * (2.6 + 0.15 * pulse);
        ctx.drawImage(S.redGlow, ex - gr, ey - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
        const cyc = (t % 7000) / 180;
        const lid = (!calm && cyc < 1) ? Math.sin(cyc * Math.PI) : 0;
        const k = eyeR / S.eyeR * (1 + 0.02 * pulse), size = 512 * k;
        ctx.save();
        ctx.translate(ex - camX * 0.5, ey - camY * 0.5);   // the eye drifts half as much: depth
        ctx.scale(1, 1 - 0.92 * lid);
        ctx.globalAlpha = 0.4;
        ctx.drawImage(S.eye, -size / 2, -size / 2, size, size);
        const lookX = hx + Math.cos(ang) * beamLen - ex, lookY = hy + Math.sin(ang) * beamLen - ey;
        const ld = Math.hypot(lookX, lookY) || 1, reach = eyeR * 0.3 * Math.min(1, ld / (eyeR * 2));
        const ix = lookX / ld * reach, iy = lookY / ld * reach;
        ctx.globalAlpha = 0.6 + 0.15 * pulse;
        ctx.fillStyle = '#b3123c';
        ctx.beginPath(); ctx.arc(ix, iy, eyeR * 0.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2a030b';
        const pupil = 0.3 - 0.06 * pulse;   // the pupil tightens on each beat
        ctx.beginPath(); ctx.ellipse(ix * 1.08, iy * 1.08, eyeR * pupil, eyeR * 0.17, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255, 220, 230, 0.55)';
        ctx.beginPath(); ctx.ellipse(ix + eyeR * 0.22, iy + eyeR * 0.2, eyeR * 0.1, eyeR * 0.06, -0.3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;

        // --- lurkers: eyes that only watch, at the edges ------------------------------------------
        if (!this._lurkers) this._lurkers = Array.from({ length: 6 }, (_, i) => ({ born: -i * 900, life: 0, x: 0, y: 0, s: 1, shut: 0 }));
        for (const L of this._lurkers) {
            const age = t - L.born;
            if (age < 0) continue;
            if (age > L.life || !(L.life > 0)) {
                const side = Math.random() < 0.5 ? -1 : 1;
                const span = W * 0.5 - Math.min(W * 0.3, 260);
                L.x = W / 2 + side * (W * 0.5 - Math.random() * Math.max(30, span) - 14);
                L.y = H * (0.1 + Math.random() * 0.7);
                L.s = 0.8 + Math.random() * 0.7; L.born = t + Math.random() * 1500; L.life = 2600 + Math.random() * 3200; L.shut = 0;
                continue;
            }
            if (inBeam(L.x, L.y)) L.shut = Math.min(1, L.shut + 0.12);
            const fade = Math.min(1, age / 500, (L.life - age) / 500) * (1 - L.shut);
            if (fade <= 0.01) continue;
            const r = Math.max(1.6, m * 0.0034) * L.s, gap = r * 2.6;
            const blink = (!calm && ((age + L.x * 7) % 2300) < 110) ? 0.2 : 1;
            ctx.globalAlpha = fade * 0.22;
            ctx.drawImage(S.warmGlow, L.x - gap * 2.4, L.y - gap * 1.6, gap * 4.8, gap * 3.2);
            ctx.globalAlpha = fade * 0.95;
            ctx.fillStyle = '#f2d15a';
            ctx.beginPath();
            ctx.ellipse(L.x - gap, L.y, r * 1.15, r * 0.7 * blink, 0.18, 0, Math.PI * 2);
            ctx.ellipse(L.x + gap, L.y, r * 1.15, r * 0.7 * blink, -0.18, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // --- the creatures: they come out of the dark for the Subject; the light burns them
        const maxMobs = Math.max(7, Math.min(12, Math.round(W * H / 60000)));
        if (t >= ts.nextSpawn && ts.mobs.filter(c => !c.dead).length < maxMobs) {
            ts.nextSpawn = t + 300 + Math.random() * 700;
            const edge = Math.random();
            let x, y;
            if (edge < 0.4) { x = -30; y = H * (0.3 + Math.random() * 0.6); }
            else if (edge < 0.8) { x = W + 30; y = H * (0.3 + Math.random() * 0.6); }
            else { x = W * (0.05 + Math.random() * 0.9); y = -30; }
            const kind = Math.random() < 0.5 ? 0 : (Math.random() < 0.6 ? 1 : 2);
            const reuse = ts.mobs.find(c => c.dead);
            const c = reuse || {};
            Object.assign(c, { x, y, kind, dead: false, burn: 0, seed: Math.random() * 100,
                v: (kind === 1 ? 46 : kind === 2 ? 30 : 36) * sc * (0.8 + Math.random() * 0.4), face: 0 });
            if (!reuse) ts.mobs.push(c);
        }
        const burst = (x, y, col, n) => {
            for (let i = 0; i < n; i++) {
                const a = Math.random() * Math.PI * 2, sp = (40 + Math.random() * 140) * sc;
                const p = ts.parts.find(q => q.life <= 0) || (ts.parts.length < 120 ? (ts.parts[ts.parts.length] = {}) : null);
                if (!p) return;
                Object.assign(p, { x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, life: 500 + Math.random() * 500, max: 1000, c: col });
            }
        };
        const EYE = ['#d8d84a', '#ff4a5a', '#2a2420'];
        for (const c of ts.mobs) {
            if (c.dead) continue;
            const dx = hx - c.x, dy = hy - c.y, d = Math.hypot(dx, dy) || 1;
            const lit = inBeam(c.x, c.y);
            // toward the Subject, weaving; pushed back while the light is on them
            const wob = Math.sin(t * 0.003 + c.seed) * 0.55;
            const ux = dx / d, uy = dy / d;
            const dirX = ux - uy * wob, dirY = uy + ux * wob;
            const sp = c.v * (lit ? -0.45 : 1) * dt / 1000;
            c.x += dirX * sp; c.y += dirY * sp;
            c.face = Math.atan2(dirY, dirX);
            if (lit) c.burn += dt; else c.burn = Math.max(0, c.burn - dt * 0.5);
            const caught = d < 26 * sc;
            if (c.burn > 750 || caught) {
                c.dead = true;
                burst(c.x, c.y, c.kind === 2 ? '#d8d2c4' : '#ffe2b0', calm ? 8 : 16);
                burst(c.x, c.y, '#2a2226', 6);
                if (caught) ts.hurt = 1;
                continue;
            }
            const jitter = lit && !calm ? (Math.random() - 0.5) * 2 * Math.min(1, c.burn / 300) : 0;
            const s = 64 * sc * 0.75;
            ctx.save();
            ctx.translate(c.x + jitter, c.y + jitter);
            ctx.rotate(c.face);
            ctx.globalAlpha = lit ? 1 : 0.5;
            ctx.drawImage(MOBS[c.kind], -s / 2, -s / 2, s, s);
            if (lit) {   // scorched: the light whitens them as it burns
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = Math.min(0.8, c.burn / 900);
                ctx.drawImage(MOBS[c.kind], -s / 2, -s / 2, s, s);
                ctx.globalCompositeOperation = 'source-over';
            }
            // their eyes always show: that is how you see them coming
            ctx.globalAlpha = 1;
            ctx.fillStyle = EYE[c.kind];
            const e = 1.6 * sc;
            if (c.kind === 0) { ctx.fillRect(8 * sc * 0.75 - e / 2, -e / 2, e, e); }
            else if (c.kind === 1) { ctx.fillRect(13 * sc * 0.75, -3 * sc * 0.75 - e / 2, e, e); ctx.fillRect(13 * sc * 0.75, 2 * sc * 0.75 - e / 2, e, e); }
            ctx.restore();
        }
        ctx.globalAlpha = 1;

        // --- the beam (additive), dust in it, sparks, the Subject ---------------------------------
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.translate(hx, hy);
        ctx.rotate(ang + Math.PI / 2);
        ctx.globalAlpha = 0.42 + (target ? 0.08 : 0);
        const bw = beamLen * Math.tan(S.beamHalf) * 2;
        ctx.drawImage(S.beam, -bw / 2, -beamLen, bw, beamLen);
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (!this._titleDust) this._titleDust = Array.from({ length: 40 }, (_, i) => ({ x: Math.random(), y: Math.random(), v: 0.4 + Math.random(), p: i }));
        ctx.fillStyle = '#ffe9c8';
        for (const d of this._titleDust) {
            const x = ((d.x * W + t * 0.006 * d.v) % W + W) % W;
            const y = ((d.y * H - t * 0.012 * d.v) % H + H) % H;
            if (!inBeam(x, y)) continue;
            ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 0.002 + d.p);
            const s = 1 + (d.p % 2);
            ctx.fillRect(x, y, s, s);
        }
        for (const p of ts.parts) {
            if (!(p.life > 0)) continue;
            p.life -= dt; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vx *= 0.96; p.vy = p.vy * 0.96 + 40 * dt / 1000;
            if (p.c === '#2a2226') continue;   // the dark half of a burst is drawn below, normally
            ctx.globalAlpha = Math.max(0, p.life / p.max);
            ctx.fillStyle = p.c;
            ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
        }
        ctx.globalAlpha = 0.9;
        const lens = Math.max(16, m * 0.05);
        ctx.drawImage(S.warmGlow, hx + Math.cos(ang) * lens * 0.4 - lens, hy + Math.sin(ang) * lens * 0.4 - lens, lens * 2, lens * 2);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        for (const p of ts.parts) {
            if (!(p.life > 0) || p.c !== '#2a2226') continue;
            ctx.globalAlpha = Math.max(0, p.life / p.max) * 0.8;
            ctx.fillStyle = p.c;
            ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        }
        ctx.globalAlpha = 1;
        // the Subject: a flinch ring when something reaches it
        ts.hurt = Math.max(0, ts.hurt - dt / 600);
        const pr = Math.max(9, m * 0.024);
        ctx.fillStyle = '#151724';
        ctx.beginPath(); ctx.arc(hx, hy, pr, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = Math.max(1.5, pr * 0.14);
        ctx.strokeStyle = ts.hurt > 0 ? `rgba(220, 60, 80, ${0.4 + 0.6 * ts.hurt})` : '#3c4260';
        ctx.stroke();
        ctx.fillStyle = '#d8d2c4';
        ctx.fillRect(hx + Math.cos(ang) * pr * 0.8 - 2, hy + Math.sin(ang) * pr * 0.8 - 2, 4, 4);
        ctx.restore();   // camera drift

        // vignette last (cached; rebuilt only on resize)
        ctx.drawImage(this.titleVignette(W, H), 0, 0);
    }

    drawMenuStorm(time) {
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (Math.random() < 0.01) { 
            this.lightningFlash = 1.0;
        }
        
        if (this.lightningFlash > 0) {
            this.ctx.fillStyle = `rgba(200, 220, 255, ${this.lightningFlash * 0.15})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.lightningFlash -= 0.05;
        }

        this.ctx.strokeStyle = 'rgba(150, 180, 200, 0.1)';
        this.ctx.lineWidth = 1.5;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        for (let i = 0; i < this.rain.length; i++) {
            let p = this.rain[i];
            this.ctx.moveTo(p.x, p.y);
            this.ctx.lineTo(p.x - p.l * 0.2, p.y + p.l);
            
            p.y += p.v;
            p.x -= p.v * 0.2; 
            
            if (p.y > this.canvas.height + 100) {
                p.y = -50;
                p.x = Math.random() * (this.canvas.width + 500);
            }
        }
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawFilmGrain() {
        this.ctx.save();
        const offsetX = (Math.random() * 128) | 0;
        const offsetY = (Math.random() * 128) | 0;
        this.ctx.fillStyle = this.cachedNoisePattern; 
        this.ctx.translate(-offsetX, -offsetY);
        this.ctx.fillRect(0, 0, this.canvas.width + 128, this.canvas.height + 128);
        this.ctx.restore();
    }

    drawHubDust(state) {
        // Each mote is a 1-3 px square, one fillRect each: the cheapest shape there is,
        // and at this size and alpha it looks the same as a disc. Patch 155 batched the
        // motes into one path of circles per band instead, and on the A56 that cost the
        // hub ~20 ms a frame (Patch 157's benchmark): a many-circle path loses the GPU's
        // simple-shape fast path. Brightness is quantised into 4 bands.
        const BANDS = 4;
        if (!this._dustBands) this._dustBands = Array.from({ length: BANDS }, () => []);
        const bands = this._dustBands;
        for (let b = 0; b < BANDS; b++) bands[b].length = 0;
        this.hubDust.forEach(dust => {
            dust.x += dust.vx;
            dust.y += dust.vy;
            dust.phase += 0.015;
            
            if (dust.x > state.player.x + 800) dust.x -= 1600;
            if (dust.x < state.player.x - 800) dust.x += 1600;
            if (dust.y > state.player.y + 800) dust.y -= 1600;
            if (dust.y < state.player.y - 800) dust.y += 1600;

            const t = (Math.sin(dust.phase) + 1) / 2;   // 0..1
            bands[Math.min(BANDS - 1, (t * BANDS) | 0)].push(dust);
        });
        this.ctx.fillStyle = '#ffffff';
        for (let b = 0; b < BANDS; b++) {
            const list = bands[b];
            if (!list.length) continue;
            this.ctx.globalAlpha = ((b + 0.5) / BANDS) * 0.5;
            for (let i = 0; i < list.length; i++) {
                const d = list[i];
                this.ctx.fillRect(d.x - d.size, d.y - d.size, d.size * 2, d.size * 2);
            }
        }
        this.ctx.globalAlpha = 1.0;
    }

    /**
     * Patch 155: the Mind Hub's glows as cached sprites (the drawGlow pattern), built
     * once each. 'glow' is the white light-mask disc, 'tint' a zone's coloured pool,
     * 'beam' the soft ceiling-light wedge in zone-local coordinates (-120..120, -350..60).
     */
    hubSprite(kind, color = '') {
        if (!this.hubSprites) this.hubSprites = new Map();
        const key = kind + color;
        let c = this.hubSprites.get(key);
        if (c) return c;
        c = document.createElement('canvas');
        const x = c.getContext('2d');
        if (kind === 'beam') {
            c.width = 120; c.height = 205;   // half scale; it is a soft gradient
            x.scale(0.5, 0.5);
            x.translate(120, 350);
            const g = x.createLinearGradient(-80, -300, 40, 50);
            g.addColorStop(0, '#ffffff');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g;
            x.beginPath();
            x.moveTo(-80, -350); x.lineTo(40, -350); x.lineTo(120, 60); x.lineTo(-120, 60);
            x.fill();
        } else {
            c.width = c.height = 128;
            const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
            if (kind === 'glow') { g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
            else { g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); }
            x.fillStyle = g;
            x.fillRect(0, 0, 128, 128);
        }
        this.hubSprites.set(key, c);
        return c;
    }

    drawGame(state, audioEngine, gameState = 'PLAYING') {
        try {
            // Patch 51d: second line of defence for a zero-area canvas (main.js's
            // resize() clamps to >= 1, but any other path that sizes the canvas gets
            // caught here too). There is nothing to draw into, and drawing INTO it
            // throws InvalidStateError at the drawImage(lightCanvas) calls below —
            // every frame, silently, until the viewport changes.
            if (!this.canvas || !this.canvas.width || !this.canvas.height) return;

            // Patch 74: advanced by however many SIMULATION steps this frame covered,
            // not by 1 per rendered frame. 84 read sites drive pulses, flickers and
            // orbit angles off this counter, so incrementing it per rendered frame ran
            // every one of those animations at the display's refresh rate — twice as
            // fast on a 120Hz phone as on the 60Hz screen they were tuned against.
            // main.js sets simStepsThisFrame; it defaults to 1 so any caller that does
            // not set it (or a paused frame) behaves exactly as before.
            this.renderFrame += Number.isFinite(this.simStepsThisFrame) ? this.simStepsThisFrame : 1;

            if (!state.bossSpawned) {
                this.hasAnnouncedBoss = false;
            }

            if (state.bossSpawned && !this.hasAnnouncedBoss) {
                this.bossAnnouncementTimer = 240; 
                this.hasAnnouncedBoss = true;
                state.hitStop = 240; 
            }

            this.ctx.fillStyle = '#000000'; 
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            // Patch 71: the camera centre, not the canvas centre. They are the same
            // value on every layout except portrait, where the centre moves up by half
            // the control band so the player is centred in the world viewport rather
            // than behind the player's own thumbs. Kept in sync with the two lightCtx
            // transforms below — all three must use the same origin or the darkness
            // mask slides off the world.
            this.ctx.save();
            this.ctx.translate(this.cameraCenterX, this.cameraCenterY);
            this.ctx.scale(this.zoom, this.zoom);
            this.ctx.translate(-state.player.x, -state.player.y);
            this.updateCullRect(state);   // Patch 112

            let curShakeX = 0, curShakeY = 0;
            if (state.cameraShake > 0) {
                curShakeX = (Math.random() - 0.5) * state.cameraShake;
                curShakeY = (Math.random() - 0.5) * state.cameraShake;
                this.ctx.translate(curShakeX, curShakeY);
            }

            if (gameState === 'HUB') {
                if (state.hubWorld) {
                    
                    const hd = this.hubDiag;
                    state.hubWorld.draw(this.ctx, state, this);
                    this.drawPlayer(state, audioEngine);

                    let fl = state.player.weapons.flashlight;
                    // CRITICAL FIX: Safe Fallbacks for non-finite values that crash Canvas API
                    let flRadius = (fl && Number.isFinite(fl.radius) && fl.radius > 0) ? fl.radius : 250;
                    let currentAngle = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;
                    let jitter = (Math.random() - 0.5) * 0.02;

                    if (hd.light) {
                    const hubLs = this.prepareLightCanvas();   // Patch 115

                    this.lightCtx.save();
                    this.lightCtx.scale(hubLs, hubLs);
                    this.lightCtx.translate(this.cameraCenterX, this.cameraCenterY);
                    this.lightCtx.scale(this.zoom, this.zoom);
                    this.lightCtx.translate(-state.player.x, -state.player.y);

                    let darkness = state.hubWorld.lightIntensity < 0.5 ? 0.95 : 0.82;
                    this.lightCtx.fillStyle = `rgba(5, 8, 12, ${darkness})`;
                    this.lightCtx.fillRect(state.player.x - 2000, state.player.y - 2000, 4000, 4000);

                    this.lightCtx.globalCompositeOperation = 'destination-out';

                    let flGrad = this.lightCtx.createRadialGradient(
                        state.player.x, state.player.y, 0, 
                        state.player.x, state.player.y, flRadius * 1.5
                    );
                    flGrad.addColorStop(0, 'rgba(255, 255, 255, 1)'); 
                    flGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.8)'); 
                    flGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    
                    this.lightCtx.fillStyle = flGrad;
                    this.lightCtx.beginPath();
                    this.lightCtx.moveTo(state.player.x, state.player.y);
                    this.lightCtx.arc(
                        state.player.x, state.player.y, flRadius * 1.5, 
                        state.player.angle - currentAngle + jitter, 
                        state.player.angle + currentAngle + jitter
                    );
                    this.lightCtx.closePath();
                    this.lightCtx.fill();

                    let pGlow = this.lightCtx.createRadialGradient(state.player.x, state.player.y, 0, state.player.x, state.player.y, 100);
                    pGlow.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
                    pGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    this.lightCtx.fillStyle = pGlow;
                    this.lightCtx.beginPath(); this.lightCtx.arc(state.player.x, state.player.y, 100, 0, Math.PI*2); this.lightCtx.fill();

                    // Patch 155: cached sprites, not four new gradients a frame.
                    if (state.hubWorld.zones && state.hubWorld.lightIntensity > 0.5) {
                        const glowSprite = this.hubSprite('glow');
                        state.hubWorld.zones.forEach(z => {
                            const r = 140 + Math.sin(this.renderFrame * 0.05 + z.x) * 5;
                            this.lightCtx.drawImage(glowSprite, z.x - r, z.y - r, r * 2, r * 2);
                        });
                    }
                    this.lightCtx.restore();

                    this.ctx.save();
                    this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
                    this.ctx.globalCompositeOperation = 'source-over';
                    this.ctx.drawImage(this.lightCanvas, 0, 0, this.canvas.width, this.canvas.height);
                    this.ctx.restore();
                    }   // hd.light

                    this.ctx.save();
                    if (hd.tints) {
                    // Patch 155: 'lighter' (additive), not 'screen'. Both brighten; on a dark
                    // room at these alphas they look alike, but 'screen' is an advanced blend
                    // that many mobile GPUs can only do by first copying what is underneath —
                    // nine times a frame here. 'lighter' is a plain fixed-function blend.
                    this.ctx.globalCompositeOperation = 'lighter';
                    
                    let flTint = this.ctx.createRadialGradient(
                        state.player.x, state.player.y, 0, 
                        state.player.x, state.player.y, flRadius * 1.5
                    );
                    flTint.addColorStop(0, 'rgba(255, 240, 200, 0.32)');
                    flTint.addColorStop(0.5, 'rgba(150, 180, 255, 0.08)');
                    flTint.addColorStop(1, 'transparent');
                    this.ctx.fillStyle = flTint;
                    this.ctx.beginPath();
                    this.ctx.moveTo(state.player.x, state.player.y);
                    this.ctx.arc(
                        state.player.x, state.player.y, flRadius * 1.5, 
                        state.player.angle - currentAngle + jitter, 
                        state.player.angle + currentAngle + jitter
                    );
                    this.ctx.closePath();
                    this.ctx.fill();

                    if (state.hubWorld.zones && state.hubWorld.lightIntensity > 0.5) {
                        const beamSprite = this.hubSprite('beam');
                        state.hubWorld.zones.forEach(z => {
                            const r = 140 + Math.sin(this.renderFrame * 0.05 + z.x) * 5;
                            this.ctx.globalAlpha = 0.32;
                            this.ctx.drawImage(this.hubSprite('tint', z.color), z.x - r, z.y - r, r * 2, r * 2);
                            this.ctx.globalAlpha = 0.12;
                            this.ctx.drawImage(beamSprite, z.x - 120, z.y - 350, 240, 410);
                        });
                        this.ctx.globalAlpha = 1;
                    }
                    this.ctx.globalCompositeOperation = 'source-over';
                    }   // hd.tints

                    if (hd.dust) this.drawHubDust(state);

                    this.ctx.restore();
                    
                } else {
                    this.ctx.fillStyle = '#0a0c11';
                    this.ctx.fillRect(state.player.x - 2000, state.player.y - 2000, 4000, 4000);
                    this.drawPlayer(state, audioEngine);
                }
            } else {
                this.drawWorldItems(state, audioEngine);
                if (this.diag.fog) this.drawFog(state);
                if (this.diag.lights) this.drawLightingMasks(state, curShakeX, curShakeY);
                if (this.diag.lights) this.drawEyesInDark(state);   // Patch 165
                this.drawObstacleOutlines(state);   // Patch 137: walls stay readable in the dark
                if (this.cbAssist) this.drawTelegraphRings(state);   // Patch 150: Colour-Blind Assist
                this.drawEffectsAndAuras(state);
                this.drawPlayer(state, audioEngine);
                this.drawDamageText(state);
                this.drawObjectivePointers(state);
            }

            this.ctx.restore(); 

            if (gameState !== 'HUB') {
                if (this.diag.vignette) this.drawVignette(state);

                // Patch 146: a defeated boss's last line, as a subtitle.
                if (state.subtitle && state.subtitle.steps > 0) {
                    try { this.drawSubtitle(state); } catch (e) { /* text only; never fatal */ }
                }

                if (this.bossAnnouncementTimer > 0) {
                    try {
                        this.drawBossAnnouncement(state);
                    } catch(e) {
                        console.warn("Recoverable Boss Intro error:", e);
                        errorLog.capture(e, 'renderer-boss-intro');
                    }
                    // Patch 114: in sim steps, matching the 240-frame hitStop it
                    // announces. Per-draw, the banner ended after ~1.7 s on a 144 Hz
                    // screen while the game stayed frozen for the full 4 s.
                    this.bossAnnouncementTimer = Math.max(0, this.bossAnnouncementTimer - this.drawSteps());
                }
                
                // Patch 165: grain at 30%. At full strength it flattened every colour.
                if (this.filmGrainEnabled !== false) { this.ctx.globalAlpha = 0.3; this.drawFilmGrain(); this.ctx.globalAlpha = 1; }
            } else if (this.filmGrainEnabled !== false) {
                // Patch 157: the hub honours the tier's film grain like gameplay does. It
                // drew this full-screen pattern pass every frame even on LOW.
                this.ctx.globalAlpha = 0.08; 
                this.drawFilmGrain();
                this.ctx.globalAlpha = 1.0;
            }

        } catch (e) {
            errorLog.capture(e, 'renderer');
            // Patch 113: once per distinct message. Every frame of a persistent fault
            // used to console.error with Chrome's full async rAF stack — the same flood
            // main.js already avoids for its own loop. ErrorLog keeps the full count.
            const key = (e && e.message) ? String(e.message) : String(e);
            if (!this._loggedRenderCrashes) this._loggedRenderCrashes = new Set();
            if (!this._loggedRenderCrashes.has(key) && this._loggedRenderCrashes.size < 20) {
                this._loggedRenderCrashes.add(key);
                console.log('CRITICAL RENDERER CRASH PREVENTED: ' + key + '\n' + ((e && e.stack) || ''));
            }
            // Patch 113 (V2 plan B5): an exception skipped every ctx.restore() between
            // where it threw and the end of the frame. The old finally only reset the
            // transform, so each failing frame leaked save() levels and could leave
            // globalCompositeOperation = 'screen' (or a lowered globalAlpha) in force
            // for the NEXT frame — where the black clear at the top of drawGame then
            // does nothing and the screen smears. Unwind both contexts to base state.
            this.recoverContexts();
        } finally {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
    }

    /**
     * Patch 113: return ctx and lightCtx to their base drawing state after a throw.
     * restore() on an empty stack is a no-op, so a bounded loop needs no depth
     * bookkeeping. NOT ctx.reset(): that would also discard base-level settings made
     * outside any save() (the Patch 67 image-smoothing setup).
     */
    recoverContexts() {
        for (const c of [this.ctx, this.lightCtx]) {
            if (!c) continue;
            try {
                for (let i = 0; i < 64; i++) c.restore();
                c.globalCompositeOperation = 'source-over';
                c.globalAlpha = 1;
                c.setTransform(1, 0, 0, 1, 0, 0);
            } catch (e) { /* a context that cannot be restored has nothing left to leak */ }
        }
    }

    drawHUD(state) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height;
        
        this.ctx.save();
        
        // 1. Sleek EXP Bar at Bottom Center
        const barW = 400;
        const barH = 14;
        const barX = cx - barW / 2;
        const barY = cy - 30;

        // EXP Bar Background
        this.ctx.fillStyle = 'rgba(10, 10, 20, 0.8)';
        this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.fillRect(barX, barY, barW, barH);
        this.ctx.strokeRect(barX, barY, barW, barH);

        // EXP Bar Fill (Faux-Glow)
        const nextXP = state.nextLevelXP || 1;
        const fillW = Math.max(0, Math.min(barW, (state.xp / nextXP) * barW));
        
        if (fillW > 0) {
            const grad = this.ctx.createLinearGradient(barX, barY, barX, barY + barH);
            grad.addColorStop(0, '#00ffff');
            grad.addColorStop(0.5, '#0088ff');
            grad.addColorStop(1, '#00ffff');
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(barX, barY, fillW, barH);
        }

        // EXP Text
        this.ctx.fillStyle = '#ffffff';
        this.ctx.font = 'bold 12px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'bottom';
        this.ctx.fillText(`LUCIDITY: ${Math.floor(state.xp)} / ${nextXP}`, cx, barY - 5);

        // 2. Boss Health Bar at Top Center
        let boss = null;
        for (let i = 0; i < state.entities.length; i++) {
            let e = state.entities[i];
            if (isBossType(e.type) && e.hp > 0) {
                boss = e;
                break;
            }
        }

        if (boss) {
            const bossW = 600;
            const bossH = 20;
            const bossX = cx - bossW / 2;
            const bossY = 30;

            this.ctx.fillStyle = 'rgba(20, 0, 0, 0.8)';
            this.ctx.strokeStyle = '#c5a059';
            this.ctx.lineWidth = 2;
            this.ctx.fillRect(bossX, bossY, bossW, bossH);
            this.ctx.strokeRect(bossX, bossY, bossW, bossH);

            const hpPercent = Math.max(0, boss.hp / boss.maxHp);
            const fillBoss = bossW * hpPercent;

            if (fillBoss > 0) {
                const bGrad = this.ctx.createLinearGradient(bossX, bossY, bossX, bossY + bossH);
                bGrad.addColorStop(0, '#ff4444');
                bGrad.addColorStop(0.5, '#8b0000');
                bGrad.addColorStop(1, '#ff4444');
                this.ctx.fillStyle = bGrad;
                this.ctx.fillRect(bossX, bossY, fillBoss, bossH);
            }

            this.ctx.fillStyle = '#c5a059';
            this.ctx.font = 'bold 16px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'bottom';
            this.ctx.fillText(boss.type, cx, bossY - 8);
        }
        
        this.ctx.restore();
    }

    drawFog(state) {
        const atmo = this.getAtmosphere(state.floor);
        // Patch 36: the original read
        //     if (state.hitStop > 0) { cloud.x += cloud.vx; ... }
        //     else                   { cloud.x += cloud.vx; ... }
        // — two IDENTICAL bodies, so the hitStop branch did nothing whatsoever.
        // Every other system freezes during hitStop (that pause is the whole
        // point of the impact feel), so the fog now actually holds with them.
        const frozen = state.hitStop > 0;
        const fogSprite = this.getFogSprite(atmo.fog);   // Patch 115
        let drawn = 0;

        this.ctx.globalAlpha = atmo.haze;
        const fogSteps = this.drawSteps();   // Patch 114: drift per sim step, not per draw
        this.fogClouds.forEach(cloud => {
            if (!frozen) {
                cloud.x += cloud.vx * fogSteps;
                cloud.y += cloud.vy * fogSteps;
                cloud.phase = (cloud.phase || 0) + (cloud.driftRate || 0.006) * fogSteps;
            }

            let dx = (cloud.x - state.player.x) % 2000;
            if (dx < -1000) dx += 2000; else if (dx > 1000) dx -= 2000;
            let dy = (cloud.y - state.player.y) % 2000;
            if (dy < -1000) dy += 2000; else if (dy > 1000) dy -= 2000;
            let drawX = state.player.x + dx;
            let drawY = state.player.y + dy;

            // Slow breathing so a stationary bank never looks like a decal.
            // Fallbacks keep NaN out of createRadialGradient/arc per the golden
            // rule, in case a cloud predates these fields.
            const breathe = 1 + Math.sin(cloud.phase || 0) * 0.12;
            const r = cloud.r * breathe;
            const core = (cloud.density || 0.5) * 0.5;
            if (!Number.isFinite(r) || r <= 0) return;

            // Patch 115 (V2 plan B7): a cached sprite instead of a live gradient. This
            // was 30 createRadialGradient + arc + fill per frame — the largest single
            // per-frame cost the Patch 66b review found. The ramp is the same three
            // stops baked at full alpha and drawn at haze * core, the drawGlow method
            // (identical for a linear ramp). Clouds wholly off screen are skipped, and
            // the low tier draws fewer of them.
            if (drawn >= this.fogCloudLimit) return;
            if (drawX + r < this.cullL || drawX - r > this.cullR ||
                drawY + r < this.cullT || drawY - r > this.cullB) return;
            drawn++;
            this.ctx.globalAlpha = atmo.haze * Math.min(1, core);
            this.ctx.drawImage(fogSprite, drawX - r, drawY - r, r * 2, r * 2);
        });
        this.ctx.globalAlpha = 1.0;
    }

    /** Patch 115: one soft fog disc per floor fog colour, baked at full alpha. */
    getFogSprite(fogRgb) {
        const key = `fog|${fogRgb}`;
        let sprite = this.spriteCache.get(key);
        if (!sprite) {
            const R = 128;
            const c = document.createElement('canvas');
            c.width = c.height = R * 2;
            const cx = c.getContext('2d');
            const g = cx.createRadialGradient(R, R, 0, R, R, R);
            g.addColorStop(0, `rgba(${fogRgb}, 1)`);
            g.addColorStop(0.55, `rgba(${fogRgb}, 0.4)`);
            g.addColorStop(1, `rgba(${fogRgb}, 0)`);
            cx.fillStyle = g;
            cx.fillRect(0, 0, R * 2, R * 2);
            sprite = { canvas: c };
            this.cacheSprite(key, sprite);
        }
        return sprite.canvas;
    }

    /**
     * Patch 115 (V2 plan B7): sizes and clears the offscreen darkness mask, and
     * returns the scale it is stored at. The mask is soft by design (penumbra, faux
     * glows), so the LOW tier keeps it at half resolution — a quarter of the fill and
     * composite cost — and drawImage scales it back up to the canvas. Callers apply
     * the returned scale before the camera transform.
     */
    prepareLightCanvas() {
        const ls = (Number.isFinite(this.lightScale) && this.lightScale > 0) ? this.lightScale : 1;
        const w = Math.max(1, Math.round(this.canvas.width * ls));
        const h = Math.max(1, Math.round(this.canvas.height * ls));
        if (this.lightCanvas.width !== w || this.lightCanvas.height !== h) {
            this.lightCanvas.width = w;
            this.lightCanvas.height = h;
        } else {
            this.lightCtx.clearRect(0, 0, w, h);
        }
        return ls;
    }

    /**
     * Patch 115 (V2 plan B7): graphics quality tier. 'high' is the game exactly as it
     * was (bar the fog sprite, which is the same image). 'low' trades soft detail for
     * frame time on weak devices. Simulation caps live on the Director and are set
     * alongside this by main.js (applyQualityTier), so the renderer stays sim-free.
     */
    setQuality(tier) {
        this.quality = tier === 'low' ? 'low' : 'high';
        const low = this.quality === 'low';
        // Patch 121: LOW's darkness mask 0.5 -> 0.35 of full resolution. A real
        // Samsung A56 (portrait, 120 Hz) ran HIGH at 25-26 fps with fog, darkness,
        // vignette and grain on, and 60 fps with them off.
        this.lightScale = low ? 0.35 : 1;
        this.fogCloudLimit = low ? 12 : 30;
        this.filmGrainEnabled = !low;
    }

    drawLightingMasks(state, curShakeX, curShakeY) {
        const ls = this.prepareLightCanvas();   // Patch 115

        this.lightCtx.save();
        this.lightCtx.scale(ls, ls);
        this.lightCtx.translate(this.cameraCenterX, this.cameraCenterY);
        this.lightCtx.scale(this.zoom, this.zoom);
        this.lightCtx.translate(-state.player.x, -state.player.y);
        if (state.cameraShake > 0) this.lightCtx.translate(curShakeX, curShakeY);

        // Patch 36: per-floor darkness (see getAtmosphere) rather than one flat
        // near-black everywhere.
        this.lightCtx.fillStyle = this.getAtmosphere(state.floor).dark;
        this.lightCtx.fillRect(state.player.x - 3000, state.player.y - 3000, 6000, 6000);

        this.lightCtx.globalCompositeOperation = 'destination-out';

        if (state.interactables) {
            state.interactables.forEach(obj => {
                if (obj.active && obj.type === 'BREAKER_BOX') {
                    const boxHole = this.lightCtx.createRadialGradient(obj.x, obj.y, 10, obj.x, obj.y, obj.radius);
                    boxHole.addColorStop(0, 'rgba(255, 255, 255, 1)');
                    boxHole.addColorStop(0.7, 'rgba(255, 255, 255, 0.8)');
                    boxHole.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    this.lightCtx.fillStyle = boxHole;
                    this.lightCtx.beginPath();
                    this.lightCtx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
                    this.lightCtx.fill();
                } else if (obj.type === 'OBJECTIVE_BACKPACK') {
                    const packHole = this.lightCtx.createRadialGradient(obj.x, obj.y, 0, obj.x, obj.y, 120);
                    packHole.addColorStop(0, 'rgba(100, 255, 100, 0.5)');
                    packHole.addColorStop(1, 'rgba(100, 255, 100, 0)');
                    this.lightCtx.fillStyle = packHole;
                    this.lightCtx.beginPath();
                    this.lightCtx.arc(obj.x, obj.y, 120, 0, Math.PI * 2);
                    this.lightCtx.fill();
                } else if (obj.type === 'BREAKER_BOX' && obj.roomEvent) {
                    // Patch 138: the outage's breaker blinks through the dark, so it can be found.
                    const blink = 0.35 + 0.3 * (Math.sin(this.renderFrame * 0.3) * 0.5 + 0.5);
                    const bHole = this.lightCtx.createRadialGradient(obj.x, obj.y, 0, obj.x, obj.y, 80);
                    bHole.addColorStop(0, `rgba(255, 255, 160, ${blink})`);
                    bHole.addColorStop(1, 'rgba(255, 255, 160, 0)');
                    this.lightCtx.fillStyle = bHole;
                    this.lightCtx.beginPath();
                    this.lightCtx.arc(obj.x, obj.y, 80, 0, Math.PI * 2);
                    this.lightCtx.fill();
                } else if (obj.type === 'CHEST') {
                    // Patch 133: a chest is lit, so it is never lost in the dark.
                    const chestHole = this.lightCtx.createRadialGradient(obj.x, obj.y, 0, obj.x, obj.y, 110);
                    chestHole.addColorStop(0, 'rgba(255, 220, 140, 0.7)');
                    chestHole.addColorStop(1, 'rgba(255, 220, 140, 0)');
                    this.lightCtx.fillStyle = chestHole;
                    this.lightCtx.beginPath();
                    this.lightCtx.arc(obj.x, obj.y, 110, 0, Math.PI * 2);
                    this.lightCtx.fill();
                } else if (obj.type === 'CASE_PAGE') {
                    // Patch 144: a Case File page carries its own small light.
                    const pageHole = this.lightCtx.createRadialGradient(obj.x, obj.y, 0, obj.x, obj.y, 70);
                    pageHole.addColorStop(0, 'rgba(200, 225, 240, 0.65)');
                    pageHole.addColorStop(1, 'rgba(200, 225, 240, 0)');
                    this.lightCtx.fillStyle = pageHole;
                    this.lightCtx.beginPath();
                    this.lightCtx.arc(obj.x, obj.y, 70, 0, Math.PI * 2);
                    this.lightCtx.fill();
                } else if (obj.type === 'EXIT_ELEVATOR') {
                    const exitHole = this.lightCtx.createRadialGradient(obj.x, obj.y, 10, obj.x, obj.y, 150);
                    exitHole.addColorStop(0, 'rgba(255, 255, 255, 1)');
                    exitHole.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    this.lightCtx.fillStyle = exitHole;
                    this.lightCtx.beginPath();
                    this.lightCtx.arc(obj.x, obj.y, 150, 0, Math.PI * 2);
                    this.lightCtx.fill();
                }
            });
        }

        // Patch 135: a Crawlspace's warning ring is lit, so the tell is never hidden
        // by the dark (it is the whole counterplay).
        if (state.entities) {
            for (const ent of state.entities) {
                if (ent.type !== 'BURROWER' || ent.burrowState !== 'warning') continue;
                const g = this.lightCtx.createRadialGradient(ent.x, ent.y, 0, ent.x, ent.y, 110);
                g.addColorStop(0, 'rgba(255, 200, 140, 0.85)');
                g.addColorStop(1, 'rgba(255, 200, 140, 0)');
                this.lightCtx.fillStyle = g;
                this.lightCtx.beginPath();
                this.lightCtx.arc(ent.x, ent.y, 110, 0, Math.PI * 2);
                this.lightCtx.fill();
            }
        }

        const fl = state.player.weapons.flashlight;
        let flRadius = (fl && Number.isFinite(fl.radius) && fl.radius > 0) ? fl.radius : 250;
        let currentAngle = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;
        let ambientRad = flRadius * 0.45; 
        
        let jitter = state.sanity < 30 ? (Math.random() - 0.5) * 0.1 : 0;

        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) {
            if (this.renderFrame % 6 < 3) { currentAngle *= 1.5; }
            else { currentAngle *= 0.8; }
        }

        if (state.player.curses && state.player.curses.includes('tunnel_vision')) {
            ambientRad = 0; 
        }

        if (state.roomCleared) {
            ambientRad = 3000;
        }

        // Patch 138: a Power Outage takes the ambient light and shortens the beam.
        // The Insomniac (blackoutImmune) keeps their ambient light.
        if (state.powerOut > 0 && !state.roomCleared) {
            if (!state.player.blackoutImmune) ambientRad = 0;
            flRadius *= 0.8;
        }

        if (ambientRad > 0) {
            const ambHole = this.lightCtx.createRadialGradient(state.player.x, state.player.y, 0, state.player.x, state.player.y, ambientRad);
            ambHole.addColorStop(0, 'rgba(255, 255, 255, 1)');
            ambHole.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
            ambHole.addColorStop(1, 'rgba(255, 255, 255, 0)');
            this.lightCtx.fillStyle = ambHole;
            this.lightCtx.beginPath();
            this.lightCtx.arc(state.player.x, state.player.y, ambientRad, 0, Math.PI * 2);
            this.lightCtx.fill();
        }

        // Patch 36 — SOFT CONE EDGE. The cone was a single hard-edged wedge:
        // it had radial falloff along its length, but perfectly sharp scissor
        // cuts down both sides, which was the most artificial thing on screen.
        //
        // This is a destination-out mask, so overlapping punches compound
        // multiplicatively (remaining = product of (1 - alpha)). Drawing a few
        // progressively narrower, progressively stronger wedges therefore
        // clears the core completely while the outermost angles are only ever
        // partially cleared — an angular gradient the Canvas API cannot express
        // directly. Widest step is only 30% strength, so the cone reads as
        // having a penumbra rather than as being wider.
        const PENUMBRA_STEPS = 4;
        // Subtle bulb instability, separate from the low-sanity `jitter` above.
        // Deliberately tiny — a failing fluorescent, not a strobe.
        const flicker = 1 + Math.sin(this.renderFrame * 0.31) * 0.012
                          + Math.sin(this.renderFrame * 0.11) * 0.018;

        for (let i = 0; i < PENUMBRA_STEPS; i++) {
            const t = i / (PENUMBRA_STEPS - 1);        // 0 = widest & faintest
            const spread = currentAngle * (1.18 - t * 0.36);
            const strength = 0.30 + t * 0.70;
            const reach = flRadius * flicker * (0.94 + t * 0.06);
            if (!Number.isFinite(spread) || !Number.isFinite(reach) || reach <= 0) continue;

            const flHole = this.lightCtx.createRadialGradient(
                state.player.x, state.player.y, 10,
                state.player.x, state.player.y, reach
            );
            flHole.addColorStop(0, `rgba(255, 255, 255, ${strength})`);
            flHole.addColorStop(0.8, `rgba(255, 255, 255, ${strength * 0.9})`);
            flHole.addColorStop(1, 'rgba(255, 255, 255, 0)');

            this.lightCtx.fillStyle = flHole;
            this.lightCtx.beginPath();
            this.lightCtx.moveTo(state.player.x, state.player.y);
            this.lightCtx.arc(
                state.player.x, state.player.y, reach,
                state.player.angle - spread + jitter,
                state.player.angle + spread + jitter
            );
            this.lightCtx.closePath();
            this.lightCtx.fill();
        }

        this.lightCtx.restore();
        // KEEP (Patch 36): restore() already reverts globalCompositeOperation,
        // so this is redundant today — but this function is the codebase's
        // single highest-risk site for invisible-player bugs, and the reset is
        // made explicit so that if the save/restore pair above is ever
        // refactored away, 'destination-out' cannot silently leak onto the next
        // frame's draws.
        this.lightCtx.globalCompositeOperation = 'source-over';

        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
        // Patch 115: drawn to the full canvas — the mask may be stored at reduced size.
        // Patch 165: at DARKNESS_ALPHA, not 1. Pitch black outside the beam hid the
        // horde, the floor and the room; now the dark is dim, not blind. A Power
        // Outage and the Tunnel Vision curse still go fully dark.
        const blind = (state.powerOut > 0 && !state.roomCleared && !state.player.blackoutImmune)
            || (state.player.curses && state.player.curses.includes('tunnel_vision'));
        this.ctx.globalAlpha = blind ? 0.96 : DARKNESS_ALPHA;
        this.ctx.drawImage(this.lightCanvas, 0, 0, this.canvas.width, this.canvas.height);
        this.ctx.globalAlpha = 1;
        this.ctx.restore(); 
    }

    /**
     * Patch 165: eyes in the dark. Every regular enemy outside the beam shows a pair of
     * small bright eyes facing the player, drawn after the darkness, so a horde closing
     * in reads at a glance on a small screen. Two fillRects per enemy; no gradients.
     */
    drawEyesInDark(state) {
        // XP shards glint through the dark too: one path, one fill for all of them.
        const drops = state.xpDrops;
        if (drops && drops.length) {
            const c = this.ctx;
            const tw = this.renderFrame * 0.12;
            c.fillStyle = '#bfe6ff';
            c.beginPath();
            for (let i = 0; i < drops.length; i++) {
                const xp = drops[i];
                if (!this.inView(xp.x, xp.y)) continue;
                const r = 4 + Math.sin(tw + xp.x * 0.05) * 1.2;
                c.moveTo(xp.x, xp.y - r); c.lineTo(xp.x + r * 0.7, xp.y);
                c.lineTo(xp.x, xp.y + r); c.lineTo(xp.x - r * 0.7, xp.y);
                c.closePath();
            }
            c.fill();
        }
        // Patch 168: kill pops. A fixed ring of slots written by Game.spawnPop: a white
        // flash and an expanding ring in the dead enemy's colour, over 16 steps.
        const pops = state.pops;
        if (pops) {
            const c = this.ctx;
            for (let i = 0; i < pops.length; i++) {
                const p = pops[i];
                const age = state.frame - p.born;
                if (!(age >= 0 && age < 16) || !this.inView(p.x, p.y)) continue;
                const t = age / 16;
                if (age < 5) this.drawGlow(p.x, p.y, 26 - age * 2, '#fff6dc', 0.85 - age * 0.15);
                c.globalAlpha = 1 - t;
                c.strokeStyle = p.color;
                c.lineWidth = 3 * (1 - t) + 0.5;
                c.beginPath();
                c.arc(p.x, p.y, 8 + age * 2.4, 0, Math.PI * 2);
                c.stroke();
                // Patch 169: the body burns away: a white core shrinking, embers thrown out.
                if (age < 9) {
                    c.fillStyle = '#fffaf0';
                    c.beginPath();
                    c.arc(p.x, p.y, 11 * (1 - age / 9), 0, Math.PI * 2);
                    c.fill();
                }
                c.fillStyle = p.color;
                for (let k = 0; k < 5; k++) {
                    const ang = k * 1.2566 + i * 0.7;
                    const dist = 6 + age * (2.2 + (k % 2) * 0.9);
                    const sz = 3 * (1 - t) + 1;
                    c.fillRect(p.x + Math.cos(ang) * dist - sz / 2, p.y + Math.sin(ang) * dist - sz / 2 - age * 0.3, sz, sz);
                }
            }
            c.globalAlpha = 1;
        }
        const ents = state.entities;
        if (!ents || !ents.length) return;
        const px = state.player.x, py = state.player.y;
        const fl = state.player.weapons && state.player.weapons.flashlight;
        const flR = (fl && Number.isFinite(fl.radius)) ? fl.radius : 250;
        const flA = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;
        const pa = state.player.angle || 0;
        const blink = this.renderFrame;
        const ctx = this.ctx;
        for (let i = 0; i < ents.length; i++) {
            const e = ents[i];
            if (!e || isBossType(e.type) || e.burrowState === 'burrowed') continue;
            const dx = px - e.x, dy = py - e.y;
            const d = Math.hypot(dx, dy);
            if (!(d > 1)) continue;
            if (d < flR) {
                let diff = Math.atan2(-dy, -dx) - pa;
                while (diff < -Math.PI) diff += Math.PI * 2;
                while (diff > Math.PI) diff -= Math.PI * 2;
                if (Math.abs(diff) < flA) continue;   // lit: the sprite itself shows
            }
            if (((blink + ((e.id * 997) | 0)) % 173) < 5) continue;   // a blink
            const r = e.radius || 12;
            const ux = dx / d, uy = dy / d;
            const cx = e.x + ux * r * 0.35, cy = e.y + uy * r * 0.35;
            const sx = -uy * r * 0.34, sy = ux * r * 0.34;
            const sz = r > 16 ? 5 : 4;
            const col = EYE_COLOURS[e.type] || '#ffe9a8';
            // a soft halo first (one translucent square), then the two eyes
            this.drawGlow(e.x, e.y, r * 1.9, col, 0.2);   // cached sprite, one drawImage
            ctx.fillStyle = col;
            ctx.fillRect(cx + sx - sz / 2, cy + sy - sz / 2, sz, sz);
            ctx.fillRect(cx - sx - sz / 2, cy - sy - sz / 2, sz, sz);
        }
    }

    drawEffectsAndAuras(state) {
        const fl = state.player.weapons.flashlight;
        let flRadius = (fl && Number.isFinite(fl.radius) && fl.radius > 0) ? fl.radius : 250;
        
        if (state.player.sets && state.player.sets.insomniac >= 4) {
            const inner = flRadius;
            const outer = inner + 200;
            
            this.ctx.globalCompositeOperation = 'screen';
            const auraGrad = this.ctx.createRadialGradient(state.player.x, state.player.y, inner, state.player.x, state.player.y, outer);
            auraGrad.addColorStop(0, `rgba(255, 150, 0, ${0.15 + Math.sin(this.renderFrame * 0.1) * 0.05})`);
            auraGrad.addColorStop(0.5, 'rgba(255, 50, 0, 0.05)');
            auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            this.ctx.fillStyle = auraGrad;
            this.ctx.beginPath();
            this.ctx.arc(state.player.x, state.player.y, outer, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.globalCompositeOperation = 'source-over';
        }

        this.ctx.globalCompositeOperation = 'screen';

        if (state.entities) {
            state.entities.forEach(ent => {
                if (ent.type === 'PANOPTICON') {
                    if (ent.gazeState === 'charging' || ent.gazeState === 'sweeping') {
                        this.ctx.save();
                        this.ctx.translate(ent.x, ent.y);
                        this.ctx.rotate(ent.gazeAngle);

                        // Patch 131 (V2 plan D6): the tell IS the hitbox. Every
                        // dimension below reads ent.gazeWidth / ent.gazeRange — the
                        // values Panopticon.js tests with — so they cannot disagree.
                        const gR = ent.gazeRange || 2000;
                        if (ent.gazeState === 'charging') {
                            // Before Patch 131 this was a 10px red sliver while the beam
                            // that followed was a ±0.5 rad (57°) cone with no range limit
                            // — the player was shown about 1/100th of what would hit them.
                            // Now the whole wedge is outlined and filling in as the charge
                            // completes (0 -> full over the 45-step charge).
                            const fill = Math.max(0, Math.min(1, 1 - (ent.gazeTimer || 0) / 45));
                            const blink = 0.5 + Math.sin(this.renderFrame * 0.5) * 0.5;
                            this.ctx.globalAlpha = 0.10 + 0.22 * fill;
                            this.ctx.fillStyle = '#ff0033';
                            this.ctx.beginPath();
                            this.ctx.moveTo(0, 0);
                            this.ctx.arc(0, 0, gR * fill, -ent.gazeWidth, ent.gazeWidth);
                            this.ctx.closePath();
                            this.ctx.fill();
                            this.ctx.globalAlpha = 0.45 + 0.45 * blink;
                            this.ctx.strokeStyle = '#ff5555';
                            this.ctx.lineWidth = 2;
                            this.ctx.beginPath();
                            this.ctx.moveTo(Math.cos(-ent.gazeWidth) * gR, Math.sin(-ent.gazeWidth) * gR);
                            this.ctx.lineTo(0, 0);
                            this.ctx.lineTo(Math.cos(ent.gazeWidth) * gR, Math.sin(ent.gazeWidth) * gR);
                            this.ctx.arc(0, 0, gR, ent.gazeWidth, -ent.gazeWidth, true);
                            this.ctx.stroke();
                            this.ctx.globalAlpha = 1;

                            // Patch 40 (look only): an aperture closing at the lens.
                            const conv = (this.renderFrame % 40) / 40;
                            this.ctx.strokeStyle = '#ff5555';
                            this.ctx.lineWidth = 2;
                            this.ctx.beginPath();
                            this.ctx.arc(0, 0, 30 + (1 - conv) * 90, -0.35, 0.35);
                            this.ctx.stroke();
                        } else if (ent.gazeState === 'sweeping') {
                            let pulse = Math.sin(this.renderFrame * 0.5) * 0.2;
                            let grad = this.ctx.createRadialGradient(0, 0, 0, 0, 0, gR);
                            grad.addColorStop(0, `rgba(255, 0, 0, ${0.8 + pulse})`);
                            grad.addColorStop(0.1, `rgba(255, 50, 0, ${0.5 + pulse})`);
                            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

                            this.ctx.fillStyle = grad;
                            this.ctx.beginPath();
                            this.ctx.moveTo(0, 0);
                            this.ctx.arc(0, 0, gR, -ent.gazeWidth, ent.gazeWidth);
                            this.ctx.fill();

                            // Patch 40 (look only): crisp lethal-edge rules drawn at
                            // EXACTLY ±ent.gazeWidth — the very value Panopticon.js
                            // tests with (Math.abs(angleDiff) < this.gazeWidth). This
                            // conveys nothing the hard-edged fill above didn't already;
                            // it just stops the boundary dissolving into the gradient at
                            // range. Read from the entity, never hardcoded, so it cannot
                            // drift out of sync with the hitbox.
                            this.ctx.strokeStyle = `rgba(255, 180, 180, ${0.45 + pulse})`;
                            this.ctx.lineWidth = 2;
                            for (const s of [-1, 1]) {
                                this.ctx.beginPath();
                                this.ctx.moveTo(0, 0);
                                this.ctx.lineTo(Math.cos(ent.gazeWidth * s) * gR, Math.sin(ent.gazeWidth * s) * gR);
                                this.ctx.stroke();
                            }

                            // Surveillance interference — scan arcs travelling outward
                            // inside the cone. Purely decorative, bounded by the same
                            // ±gazeWidth so it never paints outside the real hitbox.
                            this.ctx.strokeStyle = `rgba(255, 120, 120, ${0.18 + pulse * 0.5})`;
                            this.ctx.lineWidth = 1.5;
                            for (let k = 0; k < 4; k++) {
                                const rr = (this.renderFrame * 9 + k * 500) % gR;
                                if (rr < 40 || rr > gR) continue;
                                this.ctx.beginPath();
                                this.ctx.arc(0, 0, rr, -ent.gazeWidth, ent.gazeWidth);
                                this.ctx.stroke();
                            }

                            this.ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + pulse})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(0, 0);
                            this.ctx.arc(0, 0, gR, -ent.gazeWidth*0.05, ent.gazeWidth*0.05);
                            this.ctx.fill();
                        }
                        this.ctx.restore();
                    }
                } 
                else if (ent.type === 'ARCHITECT') {
                    if (ent.actionState === 'charging_collapse' || ent.actionState === 'collapse_active') {
                        this.ctx.save();
                        this.ctx.translate(ent.x, ent.y);
                        
                        let pulse = Math.sin(this.renderFrame * 0.5) * 0.2;
                        const warn = ent.actionState === 'charging_collapse';
                        const safeR = ent.safeZoneRadius;

                        // Patch 40 (look only): the danger field used to be ONE flat
                        // colour across the whole outside region, so nothing in it
                        // indicated which way safety lay — at a glance the arena just
                        // went red. It is now a gradient intensifying with distance
                        // from the boundary, which reads as "run inward".
                        // KEEP: the boundary is still exactly ent.safeZoneRadius — the
                        // same field Architect.js tests with
                        // (distToPlayer > this.safeZoneRadius) — and the evenodd fill
                        // region is unchanged, so the lethal area is pixel-identical.
                        // Guarded because a non-finite radius into createRadialGradient
                        // throws DOMException and kills the render loop.
                        if (Number.isFinite(safeR) && safeR > 0) {
                            const dangerGrad = this.ctx.createRadialGradient(0, 0, safeR, 0, 0, 2500);
                            const a0 = Math.max(0, warn ? 0.10 + pulse * 0.5 : 0.35 + pulse);
                            const a1 = Math.max(0, warn ? 0.30 + pulse * 0.5 : 0.75 + pulse);
                            dangerGrad.addColorStop(0, warn ? `rgba(255, 200, 50, ${a0})` : `rgba(255, 60, 40, ${a0})`);
                            dangerGrad.addColorStop(1, warn ? `rgba(255, 140, 0, ${a1})` : `rgba(255, 0, 0, ${a1})`);
                            this.ctx.fillStyle = dangerGrad;
                        } else {
                            this.ctx.fillStyle = warn ? `rgba(255, 200, 50, ${0.2 + pulse})` : `rgba(255, 50, 50, ${0.6 + pulse})`;
                        }
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, 2500, 0, Math.PI * 2);
                        this.ctx.arc(0, 0, safeR, 0, Math.PI * 2);
                        this.ctx.fill('evenodd');

                        this.ctx.strokeStyle = warn ? '#ffffff' : '#ff0000';
                        this.ctx.lineWidth = 5 + Math.sin(this.renderFrame * 0.5) * 3;
                        this.ctx.setLineDash([20, 10]);
                        // Patch 40 (look only): travel the dash so the containment ring
                        // reads as a live field rather than a static circle. Radius is
                        // untouched — only the dash phase moves.
                        this.ctx.lineDashOffset = -(this.renderFrame * 0.6) % 30;
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, safeR, 0, Math.PI * 2);
                        this.ctx.stroke();

                        // Patch 40 (look only): the dashed ring is 5-8px wide and
                        // pulsing, so its exact centreline — which IS the kill boundary —
                        // is ambiguous by a few pixels at the thin end of the pulse.
                        // This hairline sits precisely on safeZoneRadius to pin it.
                        this.ctx.setLineDash([]);
                        this.ctx.lineWidth = 1.5;
                        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, safeR, 0, Math.PI * 2);
                        this.ctx.stroke();

                        this.ctx.restore();
                    }
                }
            });
        }
        
        if (state.projectiles) {
            state.projectiles.forEach(p => {
                this.ctx.fillStyle = p.color;
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.radius * 0.4, 0, Math.PI * 2);
                this.ctx.fill();
            });
        }

        if (state.interactables) {
            state.interactables.forEach(obj => {
                if (obj.active && obj.type === 'BREAKER_BOX') {
                    let pRadius = obj.radius + Math.sin(this.renderFrame * 0.2) * 20;
                    const boxGlare = this.ctx.createRadialGradient(obj.x, obj.y, 10, obj.x, obj.y, pRadius);
                    boxGlare.addColorStop(0, 'rgba(255, 255, 200, 0.6)');
                    boxGlare.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    this.ctx.fillStyle = boxGlare;
                    this.ctx.beginPath();
                    this.ctx.arc(obj.x, obj.y, pRadius, 0, Math.PI * 2);
                    this.ctx.fill();
                } else if (obj.type === 'EXIT_ELEVATOR') {
                    let pulse = Math.sin(this.renderFrame * 0.1) * 20;
                    const exitGlare = this.ctx.createRadialGradient(obj.x, obj.y, 10, obj.x, obj.y, 150 + pulse);
                    exitGlare.addColorStop(0, 'rgba(200, 200, 255, 0.5)');
                    exitGlare.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    this.ctx.fillStyle = exitGlare;
                    this.ctx.beginPath();
                    this.ctx.arc(obj.x, obj.y, 150 + pulse, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            });
        }

        let currentAngle = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;
        let jitter = state.sanity < 30 ? (Math.random() - 0.5) * 0.1 : 0;
        let isStrobing = false;
        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) {
            if (this.renderFrame % 6 < 3) { currentAngle *= 1.5; isStrobing = true; }
            else { currentAngle *= 0.8; }
        }

        const glareGrad = this.ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, flRadius);
        if (isStrobing) {
            glareGrad.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
            glareGrad.addColorStop(1, 'rgba(200, 200, 255, 0)');
        } else if (state.player.weapons.corrosive_battery && state.player.weapons.corrosive_battery.level > 0) {
            glareGrad.addColorStop(0, 'rgba(120, 255, 100, 0.4)'); 
            glareGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
            glareGrad.addColorStop(0, 'rgba(255, 245, 200, 0.35)'); 
            glareGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        
        this.ctx.fillStyle = glareGrad;
        this.ctx.beginPath();
        this.ctx.moveTo(state.player.x, state.player.y);
        this.ctx.arc(state.player.x, state.player.y, flRadius, state.player.angle - currentAngle + jitter, state.player.angle + currentAngle + jitter);
        this.ctx.closePath();
        this.ctx.fill();

        let ambientRad = state.player.curses && state.player.curses.includes('tunnel_vision') ? 0 : flRadius * 0.45;
        
        if (state.roomCleared) {
            ambientRad = 3000;
        }
        
        if (ambientRad > 0) {
            const ambColorGrad = this.ctx.createRadialGradient(state.player.x, state.player.y, 0, state.player.x, state.player.y, ambientRad);
            ambColorGrad.addColorStop(0, 'rgba(200, 220, 255, 0.15)');
            ambColorGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = ambColorGrad;
            this.ctx.beginPath();
            this.ctx.arc(state.player.x, state.player.y, ambientRad, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.globalCompositeOperation = 'source-over'; 

        // Patch 169: a warm tint inside the beam (screen-blended), so the light reads as
        // light and not as a grey hole in the dark. One gradient a frame.
        if (fl && Number.isFinite(flRadius) && flRadius > 0 && Number.isFinite(state.player.angle) && Number.isFinite(fl.angle)) {
            const wx = state.player.x, wy = state.player.y;
            const warm = this.ctx.createRadialGradient(wx, wy, 8, wx, wy, flRadius);
            warm.addColorStop(0, 'rgba(255, 226, 160, 0.30)');
            warm.addColorStop(0.7, 'rgba(255, 196, 110, 0.14)');
            warm.addColorStop(1, 'rgba(255, 180, 90, 0)');
            this.ctx.globalCompositeOperation = 'screen';
            this.ctx.fillStyle = warm;
            this.ctx.beginPath();
            this.ctx.moveTo(wx, wy);
            this.ctx.arc(wx, wy, flRadius, state.player.angle - fl.angle, state.player.angle + fl.angle);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.globalCompositeOperation = 'source-over';
        }

        if (state.cameraFlash > 0) {
            this.ctx.save();
            this.ctx.globalCompositeOperation = 'screen';
            this.ctx.fillStyle = `rgba(255, 255, 255, ${state.cameraFlash / 15})`;
            
            const cam = state.player.weapons.polaroid_camera;
            this.ctx.beginPath();
            this.ctx.moveTo(state.player.x, state.player.y);
            this.ctx.arc(state.player.x, state.player.y, cam.radius, 
                state.player.angle - cam.angle, 
                state.player.angle + cam.angle);
            this.ctx.fill();
            this.ctx.restore();
        }

        const staticWep = state.player.weapons.static;
        if (staticWep.active) {
            this.ctx.beginPath(); 
            this.ctx.arc(state.player.x, state.player.y, staticWep.radius, 0, Math.PI*2);
            this.ctx.lineWidth = 2; 
            this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + Math.sin(staticWep.pulsePhase)*0.2})`; 
            this.ctx.stroke();
            this.ctx.fillStyle = `rgba(200, 200, 200, ${0.05 + Math.random()*0.05})`; 
            this.ctx.fill();
        }

        if (state.meleeSwings) {
            state.meleeSwings.forEach(m => {
                this.ctx.save();
                this.ctx.translate(m.x, m.y);
                let swingProgress = 1 - (m.life / 15);
                let currentSwingAngle = swingProgress * Math.PI * 2;
                
                this.ctx.beginPath();
                this.ctx.arc(0, 0, m.radius, currentSwingAngle - 1.5, currentSwingAngle, false);
                this.ctx.strokeStyle = `rgba(150, 0, 0, ${m.life / 15})`;
                this.ctx.lineWidth = 15;
                this.ctx.lineCap = 'round';
                this.ctx.stroke();

                this.ctx.beginPath();
                this.ctx.arc(0, 0, m.radius, currentSwingAngle - 0.2, currentSwingAngle, false);
                this.ctx.strokeStyle = `rgba(200, 200, 210, ${m.life / 15})`;
                this.ctx.lineWidth = 8;
                this.ctx.stroke();
                this.ctx.restore();
            });
        }

        this.drawArsenal(state);   // Patch 132
    }

    /**
     * Patch 132 (V2 plan D3): the four Phase D weapons (logic in src/systems/Arsenal.js).
     * Plain fills and strokes only — no shadowBlur, no composite changes — and every
     * array here is hard-capped in Arsenal.js (ARSENAL_CAPS), so this is a few dozen
     * small shapes at most. Strap positions are recomputed from the weapon's own
     * `phase`, the value the hit test used this step.
     */
    drawArsenal(state) {
        const ctx = this.ctx;
        const W = state.player.weapons || {};

        const rings = state.pulseRings;
        if (rings && rings.length) {
            ctx.lineWidth = 3;
            for (const r of rings) {
                const t = Math.max(0, Math.min(1, r.r / (r.maxR || 1)));
                ctx.strokeStyle = `rgba(127, 212, 255, ${0.75 * (1 - t)})`;
                ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
                ctx.strokeStyle = `rgba(127, 212, 255, ${0.25 * (1 - t)})`;
                ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(1, r.r - 10), 0, Math.PI * 2); ctx.stroke();
            }
        }

        const shots = state.playerShots;
        if (shots && shots.length) {
            for (const sh of shots) {
                ctx.save();
                ctx.translate(sh.x, sh.y);
                ctx.rotate(sh.spin);
                ctx.fillStyle = '#f2f2f2';
                ctx.beginPath(); ctx.arc(-4, 0, 4, Math.PI / 2, Math.PI * 1.5); ctx.lineTo(0, -4); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#d64545';
                ctx.beginPath(); ctx.arc(4, 0, 4, -Math.PI / 2, Math.PI / 2); ctx.lineTo(0, 4); ctx.lineTo(0, -4); ctx.closePath(); ctx.fill();
                ctx.restore();
            }
        }

        const straps = W.straitjacket;
        if (straps && straps.level > 0) {
            const n = Math.max(1, Math.floor(straps.straps));
            ctx.lineCap = 'round';
            for (let k = 0; k < n; k++) {
                const a = (straps.phase || 0) + (k * Math.PI * 2) / n;
                ctx.strokeStyle = 'rgba(232, 220, 192, 0.9)';
                ctx.lineWidth = 7;
                ctx.beginPath(); ctx.arc(state.player.x, state.player.y, straps.radius, a - 0.22, a + 0.22); ctx.stroke();
                const bx = state.player.x + Math.cos(a) * straps.radius;
                const by = state.player.y + Math.sin(a) * straps.radius;
                ctx.fillStyle = '#8a8170';
                ctx.fillRect(bx - 3, by - 3, 6, 6);
            }
            ctx.lineCap = 'butt';
        }

        const notes = state.lullabyNotes;
        if (notes && notes.length) {
            for (const nt of notes) {
                const y = nt.y + Math.sin(nt.bob) * 3;
                ctx.fillStyle = 'rgba(155, 140, 255, 0.18)';
                ctx.beginPath(); ctx.arc(nt.x, y, 14, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#b9adff';
                ctx.beginPath(); ctx.ellipse(nt.x - 3, y + 4, 4.5, 3.2, -0.4, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#b9adff';
                ctx.lineWidth = 1.6;
                ctx.beginPath(); ctx.moveTo(nt.x + 1, y + 3); ctx.lineTo(nt.x + 1, y - 9); ctx.lineTo(nt.x + 6, y - 5); ctx.stroke();
            }
        }
    }

    /** Patch 137: how visible the room's walls are right now (rise-in, fade-out). */
    arenaAlpha(state) {
        if (state.arenaFade > 0) return Math.max(0, state.arenaFade / ARENA_FADE_STEPS);
        if (state.arenaRise > 0) return Math.max(0, 1 - state.arenaRise / ARENA_RISE_STEPS);
        return 1;
    }

    /** Patch 137 (V2 plan D5): the room's walls, per floor style. Plain fills, no blur. */
    drawObstacles(state) {
        const obs = state.obstacles;
        if (!obs || !obs.length) return;
        const L = ARENA_LAYOUTS[state.arenaLayout];
        const style = L ? L.style : 'ink';
        const P = {
            locker:    { fill: '#2c3226', edge: '#6b7558', line: '#171a13' },
            ink:       { fill: '#0c0c10', edge: '#73737f', line: '#26262e' },
            brick:     { fill: '#2b100e', edge: '#86443a', line: '#170706' },
            ward:      { fill: '#15201a', edge: '#5b7c62', line: '#0c140f' },
            blueprint: { fill: '#19160b', edge: '#c9a54a', line: '#5e4d22' }
        }[style] || { fill: '#111', edge: '#666', line: '#222' };
        const ctx = this.ctx;
        const a = this.arenaAlpha(state);
        ctx.save();
        for (const o of obs) {
            if (o.cap) continue;   // drawn as part of its arc
            if (!o.solid) {
                // A sunk Blueprint block: its outline on the floor, and a rising one
                // fills in and pulses through its telegraph.
                const t = o.telegraph > 0 ? 1 - o.telegraph / GRID_TELEGRAPH_STEPS : 0;
                ctx.globalAlpha = a * (o.telegraph > 0 ? 0.35 + 0.45 * t : 0.35);
                ctx.setLineDash([8, 8]);
                ctx.strokeStyle = P.edge;
                ctx.lineWidth = o.telegraph > 0 ? 3 : 1.5;
                ctx.strokeRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
                ctx.setLineDash([]);
                if (o.telegraph > 0) {
                    ctx.globalAlpha = a * (0.15 + 0.35 * t) * (0.75 + 0.25 * Math.sin(this.renderFrame * 0.4));
                    ctx.fillStyle = P.edge;
                    const s = 0.4 + 0.6 * t;
                    ctx.fillRect(o.x - o.hw * s, o.y - o.hh * s, o.hw * 2 * s, o.hh * 2 * s);
                }
                continue;
            }
            ctx.globalAlpha = a * 0.45;
            ctx.fillStyle = '#000';
            if (o.kind === 'block') ctx.fillRect(o.x - o.hw + 6, o.y - o.hh + 9, o.hw * 2, o.hh * 2);
            else if (o.kind === 'post') { ctx.beginPath(); ctx.arc(o.x + 5, o.y + 8, o.r, 0, Math.PI * 2); ctx.fill(); }
            ctx.globalAlpha = a;
            ctx.fillStyle = P.fill;
            ctx.strokeStyle = P.edge;
            ctx.lineWidth = 2;
            if (o.kind === 'block') {
                ctx.fillRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
                ctx.strokeRect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
                ctx.beginPath();
                ctx.strokeStyle = P.line;
                if (style === 'locker') {
                    // Locker doors, with a vent slit near the top of each.
                    for (let x = o.x - o.hw + 26; x < o.x + o.hw; x += 26) { ctx.moveTo(x, o.y - o.hh); ctx.lineTo(x, o.y + o.hh); }
                    for (let x = o.x - o.hw + 7; x < o.x + o.hw - 10; x += 26) { ctx.moveTo(x, o.y - o.hh + 6); ctx.lineTo(x + 12, o.y - o.hh + 6); }
                } else if (style === 'ward') {
                    for (let x = o.x - o.hw + 40; x < o.x + o.hw; x += 40) { ctx.moveTo(x, o.y - o.hh); ctx.lineTo(x, o.y + o.hh); }
                    for (let y = o.y - o.hh + 40; y < o.y + o.hh; y += 40) { ctx.moveTo(o.x - o.hw, y); ctx.lineTo(o.x + o.hw, y); }
                } else if (style === 'blueprint') {
                    ctx.moveTo(o.x - o.hw, o.y - o.hh); ctx.lineTo(o.x + o.hw, o.y + o.hh);
                    ctx.moveTo(o.x + o.hw, o.y - o.hh); ctx.lineTo(o.x - o.hw, o.y + o.hh);
                }
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // Lit top edge.
                ctx.strokeStyle = P.edge;
                ctx.globalAlpha = a * 0.8;
                ctx.beginPath(); ctx.moveTo(o.x - o.hw, o.y - o.hh + 1); ctx.lineTo(o.x + o.hw, o.y - o.hh + 1); ctx.stroke();
            } else if (o.kind === 'post') {
                ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                // An ink post is mirrored: a lighter blot folded about its own axis.
                ctx.fillStyle = P.line;
                const w = Math.sin(o.phase + this.renderFrame * 0.01) * 0.25 + 0.55;
                ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r * w, o.r * 0.6, 0, 0, Math.PI * 2); ctx.fill();
            } else if (o.kind === 'arc') {
                ctx.lineCap = 'round';
                ctx.lineWidth = o.w;
                ctx.beginPath(); ctx.arc(o.x, o.y, o.r, o.a0, o.a1); ctx.strokeStyle = P.fill; ctx.stroke();
                ctx.lineWidth = 2;
                ctx.strokeStyle = P.edge;
                ctx.beginPath(); ctx.arc(o.x, o.y, o.r - o.w / 2, o.a0, o.a1); ctx.stroke();
                ctx.beginPath(); ctx.arc(o.x, o.y, o.r + o.w / 2, o.a0, o.a1); ctx.stroke();
                // Brick courses.
                ctx.strokeStyle = P.line;
                ctx.beginPath();
                for (let t = o.a0 + 0.06; t < o.a1; t += 0.06) {
                    ctx.moveTo(o.x + Math.cos(t) * (o.r - o.w / 2), o.y + Math.sin(t) * (o.r - o.w / 2));
                    ctx.lineTo(o.x + Math.cos(t) * (o.r + o.w / 2), o.y + Math.sin(t) * (o.r + o.w / 2));
                }
                ctx.stroke();
                ctx.lineCap = 'butt';
            }
        }
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        ctx.restore();
    }

    /**
     * Patch 137: drawn AFTER the darkness mask, so a wall is never invisible: a faint
     * outline of every solid wall (and every rising telegraph) shows in the dark.
     */
    drawObstacleOutlines(state) {
        const obs = state.obstacles;
        if (!obs || !obs.length) return;
        const L = ARENA_LAYOUTS[state.arenaLayout];
        const edge = { locker: '#9aa684', ink: '#9a9aa8', brick: '#b0665a', ward: '#86a88d', blueprint: '#e0c070' }[L ? L.style : 'ink'] || '#999';
        const ctx = this.ctx;
        const a = this.arenaAlpha(state);
        ctx.save();
        ctx.strokeStyle = edge;
        ctx.lineWidth = 2;
        for (const o of obs) {
            if (o.cap) continue;
            if (!o.solid && !(o.telegraph > 0)) continue;
            ctx.globalAlpha = a * (o.solid ? 0.32 : 0.4 + 0.3 * Math.sin(this.renderFrame * 0.4));
            ctx.beginPath();
            if (o.kind === 'block') ctx.rect(o.x - o.hw, o.y - o.hh, o.hw * 2, o.hh * 2);
            else if (o.kind === 'post') ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
            else if (o.kind === 'arc') { ctx.arc(o.x, o.y, o.r - o.w / 2, o.a0, o.a1); ctx.arc(o.x, o.y, o.r + o.w / 2, o.a1, o.a0, true); ctx.closePath(); }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
    }

    drawObjectivePointers(state) {
        if (state.interactables) {
            state.interactables.forEach(obj => {
                if (obj.type === 'OBJECTIVE_BACKPACK' || obj.type === 'EXIT_ELEVATOR' || obj.type === 'ROOM_DOOR' || (obj.type === 'CHEST' && !obj.opening)
                    || (obj.type === 'BREAKER_BOX' && obj.roomEvent && !obj.active)) {   // Patch 138
                    let dx = obj.x - state.player.x;
                    let dy = obj.y - state.player.y;
                    let dist = Math.hypot(dx, dy);
                    
                    if (dist > 200) { 
                        this.ctx.save();
                        this.ctx.translate(state.player.x, state.player.y);
                        
                        let angle = Math.atan2(dy, dx);
                        this.ctx.rotate(angle);
                        this.ctx.translate(140, 0); 
                        
                        if (obj.type === 'OBJECTIVE_BACKPACK') {
                            let isUrgent = obj.life < 300;
                            let pulse = Math.sin(this.renderFrame * (isUrgent ? 0.4 : 0.1)) * 0.5 + 0.5;
                            
                            this.ctx.fillStyle = isUrgent ? `rgba(255, 50, 50, ${0.4 + pulse * 0.6})` : `rgba(100, 255, 100, ${0.3 + pulse * 0.5})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(15, 0); this.ctx.lineTo(-10, 10); this.ctx.lineTo(-5, 0); this.ctx.lineTo(-10, -10);
                            this.ctx.closePath();
                            this.ctx.fill();
                            
                            this.ctx.translate(30, 0); 
                            this.ctx.rotate(-angle); 
                            this.ctx.textAlign = 'center';
                            this.ctx.textBaseline = 'middle';
                            this.ctx.font = "bold 16px 'Courier New', Courier, monospace";
                            this.ctx.fillStyle = isUrgent ? `rgba(255, 100, 100, ${0.8 + pulse * 0.2})` : `rgba(150, 255, 150, ${0.8 + pulse * 0.2})`;
                            this.ctx.fillText(Math.ceil(obj.life / 60) + "s", 0, 0);
                        } else if (obj.type === 'EXIT_ELEVATOR') {
                            let pulse = Math.sin(this.renderFrame * 0.2) * 0.5 + 0.5;
                            this.ctx.fillStyle = `rgba(200, 200, 255, ${0.4 + pulse * 0.6})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(20, 0); this.ctx.lineTo(-15, 15); this.ctx.lineTo(-10, 0); this.ctx.lineTo(-15, -15);
                            this.ctx.closePath();
                            this.ctx.fill();
                        } else if (obj.type === 'BREAKER_BOX') {
                            // Patch 138: the Power Outage's breaker, pulsing like a failing bulb.
                            let pulse = Math.sin(this.renderFrame * 0.3) * 0.5 + 0.5;
                            this.ctx.fillStyle = `rgba(255, 255, 160, ${0.45 + pulse * 0.55})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(18, 0); this.ctx.lineTo(-12, 12); this.ctx.lineTo(-8, 0); this.ctx.lineTo(-12, -12);
                            this.ctx.closePath();
                            this.ctx.fill();
                        } else if (obj.type === 'CHEST') {
                            let pulse = Math.sin(this.renderFrame * 0.2) * 0.5 + 0.5;
                            this.ctx.fillStyle = `rgba(255, 210, 127, ${0.4 + pulse * 0.6})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(18, 0); this.ctx.lineTo(-12, 12); this.ctx.lineTo(-8, 0); this.ctx.lineTo(-12, -12);
                            this.ctx.closePath();
                            this.ctx.fill();
                        } else if (obj.type === 'ROOM_DOOR') {
                            let pulse = Math.sin(this.renderFrame * 0.2) * 0.5 + 0.5;
                            const doorInfo = this.roomDoorVisual(obj.rewardType);
                            this.ctx.fillStyle = `rgba(${doorInfo.glowRgb}, ${0.4 + pulse * 0.6})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(20, 0); this.ctx.lineTo(-15, 15); this.ctx.lineTo(-10, 0); this.ctx.lineTo(-15, -15);
                            this.ctx.closePath();
                            this.ctx.fill();
                        }
                        
                        this.ctx.restore();
                    }
                }
            });
        }
    }

    drawVignette(state) {
        if (state.roomCleared) return;
        this.ctx.save();
        let sanityRatio = Math.max(0.01, state.sanity / state.player.maxHp);
        let innerVig = (this.canvas.height / 4) * sanityRatio; 
        let outerVig = (this.canvas.height) * (0.2 + sanityRatio * 0.8); 
        
        // Patch 71: centred on the CAMERA, not the canvas — the vignette's whole job is
        // to frame the player, and in portrait the player is drawn above the canvas
        // centre. Identical on every other layout, where the two are the same point.
        const vigX = Number.isFinite(this.cameraCenterX) ? this.cameraCenterX : this.canvas.width / 2;
        const vigY = Number.isFinite(this.cameraCenterY) ? this.cameraCenterY : this.canvas.height / 2;
        // Patch 96: the same five values as before, indexed by the cycled palette
        // rather than by an if/else chain whose tail was `floor >= 5`. Floors 1-5 pick
        // exactly what they always picked.
        const VOID_BY_PALETTE = [
            'rgba(30,20,10,0.98)',  // 1 Wastes
            'rgba(10,10,10,0.98)',  // 2 Divide
            'rgba(40,5,5,0.98)',    // 3 Panopticon
            'rgba(5,20,5,0.98)',    // 4 Amalgamation
            'rgba(20,15,0,0.98)'    // 5 Architect
        ];
        let voidColor = VOID_BY_PALETTE[paletteIndexForFloor(state.floor)] || 'rgba(0,0,0,0.98)';

        // Patch 121: the gradient is baked into vigCanvas at quarter resolution and
        // only rebuilt when what it depends on moves: canvas size, camera centre,
        // palette, or Sanity in 2.5% steps (finer than the eye can follow on a
        // full-screen falloff). It was a fresh full-screen radial gradient every
        // drawn frame. Same stops, same geometry; upscaled with smoothing.
        const VS = 0.25;
        const sanityStep = Math.round(sanityRatio * 40);
        const vkey = `${this.canvas.width}x${this.canvas.height}|${vigX | 0},${vigY | 0}|${voidColor}|${sanityStep}`;
        if (vkey !== this.vigKey && Number.isFinite(innerVig) && Number.isFinite(outerVig)) {
            this.vigKey = vkey;
            const vw = Math.max(1, Math.round(this.canvas.width * VS));
            const vh = Math.max(1, Math.round(this.canvas.height * VS));
            if (this.vigCanvas.width !== vw || this.vigCanvas.height !== vh) {
                this.vigCanvas.width = vw; this.vigCanvas.height = vh;
            } else {
                this.vigCtx.clearRect(0, 0, vw, vh);
            }
            const sr = Math.max(0.01, sanityStep / 40);
            const inner = (this.canvas.height / 4) * sr * VS;
            const outer = (this.canvas.height) * (0.2 + sr * 0.8) * VS;
            const vig = this.vigCtx.createRadialGradient(vigX * VS, vigY * VS, inner, vigX * VS, vigY * VS, outer);
            vig.addColorStop(0, 'rgba(0,0,0,0)');
            vig.addColorStop(1, voidColor);
            this.vigCtx.fillStyle = vig;
            this.vigCtx.fillRect(0, 0, vw, vh);
        }
        this.ctx.drawImage(this.vigCanvas, 0, 0, this.canvas.width, this.canvas.height);

        if (sanityRatio < 0.4) {
            this.ctx.strokeStyle = `rgba(255,255,255,${0.1 + (0.4 - sanityRatio)})`;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            
            for (let i = 0; i < 3; i++) {
                let startX = i === 0 ? 0 : (i === 1 ? this.canvas.width : Math.random() * this.canvas.width);
                let startY = i === 2 ? 0 : (Math.random() * this.canvas.height);
                this.ctx.moveTo(startX, startY);
                
                let currX = startX; let currY = startY;
                for (let j = 0; j < 5; j++) {
                    currX += (this.canvas.width/2 - currX) * 0.2 + (Math.random() - 0.5) * 100;
                    currY += (this.canvas.height/2 - currY) * 0.2 + (Math.random() - 0.5) * 100;
                    this.ctx.lineTo(currX, currY);
                }
            }
            this.ctx.stroke();
        }

        if (state.inVoid) {
            this.ctx.fillStyle = `rgba(40, 0, 50, ${0.4 + Math.sin(this.renderFrame * 0.2) * 0.2})`;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.ctx.restore();
    }

    // Patch 64 — live directional cue for the tutorial's single enemy.
    //
    // Drawn in WORLD space (this runs inside drawWorldItems, under the fog and the
    // lighting masks) on purpose: it is a position, so it belongs in the world next
    // to the thing it points at. Deliberately NOT a screen-edge waypoint marker.
    // Since Patch 65 this is the only tutorial element left in the canvas — every
    // WORD moved to the DOM banner, which is legible at any zoom and any language
    // length; the arrow stays here because the banner cannot say "over there".
    //
    // Shape is the objective-pointer chevron from drawObjectivePointers() — the
    // player already reads that shape as "the thing you want is that way" from the
    // exit/door pointers — but keyed to the tutorial text's green rather than a
    // door colour, and fading out once the enemy is close enough to be its own
    // signpost (by then the ring drawn on it in the entity loop is doing the work).
    drawTutorialCue(state) {
        if (!state.entities || !state.entities.length) return;

        const px = state.player.x;
        const py = state.player.y;
        if (!Number.isFinite(px) || !Number.isFinite(py)) return;

        // Nearest living entity rather than entities[0]: the tutorial budget is 1, so
        // in practice these are the same, but this cannot point at a corpse mid-splice
        // or at the wrong body if anything ever adds a second spawn.
        let target = null;
        let bestDist = Infinity;
        for (let i = 0; i < state.entities.length; i++) {
            const e = state.entities[i];
            if (!e || e.hp <= 0) continue;
            if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
            const d = Math.hypot(e.x - px, e.y - py);
            if (d < bestDist) { bestDist = d; target = e; }
        }
        if (!target) return;

        // Ramp in over the band between "clearly on screen" and "off the edge", so the
        // cue is absent while the player is already looking at the enemy and unmissable
        // once it is not. viewHalfExtent is the guaranteed-visible half-extent published
        // by Director.spawnWave; the fallback matches Enemy.applyMovement's.
        const visible = Number.isFinite(state.viewHalfExtent) ? state.viewHalfExtent : 380;
        const fade = Math.min(1, Math.max(0, (bestDist - visible * 0.45) / (visible * 0.35)));
        if (fade <= 0.02) return;

        const angle = Math.atan2(target.y - py, target.x - px);
        if (!Number.isFinite(angle)) return;

        const pulse = Math.sin(this.renderFrame * 0.12) * 0.5 + 0.5;

        // This is world space, so a fixed world size shrinks on screen exactly where it
        // can least afford to — updateZoom drops to 0.70 on phones. Dividing the glyph
        // sizes by the live zoom keeps the cue a constant SCREEN size on every device.
        const s = Math.max(1, 1.3 / (this.zoom || 1.3));

        // Sit the head between the player and the enemy, never past it (which would put
        // an arrow on the far side of the thing it is pointing at), and never so far out
        // that it leaves the viewport on a narrow screen.
        const headMax = Math.max(70 * s, visible * 0.5);
        const headDist = Math.min(headMax, Math.max(45, bestDist * 0.5));

        this.ctx.save();
        this.ctx.translate(px, py);
        this.ctx.rotate(angle);

        // Dashed runway from the player toward the enemy. lineDashOffset scrolls
        // negative so the dashes travel outward, away from the player.
        this.ctx.strokeStyle = `rgba(170, 255, 170, ${(0.18 + pulse * 0.22) * fade})`;
        this.ctx.lineWidth = 3 * s;
        this.ctx.setLineDash([14 * s, 12 * s]);
        this.ctx.lineDashOffset = -this.renderFrame * 0.6;
        this.ctx.beginPath();
        this.ctx.moveTo(headDist * 0.35, 0);
        this.ctx.lineTo(headDist * 0.82, 0);
        this.ctx.stroke();
        this.ctx.setLineDash([]);

        this.ctx.translate(headDist + pulse * 5 * s, 0);
        this.ctx.scale(s, s);

        // Faux-glow behind the head so it reads through the floor pattern. No shadowBlur.
        this.drawGlow(0, 0, 34, '#aaffaa', 0.22 * fade);

        this.ctx.fillStyle = `rgba(170, 255, 170, ${(0.55 + pulse * 0.45) * fade})`;
        this.ctx.beginPath();
        this.ctx.moveTo(22, 0);
        this.ctx.lineTo(-16, 16);
        this.ctx.lineTo(-10, 0);
        this.ctx.lineTo(-16, -16);
        this.ctx.closePath();
        this.ctx.fill();

        // Counter-rotate the label so it stays upright whatever bearing the enemy is on.
        this.ctx.rotate(-angle);
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.font = "bold 16px 'Courier New', Courier, monospace";
        this.ctx.fillStyle = `rgba(170, 255, 170, ${(0.5 + pulse * 0.4) * fade})`;
        this.ctx.fillText("ELIMINATE", 0, 32);

        this.ctx.restore();
    }

    drawWorldItems(state) {
        this.ctx.save();
        // Patch 96: was `min(floor - 1, 4)` — every floor past 5 wore the Architect's
        // blueprint. The five biomes now come round with the cycle, so Cycle II opens
        // back in the Wastes.
        const patternIndex = paletteIndexForFloor(state.floor);
        this.ctx.fillStyle = this.cachedFloorPatterns[patternIndex];

        this.ctx.fillRect(state.player.x - 4000, state.player.y - 4000, 8000, 8000);

        // THE RECURSION OVERLAY. A returning biome must not read as "the same floor
        // again" — it has to read as that floor being overwritten. So the Architect's
        // own visual language (blueprint linework, fracture lines) is composited over
        // whichever biome is showing, deepening each cycle: the construct's geometry
        // bleeding through the earlier floors is exactly why the run is repeating.
        //
        // One extra cached pattern, built once at construction with the other five —
        // NOT generated per floor. visualCycle() is capped, so the alpha reaches a
        // ceiling and stops; see CYCLE_VISUAL_CAP for why that bound is a memory
        // constraint rather than a taste one.
        const grade = cycleGrade(state.floor);   // null on floors 1-5: nothing below runs

        if (grade && this.cachedRecursionPattern) {
            this.ctx.globalAlpha = grade.overlayAlpha;
            this.ctx.fillStyle = this.cachedRecursionPattern;
            this.ctx.fillRect(state.player.x - 4000, state.player.y - 4000, 8000, 8000);
            this.ctx.globalAlpha = 1;
        }

        // Patch 100 — THE CYCLE GRADE. Two full-floor washes that give each lap its own
        // colour identity (BLEACH / INFLAMMATION / GILDING — see CYCLE_GRADES). Patch 96
        // expressed depth as "darker", which made a deep floor read as the same floor at
        // night rather than a different place.
        //
        // `multiply` carries the hue and does the darkening; `screen` lifts the shadows
        // toward the same hue so the blacks are tinted too, which is what stops the
        // result reading as a flat sheet of colour laid over the top.
        //
        // globalCompositeOperation is reset to 'source-over' explicitly before leaving
        // this block. The enclosing save/restore would also restore it, but the golden
        // rule is explicit for a reason: a leaked 'multiply' turns everything drawn
        // afterwards — including the player — invisible or wrong, and it fails far away
        // from here.
        if (grade) {
            const gx = state.player.x - 4000;
            const gy = state.player.y - 4000;
            this.ctx.globalCompositeOperation = 'multiply';
            this.ctx.fillStyle = grade.mult;
            this.ctx.fillRect(gx, gy, 8000, 8000);
            this.ctx.globalCompositeOperation = 'screen';
            this.ctx.fillStyle = grade.screen;
            this.ctx.fillRect(gx, gy, 8000, 8000);
            this.ctx.globalCompositeOperation = 'source-over';
        }
        this.ctx.restore();

        // Patch 65: the world-space tutorial text is gone. Three lines of WASD/mouse/
        // SPACE copy were drawn here at the spawn point, duplicating (and contradicting)
        // the DOM banner, scrolling off the moment the player moved, and dimming under
        // the lighting masks. All tutorial WORDS now live on the banner, in the control
        // scheme the player is actually using — see src/systems/Tutorial.js.
        //
        // What stays in world space is the one thing the banner cannot express: where
        // the enemy is.
        if (state.isTutorial && state.mapOriginX !== null) {
            this.drawTutorialCue(state);
        }

        if (state.mapOriginX !== null) {
            this.ctx.save();
            const mapCenterX = state.mapOriginX;
            const mapCenterY = state.mapOriginY;
            const mapRadius = ARENA_VOID_RADIUS;
            const phase = state.frame * 0.02;

            this.ctx.fillStyle = '#030105'; 
            this.ctx.beginPath();
            
            this.ctx.rect(mapCenterX - 10000, mapCenterY - 10000, 20000, 20000);
            
            for (let i = 0; i <= Math.PI * 2 + 0.1; i += 0.05) {
                let noise = Math.sin(i * 4 + phase) * 80 
                          + Math.cos(i * 7 - phase * 1.5) * 50
                          + Math.sin(i * 13 + phase * 0.5) * 30;
                
                let r = mapRadius + noise;
                let vx = mapCenterX + Math.cos(i) * r;
                let vy = mapCenterY + Math.sin(i) * r;
                
                if (i === 0) this.ctx.moveTo(vx, vy);
                else this.ctx.lineTo(vx, vy);
            }
            this.ctx.closePath();
            
            this.ctx.fill('evenodd');
            
            this.ctx.strokeStyle = 'rgba(40, 5, 50, 0.8)';
            this.ctx.lineWidth = 150;
            this.ctx.stroke();
            
            this.ctx.strokeStyle = 'rgba(80, 10, 80, 0.4)';
            this.ctx.lineWidth = 50;
            this.ctx.stroke();
            
            this.ctx.restore();
        }

        this.drawObstacles(state);   // Patch 137: the room's walls, under everything that moves

        if (state.safeZones) {
            state.safeZones.forEach(sz => {
                this.ctx.save();
                this.ctx.strokeStyle = `rgba(200, 200, 255, ${sz.life / sz.maxLife})`;
                this.ctx.lineWidth = 3;
                this.ctx.setLineDash([10, 15]); 
                
                this.ctx.translate(sz.x, sz.y);
                this.ctx.rotate(this.renderFrame * 0.01);
                this.ctx.beginPath();
                this.ctx.arc(0, 0, sz.radius, 0, Math.PI*2);
                this.ctx.stroke();
                
                if (state.player.synergies && state.player.synergies.includes('scholastic_purge')) {
                    const mistPulse = Math.sin(this.renderFrame * 0.1) * 0.1;
                    this.ctx.fillStyle = `rgba(100, 255, 100, ${0.15 + mistPulse})`;
                    this.ctx.fill();
                }
                this.ctx.restore();
            });
        }

        if (state.interactables) {
            state.interactables.forEach(obj => {
                this.ctx.save();
                this.ctx.translate(obj.x, obj.y);
                
                if (obj.type === 'BREAKER_BOX') {
                    this.ctx.fillStyle = '#222';
                    this.ctx.fillRect(-20, -30, 40, 60);
                    this.ctx.strokeStyle = '#555';
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(-20, -30, 40, 60);
                    
                    let bulbColor = '#111';
                    let glow = 0;
                    if (obj.active) { bulbColor = '#ffffff'; glow = 30; } 
                    else if (obj.charge > 0) { bulbColor = `rgba(255, 255, 100, ${obj.charge/60})`; glow = 15; }

                    if (glow > 0) {
                        const bulbGlow = this.ctx.createRadialGradient(0, -10, 0, 0, -10, 12 + glow);
                        bulbGlow.addColorStop(0, 'rgba(255, 255, 170, 0.5)');
                        bulbGlow.addColorStop(1, 'rgba(255, 255, 170, 0)');
                        this.ctx.fillStyle = bulbGlow;
                        this.ctx.beginPath();
                        this.ctx.arc(0, -10, 12 + glow, 0, Math.PI * 2);
                        this.ctx.fill();
                    }

                    this.ctx.fillStyle = bulbColor;
                    this.ctx.beginPath();
                    this.ctx.arc(0, -10, 12, 0, Math.PI*2);
                    this.ctx.fill();

                    if (obj.active) {
                        this.ctx.strokeStyle = `rgba(255, 255, 150, ${0.4 + Math.sin(this.renderFrame * 0.2)*0.2})`;
                        this.ctx.lineWidth = 3;
                        this.ctx.setLineDash([20, 20]);
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, obj.radius, 0, Math.PI*2);
                        this.ctx.stroke();
                        
                        this.ctx.rotate(this.renderFrame * 0.05);
                        this.ctx.setLineDash([10, 40]);
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, obj.radius * 0.8, 0, Math.PI*2);
                        this.ctx.stroke();
                    } else if (obj.charge > 0) {
                        this.ctx.strokeStyle = '#ffff00';
                        this.ctx.lineWidth = 4;
                        this.ctx.beginPath();
                        this.ctx.arc(0, -10, 25, -Math.PI/2, -Math.PI/2 + (obj.charge/60) * Math.PI*2);
                        this.ctx.stroke();
                    }
                } else if (obj.type === 'OBJECTIVE_BACKPACK') {
                    let isUrgent = obj.life < 300; 
                    let pulseRate = isUrgent ? 0.3 : 0.1;
                    let pulse = Math.sin(this.renderFrame * pulseRate) * 5;
                    
                    this.ctx.fillStyle = '#4a5d23'; 
                    this.ctx.fillRect(-15, -15, 30, 30);
                    this.ctx.fillStyle = '#222';
                    this.ctx.fillRect(-10, -10, 20, 20);
                    
                    this.ctx.fillStyle = `rgba(100, 255, 100, ${0.5 + Math.sin(this.renderFrame * pulseRate)*0.5})`;
                    this.ctx.beginPath();
                    this.ctx.arc(0, -20 + pulse, 5 + pulse*0.5, 0, Math.PI*2);
                    this.ctx.fill();

                    this.ctx.strokeStyle = isUrgent ? '#ff0000' : '#00ff00';
                    this.ctx.lineWidth = 3;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 30, -Math.PI/2, -Math.PI/2 + (obj.life / 1200) * Math.PI*2);
                    this.ctx.stroke();

                    this.ctx.fillStyle = isUrgent ? '#ff0000' : '#00ff00';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.font = "bold 14px 'Courier New', Courier, monospace";
                    this.ctx.fillText(Math.ceil(obj.life / 60) + "s", 0, -35); 
                } else if (obj.type === 'CHEST') {
                    // Patch 133: an evidence locker — a squat box with a brass hasp. It
                    // rattles harder through the opening beat (obj.opening counts up).
                    const t = obj.opening ? obj.opening / 26 : 0;
                    const rattle = obj.opening ? Math.sin(this.renderFrame * 1.7) * (1 + t * 3) : 0;
                    const bob = obj.opening ? 0 : Math.sin(this.renderFrame * 0.08) * 2;
                    this.drawGlow(0, 0, 46 + t * 20, '#ffd27f', 0.35 + t * 0.3);
                    this.ctx.translate(rattle, bob);
                    this.ctx.fillStyle = '#3b2a17';
                    this.ctx.fillRect(-20, -10, 40, 24);
                    this.ctx.fillStyle = '#5a4022';
                    this.ctx.fillRect(-21, -18 - t * 6, 42, 10);   // the lid lifts as it opens
                    this.ctx.strokeStyle = '#d9a441';
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeRect(-20, -10, 40, 24);
                    this.ctx.strokeRect(-21, -18 - t * 6, 42, 10);
                    this.ctx.fillStyle = '#ffd27f';
                    this.ctx.fillRect(-4, -6, 8, 9);
                    if (!obj.opening) {
                        this.ctx.fillStyle = '#ffd27f';
                        this.ctx.textAlign = 'center';
                        this.ctx.textBaseline = 'middle';
                        this.ctx.font = "bold 12px 'Courier New', Courier, monospace";
                        this.ctx.fillText('CHEST', 0, -32);
                    }
                } else if (obj.type === 'CASE_PAGE') {
                    // Patch 144: a loose sheet from the Case File — paper, a red margin
                    // line, a few typed rows — turning slowly as it floats.
                    const spin = Number.isFinite(obj.spin) ? obj.spin : 0;
                    const bob = Math.sin(this.renderFrame * 0.07 + spin) * 3;
                    this.drawGlow(0, 0, 40, '#bcd6e6', 0.35);
                    this.ctx.translate(0, bob);
                    this.ctx.rotate(Math.sin(spin) * 0.25);
                    this.ctx.fillStyle = '#e5e0d8';
                    this.ctx.fillRect(-11, -14, 22, 28);
                    this.ctx.fillStyle = '#c9c0b0';
                    this.ctx.beginPath();   // folded corner
                    this.ctx.moveTo(5, -14); this.ctx.lineTo(11, -8); this.ctx.lineTo(5, -8); this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#8b0000';
                    this.ctx.lineWidth = 1;
                    this.ctx.beginPath(); this.ctx.moveTo(-6, -14); this.ctx.lineTo(-6, 14); this.ctx.stroke();
                    this.ctx.fillStyle = '#555';
                    for (let r = 0; r < 4; r++) this.ctx.fillRect(-4, -7 + r * 5, r === 3 ? 7 : 12, 1.5);
                    this.ctx.rotate(-Math.sin(spin) * 0.25);
                    this.ctx.fillStyle = '#bcd6e6';
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.font = "bold 11px 'Courier New', Courier, monospace";
                    this.ctx.fillText('PAGE', 0, -26);
                } else if (obj.type === 'EXIT_ELEVATOR') {
                    let pulse = Math.sin(this.renderFrame * 0.1) * 20;
                    
                    this.ctx.fillStyle = '#111';
                    this.ctx.fillRect(-30, -30, 60, 60); 
                    
                    const elevGlowAmt = 15 + pulse;
                    const elevGlow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 20 + elevGlowAmt);
                    elevGlow.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
                    elevGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
                    this.ctx.fillStyle = elevGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 20 + elevGlowAmt, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + Math.sin(this.renderFrame * 0.2)*0.2})`;
                    this.ctx.fillRect(-20, -20, 40, 40); 
                    
                    this.ctx.fillStyle = '#000';
                    this.ctx.beginPath();
                    this.ctx.moveTo(-10, -5); this.ctx.lineTo(10, -5); this.ctx.lineTo(0, 10);
                    this.ctx.fill();
                } else if (obj.type === 'ROOM_DOOR') {
                    // Patch 169: the reward door, redrawn. It was a black rectangle with a
                    // coloured stroke. Now: light spilling on the floor, a stone arch, a
                    // lit portal with rising streaks, the reward's glyph in the arch and
                    // a backed label under the sill. Two doors at most, so the two
                    // gradients per door per frame are affordable.
                    const doorInfo = this.roomDoorVisual(obj.rewardType);
                    const c = this.ctx;
                    const tick = this.renderFrame;
                    const pulse = Math.sin(tick * 0.08 + obj.x * 0.01) * 0.5 + 0.5;
                    const W = 30, H = 46;          // half-width, half-height of the opening

                    // light on the floor in front of the door
                    c.save();
                    c.translate(0, H + 6);
                    c.scale(1, 0.42);
                    this.drawGlow(0, 0, 92 + pulse * 10, doorInfo.color, 0.5);
                    c.restore();
                    this.drawGlow(0, -6, 78 + pulse * 8, doorInfo.color, 0.28);

                    // the arch path: straight jambs, a round head
                    const arch = (hw, hh) => {
                        c.beginPath();
                        c.moveTo(-hw, hh);
                        c.lineTo(-hw, -hh + hw);
                        c.arc(0, -hh + hw, hw, Math.PI, 0);
                        c.lineTo(hw, hh);
                        c.closePath();
                    };

                    // stone frame
                    arch(W + 9, H + 7);
                    c.fillStyle = '#2a2622';
                    c.fill();
                    c.strokeStyle = '#6f675c';
                    c.lineWidth = 2;
                    c.stroke();

                    // the portal
                    arch(W, H);
                    const pg = c.createLinearGradient(0, -H, 0, H);
                    pg.addColorStop(0, `rgba(${doorInfo.glowRgb}, 0.95)`);
                    pg.addColorStop(0.55, `rgba(${doorInfo.glowRgb}, 0.45)`);
                    pg.addColorStop(1, 'rgba(10, 8, 14, 0.95)');
                    c.fillStyle = pg;
                    c.fill();
                    c.save();
                    c.clip();
                    c.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    c.lineWidth = 1.5;
                    c.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const sx = -W + 5 + i * ((W * 2 - 10) / 5);
                        const sy = H - ((tick * (0.8 + i * 0.13) + i * 37) % (H * 2));
                        c.moveTo(sx, sy); c.lineTo(sx, sy - 12);
                    }
                    c.stroke();
                    c.restore();
                    arch(W, H);
                    c.strokeStyle = doorInfo.color;
                    c.lineWidth = 3;
                    c.stroke();

                    // the reward's glyph, in the head of the arch
                    c.save();
                    c.translate(0, -H + W + 2);
                    c.fillStyle = '#ffffff';
                    c.strokeStyle = '#ffffff';
                    c.lineWidth = 4;
                    c.lineCap = 'round';
                    c.beginPath();
                    const rt = obj.rewardType;
                    if (rt === 'HEAL') { c.moveTo(-10, 0); c.lineTo(10, 0); c.moveTo(0, -10); c.lineTo(0, 10); c.stroke(); }
                    else if (rt === 'WEAPON_UPGRADE') { c.moveTo(0, 11); c.lineTo(0, -9); c.moveTo(-8, -1); c.lineTo(0, -10); c.lineTo(8, -1); c.stroke(); }
                    else if (rt === 'TOKEN_DOOR') { c.moveTo(0, -12); c.lineTo(10, 0); c.lineTo(0, 12); c.lineTo(-10, 0); c.closePath(); c.fill(); }
                    else if (rt === 'RISK_REWARD') { c.moveTo(0, -11); c.lineTo(0, 3); c.stroke(); c.beginPath(); c.arc(0, 10, 2.6, 0, Math.PI * 2); c.fill(); }
                    else {   // LUCIDITY: a four-point star
                        c.moveTo(0, -13); c.lineTo(3.5, -3.5); c.lineTo(13, 0); c.lineTo(3.5, 3.5);
                        c.lineTo(0, 13); c.lineTo(-3.5, 3.5); c.lineTo(-13, 0); c.lineTo(-3.5, -3.5); c.closePath(); c.fill();
                    }
                    c.restore();

                    // the label, on a dark plate under the sill
                    c.font = "bold 13px 'Courier New', Courier, monospace";
                    c.textAlign = 'center';
                    c.textBaseline = 'middle';
                    const tw = c.measureText(doorInfo.label).width + 14;
                    c.fillStyle = 'rgba(8, 6, 10, 0.86)';
                    c.fillRect(-tw / 2, H + 12, tw, 20);
                    c.strokeStyle = doorInfo.color;
                    c.lineWidth = 1;
                    c.strokeRect(-tw / 2, H + 12, tw, 20);
                    c.fillStyle = doorInfo.color;
                    c.fillText(doorInfo.label, 0, H + 22.5);
                }
                
                this.ctx.restore();
            });
        }

        if (state.inkPuddles) {
            state.inkPuddles.forEach(p => {
                if (!this.inView(p.x, p.y)) return;   // Patch 112
                const lifeRatio = p.life / 300;
                
                this.ctx.save();
                const pGlowAmt = 15 * lifeRatio;
                this.drawGlow(p.x, p.y, p.radius + pGlowAmt, '#d900ff', 0.5);

                this.ctx.fillStyle = `rgba(80, 10, 120, ${0.8 * lifeRatio})`; 
                
                this.ctx.beginPath();
                for (let i = 0; i < 8; i++) {
                    let angle = (i / 8) * Math.PI * 2;
                    let radiusJitter = p.radius * (0.8 + Math.sin(p.x * p.y + i + this.renderFrame*0.05) * 0.2);
                    let x = p.x + Math.cos(angle) * radiusJitter;
                    let y = p.y + Math.sin(angle) * radiusJitter;
                    if (i === 0) this.ctx.moveTo(x, y);
                    else this.ctx.lineTo(x, y);
                }
                this.ctx.closePath();
                this.ctx.fill();

                this.ctx.fillStyle = `rgba(200, 50, 255, ${0.5 * lifeRatio})`;
                this.ctx.beginPath();
                for (let i = 0; i < 8; i++) {
                    let angle = (i / 8) * Math.PI * 2;
                    let radiusJitter = (p.radius * 0.5) * (0.8 + Math.sin(p.x * p.y + i + this.renderFrame*0.05) * 0.2);
                    let x = p.x + Math.cos(angle) * radiusJitter;
                    let y = p.y + Math.sin(angle) * radiusJitter;
                    if (i === 0) this.ctx.moveTo(x, y);
                    else this.ctx.lineTo(x, y);
                }
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.restore();
            });
        }

        if (state.xpDrops) {
            state.xpDrops.forEach(xp => {
                if (!this.inView(xp.x, xp.y)) return;   // Patch 112
                this.ctx.save();
                this.ctx.translate(xp.x, xp.y);
                
                const time = this.renderFrame * 0.1 + xp.x;
                const pulse = Math.sin(time) * 2;
                
                const dropY = Math.sin(time*2)*3;
                const dropR = 2.5 + pulse*0.5;
                this.drawGlow(0, dropY, dropR + 10, '#88ccff', 0.5);
                
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.arc(0, dropY, dropR, 0, Math.PI*2);
                this.ctx.fill();
                
                this.ctx.strokeStyle = 'rgba(150, 200, 255, 0.6)';
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(0, dropY);
                this.ctx.quadraticCurveTo(-4, -4, -Math.cos(time)*6, -6);
                this.ctx.stroke();
                
                this.ctx.restore();
            });
        }

        if (state.tokenDrops) {
            state.tokenDrops.forEach(token => {
                this.ctx.save();
                this.ctx.translate(token.x, token.y);
                
                const time = this.renderFrame * 0.1 + token.x;
                const pulse = Math.sin(time) * 3;
                
                const tokGlowAmt = 15 + pulse;
                this.drawGlow(0, 0, 10 + tokGlowAmt, token.color, 0.5);
                
                this.ctx.fillStyle = token.color;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 6, 10 + pulse * 0.2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.ellipse(0, -3, 2, 4, 0, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.restore();
            });
        }

        if (state.entities) {
            state.entities.forEach(ent => {
                let isFlashed = ent.flashTime > 0;

                if (ent.type === 'BOSS' && state.sanity <= 0) {
                    if (Math.sin(ent.phase * 10) < 0.5) this.ctx.globalAlpha = 0.2;
                    else this.ctx.globalAlpha = 0.8;
                }

                this.ctx.save(); 
                this.ctx.translate(ent.x, ent.y);
                
                const twitch = state.sanity < 20 ? (Math.random()-0.5)*4 : 0;
                this.ctx.translate(twitch, twitch);

                // Tutorial highlight (Patch 64). Same placement logic as the variant
                // tell below — one code path before the per-type dispatch — but gated on
                // state.isTutorial, which Director sets only for floor 1 room 1 and
                // Combat clears on the first kill, so this can never leak into a normal
                // room. Purpose is legibility, not information: the moment the one
                // enemy in the game is on screen it should read as the thing that
                // matters. Faux-glow via drawGlow, never shadowBlur.
                if (state.isTutorial && ent.hp > 0) {
                    const tutPulse = Math.sin(this.renderFrame * 0.1) * 0.5 + 0.5;
                    const tr = (ent.radius || 15) + 12 + tutPulse * 3;
                    this.drawGlow(0, 0, tr + 24, '#aaffaa', 0.2);
                    this.ctx.strokeStyle = `rgba(170, 255, 170, ${0.35 + tutPulse * 0.3})`;
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, tr, 0, Math.PI * 2);
                    this.ctx.stroke();
                }

                // Enemy variant tell (Patch 24). Drawn once here, before the per-type
                // dispatch, so all three enemy types get it from one code path. A ring
                // rather than a body tint on purpose: Scavenger's body is sprite-cached
                // (a tint would multiply the sprite count by every variant) and both
                // Scavenger and Predator hardcode their fill colours, so ent.color
                // tinting would not show on them at all.
                if (ent.variant && ent.variantTint) {
                    const vr = (ent.radius || 15) + 7 + Math.sin(this.renderFrame * 0.12 + (ent.phase || 0)) * 1.5;
                    this.drawGlow(0, 0, vr + 10, ent.variantTint, 0.28);
                    this.ctx.strokeStyle = ent.variantTint;
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, vr, 0, Math.PI * 2);
                    this.ctx.stroke();
                }

                // Patch 135: under a Fire Warden's ward — a small orange shield arc.
                if (ent.shieldTimer > 0 && ent.type !== 'WARDEN') {
                    const sr = (ent.radius || 15) + 5;
                    this.ctx.strokeStyle = 'rgba(240, 170, 60, 0.75)';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, sr, -Math.PI * 0.85, -Math.PI * 0.15);
                    this.ctx.stroke();
                }

                // Patch 133 (V2 plan D4): a named elite — gold double ring, its name and
                // its own health bar above it, and the body drawn ELITE_SCALE larger
                // (the scale is undone right after the per-type dispatch below).
                const isElite = !!ent.elite;
                if (isElite) {
                    const er = (ent.radius || 22) + 10;
                    this.drawGlow(0, 0, er + 16, '#ffd27f', 0.3);
                    this.ctx.strokeStyle = '#ffd27f';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath(); this.ctx.arc(0, 0, er, 0, Math.PI * 2); this.ctx.stroke();
                    this.ctx.strokeStyle = 'rgba(255, 210, 127, 0.45)';
                    this.ctx.beginPath(); this.ctx.arc(0, 0, er + 5, 0, Math.PI * 2); this.ctx.stroke();
                    const barW = 64, barY = -er - 14;
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                    this.ctx.fillRect(-barW / 2, barY, barW, 5);
                    this.ctx.fillStyle = '#d9a441';
                    this.ctx.fillRect(-barW / 2, barY, barW * Math.max(0, Math.min(1, ent.hp / (ent.maxHp || 1))), 5);
                    this.ctx.font = "bold 14px 'Courier New', Courier, monospace";
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'bottom';
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
                    this.ctx.fillText(ent.eliteName || 'ELITE', 1, barY - 2);
                    this.ctx.fillStyle = '#ffd27f';
                    this.ctx.fillText(ent.eliteName || 'ELITE', 0, barY - 3);
                    this.ctx.save();
                    this.ctx.scale(1.45, 1.45);
                }

                // Patch 168: one presentation layer for every regular enemy, before its
                // own sprite: a ground shadow, a rim glow in its eye colour (dark bodies
                // no longer melt into a dark floor), and the body drawn 30% larger. The
                // hit radius is unchanged. Balanced by the restore after the dispatch.
                const dressed = !isBossType(ent.type) && !ent.burrowed;
                if (dressed) {
                    const pr = ent.radius || 12;
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, pr * 0.85, pr * 1.25, pr * 0.5, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.drawGlow(0, 0, pr * 2.6, EYE_COLOURS[ent.type] || '#ffe9a8', isFlashed ? 0.5 : 0.24);
                    this.ctx.save();
                    const ps = ent.type === 'PARASITE' ? 1.6 : 1.3;   // Patch 169: the parasite was a speck
                    this.ctx.scale(ps, ps);
                }

                if (ent.type === 'ARCHITECT') {
                    this.ctx.save();
                    const archSquash = this.hitSquash(ent);
                    this.ctx.scale(archSquash.x, archSquash.y);

                    let pulse = this.entPulse(ent) * 5;
                    let arming = ent.actionState === 'charging_collapse' || ent.actionState === 'collapse_active';
                    let bursting = ent.actionState === 'burst';

                    const archGlow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 70 + pulse);
                    archGlow.addColorStop(0, arming ? 'rgba(255, 245, 215, 0.65)' : 'rgba(197, 160, 89, 0.5)');
                    archGlow.addColorStop(1, 'rgba(197, 160, 89, 0)');
                    this.ctx.fillStyle = archGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 70 + pulse, 0, Math.PI * 2);
                    this.ctx.fill();

                    // Two overlapping squares, counter-rotating so they scissor against
                    // each other instead of spinning as one rigid 8-point star.
                    let archSpin = this.renderFrame * (arming ? 0.11 : 0.05);
                    const archSquares = [
                        {rot: archSpin,               size: 30, color: '#c5a059', width: 3.5, node: 3.5},
                        {rot: -archSpin + Math.PI/4,  size: 26, color: '#fff6dc', width: 2,   node: 2.5}
                    ];

                    archSquares.forEach(sq => {
                        this.ctx.save();
                        this.ctx.rotate(sq.rot);
                        this.ctx.strokeStyle = isFlashed ? '#ffffff' : sq.color;
                        this.ctx.lineWidth = sq.width;
                        this.ctx.strokeRect(-sq.size, -sq.size, sq.size * 2, sq.size * 2);

                        // corner nodes give the frame joints rather than bare line ends
                        this.ctx.fillStyle = isFlashed ? '#ffffff' : sq.color;
                        [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(c => {
                            this.ctx.beginPath();
                            this.ctx.arc(c[0] * sq.size, c[1] * sq.size, sq.node, 0, Math.PI * 2);
                            this.ctx.fill();
                        });
                        this.ctx.restore();
                    });

                    // Diamond core: dark body, gold rim, faceted, with a pulsing white heart.
                    this.ctx.fillStyle = isFlashed ? '#ddaaaa' : '#111';
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -40);
                    this.ctx.lineTo(25, 0);
                    this.ctx.lineTo(0, 40);
                    this.ctx.lineTo(-25, 0);
                    this.ctx.closePath();
                    this.ctx.fill();

                    this.ctx.strokeStyle = isFlashed ? '#ffffff' : '#c5a059';
                    this.ctx.lineWidth = 2.5;
                    this.ctx.stroke();

                    this.ctx.strokeStyle = 'rgba(197, 160, 89, 0.45)';
                    this.ctx.lineWidth = 1;
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -40); this.ctx.lineTo(0, 40);
                    this.ctx.moveTo(-25, 0); this.ctx.lineTo(25, 0);
                    this.ctx.stroke();

                    let corePulse = 1 + Math.sin(this.renderFrame * (bursting ? 0.4 : 0.12)) * 0.18;
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -15 * corePulse);
                    this.ctx.lineTo(8 * corePulse, 0);
                    this.ctx.lineTo(0, 15 * corePulse);
                    this.ctx.lineTo(-8 * corePulse, 0);
                    this.ctx.closePath();
                    this.ctx.fill();

                    this.ctx.restore();
                }
                else if (ent.type === 'PANOPTICON') {
                    this.ctx.save();
                    const panSquash = this.hitSquash(ent);
                    this.ctx.scale(panSquash.x, panSquash.y);

                    let bob = Math.sin(this.renderFrame * 0.05) * 15;
                    let panicTwitch = (Math.random() - 0.5) * (ent.gazeState === 'charging' ? 8 : 2);
                    this.ctx.translate(panicTwitch, bob + panicTwitch);
                    
                    let angleToPlayer = Math.atan2(state.player.y - ent.y, state.player.x - ent.x);
                    if (ent.gazeState === 'sweeping' || ent.gazeState === 'charging') angleToPlayer = ent.gazeAngle;
                    
                    let charging = ent.gazeState === 'charging';
                    let watching = charging || ent.gazeState === 'sweeping';

                    // Radial spokes: straight tapered wedges radiating from the hub, like
                    // the cell wings of a panopticon. Replaces the old wobbly curved
                    // tendrils, which read organic rather than architectural.
                    let spokeSpin = this.renderFrame * (charging ? 0.05 : 0.012);
                    const spokeCount = 16;
                    for (let i = 0; i < spokeCount; i++) {
                        let sAngle = (i / spokeCount) * Math.PI * 2 + spokeSpin;
                        let long = (i % 2 === 0);
                        let sLen = (long ? 110 : 74) + Math.sin(this.renderFrame * 0.06 + i) * 6;
                        if (charging) sLen += 18;

                        let dirX = Math.cos(sAngle), dirY = Math.sin(sAngle);
                        let perpX = -dirY, perpY = dirX;
                        let halfW = long ? 7 : 4.5;

                        this.ctx.fillStyle = long ? '#7a0a26' : '#4a0016';
                        this.ctx.beginPath();
                        this.ctx.moveTo(dirX * 40 + perpX * halfW, dirY * 40 + perpY * halfW);
                        this.ctx.lineTo(dirX * sLen, dirY * sLen);
                        this.ctx.lineTo(dirX * 40 - perpX * halfW, dirY * 40 - perpY * halfW);
                        this.ctx.closePath();
                        this.ctx.fill();

                        // watch-lamp at each long spoke's tip
                        if (long) {
                            this.ctx.fillStyle = watching ? '#ff96b4' : '#ff2f5e';
                            this.ctx.beginPath();
                            this.ctx.arc(dirX * sLen, dirY * sLen, 3.5, 0, Math.PI * 2);
                            this.ctx.fill();
                        }
                    }

                    // hub ring binding the spokes together
                    this.ctx.strokeStyle = '#ff2f5e';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 52, 0, Math.PI * 2);
                    this.ctx.stroke();

                    const panGlow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 95);
                    panGlow.addColorStop(0, watching ? 'rgba(255, 90, 140, 0.55)' : 'rgba(255, 40, 90, 0.45)');
                    panGlow.addColorStop(1, 'rgba(255, 40, 90, 0)');
                    this.ctx.fillStyle = panGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 95, 0, Math.PI * 2);
                    this.ctx.fill();

                    // Single dominant eye: scaled up so it owns the silhouette, with the
                    // socket, sclera, iris and pupil all sharing the pink/red palette.
                    this.ctx.fillStyle = isFlashed ? '#ffffff' : '#2a0010';
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 48, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = isFlashed ? '#ffffff' : '#ffd6e2';
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 40, 44, angleToPlayer, 0, Math.PI * 2);
                    this.ctx.fill();

                    // veining across the sclera
                    this.ctx.strokeStyle = 'rgba(200, 20, 70, 0.45)';
                    this.ctx.lineWidth = 1.2;
                    for (let v = 0; v < 5; v++) {
                        let vA = angleToPlayer + Math.PI + (v - 2) * 0.45;
                        this.ctx.beginPath();
                        this.ctx.moveTo(Math.cos(vA) * 40, Math.sin(vA) * 40);
                        this.ctx.quadraticCurveTo(Math.cos(vA) * 22, Math.sin(vA) * 22, Math.cos(vA + 0.5) * 12, Math.sin(vA + 0.5) * 12);
                        this.ctx.stroke();
                    }

                    this.ctx.save();
                    this.ctx.rotate(angleToPlayer);

                    this.ctx.fillStyle = watching ? '#ff5c8a' : '#c90f3c';
                    this.ctx.beginPath();
                    this.ctx.ellipse(14, 0, 26, 32, 0, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.strokeStyle = 'rgba(90, 0, 25, 0.8)';
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();

                    this.ctx.fillStyle = '#000';
                    this.ctx.beginPath();
                    let pWidth = charging ? 3 : (ent.gazeState === 'sweeping' ? 16 : 8);
                    this.ctx.ellipse(17, 0, pWidth, 26, 0, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                    this.ctx.beginPath();
                    this.ctx.ellipse(26, -12, 5, 7, -0.4, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.restore();

                    this.ctx.restore();
                }
                else if (ent.type === 'AMALGAMATION') {
                    this.ctx.save();
                    const amalSquash = this.hitSquash(ent);
                    this.ctx.scale(amalSquash.x, amalSquash.y);

                    let pulse = this.entPulse(ent) * 8;
                    let jitterX = (Math.random() - 0.5) * 4;
                    let jitterY = (Math.random() - 0.5) * 4;
                    this.ctx.translate(jitterX, jitterY);

                    if (ent.actionState === 'pulling') {
                        this.ctx.save();
                        let gravPulse = (this.renderFrame * 5) % 150;
                        this.ctx.strokeStyle = `rgba(100, 255, 100, ${1 - (gravPulse / 150)})`;
                        this.ctx.lineWidth = 2;
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, ent.gravityRadius - (gravPulse * 5), 0, Math.PI * 2);
                        this.ctx.stroke();
                        this.ctx.restore();
                    }

                    let grad = this.ctx.createRadialGradient(0, 0, 10, 0, 0, 90 + pulse);
                    grad.addColorStop(0, '#6d9430');
                    grad.addColorStop(0.6, '#1a2a0a');
                    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    this.ctx.fillStyle = grad;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 90 + pulse, 0, Math.PI * 2);
                    this.ctx.fill();

                    let amalAngleToPlayer = Math.atan2(state.player.y - ent.y, state.player.x - ent.x);

                    // Fused mass: mismatched ellipses parked close to the hub so they
                    // overlap into one lumpy body rather than orbiting as separate
                    // satellites. Table is fixed (not per-frame random) so the anatomy
                    // stays stable and only drifts via the phase offsets.
                    const amalLobes = [
                        {dist: 20, ang: 0.0,  rx: 30, ry: 22, rot: 0.3,  spin: 0.010},
                        {dist: 26, ang: 0.9,  rx: 22, ry: 30, rot: -0.5, spin: -0.013},
                        {dist: 16, ang: 1.9,  rx: 34, ry: 19, rot: 1.1,  spin: 0.008},
                        {dist: 24, ang: 2.7,  rx: 19, ry: 24, rot: -0.2, spin: -0.011},
                        {dist: 14, ang: 3.6,  rx: 27, ry: 31, rot: 0.7,  spin: 0.014},
                        {dist: 25, ang: 4.5,  rx: 32, ry: 20, rot: -0.9, spin: -0.009},
                        {dist: 18, ang: 5.4,  rx: 21, ry: 27, rot: 0.5,  spin: 0.012}
                    ];

                    this.ctx.fillStyle = isFlashed ? '#ddaaaa' : ent.color;
                    amalLobes.forEach((lb, m) => {
                        let breath = Math.sin(this.renderFrame * 0.05 + m * 1.3) * 4;
                        let lx = Math.cos(lb.ang) * (lb.dist + breath);
                        let ly = Math.sin(lb.ang) * (lb.dist + breath);
                        this.ctx.beginPath();
                        this.ctx.ellipse(lx, ly, lb.rx + breath, lb.ry - breath * 0.5,
                                         lb.rot + this.renderFrame * lb.spin, 0, Math.PI * 2);
                        this.ctx.fill();
                    });

                    // darker inner bulk, kept inside the outline so the mass gains depth
                    // without breaking the fused silhouette
                    this.ctx.fillStyle = isFlashed ? '#cc9999' : '#1f2f0c';
                    amalLobes.forEach((lb, m) => {
                        let breath = Math.sin(this.renderFrame * 0.05 + m * 1.3) * 4;
                        let lx = Math.cos(lb.ang) * (lb.dist + breath) * 0.7;
                        let ly = Math.sin(lb.ang) * (lb.dist + breath) * 0.7;
                        this.ctx.beginPath();
                        this.ctx.ellipse(lx, ly, lb.rx * 0.55, lb.ry * 0.55,
                                         lb.rot - this.renderFrame * lb.spin, 0, Math.PI * 2);
                        this.ctx.fill();
                    });

                    this.ctx.fillStyle = isFlashed ? '#fff' : '#050505';
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 15 + pulse * 0.4, 0, Math.PI * 2);
                    this.ctx.fill();

                    // Visible small eyes studded across the mass, all tracking the player.
                    // Drawn last so they stay readable over every lobe layer.
                    const amalEyes = [
                        {dist: 30, ang: 0.4,  r: 5.5}, {dist: 22, ang: 1.5, r: 4},
                        {dist: 34, ang: 2.4,  r: 5},   {dist: 19, ang: 3.3, r: 3.5},
                        {dist: 31, ang: 4.2,  r: 6},   {dist: 24, ang: 5.1, r: 4.5},
                        {dist: 12, ang: 6.0,  r: 4}
                    ];

                    amalEyes.forEach((ey, i) => {
                        let drift = Math.sin(this.renderFrame * 0.04 + i * 2.1) * 4;
                        let ex = Math.cos(ey.ang) * (ey.dist + drift);
                        let ey2 = Math.sin(ey.ang) * (ey.dist + drift);

                        // slow asynchronous blink
                        let blink = Math.sin(this.renderFrame * 0.06 + i * 1.7);
                        let lidScale = blink > 0.93 ? 0.15 : 1;

                        this.drawGlow(ex, ey2, ey.r + 8, '#beff5a', 0.45);

                        this.ctx.fillStyle = '#e8ffa8';
                        this.ctx.beginPath();
                        this.ctx.ellipse(ex, ey2, ey.r, ey.r * lidScale, 0, 0, Math.PI * 2);
                        this.ctx.fill();

                        this.ctx.fillStyle = '#0a1400';
                        this.ctx.beginPath();
                        this.ctx.ellipse(ex + Math.cos(amalAngleToPlayer) * ey.r * 0.35,
                                         ey2 + Math.sin(amalAngleToPlayer) * ey.r * 0.35,
                                         ey.r * 0.45, ey.r * 0.45 * lidScale, 0, 0, Math.PI * 2);
                        this.ctx.fill();
                    });

                    if (ent.actionState === 'spawning') {
                        this.ctx.strokeStyle = '#55ff55';
                        this.ctx.lineWidth = 4;
                        this.ctx.setLineDash([10, 10]);
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, 45 + Math.sin(this.renderFrame * 0.2) * 10, 0, Math.PI * 2);
                        this.ctx.stroke();
                        this.ctx.setLineDash([]);
                    }

                    this.ctx.restore();
                }
                else if (ent.type === 'RORSCHACH') {
                    this.ctx.save();
                    const rorSquash = this.hitSquash(ent);
                    this.ctx.scale(rorSquash.x, rorSquash.y);

                    if (ent.shootState === 'telegraphing') {
                        this.ctx.save();
                        this.ctx.rotate(ent.shootAngle);
                        this.ctx.strokeStyle = `rgba(255, 0, 85, ${1 - (ent.shootTimer/45)})`;
                        this.ctx.lineWidth = 2;
                        this.ctx.setLineDash([10, 15]);
                        this.ctx.beginPath();
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(800, 0); 
                        this.ctx.stroke();
                        this.ctx.setLineDash([]);
                        this.ctx.restore();
                    }

                    this.ctx.rotate(this.entPulse(ent, 0.05) * 0.1);
                    let pulse = this.entPulse(ent) * (5 / ent.generation);
                    
                    this.drawGlow(0, 0, ent.radius + 15, '#800080', 0.5);

                    // Inkblot silhouette: an irregular, lumpy half-profile mirrored across
                    // the spine (x=0) via scale(-1,1) — real symmetry, not just a round blob.
                    const rorLobes = [
                        {y: -1.0, x: 0.08}, {y: -0.82, x: 0.55}, {y: -0.5, x: 1.0},
                        {y: -0.28, x: 0.5}, {y: -0.02, x: 0.22}, {y: 0.22, x: 0.58},
                        {y: 0.52, x: 1.08}, {y: 0.8, x: 0.5}, {y: 1.0, x: 0.08}
                    ];

                    for (let mirror = -1; mirror <= 1; mirror += 2) {
                        this.ctx.save();
                        this.ctx.scale(mirror, 1);

                        this.ctx.fillStyle = isFlashed ? '#ddaaaa' : ent.color;
                        this.ctx.beginPath();
                        this.ctx.moveTo(rorLobes[0].x * ent.radius, rorLobes[0].y * ent.radius);
                        for (let i = 0; i < rorLobes.length - 1; i++) {
                            let a = rorLobes[i], b = rorLobes[i + 1];
                            let ctrlX = a.x * (ent.radius + pulse);
                            let ctrlY = a.y * ent.radius;
                            let midX = ((a.x + b.x) / 2) * (ent.radius + pulse);
                            let midY = ((a.y + b.y) / 2) * ent.radius;
                            this.ctx.quadraticCurveTo(ctrlX, ctrlY, midX, midY);
                        }
                        this.ctx.lineTo(rorLobes[rorLobes.length - 1].x * ent.radius, rorLobes[rorLobes.length - 1].y * ent.radius);
                        this.ctx.closePath();
                        this.ctx.fill();

                        this.ctx.strokeStyle = 'rgba(180, 100, 220, 0.4)';
                        this.ctx.lineWidth = 1.5;
                        this.ctx.stroke();

                        this.ctx.fillStyle = isFlashed ? '#fff' : '#ff0055';
                        this.ctx.beginPath();
                        this.ctx.arc(ent.radius*0.3 + this.entPulse(ent)*2, 0, ent.radius*0.1, 0, Math.PI*2);
                        this.ctx.fill();

                        this.ctx.restore();
                    }

                    this.ctx.restore();
                }
                // Patch 135 (V2 plan D4): the three Phase D enemies. Plain paths, no
                // sprites — each is a handful of shapes, and none uses shadowBlur.
                else if (ent.type === 'SPLITTER') {
                    // A photocopied paper figure: a sheet with a smudged face; the
                    // copies (generation 2) are smaller and a shade greyer.
                    const k = ent.generation === 2 ? 0.65 : 1;
                    const sw = Math.sin(ent.phase || 0) * 0.15;
                    this.ctx.save();
                    this.ctx.rotate(sw);
                    this.ctx.scale(k, k);
                    this.ctx.fillStyle = isFlashed ? '#ffffff' : (ent.generation === 2 ? '#b9b2a2' : '#e8e0cc');
                    this.ctx.beginPath();
                    this.ctx.moveTo(-11, -15); this.ctx.lineTo(7, -15); this.ctx.lineTo(12, -10);
                    this.ctx.lineTo(12, 15); this.ctx.lineTo(-11, 15);
                    this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#6b6352';
                    this.ctx.lineWidth = 1.5;
                    this.ctx.stroke();
                    this.ctx.fillStyle = '#2a2620';
                    this.ctx.fillRect(-6, -6, 3, 3);
                    this.ctx.fillRect(3, -6, 3, 3);
                    this.ctx.fillRect(-5, 4, 10, 2);
                    this.ctx.strokeStyle = 'rgba(40, 36, 30, 0.5)';
                    this.ctx.beginPath();
                    this.ctx.moveTo(-11, 9); this.ctx.lineTo(-6, 7); this.ctx.lineTo(-1, 10); this.ctx.lineTo(5, 7); this.ctx.lineTo(12, 9);
                    this.ctx.stroke();
                    this.ctx.restore();
                }
                else if (ent.type === 'WARDEN') {
                    // Hi-vis vest and helmet; its ward is the dashed orange ring.
                    const wr = 150 / (isElite ? 1.45 : 1);   // WARDEN_SHIELD_RADIUS, in world px under the elite scale
                    const pulse = 0.12 + Math.sin(this.renderFrame * 0.08 + (ent.phase || 0)) * 0.05;
                    this.ctx.strokeStyle = `rgba(240, 170, 60, ${pulse + 0.15})`;
                    this.ctx.lineWidth = 2;
                    this.ctx.setLineDash([10, 8]);
                    this.ctx.beginPath(); this.ctx.arc(0, 0, wr, 0, Math.PI * 2); this.ctx.stroke();
                    this.ctx.setLineDash([]);
                    this.ctx.fillStyle = `rgba(240, 170, 60, ${pulse * 0.5})`;
                    this.ctx.fill();
                    this.ctx.fillStyle = isFlashed ? '#ffffff' : '#e0a030';
                    this.ctx.beginPath(); this.ctx.arc(0, 0, 15, 0, Math.PI * 2); this.ctx.fill();
                    this.ctx.fillStyle = '#f4f0d0';
                    this.ctx.fillRect(-15, -3, 30, 4);
                    this.ctx.fillStyle = '#c2381e';
                    this.ctx.beginPath(); this.ctx.arc(0, -6, 8, Math.PI, 0); this.ctx.fill();
                    this.ctx.fillStyle = '#111';
                    this.ctx.fillRect(-5, 3, 3, 3); this.ctx.fillRect(2, 3, 3, 3);
                }
                else if (ent.type === 'BURROWER') {
                    const st = ent.burrowState;
                    if (st === 'burrowed') {
                        // Only the floor moving: a travelling mound of cracks.
                        this.ctx.strokeStyle = 'rgba(160, 125, 85, 0.75)';
                        this.ctx.lineWidth = 2;
                        for (let k = 0; k < 3; k++) {
                            const a = (ent.phase || 0) * 0.7 + k * 2.1;
                            this.ctx.beginPath();
                            this.ctx.moveTo(Math.cos(a) * 4, Math.sin(a) * 4);
                            this.ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14);
                            this.ctx.stroke();
                        }
                        this.ctx.fillStyle = 'rgba(120, 90, 60, 0.6)';
                        this.ctx.beginPath(); this.ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2); this.ctx.fill();
                    } else if (st === 'warning') {
                        // The tell: the eruption's exact radius (ERUPT_RADIUS), filling in.
                        const t = 1 - Math.max(0, ent.burrowTimer) / 50;
                        this.ctx.fillStyle = `rgba(255, 120, 60, ${0.12 + 0.25 * t})`;
                        this.ctx.beginPath(); this.ctx.arc(0, 0, Math.max(0, 70 * t), 0, Math.PI * 2); this.ctx.fill();
                        this.ctx.strokeStyle = `rgba(255, 140, 80, ${0.6 + 0.4 * Math.sin(this.renderFrame * 0.6)})`;
                        this.ctx.lineWidth = 3;
                        this.ctx.beginPath(); this.ctx.arc(0, 0, 70, 0, Math.PI * 2); this.ctx.stroke();
                    } else {
                        // Exposed (or digging back in): a clawed thing half out of the floor.
                        const down = st === 'digging' ? Math.max(0.05, ent.burrowTimer / 24) : 1;
                        this.ctx.save();
                        this.ctx.scale(down, down);
                        this.ctx.fillStyle = 'rgba(70, 50, 30, 0.8)';
                        this.ctx.beginPath(); this.ctx.ellipse(0, 6, 20, 9, 0, 0, Math.PI * 2); this.ctx.fill();
                        this.ctx.fillStyle = isFlashed ? '#ffffff' : '#8a6a46';
                        this.ctx.beginPath(); this.ctx.arc(0, -2, 13, 0, Math.PI * 2); this.ctx.fill();
                        this.ctx.strokeStyle = '#d9c3a0';
                        this.ctx.lineWidth = 2;
                        for (const sx of [-1, 1]) {
                            this.ctx.beginPath();
                            this.ctx.moveTo(sx * 9, -6); this.ctx.lineTo(sx * 17, -14); this.ctx.lineTo(sx * 14, -4);
                            this.ctx.stroke();
                        }
                        this.ctx.fillStyle = '#ffcf7a';
                        this.ctx.fillRect(-5, -5, 3, 3); this.ctx.fillRect(2, -5, 3, 3);
                        this.ctx.restore();
                    }
                }
                else if (ent.type === 'SCAVENGER') {
                    this.ctx.save();
                    const scavSquash = this.hitSquash(ent);
                    this.ctx.scale(scavSquash.x, scavSquash.y);
                    this.ctx.rotate(Math.atan2(ent.vy, ent.vx));
                    
                    if (ent.vacuumState === 'vacuuming') {
                        this.ctx.save();
                        this.ctx.strokeStyle = `rgba(150, 200, 255, ${0.5 + Math.sin(this.renderFrame * 0.5) * 0.5})`;
                        this.ctx.lineWidth = 2;
                        this.ctx.setLineDash([5, 5]);
                        this.ctx.beginPath();
                        let vacPulse = 80 - ((this.renderFrame * 2) % 80);
                        this.ctx.arc(0, 0, vacPulse, 0, Math.PI*2);
                        this.ctx.stroke();
                        this.ctx.restore();
                        
                        this.ctx.translate((Math.random()-0.5)*2, (Math.random()-0.5)*2);
                    }

                    // Body is cached to an offscreen sprite. The breathing bob is
                    // quantised into 0.5px buckets so per-entity phase (and therefore
                    // desync) survives caching — each scavenger picks the bucket its own
                    // phase currently lands in, rather than all sharing one bitmap.
                    // 2 flash states x 2 hp tiers x 9 buckets = 36 sprites, built lazily.
                    let bobQ = Math.round(this.entPulse(ent) * 1.5 * 2) / 2;
                    let sackSize = 10 + (ent.hp > 30 ? 3 : 0);

                    const scavSprite = this.getSprite(
                        `scav2|${isFlashed ? 1 : 0}|${sackSize}|${bobQ}`, 64, 64,
                        (cx) => {
                            // Sack: heavy load dragging behind the hunch, drawn first so the
                            // body's back edge overlaps its top and reads as "carried".
                            cx.fillStyle = isFlashed ? '#f2ead8' : '#2b2536';
                            cx.beginPath();
                            cx.ellipse(-9, 6 + bobQ * 0.5, sackSize, sackSize * 0.85, 0.3, 0, Math.PI * 2);
                            cx.fill();
                            cx.beginPath();
                            cx.ellipse(-14, 2 + bobQ * 0.5, sackSize * 0.6, sackSize * 0.5, 0.2, 0, Math.PI * 2);
                            cx.fill();
                            cx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
                            cx.lineWidth = 1;
                            cx.beginPath();
                            cx.moveTo(-6, 0);
                            cx.lineTo(-11, 3);
                            cx.stroke();

                            // Hunched body: shoulders arch up just behind a low, dropped head,
                            // then slope down toward the rear where the sack tucks in behind.
                            // Patch 168: a shade with a pale rim and two lit eyes, so it
                            // reads against any floor instead of being black on brown.
                            cx.fillStyle = isFlashed ? '#ffffff' : '#3a3148';
                            cx.beginPath();
                            cx.moveTo(13, 4 + bobQ);
                            cx.quadraticCurveTo(10, -11, 2, -9 + bobQ);
                            cx.quadraticCurveTo(-6, -6, -9, bobQ);
                            cx.quadraticCurveTo(-8, 6, -2, 8 + bobQ);
                            cx.quadraticCurveTo(6, 9, 13, 4 + bobQ);
                            cx.closePath();
                            cx.fill();
                            cx.strokeStyle = 'rgba(236, 224, 196, 0.7)';
                            cx.lineWidth = 1.4;
                            cx.stroke();

                            cx.fillStyle = '#ffd24a';
                            cx.beginPath();
                            cx.arc(9.5, -3 + bobQ, 2.1, 0, Math.PI*2);
                            cx.arc(10.5, 3.5 + bobQ, 2.1, 0, Math.PI*2);
                            cx.fill();
                        }
                    );
                    this.drawSprite(scavSprite);

                    // Sweeping arm stays live — it swings independently of the body and
                    // would otherwise multiply the sprite count by every sweep position.
                    this.ctx.strokeStyle = '#d8ccb0';
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    this.ctx.moveTo(4, 6 + bobQ);
                    let sweepOffset = ent.vacuumState === 'vacuuming' ? 0 : this.entPulse(ent, 0.2)*5;
                    this.ctx.lineTo(13 + sweepOffset, 12 + bobQ);
                    this.ctx.stroke();

                    this.ctx.restore();
                }
                else if (ent.type === 'PREDATOR') {
                    this.ctx.save();
                    const predSquash = this.hitSquash(ent);
                    this.ctx.scale(predSquash.x, predSquash.y);

                    if (ent.attackState === 'telegraphing') {
                        this.ctx.rotate(Math.atan2(ent.lungeVy, ent.lungeVx));
                        
                        this.ctx.beginPath();
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(800, 0); 
                        this.ctx.lineWidth = 2;
                        let alpha = (45 - ent.attackTimer) / 45; 
                        this.ctx.strokeStyle = `rgba(255, 0, 0, ${alpha})`;
                        if (ent.attackTimer % 10 > 5) this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                        this.ctx.setLineDash([15, 10]);
                        this.ctx.stroke();
                        this.ctx.setLineDash([]);
                    } else if (ent.attackState === 'lunging') {
                        this.ctx.rotate(Math.atan2(ent.lungeVy, ent.lungeVx));
                        
                        this.ctx.save();
                        this.ctx.globalAlpha = 0.6;
                        const pColor = ent.buffed ? '#ff0000' : '#ff3333';
                        this.ctx.strokeStyle = pColor;
                        this.ctx.lineWidth = 3;
                        this.ctx.lineCap = 'round';
                        
                        this.drawGlow(15, 0, 30, pColor, 0.4);

                        this.ctx.beginPath();
                        this.ctx.moveTo(15, -4);
                        this.ctx.lineTo(15 - (ent.vx * 1.5), -4 - (ent.vy * 1.5));
                        this.ctx.moveTo(15, 4);
                        this.ctx.lineTo(15 - (ent.vx * 1.5), 4 - (ent.vy * 1.5));
                        this.ctx.stroke();
                        this.ctx.restore();

                    } else {
                        this.ctx.rotate(Math.atan2(ent.vy, ent.vx)); 
                    }
                    
                    // Patch 41 (12b): body cached to an offscreen sprite, following the
                    // exact SCAVENGER recipe (Patch 12) — quantise the animating
                    // parameters into buckets so per-entity phase desync survives
                    // caching instead of collapsing every predator onto one shared
                    // bitmap. There are TWO independent pulse terms here (top/bottom
                    // edges use different entPulse offsets and diverge over time), so
                    // BOTH are bucketed and BOTH are in the key — the Patch 11 warning
                    // is explicit that a cache key missing an input renders stale
                    // forever, not just "slightly wrong".
                    // Left OUT of the cache, kept live: the eye (glow + dot) below,
                    // for the same reason Scavenger's sweeping arm stays live — it
                    // reflects attackState (telegraphing/buffed) independently of body
                    // shape, and folding that in would multiply the key space for a
                    // cheap two-draw element that isn't worth caching.
                    const lunging = ent.attackState === 'lunging';
                    let stretch = lunging ? 5 : 0;
                    // Patch 111: whole-unit buckets (were half-unit). entPulse mixes two
                    // frequencies, so A and B do not trace a circle — they fill the whole
                    // square, and at 0.5 steps that was 11x11 = 121 sprites (64 KB each)
                    // per flag combination: the headless soak held ~340 predator sprites,
                    // ~21 MB, and still climbing. Whole units give 7x7 = 49 per combination
                    // for a 1px-vs-0.5px step in the body-edge breathing.
                    let pulseA = Math.round(this.entPulse(ent, 0.2) * 2);
                    let pulseB = Math.round(this.entPulse(ent, 0.2, Math.PI/2) * 2);
                    // Patch 169: crimson with a pale rim (was #111 on a dark floor).
                    const predColor = isFlashed ? '#ffe0d8' : (ent.buffed ? '#8a1414' : '#5c1622');

                    const predSprite = this.getSprite(
                        `pred2|${isFlashed ? 1 : 0}|${ent.buffed ? 1 : 0}|${lunging ? 1 : 0}|${pulseA}|${pulseB}`, 64, 64,
                        (cx) => {
                            cx.fillStyle = predColor;
                            cx.beginPath();

                            // Low, elongated body: pointed snout forward, long low belly,
                            // tapering tail behind. Kept flatter (smaller y-extent) than the
                            // old hexagon so it reads as ground-hugging rather than round.
                            cx.moveTo(20 + stretch, 0);
                            cx.lineTo(9, 5 + pulseA);
                            cx.lineTo(-11 - stretch, 5);
                            cx.lineTo(-23 - stretch, 0);
                            cx.lineTo(-11 - stretch, -5);
                            cx.lineTo(9, -5 - pulseB);
                            cx.closePath();
                            cx.fill();
                            cx.strokeStyle = 'rgba(255, 176, 160, 0.75)';
                            cx.lineWidth = 1.3;
                            cx.stroke();

                            // Jagged spine: serrated ridge along the top edge, tail to shoulders.
                            cx.beginPath();
                            let spineStartX = -20 - stretch;
                            let spineEndX = 8;
                            let spikes = 5;
                            cx.moveTo(spineStartX, -4);
                            for (let i = 1; i <= spikes; i++) {
                                let t = i / spikes;
                                let x = spineStartX + (spineEndX - spineStartX) * t;
                                let spikeH = (i % 2 === 0) ? -12 : -6;
                                cx.lineTo(x, spikeH);
                            }
                            cx.lineTo(spineEndX, -4);
                            cx.closePath();
                            cx.fillStyle = isFlashed ? '#ffffff' : '#a02c38';
                            cx.fill();

                            cx.strokeStyle = predColor;
                            cx.lineWidth = 2;
                            cx.beginPath();

                            if (lunging) {
                                cx.moveTo(-2, 5);
                                cx.lineTo(-22, 9);
                                cx.moveTo(-2, -5);
                                cx.lineTo(-22, -9);
                            } else {
                                cx.moveTo(-2, 5);
                                cx.quadraticCurveTo(8, 13, 12, 4);
                                cx.moveTo(-2, -5);
                                cx.quadraticCurveTo(8, -13, 12, -4);
                            }
                            cx.stroke();
                        }
                    );
                    this.drawSprite(predSprite);

                    const predGlowAmt = (ent.attackState === 'telegraphing') ? 20 : 10;
                    const predEyeColor = (ent.attackState === 'telegraphing') ? '#ffffff' : (ent.buffed ? '#ff5040' : '#ff7a5a');

                    // Single glowing red eye, centered on the snout.
                    this.drawGlow(13 + stretch, 0, 10 + predGlowAmt, predEyeColor, 0.5);

                    this.ctx.fillStyle = predEyeColor;
                    this.ctx.beginPath();
                    this.ctx.ellipse(13 + stretch, 0, 4, 2.8, 0, 0, Math.PI*2);
                    this.ctx.fill();

                    this.ctx.restore();
                }
                else if (ent.type === 'PARASITE') {
                    this.ctx.save();
                    const paraSquash = this.hitSquash(ent);
                    this.ctx.scale(paraSquash.x, paraSquash.y);

                    // Body spin carries the entity's phase so parasites don't all rotate
                    // in unison. The tether below cancels the exact same expression, so
                    // these two must stay in step if either is ever changed.
                    let paraSpin = this.renderFrame * 0.2 + (ent.phase || 0);
                    this.ctx.rotate(paraSpin);

                    if (ent.lashingState === 'lashing' && ent.lashTarget) {
                        this.ctx.save();
                        let dx = ent.lashTarget.x - ent.x;
                        let dy = ent.lashTarget.y - ent.y;

                        this.ctx.rotate(-paraSpin);

                        this.ctx.strokeStyle = `rgba(255, 100, 100, ${1 - (ent.lashTimer/30)})`;
                        this.ctx.lineWidth = 3;
                        this.ctx.beginPath();
                        this.ctx.moveTo(0,0);
                        this.ctx.lineTo(dx, dy);
                        this.ctx.stroke();
                        
                        this.ctx.restore();
                    }

                    let pulse = this.entPulse(ent, 0.3) * 1.5;
                    if (ent.lashingState === 'lashing') pulse = this.entPulse(ent, 1.5) * 3;

                    let curl = ent.lashingState === 'lashing' ? 0.5 : 0;

                    // Radial tendrils: tapered (wide at core, thin at tip) filled shapes
                    // instead of uniform-width strokes, so they read as flesh, not wire.
                    this.ctx.fillStyle = isFlashed ? '#ffffff' : ent.color;
                    for (let i = 0; i < 8; i++) {
                        let angle = (i/8) * Math.PI * 2 + (this.entPulse(ent, 0.5, i)*0.2) + curl;
                        let length = 10 + Math.random() * 4;
                        if (ent.lashingState === 'lashing') length -= 3;

                        let dirX = Math.cos(angle), dirY = Math.sin(angle);
                        let perpX = -dirY, perpY = dirX;
                        let baseW = 1.6;
                        let midX = dirX * (length * 0.55) + Math.cos(angle + 0.3) * 2;
                        let midY = dirY * (length * 0.55) + Math.sin(angle + 0.3) * 2;

                        this.ctx.beginPath();
                        this.ctx.moveTo(dirX*4 + perpX*baseW, dirY*4 + perpY*baseW);
                        this.ctx.quadraticCurveTo(midX + perpX*baseW*0.4, midY + perpY*baseW*0.4, dirX*length, dirY*length);
                        this.ctx.quadraticCurveTo(midX - perpX*baseW*0.4, midY - perpY*baseW*0.4, dirX*4 - perpX*baseW, dirY*4 - perpY*baseW);
                        this.ctx.closePath();
                        this.ctx.fill();
                    }

                    // Small core: faint faux-glow behind a compact body and dark nucleus,
                    // drawn after the tendrils so it stays the visual focal point.
                    //
                    // Patch 41 (12b): the two fills below ARE cached (same quantised-bucket
                    // recipe as Scavenger/Predator above) — they depend only on
                    // (isFlashed, pulse), both deterministic per frame. The 8 tendrils
                    // above are deliberately left OUT of caching and OUT of this key:
                    // they call raw Math.random() every frame (`length = 10 +
                    // Math.random()*4`), which is what gives the parasite its organic
                    // wriggle. Math.random() cannot be bucketed into a cache key — baking
                    // it into a cached sprite would freeze that jitter into one static
                    // shape per bucket, trading a real animated detail for a cache hit.
                    // drawGlow() is also left live and outside this cache, unchanged from
                    // before — it already does its own (color, alpha) caching, and
                    // composing it into this sprite would just double-cache the same glow.
                    const paraGlowAmt = 6 + pulse;
                    this.drawGlow(0, 0, 5 + paraGlowAmt, isFlashed ? '#ffcccc' : '#6b2222', 0.4);

                    let pulseQ = Math.round(pulse * 2) / 2;
                    const paraSprite = this.getSprite(
                        `para|${isFlashed ? 1 : 0}|${pulseQ}`, 24, 24,
                        (cx) => {
                            cx.fillStyle = isFlashed ? '#ffcccc' : '#6b2222';
                            cx.beginPath();
                            cx.arc(0, 0, 5 + pulseQ, 0, Math.PI*2);
                            cx.fill();

                            cx.fillStyle = '#050505';
                            cx.beginPath();
                            cx.arc(0, 0, 2 + pulseQ*0.5, 0, Math.PI*2);
                            cx.fill();
                        }
                    );
                    this.drawSprite(paraSprite);

                    this.ctx.restore();
                }
                else if (ent.type === 'BOSS') {
                    this.ctx.save();
                    const bossSquash = this.hitSquash(ent);
                    this.ctx.scale(bossSquash.x, bossSquash.y);

                    try {
                        if (ent.pulseState === 'charging' || ent.pulseState === 'pulsing') {
                            this.ctx.save();
                            this.ctx.strokeStyle = ent.pulseState === 'pulsing' ? 'rgba(255, 50, 50, 0.8)' : `rgba(255, 100, 100, ${1 - (ent.pulseTimer/60)})`;
                            this.ctx.lineWidth = ent.pulseState === 'pulsing' ? 10 : 3;
                            this.ctx.beginPath();
                            this.ctx.arc(0, 0, ent.pulseState === 'pulsing' ? ent.maxPulseRadius : ent.pulseRadius, 0, Math.PI*2);
                            this.ctx.stroke();
                            
                            if (ent.pulseState === 'pulsing') {
                                this.ctx.fillStyle = 'rgba(255, 50, 50, 0.3)';
                                this.ctx.fill();
                            }
                            this.ctx.restore();
                        }

                        let phase = ent.phase || 0;
                        this.ctx.rotate(Math.sin(phase * 0.5) * 0.1); 
                        
                        let pulse = this.entPulse(ent) * 3;
                        if (ent.pulseState === 'charging') {
                            pulse = Math.sin(this.renderFrame * 0.5) * 5; 
                            this.ctx.translate((Math.random()-0.5)*5, (Math.random()-0.5)*5); 
                        }

                        const activeBoss = state.activeBoss;
                        const orbR = 26;

                        // Real tendril anatomy: curved (quadratic) limbs radiating from the
                        // orb, tapered via a thick base segment + thinner tip segment,
                        // instead of the old jagged-polygon "spike ball" silhouette.
                        const tendrilCount = 6;
                        const tendrils = [];
                        for (let i = 0; i < tendrilCount; i++) {
                            let angle = (i / tendrilCount) * Math.PI * 2 + phase * 0.15;
                            let reach = 42 + Math.sin(phase * 3 + i * 2) * 12;
                            if (ent.pulseState === 'charging') reach -= 12;
                            let perpX = -Math.sin(angle), perpY = Math.cos(angle);
                            let wave = Math.sin(phase * 4 + i * 1.7) * 10;
                            tendrils.push({
                                baseX: Math.cos(angle) * (orbR - 4), baseY: Math.sin(angle) * (orbR - 4),
                                ctrlX: Math.cos(angle) * (orbR + reach * 0.55) + perpX * wave,
                                ctrlY: Math.sin(angle) * (orbR + reach * 0.55) + perpY * wave,
                                tipX: Math.cos(angle) * (orbR + reach), tipY: Math.sin(angle) * (orbR + reach),
                                angle
                            });
                        }

                        this.ctx.strokeStyle = isFlashed ? '#ddaaaa' : '#1a0d15';
                        this.ctx.lineCap = 'round';
                        tendrils.forEach(t => {
                            this.ctx.beginPath();
                            this.ctx.moveTo(t.baseX, t.baseY);
                            this.ctx.lineTo(t.ctrlX, t.ctrlY);
                            this.ctx.lineWidth = 7;
                            this.ctx.stroke();
                            this.ctx.beginPath();
                            this.ctx.moveTo(t.ctrlX, t.ctrlY);
                            this.ctx.lineTo(t.tipX, t.tipY);
                            this.ctx.lineWidth = 3;
                            this.ctx.stroke();
                        });

                        // Floating orb: drawn over the tendril bases so they read as
                        // emerging from beneath it.
                        const orbGrad = this.ctx.createRadialGradient(-8, -8, 4, 0, 0, orbR + pulse);
                        orbGrad.addColorStop(0, isFlashed ? '#ffffff' : '#3a1d25');
                        orbGrad.addColorStop(1, isFlashed ? '#ddaaaa' : '#1a0d15');
                        this.ctx.fillStyle = orbGrad;
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, orbR + pulse, 0, Math.PI * 2);
                        this.ctx.fill();

                        // Multiple eyes along the tendrils, one per limb, positioned at
                        // its curve point rather than fixed on the body.
                        const glowAmount = (activeBoss && activeBoss.pulseState === 'charging') ? 30 : 15;
                        tendrils.forEach((t, i) => {
                            let et = 0.55 + (i % 2) * 0.25;
                            let mt = 1 - et;
                            const eyeX = mt*mt*t.baseX + 2*mt*et*t.ctrlX + et*et*t.tipX;
                            const eyeY = mt*mt*t.baseY + 2*mt*et*t.ctrlY + et*et*t.tipY;
                            const eyeR = 3 + (i % 3);

                            this.drawGlow(eyeX, eyeY, eyeR + glowAmount, '#ff0000', 0.5);

                            this.ctx.fillStyle = '#ff0000';
                            this.ctx.beginPath();
                            this.ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI*2);
                            this.ctx.fill();

                            this.ctx.fillStyle = '#000000';
                            this.ctx.beginPath();
                            this.ctx.ellipse(eyeX, eyeY, eyeR * 0.2, eyeR * 0.8, t.angle, 0, Math.PI*2);
                            this.ctx.fill();
                        });

                        this.ctx.strokeStyle = '#555';
                        this.ctx.lineWidth = 3;
                        this.ctx.lineCap = 'round';
                        for(let i=0; i<3; i++) {
                            let orbitAngle = phase * (1 + i*0.5) + (i * Math.PI*0.6);
                            let dist = 45 + Math.sin(phase * 2 + i) * 5;
                            if (activeBoss && activeBoss.pulseState === 'charging') orbitAngle += this.renderFrame * 0.2;
                            let objX = Math.cos(orbitAngle) * dist;
                            let objY = Math.sin(orbitAngle) * dist;
                            this.ctx.beginPath();
                            this.ctx.moveTo(objX - 5, objY - 5);
                            this.ctx.lineTo(objX + 5, objY + 5);
                            this.ctx.stroke();
                        }
                    } catch(bossError) {
                        console.warn("Recoverable boss rendering error:", bossError);
                        errorLog.capture(bossError, 'renderer-boss-draw');
                    } finally {
                        // finally, not just a trailing restore() — the try above is there
                        // specifically so a mid-draw exception doesn't crash the render
                        // loop, and the new save() at branch start must never be left
                        // unbalanced (which would silently corrupt every render after it).
                        this.ctx.restore();
                    }
                }

                if (dressed) this.ctx.restore();   // Patch 168: undo the presentation scale
                if (isElite) this.ctx.restore();   // Patch 133: undo the elite scale

                if (!isElite && ent.hp < ent.maxHp && ent.flashTime <= 0 && !isBossType(ent.type)) {
                    let barW = 24;
                    let yOffset = 20;
                    
                    this.ctx.fillStyle = 'rgba(0,0,0,0.8)'; 
                    this.ctx.fillRect(-barW/2, yOffset, barW, 4);
                    this.ctx.fillStyle = '#8b0000'; 
                    this.ctx.fillRect(-barW/2, yOffset, barW * Math.max(0, ent.hp / ent.maxHp), 4);
                }

                this.ctx.restore();
                this.ctx.globalAlpha = 1.0;
            });
        }

        if (state.particles) {
            // Patch 39: was a flat 2px line from the particle back to
            // (x - vx*2, y - vy*2) — every particle identical regardless of how
            // fast it was moving or what spawned it. Streak length now follows
            // ACTUAL speed, so a fresh burst streaks hard and then resolves into
            // settling embers as the new drag takes hold, and bright particles
            // get a cached faux-glow head.
            state.particles.forEach(p => {
                if (!this.inView(p.x, p.y)) return;   // Patch 112
                const life = Math.max(0, Math.min(1, p.life));
                if (life <= 0) return;
                const speed = Math.hypot(p.vx, p.vy);
                if (!Number.isFinite(speed) || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;

                const size = (p.size || 2) * (0.35 + life * 0.65);
                const tail = Math.min(speed * 2.2, 14);

                // drawGlow is sprite-cached on `glow|color|alpha`, so the alpha
                // MUST be quantised — handing it a continuous per-particle value
                // would mint a fresh 128px canvas per particle per frame and blow
                // the cache out entirely. Same bucketing discipline the Patch 11
                // sprite cache uses. Also: hexToRgba returns WHITE for non-hex
                // input, and the footstep dust colour is an rgba() string, so
                // glow is restricted to hex colours or that dust would flash white.
                if (size > 1.2 && p.color && p.color.charAt(0) === '#') {
                    const glowA = Math.round(life * 4) / 10;
                    if (glowA > 0) this.drawGlow(p.x, p.y, size * 3, p.color, glowA);
                }

                this.ctx.globalAlpha = life;
                if (tail > 1.5) {
                    this.ctx.strokeStyle = p.color;
                    this.ctx.lineCap = 'round';
                    this.ctx.lineWidth = size;
                    this.ctx.beginPath();
                    this.ctx.moveTo(p.x, p.y);
                    this.ctx.lineTo(p.x - (p.vx / speed) * tail, p.y - (p.vy / speed) * tail);
                    this.ctx.stroke();
                } else {
                    // Too slow for a streak — it would read as a stray hair.
                    this.ctx.fillStyle = p.color;
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, Math.max(0.5, size * 0.5), 0, Math.PI * 2);
                    this.ctx.fill();
                }
            });
            // lineCap was changed above; reset it so it can't leak into later draws.
            this.ctx.lineCap = 'butt';
        }
        this.ctx.globalAlpha = 1.0;
    }

    drawDamageText(state) {
        this.ctx.save();
        this.ctx.textAlign = 'center';
        
        if (state.damageTexts) {
            state.damageTexts.forEach(dt => {
                this.ctx.globalAlpha = Math.max(0, Math.min(1, dt.life));
                this.ctx.font = `bold ${Math.floor((20 * dt.scale)/this.zoom)}px 'Courier New', Courier, monospace`;
                this.ctx.fillStyle = dt.color;
                this.ctx.lineWidth = 2;
                this.ctx.strokeStyle = '#000';
                this.ctx.strokeText(dt.text, dt.x, dt.y);
                this.ctx.fillText(dt.text, dt.x, dt.y);
            });
        }
        
        this.ctx.restore();
    }

    drawBossAnnouncement(state) {
        this.ctx.save();
        try {
            const activeBoss = state.activeBoss;
            const bossType = activeBoss ? activeBoss.type : 'BOSS';
            
            // Patch 71: vertically on the camera centre, so in portrait the banner
            // lands across the world view instead of half-buried in the control band.
            // Same value as canvas.height / 2 on every other layout.
            const cx = this.canvas.width / 2;
            const cy = Number.isFinite(this.cameraCenterY) ? this.cameraCenterY : this.canvas.height / 2;

            let alpha = 1;
            if (this.bossAnnouncementTimer > 210) {
                alpha = (240 - this.bossAnnouncementTimer) / 30; 
            } else if (this.bossAnnouncementTimer < 30) {
                alpha = this.bossAnnouncementTimer / 30; 
            }

            this.ctx.globalAlpha = alpha;
            this.ctx.translate(cx, cy);

            // Patch 77 — the whole banner is laid out from the viewport now.
            //
            // Everything here was fixed: a 600px-tall panel and a portrait drawn at
            // x = -400 at scale 5.5, so the art (local radius ~40) spanned roughly
            // x = -620..-180. That needs ~1240px of width to sit on screen, and the
            // panel needs 600px of height. Below either, the boss's own portrait — the
            // one moment the game shows you what is about to fight you — was cut off by
            // the screen edge, and on a phone in landscape the panel was taller than
            // the display.
            //
            // Two layouts. Wide keeps the desktop composition (portrait left, name
            // right) and only shrinks/pulls in the portrait when the width demands it —
            // at 1920 and 1366 the numbers come out identical to before. Narrow stacks
            // them, because below ~720px there is no room for two columns and Patch 63
            // already centres the text there; a side-by-side portrait would land under
            // the name.
            const PANEL_H = Math.min(300, Math.max(150, this.canvas.height * 0.42));
            const ART_R = 40;               // local-space radius the boss art occupies
            const narrowBanner = this.canvas.width < 720;

            this.ctx.fillStyle = 'rgba(10, 0, 0, 0.95)';
            this.ctx.fillRect(-this.canvas.width/2, -PANEL_H, this.canvas.width, PANEL_H * 2);

            if (this.renderFrame % 3 === 0) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                for (let i=0; i<15; i++) {
                    this.ctx.fillRect(-this.canvas.width/2, -PANEL_H + Math.random() * PANEL_H * 2, this.canvas.width, 5 + Math.random() * 15);
                }
            }

            this.ctx.strokeStyle = '#c5a059';
            this.ctx.lineWidth = 6;
            this.ctx.beginPath();
            this.ctx.moveTo(-this.canvas.width/2, -PANEL_H); this.ctx.lineTo(this.canvas.width/2, -PANEL_H);
            this.ctx.moveTo(-this.canvas.width/2, PANEL_H); this.ctx.lineTo(this.canvas.width/2, PANEL_H);
            this.ctx.stroke();

            // Title/subtitle sizes are capped by the panel as well as by the width, so a
            // short panel cannot stack three items that do not fit in it.
            const titleBase = Math.min(110, PANEL_H * 0.38);
            const subBase = Math.min(45, PANEL_H * 0.17);

            let portraitScale, portraitX, portraitY, titleY, subY;
            if (narrowBanner) {
                // Stacked and centred as one block.
                const r = Math.min(220, PANEL_H * 0.5, this.canvas.width * 0.18);
                const blockH = r * 2 + 10 + titleBase + 6 + subBase;
                const top = -blockH / 2;
                portraitScale = r / ART_R;
                portraitX = 0;
                portraitY = top + r;
                titleY = top + r * 2 + 10 + titleBase / 2;
                subY = titleY + titleBase / 2 + 6 + subBase / 2;
            } else {
                // Side by side. The portrait's band is everything left of the text,
                // which Patch 63 anchors at x = -100.
                const r = Math.min(220, (this.canvas.width / 2 - 132) / 2, PANEL_H * 0.75);
                portraitScale = Math.max(1.5, r / ART_R);
                const rr = ART_R * portraitScale;
                // Preferred -400, but never overlapping the name and never off screen.
                portraitX = Math.max(-this.canvas.width / 2 + 12 + rr, Math.min(-120 - rr, -400));
                portraitY = 0;
                titleY = -50;
                subY = 60;
            }

            this.ctx.save();
            this.ctx.translate(portraitX, portraitY);
            this.ctx.scale(portraitScale, portraitScale);

            const simulatedPhase = this.renderFrame * 0.05;
            this.ctx.rotate(Math.sin(simulatedPhase * 0.5) * 0.1); 

            if (bossType === 'RORSCHACH') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 3;
                const rorGlow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 30 + 10);
                rorGlow.addColorStop(0, 'rgba(128, 0, 128, 0.5)');
                rorGlow.addColorStop(1, 'rgba(128, 0, 128, 0)');
                this.ctx.fillStyle = rorGlow;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 40, 0, Math.PI * 2);
                this.ctx.fill();

                // Mirrors the in-world inkblot lobe profile. This panel has its own
                // coordinate scale, so radius is a local constant rather than ent.radius.
                const rorR = 30;
                const rorLobes = [
                    {y: -1.0, x: 0.08}, {y: -0.82, x: 0.55}, {y: -0.5, x: 1.0},
                    {y: -0.28, x: 0.5}, {y: -0.02, x: 0.22}, {y: 0.22, x: 0.58},
                    {y: 0.52, x: 1.08}, {y: 0.8, x: 0.5}, {y: 1.0, x: 0.08}
                ];

                for (let mirror = -1; mirror <= 1; mirror += 2) {
                    this.ctx.save();
                    this.ctx.scale(mirror, 1);

                    this.ctx.fillStyle = '#1a0525';
                    this.ctx.beginPath();
                    this.ctx.moveTo(rorLobes[0].x * rorR, rorLobes[0].y * rorR);
                    for (let i = 0; i < rorLobes.length - 1; i++) {
                        let a = rorLobes[i], b = rorLobes[i + 1];
                        let ctrlX = a.x * (rorR + pulse);
                        let ctrlY = a.y * rorR;
                        let midX = ((a.x + b.x) / 2) * (rorR + pulse);
                        let midY = ((a.y + b.y) / 2) * rorR;
                        this.ctx.quadraticCurveTo(ctrlX, ctrlY, midX, midY);
                    }
                    this.ctx.lineTo(rorLobes[rorLobes.length - 1].x * rorR, rorLobes[rorLobes.length - 1].y * rorR);
                    this.ctx.closePath();
                    this.ctx.fill();

                    this.ctx.strokeStyle = 'rgba(180, 100, 220, 0.4)';
                    this.ctx.lineWidth = 1.5;
                    this.ctx.stroke();

                    this.ctx.fillStyle = '#ff0055';
                    this.ctx.beginPath();
                    this.ctx.arc(rorR*0.3 + Math.sin(simulatedPhase)*2, 0, 3, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.restore();
                }

            } else if (bossType === 'PANOPTICON') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 3;
                
                // In-world proportions scaled to this panel's smaller footprint.
                const panS = 0.73;

                let panSpin = this.renderFrame * 0.012;
                const panSpokes = 16;
                for (let i = 0; i < panSpokes; i++) {
                    let sAngle = (i / panSpokes) * Math.PI * 2 + panSpin;
                    let long = (i % 2 === 0);
                    let sLen = ((long ? 110 : 74) + Math.sin(this.renderFrame * 0.06 + i) * 6) * panS;

                    let dirX = Math.cos(sAngle), dirY = Math.sin(sAngle);
                    let perpX = -dirY, perpY = dirX;
                    let halfW = (long ? 7 : 4.5) * panS;
                    let inner = 40 * panS;

                    this.ctx.fillStyle = long ? '#7a0a26' : '#4a0016';
                    this.ctx.beginPath();
                    this.ctx.moveTo(dirX * inner + perpX * halfW, dirY * inner + perpY * halfW);
                    this.ctx.lineTo(dirX * sLen, dirY * sLen);
                    this.ctx.lineTo(dirX * inner - perpX * halfW, dirY * inner - perpY * halfW);
                    this.ctx.closePath();
                    this.ctx.fill();

                    if (long) {
                        this.ctx.fillStyle = '#ff2f5e';
                        this.ctx.beginPath();
                        this.ctx.arc(dirX * sLen, dirY * sLen, 3.5 * panS, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                }

                this.ctx.strokeStyle = '#ff2f5e';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 52 * panS, 0, Math.PI * 2);
                this.ctx.stroke();

                const panGlow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 95 * panS);
                panGlow.addColorStop(0, 'rgba(255, 40, 90, 0.45)');
                panGlow.addColorStop(1, 'rgba(255, 40, 90, 0)');
                this.ctx.fillStyle = panGlow;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 95 * panS, 0, Math.PI * 2);
                this.ctx.fill();

                // single dominant eye, slowly scanning since there is no live gazeAngle here
                let panLook = Math.sin(simulatedPhase * 0.6) * 0.5;

                this.ctx.fillStyle = '#2a0010';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 48 * panS, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#ffd6e2';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 40 * panS, 44 * panS, panLook, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.strokeStyle = 'rgba(200, 20, 70, 0.45)';
                this.ctx.lineWidth = 1.2;
                for (let v = 0; v < 5; v++) {
                    let vA = panLook + Math.PI + (v - 2) * 0.45;
                    this.ctx.beginPath();
                    this.ctx.moveTo(Math.cos(vA) * 40 * panS, Math.sin(vA) * 40 * panS);
                    this.ctx.quadraticCurveTo(Math.cos(vA) * 22 * panS, Math.sin(vA) * 22 * panS,
                                              Math.cos(vA + 0.5) * 12 * panS, Math.sin(vA + 0.5) * 12 * panS);
                    this.ctx.stroke();
                }

                this.ctx.save();
                this.ctx.rotate(panLook);

                this.ctx.fillStyle = '#c90f3c';
                this.ctx.beginPath();
                this.ctx.ellipse(14 * panS, 0, 26 * panS, 32 * panS, 0, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.strokeStyle = 'rgba(90, 0, 25, 0.8)';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                this.ctx.fillStyle = '#000';
                this.ctx.beginPath();
                this.ctx.ellipse(17 * panS, 0, (8 + pulse * 0.5) * panS, 26 * panS, 0, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                this.ctx.beginPath();
                this.ctx.ellipse(26 * panS, -12 * panS, 5 * panS, 7 * panS, -0.4, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.restore();
            } else if (bossType === 'AMALGAMATION') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 5;
                // In-world proportions scaled to this panel's smaller footprint.
                const amalS = 0.75;

                const amalGrad = this.ctx.createRadialGradient(0, 0, 10 * amalS, 0, 0, (90 + pulse) * amalS);
                amalGrad.addColorStop(0, '#6d9430');
                amalGrad.addColorStop(0.6, '#1a2a0a');
                amalGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                this.ctx.fillStyle = amalGrad;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, (90 + pulse) * amalS, 0, Math.PI * 2);
                this.ctx.fill();

                const amalLobes = [
                    {dist: 20, ang: 0.0,  rx: 30, ry: 22, rot: 0.3,  spin: 0.010},
                    {dist: 26, ang: 0.9,  rx: 22, ry: 30, rot: -0.5, spin: -0.013},
                    {dist: 16, ang: 1.9,  rx: 34, ry: 19, rot: 1.1,  spin: 0.008},
                    {dist: 24, ang: 2.7,  rx: 19, ry: 24, rot: -0.2, spin: -0.011},
                    {dist: 14, ang: 3.6,  rx: 27, ry: 31, rot: 0.7,  spin: 0.014},
                    {dist: 25, ang: 4.5,  rx: 32, ry: 20, rot: -0.9, spin: -0.009},
                    {dist: 18, ang: 5.4,  rx: 21, ry: 27, rot: 0.5,  spin: 0.012}
                ];

                this.ctx.fillStyle = '#3a4a1a';
                amalLobes.forEach((lb, m) => {
                    let breath = Math.sin(this.renderFrame * 0.05 + m * 1.3) * 4;
                    this.ctx.beginPath();
                    this.ctx.ellipse(Math.cos(lb.ang) * (lb.dist + breath) * amalS,
                                     Math.sin(lb.ang) * (lb.dist + breath) * amalS,
                                     (lb.rx + breath) * amalS, (lb.ry - breath * 0.5) * amalS,
                                     lb.rot + this.renderFrame * lb.spin, 0, Math.PI * 2);
                    this.ctx.fill();
                });

                this.ctx.fillStyle = '#1f2f0c';
                amalLobes.forEach((lb, m) => {
                    let breath = Math.sin(this.renderFrame * 0.05 + m * 1.3) * 4;
                    this.ctx.beginPath();
                    this.ctx.ellipse(Math.cos(lb.ang) * (lb.dist + breath) * 0.7 * amalS,
                                     Math.sin(lb.ang) * (lb.dist + breath) * 0.7 * amalS,
                                     lb.rx * 0.55 * amalS, lb.ry * 0.55 * amalS,
                                     lb.rot - this.renderFrame * lb.spin, 0, Math.PI * 2);
                    this.ctx.fill();
                });

                this.ctx.fillStyle = '#050505';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, (15 + pulse * 0.4) * amalS, 0, Math.PI * 2);
                this.ctx.fill();

                const amalEyes = [
                    {dist: 30, ang: 0.4,  r: 5.5}, {dist: 22, ang: 1.5, r: 4},
                    {dist: 34, ang: 2.4,  r: 5},   {dist: 19, ang: 3.3, r: 3.5},
                    {dist: 31, ang: 4.2,  r: 6},   {dist: 24, ang: 5.1, r: 4.5},
                    {dist: 12, ang: 6.0,  r: 4}
                ];

                // no player to track from the announcement panel, so the eyes rove together
                let amalLook = simulatedPhase * 0.7;

                amalEyes.forEach((ey, i) => {
                    let drift = Math.sin(this.renderFrame * 0.04 + i * 2.1) * 4;
                    let ex = Math.cos(ey.ang) * (ey.dist + drift) * amalS;
                    let ey2 = Math.sin(ey.ang) * (ey.dist + drift) * amalS;
                    let r = ey.r * amalS;

                    let blink = Math.sin(this.renderFrame * 0.06 + i * 1.7);
                    let lidScale = blink > 0.93 ? 0.15 : 1;

                    const aGlow = this.ctx.createRadialGradient(ex, ey2, 0, ex, ey2, r + 8 * amalS);
                    aGlow.addColorStop(0, 'rgba(190, 255, 90, 0.45)');
                    aGlow.addColorStop(1, 'rgba(190, 255, 90, 0)');
                    this.ctx.fillStyle = aGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(ex, ey2, r + 8 * amalS, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#e8ffa8';
                    this.ctx.beginPath();
                    this.ctx.ellipse(ex, ey2, r, r * lidScale, 0, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#0a1400';
                    this.ctx.beginPath();
                    this.ctx.ellipse(ex + Math.cos(amalLook) * r * 0.35, ey2 + Math.sin(amalLook) * r * 0.35,
                                     r * 0.45, r * 0.45 * lidScale, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                });
            } else if (bossType === 'ARCHITECT') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 5;
                const archGlow = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 40 + 30 + pulse);
                archGlow.addColorStop(0, 'rgba(197, 160, 89, 0.5)');
                archGlow.addColorStop(1, 'rgba(197, 160, 89, 0)');
                this.ctx.fillStyle = archGlow;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 70 + pulse, 0, Math.PI * 2);
                this.ctx.fill();

                // Counter-rotating squares with corner nodes, matching the in-world build.
                let archSpin = this.renderFrame * 0.05;
                const archSquares = [
                    {rot: archSpin,               size: 30, color: '#c5a059', width: 3.5, node: 3.5},
                    {rot: -archSpin + Math.PI/4,  size: 26, color: '#fff6dc', width: 2,   node: 2.5}
                ];

                archSquares.forEach(sq => {
                    this.ctx.save();
                    this.ctx.rotate(sq.rot);
                    this.ctx.strokeStyle = sq.color;
                    this.ctx.lineWidth = sq.width;
                    this.ctx.strokeRect(-sq.size, -sq.size, sq.size * 2, sq.size * 2);

                    this.ctx.fillStyle = sq.color;
                    [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(c => {
                        this.ctx.beginPath();
                        this.ctx.arc(c[0] * sq.size, c[1] * sq.size, sq.node, 0, Math.PI * 2);
                        this.ctx.fill();
                    });
                    this.ctx.restore();
                });

                this.ctx.fillStyle = '#111';
                this.ctx.beginPath();
                this.ctx.moveTo(0, -40);
                this.ctx.lineTo(25, 0);
                this.ctx.lineTo(0, 40);
                this.ctx.lineTo(-25, 0);
                this.ctx.closePath();
                this.ctx.fill();

                this.ctx.strokeStyle = '#c5a059';
                this.ctx.lineWidth = 2.5;
                this.ctx.stroke();

                this.ctx.strokeStyle = 'rgba(197, 160, 89, 0.45)';
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.moveTo(0, -40); this.ctx.lineTo(0, 40);
                this.ctx.moveTo(-25, 0); this.ctx.lineTo(25, 0);
                this.ctx.stroke();

                let corePulse = 1 + Math.sin(this.renderFrame * 0.12) * 0.18;
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.moveTo(0, -15 * corePulse);
                this.ctx.lineTo(8 * corePulse, 0);
                this.ctx.lineTo(0, 15 * corePulse);
                this.ctx.lineTo(-8 * corePulse, 0);
                this.ctx.closePath();
                this.ctx.fill();
            } else {
                let pulse = Math.sin(this.renderFrame * 0.1) * 3;
                const orbR = 26;
                const chargingNow = activeBoss && activeBoss.pulseState === 'charging';

                // Mirrors the in-world BOSS anatomy (tendrils + orb + eyes-on-tendrils)
                // added in the drawWorldItems() patch, using simulatedPhase since this
                // announcement panel runs its own fake phase clock, not ent.phase.
                const tendrilCount = 6;
                const tendrils = [];
                for (let i = 0; i < tendrilCount; i++) {
                    let angle = (i / tendrilCount) * Math.PI * 2 + simulatedPhase * 0.15;
                    let reach = 42 + Math.sin(simulatedPhase * 3 + i * 2) * 12;
                    if (chargingNow) reach -= 12;
                    let perpX = -Math.sin(angle), perpY = Math.cos(angle);
                    let wave = Math.sin(simulatedPhase * 4 + i * 1.7) * 10;
                    tendrils.push({
                        baseX: Math.cos(angle) * (orbR - 4), baseY: Math.sin(angle) * (orbR - 4),
                        ctrlX: Math.cos(angle) * (orbR + reach * 0.55) + perpX * wave,
                        ctrlY: Math.sin(angle) * (orbR + reach * 0.55) + perpY * wave,
                        tipX: Math.cos(angle) * (orbR + reach), tipY: Math.sin(angle) * (orbR + reach),
                        angle
                    });
                }

                this.ctx.strokeStyle = '#1a0d15';
                this.ctx.lineCap = 'round';
                tendrils.forEach(t => {
                    this.ctx.beginPath();
                    this.ctx.moveTo(t.baseX, t.baseY);
                    this.ctx.lineTo(t.ctrlX, t.ctrlY);
                    this.ctx.lineWidth = 7;
                    this.ctx.stroke();
                    this.ctx.beginPath();
                    this.ctx.moveTo(t.ctrlX, t.ctrlY);
                    this.ctx.lineTo(t.tipX, t.tipY);
                    this.ctx.lineWidth = 3;
                    this.ctx.stroke();
                });

                const orbGrad = this.ctx.createRadialGradient(-8, -8, 4, 0, 0, orbR + pulse);
                orbGrad.addColorStop(0, '#3a1d25');
                orbGrad.addColorStop(1, '#1a0d15');
                this.ctx.fillStyle = orbGrad;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, orbR + pulse, 0, Math.PI * 2);
                this.ctx.fill();

                const glowAmount = chargingNow ? 30 : 15;
                tendrils.forEach((t, i) => {
                    let et = 0.55 + (i % 2) * 0.25;
                    let mt = 1 - et;
                    const eyeX = mt*mt*t.baseX + 2*mt*et*t.ctrlX + et*et*t.tipX;
                    const eyeY = mt*mt*t.baseY + 2*mt*et*t.ctrlY + et*et*t.tipY;
                    const eyeR = 3 + (i % 3);

                    const eGlow = this.ctx.createRadialGradient(eyeX, eyeY, 0, eyeX, eyeY, eyeR + glowAmount);
                    eGlow.addColorStop(0, 'rgba(255, 0, 0, 0.5)');
                    eGlow.addColorStop(1, 'rgba(255, 0, 0, 0)');
                    this.ctx.fillStyle = eGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(eyeX, eyeY, eyeR + glowAmount, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#ff0000';
                    this.ctx.beginPath();
                    this.ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI*2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#000000';
                    this.ctx.beginPath();
                    this.ctx.ellipse(eyeX, eyeY, eyeR * 0.2, eyeR * 0.8, t.angle, 0, Math.PI*2);
                    this.ctx.fill();
                });

                this.ctx.strokeStyle = '#555';
                this.ctx.lineWidth = 3;
                this.ctx.lineCap = 'round';
                for(let i=0; i<3; i++) {
                    let orbitAngle = simulatedPhase * (1 + i*0.5) + (i * Math.PI*0.6);
                    let dist = 45 + Math.sin(simulatedPhase * 2 + i) * 5;
                    if (activeBoss && activeBoss.pulseState === 'charging') orbitAngle += this.renderFrame * 0.2;
                    let objX = Math.cos(orbitAngle) * dist;
                    let objY = Math.sin(orbitAngle) * dist;
                    this.ctx.beginPath();
                    this.ctx.moveTo(objX - 5, objY - 5);
                    this.ctx.lineTo(objX + 5, objY + 5);
                    this.ctx.stroke();
                }
            }
            
            this.ctx.restore(); 

            this.ctx.textAlign = 'left';
            this.ctx.textBaseline = 'middle';
            
            let textJitter = (Math.random() - 0.5) * 10;
            
            let titleText = "THE SPHERE HEAD";
            let subText = "Apex Predator of the Wastes";
            
            if (bossType === 'RORSCHACH') {
                titleText = "THE RORSCHACH";
                subText = "The Mind Divided";
            } else if (bossType === 'PANOPTICON') {
                titleText = "THE PANOPTICON";
                subText = "The All-Seeing Eye";
            } else if (bossType === 'AMALGAMATION') {
                titleText = "THE AMALGAMATION";
                subText = "The Collective Nightmare";
            } else if (bossType === 'ARCHITECT') {
                titleText = "THE ARCHITECT";
                subText = "Constructor of the Void";
            }
            // Patch 146 (V2 plan E): the subtitle names the defense the boss embodies.
            if (bossEpithet(bossType)) subText = bossEpithet(bossType);
            
            // Patch 63: the banner used to hardcode "900 110px" and trust that it fit.
            // It does not: the text is left-aligned from x=-100 with the panel centred,
            // so the space available is (canvas.width / 2 + 100), and long names —
            // THE AMALGAMATION, THE SPHERE HEAD — overrun it on narrower windows.
            // Font metrics make it worse and platform-dependent: 'Courier New' is not
            // present on most Linux systems, so it falls back to a wider monospace and
            // the same name truncates there while fitting elsewhere. Measured at
            // runtime instead of assumed, which is correct for every font and viewport.
            // On a phone the boss portrait (drawn around x=-565..-235) is entirely off
            // screen anyway, so the left-aligned layout wastes the only space there is
            // and the longest names still clip even at the minimum size. Narrow
            // viewports centre the text and use the full width instead.
            // Patch 77: `narrowBanner` is decided once, further up, so the portrait
            // layout and the text layout can never disagree about which composition
            // this is.
            const narrow = narrowBanner;
            this.ctx.textAlign = narrow ? 'center' : 'left';
            const TEXT_X = narrow ? 0 : -100;
            const available = narrow
                ? this.canvas.width - 40
                : (this.canvas.width / 2) - TEXT_X - 40;   // 40px right margin

            const fitFont = (text, basePx, spec, minPx) => {
                this.ctx.font = `${spec} ${basePx}px 'Courier New', Courier, monospace`;
                const w = this.ctx.measureText(text).width;
                if (w <= available || w <= 0) return;
                const scaled = Math.max(minPx, Math.floor(basePx * (available / w)));
                this.ctx.font = `${spec} ${scaled}px 'Courier New', Courier, monospace`;
            };

            fitFont(titleText, titleBase, '900', 28);
            this.ctx.fillStyle = '#ffffff';

            this.ctx.save();
            const textGlow = this.ctx.createRadialGradient(0, titleY, 0, 0, titleY, 400);
            textGlow.addColorStop(0, 'rgba(139, 0, 0, 0.3)');
            textGlow.addColorStop(1, 'rgba(139, 0, 0, 0)');
            this.ctx.fillStyle = textGlow;
            this.ctx.fillText(titleText, TEXT_X + textJitter, titleY);
            this.ctx.restore();

            this.ctx.fillText(titleText, TEXT_X + textJitter, titleY);

            fitFont(subText, subBase, 'italic', 14);
            this.ctx.fillStyle = '#c5a059';
            this.ctx.fillText(subText, TEXT_X + (narrow ? 0 : 10) + textJitter, subY);

            // Patch 146 (V2 plan E4): the boss speaks — two lines (data/Story.js, each
            // <= 38 characters so they fit a phone), in the band just inside the bottom
            // rule, below the name and clear of the portrait. The first appears ~0.7 s in,
            // the second ~1.5 s; a skip (main.js) drops the timer to the fade, where both
            // show. Counted on the same sim-step timer as the banner.
            const lines = bossIntroLines(bossType, state.floor || 1);
            if (lines.length) {
                const t = this.bossAnnouncementTimer;
                const lineBase = Math.max(13, Math.min(20, PANEL_H * 0.085)) * (Number.isFinite(this.textScale) ? this.textScale : 1);
                // Wide: just inside the bottom rule. Narrow (a phone): tucked under the
                // subtitle, so the lines stay above the touch controls.
                const bottomY = PANEL_H - lineBase * 1.1;
                const y1 = narrow ? Math.min(subY + subBase * 0.5 + lineBase * 1.5, bottomY - lineBase * 1.6) : bottomY - lineBase * 1.6;
                const ys = [y1, y1 + lineBase * 1.6];
                const reveal = [200, 150];
                this.ctx.textBaseline = 'middle';
                for (let i = 0; i < Math.min(2, lines.length); i++) {
                    if (t > reveal[i]) continue;
                    const a = Math.min(1, (reveal[i] - t) / 20);
                    const text = `\u201C${lines[i]}\u201D`;
                    this.ctx.save();
                    this.ctx.globalAlpha = alpha * a;
                    fitFont(text, lineBase, 'italic bold', 11);
                    this.ctx.fillStyle = '#e8dcc8';
                    this.ctx.fillText(text, TEXT_X + (narrow ? 0 : 10), ys[i]);
                    this.ctx.restore();
                }
            }
            
        } finally {
            this.ctx.restore();
        }
    }

    /**
     * Patch 146 (V2 plan E4): state.subtitle = { text, steps, total } — a line centred
     * near the bottom of the world view, word-wrapped to the width, fading in and out.
     * Screen space; called after the camera transform is restored.
     */
    drawSubtitle(state) {
        const sub = state.subtitle;
        if (!sub || !sub.text) return;
        const total = sub.total || BOSS_DEATH_SUBTITLE_STEPS;
        const shown = total - sub.steps;
        const a = Math.max(0, Math.min(1, shown / 20, sub.steps / 30));
        if (!(a > 0)) return;
        const w = this.canvas.width;
        const cy = Number.isFinite(this.cameraCenterY) ? this.cameraCenterY : this.canvas.height / 2;
        const viewBottom = Math.min(this.canvas.height, cy * 2);
        const ts = Number.isFinite(this.textScale) ? this.textScale : 1;   // Patch 150: Text Size
        const size = Math.max(14, Math.min(22, w * 0.042)) * ts;
        const ctx = this.ctx;
        ctx.save();
        ctx.font = `italic ${size}px 'Courier New', Courier, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const maxW = Math.min(w - 40, 760);
        const words = `\u201C${sub.text}\u201D`.split(' ');
        const rows = [];
        let row = '';
        for (const word of words) {
            const tryRow = row ? row + ' ' + word : word;
            if (ctx.measureText(tryRow).width > maxW && row) { rows.push(row); row = word; } else row = tryRow;
        }
        if (row) rows.push(row);
        const lh = size * 1.35;
        // On a phone the touch controls sit at the bottom of the view; keep clear of them.
        const y0 = viewBottom - (w < 720 ? 170 : 70) - (rows.length - 1) * lh;
        const boxW = Math.min(w - 16, Math.max(...rows.map(r => ctx.measureText(r).width)) + 32);
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = '#050303';
        ctx.fillRect(w / 2 - boxW / 2, y0 - lh / 2 - 8, boxW, rows.length * lh + 16);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8dcc8';
        rows.forEach((r, i) => ctx.fillText(r, w / 2, y0 + i * lh));
        ctx.restore();
    }

    /**
     * Patch 150 (V2 plan F4): with Colour-Blind Assist on, every enemy winding up an
     * attack gets a white dashed ring that tightens as it pulses — a cue that does not
     * depend on telling red from anything else. World space, after the lighting mask
     * so it reads in the dark. Bosses (Haptics.bossTelegraphing) and the Hall Monitor
     * (Predator) lunge are the wind-ups the game has.
     */
    drawTelegraphRings(state) {
        const ents = state.entities;
        if (!ents || !ents.length) return;
        const ctx = this.ctx;
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.setLineDash([8, 6]);
        const pulse = 0.5 + 0.5 * Math.sin(this.renderFrame * 0.35);
        for (const ent of ents) {
            if (!ent || ent.dead) continue;
            if (!(bossTelegraphing(ent) || ent.attackState === 'telegraphing')) continue;
            if (!Number.isFinite(ent.x) || !Number.isFinite(ent.y) || !this.inView(ent.x, ent.y)) continue;
            const r = (Number.isFinite(ent.radius) ? ent.radius : 20) + 10 + pulse * 8;
            ctx.globalAlpha = 0.55 + pulse * 0.4;
            ctx.lineWidth = 3;
            ctx.lineDashOffset = -this.renderFrame;
            ctx.beginPath();
            ctx.arc(ent.x, ent.y, r, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    drawPlayer(state, audioEngine) {
        this.ctx.save();
        
        if (state.player.denialShieldActive) {
            let shieldPulse = Math.sin(this.renderFrame * 0.1) * 2;
            this.ctx.strokeStyle = `rgba(200, 200, 255, ${0.4 + Math.sin(this.renderFrame * 0.3) * 0.2})`;
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            this.ctx.beginPath();
            this.ctx.arc(state.player.x, state.player.y, state.player.radius * 2 + shieldPulse, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Patch 19: directional hit indicator. World-space, drawn with absolute
        // player coords before the local translate/rotate below — same convention
        // as the denialShield ring above — since lastHitAngle is a world angle.
        if (state.player.hitIndicatorTime > 0 && Number.isFinite(state.player.lastHitAngle)) {
            const indAlpha = Math.min(1, state.player.hitIndicatorTime / 40);
            const indDist = state.player.radius + 14;
            this.ctx.save();
            this.ctx.translate(
                state.player.x + Math.cos(state.player.lastHitAngle) * indDist,
                state.player.y + Math.sin(state.player.lastHitAngle) * indDist
            );
            this.ctx.rotate(state.player.lastHitAngle);
            this.ctx.fillStyle = `rgba(255, 40, 40, ${indAlpha * 0.85})`;
            this.ctx.beginPath();
            this.ctx.moveTo(6, 0);
            this.ctx.lineTo(-5, -6);
            this.ctx.lineTo(-5, 6);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.restore();
        }

        if (state.playerAfterimages) {
            for (let i = state.playerAfterimages.length - 1; i >= 0; i--) {
                let img = state.playerAfterimages[i];
                img.life -= 0.1 * this.drawSteps();   // Patch 114: per sim step
                if (img.life <= 0) {
                    state.playerAfterimages.splice(i, 1);
                    continue;
                }
                this.ctx.save();
                this.ctx.translate(img.x, img.y);
                this.ctx.rotate(img.angle);
                
                this.ctx.globalAlpha = img.life * 0.5;
                
                this.ctx.fillStyle = '#aaffff';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, state.player.radius, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.restore();
            }
        }
        
        let sanityRatio = state.sanity / state.player.maxHp;
        let panic = (1 - Math.max(0, sanityRatio)); 
        
        let isMoving = false;
        if (this.lastPx !== -1) {
            let distMoved = Math.hypot(state.player.x - this.lastPx, state.player.y - this.lastPy);
            if (distMoved > 0.5) isMoving = true;
        }

        let moveX = 0, moveY = 0;
        if (isMoving || (state.player.dash && state.player.dash.active)) {
            // Patch 114: per-step velocity — a draw can cover 2-3 sim steps on a slow
            // device, which used to double or triple the body lean.
            const dSteps = this.drawSteps();
            let globalVx = (state.player.x - this.lastPx) / dSteps;
            let globalVy = (state.player.y - this.lastPy) / dSteps;
            if (state.player.dash && state.player.dash.active) {
                globalVx = state.player.dash.dx * 10;
                globalVy = state.player.dash.dy * 10;
            }
            let cosA = Math.cos(-state.player.angle);
            let sinA = Math.sin(-state.player.angle);
            moveX = globalVx * cosA - globalVy * sinA;
            moveY = globalVx * sinA + globalVy * cosA;
        }

        this.lastPx = state.player.x;
        this.lastPy = state.player.y;

        if (isMoving) {
            this.legPhase += (0.3 + (panic * 0.4)) * this.drawSteps();   // Patch 114
            
            if (Math.abs(Math.sin(this.legPhase)) > 0.9 && Math.abs(Math.sin(this.lastFootstepPhase)) <= 0.9) {
                if (audioEngine && (!state.player.dash || !state.player.dash.active)) {
                    audioEngine.playFootstep();
                }
                
                for (let i = 0; i < 2; i++) {
                    // NOTE (Patch 39): these are raw literals, NOT pool objects —
                    // Renderer has no Director handle to spawn through. They are
                    // tagged `pooled: false` so Director.updateParticles drops them
                    // for the GC rather than injecting them into the particle pool,
                    // which is exactly what used to happen (see the fix there).
                    // Routing footstep dust through the pool properly needs a
                    // Director reference here, which means touching main.js —
                    // outside this patch's scope. Flagged in the report.
                    state.particles.push({
                        x: state.player.x + (Math.random() - 0.5) * 10,
                        y: state.player.y + (Math.random() - 0.5) * 10,
                        vx: (Math.random() - 0.5) * 0.5,
                        vy: (Math.random() - 0.5) * 0.5,
                        life: 0.5 + Math.random() * 0.5,
                        color: 'rgba(100, 100, 100, 0.5)',
                        pooled: false,
                        size: 2.5,
                        decay: 0.03,
                        rot: 0,
                        spin: 0
                    });
                }
            }
            this.lastFootstepPhase = this.legPhase;
        }

        let shakeX = (Math.random() - 0.5) * panic * 6;
        let shakeY = (Math.random() - 0.5) * panic * 6;

        this.ctx.translate(state.player.x + shakeX, state.player.y + shakeY);
        
        if (state.player.dash && state.player.dash.active) {
            let moveAngle = Math.atan2(state.player.dash.dy, state.player.dash.dx);
            this.ctx.rotate(moveAngle);
            this.ctx.translate(10, 0); 
            this.ctx.rotate(state.player.angle - moveAngle);
        } else {
            this.ctx.rotate(state.player.angle);
        }

        // Patch 168: the player is the one thing that must never be lost in a crowd:
        // a warm halo under them, and the figure drawn 25% larger (hitbox unchanged).
        this.drawGlow(0, 0, 44, '#ffe2a8', 0.22);
        this.ctx.scale(1.25, 1.25);

        let shake = panic * 3;

        this.ctx.globalAlpha = 0.3;
        this.ctx.fillStyle = '#88aaff';
        this.ctx.beginPath();
        this.ctx.arc((Math.random()-0.5)*shake, (Math.random()-0.5)*shake, state.player.radius * 1.5, 0, Math.PI*2);
        this.ctx.fill();

        this.ctx.globalAlpha = 1.0;

        // i-frame tell: a slower blink than flashTime's 6-frame color flicker above,
        // so it stays readable as "still invulnerable" after the initial flash fades.
        if (state.player.iframes > 0) {
            this.ctx.globalAlpha = (Math.floor(this.renderFrame / 4) % 2 === 0) ? 1.0 : 0.35;
        }

        this.ctx.strokeStyle = '#050505';
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        
        this.ctx.beginPath();
        this.ctx.moveTo(0, 5);
        this.ctx.lineTo(-8 + Math.cos(this.legPhase)*6, 8 + Math.sin(this.legPhase)*6);
        this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(0, -5);
        this.ctx.lineTo(-8 + Math.cos(this.legPhase + Math.PI)*6, -8 + Math.sin(this.legPhase + Math.PI)*6);
        this.ctx.stroke();

        let baseBodyColor = '#1a1a24';
        let headColor = '#e0e0e0';
        if (state.player.flashTime > 0) {
            let isRed = (this.renderFrame % 6 < 3);
            baseBodyColor = isRed ? '#ff0000' : '#ffffff';
            headColor = isRed ? '#ff0000' : '#ffffff';
        }

        this.ctx.fillStyle = baseBodyColor;

        let breathe = state.player.breathPhase ? Math.sin(state.player.breathPhase) * (1 + panic * 3) : 0;
        let sw = 9 + breathe; // shoulder/hip width, breathes with breathPhase

        // Lean, compact coat silhouette: shield/teardrop shape, forward-pointed,
        // tapering to a narrow hem at the back. Height ~= width (top-down),
        // deliberately NOT elongated to avoid a "slithering" read.
        this.ctx.beginPath();
        this.ctx.moveTo(9, 0);
        this.ctx.bezierCurveTo(9, sw * 0.78, 4, sw * 1.22, -3, sw * 1.11);
        this.ctx.bezierCurveTo(-sw, sw, -sw * 1.22, sw * 0.44, -sw * 1.11, 0);
        this.ctx.bezierCurveTo(-sw * 1.22, -sw * 0.44, -sw, -sw, -3, -sw * 1.11);
        this.ctx.bezierCurveTo(4, -sw * 1.22, 9, -sw * 0.78, 9, 0);
        this.ctx.closePath();
        this.ctx.fill();

        // subtle waist fold so the taper still reads under flash colors
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(-2, -6);
        this.ctx.quadraticCurveTo(-8, 0, -2, 6);
        this.ctx.stroke();

        let headShiftX = Math.max(-5, Math.min(5, moveX * 0.5));
        let headShiftY = Math.max(-5, Math.min(5, moveY * 0.5));
        let headJitterX = (Math.random() - 0.5) * panic * 4;
        let headJitterY = (Math.random() - 0.5) * panic * 4;

        // Arm + flashlight: shoulder -> hand -> flashlight, extending forward
        // along the aim axis so it reads as physically held.
        this.ctx.save();
        this.ctx.strokeStyle = baseBodyColor;
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(6, 6);
        this.ctx.lineTo(22, 3);
        this.ctx.stroke();

        this.ctx.fillStyle = '#c9a678';
        this.ctx.beginPath();
        this.ctx.arc(22, 3, 2.5, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.translate(22, 3);
        this.ctx.rotate(-0.15);
        this.ctx.fillStyle = '#4a4a4a';
        this.ctx.fillRect(0, -2, 14, 4);
        this.ctx.strokeStyle = '#111111';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(0, -2, 14, 4);
        this.ctx.fillStyle = '#2a2a2a';
        this.ctx.fillRect(3, -2, 1.2, 4);
        this.ctx.fillRect(6, -2, 1.2, 4);

        const lensGlowAmt = 10 + Math.random() * 4 * panic;
        const lensGlow = this.ctx.createRadialGradient(14, 0, 0, 14, 0, lensGlowAmt);
        lensGlow.addColorStop(0, 'rgba(255, 246, 204, 0.9)');
        lensGlow.addColorStop(1, 'rgba(255, 246, 204, 0)');
        this.ctx.fillStyle = lensGlow;
        this.ctx.beginPath();
        this.ctx.arc(14, 0, lensGlowAmt, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#dcdcdc';
        this.ctx.beginPath();
        this.ctx.arc(14, 0, 3.5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();

        // Head: kept small relative to the coat so it doesn't dominate the silhouette
        this.ctx.fillStyle = headColor;
        this.ctx.beginPath();
        this.ctx.arc(13 + headJitterX + headShiftX, headJitterY + headShiftY, 5, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#1a1a24';
        this.ctx.beginPath();
        this.ctx.ellipse(10 + headJitterX * 0.5 + headShiftX, 3 + headJitterY * 0.5 + headShiftY, 4, 2.5, Math.PI / 5, 0, Math.PI * 2);
        this.ctx.fill();

        const eyeX = 16 + headJitterX * 0.5 + headShiftX;
        const eyeY = headJitterY * 0.5 + headShiftY;
        const eyeR = 2.5;
        const eyeGlowAmt = 8 + Math.random() * 5 * panic;
        const eyeGlow = this.ctx.createRadialGradient(eyeX, eyeY, 0, eyeX, eyeY, eyeR + eyeGlowAmt);
        eyeGlow.addColorStop(0, 'rgba(255, 250, 230, 0.5)');
        eyeGlow.addColorStop(1, 'rgba(255, 250, 230, 0)');
        this.ctx.fillStyle = eyeGlow;
        this.ctx.beginPath();
        this.ctx.arc(eyeX, eyeY, eyeR + eyeGlowAmt, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = '#fffae6';
        this.ctx.beginPath();
        this.ctx.arc(eyeX, eyeY, eyeR, 0, Math.PI * 2);
        this.ctx.fill();

        const spinner = state.player.weapons.fidget_spinner;
        if (spinner && spinner.level > 0) {
            this.ctx.save();
            let currentSpin = this.renderFrame * spinner.speed;
            if (state.player.dash && state.player.dash.active) currentSpin *= 3;
            
            this.ctx.rotate(currentSpin); 
            
            for(let i=0; i<3; i++) {
                this.ctx.save();
                this.ctx.rotate((i * Math.PI * 2) / 3);
                this.ctx.translate(spinner.baseRadius, 0);
                
                this.ctx.fillStyle = spinner.evolution ? '#d9b44a' : '#888';   // Patch 134: Ceiling Fan
                this.ctx.beginPath();
                this.ctx.moveTo(10, 0);
                this.ctx.lineTo(-5, 5);
                this.ctx.lineTo(-5, -5);
                this.ctx.fill();
                
                this.ctx.fillStyle = '#aaffff';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 3, 0, Math.PI*2);
                this.ctx.fill();
                
                this.ctx.restore();
            }
            this.ctx.restore();
        }

        this.ctx.fillStyle = '#ffffff';
        for(let i=0; i<3; i++) {
            let pX = Math.cos(this.renderFrame * 0.05 + i*2) * (10 + shake*2);
            let pY = Math.sin(this.renderFrame * 0.08 + i*2) * (10 + shake*2);
            this.ctx.fillRect(pX, pY, 1.5 + Math.random()*panic, 1.5 + Math.random()*panic);
        }

        this.ctx.restore();
    }
}
