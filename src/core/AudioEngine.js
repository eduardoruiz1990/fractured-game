// src/core/AudioEngine.js
// Hybrid Audio Manager: Dynamic Routing, Muffling, and Procedural Heartbeat.

export class AudioEngine {
    constructor() {
        this.isInitialized = false;
        this.audioCtx = null;
        
        this.masterGain = null;
        this.masterFilter = null; 
        this.compressor = null; 
        
        this.lastFootstepTime = 0;
        this.lastHeartbeatTime = 0;
        
        this.buffers = {};
        this.lastPlayed = {};
        
        this.activeLoops = {
            menuTheme: null,
            drone: null,
            spinner: null,
            static: null,
            flashlight: null
        };
        
        this.gains = {
            menuTheme: null,
            drone: null,
            spinner: null,
            static: null,
            flashlight: null
        };

        this.assetUrls = {
            menu_theme: "/sounds/menu_theme.mp3", 
            game_drone: "/sounds/game_drone.mp3", 
            polaroid: "/sounds/polaroid.mp3",   
            pipe_swing: "/sounds/pipe_swing.mp3", 
            pipe_hit: "/sounds/pipe_hit.mp3",   
            boss_intro: "/sounds/boss_intro.mp3", 
            ui_hover: "/sounds/ui_hover.mp3",   
            ui_click: "/sounds/ui_click.mp3",   
            ui_upgrade: "/sounds/ui_upgrade.mp3", 
            player_hurt: "/sounds/player_hurt.mp3",
            dash: "/sounds/dash.mp3",
            enemy_spawn: "/sounds/enemy_spawn.mp3",
            scavenger_hurt: "/sounds/scavenger_hurt.mp3",
            predator_hurt: "/sounds/predator_hurt.mp3",
            parasite_hurt: "/sounds/parasite_hurt.mp3",
            boss_hurt: "/sounds/boss_hurt.mp3",
            enemy_ambient: "/sounds/enemy_ambient.mp3",
            breaker_box: "/sounds/breaker_box.mp3",
            backpack: "/sounds/backpack.mp3",
            player_breath: "/sounds/player_breath.mp3" 
        };

        this.fallbackOscillators = {
            menuTheme: [],
            drone: [],
            flashlight: []
        };
    }

