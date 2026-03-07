// src/core/Renderer.js
// Handles HTML5 Canvas Drawing, Glitch Shaders, and Flashlight Masking

export class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
        
        // Pre-compute visual atmospheric assets on load to save CPU
        this.noisePattern = this.generateNoisePattern();
        this.fogClouds = this.generateFogClouds();
        this.floorPattern = this.generateFloorPattern();
        
        // Define the global zoom level
        this.zoom = 1.3; 

        // Player Animation State tracking
        this.legPhase = 0;
        this.lastPx = -1;
        this.lastPy = -1;
    }

    // Generates the eerie school tile floor pattern once
    generateFloorPattern() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const cx = c.getContext('2d');
        
        // Base creepy tile
        cx.fillStyle = '#0a0a0d';
        cx.fillRect(0, 0, 512, 512);
        
        // Grid lines (School tiles)
        cx.strokeStyle = '#050505';
        cx.lineWidth = 4;
        for(let i = 0; i <= 512; i += 128) {
            cx.beginPath(); cx.moveTo(i, 0); cx.lineTo(i, 512); cx.stroke();
            cx.beginPath(); cx.moveTo(0, i); cx.lineTo(512, i); cx.stroke();
        }

        // Blood stains, grime, and scuffs
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
            imgData.data[i+3] = 35;    // Alpha
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
        
        // --- APPLY GLOBAL ZOOM ---
        this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
        this.ctx.scale(this.zoom, this.zoom);
        this.ctx.translate(-state.player.x, -state.player.y);
        // -------------------------

        // Camera Shake
        if (state.cameraShake > 0) {
            this.ctx.translate(
                (Math.random() - 0.5) * state.cameraShake, 
                (Math.random() - 0.5) * state.cameraShake
            );
        }

        // 2. Unlit World
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
                this.ctx.fillRect(state.player.x - 2000, state.player.y - 2000, 4000, 4000);
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

        // Draw Lit Area Entities & Background
        this.drawWorldItems(state);
        
        // Draw Volumetric Fog inside the Flashlight
        this.ctx.globalAlpha = 0.35;
        this.fogClouds.forEach(cloud => {
            cloud.x += cloud.vx; cloud.y += cloud.vy;
            
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

        // Flashlight Glare Gradient (Tint green if corrosive battery is active!)
        const grad = this.ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
        if (state.player.weapons.corrosive_battery && state.player.weapons.corrosive_battery.level > 0) {
            grad.addColorStop(0, 'rgba(180, 255, 150, 0.35)'); 
        } else {
            grad.addColorStop(0, 'rgba(255, 255, 230, 0.3)'); 
        }
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = grad; 
        this.ctx.fillRect(state.player.x - fl.radius, state.player.y - fl.radius, fl.radius*2, fl.radius*2);
        
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

        // Draw Melee Swings
        if (state.meleeSwings) {
            state.meleeSwings.forEach(m => {
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${m.life / 15})`;
                this.ctx.lineWidth = 4;
                this.ctx.beginPath();
                this.ctx.arc(m.x, m.y, m.radius, 0, Math.PI * 2);
                this.ctx.stroke();
            });
        }

        // 5. Draw Revamped Player
        this.drawPlayer(state);
        
        // 6. Draw Damage Text
        this.drawDamageText(state);

        this.ctx.restore(); // Restore camera shake and ZOOM

        // 7. POST-PROCESSING (Vignette & Film Grain)
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

        this.drawFilmGrain();
        this.ctx.restore();
    }

    drawPlayer(state) {
        this.ctx.save();
        
        let sanityRatio = state.sanity / state.player.maxHp;
        let panic = (1 - Math.max(0, sanityRatio)); // 0 = calm, 1 = absolute breakdown
        
        // Velocity Tracking for Legs Animation
        let isMoving = false;
        if (this.lastPx !== -1) {
            let distMoved = Math.hypot(state.player.x - this.lastPx, state.player.y - this.lastPy);
            if (distMoved > 0.5) isMoving = true;
        }
        this.lastPx = state.player.x;
        this.lastPy = state.player.y;

        if (isMoving) {
            // Legs scramble faster if panicking
            this.legPhase += 0.3 + (panic * 0.4);
        }

        // Whole body violently trembles as sanity decreases
        let shakeX = (Math.random() - 0.5) * panic * 6;
        let shakeY = (Math.random() - 0.5) * panic * 6;

        this.ctx.translate(state.player.x + shakeX, state.player.y + shakeY);
        this.ctx.rotate(state.player.angle);

        let shake = panic * 3;

        // Ethereal aura echoing the player's fractured state
        this.ctx.globalAlpha = 0.3;
        this.ctx.fillStyle = '#88aaff';
        this.ctx.beginPath();
        this.ctx.arc((Math.random()-0.5)*shake, (Math.random()-0.5)*shake, state.player.radius * 1.5, 0, Math.PI*2);
        this.ctx.fill();

        this.ctx.globalAlpha = 1.0;
        
        // Exaggerated Scrambling Legs
        this.ctx.strokeStyle = '#050505';
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        
        // Left Leg
        this.ctx.beginPath();
        this.ctx.moveTo(0, 5);
        this.ctx.lineTo(-8 + Math.cos(this.legPhase)*6, 8 + Math.sin(this.legPhase)*6);
        this.ctx.stroke();
        // Right Leg
        this.ctx.beginPath();
        this.ctx.moveTo(0, -5);
        this.ctx.lineTo(-8 + Math.cos(this.legPhase + Math.PI)*6, -8 + Math.sin(this.legPhase + Math.PI)*6);
        this.ctx.stroke();

        // Top-down survivor body (dark trenchcoat/shoulders)
        this.ctx.fillStyle = '#1a1a24';
        this.ctx.beginPath();
        // Shoulders heave in and out heavily, scaling with panic
        let breathe = Math.sin(state.frame * 0.15) * (1 + panic * 2);
        this.ctx.ellipse(0, 0, state.player.radius * 0.6 + breathe, state.player.radius, 0, 0, Math.PI*2);
        this.ctx.fill();

        // Floating/Fractured Head
        this.ctx.fillStyle = '#e0e0e0';
        this.ctx.beginPath();
        let headJitterX = (Math.random() - 0.5) * panic * 3;
        let headJitterY = (Math.random() - 0.5) * panic * 3;
        this.ctx.arc(3 + headJitterX, headJitterY, state.player.radius * 0.45, 0, Math.PI*2);
        this.ctx.fill();

        // Extended hand holding the lantern/flashlight
        this.ctx.fillStyle = '#1a1a24';
        this.ctx.beginPath();
        this.ctx.ellipse(8 + headJitterX*0.5, 10 + headJitterY*0.5, 5, 3, Math.PI/4, 0, Math.PI*2);
        this.ctx.fill();
        
        // The Lantern light source
        this.ctx.fillStyle = '#fffae6';
        this.ctx.shadowColor = '#fffae6';
        this.ctx.shadowBlur = 8 + Math.random() * 5 * panic; // Light flickers with fear
        this.ctx.beginPath();
        this.ctx.arc(12 + headJitterX*0.5, 10 + headJitterY*0.5, 2.5, 0, Math.PI*2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0;

        // Floating mental shards orbiting the player
        this.ctx.fillStyle = '#ffffff';
        for(let i=0; i<3; i++) {
            let pX = Math.cos(state.frame * 0.05 + i*2) * (10 + shake*2);
            let pY = Math.sin(state.frame * 0.08 + i*2) * (10 + shake*2);
            this.ctx.fillRect(pX, pY, 1.5 + Math.random()*panic, 1.5 + Math.random()*panic);
        }

        this.ctx.restore();
    }

    drawDamageText(state) {
        this.ctx.save();
        this.ctx.textAlign = 'center';
        
        if (state.damageTexts) {
            state.damageTexts.forEach(dt => {
                this.ctx.globalAlpha = Math.max(0, Math.min(1, dt.life));
                this.ctx.font = `bold ${Math.floor((20 * dt.scale)/this.zoom)}px var(--ui-font, monospace)`;
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
        // --- ARENA BOUNDARY & FLOOR RENDERING ---
        this.ctx.save();
        // The floor pattern only draws INSIDE the actual playable dimensions
        this.ctx.fillStyle = this.ctx.createPattern(this.floorPattern, 'repeat');
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw physical thick walls encapsulating the arena
        this.ctx.strokeStyle = '#020202';
        this.ctx.lineWidth = 25;
        this.ctx.strokeRect(0, 0, this.canvas.width, this.canvas.height);

        // Inner Danger Striping (Faded Gold Warning line)
        this.ctx.strokeStyle = 'rgba(197, 160, 89, 0.4)'; 
        this.ctx.lineWidth = 3;
        this.ctx.setLineDash([15, 15]);
        this.ctx.strokeRect(12, 12, this.canvas.width - 24, this.canvas.height - 24);
        this.ctx.restore();
        // ----------------------------------------
        
        // Draw Broken Chalk Safe Zones (Underneath everything else)
        if (state.safeZones) {
            state.safeZones.forEach(sz => {
                this.ctx.save();
                this.ctx.strokeStyle = `rgba(200, 200, 255, ${sz.life / sz.maxLife})`;
                this.ctx.lineWidth = 3;
                this.ctx.setLineDash([10, 15]); 
                
                // Rotate the chalk circle slowly
                this.ctx.translate(sz.x, sz.y);
                this.ctx.rotate(state.frame * 0.01);
                this.ctx.beginPath();
                this.ctx.arc(0, 0, sz.radius, 0, Math.PI*2);
                this.ctx.stroke();
                
                // Scholastic Purge acid mist effect
                if (state.player.synergies && state.player.synergies.includes('scholastic_purge')) {
                    const mistPulse = Math.sin(state.frame * 0.1) * 0.1;
                    this.ctx.fillStyle = `rgba(100, 255, 100, ${0.15 + mistPulse})`;
                    this.ctx.fill();
                }
                this.ctx.restore();
            });
        }

        if (state.inkPuddles) {
            state.inkPuddles.forEach(p => {
                this.ctx.fillStyle = `rgba(15, 5, 25, ${0.7 * (p.life / 300)})`; 
                this.ctx.beginPath();
                for (let i = 0; i < 8; i++) {
                    let angle = (i / 8) * Math.PI * 2;
                    let radiusJitter = p.radius * (0.8 + Math.sin(p.x * p.y + i + state.frame*0.05) * 0.2);
                    let x = p.x + Math.cos(angle) * radiusJitter;
                    let y = p.y + Math.sin(angle) * radiusJitter;
                    if (i === 0) this.ctx.moveTo(x, y);
                    else this.ctx.lineTo(x, y);
                }
                this.ctx.closePath();
                this.ctx.fill();
            });
        }

        // Swirling Ethereal XP (Lucidity)
        state.xpDrops.forEach(xp => {
            this.ctx.save();
            this.ctx.translate(xp.x, xp.y);
            
            const time = state.frame * 0.1 + xp.x;
            const pulse = Math.sin(time) * 2;
            
            this.ctx.shadowColor = '#88ccff';
            this.ctx.shadowBlur = 10;
            
            this.ctx.fillStyle = '#ffffff';
            this.ctx.beginPath();
            this.ctx.arc(0, Math.sin(time*2)*3, 2.5 + pulse*0.5, 0, Math.PI*2);
            this.ctx.fill();
            
            // Ethereal trail
            this.ctx.strokeStyle = 'rgba(150, 200, 255, 0.6)';
            this.ctx.lineWidth = 1.5;
            this.ctx.beginPath();
            this.ctx.moveTo(0, Math.sin(time*2)*3);
            this.ctx.quadraticCurveTo(-4, -4, -Math.cos(time)*6, -6);
            this.ctx.stroke();
            
            this.ctx.shadowBlur = 0;
            this.ctx.restore();
        });

        // Entities
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

            // --- DETAILED ENTITY SPRITES ---
            if (ent.type === 'SCAVENGER') {
                this.ctx.rotate(Math.atan2(ent.vy, ent.vx)); 
                
                // Base Body
                this.ctx.fillStyle = isFlashed ? '#bbbbbb' : '#2a2d2a';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 12, 15 + Math.sin(state.frame*0.1)*2, 0, 0, Math.PI*2);
                this.ctx.fill();
                
                // Heavy, tumor-like sack on their back
                this.ctx.fillStyle = isFlashed ? '#999999' : '#1a1c1a';
                this.ctx.beginPath();
                this.ctx.arc(-6, 5, 9, 0, Math.PI*2);
                this.ctx.fill();

                // Single dim yellow eye
                this.ctx.fillStyle = '#aaaa00';
                this.ctx.beginPath();
                this.ctx.arc(8, -4, 1.5, 0, Math.PI*2);
                this.ctx.fill();

                // Sweeping appendage
                this.ctx.strokeStyle = '#111';
                this.ctx.lineWidth = 2.5;
                this.ctx.beginPath();
                this.ctx.moveTo(0, 10);
                this.ctx.lineTo(10 + Math.sin(state.frame * 0.2)*5, 18);
                this.ctx.stroke();
            } 
            else if (ent.type === 'PREDATOR') {
                this.ctx.rotate(Math.atan2(ent.vy, ent.vx)); 
                
                // Shadowy, jagged cloak
                this.ctx.fillStyle = isFlashed ? '#ddaaaa' : (ent.buffed ? '#3a0a0a' : '#111111');
                this.ctx.beginPath();
                this.ctx.moveTo(18, 0); // Beak/Head
                this.ctx.lineTo(5, 12 + Math.sin(state.frame*0.2)*3);
                this.ctx.lineTo(-15, 10);
                this.ctx.lineTo(-20, 0); // Tail
                this.ctx.lineTo(-15, -10);
                this.ctx.lineTo(5, -12 - Math.cos(state.frame*0.2)*3);
                this.ctx.closePath();
                this.ctx.fill();

                // Elongated creeping arms
                this.ctx.strokeStyle = this.ctx.fillStyle;
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(0, 10);
                this.ctx.quadraticCurveTo(15, 20, 18, 8);
                this.ctx.moveTo(0, -10);
                this.ctx.quadraticCurveTo(15, -20, 18, -8);
                this.ctx.stroke();

                // Piercing Red Eyes (Always drawn on top, never flashed white)
                this.ctx.fillStyle = ent.buffed ? '#ff0000' : '#cc0000';
                this.ctx.shadowColor = '#ff0000';
                this.ctx.shadowBlur = 10;
                this.ctx.beginPath();
                this.ctx.ellipse(10, -4, 3, 1.5, Math.PI/6, 0, Math.PI*2);
                this.ctx.ellipse(10, 4, 3, 1.5, -Math.PI/6, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.shadowBlur = 0; // Reset shadow
            }
            else if (ent.type === 'PARASITE') {
                this.ctx.rotate(state.frame * 0.2); 
                
                // Pulsing fleshy core
                let pulse = Math.sin(state.frame * 0.3) * 1.5;
                this.ctx.fillStyle = isFlashed ? '#ffcccc' : '#6b2222';
                this.ctx.beginPath(); 
                this.ctx.arc(0, 0, 5 + pulse, 0, Math.PI*2); 
                this.ctx.fill();

                // Dark center
                this.ctx.fillStyle = '#050505';
                this.ctx.beginPath(); 
                this.ctx.arc(0, 0, 2 + pulse*0.5, 0, Math.PI*2); 
                this.ctx.fill();
                
                // Twitching, multi-jointed legs
                this.ctx.strokeStyle = isFlashed ? '#ffffff' : ent.color;
                this.ctx.lineWidth = 1.5;
                this.ctx.lineCap = 'round';
                for(let i=0; i<8; i++) {
                    let angle = (i/8) * Math.PI * 2 + (Math.sin(state.frame*0.5 + i)*0.2);
                    let length = 8 + Math.random() * 4;
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
                // THE FLESH MONOLITH OVERHAUL
                this.ctx.rotate(Math.sin(ent.phase * 0.5) * 0.1); 
                
                let pulse = Math.sin(state.frame * 0.1) * 3;
                
                // Outer writhing mass (Tendrils/Limbs)
                this.ctx.fillStyle = isFlashed ? '#ddaaaa' : '#1a0d15';
                this.ctx.beginPath();
                for (let i = 0; i < 16; i++) {
                    let angle = (i / 16) * Math.PI * 2;
                    // Jagged, uneven reach
                    let reach = 35 + Math.sin(ent.phase * 4 + i * 2) * 15 + (i % 2 === 0 ? 10 : -5);
                    if (i === 0) this.ctx.moveTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
                    else this.ctx.lineTo(Math.cos(angle)*reach, Math.sin(angle)*reach);
                }
                this.ctx.closePath();
                this.ctx.fill();

                // Inner fleshy core
                this.ctx.fillStyle = isFlashed ? '#ffcccc' : '#2b1010';
                this.ctx.beginPath();
                this.ctx.ellipse(0, 0, 25 + pulse, 30 - pulse, 0, 0, Math.PI*2);
                this.ctx.fill();

                // Gaping, jagged maw
                this.ctx.fillStyle = '#050000';
                this.ctx.beginPath();
                for (let i = 0; i < 10; i++) {
                    let angle = (i / 10) * Math.PI * 2;
                    let innerReach = 10 + Math.random() * 8; // Jagged teeth effect
                    if (i === 0) this.ctx.moveTo(Math.cos(angle)*innerReach, Math.sin(angle)*innerReach);
                    else this.ctx.lineTo(Math.cos(angle)*innerReach, Math.sin(angle)*innerReach);
                }
                this.ctx.closePath();
                this.ctx.fill();

                // Multiple unblinking, asymmetric red eyes
                this.ctx.fillStyle = '#ff0000';
                this.ctx.shadowColor = '#ff0000';
                this.ctx.shadowBlur = 15;
                
                // Eye coordinates (asymmetric)
                const eyes = [
                    {x: -12, y: -15, r: 4},
                    {x: 18, y: -10, r: 3},
                    {x: 5, y: 22, r: 5},
                    {x: -20, y: 8, r: 2},
                    {x: 15, y: 15, r: 2.5}
                ];

                eyes.forEach(eye => {
                    // Small jitter for the eyes
                    let jx = Math.cos(state.frame * 0.2 + eye.x) * 1.5;
                    let jy = Math.sin(state.frame * 0.2 + eye.y) * 1.5;
                    
                    this.ctx.beginPath();
                    this.ctx.arc(eye.x + jx, eye.y + jy, eye.r, 0, Math.PI*2);
                    this.ctx.fill();
                    
                    // Slit pupil
                    this.ctx.fillStyle = '#000000';
                    this.ctx.shadowBlur = 0;
                    this.ctx.beginPath();
                    this.ctx.ellipse(eye.x + jx, eye.y + jy, eye.r * 0.2, eye.r * 0.8, 0, 0, Math.PI*2);
                    this.ctx.fill();
                    this.ctx.fillStyle = '#ff0000';
                    this.ctx.shadowBlur = 15;
                });
                this.ctx.shadowBlur = 0;

                // Orbiting bone/metal debris (replacing the neat rings)
                this.ctx.strokeStyle = isFlashed ? '#ffffff' : '#555';
                this.ctx.lineWidth = 3;
                this.ctx.lineCap = 'round';
                
                for(let i=0; i<3; i++) {
                    let orbitAngle = ent.phase * (1 + i*0.5) + (i * Math.PI*0.6);
                    let dist = 45 + Math.sin(ent.phase * 2 + i) * 5;
                    let objX = Math.cos(orbitAngle) * dist;
                    let objY = Math.sin(orbitAngle) * dist;
                    
                    this.ctx.beginPath();
                    this.ctx.moveTo(objX - 5, objY - 5);
                    this.ctx.lineTo(objX + 5, objY + 5);
                    this.ctx.stroke();
                }
            }

            // Healthbars
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