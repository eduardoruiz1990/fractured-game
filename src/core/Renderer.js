// src/core/Renderer.js
// Handles HTML5 Canvas Drawing, Glitch Shaders, and Flashlight Masking

export class Renderer {
    constructor(canvas, ctx) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    drawMenuBackground(time) {
        this.ctx.fillStyle = `rgba(139, 0, 0, ${0.05 + Math.sin(time * 0.001) * 0.02})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    drawGame(state) {
        this.ctx.fillStyle = '#050505'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        
        // 1. Camera Shake
        if (state.cameraShake > 0) {
            this.ctx.translate(
                (Math.random() - 0.5) * state.cameraShake, 
                (Math.random() - 0.5) * state.cameraShake
            );
        }

        // 2. Draw Darkness Layer (Entities hidden in fog)
        this.ctx.globalAlpha = 0.15; 
        this.drawWorldItems(state); 
        this.ctx.globalAlpha = 1.0;

        // 3. The Flashlight Mask
        const fl = state.player.weapons.flashlight;
        this.ctx.save(); 
        this.ctx.beginPath(); 
        this.ctx.moveTo(state.player.x, state.player.y);
        
        // Jitter logic for low sanity
        let jitter = state.sanity < 30 ? (Math.random() - 0.5) * 0.1 : 0;
        
        this.ctx.arc(
            state.player.x, state.player.y, fl.radius, 
            state.player.angle - fl.angle + jitter, 
            state.player.angle + fl.angle + jitter
        );
        this.ctx.closePath(); 
        this.ctx.clip(); 

        // 4. Draw Lit Area
        this.drawWorldItems(state);
        
        // Flashlight Glare Gradient
        const grad = this.ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
        grad.addColorStop(0, 'rgba(255, 255, 230, 0.4)'); 
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = grad; 
        this.ctx.fillRect(0,0, this.canvas.width, this.canvas.height);
        this.ctx.restore(); // Drop mask

        // 5. Draw Static Aura Weapon
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

        // 6. Draw Player
        this.ctx.fillStyle = 'white'; 
        this.ctx.beginPath(); 
        this.ctx.arc(state.player.x, state.player.y, state.player.radius, 0, Math.PI*2); 
        this.ctx.fill();
        
        // Direction Indicator
        this.ctx.fillStyle = '#fffae6'; 
        this.ctx.beginPath();
        this.ctx.arc(
            state.player.x + Math.cos(state.player.angle) * state.player.radius, 
            state.player.y + Math.sin(state.player.angle) * state.player.radius, 
            4, 0, Math.PI*2
        );
        this.ctx.fill();

        this.ctx.restore(); // Restore camera shake
    }

    drawWorldItems(state) {
        // XP Drops
        state.xpDrops.forEach(xp => {
            this.ctx.fillStyle = '#fff'; 
            const r = 3 + Math.sin(state.frame * 0.1 + xp.x) * 1;
            this.ctx.beginPath(); this.ctx.arc(xp.x, xp.y, r, 0, Math.PI*2); this.ctx.fill();
            this.ctx.shadowBlur = 10; this.ctx.shadowColor = "white"; this.ctx.fill(); this.ctx.shadowBlur = 0;
        });

        // Entities
        state.entities.forEach(ent => {
            // Boss quantum flicker in Breakdown
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

            // Healthbars
            if (ent.hp < ent.maxHp && ent.flashTime <= 0) {
                const barW = ent.type === 'BOSS' ? 60 : 20;
                this.ctx.fillStyle = '#000'; this.ctx.fillRect(-barW/2, ent.type === 'BOSS' ? 60 : 22, barW, 4);
                this.ctx.fillStyle = '#8b0000'; this.ctx.fillRect(-barW/2, ent.type === 'BOSS' ? 60 : 22, barW * Math.max(0, ent.hp / ent.maxHp), 4);
            }

            this.ctx.restore();
            this.ctx.globalAlpha = 1.0;
        });

        // Particles
        state.particles.forEach(p => { 
            this.ctx.fillStyle = p.color; 
            this.ctx.globalAlpha = Math.max(0, p.life); 
            this.ctx.fillRect(p.x, p.y, 4, 4); 
        });
        this.ctx.globalAlpha = 1.0;
    }
}