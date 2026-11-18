// src/systems/HubWorld.js
// The interactive safe room where the player prepares for the next run.
//
// Patch 178: THE BEDROOM. The hub was a blueprint-blue disc with four grey boxes and a
// row of bronze blobs. It is now the room the nightmares start from, and every station
// SHOWS the save instead of naming a menu:
//
//   the BED        (tab-main)      where a run begins: you go to sleep
//   the DESK       (tab-tree)      upgrades; the stack of notebooks grows with Patient Level
//   the WARDROBE   (tab-loadout)   tokens; a hook per slot, lit in the worn token's rarity
//   the SHELF      (tab-trophies)  a trophy for every boss beaten (an empty plinth for the
//                                  rest), a jar per enemy type that fills with kills, and a
//                                  corkboard where every Case File page found is pinned
//
// Zone ids, positions, radii and actions are unchanged (main.js, the checks and the
// suspended-run shortcut key on them); only the look and the prompts are new.

import { pageCount } from '../data/Story.js';
import { TOKEN_RARITIES } from '../data/Manifestations.js';

const INK = 'rgba(8, 10, 16, 0.9)';
const RIM = 'rgba(255, 232, 190, 0.55)';

export class HubWorld {
    constructor(game) {
        this.game = game;
        this.roomRadius = 500;

        this.zones = [
            { id: 'bed', x: 0, y: -300, radius: 100, prompt: 'THE BED · Start a run', action: 'tab-main', color: '#ffcf8a' },
            { id: 'desk', x: 300, y: 0, radius: 100, prompt: 'THE DESK · Upgrades', action: 'tab-tree', color: '#ffe0a8' },
            { id: 'locker', x: -300, y: 0, radius: 100, prompt: 'THE WARDROBE · Tokens', action: 'tab-loadout', color: '#cdbcff' },
            { id: 'trophies', x: 0, y: 300, radius: 100, prompt: 'THE SHELF · Trophies and Case File', action: 'tab-trophies', color: '#f2d27a' }
        ];

        this.activeZone = null;
        this.flickerTimer = 0;
        this.lightIntensity = 1;

        this.cachedFloor = this.generateFloor();
    }

    /** Floorboards, a wall, a round rug and the worn paths between the stations. */
    generateFloor() {
        const c = document.createElement('canvas');
        const s = 1200;
        c.width = s; c.height = s;
        const cx = c.getContext('2d');
        cx.translate(s / 2, s / 2);
        const R = this.roomRadius;

        cx.fillStyle = '#07060b';
        cx.fillRect(-s / 2, -s / 2, s, s);

        cx.save();
        cx.beginPath();
        cx.arc(0, 0, R, 0, Math.PI * 2);
        cx.clip();

        // boards: long planks, three tones, staggered butt joints
        const tones = ['#4d3524', '#553b28', '#46301f'];
        for (let i = -R, n = 0; i < R; i += 38, n++) {
            cx.fillStyle = tones[n % 3];
            cx.fillRect(i, -R, 38, R * 2);
            cx.fillStyle = 'rgba(0, 0, 0, 0.28)';
            cx.fillRect(i, -R, 2, R * 2);
            cx.fillStyle = 'rgba(0, 0, 0, 0.22)';
            for (let j = -R + ((n * 97) % 160); j < R; j += 210) cx.fillRect(i, j, 38, 2);
            cx.fillStyle = 'rgba(255, 220, 170, 0.035)';
            cx.fillRect(i + 6, -R, 3, R * 2);
        }

        // the rug: three rings and a star, worn in the middle
        const ring = (r, col) => { cx.fillStyle = col; cx.beginPath(); cx.arc(0, 0, r, 0, Math.PI * 2); cx.fill(); };
        ring(178, '#2a1d3a'); ring(166, '#6b3a4a'); ring(150, '#2f2444'); ring(96, '#3a2c55');
        cx.strokeStyle = 'rgba(233, 200, 119, 0.55)'; cx.lineWidth = 3;
        cx.beginPath(); cx.arc(0, 0, 158, 0, Math.PI * 2); cx.stroke();
        cx.beginPath();
        for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 60 : 124; cx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        cx.closePath(); cx.stroke();
        cx.fillStyle = 'rgba(0, 0, 0, 0.16)';
        cx.beginPath(); cx.ellipse(10, 14, 70, 52, 0.4, 0, Math.PI * 2); cx.fill();

        // moonlight from a window above the bed: a pale pane across the boards
        cx.save();
        cx.translate(-150, -120); cx.rotate(-0.35);
        cx.fillStyle = 'rgba(170, 200, 255, 0.07)';
        cx.fillRect(-70, -150, 62, 300); cx.fillRect(8, -150, 62, 300);
        cx.restore();
        cx.restore();

        // the wall: a dark skirting ring with a gold picture rail
        cx.strokeStyle = '#1a1420'; cx.lineWidth = 26;
        cx.beginPath(); cx.arc(0, 0, R + 2, 0, Math.PI * 2); cx.stroke();
        cx.strokeStyle = 'rgba(233, 200, 119, 0.45)'; cx.lineWidth = 2;
        cx.beginPath(); cx.arc(0, 0, R - 11, 0, Math.PI * 2); cx.stroke();

        return c;
    }

