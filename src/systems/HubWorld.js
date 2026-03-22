// src/systems/HubWorld.js
// The interactive safe room where the player prepares for the next run.

export class HubWorld {
    constructor(game) {
        this.game = game;
        this.roomRadius = 500; 
        
        // Define the physical interaction points in the room
        this.zones = [
            { id: 'bed', x: 0, y: -300, radius: 100, prompt: "THE DESCENT MACHINE (Start Run)", action: 'tab-main', color: '#c5a059' },
            { id: 'desk', x: 300, y: 0, radius: 100, prompt: "SYNAPSE RECORDS (Upgrades)", action: 'tab-tree', color: '#4466aa' },
            { id: 'locker', x: -300, y: 0, radius: 100, prompt: "THERAPY REGIMEN (Loadout)", action: 'tab-loadout', color: '#cc6600' },
            { id: 'trophies', x: 0, y: 300, radius: 100, prompt: "CLINICAL GUIDE & ROADMAP", action: 'tab-roadmap', color: '#8b0000' }
        ];
        
        this.activeZone = null;
        this.flickerTimer = 0;
        this.lightIntensity = 1;
    }

    update(state) {
        // Enforce physical walls so the player cannot run out of the hospital room into the void
        let dist = Math.hypot(state.player.x, state.player.y);
        if (dist > this.roomRadius - state.player.radius) {
            let angle = Math.atan2(state.player.y, state.player.x);
            state.player.x = Math.cos(angle) * (this.roomRadius - state.player.radius);
            state.player.y = Math.sin(angle) * (this.roomRadius - state.player.radius);
        }

        // Detect if the player is standing near OR aiming the flashlight at a specific station
        this.activeZone = null;
        const fl = state.player.weapons.flashlight;
        const playerAngle = state.player.angle;

        for (let z of this.zones) {
            let distToZone = Math.hypot(state.player.x - z.x, state.player.y - z.y);
            
            // Check 1: Is the player physically standing inside the zone?
            let isStanding = distToZone < z.radius + state.player.radius + 20;
            
            // Check 2: Is the player aiming the flashlight directly at the zone?
            let angleToZone = Math.atan2(z.y - state.player.y, z.x - state.player.x);
            let angleDiff = angleToZone - playerAngle;
            
            // Normalize angle difference to -PI to PI
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            
            let isAiming = Math.abs(angleDiff) < fl.angle && distToZone < fl.radius + z.radius;

            if (isStanding || isAiming) {
                this.activeZone = z;
                if (isStanding) break; // Prioritize physical proximity if overlapping
            }
        }

        // Abandoned Ward Fluorescent flickering logic
        this.flickerTimer--;
        if (this.flickerTimer <= 0) {
            let rand = Math.random();
            if (rand < 0.05) {
                // Pitch black! Total power failure.
                this.lightIntensity = 0.15;
                this.flickerTimer = 2 + Math.random() * 5;
            } else if (rand < 0.25) {
                // Dim, struggling flicker
                this.lightIntensity = 0.3 + Math.random() * 0.3; 
                this.flickerTimer = 5 + Math.random() * 10;
            } else {
                // Restored eerie hum
                this.lightIntensity = 0.85; 
                this.flickerTimer = 30 + Math.random() * 100;
            }
        }
    }

    draw(ctx, state, renderer) {
        ctx.save();
        
        // 1. Draw Sterile Hospital Tile Floor
        ctx.fillStyle = '#0a0c11'; // Darker base slate for abandoned feel
        ctx.fillRect(-this.roomRadius - 100, -this.roomRadius - 100, this.roomRadius * 2 + 200, this.roomRadius * 2 + 200);
        
        // Clip to a perfect circle to simulate the locked "Safe Room"
        ctx.beginPath();
        ctx.arc(0, 0, this.roomRadius, 0, Math.PI * 2);
        ctx.clip();

        // Medical Ward Tiles (Checkered clinical pattern)
        ctx.fillStyle = '#10141a'; // Slightly lighter blue-grey
        for(let i = -this.roomRadius; i <= this.roomRadius; i += 50) {
            for(let j = -this.roomRadius; j <= this.roomRadius; j += 50) {
                if ((Math.abs(i) + Math.abs(j)) % 100 === 0) {
                    ctx.fillRect(i, j, 50, 50);
                }
            }
        }
        
        // Grid Lines (Sterile Grout)
        ctx.strokeStyle = '#05070a';
        ctx.lineWidth = 2;
        for(let i = -this.roomRadius; i <= this.roomRadius; i += 50) {
            ctx.beginPath(); ctx.moveTo(i, -this.roomRadius); ctx.lineTo(i, this.roomRadius); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-this.roomRadius, i); ctx.lineTo(this.roomRadius, i); ctx.stroke();
        }

        // Room Border / Wall Baseboard
        ctx.strokeStyle = '#1a2533';
        ctx.lineWidth = 15;
        ctx.beginPath();
        ctx.arc(0, 0, this.roomRadius - 7.5, 0, Math.PI * 2);
        ctx.stroke();
        
