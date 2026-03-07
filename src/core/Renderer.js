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
        
        // Draw Volumetric Fog inside the Flashlight
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

        // 5. Draw Player (Revamped visuals)
        this.drawPlayer(state);
        
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

    drawPlayer(state) {
        this.ctx.save();
        this.ctx.translate(state.player.x, state.player.y);
        this.ctx.rotate(state.player.angle);

        // Player aura/echoes (shows "fractured" mental state)
        let sanityRatio = state.sanity / state.player.maxHp;
        let shake = (1 - Math.max(0, sanityRatio)) * 3;

        this.ctx.globalAlpha = 0.5;
        this.ctx.fillStyle = 'rgba(200, 220, 255, 0.4)';
        this.ctx.beginPath();
        this.ctx.arc((Math.random()-0.5)*shake, (Math.random()-0.5)*shake, state.player.radius + 2, 0, Math.PI*2);
        this.ctx.fill();

        // Core player body
        this.ctx.globalAlpha = 1.0;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, state.player.radius, 0, Math.PI*2);
        this.ctx.fill();

        // Directional "Visor" / Light source
        this.ctx.fillStyle = '#fffae6';
        this.ctx.beginPath();
        this.ctx.arc(state.player.radius * 0.8, 0, 5, 0, Math.PI*2);
        this.ctx.fill();
        
        // Subtle detail: a dark "crack" representing the fractured mind
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(-state.player.radius * 0.5, state.player.radius * 0.5);
        this.ctx.lineTo(0, -state.player.radius * 0.2);
        this.ctx.lineTo(state.player.radius * 0.4, state.player.radius * 0.3);
        this.ctx.stroke();

        this.ctx.restore();
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
        // Draw Ink Puddles
        if (state.inkPuddles) {
            state.inkPuddles.forEach(p => {
                this.ctx.fillStyle = `rgba(15, 5, 25, ${0.7 * (p.life / 300)})`; 
                this.ctx.beginPath();
                // Add some jaggedness to puddles
                for (let i = 0; i < 8; i++) {
                    let angle = (i / 8) * Math.PI * 2;
                    let radiusJitter = p.radius * (0.8 + Math.sin(p.x * p.y + i) * 0.2);
                    let x = p.x + Math.cos(angle) * radiusJitter;
                    let y = p.y + Math.sin(angle) * radiusJitter;
                    if (i === 0) this.ctx.moveTo(x, y);
                    else this.ctx.lineTo(x, y);
                }
                this.ctx.closePath();
                this.ctx.fill();
            });
        }

        // Draw XP (Lucidity Fragments)
        state.xpDrops.forEach(xp => {
            this.ctx.save();
            this.ctx.translate(xp.x, xp.y);
            
            // Outer glow
            const pulse = Math.sin(state.frame * 0.1 + xp.x) * 2;
            const grad = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 8 + pulse);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
            grad.addColorStop(1, 'rgba(200, 220, 255, 0)');
            this.ctx.fillStyle = grad;
            this.ctx.beginPath(); this.ctx.arc(0, 0, 8 + pulse, 0, Math.PI*2); this.ctx.fill();

            // Inner core (diamond shape)
            this.ctx.fillStyle = '#ffffff';
            this.ctx.rotate(state.frame * 0.05);
            this.ctx.beginPath();
            this.ctx.moveTo(0, -4); this.ctx.lineTo(4, 0);
            this.ctx.moveTo(4, 0); this.ctx.lineTo(0, 4);
            this.ctx.moveTo(0, 4); this.ctx.lineTo(-4, 0);
            this.ctx.moveTo(-4, 0); this.ctx.lineTo(0, -4);
            this.ctx.fill();
            
            this.ctx.restore();
        });

        // Draw Entities
        state.entities.forEach(ent => {
            if (ent.type === 'BOSS' && state.sanity <= 0) {
                if (Math.sin(ent.phase * 10) < 0.5) this.ctx.globalAlpha = 0.2;
                else this.ctx.globalAlpha = 0.8;
            }

            this.ctx.fillStyle = ent.flashTime > 0 ? '#ffffff' : ent.color;
            this.ctx.save(); 
            this.ctx.translate(ent.x, ent.y);
            
            const twitch = state.sanity < 20 ? (Math.random()-0.5)*4 : 0;
            this.ctx.translate(twitch, twitch);

            // Procedural Entity Drawings
            if (ent.type === 'SCAVENGER') {
                // Hunched, dragging figure
                this.ctx.rotate(Math.atan2(ent.vy, ent.vx)); 
                
                // Body
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI*2);
                this.ctx.fill();
                
                // "Broom" / dragging appendage
                this.ctx.strokeStyle = '#222';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.moveTo(5, 0);
                this.ctx.lineTo(15 + Math.sin(state.frame * 0.2)*5, 10);
                this.ctx.stroke();

                // Faint trail behind them
                this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
                this.ctx.fillRect(-20, -5, 10, 10);
            } 
            else if (ent.type === 'PREDATOR') {
                // Towering shadow with red eyes
                this.ctx.rotate(Math.atan2(ent.vy, ent.vx)); 
                
                // Jagged Body
                this.ctx.fillStyle = ent.buffed ? '#fff' : '#1a1a1a';
                if(ent.flashTime > 0) this.ctx.fillStyle = '#fff';

                this.ctx.beginPath();
                this.ctx.moveTo(15, 0);
                this.ctx.lineTo(-10, 12);
                this.ctx.lineTo(-15, 0);
                this.ctx.lineTo(-10, -12);
                this.ctx.closePath();
                this.ctx.fill();

                // Glowing "Searchlight" Eye
                if (ent.flashTime <= 0) {
                    this.ctx.fillStyle = ent.buffed ? '#ff0000' : '#8b0000';
                    this.ctx.beginPath();
                    this.ctx.arc(10, 0, 3, 0, Math.PI*2);
                    this.ctx.fill();
                    
                    // Eye beam
                    this.ctx.globalAlpha = 0.3;
                    this.ctx.beginPath();
                    this.ctx.moveTo(12, 0);
                    this.ctx.lineTo(30, -5);
                    this.ctx.lineTo(30, 5);
                    this.ctx.fill();
                    this.ctx.globalAlpha = 1.0;
                }
            }
            else if (ent.type === 'PARASITE') {
                // Twitching nerve cluster
                this.ctx.rotate(state.frame * 0.2); 
                
                // Central mass
                this.ctx.beginPath(); 
                this.ctx.arc(0, 0, 6, 0, Math.PI*2); 
                this.ctx.fill();
                
                // Twitching tentacles
                this.ctx.strokeStyle = ent.flashTime > 0 ? '#fff' : ent.color;
                this.ctx.lineWidth = 1.5;
                for(let i=0; i<5; i++) {
                    let angle = (i/5) * Math.PI * 2;
                    let length = 8 + Math.random() * 6;
                    this.ctx.beginPath();
                    this.ctx.moveTo(Math.cos(angle)*6, Math.sin(angle)*6);
                    // Add a joint to the leg
                    let midX = Math.cos(angle + 0.2) * (length*0.5);
                    let midY = Math.sin(angle + 0.2) * (length*0.5);
                    this.ctx.lineTo(midX, midY);
                    this.ctx.lineTo(Math.cos(angle)*length, Math.sin(angle)*length);
                    this.ctx.stroke();
                }
            }
            else if (ent.type === 'BOSS') {
                // Geometric Nightmare (Sphere Head)
                this.ctx.rotate(Math.sin(ent.phase)*0.1); 
                
                // Main chassis
                this.ctx.beginPath(); 
                this.ctx.arc(0, 0, 35, 0, Math.PI*2); 
                this.ctx.fill(); 
                
                // Inner dark void
                this.ctx.fillStyle = '#050505'; 
                this.ctx.beginPath(); 
                this.ctx.arc(5, 0, 20, 0, Math.PI*2); 
                this.ctx.fill(); 
                
                // Glowing floating core
                this.ctx.fillStyle = ent.flashTime > 0 ? '#ffffff' : ent.color;
                let coreOffset = Math.sin(state.frame * 0.05) * 5;
                this.ctx.beginPath();
                this.ctx.arc(10 + coreOffset, 0, 8, 0, Math.PI*2);
                this.ctx.fill();

                // Orbiting Ring 1
                this.ctx.strokeStyle = ent.flashTime > 0 ? '#ffffff' : '#666';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 45, 10, ent.phase, 0, Math.PI*2);
                this.ctx.stroke();

                // Orbiting Ring 2 (Counter-rotating)
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 10, 45, -ent.phase * 1.5, 0, Math.PI*2);
                this.ctx.stroke();
            }

            // Healthbars (drawn below the entity)
            if (ent.hp < ent.maxHp && ent.flashTime <= 0) {
                const barW = ent.type === 'BOSS' ? 80 : 24;
                const yOffset = ent.type === 'BOSS' ? 55 : 20;
                this.ctx.fillStyle = 'rgba(0,0,0,0.8)'; 
                this.ctx.fillRect(-barW/2, yOffset, barW, 4);
                this.ctx.fillStyle = '#8b0000'; 
                this.ctx.fillRect(-barW/2, yOffset, barW * Math.max(0, ent.hp / ent.maxHp), 4);
            }

            this.ctx.restore();
            this.ctx.globalAlpha = 1.0;
        });

        // Enhanced Particles (Blood/Sparks)
        if (state.particles) {
            state.particles.forEach(p => { 
                this.ctx.fillStyle = p.color; 
                this.ctx.globalAlpha = Math.max(0, p.life); 
                // Draw as small lines indicating motion
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
}