export class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        
        this.noisePattern = this.generateNoisePattern();
        this.cachedNoisePattern = this.ctx.createPattern(this.noisePattern, 'repeat');
        this.fogClouds = this.generateFogClouds();
        this.cachedFloorPatterns = this.generateFloorPatterns();
        
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        
        this.zoom = 1.3;

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
            HEAL: { color: '#33ff55', glowRgb: '100, 255, 100', label: 'GRIP +50' },
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
        this.spriteCache.set(key, sprite);
        return sprite;
    }

    drawSprite(sprite, x = 0, y = 0) {
        this.ctx.drawImage(sprite.canvas, x - sprite.w / 2, y - sprite.h / 2, sprite.w, sprite.h);
    }

    // Radial faux-glow from a cached bitmap. The ramp is identical at every size, so
    // one sprite per (colour, alpha) scales to any radius: the pulse stays fully live
    // via the destination rect, while createRadialGradient() runs once instead of
    // once per entity per frame. Still faux-glow — no shadowBlur.
    drawGlow(x, y, radius, color, alpha) {
        if (!Number.isFinite(radius) || radius <= 0) return;

        const key = `glow|${color}|${alpha}`;
        let sprite = this.spriteCache.get(key);
        if (!sprite) {
            const R = 64;
            const c = document.createElement('canvas');
            c.width = c.height = R * 2;
            const cx = c.getContext('2d');
            const g = cx.createRadialGradient(R, R, 0, R, R, R);
            g.addColorStop(0, this.hexToRgba(color, alpha));
            g.addColorStop(1, this.hexToRgba(color, 0));
            cx.fillStyle = g;
            cx.fillRect(0, 0, R * 2, R * 2);
            sprite = { canvas: c };
            this.spriteCache.set(key, sprite);
        }
        this.ctx.drawImage(sprite.canvas, x - radius, y - radius, radius * 2, radius * 2);
    }

    // `offset` shifts this call relative to the entity's own phase, for parts that
    // need a fixed relationship to each other (e.g. counter-phased body edges).
    entPulse(ent, speed = 0.1, offset = 0) {
        const p = ((ent && Number.isFinite(ent.phase)) ? ent.phase : 0) + offset;
        return Math.sin(this.renderFrame * speed + p)
             + Math.sin(this.renderFrame * speed * 3.7 + p) * 0.3;
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
            { bg: '#1a1410', line: '#0f0a05', accent1: 'rgba(50, 30, 20, 0.4)', accent2: 'rgba(0, 0, 0, 0.5)', crack: 'rgba(0, 0, 0, 0.55)' }, // Floor 1: Wastes (Rusty Browns)
            { bg: '#0d0d0d', line: '#222222', accent1: 'rgba(80, 80, 80, 0.2)', accent2: 'rgba(0, 0, 0, 0.6)' }, // Floor 2: Divide (Stark Grayscale)
            { bg: '#250808', line: '#110202', accent1: 'rgba(100, 10, 10, 0.3)', accent2: 'rgba(0, 0, 0, 0.7)' }, // Floor 3: Panopticon (Oppressive Reds)
            { bg: '#081a0c', line: '#030a04', accent1: 'rgba(20, 80, 20, 0.3)', accent2: 'rgba(5, 15, 5, 0.6)' }, // Floor 4: Amalgamation (Toxic Greens)
            { bg: '#000000', line: '#b8860b', accent1: 'rgba(218, 165, 32, 0.1)', accent2: 'rgba(0, 0, 0, 0.8)' }  // Floor 5: Architect (Pitch Black & Gold)
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
        const f = Math.max(1, Math.min(floor || 1, 5));
        return [
            { dark: '#0a0704', fog: '190, 172, 150', haze: 0.50 }, // 1 Wastes: warm dust
            { dark: '#010102', fog: '200, 210, 220', haze: 0.50 }, // 2 Divide: unchanged
            { dark: '#0b0202', fog: '215, 165, 165', haze: 0.55 }, // 3 Panopticon: blood haze
            { dark: '#020803', fog: '170, 205, 175', haze: 0.58 }, // 4 Amalgamation: spore bloom
            { dark: '#000000', fog: '205, 190, 150', haze: 0.42 }  // 5 Architect: gold dust, true black
        ][f - 1];
    }

    drawMenuBackground(time, gameState) {
        this.ctx.fillStyle = `rgba(139, 0, 0, ${0.05 + Math.sin(time * 0.001) * 0.02})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (gameState === 'TITLE') {
            this.drawTitleSilhouettes(time);
        } else if (gameState === 'MENU') {
            this.drawMenuStorm(time);
        }

        this.drawFilmGrain();
    }

    drawTitleSilhouettes(time) {
        const cx = this.canvas.width / 2;
        const cy = this.canvas.height / 2;
        
        this.ctx.save();
        
        // Creeping Fog
        for (let i = 0; i < 5; i++) {
            this.ctx.fillStyle = `rgba(50, 0, 0, ${0.05 + Math.sin(time * 0.0005 + i) * 0.02})`;
            this.ctx.beginPath();
            let yOffset = Math.sin(time * 0.001 + i) * 100;
            this.ctx.ellipse(cx + Math.cos(time * 0.0002 + i)*300, cy + 100 + yOffset, 600 + i*100, 300 + i*50, 0, 0, Math.PI * 2);
            this.ctx.fill();
        }
        
        // Glitching Procedural Geometry
        this.ctx.strokeStyle = `rgba(255, 0, 0, ${0.1 + Math.random() * 0.05})`;
        this.ctx.lineWidth = 1;
        for (let i = 0; i < 10; i++) {
            let size = 100 + (time * 0.1 + i * 50) % 500;
            this.ctx.save();
            this.ctx.translate(cx, cy);
            this.ctx.rotate((time * 0.0001) + (i * 0.5));
            if (Math.random() > 0.95) this.ctx.translate((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20); // Glitch
            this.ctx.strokeRect(-size/2, -size/2, size, size);
            this.ctx.restore();
        }
        
        // Drifting Embers
        for (let i = 0; i < 40; i++) {
            let px = (cx * 2 + Math.sin(i * 99) * cx * 2 + time * 0.05 * (1 + i % 3)) % (cx * 2);
            let py = (cy * 2 + Math.cos(i * 77) * cy * 2 - time * 0.1 * (1 + i % 2)) % (cy * 2);
            if (py < 0) py += cy * 2; // wrap
            
            this.ctx.fillStyle = `rgba(255, ${100 + (i%50)}, 0, ${0.3 + Math.sin(time*0.005 + i)*0.2})`;
            this.ctx.beginPath();
            this.ctx.arc(px, py, 1 + (i % 3), 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.restore();
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
        this.ctx.fillStyle = '#ffffff';
        this.hubDust.forEach(dust => {
            dust.x += dust.vx;
            dust.y += dust.vy;
            dust.phase += 0.015;
            
            if (dust.x > state.player.x + 800) dust.x -= 1600;
            if (dust.x < state.player.x - 800) dust.x += 1600;
            if (dust.y > state.player.y + 800) dust.y -= 1600;
            if (dust.y < state.player.y - 800) dust.y += 1600;

            let alpha = (Math.sin(dust.phase) + 1) / 2 * 0.5; 
            this.ctx.globalAlpha = alpha;
            this.ctx.beginPath();
            this.ctx.arc(dust.x, dust.y, dust.size, 0, Math.PI*2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1.0;
    }

    drawGame(state, audioEngine, gameState = 'PLAYING') {
        try {
            this.renderFrame++; 
            
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

            this.ctx.save();
            this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.scale(this.zoom, this.zoom);
            this.ctx.translate(-state.player.x, -state.player.y);
            
            let curShakeX = 0, curShakeY = 0;
            if (state.cameraShake > 0) {
                curShakeX = (Math.random() - 0.5) * state.cameraShake;
                curShakeY = (Math.random() - 0.5) * state.cameraShake;
                this.ctx.translate(curShakeX, curShakeY);
            }

            if (gameState === 'HUB') {
                if (state.hubWorld) {
                    
                    state.hubWorld.draw(this.ctx, state, this);
                    this.drawPlayer(state, audioEngine);
                    
                    if (this.lightCanvas.width !== this.canvas.width || this.lightCanvas.height !== this.canvas.height) {
                        this.lightCanvas.width = this.canvas.width;
                        this.lightCanvas.height = this.canvas.height;
                    } else {
                        this.lightCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                    }

                    this.lightCtx.save();
                    this.lightCtx.translate(this.canvas.width / 2, this.canvas.height / 2);
                    this.lightCtx.scale(this.zoom, this.zoom);
                    this.lightCtx.translate(-state.player.x, -state.player.y);

                    let darkness = state.hubWorld.lightIntensity < 0.5 ? 0.95 : 0.82;
                    this.lightCtx.fillStyle = `rgba(5, 8, 12, ${darkness})`;
                    this.lightCtx.fillRect(state.player.x - 2000, state.player.y - 2000, 4000, 4000);

                    this.lightCtx.globalCompositeOperation = 'destination-out';
                    
                    let fl = state.player.weapons.flashlight;
                    
                    // CRITICAL FIX: Safe Fallbacks for non-finite values that crash Canvas API
                    let flRadius = (fl && Number.isFinite(fl.radius) && fl.radius > 0) ? fl.radius : 250;
                    let currentAngle = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;
                    let jitter = (Math.random() - 0.5) * 0.02;

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

                    if (state.hubWorld.zones && state.hubWorld.lightIntensity > 0.5) {
                        state.hubWorld.zones.forEach(z => {
                            let pulse = Math.sin(this.renderFrame * 0.05 + z.x) * 5;
                            const glow = this.lightCtx.createRadialGradient(z.x, z.y, 0, z.x, z.y, 140 + pulse);
                            glow.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
                            glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
                            this.lightCtx.fillStyle = glow;
                            this.lightCtx.beginPath();
                            this.lightCtx.arc(z.x, z.y, 140 + pulse, 0, Math.PI * 2);
                            this.lightCtx.fill();
                        });
                    }
                    this.lightCtx.restore();

                    this.ctx.save();
                    this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
                    this.ctx.globalCompositeOperation = 'source-over';
                    this.ctx.drawImage(this.lightCanvas, 0, 0);
                    this.ctx.restore();

                    this.ctx.save();
                    this.ctx.globalCompositeOperation = 'screen';
                    
                    let flTint = this.ctx.createRadialGradient(
                        state.player.x, state.player.y, 0, 
                        state.player.x, state.player.y, flRadius * 1.5
                    );
                    flTint.addColorStop(0, 'rgba(255, 240, 200, 0.4)');
                    flTint.addColorStop(0.5, 'rgba(150, 180, 255, 0.1)');
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
                        state.hubWorld.zones.forEach(z => {
                            let pulse = Math.sin(this.renderFrame * 0.05 + z.x) * 5;
                            
                            const zoneTint = this.ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, 140 + pulse);
                            zoneTint.addColorStop(0, z.color);
                            zoneTint.addColorStop(1, 'transparent');
                            this.ctx.globalAlpha = 0.4;
                            this.ctx.fillStyle = zoneTint;
                            this.ctx.beginPath();
                            this.ctx.arc(z.x, z.y, 140 + pulse, 0, Math.PI * 2);
                            this.ctx.fill();

                            this.ctx.globalAlpha = 0.15;
                            const beam = this.ctx.createLinearGradient(z.x - 80, z.y - 300, z.x + 40, z.y + 50);
                            beam.addColorStop(0, '#ffffff');
                            beam.addColorStop(1, 'transparent');
                            this.ctx.fillStyle = beam;
                            this.ctx.beginPath();
                            this.ctx.moveTo(z.x - 80, z.y - 350); 
                            this.ctx.lineTo(z.x + 40, z.y - 350); 
                            this.ctx.lineTo(z.x + 120, z.y + 60); 
                            this.ctx.lineTo(z.x - 120, z.y + 60); 
                            this.ctx.fill();
                        });
                    }

                    this.drawHubDust(state);

                    this.ctx.restore();
                    
                } else {
                    this.ctx.fillStyle = '#0a0c11';
                    this.ctx.fillRect(state.player.x - 2000, state.player.y - 2000, 4000, 4000);
                    this.drawPlayer(state, audioEngine);
                }
            } else {
                this.drawWorldItems(state, audioEngine);
                this.drawFog(state);
                this.drawLightingMasks(state, curShakeX, curShakeY);
                this.drawEffectsAndAuras(state);
                this.drawPlayer(state, audioEngine);
                this.drawDamageText(state);
                this.drawObjectivePointers(state);
            }

            this.ctx.restore(); 

            if (gameState !== 'HUB') {
                this.drawVignette(state);

                if (this.bossAnnouncementTimer > 0) {
                    try {
                        this.drawBossAnnouncement(state);
                    } catch(e) {
                        console.warn("Recoverable Boss Intro error:", e);
                    }
                    this.bossAnnouncementTimer--; 
                }
                
                this.drawFilmGrain();
            } else {
                this.ctx.globalAlpha = 0.08; 
                this.drawFilmGrain();
                this.ctx.globalAlpha = 1.0;
            }

        } catch (e) {
            console.error("CRITICAL RENDERER CRASH PREVENTED:", e);
        } finally {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
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
            if (['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type) && e.hp > 0) {
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

        this.ctx.globalAlpha = atmo.haze;
        this.fogClouds.forEach(cloud => {
            if (!frozen) {
                cloud.x += cloud.vx;
                cloud.y += cloud.vy;
                cloud.phase = (cloud.phase || 0) + (cloud.driftRate || 0.006);
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

            const fGrad = this.ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, r);
            fGrad.addColorStop(0, `rgba(${atmo.fog}, ${core})`);
            fGrad.addColorStop(0.55, `rgba(${atmo.fog}, ${core * 0.4})`);
            fGrad.addColorStop(1, `rgba(${atmo.fog}, 0)`);
            this.ctx.fillStyle = fGrad;
            this.ctx.beginPath();
            this.ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1.0;
    }

    drawLightingMasks(state, curShakeX, curShakeY) {
        if (this.lightCanvas.width !== this.canvas.width || this.lightCanvas.height !== this.canvas.height) {
            this.lightCanvas.width = this.canvas.width;
            this.lightCanvas.height = this.canvas.height;
        } else {
            this.lightCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        this.lightCtx.save();
        this.lightCtx.translate(this.canvas.width / 2, this.canvas.height / 2);
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
        this.ctx.drawImage(this.lightCanvas, 0, 0);
        this.ctx.restore(); 
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

                        if (ent.gazeState === 'charging') {
                            this.ctx.globalAlpha = 0.5 + Math.sin(this.renderFrame * 0.5) * 0.5;
                            this.ctx.fillStyle = '#ff0000';
                            this.ctx.beginPath();
                            this.ctx.moveTo(0, 0);
                            this.ctx.lineTo(2000, -5);
                            this.ctx.lineTo(2000, 5);
                            this.ctx.fill();
                        } else if (ent.gazeState === 'sweeping') {
                            let pulse = Math.sin(this.renderFrame * 0.5) * 0.2;
                            let grad = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 2000);
                            grad.addColorStop(0, `rgba(255, 0, 0, ${0.8 + pulse})`);
                            grad.addColorStop(0.1, `rgba(255, 50, 0, ${0.5 + pulse})`);
                            grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                            
                            this.ctx.fillStyle = grad;
                            this.ctx.beginPath();
                            this.ctx.moveTo(0, 0);
                            this.ctx.arc(0, 0, 2000, -ent.gazeWidth, ent.gazeWidth);
                            this.ctx.fill();
                            
                            this.ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + pulse})`;
                            this.ctx.beginPath();
                            this.ctx.moveTo(0, 0);
                            this.ctx.arc(0, 0, 2000, -ent.gazeWidth*0.05, ent.gazeWidth*0.05);
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
                        let aColor = ent.actionState === 'charging_collapse' ? `rgba(255, 200, 50, ${0.2 + pulse})` : `rgba(255, 50, 50, ${0.6 + pulse})`;
                        
                        this.ctx.fillStyle = aColor;
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, 2500, 0, Math.PI * 2);
                        this.ctx.arc(0, 0, ent.safeZoneRadius, 0, Math.PI * 2);
                        this.ctx.fill('evenodd');
                        
                        this.ctx.strokeStyle = ent.actionState === 'charging_collapse' ? '#ffffff' : '#ff0000';
                        this.ctx.lineWidth = 5 + Math.sin(this.renderFrame * 0.5) * 3;
                        this.ctx.setLineDash([20, 10]);
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, ent.safeZoneRadius, 0, Math.PI * 2);
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
    }

    drawObjectivePointers(state) {
        if (state.interactables) {
            state.interactables.forEach(obj => {
                if (obj.type === 'OBJECTIVE_BACKPACK' || obj.type === 'EXIT_ELEVATOR' || obj.type === 'ROOM_DOOR') {
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
        
        const vig = this.ctx.createRadialGradient(
            this.canvas.width/2, this.canvas.height/2, innerVig,
            this.canvas.width/2, this.canvas.height/2, outerVig
        );
        
        let voidColor = 'rgba(0,0,0,0.98)';
        if (state.floor === 1) voidColor = 'rgba(30,20,10,0.98)';
        else if (state.floor === 2) voidColor = 'rgba(10,10,10,0.98)';
        else if (state.floor === 3) voidColor = 'rgba(40,5,5,0.98)';
        else if (state.floor === 4) voidColor = 'rgba(5,20,5,0.98)';
        else if (state.floor >= 5) voidColor = 'rgba(20,15,0,0.98)';
        
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, voidColor);
        this.ctx.fillStyle = vig;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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

    drawWorldItems(state) {
        this.ctx.save();
        const patternIndex = Math.max(0, Math.min((state.floor || 1) - 1, 4));
        this.ctx.fillStyle = this.cachedFloorPatterns[patternIndex];
        
        this.ctx.fillRect(state.player.x - 4000, state.player.y - 4000, 8000, 8000);
        this.ctx.restore();

        if (state.isTutorial && state.mapOriginX !== null) {
            this.ctx.save();
            const px = state.mapOriginX;
            const py = state.mapOriginY;
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.font = "bold 24px 'Courier New', Courier, monospace";
            this.ctx.fillStyle = '#aaffaa';
            
            const glowText = (text, x, y) => {
                this.ctx.globalAlpha = 0.3;
                this.ctx.fillText(text, x - 2, y);
                this.ctx.fillText(text, x + 2, y);
                this.ctx.fillText(text, x, y - 2);
                this.ctx.fillText(text, x, y + 2);
                this.ctx.globalAlpha = 1.0;
                this.ctx.fillText(text, x, y);
            };

            glowText("WASD to Move | Mouse to Aim", px, py - 100);
            glowText("SPACE to Dash", px, py + 100);
            glowText("The Void drains your Grip on reality. Eliminate the manifestation to proceed.", px + 600, py);
            this.ctx.restore();
        }

        if (state.decals && state.decals.length > 0) {
            this.ctx.save();
            state.decals.forEach(d => {
                this.ctx.fillStyle = d.color;
                this.ctx.globalAlpha = 0.5;
                this.ctx.beginPath();
                this.ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
                this.ctx.fill();
            });
            this.ctx.restore();
        }

        if (state.mapOriginX !== null) {
            this.ctx.save();
            const mapCenterX = state.mapOriginX;
            const mapCenterY = state.mapOriginY;
            const mapRadius = 1600;
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
                    let pulse = Math.sin(this.renderFrame * 0.1) * 10;
                    const doorInfo = this.roomDoorVisual(obj.rewardType);

                    const doorGlow = this.ctx.createRadialGradient(0, 0, 10, 0, 0, 80 + pulse);
                    doorGlow.addColorStop(0, `rgba(${doorInfo.glowRgb}, 0.8)`);
                    doorGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    this.ctx.fillStyle = doorGlow;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 80 + pulse, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#111';
                    this.ctx.fillRect(-25, -40, 50, 80);
                    this.ctx.strokeStyle = doorInfo.color;
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(-25, -40, 50, 80);

                    this.ctx.fillStyle = doorInfo.color;
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.font = "bold 16px 'Courier New', Courier, monospace";
                    this.ctx.fillText(doorInfo.label, 0, -60);
                }
                
                this.ctx.restore();
            });
        }

        if (state.inkPuddles) {
            state.inkPuddles.forEach(p => {
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
                        `scav|${isFlashed ? 1 : 0}|${sackSize}|${bobQ}`, 64, 64,
                        (cx) => {
                            // Sack: heavy load dragging behind the hunch, drawn first so the
                            // body's back edge overlaps its top and reads as "carried".
                            cx.fillStyle = isFlashed ? '#999999' : '#1a1c1a';
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
                            cx.fillStyle = isFlashed ? '#bbbbbb' : '#2a2d2a';
                            cx.beginPath();
                            cx.moveTo(13, 4 + bobQ);
                            cx.quadraticCurveTo(10, -11, 2, -9 + bobQ);
                            cx.quadraticCurveTo(-6, -6, -9, bobQ);
                            cx.quadraticCurveTo(-8, 6, -2, 8 + bobQ);
                            cx.quadraticCurveTo(6, 9, 13, 4 + bobQ);
                            cx.closePath();
                            cx.fill();

                            cx.fillStyle = '#aaaa00';
                            cx.beginPath();
                            cx.arc(11, 1 + bobQ, 1.5, 0, Math.PI*2);
                            cx.fill();
                        }
                    );
                    this.drawSprite(scavSprite);

                    // Sweeping arm stays live — it swings independently of the body and
                    // would otherwise multiply the sprite count by every sweep position.
                    this.ctx.strokeStyle = '#111';
                    this.ctx.lineWidth = 2.5;
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
                    
                    this.ctx.fillStyle = isFlashed ? '#ddaaaa' : (ent.buffed ? '#3a0a0a' : '#111111');
                    this.ctx.beginPath();

                    let stretch = ent.attackState === 'lunging' ? 5 : 0;

                    // Low, elongated body: pointed snout forward, long low belly,
                    // tapering tail behind. Kept flatter (smaller y-extent) than the
                    // old hexagon so it reads as ground-hugging rather than round.
                    this.ctx.moveTo(20 + stretch, 0);
                    this.ctx.lineTo(9, 5 + this.entPulse(ent, 0.2)*2);
                    this.ctx.lineTo(-11 - stretch, 5);
                    this.ctx.lineTo(-23 - stretch, 0);
                    this.ctx.lineTo(-11 - stretch, -5);
                    this.ctx.lineTo(9, -5 - this.entPulse(ent, 0.2, Math.PI/2)*2);
                    this.ctx.closePath();
                    this.ctx.fill();

                    // Jagged spine: serrated ridge along the top edge, tail to shoulders.
                    this.ctx.beginPath();
                    let spineStartX = -20 - stretch;
                    let spineEndX = 8;
                    let spikes = 5;
                    this.ctx.moveTo(spineStartX, -4);
                    for (let i = 1; i <= spikes; i++) {
                        let t = i / spikes;
                        let x = spineStartX + (spineEndX - spineStartX) * t;
                        let spikeH = (i % 2 === 0) ? -12 : -6;
                        this.ctx.lineTo(x, spikeH);
                    }
                    this.ctx.lineTo(spineEndX, -4);
                    this.ctx.closePath();
                    this.ctx.fill();

                    this.ctx.strokeStyle = this.ctx.fillStyle;
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();

                    if (ent.attackState === 'lunging') {
                        this.ctx.moveTo(-2, 5);
                        this.ctx.lineTo(-22, 9);
                        this.ctx.moveTo(-2, -5);
                        this.ctx.lineTo(-22, -9);
                    } else {
                        this.ctx.moveTo(-2, 5);
                        this.ctx.quadraticCurveTo(8, 13, 12, 4);
                        this.ctx.moveTo(-2, -5);
                        this.ctx.quadraticCurveTo(8, -13, 12, -4);
                    }
                    this.ctx.stroke();

                    const predGlowAmt = (ent.attackState === 'telegraphing') ? 20 : 10;
                    const predEyeColor = (ent.attackState === 'telegraphing') ? '#ff3333' : (ent.buffed ? '#ff0000' : '#cc0000');

                    // Single glowing red eye, centered on the snout.
                    this.drawGlow(13 + stretch, 0, 10 + predGlowAmt, predEyeColor, 0.5);

                    this.ctx.fillStyle = predEyeColor;
                    this.ctx.beginPath();
                    this.ctx.ellipse(13 + stretch, 0, 3, 2, 0, 0, Math.PI*2);
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
                    const paraGlowAmt = 6 + pulse;
                    this.drawGlow(0, 0, 5 + paraGlowAmt, isFlashed ? '#ffcccc' : '#6b2222', 0.4);

                    this.ctx.fillStyle = isFlashed ? '#ffcccc' : '#6b2222';
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 5 + pulse, 0, Math.PI*2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#050505';
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 2 + pulse*0.5, 0, Math.PI*2);
                    this.ctx.fill();

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
                    } finally {
                        // finally, not just a trailing restore() — the try above is there
                        // specifically so a mid-draw exception doesn't crash the render
                        // loop, and the new save() at branch start must never be left
                        // unbalanced (which would silently corrupt every render after it).
                        this.ctx.restore();
                    }
                }

                if (ent.hp < ent.maxHp && ent.flashTime <= 0 && !['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(ent.type)) {
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
            
            const cx = this.canvas.width / 2;
            const cy = this.canvas.height / 2;
            
            let alpha = 1;
            if (this.bossAnnouncementTimer > 210) {
                alpha = (240 - this.bossAnnouncementTimer) / 30; 
            } else if (this.bossAnnouncementTimer < 30) {
                alpha = this.bossAnnouncementTimer / 30; 
            }

            this.ctx.globalAlpha = alpha;
            this.ctx.translate(cx, cy);

            this.ctx.fillStyle = 'rgba(10, 0, 0, 0.95)';
            this.ctx.fillRect(-this.canvas.width/2, -300, this.canvas.width, 600); 
            
            if (this.renderFrame % 3 === 0) {
                this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                for (let i=0; i<15; i++) {
                    this.ctx.fillRect(-this.canvas.width/2, -300 + Math.random() * 600, this.canvas.width, 5 + Math.random() * 15);
                }
            }
            
            this.ctx.strokeStyle = '#c5a059';
            this.ctx.lineWidth = 6;
            this.ctx.beginPath();
            this.ctx.moveTo(-this.canvas.width/2, -300); this.ctx.lineTo(this.canvas.width/2, -300);
            this.ctx.moveTo(-this.canvas.width/2, 300); this.ctx.lineTo(this.canvas.width/2, 300);
            this.ctx.stroke();

            this.ctx.save();
            this.ctx.translate(-400, 0); 
            this.ctx.scale(5.5, 5.5); 
            
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
            
            this.ctx.font = "900 110px 'Courier New', Courier, monospace";
            this.ctx.fillStyle = '#ffffff';
            
            this.ctx.save();
            const textGlow = this.ctx.createRadialGradient(0, -50, 0, 0, -50, 400);
            textGlow.addColorStop(0, 'rgba(139, 0, 0, 0.3)');
            textGlow.addColorStop(1, 'rgba(139, 0, 0, 0)');
            this.ctx.fillStyle = textGlow;
            this.ctx.fillText(titleText, -100 + textJitter, -50);
            this.ctx.restore();

            this.ctx.fillText(titleText, -100 + textJitter, -50);
            
            this.ctx.font = "italic 45px 'Courier New', Courier, monospace";
            this.ctx.fillStyle = '#c5a059';
            this.ctx.fillText(subText, -90 + textJitter, 60);
            
        } finally {
            this.ctx.restore();
        }
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
                img.life -= 0.1;
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
            let globalVx = state.player.x - this.lastPx;
            let globalVy = state.player.y - this.lastPy;
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
            this.legPhase += 0.3 + (panic * 0.4);
            
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
                
                this.ctx.fillStyle = '#888';
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
