// src/core/Renderer.js
// Handles HTML5 Canvas Drawing, Glitch Shaders, and Flashlight Masking

export class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        
        // Pre-compute visual atmospheric assets on load to save CPU
        this.noisePattern = this.generateNoisePattern();
        this.fogClouds = this.generateFogClouds();
    }

    // Generates the VHS Film Grain texture once
    generateNoisePattern() {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 128;
        const cx = c.getContext('2d');
        const imgData = cx.createImageData(128, 128);
        for (let i = 0; i < imgData.data.length; i += 4) {
            const val = Math.random() * 255;
            imgData.data[i] = val;     // R
            imgData.data[i+1] = val;   // G
            imgData.data[i+2] = val;   // B
            imgData.data[i+3] = 35;    // Alpha (Cranked up for prominent VHS grain)
        }
        cx.putImageData(imgData, 0, 0);
        return c;
    }

    // Generates procedural drifting fog circles
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

    drawMenuBackground(time) {
        this.ctx.fillStyle = `rgba(139, 0, 0, ${0.05 + Math.sin(time * 0.001) * 0.02})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawFilmGrain();
    }

    drawFilmGrain() {
        this.ctx.save();
        // Jitter the pattern offset every frame for animation
        const offsetX = (Math.random() * 128) | 0;
        const offsetY = (Math.random() * 128) | 0;
        this.ctx.fillStyle = this.ctx.createPattern(this.noisePattern, 'repeat');
        this.ctx.translate(-offsetX, -offsetY);
        this.ctx.fillRect(0, 0, this.canvas.width + 128, this.canvas.height + 128);
        this.ctx.restore();
    }

    drawGame(state) {
        // 1. Pitch Black Base Layer (True Darkness)
        this.ctx.fillStyle = '#010102'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        
        // Camera Shake
        if (state.cameraShake > 0) {
            this.ctx.translate(
                (Math.random() - 0.5) * state.cameraShake, 
                (Math.random() - 0.5) * state.cameraShake
            );
        }

        // 2. Unlit World (Barely visible silhouettes in the fog - reduced to make darkness scarier)
        this.ctx.globalAlpha = 0.02; 
        this.drawWorldItems(state); 
        this.ctx.globalAlpha = 1.0;

        // 3. Flashlight Mask
        const fl = state.player.weapons.flashlight;
        this.ctx.save(); 
        this.ctx.beginPath(); 
        this.ctx.moveTo(state.player.x, state.player.y);
        
        let jitter = state.sanity < 30 ? (Math.random() - 0.5) * 0.1 : 0;
        let currentAngle = fl.angle;

        let hasBlindingSignal = state.player.synergies && state.player.synergies.includes('blinding_signal');
        if (hasBlindingSignal) {
            if (state.frame % 6 < 3) {
                currentAngle *= 1.5; 
                this.ctx.fillStyle = 'rgba(255, 255, 230, 0.05)';
                this.ctx.fillRect(0,0, this.canvas.width, this.canvas.height);
            } else {
                currentAngle *= 0.8; 
            }
        }
        
        this.ctx.arc(
            state.player.x, state.player.y, fl.radius, 
            state.player.angle - currentAngle + jitter, 
            state.player.angle + currentAngle + jitter
        );
        this.ctx.closePath(); 
        this.ctx.clip(); 

        // Draw Lit Area Entities
        this.drawWorldItems(state);
        
        // Draw Volumetric Fog inside the Flashlight (Cranked up to 0.35 for thick smoke)
        this.ctx.globalAlpha = 0.35;
        this.fogClouds.forEach(cloud => {
            cloud.x += cloud.vx; cloud.y += cloud.vy;
            
            // Wrap relative to player for infinite scrolling fog
            let dx = (cloud.x - state.player.x) % 2000;
            if (dx < -1000) dx += 2000; else if (dx > 1000) dx -= 2000;
            let dy = (cloud.y - state.player.y) % 2000;
            if (dy < -1000) dy += 2000; else if (dy > 1000) dy -= 2000;
            
            let drawX = state.player.x + dx;
            let drawY = state.player.y + dy;

            const fGrad = this.ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, cloud.r);
            fGrad.addColorStop(0, 'rgba(200, 210, 220, 0.8)');
            fGrad.addColorStop(1, 'rgba(200, 210, 220, 0)');
            this.ctx.fillStyle = fGrad;
            this.ctx.beginPath();
            this.ctx.arc(drawX, drawY, cloud.r, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.globalAlpha = 1.0;

        // Flashlight Glare Gradient
        const grad = this.ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
        grad.addColorStop(0, 'rgba(255, 255, 230, 0.3)'); 
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = grad; 
        this.ctx.fillRect(0,0, this.canvas.width, this.canvas.height);
        
        this.ctx.restore(); // Drop Mask

        // 4. Draw Static Aura Weapon
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

        // Draw Melee Swings above ground but below player
        if (state.meleeSwings) {
            state.meleeSwings.forEach(m => {
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${m.life / 15})`;
                this.ctx.lineWidth = 4;
                this.ctx.beginPath();
                this.ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
                this.ctx.stroke();
            });
        }

        // 5. Draw Player
        this.ctx.fillStyle = 'white'; 
        this.ctx.beginPath(); 
        this.ctx.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI*2); 
        this.ctx.fill();
        
        this.ctx.fillStyle = '#fffae6'; 
        this.ctx.beginPath();
        this.ctx.arc(
            state.player.x + Math.cos(state.player.angle) * state.player.radius, 
            state.player.y + Math.sin(state.player.angle) * state.player.radius, 
            4, 0, Math.PI*2
        );
        this.ctx.fill();
        
        // 6. Draw Damage Text
        this.drawDamageText(state);

        this.ctx.restore(); // Restore camera shake

        // 7. POST-PROCESSING (Vignette & Film Grain)
        
        // Dynamic Vignette (Claustrophobia effect bound to Sanity)
        let sanityRatio = Math.max(0.01, state.sanity / state.player.maxHp);
        
        // Tightened the rings: the darkness closes in much closer to the player now
        let innerVig = (this.canvas.height / 4) * sanityRatio; 
        let outerVig = (this.canvas.height) * (0.2 + sanityRatio * 0.8); 
        
        const vig = this.ctx.createRadialGradient(
            state.player.x, state.player.y, innerVig,
            state.player.x, state.player.y, outerVig
        );
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.98)');
        this.ctx.fillStyle = vig;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Overlay Prominent Film Grain
        this.drawFilmGrain();
    }

    drawDamageText(state) {
        this.ctx.save();
        this.ctx.textAlign = 'center';
        
        if (state.damageTexts) {
            state.damageTexts.forEach(dt => {
                this.ctx.globalAlpha = Math.max(0, Math.min(1, dt.life));
                this.ctx.font = `bold ${Math.floor(20 * dt.scale)}px var(--ui-font, monospace)`;
                this.ctx.fillStyle = dt.color;
                this.ctx.lineWidth = 2;
                this.ctx.strokeStyle = '#000';
                this.ctx.strokeText(dt.text, dt.x, dt.y);
                this.ctx.fillText(dt.text, dt.x, dt.y);
            });
        }
        
        this.ctx.restore();
    }

    drawWorldItems(state) {
        if (state.inkPuddles) {
            state.inkPuddles.forEach(p => {
                this.ctx.fillStyle = `rgba(20, 0, 40, ${0.5 * (p.life / 300)})`; // Dark purple
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                this.ctx.fill();
            });
        }

        state.xpDrops.forEach(xp => {
            this.ctx.fillStyle = '#fff'; 
            const r = 3 + Math.sin(state.frame * 0.1 + xp.x) * 1;
            this.ctx.beginPath(); this.ctx.arc(xp.x, xp.y, r, 0, Math.PI*2); this.ctx.fill();
            this.ctx.shadowBlur = 10; this.ctx.shadowColor = "white"; this.ctx.fill(); this.ctx.shadowBlur = 0;
        });

        state.entities.forEach(ent => {
            if (ent.type === 'BOSS' && state.sanity <= 0) {
                if (Math.sin(ent.phase * 10) < 0.5) this.ctx.globalAlpha = 0.2;
                else this.ctx.globalAlpha = 0.8;
            }

            this.ctx.fillStyle = ent.flashTime > 0 ? '#fff' : ent.color;
            this.ctx.save(); 
            this.ctx.translate(ent.x, ent.y);
            
            const twitch = state.sanity < 20 ? (Math.random()-0.5)*4 : 0;
            this.ctx.translate(twitch, twitch);

            if (ent.type === 'SCAVENGER') {
                this.ctx.rotate(Math.sin(state.frame * 0.1) * 0.1); 
                this.ctx.fillRect(-12, -12, 24, 24); 
                this.ctx.fillStyle = '#111'; this.ctx.fillRect(-8, -8, 16, 16); 
            } 
            else if (ent.type === 'PREDATOR') {
                this.ctx.rotate(Math.atan2(ent.vy, ent.vx)); 
                this.ctx.fillRect(-10, -20, 20, 40); 
                this.ctx.fillStyle = ent.buffed ? '#fff' : '#444';
                this.ctx.beginPath(); this.ctx.moveTo(0, 0); this.ctx.lineTo(20, -15); this.ctx.lineTo(20, 15); this.ctx.fill();
            }
            else if (ent.type === 'PARASITE') {
                this.ctx.rotate(state.frame * 0.2); 
                this.ctx.beginPath(); this.ctx.arc(0, 0, 8, 0, Math.PI*2); this.ctx.fill();
                this.ctx.strokeStyle = ent.color;
                this.ctx.beginPath(); this.ctx.moveTo(-15, 0); this.ctx.lineTo(15, 0); this.ctx.moveTo(0, -15); this.ctx.lineTo(0, 15); this.ctx.stroke();
            }
            else if (ent.type === 'BOSS') {
                this.ctx.rotate(Math.sin(ent.phase)*0.1); 
                this.ctx.beginPath(); this.ctx.arc(0, 0, 30, 0, Math.PI*2); this.ctx.fill(); 
                this.ctx.fillStyle = '#111'; this.ctx.beginPath(); this.ctx.arc(15, 0, 10, 0, Math.PI*2); this.ctx.fill(); 
                this.ctx.fillStyle = ent.color;
                this.ctx.fillRect(-10, 30 + Math.sin(ent.phase * 2)*10, 8, 20);
                this.ctx.fillRect(10, 30 + Math.cos(ent.phase * 2)*10, 8, 20);
            }

            if (ent.hp < ent.maxHp && ent.flashTime <= 0) {
                const barW = ent.type === 'BOSS' ? 60 : 20;
                this.ctx.fillStyle = '#000'; this.ctx.fillRect(-barW/2, ent.type === 'BOSS' ? 60 : 22, barW, 4);
                this.ctx.fillStyle = '#8b0000'; this.ctx.fillRect(-barW/2, ent.type === 'BOSS' ? 60 : 22, barW * Math.max(0, ent.hp / ent.maxHp), 4);
            }

            this.ctx.restore();
            this.ctx.globalAlpha = 1.0;
        });

        if (state.particles) {
            state.particles.forEach(p => { 
                this.ctx.fillStyle = p.color; 
                this.ctx.globalAlpha = Math.max(0, p.life); 
                this.ctx.fillRect(p.x, p.y, 4, 4); 
            });
        }
        this.ctx.globalAlpha = 1.0;
    }
}