    async init() {
        if (this.isInitialized) {
            if (this.audioCtx && this.audioCtx.state === 'suspended') this.audioCtx.resume();
            return;
        }

        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
            
            // SMART COMPRESSOR 
            this.compressor = this.audioCtx.createDynamicsCompressor();
            this.compressor.threshold.value = -30; 
            this.compressor.knee.value = 40;       
            this.compressor.ratio.value = 15;      
            this.compressor.attack.value = 0.002;  
            this.compressor.release.value = 0.20;  
            
            // MUFFLING FILTER 
            this.masterFilter = this.audioCtx.createBiquadFilter();
            this.masterFilter.type = 'lowpass';
            this.masterFilter.frequency.value = 22050; 

            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = 1.2; 
            
            // ROUTING: Filter -> Compressor -> Speakers
            this.masterGain.connect(this.masterFilter);
            this.masterFilter.connect(this.compressor);
            this.compressor.connect(this.audioCtx.destination);

            this.gains.menuTheme = this.audioCtx.createGain();
            this.gains.menuTheme.gain.value = 0;
            this.gains.menuTheme.connect(this.masterGain);
            
            this.gains.drone = this.audioCtx.createGain();
            this.gains.drone.gain.value = 0;
            this.gains.drone.connect(this.masterGain);
            
            this.gains.flashlight = this.audioCtx.createGain();
            this.gains.flashlight.gain.value = 0;
            this.gains.flashlight.connect(this.masterGain);

            // <--- ADDED: HEARTBEAT ROUTING FIX --->
            // Pushing the heartbeat into the masterGain now triggers the compressor!
            this.gains.heartbeat = this.audioCtx.createGain();
            this.gains.heartbeat.gain.value = 0;
            this.gains.heartbeat.connect(this.masterGain);

            this.isInitialized = true;

            await this.loadAllAssets();
            this.playMenuTheme();
            
        } catch (e) {
            console.warn("Audio Context Initialization Failed: " + e.message);
        }
    }

    async loadAllAssets() {
        for (const [key, url] of Object.entries(this.assetUrls)) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                this.buffers[key] = await this.audioCtx.decodeAudioData(arrayBuffer);
                console.log(`[AudioEngine] Successfully loaded: ${key}`);
            } catch (err) {
                this.buffers[key] = null; 
            }
        }
    }

    safeFade(gainNode, targetValue, duration) {
        if (!gainNode || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(targetValue, now + duration);
    }

    playMenuTheme() {
        if (!this.isInitialized) return;
        this.safeFade(this.masterGain, 1.2, 0.5);

        if (this.activeLoops.drone) {
            this.safeFade(this.gains.drone, 0, 1.0);
            const staleDrone = this.activeLoops.drone;
            setTimeout(() => { try { staleDrone.stop(); } catch(e){} }, 1000);
            this.activeLoops.drone = null;
        }
        
        if (this.activeLoops.flashlight) {
            this.safeFade(this.gains.flashlight, 0, 1.0);
            this.stopFallbackFlashlight();
        }

        this.stopFallbackDrone();

        if (this.buffers['menu_theme']) {
            if (!this.activeLoops.menuTheme) {
                const source = this.audioCtx.createBufferSource();
                source.buffer = this.buffers['menu_theme'];
                source.loop = true;
                source.connect(this.gains.menuTheme);
                source.start();
                this.activeLoops.menuTheme = source;
            }
        } else {
            this.startFallbackMenuTheme();
        }
        
        this.safeFade(this.gains.menuTheme, 0.25, 1.0);
    }

    stopMenuTheme() {
        if (!this.isInitialized) return;
        this.safeFade(this.gains.menuTheme, 0, 1.0);
        
        if (this.activeLoops.menuTheme) {
            const staleTheme = this.activeLoops.menuTheme;
            setTimeout(() => { try { staleTheme.stop(); } catch(e){} }, 1000);
            this.activeLoops.menuTheme = null;
        }
        this.stopFallbackMenuTheme();

        this.startGameDrone();
    }

    startGameDrone() {
        if (!this.isInitialized) return;
        this.safeFade(this.masterGain, 1.2, 0.5);

        if (this.buffers['game_drone']) {
            if (!this.activeLoops.drone) {
                const source = this.audioCtx.createBufferSource();
                source.buffer = this.buffers['game_drone'];
                source.loop = true;
                source.connect(this.gains.drone);
                source.start();
                this.activeLoops.drone = source;
            }
        } else {
            this.startFallbackDrone();
        }
        
        this.startFallbackFlashlight(); 
        
        this.safeFade(this.gains.drone, 0.15, 2.0);
    }

    updateState(stress, sanityRatio, state = null) {
        if (!this.isInitialized || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        
        try {
            if (sanityRatio < 0.3) {
                this.safeFade(this.gains.drone, 0.05, 1.0);
                
                // Muffle the entire world (makes the heartbeat sound even louder by contrast)
                this.masterFilter.frequency.setTargetAtTime(1000 + (sanityRatio * 3000), now, 0.5);
                
                const beatInterval = 0.4 + (sanityRatio * 1.5); 
                if (now - this.lastHeartbeatTime > beatInterval) {
                    // Huge volume pushes through masterGain to aggressively duck background noise!
                    this.playProceduralSFX('heartbeat', 3.5); 
                    this.lastHeartbeatTime = now;
                }
            } else {
                this.safeFade(this.gains.drone, 0.15 + (stress * 0.05), 1.0);
                this.masterFilter.frequency.setTargetAtTime(22050, now, 0.5); 
            }
        } catch(e) { }
    }

    playSFX(key, volumeMult = 1.0) {
        if (!this.isInitialized || !this.audioCtx || this.audioCtx.state === 'suspended') return;
        
        const now = this.audioCtx.currentTime;
        
        if (this.lastPlayed[key] && now - this.lastPlayed[key] < 0.05) return;
        this.lastPlayed[key] = now;
        
        let finalVolume = volumeMult;
        if (key.includes('ui_')) finalVolume *= 0.4;
        if (key === 'pipe_swing') finalVolume *= 0.6;
        if (key === 'boss_intro') finalVolume *= 1.2;
        if (key === 'polaroid') finalVolume *= 2.0; 
        if (key === 'enemy_ambient') finalVolume *= 0.1;
        if (key.includes('_hurt') && key !== 'player_hurt') finalVolume *= 0.2; 
        
        if (key === 'enemy_dash') {
            if (this.buffers['dash']) {
                try {
                    const source = this.audioCtx.createBufferSource();
                    source.buffer = this.buffers['dash'];
                    const gainNode = this.audioCtx.createGain();
                    
                    // Drop pitch to 50% for monsters
                    source.playbackRate.value = 0.5 + Math.random() * 0.1; 
                    gainNode.gain.value = Math.max(0, Math.min(finalVolume * 1.5, 2.0));
                    
                    source.connect(gainNode).connect(this.masterGain);
                    source.start();
                } catch(e) {}
            } else {
                this.playProceduralSFX('enemy_dash', finalVolume);
            }
            return;
        }

        if (this.buffers[key]) {
            try {
                const source = this.audioCtx.createBufferSource();
                source.buffer = this.buffers[key];
                const gainNode = this.audioCtx.createGain();
                source.playbackRate.value = 0.95 + Math.random() * 0.1; 
                
                gainNode.gain.value = Math.max(0, Math.min(finalVolume, 2.0));
                source.connect(gainNode).connect(this.masterGain);
                source.start();
            } catch (e) { console.warn(`Failed to play buffer ${key}:`, e); }
        } else {
            this.playProceduralSFX(key, finalVolume);
        }
    }

    playFootstep() {
        if (!this.isInitialized || !this.audioCtx || this.audioCtx.state === 'suspended') return;
        const now = this.audioCtx.currentTime;
        if (now - this.lastFootstepTime < 0.15) return;
        this.lastFootstepTime = now;

        try {
            const bufferSize = this.audioCtx.sampleRate * 0.1; 
            const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;

            const noise = this.audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;

            const filter = this.audioCtx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 600 + Math.random() * 200;

            const gain = this.audioCtx.createGain();
            gain.gain.setValueAtTime(0.12, now); 
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

            noise.connect(filter).connect(gain).connect(this.masterGain);
            noise.start(now);
        } catch(e) {}
    }

    stop() {
        if (this.masterGain && this.audioCtx) {
            this.safeFade(this.masterGain, 0, 2.0);
        }
    }

    startFallbackFlashlight() {
        if (this.fallbackOscillators.flashlight.length > 0) return;
        
        const osc1 = this.audioCtx.createOscillator();
        osc1.type = 'sine'; osc1.frequency.value = 60;
        
        const osc2 = this.audioCtx.createOscillator();
        osc2.type = 'triangle'; osc2.frequency.value = 10000;
        
        osc1.connect(this.gains.flashlight);
        osc2.connect(this.gains.flashlight);
        osc1.start(); osc2.start();
        
        this.fallbackOscillators.flashlight.push(osc1, osc2);
        this.safeFade(this.gains.flashlight, 0.03, 2.0); 
    }

    stopFallbackFlashlight() {
        this.fallbackOscillators.flashlight.forEach(osc => {
            setTimeout(() => { try{ osc.stop(); }catch(e){} }, 1000);
        });
        this.fallbackOscillators.flashlight = [];
    }

    startFallbackMenuTheme() {
        if (this.fallbackOscillators.menuTheme.length > 0) return;
        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        osc1.type = 'sine'; osc2.type = 'triangle';
        osc1.frequency.value = 110; osc2.frequency.value = 112;
        
        osc1.connect(this.gains.menuTheme);
        osc2.connect(this.gains.menuTheme);
        osc1.start(); osc2.start();
        this.fallbackOscillators.menuTheme.push(osc1, osc2);
    }

    stopFallbackMenuTheme() {
        this.fallbackOscillators.menuTheme.forEach(osc => {
            setTimeout(() => { try{ osc.stop(); }catch(e){} }, 1000);
        });
        this.fallbackOscillators.menuTheme = [];
    }

    startFallbackDrone() {
        if (this.fallbackOscillators.drone.length > 0) return;
        const osc = this.audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 45;
        
        const filter = this.audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 150;

        osc.connect(filter).connect(this.gains.drone);
        osc.start();
        this.fallbackOscillators.drone.push(osc);
    }

    stopFallbackDrone() {
        this.fallbackOscillators.drone.forEach(osc => {
            setTimeout(() => { try{ osc.stop(); }catch(e){} }, 1000);
        });
        this.fallbackOscillators.drone = [];
    }

    playProceduralSFX(key, volumeMult) {
        const now = this.audioCtx.currentTime;
        const osc = this.audioCtx.createOscillator();
        
        const targetGainNode = this.masterGain;
        
        const gain = this.audioCtx.createGain();
        osc.connect(gain).connect(targetGainNode);

        if (key === 'ui_hover') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.03 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.start(now); osc.stop(now + 0.05);
        }
        else if (key === 'ui_click') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(1200, now); osc.frequency.exponentialRampToValueAtTime(1800, now + 0.05);
            gain.gain.setValueAtTime(0.1 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
            osc.start(now); osc.stop(now + 0.05);
        }
        else if (key === 'ui_upgrade') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
            gain.gain.setValueAtTime(0.2 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);

            let gulpOsc = this.audioCtx.createOscillator(); let gulpGain = this.audioCtx.createGain();
            gulpOsc.type = 'sine'; gulpOsc.frequency.setValueAtTime(150, now); gulpOsc.frequency.exponentialRampToValueAtTime(40, now + 0.4);
            gulpGain.gain.setValueAtTime(0, now); gulpGain.gain.linearRampToValueAtTime(0.5 * volumeMult, now + 0.1); gulpGain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
            gulpOsc.connect(gulpGain).connect(this.masterGain); gulpOsc.start(now); gulpOsc.stop(now + 0.6);
            
            let humOsc = this.audioCtx.createOscillator(); let humGain = this.audioCtx.createGain();
            humOsc.type = 'sine'; humOsc.frequency.setValueAtTime(80, now + 0.1); humGain.gain.setValueAtTime(0, now); humGain.gain.linearRampToValueAtTime(0.3 * volumeMult, now + 0.3); humGain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
            humOsc.connect(humGain).connect(this.masterGain); humOsc.start(now); humOsc.stop(now + 1.2);
        }
        else if (key === 'polaroid') {
            osc.type = 'square'; osc.frequency.setValueAtTime(1000, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
            gain.gain.setValueAtTime(0.5 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now); osc.stop(now + 0.05);

            let whineOsc = this.audioCtx.createOscillator(); let whineGain = this.audioCtx.createGain();
            whineOsc.type = 'sine'; whineOsc.frequency.setValueAtTime(400, now + 0.05); whineOsc.frequency.exponentialRampToValueAtTime(4000, now + 0.6);
            whineGain.gain.setValueAtTime(0, now); whineGain.gain.setValueAtTime(0.1 * volumeMult, now + 0.05); whineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            whineOsc.connect(whineGain).connect(this.masterGain); whineOsc.start(now + 0.05); whineOsc.stop(now + 0.6);
        }
        else if (key === 'pipe_swing') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(200, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.2);
            gain.gain.setValueAtTime(0.4 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        }
        else if (key === 'pipe_hit') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(120, now); osc.frequency.exponentialRampToValueAtTime(30, now + 0.2);
            gain.gain.setValueAtTime(0.5 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        }
        else if (key === 'boss_intro') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(30, now + 1.0);
            const filter = this.audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(2000, now); filter.frequency.exponentialRampToValueAtTime(100, now + 1.5);
            gain.gain.setValueAtTime(0.8 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 2.0);
            osc.disconnect(); osc.connect(filter).connect(gain); osc.start(now); osc.stop(now + 2.0);
        }
        else if (key === 'boss_static') {
            const bufferSize = this.audioCtx.sampleRate * 4.0; 
            const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
            const noise = this.audioCtx.createBufferSource(); noise.buffer = noiseBuffer;

            let filter = this.audioCtx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.setValueAtTime(1000, now);
            let noiseGain = this.audioCtx.createGain(); 
            noiseGain.gain.setValueAtTime(0.3 * volumeMult, now); 
            noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 4.0);

            noise.connect(filter).connect(noiseGain).connect(this.masterGain); 
            noise.start(now);
        }
        else if (key === 'heartbeat') {
            osc.type = 'sine'; osc.frequency.value = 50;
            gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.8 * volumeMult, now + 0.1); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
            
            let osc2 = this.audioCtx.createOscillator(); let gain2 = this.audioCtx.createGain();
            osc2.type = 'sine'; osc2.frequency.value = 45; osc2.connect(gain2).connect(targetGainNode);
            gain2.gain.setValueAtTime(0, now + 0.2); gain2.gain.linearRampToValueAtTime(0.6 * volumeMult, now + 0.3); gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc2.start(now + 0.2); osc2.stop(now + 0.6);
        }
        else if (key === 'pickup') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(600 + Math.random()*200, now); osc.frequency.exponentialRampToValueAtTime(1200, now + 0.1);
            gain.gain.setValueAtTime(0.15 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        }
        else if (key === 'player_hurt' || key === 'damage') {
            osc.type = 'square'; osc.frequency.setValueAtTime(300, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.4);
            gain.gain.setValueAtTime(0.3 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
            osc.start(now); osc.stop(now + 0.4);
        }
        else if (key === 'dash') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
            gain.gain.setValueAtTime(0.4 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
            osc.start(now); osc.stop(now + 0.15);
        }
        else if (key === 'enemy_dash') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
            gain.gain.setValueAtTime(0.5 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
        }
        else if (key === 'enemy_spawn') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
            gain.gain.setValueAtTime(0.2 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.start(now); osc.stop(now + 0.5);
        }
        else if (key === 'scavenger_hurt') {
            osc.type = 'square'; osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(200, now + 0.2);
            gain.gain.setValueAtTime(0.3 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        }
        else if (key === 'predator_hurt') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.3);
            gain.gain.setValueAtTime(0.4 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
        }
        else if (key === 'parasite_hurt') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(1000, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.1);
            gain.gain.setValueAtTime(0.3 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        }
        else if (key === 'boss_hurt') {
            osc.type = 'sawtooth'; osc.frequency.setValueAtTime(80, now); osc.frequency.exponentialRampToValueAtTime(20, now + 0.5);
            gain.gain.setValueAtTime(0.6 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.start(now); osc.stop(now + 0.5);
        }
        else if (key === 'breaker_box') {
            osc.type = 'square'; osc.frequency.setValueAtTime(100, now); osc.frequency.exponentialRampToValueAtTime(50, now + 0.3);
            gain.gain.setValueAtTime(0.5 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now); osc.stop(now + 0.3);
        }
        else if (key === 'backpack') {
            osc.type = 'triangle'; osc.frequency.setValueAtTime(400, now); osc.frequency.exponentialRampToValueAtTime(1000, now + 0.2);
            gain.gain.setValueAtTime(0.4 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc.start(now); osc.stop(now + 0.2);
        }
        else if (key === 'enemy_ambient') {
            osc.type = 'sine'; osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
            gain.gain.setValueAtTime(0.1 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        }
        else if (key === 'player_breath') {
            const bufferSize = this.audioCtx.sampleRate * 0.8; 
            const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
            const noise = this.audioCtx.createBufferSource(); noise.buffer = noiseBuffer;

            let filter = this.audioCtx.createBiquadFilter(); 
            filter.type = 'bandpass'; 
            filter.frequency.setValueAtTime(800, now);
            filter.frequency.exponentialRampToValueAtTime(300, now + 0.8);
            
            let noiseGain = this.audioCtx.createGain(); 
            noiseGain.gain.setValueAtTime(0.01, now); 
            noiseGain.gain.exponentialRampToValueAtTime(0.5 * volumeMult, now + 0.2);
            noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

            noise.connect(filter).connect(noiseGain).connect(targetGainNode); 
            noise.start(now);
        }
    }
}