    update(state) {
        let dist = Math.hypot(state.player.x, state.player.y);
        if (dist > this.roomRadius - state.player.radius) {
            let angle = Math.atan2(state.player.y, state.player.x);
            state.player.x = Math.cos(angle) * (this.roomRadius - state.player.radius);
            state.player.y = Math.sin(angle) * (this.roomRadius - state.player.radius);
        }

        this.activeZone = null;
        const fl = state.player.weapons.flashlight;
        const playerAngle = state.player.angle;

        for (let z of this.zones) {
            let distToZone = Math.hypot(state.player.x - z.x, state.player.y - z.y);
            let isStanding = distToZone < z.radius + state.player.radius + 20;
            let angleToZone = Math.atan2(z.y - state.player.y, z.x - state.player.x);
            let angleDiff = angleToZone - playerAngle;

            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

            let flRadius = (fl && Number.isFinite(fl.radius)) ? fl.radius : 250;
            let flAngle = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;

            let isAiming = Math.abs(angleDiff) < flAngle && distToZone < flRadius + z.radius;

            if (isStanding || isAiming) {
                this.activeZone = z;
                if (isStanding) break;
            }
        }

        // Patch 178: a bedroom's light is steady. It dips now and then (a failing bulb)
        // but no longer strobes like a ward corridor.
        this.flickerTimer--;
        if (this.flickerTimer <= 0) {
            if (Math.random() < 0.06) {
                this.lightIntensity = 0.6;
                this.flickerTimer = 4 + Math.random() * 8;
            } else {
                this.lightIntensity = 0.9;
                this.flickerTimer = 120 + Math.random() * 240;
            }
        }
    }

    /**
     * Patch 155: the furniture never moves during a visit, so it is baked into the
     * floor image once per visit (bake) and each frame is one drawImage plus the
     * highlight. Re-baked whenever Game.init builds a new state (every hub entry), which
     * is when the trophies, the pages and the tokens can have changed.
     */
    draw(ctx, state, renderer) {
        if (!this.baked || this.bakedFor !== state) this.bake(state);
        const hd = renderer && renderer.hubDiag;
        if (!hd || hd.floor !== false) ctx.drawImage(this.baked, -600, -600);
        if (this.activeZone) this.drawHighlight(ctx, this.activeZone);
        // Patch 181: a gold marker bobbing over every station, so what can be used is
        // obvious from across the room (the name plates are baked with the furniture).
        const t = (typeof performance !== 'undefined' ? performance.now() : 0) * 0.004;
        for (const z of this.zones) {
            const top = z.id === 'bed' ? -122 : (z.id === 'trophies' ? -72 : -100);
            const y = z.y + top + Math.sin(t + z.x * 0.01) * 5;
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.beginPath(); ctx.moveTo(z.x - 11, y - 9); ctx.lineTo(z.x + 11, y - 9); ctx.lineTo(z.x, y + 7); ctx.closePath(); ctx.fill();
            ctx.fillStyle = z === this.activeZone ? '#fff3c4' : '#f2d27a';
            ctx.beginPath(); ctx.moveTo(z.x - 8, y - 8); ctx.lineTo(z.x + 8, y - 8); ctx.lineTo(z.x, y + 4); ctx.closePath(); ctx.fill();
        }
    }

    bake(state) {
        this.bakedFor = state;
        if (this.baked) { this.baked.width = 0; this.baked.height = 0; }   // free its memory now
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 1200;
        const cx = c.getContext('2d');
        cx.drawImage(this.cachedFloor, 0, 0);
        cx.translate(600, 600);
        try { this.drawFurniture(cx, state); } catch (e) { /* a bare room is better than no hub */ }
        this.baked = c;
    }