        // 2. Draw Interactive Zones & Medical Furniture
        for (let z of this.zones) {
            let isActive = this.activeZone && this.activeZone.id === z.id;
            let pulse = isActive ? Math.sin(state.frame * 0.1) * 10 : 0;
            
            // Interaction Halo (Medical glow)
            ctx.beginPath();
            ctx.arc(z.x, z.y, z.radius + pulse, 0, Math.PI * 2);
            ctx.fillStyle = isActive ? `rgba(255, 255, 255, 0.15)` : 'rgba(0, 0, 0, 0.4)';
            ctx.fill();
            
            ctx.strokeStyle = isActive ? '#ffffff' : z.color;
            ctx.lineWidth = isActive ? 3 : 1;
            ctx.setLineDash(isActive ? [] : [5, 10]);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Detailed Top-Down Furniture
            ctx.save();
            ctx.translate(z.x, z.y);
            
            if (z.id === 'bed') {
                // Hospital Bed (The Descent Machine)
                ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-45, -75, 90, 150); // Frame
                ctx.fillStyle = '#bbb'; ctx.fillRect(-40, -70, 80, 140); // Mattress
                ctx.fillStyle = '#eee'; ctx.fillRect(-35, -65, 70, 35); // Pillow
                
                // Folded light-blue medical sheets
                ctx.fillStyle = '#88aacc'; ctx.fillRect(-40, 0, 80, 70); 
                
                // IV Pole attached to the bed
                ctx.fillStyle = '#666'; ctx.beginPath(); ctx.arc(-60, -50, 8, 0, Math.PI*2); ctx.fill();
                ctx.fillStyle = '#55ff55'; ctx.fillRect(-63, -53, 6, 12); // Glowing IV fluid (Lucidity)
            } 
            else if (z.id === 'desk') {
                // Transcription Desk (Synapse Records)
                ctx.fillStyle = '#222'; ctx.fillRect(-60, -30, 120, 60); // Desk base
                ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-50, -25, 100, 50); // Dark Desk pad
                
                // Medical Monitor Terminal
                ctx.fillStyle = '#111'; ctx.fillRect(-20, -40, 40, 15);
                ctx.fillStyle = '#0f0'; ctx.fillRect(-18, -38, 36, 11); // Green Heartbeat screen
                
                // Scattered Clinical Folders / Papers
                ctx.fillStyle = '#ccc'; 
                ctx.save(); ctx.translate(-30, 10); ctx.rotate(0.2); ctx.fillRect(0,0, 15, 20); ctx.restore();
                ctx.save(); ctx.translate(20, 5); ctx.rotate(-0.4); ctx.fillRect(0,0, 15, 20); ctx.restore();
            } 
            else if (z.id === 'locker') {
                // Therapy Regimen Lockers
                ctx.fillStyle = '#2a3544'; ctx.fillRect(-30, -50, 60, 100); // Bank of 3 lockers
                ctx.strokeStyle = '#111a22'; ctx.lineWidth = 2;
                ctx.strokeRect(-30, -50, 20, 100); 
                ctx.strokeRect(-10, -50, 20, 100); 
                ctx.strokeRect(10, -50, 20, 100);
                
                // Grated vents on locker doors
                ctx.fillStyle = '#050505';
                for(let l = -25; l <= 15; l += 20) {
                    for(let v = -40; v <= -30; v += 4) { ctx.fillRect(l, v, 10, 2); }
                }
            } 
            else if (z.id === 'trophies') {
                // Clinical Guide & Roadmap (Glass Presentation Board)
                ctx.fillStyle = '#0a0a0a'; ctx.fillRect(-40, -10, 80, 20); // Base stand
                ctx.fillStyle = 'rgba(150, 200, 255, 0.3)'; ctx.fillRect(-35, -5, 70, 10); // Glowing Glass Pane
                ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-10, 0); ctx.stroke(); // Erased Chalk mark
            }
            ctx.restore();
        }
        
        ctx.restore();
        
        // 3. Draw the Player on top of the clinical ward
        renderer.drawPlayer(state, null);
        
        // 4. Clinical Lighting for the Hub (Fluorescent & Deep Vignette)
        // We use multiply to plunge the room into shadows
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        
        // Cool surgical/fluorescent light tint that flickers aggressively
        let lightColor = `rgba(180, 200, 220, ${this.lightIntensity})`; 
        
        let grad = ctx.createRadialGradient(0, 0, 50, 0, 0, this.roomRadius);
        grad.addColorStop(0, lightColor);
        grad.addColorStop(1, '#050508'); // Extremely dark edges
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, this.roomRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // 5. The Flashlight Beam
        // We use screen compositing to let the flashlight cut through the darkness!
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        
        let fl = state.player.weapons.flashlight;
        let jitter = (Math.random() - 0.5) * 0.05; // Slight battery jitter
        
        let flGrad = ctx.createRadialGradient(state.player.x, state.player.y, 10, state.player.x, state.player.y, fl.radius);
        flGrad.addColorStop(0, 'rgba(255, 255, 230, 0.35)'); // Bright core
        flGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');          // Fades to nothing
        
        ctx.fillStyle = flGrad;
        ctx.beginPath();
        ctx.moveTo(state.player.x, state.player.y);
        ctx.arc(
            state.player.x, 
            state.player.y, 
            fl.radius, 
            state.player.angle - fl.angle + jitter, 
            state.player.angle + fl.angle + jitter
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}