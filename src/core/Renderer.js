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
        
        if (state.cameraShake > 0) {
            this.ctx.translate(
                (Math.random() - 0.5) * state.cameraShake, 
                (Math.random() - 0.5) * state.cameraShake
            );
        }

        this.ctx.globalAlpha = 0.15; 
        this.drawWorldItems(state); 
        this.ctx.globalAlpha = 1.0;

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

        this.drawWorldItems(state);
        
        const grad = this.ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
        grad.addColorStop(0, 'rgba(255, 255, 230, 0.4)'); 
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        this.ctx.fillStyle = grad; 
        this.ctx.fillRect(0,0, this.canvas.width, this.canvas.height);
        this.ctx.restore(); 

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
        
        // --- DRAW DAMAGE TEXT ON TOP OF EVERYTHING ---
        this.drawDamageText(state);

        this.ctx.restore(); 
    }

    drawDamageText(state) {
        this.ctx.save();
        this.ctx.textAlign = 'center';
        
        state.damageTexts.forEach(dt => {
            // Math.min(1) ensures that if life > 1 (like death tallies), it stays fully solid until it drops below 1
            this.ctx.globalAlpha = Math.max(0, Math.min(1, dt.life));
            
            // Base size is now 20px, dynamically multiplied by scale
            this.ctx.font = `bold ${Math.floor(20 * dt.scale)}px var(--ui-font, monospace)`;
            this.ctx.fillStyle = dt.color;
            
            this.ctx.lineWidth = 2;
            this.ctx.strokeStyle = '#000';
            this.ctx.strokeText(dt.text, dt.x, dt.y);
            this.ctx.fillText(dt.text, dt.x, dt.y);
        });
        
        this.ctx.restore();
    }

    drawWorldItems(state) {
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

        state.particles.forEach(p => { 
            this.ctx.fillStyle = p.color; 
            this.ctx.globalAlpha = Math.max(0, p.life); 
            this.ctx.fillRect(p.x, p.y, 4, 4); 
        });
        this.ctx.globalAlpha = 1.0;
    }
}