    /** The active station: a gold ring on the floor around it. */
    drawHighlight(ctx, z) {
        ctx.save();
        ctx.translate(z.x, z.y);
        ctx.strokeStyle = 'rgba(242, 210, 122, 0.85)';
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 9]);
        ctx.beginPath(); ctx.ellipse(0, 0, z.id === 'trophies' ? 150 : 96, z.id === 'trophies' ? 78 : 92, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    /** Everything that stands in the room. Static for a visit: drawn only by bake(). */
    drawFurniture(ctx, state) {
        const meta = (this.game && this.game.saveManager && this.game.saveManager.metaState) || {};
        const kills = state.killCounts || meta.killCounts || {};
        const box = (x, y, w, h, fill, r = 4) => {
            ctx.fillStyle = fill; ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
            ctx.fill(); ctx.stroke();
        };
        const shadow = (x, y, rx, ry) => { ctx.fillStyle = 'rgba(0, 0, 0, 0.38)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 12, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); };
        ctx.save();
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5;

        // ---------------------------------------------------------------- the BED
        ctx.save(); ctx.translate(0, -300);
        shadow(0, 0, 66, 92);
        box(-52, -86, 104, 172, '#3b2a1c', 8);                    // frame
        box(-46, -80, 92, 160, '#efe6d6', 6);                     // sheet
        box(-38, -74, 76, 30, '#fdf8ee', 8);                      // pillow
        box(-46, -30, 92, 110, '#3f78b5', 6);                     // quilt
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'; ctx.lineWidth = 1.5;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 26, -28); ctx.lineTo(i * 26, 78); ctx.stroke(); }
        for (let j = 0; j < 3; j++) { ctx.beginPath(); ctx.moveTo(-44, 4 + j * 28); ctx.lineTo(44, 4 + j * 28); ctx.stroke(); }
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
        box(-46, -32, 92, 14, '#2f5f95', 4);                      // the turned-down fold
        // a bear on the pillow
        ctx.fillStyle = '#b07a4a';
        ctx.beginPath(); ctx.arc(20, -58, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(13, -66, 4, 0, Math.PI * 2); ctx.arc(27, -66, 4, 0, Math.PI * 2); ctx.fill();
        // the bedside table and its night light
        box(60, -84, 34, 34, '#4a3322', 5);
        ctx.fillStyle = '#ffe9b0'; ctx.beginPath(); ctx.arc(77, -67, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255, 220, 150, 0.22)'; ctx.beginPath(); ctx.arc(77, -67, 30, 0, Math.PI * 2); ctx.fill();
        // slippers
        box(-78, 40, 12, 22, '#b0392f', 5); box(-62, 44, 12, 22, '#b0392f', 5);
        ctx.restore();

        // --------------------------------------------------------------- the DESK
        ctx.save(); ctx.translate(300, 0);
        shadow(0, 0, 78, 46);
        box(-68, -38, 136, 76, '#5a3d27', 6);
        box(-60, -30, 120, 60, '#6b4a30', 4);
        // an open notebook, a pencil
        box(-36, -20, 34, 42, '#f4ecd8', 2); box(-2, -20, 34, 42, '#f4ecd8', 2);
        ctx.strokeStyle = 'rgba(60, 50, 40, 0.45)'; ctx.lineWidth = 1;
        for (let l = 0; l < 5; l++) { ctx.beginPath(); ctx.moveTo(-31, -12 + l * 7); ctx.lineTo(-7, -12 + l * 7); ctx.moveTo(3, -12 + l * 7); ctx.lineTo(27, -12 + l * 7); ctx.stroke(); }
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
        ctx.save(); ctx.translate(46, 14); ctx.rotate(0.6); box(-12, -2, 24, 4, '#e9c877', 1); ctx.restore();
        // the desk lamp
        ctx.fillStyle = 'rgba(255, 220, 150, 0.2)'; ctx.beginPath(); ctx.arc(-46, -20, 34, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2f7f8c'; ctx.beginPath(); ctx.arc(-50, -26, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff3cf'; ctx.beginPath(); ctx.arc(-48, -24, 5, 0, Math.PI * 2); ctx.fill();
        // a notebook for every Patient Level (capped at 8), stacked at the end of the desk
        let level = 1;
        try { level = this.game.saveManager.getPatientLevelInfo().level || 1; } catch (e) { level = 1; }
        const books = Math.max(1, Math.min(8, level));
        const bookCols = ['#8f2a18', '#2f5f95', '#61803a', '#7a2f8a', '#c79a2e'];
        for (let b = 0; b < books; b++) box(42 - (b % 2) * 3, -34 + b * -0.01 - b * 3.4 + 20, 22, 6, bookCols[b % 5], 1);
        // the chair, pulled out
        box(-18, 46, 36, 30, '#3b2a1c', 6);
        ctx.restore();

        // ----------------------------------------------------------- the WARDROBE
        ctx.save(); ctx.translate(-300, 0);
        shadow(0, 0, 52, 78);
        box(-40, -68, 80, 136, '#3a2a4a', 6);
        box(-34, -62, 32, 124, '#4a3760', 3); box(2, -62, 32, 124, '#4a3760', 3);
        ctx.fillStyle = '#e9c877'; ctx.beginPath(); ctx.arc(-6, 0, 3, 0, Math.PI * 2); ctx.arc(6, 0, 3, 0, Math.PI * 2); ctx.fill();
        // five hooks on a rail beside it: one per token slot, lit in the worn token's rarity
        const slots = ['head', 'body', 'hands', 'legs', 'prescription'];
        const eq = meta.equippedTokens || {};
        const inv = Array.isArray(meta.inventory) ? meta.inventory : [];
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
        box(50, -62, 8, 124, '#2a1d3a', 3);
        slots.forEach((slot, i) => {
            const uid = eq[slot];
            const item = uid ? inv.find(it => it && it.uid === uid) : null;
            const rar = item && TOKEN_RARITIES[item.rarity];
            const y = -48 + i * 24;
            if (rar) {
                ctx.fillStyle = rar.color; ctx.globalAlpha = 0.3;
                ctx.beginPath(); ctx.arc(70, y, 16, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
                ctx.fillStyle = rar.color;
                ctx.beginPath(); ctx.moveTo(70, y - 8); ctx.lineTo(78, y); ctx.lineTo(70, y + 8); ctx.lineTo(62, y); ctx.closePath(); ctx.fill(); ctx.stroke();
            } else {
                ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(70, y, 6, 0, Math.PI * 2); ctx.stroke();
                ctx.setLineDash([]); ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
            }
        });
        ctx.restore();

        // --------------------------------------------- the SHELF and the CORKBOARD
        ctx.save(); ctx.translate(0, 300);
        shadow(0, 30, 150, 34);
        // the shelf: a long plank on two brackets
        box(-140, 14, 280, 22, '#4a3322', 4);
        box(-136, 10, 272, 8, '#6b4a30', 2);
        // five boss trophies, left to right in the order they are met
        const bosses = [
            ['BOSS', '#ff5a48', 'eye'], ['RORSCHACH', '#b46bff', 'blot'], ['PANOPTICON', '#ff2a6a', 'tower'],
            ['AMALGAMATION', '#b6ff5a', 'jar'], ['ARCHITECT', '#ffd24a', 'diamond']
        ];
        bosses.forEach(([type, col, shape], i) => {
            const x = -108 + i * 54;
            const won = (kills[type] || 0) > 0;
            box(x - 16, -2, 32, 14, won ? '#2a2233' : 'rgba(255,255,255,0.05)', 3);   // plinth
            if (!won) {
                ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'; ctx.lineWidth = 1.5;
                ctx.beginPath(); ctx.arc(x, -20, 13, 0, Math.PI * 2); ctx.stroke();
                ctx.setLineDash([]); ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
                return;
            }
            ctx.fillStyle = col; ctx.globalAlpha = 0.28;
            ctx.beginPath(); ctx.arc(x, -20, 24, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
            ctx.fillStyle = '#231a2c';
            if (shape === 'eye') {
                ctx.beginPath(); ctx.arc(x, -20, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#f6efe2'; ctx.beginPath(); ctx.ellipse(x, -20, 8, 6, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, -20, 3.5, 0, Math.PI * 2); ctx.fill();
            } else if (shape === 'blot') {
                box(x - 12, -36, 24, 30, '#f4ecd8', 2);
                ctx.fillStyle = '#16101e';
                ctx.beginPath(); ctx.ellipse(x - 4, -21, 4, 9, 0.3, 0, Math.PI * 2); ctx.ellipse(x + 4, -21, 4, 9, -0.3, 0, Math.PI * 2); ctx.fill();
            } else if (shape === 'tower') {
                box(x - 7, -26, 14, 22, '#231a2c', 2);
                ctx.fillStyle = '#f6efe2'; ctx.beginPath(); ctx.arc(x, -30, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, -30, 4, 0, Math.PI * 2); ctx.fill();
            } else if (shape === 'jar') {
                box(x - 11, -36, 22, 32, 'rgba(200, 255, 200, 0.2)', 6);
                ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x - 3, -16, 5, 0, Math.PI * 2); ctx.arc(x + 4, -22, 6, 0, Math.PI * 2); ctx.fill();
                box(x - 9, -40, 18, 6, '#6b4a30', 2);
            } else {
                ctx.fillStyle = '#16101e'; ctx.beginPath(); ctx.moveTo(x, -38); ctx.lineTo(x + 11, -20); ctx.lineTo(x, -4); ctx.lineTo(x - 11, -20); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke(); ctx.strokeStyle = INK;
                ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, -28); ctx.lineTo(x + 4, -20); ctx.lineTo(x, -12); ctx.lineTo(x - 4, -20); ctx.closePath(); ctx.fill();
            }
        });
        // six jars under the shelf: one per regular enemy, filling with kills (full at 500)
        const jars = [['SCAVENGER', '#ffd24a'], ['PREDATOR', '#ff5a48'], ['PARASITE', '#9dff6a'], ['SPLITTER', '#f4f0e0'], ['WARDEN', '#ffb347'], ['BURROWER', '#ffc9a0']];
        jars.forEach(([type, col], i) => {
            const x = -100 + i * 40, n = kills[type] || 0;
            const fill = Math.max(0, Math.min(1, n / 500));
            box(x - 11, 44, 22, 28, 'rgba(210, 225, 255, 0.14)', 5);
            if (fill > 0) { ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.fillRect(x - 9, 70 - 24 * fill, 18, 24 * fill); ctx.globalAlpha = 1; }
            box(x - 8, 40, 16, 6, '#6b4a30', 2);
        });
        ctx.restore();

        // Patch 181: a name plate by every station (and the corkboard), baked in.
        const plate = (x, y, text) => {
            ctx.font = "800 15px 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            const w = ctx.measureText(text).width + 22;
            ctx.strokeStyle = 'rgba(233, 200, 119, 0.9)'; ctx.lineWidth = 1.5;
            ctx.fillStyle = 'rgba(14, 12, 20, 0.92)';
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 12, w, 24, 12); else ctx.rect(x - w / 2, y - 12, w, 24);
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#f2d27a';
            ctx.fillText(text, x, y + 1);
            ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
        };
        plate(0, -196, 'BED · PLAY');
        plate(300, 96, 'DESK · UPGRADES');
        plate(-300, 92, 'WARDROBE · TOKENS');
        plate(0, 392, 'SHELF · TROPHIES');
        plate(-232, 318, 'CASE FILE');

        // the corkboard, on the wall between the shelf and the wardrobe: a pinned sheet
        // for every Case File page found, and red thread once there are enough to join
        ctx.save(); ctx.translate(-205, 250); ctx.rotate(-0.5);
        shadow(0, 0, 70, 50);
        box(-64, -44, 128, 88, '#8a6a46', 4);
        box(-58, -38, 116, 76, '#b08a5c', 2);
        let pages = 0;
        try { pages = pageCount(meta) || 0; } catch (e) { pages = 0; }
        const pts = [];
        for (let i = 0; i < Math.min(25, pages); i++) {
            const px = -48 + (i % 7) * 16, py = -28 + Math.floor(i / 7) * 18;
            ctx.save(); ctx.translate(px, py); ctx.rotate(((i * 37) % 9 - 4) * 0.05);
            ctx.lineWidth = 1; box(-6, -8, 12, 15, '#f4ecd8', 1);
            ctx.fillStyle = '#b0392f'; ctx.beginPath(); ctx.arc(0, -6, 1.6, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            pts.push([px, py - 6]);
        }
        if (pts.length >= 3) {
            ctx.strokeStyle = 'rgba(200, 40, 40, 0.8)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); pts.forEach(([x, y], i) => { if (i % 2 === 0) { if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } }); ctx.stroke();
        }
        ctx.restore();

        ctx.restore();
    }
}
