// src/systems/HubWorld.js
// The interactive safe room where the player prepares for the next run.

export class HubWorld {
    constructor(game) {
        this.game = game;
        this.roomRadius = 500; 
        
        this.zones = [
            { id: 'bed', x: 0, y: -300, radius: 100, prompt: "THE DESCENT MACHINE (Start Run)", action: 'tab-main', color: '#c5a059' },
            { id: 'desk', x: 300, y: 0, radius: 100, prompt: "SYNAPSE RECORDS (Upgrades)", action: 'tab-tree', color: '#0ea5e9' },
            { id: 'locker', x: -300, y: 0, radius: 100, prompt: "THERAPY REGIMEN (Loadout)", action: 'tab-loadout', color: '#94a3b8' },
            { id: 'trophies', x: 0, y: 300, radius: 100, prompt: "THE MIND PALACE (Monuments)", action: 'tab-trophies', color: '#8b0000' }
        ];
        
        this.activeZone = null;
        this.flickerTimer = 0;
        this.lightIntensity = 1;

        this.cachedFloor = this.generateFloor();
    }

    generateFloor() {
        const c = document.createElement('canvas');
        const s = 1200; 
        c.width = s; c.height = s;
        const cx = c.getContext('2d');
        cx.translate(s/2, s/2);

        cx.fillStyle = '#0f1115';
        cx.fillRect(-s/2, -s/2, s, s);

        cx.beginPath();
        cx.arc(0, 0, this.roomRadius, 0, Math.PI * 2);
        cx.clip();

        cx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
        cx.lineWidth = 2;
        for(let i = -this.roomRadius; i <= this.roomRadius; i += 40) {
            cx.beginPath(); cx.moveTo(i, -this.roomRadius); cx.lineTo(i, this.roomRadius); cx.stroke();
            cx.beginPath(); cx.moveTo(-this.roomRadius, i); cx.lineTo(this.roomRadius, i); cx.stroke();
        }
        
        cx.fillStyle = 'rgba(255,255,255,0.015)';
        for(let i = -this.roomRadius; i <= this.roomRadius; i += 80) {
            for(let j = -this.roomRadius; j <= this.roomRadius; j += 80) {
                cx.fillRect(i, j, 40, 40);
                cx.fillRect(i+40, j+40, 40, 40);
            }
        }

        cx.strokeStyle = '#1e293b'; 
        cx.lineWidth = 16;
        cx.beginPath(); cx.arc(0, 0, this.roomRadius, 0, Math.PI*2); cx.stroke();
        
        cx.strokeStyle = '#0f172a'; 
        cx.lineWidth = 8;
        cx.beginPath(); cx.arc(0, 0, this.roomRadius - 8, 0, Math.PI*2); cx.stroke();

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
            
            // CRITICAL FIX: Safe checks for flashlight radius preventing NaN comparison failures
            let flRadius = (fl && Number.isFinite(fl.radius)) ? fl.radius : 250;
            let flAngle = (fl && Number.isFinite(fl.angle)) ? fl.angle : 0.6;
            
            let isAiming = Math.abs(angleDiff) < flAngle && distToZone < flRadius + z.radius;

            if (isStanding || isAiming) {
                this.activeZone = z;
                if (isStanding) break; 
            }
        }

