// src/core/Renderer.js
export class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        
        this.noisePattern = this.generateNoisePattern();
        this.cachedNoisePattern = this.ctx.createPattern(this.noisePattern, 'repeat');
        this.fogClouds = this.generateFogClouds();
        this.floorPattern = this.generateFloorPattern();
        this.cachedFloorPattern = this.ctx.createPattern(this.floorPattern, 'repeat');
        
        this.lightCanvas = document.createElement('canvas');
        this.lightCtx = this.lightCanvas.getContext('2d');
        
        this.zoom = 1.3; 
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
    }

    generateFloorPattern() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const cx = c.getContext('2d');
        
        cx.fillStyle = '#0a0a0d';
        cx.fillRect(0, 0, 512, 512);
        
        cx.strokeStyle = '#050505';
        cx.lineWidth = 4;
        for(let i = 0; i <= 512; i += 128) {
            cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, 512); cx.stroke();
            cx.beginPath(); cx.moveTo(0, i); cx.lineTo(512, i); cx.stroke();
        }

        for(let i = 0; i < 40; i++) {
            cx.fillStyle = Math.random() > 0.7 ? 'rgba(70, 10, 10, 0.3)' : 'rgba(0, 0, 0, 0.5)';
            cx.beginPath();
            let x = Math.random() * 512;
            let y = Math.random() * 512;
            let r = Math.random() * 20 + 5;
            cx.ellipse(x, y, r, r/2, Math.random() * Math.PI, 0, Math.PI*2);
            cx.fill();
        }
        return c;
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
                vy: (Math.random() - 0.5) * 1.5
            });
        }
        return clouds;
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
        
        this.ctx.save();
        this.ctx.translate(cx + this.canvas.width * 0.3, cy);
        this.ctx.scale(25, 25); 
        this.ctx.globalAlpha = 0.08 + Math.sin(time * 0.0005) * 0.03;
        this.ctx.rotate(time * 0.0001);
        
        this.ctx.fillStyle = '#000';
        this.ctx.beginPath();
        for (let i = 0; i < 16; i++) {
            let angle = (i / 16) * Math.PI * 2;
            let reach = 35 + Math.sin(time * 0.001 + i * 2) * 15;
            if (i === 0) this.ctx.moveTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
            else this.ctx.lineTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
        }
        this.ctx.fill();
        this.ctx.restore();

        this.ctx.save();
        this.ctx.translate(cx - this.canvas.width * 0.3, cy + 100);
        this.ctx.scale(30, 30); 
        this.ctx.globalAlpha = 0.06 + Math.cos(time * 0.0004) * 0.03;
        
        let pulse = Math.sin(time * 0.002) * 5;
        this.ctx.fillStyle = '#000';
        for (let mirror = -1; mirror <= 1; mirror += 2) {
            this.ctx.save();
            this.ctx.scale(mirror, 1);
            this.ctx.beginPath();
            this.ctx.moveTo(0, -30);
            this.ctx.bezierCurveTo(20, -30, 30 + pulse, -15, 25, 0);
            this.ctx.bezierCurveTo(40, 15, 20, 30, 0, 30 + pulse);
            this.ctx.fill();
            this.ctx.restore();
        }
        this.ctx.restore();

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

            // --- PHASE 2: HUB RENDERING ROUTER ---
            // If the player is in the Hub, ONLY draw the HubWorld layout and bypass the main game rendering entirely!
            if (gameState === 'HUB') {
                if (state.hubWorld) {
                    state.hubWorld.draw(this.ctx, state, this);
                } else {
                    // CRITICAL FAILSAFE: If the HubWorld reference is lost, draw a safe black room 
                    // instead of letting the nightmare void bleed into the safe zone.
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

            // Only apply standard vignette and boss intros if we are actively playing
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
            } else {
                // Soft spotlight vignette exclusively for the Hub
                this.ctx.save();
                const vig = this.ctx.createRadialGradient(
                    this.canvas.width/2, this.canvas.height/2, this.canvas.height / 3,
                    this.canvas.width/2, this.canvas.height/2, this.canvas.height
                );
                vig.addColorStop(0, 'rgba(0,0,0,0)');
                vig.addColorStop(1, 'rgba(0,0,0,0.9)');
                this.ctx.fillStyle = vig;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();
            }

            this.drawFilmGrain();

        } catch (e) {
            console.error("CRITICAL RENDERER CRASH PREVENTED:", e);
        } finally {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
    }

    drawFog(state) {
        this.ctx.globalAlpha = 0.5;
        this.fogClouds.forEach(cloud => {
            if(state.hitStop > 0) { cloud.x += cloud.vx; cloud.y += cloud.vy; }
            else { cloud.x += cloud.vx; cloud.y += cloud.vy; }
            
            let dx = (cloud.x - state.player.x) % 2000;
            if (dx < -1000) dx += 2000; else if (dx > 1000) dx -= 2000;
            let dy = (cloud.y - state.player.y) % 2000;
            if (dy < -1000) dy += 2000; else if (dy > 1000) dy -= 2000;
            let drawX = state.player.x + dx;
            let drawY = state.player.y + dy;

            const fGrad = this.ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, cloud.r);
            fGrad.addColorStop(0, 'rgba(200, 210, 220, 0.5)');
            fGrad.addColorStop(1, 'rgba(200, 210, 220, 0)');
            this.ctx.fillStyle = fGrad;
            this.ctx.beginPath();
            this.ctx.arc(drawX, drawY, cloud.r, 0, Math.PI * 2);
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

        this.lightCtx.fillStyle = '#010102';
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
        let ambientRad = fl.radius * 0.45; 
        let currentAngle = fl.angle;
        let jitter = state.sanity < 30 ? (Math.random() - 0.5) * 0.1 : 0;

        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) {
            if (this.renderFrame % 6 < 3) { currentAngle *= 1.5; }
            else { currentAngle *= 0.8; }
        }

        if (state.player.curses && state.player.curses.includes('tunnel_vision')) {
            ambientRad = 0; 
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

        const flHole = this.lightCtx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
        flHole.addColorStop(0, 'rgba(255, 255, 255, 1)');
        flHole.addColorStop(0.8, 'rgba(255, 255, 255, 0.9)'); 
        flHole.addColorStop(1, 'rgba(255, 255, 255, 0)');     
        
        this.lightCtx.fillStyle = flHole;
        this.lightCtx.beginPath();
        this.lightCtx.moveTo(state.player.x, state.player.y);
        this.lightCtx.arc(state.player.x, state.player.y, fl.radius, state.player.angle - currentAngle + jitter, state.player.angle + currentAngle + jitter);
        this.lightCtx.closePath();
        this.lightCtx.fill();

        this.lightCtx.restore(); 

        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); 
        this.ctx.drawImage(this.lightCanvas, 0, 0);
        this.ctx.restore(); 
    }

    drawEffectsAndAuras(state) {
        const fl = state.player.weapons.flashlight;
        
        if (state.player.sets && state.player.sets.insomniac >= 4) {
            const inner = fl.radius;
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

        let currentAngle = fl.angle;
        let jitter = state.sanity < 30 ? (Math.random() - 0.5) * 0.1 : 0;
        let isStrobing = false;
        if (state.player.synergies && state.player.synergies.includes('blinding_signal')) {
            if (this.renderFrame % 6 < 3) { currentAngle *= 1.5; isStrobing = true; }
            else { currentAngle *= 0.8; }
        }

        const glareGrad = this.ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
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
        this.ctx.arc(state.player.x, state.player.y, fl.radius, state.player.angle - currentAngle + jitter, state.player.angle + currentAngle + jitter);
        this.ctx.closePath();
        this.ctx.fill();

        let ambientRad = state.player.curses && state.player.curses.includes('tunnel_vision') ? 0 : fl.radius * 0.45;
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
                if (obj.type === 'OBJECTIVE_BACKPACK' || obj.type === 'EXIT_ELEVATOR') {
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
                        }
                        
                        this.ctx.restore();
                    }
                }
            });
        }
    }

    drawVignette(state) {
        this.ctx.save();
        let sanityRatio = Math.max(0.01, state.sanity / state.player.maxHp);
        let innerVig = (this.canvas.height / 4) * sanityRatio; 
        let outerVig = (this.canvas.height) * (0.2 + sanityRatio * 0.8); 
        
        const vig = this.ctx.createRadialGradient(
            this.canvas.width/2, this.canvas.height/2, innerVig,
            this.canvas.width/2, this.canvas.height/2, outerVig
        );
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.98)');
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
        this.ctx.fillStyle = this.cachedFloorPattern;
        
        this.ctx.fillRect(state.player.x - 4000, state.player.y - 4000, 8000, 8000);
        this.ctx.restore();

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

                    this.ctx.fillStyle = bulbColor;
                    this.ctx.shadowBlur = glow;
                    this.ctx.shadowColor = '#ffffaa';
                    this.ctx.beginPath();
                    this.ctx.arc(0, -10, 12, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.shadowBlur = 0;

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
                    let pulse = Math.sin(this.renderFrame * 0.1) * 5;
                    
                    this.ctx.fillStyle = '#111';
                    this.ctx.fillRect(-30, -30, 60, 60); 
                    
                    this.ctx.shadowColor = '#fff';
                    this.ctx.shadowBlur = 15 + pulse;
                    this.ctx.fillStyle = `rgba(255, 255, 255, ${0.8 + Math.sin(this.renderFrame * 0.2)*0.2})`;
                    this.ctx.fillRect(-20, -20, 40, 40); 
                    this.ctx.shadowBlur = 0;
                    
                    this.ctx.fillStyle = '#000';
                    this.ctx.beginPath();
                    this.ctx.moveTo(-10, -5); this.ctx.lineTo(10, -5); this.ctx.lineTo(0, 10);
                    this.ctx.fill();
                }
                
                this.ctx.restore();
            });
        }

        if (state.inkPuddles) {
            state.inkPuddles.forEach(p => {
                const lifeRatio = p.life / 300;
                
                this.ctx.save();
                this.ctx.shadowColor = '#d900ff'; 
                this.ctx.shadowBlur = 15 * lifeRatio;
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

                this.ctx.shadowBlur = 0;
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
                
                this.ctx.shadowColor = '#88ccff';
                this.ctx.shadowBlur = 10;
                
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.arc(0, Math.sin(time*2)*3, 2.5 + pulse*0.5, 0, Math.PI*2);
                this.ctx.fill();
                
                this.ctx.strokeStyle = 'rgba(150, 200, 255, 0.6)';
                this.ctx.lineWidth = 1.5;
                this.ctx.beginPath();
                this.ctx.moveTo(0, Math.sin(time*2)*3);
                this.ctx.quadraticCurveTo(-4, -4, -Math.cos(time)*6, -6);
                this.ctx.stroke();
                
                this.ctx.shadowBlur = 0;
                this.ctx.restore();
            });
        }

        if (state.tokenDrops) {
            state.tokenDrops.forEach(token => {
                this.ctx.save();
                this.ctx.translate(token.x, token.y);
                
                const time = this.renderFrame * 0.1 + token.x;
                const pulse = Math.sin(time) * 3;
                
                this.ctx.shadowColor = token.color;
                this.ctx.shadowBlur = 15 + pulse;
                
                this.ctx.fillStyle = token.color;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 6, 10 + pulse * 0.2, 0, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.ellipse(0, -3, 2, 4, 0, 0, Math.PI * 2);
                this.ctx.fill();
                
                this.ctx.shadowBlur = 0;
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

                if (ent.type === 'ARCHITECT') {
                    let pulse = Math.sin(this.renderFrame * 0.1) * 5;
                    this.ctx.fillStyle = '#111';
                    this.ctx.shadowColor = '#c5a059';
                    this.ctx.shadowBlur = 30 + pulse;
                    
                    this.ctx.save();
                    this.ctx.rotate(this.renderFrame * 0.05);
                    this.ctx.strokeStyle = '#c5a059';
                    this.ctx.lineWidth = 3;
                    this.ctx.strokeRect(-30, -30, 60, 60);
                    this.ctx.rotate(Math.PI / 4);
                    this.ctx.strokeRect(-30, -30, 60, 60);
                    this.ctx.restore();

                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -40);
                    this.ctx.lineTo(25, 0);
                    this.ctx.lineTo(0, 40);
                    this.ctx.lineTo(-25, 0);
                    this.ctx.closePath();
                    this.ctx.fill();
                    
                    this.ctx.fillStyle = '#ffffff';
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -15);
                    this.ctx.lineTo(8, 0);
                    this.ctx.lineTo(0, 15);
                    this.ctx.lineTo(-8, 0);
                    this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.shadowBlur = 0;
                }
                else if (ent.type === 'PANOPTICON') {
                    let bob = Math.sin(this.renderFrame * 0.05) * 15;
                    let panicTwitch = (Math.random() - 0.5) * (ent.gazeState === 'charging' ? 8 : 2);
                    this.ctx.translate(panicTwitch, bob + panicTwitch);
                    
                    let angleToPlayer = Math.atan2(state.player.y - ent.y, state.player.x - ent.x);
                    if (ent.gazeState === 'sweeping' || ent.gazeState === 'charging') angleToPlayer = ent.gazeAngle;
                    
                    this.ctx.strokeStyle = '#4a0010';
                    this.ctx.lineWidth = 4;
                    for(let i=0; i<12; i++) {
                        let tAngle = (i/12) * Math.PI * 2 + (this.renderFrame * 0.02);
                        let tLen = 60 + Math.sin(this.renderFrame * 0.1 + i) * 20;
                        this.ctx.beginPath();
                        this.ctx.moveTo(0, 0);
                        this.ctx.quadraticCurveTo(Math.cos(tAngle + 0.5)*tLen*0.5, Math.sin(tAngle + 0.5)*tLen*0.5, Math.cos(tAngle)*tLen, Math.sin(tAngle)*tLen);
                        this.ctx.stroke();
                    }

                    this.ctx.strokeStyle = '#ff0044';
                    this.ctx.lineWidth = 2;
                    let spinSpeed = ent.gazeState === 'charging' ? 0.1 : 0.02;
                    for(let r=0; r<4; r++) {
                        this.ctx.save();
                        this.ctx.rotate(this.renderFrame * (spinSpeed + r*0.01) * (r%2===0?1:-1));
                        this.ctx.beginPath();
                        this.ctx.ellipse(0, 0, 60 + r*15, 25 + r*10, 0, 0, Math.PI*2);
                        this.ctx.stroke();
                        
                        this.ctx.fillStyle = '#ff0000';
                        this.ctx.beginPath();
                        this.ctx.arc(60 + r*15, 0, 5, 0, Math.PI*2);
                        this.ctx.arc(-(60 + r*15), 0, 5, 0, Math.PI*2);
                        this.ctx.fill();
                        this.ctx.restore();
                    }

                    this.ctx.fillStyle = isFlashed ? '#ffffff' : '#1a0005';
                    this.ctx.shadowColor = '#ff0000';
                    this.ctx.shadowBlur = 40;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 45, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.shadowBlur = 0;

                    this.ctx.fillStyle = '#ffcccc';
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 35, 40, angleToPlayer, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.save();
                    this.ctx.rotate(angleToPlayer);
                    this.ctx.fillStyle = (ent.gazeState === 'sweeping' || ent.gazeState === 'charging') ? '#ffff00' : '#ff0000';
                    this.ctx.beginPath();
                    this.ctx.ellipse(15, 0, 18, 24, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                    
                    this.ctx.fillStyle = '#000';
                    this.ctx.beginPath();
                    let pWidth = (ent.gazeState === 'charging') ? 2 : (ent.gazeState === 'sweeping' ? 12 : 6);
                    this.ctx.ellipse(18, 0, pWidth, 20, 0, 0, Math.PI * 2);
                    this.ctx.fill();
                    this.ctx.restore();
                }
                else if (ent.type === 'AMALGAMATION') {
                    let pulse = Math.sin(this.renderFrame * 0.1) * 8;
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
                    grad.addColorStop(0, '#5a7a2a');
                    grad.addColorStop(0.6, '#1a2a0a');
                    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    this.ctx.fillStyle = grad;
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 90 + pulse, 0, Math.PI * 2);
                    this.ctx.fill();

                    this.ctx.fillStyle = isFlashed ? '#ddaaaa' : ent.color;
                    for (let m = 0; m < 8; m++) {
                        this.ctx.save();
                        let mAngle = (m / 8) * Math.PI * 2 + (this.renderFrame * 0.01);
                        let mDist = 25 + Math.sin(this.renderFrame * 0.05 + m) * 15;
                        this.ctx.translate(Math.cos(mAngle) * mDist, Math.sin(mAngle) * mDist);
                        this.ctx.rotate(this.renderFrame * 0.05 * (m % 2 === 0 ? 1 : -1));
                        
                        this.ctx.beginPath();
                        this.ctx.ellipse(0, 0, 20 + Math.sin(this.renderFrame*0.1)*5, 15, 0, 0, Math.PI*2);
                        this.ctx.fill();
                        
                        this.ctx.fillStyle = '#ffaa00';
                        this.ctx.beginPath();
                        this.ctx.arc(5, 0, 3, 0, Math.PI*2);
                        this.ctx.fill();
                        this.ctx.restore();
                    }

                    this.ctx.fillStyle = isFlashed ? '#fff' : '#050505';
                    this.ctx.beginPath();
                    this.ctx.arc(0, 0, 20 + pulse * 0.5, 0, Math.PI * 2);
                    this.ctx.fill();

                    if (ent.actionState === 'spawning') {
                        this.ctx.strokeStyle = '#55ff55';
                        this.ctx.lineWidth = 4;
                        this.ctx.setLineDash([10, 10]);
                        this.ctx.beginPath();
                        this.ctx.arc(0, 0, 45 + Math.sin(this.renderFrame * 0.2) * 10, 0, Math.PI * 2);
                        this.ctx.stroke();
                        this.ctx.setLineDash([]);
                    }
                }
                else if (ent.type === 'RORSCHACH') {
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

                    this.ctx.rotate(Math.sin(this.renderFrame * 0.05) * 0.1);
                    let pulse = Math.sin(this.renderFrame * 0.1) * (5 / ent.generation);
                    
                    this.ctx.fillStyle = isFlashed ? '#ddaaaa' : ent.color;
                    this.ctx.shadowColor = '#800080';
                    this.ctx.shadowBlur = 15;
                    
                    for (let mirror = -1; mirror <= 1; mirror += 2) {
                        this.ctx.save();
                        this.ctx.scale(mirror, 1);
                        this.ctx.beginPath();
                        this.ctx.moveTo(0, -ent.radius);
                        this.ctx.bezierCurveTo(ent.radius, -ent.radius, ent.radius + pulse, -ent.radius/2, ent.radius*0.8, 0);
                        this.ctx.bezierCurveTo(ent.radius*1.2, ent.radius/2, ent.radius, ent.radius, 0, ent.radius + pulse);
                        this.ctx.fill();
                        
                        this.ctx.fillStyle = isFlashed ? '#fff' : '#ff0055'; 
                        this.ctx.beginPath();
                        this.ctx.arc(ent.radius*0.3 + Math.sin(this.renderFrame*0.1)*2, 0, ent.radius*0.1, 0, Math.PI*2);
                        this.ctx.fill();
                        
                        this.ctx.restore();
                    }
                    this.ctx.shadowBlur = 0;
                }
                else if (ent.type === 'SCAVENGER') {
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

                    this.ctx.fillStyle = isFlashed ? '#bbbbbb' : '#2a2d2a';
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 12, 15 + Math.sin(this.renderFrame*0.1)*2, 0, 0, Math.PI*2);
                    this.ctx.fill();
                    
                    this.ctx.fillStyle = isFlashed ? '#999999' : '#1a1c1a';
                    this.ctx.beginPath();
                    let sackSize = 9 + (ent.hp > 30 ? 3 : 0);
                    this.ctx.arc(-6, 5, sackSize, 0, Math.PI*2);
                    this.ctx.fill();

                    this.ctx.fillStyle = '#aaaa00';
                    this.ctx.beginPath();
                    this.ctx.arc(8, -4, 1.5, 0, Math.PI*2);
                    this.ctx.fill();

                    this.ctx.strokeStyle = '#111';
                    this.ctx.lineWidth = 2.5;
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, 10);
                    let sweepOffset = ent.vacuumState === 'vacuuming' ? 0 : Math.sin(this.renderFrame * 0.2)*5;
                    this.ctx.lineTo(10 + sweepOffset, 18);
                    this.ctx.stroke();
                } 
                else if (ent.type === 'PREDATOR') {
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
                        this.ctx.strokeStyle = ent.buffed ? '#ff0000' : '#ff3333';
                        this.ctx.lineWidth = 3;
                        this.ctx.lineCap = 'round';
                        this.ctx.shadowColor = this.ctx.strokeStyle;
                        this.ctx.shadowBlur = 10;
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
                    this.ctx.moveTo(18 + stretch, 0); 
                    this.ctx.lineTo(5, 12 - stretch + Math.sin(this.renderFrame*0.2)*3);
                    this.ctx.lineTo(-15 - stretch, 10);
                    this.ctx.lineTo(-20 - stretch, 0); 
                    this.ctx.lineTo(-15 - stretch, -10);
                    this.ctx.lineTo(5, -12 + stretch - Math.cos(this.renderFrame*0.2)*3);
                    this.ctx.closePath();
                    this.ctx.fill();

                    this.ctx.strokeStyle = this.ctx.fillStyle;
                    this.ctx.lineWidth = 2;
                    this.ctx.beginPath();
                    
                    if (ent.attackState === 'lunging') {
                        this.ctx.moveTo(0, 10);
                        this.ctx.lineTo(-20, 15);
                        this.ctx.moveTo(0, -10);
                        this.ctx.lineTo(-20, -15);
                    } else {
                        this.ctx.moveTo(0, 10);
                        this.ctx.quadraticCurveTo(15, 20, 18, 8);
                        this.ctx.moveTo(0, -10);
                        this.ctx.quadraticCurveTo(15, -20, 18, -8);
                    }
                    this.ctx.stroke();

                    this.ctx.fillStyle = ent.buffed ? '#ff0000' : '#cc0000';
                    this.ctx.shadowColor = '#ff0000';
                    this.ctx.shadowBlur = 10;
                    if (ent.attackState === 'telegraphing') {
                        this.ctx.shadowBlur = 20; 
                        this.ctx.fillStyle = '#ff3333';
                    }
                    
                    this.ctx.beginPath();
                    this.ctx.ellipse(10 + stretch, -4, 3, 1.5, Math.PI/6, 0, Math.PI*2);
                    this.ctx.ellipse(10 + stretch, 4, 3, 1.5, -Math.PI/6, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.shadowBlur = 0; 
                }
                else if (ent.type === 'PARASITE') {
                    this.ctx.rotate(this.renderFrame * 0.2); 
                    
                    if (ent.lashingState === 'lashing' && ent.lashTarget) {
                        this.ctx.save();
                        let dx = ent.lashTarget.x - ent.x;
                        let dy = ent.lashTarget.y - ent.y;
                        
                        this.ctx.rotate(-this.renderFrame * 0.2); 
                        
                        this.ctx.strokeStyle = `rgba(255, 100, 100, ${1 - (ent.lashTimer/30)})`;
                        this.ctx.lineWidth = 3;
                        this.ctx.beginPath();
                        this.ctx.moveTo(0,0);
                        this.ctx.lineTo(dx, dy);
                        this.ctx.stroke();
                        
                        this.ctx.restore();
                    }

                    let pulse = Math.sin(this.renderFrame * 0.3) * 1.5;
                    if (ent.lashingState === 'lashing') pulse = Math.sin(this.renderFrame * 1.5) * 3; 

                    this.ctx.fillStyle = isFlashed ? '#ffcccc' : '#6b2222';
                    this.ctx.beginPath(); 
                    this.ctx.arc(0, 0, 5 + pulse, 0, Math.PI*2); 
                    this.ctx.fill();

                    this.ctx.fillStyle = '#050505';
                    this.ctx.beginPath(); 
                    this.ctx.arc(0, 0, 2 + pulse*0.5, 0, Math.PI*2); 
                    this.ctx.fill();
                    
                    this.ctx.strokeStyle = isFlashed ? '#ffffff' : ent.color;
                    this.ctx.lineWidth = 1.5;
                    this.ctx.lineCap = 'round';
                    
                    let curl = ent.lashingState === 'lashing' ? 0.5 : 0;
                    
                    for(let i=0; i<8; i++) {
                        let angle = (i/8) * Math.PI * 2 + (Math.sin(this.renderFrame*0.5 + i)*0.2) + curl;
                        let length = 8 + Math.random() * 4;
                        if (ent.lashingState === 'lashing') length -= 3; 
                        
                        this.ctx.beginPath();
                        this.ctx.moveTo(Math.cos(angle)*4, Math.sin(angle)*4);
                        let midX = Math.cos(angle + 0.3) * (length*0.6);
                        let midY = Math.sin(angle + 0.3) * (length*0.6);
                        this.ctx.lineTo(midX, midY);
                        this.ctx.lineTo(Math.cos(angle)*length, Math.sin(angle)*length);
                        this.ctx.stroke();
                    }
                }
                else if (ent.type === 'BOSS') {
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
                        
                        let pulse = Math.sin(this.renderFrame * 0.1) * 3;
                        if (ent.pulseState === 'charging') {
                            pulse = Math.sin(this.renderFrame * 0.5) * 5; 
                            this.ctx.translate((Math.random()-0.5)*5, (Math.random()-0.5)*5); 
                        }

                        this.ctx.fillStyle = isFlashed ? '#ddaaaa' : '#1a0d15';
                        this.ctx.beginPath();
                        for (let i = 0; i < 16; i++) {
                            let angle = (i / 16) * Math.PI * 2;
                            let reach = 35 + Math.sin(phase * 4 + i * 2) * 15 + (i % 2 === 0 ? 10 : -5);
                            if (ent.pulseState === 'charging') reach -= 10; 
                            if (i === 0) this.ctx.moveTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
                            else this.ctx.lineTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
                        }
                        this.ctx.closePath();
                        this.ctx.fill();

                        this.ctx.fillStyle = isFlashed ? '#ffcccc' : '#2b1010';
                        this.ctx.beginPath();
                        this.ctx.ellipse(0, 0, 25 + pulse, 30 - pulse, 0, 0, Math.PI*2);
                        this.ctx.fill();

                        this.ctx.fillStyle = '#050000';
                        this.ctx.beginPath();
                        for (let i = 0; i < 10; i++) {
                            let angle = (i / 10) * Math.PI * 2;
                            let innerReach = 10 + Math.random() * 8; 
                            if (ent.pulseState === 'charging') innerReach += 5 + Math.random()*5; 
                            if (i === 0) this.ctx.moveTo(Math.cos(angle)*innerReach, Math.sin(angle)*innerReach);
                            else this.ctx.lineTo(Math.cos(angle)*innerReach, Math.sin(angle)*innerReach);
                        }
                        this.ctx.closePath();
                        this.ctx.fill();

                        this.ctx.fillStyle = '#ff0000';
                        this.ctx.shadowColor = '#ff0000';
                        this.ctx.shadowBlur = 15;
                        
                        const eyes = [
                            {x: -12, y: -15, r: 4}, {x: 18, y: -10, r: 3},
                            {x: 5, y: 22, r: 5}, {x: -20, y: 8, r: 2}, {x: 15, y: 15, r: 2.5}
                        ];

                        eyes.forEach(eye => {
                            let jx = Math.cos(this.renderFrame * 0.2 + eye.x) * 1.5;
                            let jy = Math.sin(this.renderFrame * 0.2 + eye.y) * 1.5;
                            this.ctx.beginPath();
                            this.ctx.arc(eye.x + jx, eye.y + jy, eye.r, 0, Math.PI*2);
                            this.ctx.fill();
                            this.ctx.fillStyle = '#000000';
                            this.ctx.shadowBlur = 0;
                            this.ctx.beginPath();
                            this.ctx.ellipse(eye.x + jx, eye.y + jy, eye.r * 0.2, eye.r * 0.8, 0, 0, Math.PI*2);
                            this.ctx.fill();
                            this.ctx.fillStyle = '#ff0000';
                            
                            const activeBoss = state.entities.find(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type));
                            this.ctx.shadowBlur = (activeBoss && activeBoss.pulseState === 'charging') ? 30 : 15;
                        });
                        this.ctx.shadowBlur = 0;

                        this.ctx.strokeStyle = '#555';
                        this.ctx.lineWidth = 3;
                        this.ctx.lineCap = 'round';
                        for(let i=0; i<3; i++) {
                            let orbitAngle = phase * (1 + i*0.5) + (i * Math.PI*0.6);
                            let dist = 45 + Math.sin(phase * 2 + i) * 5;
                            if (ent.pulseState === 'charging') orbitAngle += this.renderFrame * 0.2;
                            let objX = Math.cos(orbitAngle) * dist;
                            let objY = Math.sin(orbitAngle) * dist;
                            this.ctx.beginPath();
                            this.ctx.moveTo(objX - 5, objY - 5);
                            this.ctx.lineTo(objX + 5, objY + 5);
                            this.ctx.stroke();
                        }
                    } catch(bossError) {
                        console.warn("Recoverable boss rendering error:", bossError);
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
            state.particles.forEach(p => { 
                this.ctx.fillStyle = p.color; 
                this.ctx.globalAlpha = Math.max(0, p.life); 
                this.ctx.beginPath();
                this.ctx.moveTo(p.x, p.y);
                this.ctx.lineTo(p.x - p.vx*2, p.y - p.vy*2);
                this.ctx.lineWidth = 2;
                this.ctx.strokeStyle = p.color;
                this.ctx.stroke();
            });
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
            const activeBoss = state.entities.find(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type));
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
                this.ctx.fillStyle = '#1a0525';
                this.ctx.shadowColor = '#800080';
                this.ctx.shadowBlur = 10;
                
                for (let mirror = -1; mirror <= 1; mirror += 2) {
                    this.ctx.save();
                    this.ctx.scale(mirror, 1);
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, -30);
                    this.ctx.bezierCurveTo(20, -30, 30 + pulse, -15, 25, 0);
                    this.ctx.bezierCurveTo(40, 15, 20, 30, 0, 30 + pulse);
                    this.ctx.fill();
                    
                    this.ctx.fillStyle = '#ff0055'; 
                    this.ctx.beginPath();
                    this.ctx.arc(10 + Math.sin(simulatedPhase)*2, 5, 2, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.restore();
                }
                this.ctx.shadowBlur = 0;
                
            } else if (bossType === 'PANOPTICON') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 3;
                
                this.ctx.fillStyle = '#1a0005';
                this.ctx.shadowColor = '#ff0000';
                this.ctx.shadowBlur = 30;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 35 + pulse, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
                
                this.ctx.fillStyle = '#ffcccc';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 25 + pulse, 30 + pulse, simulatedPhase*0.5, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#ff0000';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 12 + pulse*0.5, 18 + pulse*0.5, simulatedPhase*0.5, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.fillStyle = '#000';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 4, 14, simulatedPhase*0.5, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.strokeStyle = '#ff0044';
                this.ctx.lineWidth = 2;
                for(let r=0; r<3; r++) {
                    this.ctx.save();
                    this.ctx.rotate(simulatedPhase * (1 + r*0.5) * (r%2===0?1:-1));
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 50 + r*15, 20 + r*10, 0, 0, Math.PI*2);
                    this.ctx.stroke();
                    this.ctx.restore();
                }
            } else if (bossType === 'AMALGAMATION') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 5;
                this.ctx.fillStyle = '#1a2a0a';
                this.ctx.shadowColor = '#55ff55';
                this.ctx.shadowBlur = 30;
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 45 + pulse, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
                
                this.ctx.fillStyle = '#5a7a2a';
                for (let m = 0; m < 6; m++) {
                    this.ctx.save();
                    let mAngle = (m / 6) * Math.PI * 2 + (simulatedPhase * 0.5);
                    let mDist = 25 + Math.sin(simulatedPhase * 2 + m) * 10;
                    this.ctx.translate(Math.cos(mAngle) * mDist, Math.sin(mAngle) * mDist);
                    this.ctx.beginPath();
                    this.ctx.ellipse(0, 0, 15, 10, simulatedPhase, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.restore();
                }
                
                this.ctx.fillStyle = '#050505';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 20, 0, Math.PI * 2);
                this.ctx.fill();
            } else if (bossType === 'ARCHITECT') {
                let pulse = Math.sin(this.renderFrame * 0.1) * 5;
                this.ctx.fillStyle = '#111';
                this.ctx.shadowColor = '#c5a059';
                this.ctx.shadowBlur = 30 + pulse;
                
                this.ctx.save();
                this.ctx.rotate(this.renderFrame * 0.05);
                this.ctx.strokeStyle = '#c5a059';
                this.ctx.lineWidth = 3;
                this.ctx.strokeRect(-30, -30, 60, 60);
                this.ctx.rotate(Math.PI / 4);
                this.ctx.strokeRect(-30, -30, 60, 60);
                this.ctx.restore();

                this.ctx.beginPath();
                this.ctx.moveTo(0, -40);
                this.ctx.lineTo(25, 0);
                this.ctx.lineTo(0, 40);
                this.ctx.lineTo(-25, 0);
                this.ctx.closePath();
                this.ctx.fill();
                
                this.ctx.fillStyle = '#ffffff';
                this.ctx.beginPath();
                this.ctx.moveTo(0, -15);
                this.ctx.lineTo(8, 0);
                this.ctx.lineTo(0, 15);
                this.ctx.lineTo(-8, 0);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.shadowBlur = 0;
            } else {
                let pulse = Math.sin(this.renderFrame * 0.1) * 3;
                this.ctx.fillStyle = '#1a0d15';
                this.ctx.beginPath();
                for (let i = 0; i < 16; i++) {
                    let angle = (i / 16) * Math.PI * 2;
                    let reach = 35 + Math.sin(simulatedPhase * 4 + i * 2) * 15 + (i % 2 === 0 ? 10 : -5);
                    if (i === 0) this.ctx.moveTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
                    else this.ctx.lineTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
                }
                this.ctx.closePath();
                this.ctx.fill();

                this.ctx.fillStyle = '#2b1010';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 25 + pulse, 30 - pulse, 0, 0, Math.PI*2);
                this.ctx.fill();

                this.ctx.fillStyle = '#050000';
                this.ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    let angle = (i / 10) * Math.PI * 2;
                    let innerReach = 10 + Math.random() * 8; 
                    if (i === 0) this.ctx.moveTo(Math.cos(angle)*innerReach, Math.sin(angle)*innerReach);
                    else this.ctx.lineTo(Math.cos(angle)*innerReach, Math.sin(angle)*innerReach);
                }
                this.ctx.closePath();
                this.ctx.fill();

                this.ctx.fillStyle = '#ff0000';
                this.ctx.shadowColor = '#ff0000';
                this.ctx.shadowBlur = 15;
                
                const eyes = [
                    {x: -12, y: -15, r: 4}, {x: 18, y: -10, r: 3},
                    {x: 5, y: 22, r: 5}, {x: -20, y: 8, r: 2}, {x: 15, y: 15, r: 2.5}
                ];

                eyes.forEach(eye => {
                    let jx = Math.cos(this.renderFrame * 0.2 + eye.x) * 1.5;
                    let jy = Math.sin(this.renderFrame * 0.2 + eye.y) * 1.5;
                    this.ctx.beginPath();
                    this.ctx.arc(eye.x + jx, eye.y + jy, eye.r, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.fillStyle = '#000000';
                    this.ctx.shadowBlur = 0;
                    this.ctx.beginPath();
                    this.ctx.ellipse(eye.x + jx, eye.y + jy, eye.r * 0.2, eye.r * 0.8, 0, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.fillStyle = '#ff0000';
                    
                    const activeBoss = state.entities.find(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type));
                    this.ctx.shadowBlur = (activeBoss && activeBoss.pulseState === 'charging') ? 30 : 15;
                });
                this.ctx.shadowBlur = 0;

                this.ctx.strokeStyle = '#555';
                this.ctx.lineWidth = 3;
                this.ctx.lineCap = 'round';
                for(let i=0; i<3; i++) {
                    let orbitAngle = simulatedPhase * (1 + i*0.5) + (i * Math.PI*0.6);
                    let dist = 45 + Math.sin(simulatedPhase * 2 + i) * 5;
                    let objX = Math.cos(orbitAngle) * dist;
                    let objY = Math.sin(orbitAngle) * dist;
                    this.ctx.beginPath();
                    this.ctx.moveTo(objX - 5, objY - 5);
                    this.ctx.lineTo(objX + 5, objY + 5);
                    this.ctx.stroke();
                }
            }
            ctx.restore();
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
                    state.particles.push({
                        x: state.player.x + (Math.random() - 0.5) * 10,
                        y: state.player.y + (Math.random() - 0.5) * 10,
                        vx: (Math.random() - 0.5) * 0.5,
                        vy: (Math.random() - 0.5) * 0.5,
                        life: 0.5 + Math.random() * 0.5,
                        color: 'rgba(100, 100, 100, 0.5)'
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
        this.ctx.beginPath();
        
        let breathe = state.player.breathPhase ? Math.sin(state.player.breathPhase) * (1 + panic * 3) : 0;
        this.ctx.ellipse(0, 0, state.player.radius * 0.6 + breathe, state.player.radius, 0, 0, Math.PI*2);
        this.ctx.fill();

        let headShiftX = Math.max(-5, Math.min(5, moveX * 0.5));
        let headShiftY = Math.max(-5, Math.min(5, moveY * 0.5));

        this.ctx.fillStyle = headColor;
        this.ctx.beginPath();
        let headJitterX = (Math.random() - 0.5) * panic * 4;
        let headJitterY = (Math.random() - 0.5) * panic * 4;
        this.ctx.arc(3 + headJitterX + headShiftX, headJitterY + headShiftY, state.player.radius * 0.45, 0, Math.PI*2);
        this.ctx.fill();

        this.ctx.fillStyle = '#1a1a24';
        this.ctx.beginPath();
        this.ctx.ellipse(8 + headJitterX*0.5 + headShiftX, 10 + headJitterY*0.5 + headShiftY, 5, 3, Math.PI/4, 0, Math.PI*2);
        this.ctx.fill();
        
        this.ctx.fillStyle = '#fffae6';
        this.ctx.shadowColor = '#fffae6';
        this.ctx.shadowBlur = 8 + Math.random() * 5 * panic; 
        this.ctx.beginPath();
        this.ctx.arc(12 + headJitterX*0.5 + headShiftX, 10 + headJitterY*0.5 + headShiftY, 2.5, 0, Math.PI*2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

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