        this.flickerTimer--;
        if (this.flickerTimer <= 0) {
            let rand = Math.random();
            if (rand < 0.05) {
                this.lightIntensity = 0.15;
                this.flickerTimer = 2 + Math.random() * 5;
            } else if (rand < 0.25) {
                this.lightIntensity = 0.3 + Math.random() * 0.3; 
                this.flickerTimer = 5 + Math.random() * 10;
            } else {
                this.lightIntensity = 0.85; 
                this.flickerTimer = 30 + Math.random() * 100;
            }
        }
    }

    draw(ctx, state, renderer) {
        ctx.save();
        
        ctx.drawImage(this.cachedFloor, -600, -600);
        
        for (let z of this.zones) {
            let isActive = this.activeZone && this.activeZone.id === z.id;
            
            if (isActive) {
                ctx.save();
                ctx.translate(z.x, z.y);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                ctx.lineWidth = 6;
                if (z.id === 'bed') { ctx.beginPath(); ctx.roundRect(-45, -75, 90, 150, 8); ctx.stroke(); }
                else if (z.id === 'desk') { ctx.beginPath(); ctx.roundRect(-60, -30, 120, 60, 6); ctx.stroke(); }
                else if (z.id === 'locker') ctx.strokeRect(-30, -50, 60, 100);
                else if (z.id === 'trophies') ctx.strokeRect(-45, -15, 90, 30);
                ctx.restore();
            }

            ctx.save();
            ctx.translate(z.x + 10, z.y + 15); 
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            
            if (z.id === 'bed') {
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-45, -75, 90, 150, 8); ctx.fill(); }
                else ctx.fillRect(-45, -75, 90, 150);
            }
            else if (z.id === 'desk') {
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-60, -30, 120, 60, 6); ctx.fill(); }
                else ctx.fillRect(-60, -30, 120, 60);
            }
            else if (z.id === 'locker') ctx.fillRect(-30, -50, 60, 100);
            else if (z.id === 'trophies') ctx.fillRect(-45, -15, 90, 30);
            ctx.restore();
            
            ctx.save();
            ctx.translate(z.x, z.y);
            
            if (z.id === 'bed') {
                ctx.fillStyle = '#2c3e50'; 
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-45, -75, 90, 150, 8); ctx.fill(); }
                else ctx.fillRect(-45, -75, 90, 150);
                
                ctx.fillStyle = '#ecf0f1'; 
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-40, -70, 80, 140, 5); ctx.fill(); }
                else ctx.fillRect(-40, -70, 80, 140);
                
                ctx.fillStyle = '#bdc3c7'; // Pillow
                ctx.fillRect(-35, -65, 70, 25);
                
                ctx.fillStyle = '#3498db'; // Blanket
                ctx.fillRect(-40, -10, 80, 80);
                ctx.fillStyle = '#2980b9'; // Blanket Fold
                ctx.fillRect(-40, -10, 80, 15);
                
                // IV Pole
                ctx.fillStyle = '#7f8c8d'; ctx.beginPath(); ctx.arc(-55, -60, 6, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#2ecc71'; ctx.fillRect(-57, -62, 4, 10);
            } 
            else if (z.id === 'desk') {
                ctx.fillStyle = '#1e272e'; 
                if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-60, -30, 120, 60, 6); ctx.fill(); }
                else ctx.fillRect(-60, -30, 120, 60);
                
                ctx.fillStyle = '#0b0e14'; // Mat
                ctx.fillRect(-50, -25, 100, 50);
                
                // Cyan Monitors
                ctx.fillStyle = '#000'; ctx.fillRect(-35, -35, 30, 10); ctx.fillRect(5, -35, 30, 10);
                ctx.fillStyle = '#0ea5e9'; 
                ctx.fillRect(-34, -34, 28, 8); ctx.fillRect(6, -34, 28, 8);
                
                // Keyboard
                ctx.fillStyle = '#222'; ctx.fillRect(-20, -10, 40, 12);
                ctx.fillStyle = 'rgba(14, 165, 233, 0.3)'; ctx.fillRect(-18, -8, 36, 8); 
            } 
            else if (z.id === 'locker') {
                let lockerGrad = ctx.createLinearGradient(-30, -50, 30, 50);
                lockerGrad.addColorStop(0, '#34495e');
                lockerGrad.addColorStop(1, '#1a252f');
                ctx.fillStyle = lockerGrad; 
                ctx.fillRect(-30, -50, 60, 100); 
                
                ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
                ctx.strokeRect(-30, -50, 20, 100); 
                ctx.strokeRect(-10, -50, 20, 100); 
                ctx.strokeRect(10, -50, 20, 100);
                
                ctx.fillStyle = '#050505';
                for(let l = -25; l <= 15; l += 20) {
                    for(let v = -40; v <= -30; v += 4) { ctx.fillRect(l, v, 10, 2); }
                }
            } 
            else if (z.id === 'trophies') {
                ctx.fillStyle = '#0f172a'; ctx.fillRect(-45, -15, 90, 30); 
                ctx.fillStyle = 'rgba(150, 200, 255, 0.15)'; ctx.fillRect(-40, -10, 80, 20); 
                ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5; 
                ctx.beginPath(); ctx.moveTo(-35, -5); ctx.lineTo(-15, -5); ctx.stroke();

                const kills = state.killCounts || {};

                const drawStatue = (tx, ty, count, baseColor) => {
                    if (count < 10) return; 
                    
                    let metalColor = '#cd7f32'; 
                    if (count >= 10000) { metalColor = '#ffd700'; }
                    else if (count >= 1000) { metalColor = '#e2e8f0'; }

                    ctx.save();
                    ctx.translate(tx, ty);
                    
                    ctx.fillStyle = '#1e293b'; 
                    if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-15, -10, 30, 20, 3); ctx.fill(); }
                    else ctx.fillRect(-15, -10, 30, 20);
                    
                    ctx.fillStyle = metalColor;
                    ctx.globalAlpha = 0.25;
                    ctx.beginPath(); ctx.arc(0, -25, 20, 0, Math.PI * 2); ctx.fill();
                    ctx.globalAlpha = 1.0;
                    
                    ctx.beginPath(); ctx.arc(0, -25, 12, 0, Math.PI * 2); ctx.fill(); 
                    ctx.fillRect(-6, -18, 12, 18); 
                    
                    ctx.fillStyle = baseColor; 
                    ctx.beginPath(); ctx.arc(0, -25, 4, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                };

                drawStatue(-80, -30, kills.SCAVENGER || 0, '#555');
                drawStatue(80, -30, kills.PREDATOR || 0, '#8b0000');
                drawStatue(-120, -5, kills.PARASITE || 0, '#a0522d');

                const drawBossMonument = (tx, ty, isDefeated, color, shape) => {
                    if (!isDefeated) return;
                    ctx.save();
                    ctx.translate(tx, ty);
                    
                    ctx.fillStyle = '#1e293b'; 
                    if(ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-20, -15, 40, 25, 4); ctx.fill(); }
                    else ctx.fillRect(-20, -15, 40, 25);
                    
                    ctx.fillStyle = color;
                    ctx.globalAlpha = 0.25;
                    ctx.beginPath(); ctx.arc(0, -25, 25, 0, Math.PI * 2); ctx.fill();
                    ctx.globalAlpha = 1.0;
                    
                    if (shape === 'sphere') {
                        ctx.beginPath(); ctx.arc(0, -25, 14, 0, Math.PI*2); ctx.fill();
                    } else if (shape === 'rorschach') {
                        ctx.beginPath(); ctx.moveTo(0, -35); ctx.lineTo(15, -15); ctx.lineTo(-15, -15); ctx.fill();
                    } else if (shape === 'panopticon') {
                        ctx.fillRect(-10, -35, 20, 20);
                        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, -25, 4, 0, Math.PI*2); ctx.fill();
                    } else if (shape === 'amalgamation') {
                        ctx.beginPath(); ctx.arc(-5, -20, 9, 0, Math.PI*2); ctx.arc(5, -25, 11, 0, Math.PI*2); ctx.fill();
                    } else if (shape === 'architect') {
                        ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(-12, -35, 24, 24);
                    }
                    ctx.restore();
                };

                drawBossMonument(-55, 30, (kills.BOSS || 0) > 0, '#b87333', 'sphere');
                drawBossMonument(55, 30, (kills.RORSCHACH || 0) > 0, '#800080', 'rorschach');
                drawBossMonument(-100, 40, (kills.PANOPTICON || 0) > 0, '#ff0055', 'panopticon');
                drawBossMonument(100, 40, (kills.AMALGAMATION || 0) > 0, '#55ff55', 'amalgamation');
                drawBossMonument(0, 50, (kills.ARCHITECT || 0) > 0, '#c5a059', 'architect');
            }
            ctx.restore();
        }
        
        ctx.restore();
    }
}