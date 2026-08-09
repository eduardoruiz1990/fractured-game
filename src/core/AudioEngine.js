// src/core/AudioEngine.js
// Hybrid Audio Manager: Dynamic Routing, Muffling, and Procedural Heartbeat.

export class AudioEngine {
    constructor() {
        this.isInitialized = false;
        this.audioCtx = null;
        
        this.masterGain = null;
        this.masterFilter = null;
        this.compressor = null;

        // PLAYER VOLUME BUSES (Patch 80). Sit BELOW masterGain, which stays the sole
        // property of ducking / stop() / setMuted(). See the class comment on
        // setMusicVolume for why these must not share a node with any of those.
        this.musicGain = null;
        this.sfxGain = null;
        // Normalised 0..1 player settings. 1 = the pre-patch mix, exactly.
        this._musicVolume = 1;
        this._sfxVolume = 1;

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

        // Paths are RELATIVE (no leading slash) on purpose. An absolute "/sounds/x.mp3"
        // resolves against the DOMAIN ROOT, which breaks on any host that serves the
        // game from a subdirectory — CrazyGames does, and every one of these 404'd in
        // their QA preview while the relative-path JS/CSS bundle loaded fine. Patch 43
        // set Vite's `base: './'`, but that only rewrites paths Vite itself emits into
        // index.html; URLs built at runtime in JS like these are invisible to it.
        // Never reintroduce a leading slash here.
        this.assetUrls = {
            menu_theme: "sounds/menu_theme.mp3",
            polaroid: "sounds/polaroid.mp3",
            pipe_swing: "sounds/pipe_swing.mp3",
            pipe_hit: "sounds/pipe_hit.mp3",
            boss_intro: "sounds/boss_intro.mp3",
            ui_hover: "sounds/ui_hover.mp3",
            ui_click: "sounds/ui_click.mp3",
            ui_upgrade: "sounds/ui_upgrade.mp3",
            player_hurt: "sounds/player_hurt.mp3",
            dash: "sounds/dash.mp3",
            enemy_spawn: "sounds/enemy_spawn.mp3",
            scavenger_hurt: "sounds/scavenger_hurt.mp3",
            predator_hurt: "sounds/predator_hurt.mp3",
            parasite_hurt: "sounds/parasite_hurt.mp3",
            boss_hurt: "sounds/boss_hurt.mp3",
            enemy_ambient: "sounds/enemy_ambient.mp3",
            breaker_box: "sounds/breaker_box.mp3",
            backpack: "sounds/backpack.mp3"
            // NOTE: no player_breath entry. That mp3 was never added to public/sounds/,
            // so listing it here only produced a guaranteed 404 on every load (flagged by
            // CrazyGames QA). It doesn't need one: playSFX falls through to
            // playProceduralSFX() whenever buffers[key] is absent, and player_breath has a
            // synthesized implementation there (filtered noise). Only add a URL back here
            // if the actual file ships in public/sounds/.
        };

        // Loaded in the background AFTER the loading window closes — see
        // loadDeferredAssets(). game_drone.mp3 is ~4.3MB, over half the entire
        // download, and is not audible until a run starts.
        this.deferredAssetUrls = {
            game_drone: "sounds/game_drone.mp3"
        };

        this.fallbackOscillators = {
            menuTheme: [],
            drone: [],
            flashlight: []
        };
    }

    /**
     * Builds the audio graph and downloads/decodes the essential assets.
     *
     * Safe to call at PAGE LOAD, before any user gesture — an AudioContext created
     * without one simply starts in the 'suspended' state, and decodeAudioData works
     * fine there. Only actual playback needs the gesture, which is what init() does.
     *
     * This split exists for the platform's load-time metric: loading used to be
     * kicked off by the INITIALIZE click, so the clock ran for as long as the player
     * sat on the title screen (a deliberate ~199s pause was reported as a 198.9s
     * load). Loading now starts immediately and the reported time reflects real work.
     *
     * Memoized — repeated calls share one in-flight load and never rebuild the graph.
     */
    async preload() {
        if (!this._preloadPromise) this._preloadPromise = this._doPreload();
        return this._preloadPromise;
    }

    /**
     * Resumes the AudioContext on a genuine user gesture WITHOUT starting the menu
     * bed (Patch 52).
     *
     * The title screen can now launch straight into a run, and on that route the
     * menu theme must never be heard. Going through init() would start it and then
     * need stopMenuTheme() to take it away — and that fades over a full second, so
     * every run launched from the title would open with a second of menu music
     * bleeding over the first room. Game.init() starts the gameplay drone itself,
     * so unlocking the context is all a run actually needs.
     */
    async unlock() {
        await this.preload();
        try {
            if (this.audioCtx && this.audioCtx.state === 'suspended') await this.audioCtx.resume();
        } catch (e) { /* resume can reject if the gesture wasn't trusted; harmless */ }
    }

    async init() {
        // Resume on a genuine user gesture, then start the menu bed.
        await this.unlock();
        this.playMenuTheme();
    }

    async _doPreload() {
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
            
            // ROUTING: (music|sfx) -> Master -> Filter -> Compressor -> Speakers
            this.masterGain.connect(this.masterFilter);
            this.masterFilter.connect(this.compressor);
            this.compressor.connect(this.audioCtx.destination);

            // The two player-controlled buses. Everything audible goes through one of
            // them, so a player setting either to 0 gets actual silence on that layer —
            // before this patch every source connected straight to masterGain and there
            // was no seam to put a volume control on.
            this.musicGain = this.audioCtx.createGain();
            this.musicGain.gain.value = this._volumeToGain(this._musicVolume);
            this.musicGain.connect(this.masterGain);

            this.sfxGain = this.audioCtx.createGain();
            this.sfxGain.gain.value = this._volumeToGain(this._sfxVolume);
            this.sfxGain.connect(this.masterGain);

            // MUSIC / AMBIENCE bus: the menu bed, the gameplay drone, and the
            // flashlight hum. The hum belongs here rather than on SFX because it is a
            // continuous tone with no trigger — it is exactly the "noise all the time"
            // a player asked to be able to turn off.
            this.gains.menuTheme = this.audioCtx.createGain();
            this.gains.menuTheme.gain.value = 0;
            this.gains.menuTheme.connect(this.musicGain);

            this.gains.drone = this.audioCtx.createGain();
            this.gains.drone.gain.value = 0;
            this.gains.drone.connect(this.musicGain);

            this.gains.flashlight = this.audioCtx.createGain();
            this.gains.flashlight.gain.value = 0;
            this.gains.flashlight.connect(this.musicGain);

            // <--- ADDED: HEARTBEAT ROUTING FIX --->
            // Still reaches masterGain (and therefore the compressor) via the SFX bus.
            this.gains.heartbeat = this.audioCtx.createGain();
            this.gains.heartbeat.gain.value = 0;
            this.gains.heartbeat.connect(this.sfxGain);

            this.isInitialized = true;

            // No playback here — the context may still be suspended (no gesture yet).
            // init() resumes and starts the menu theme once the player clicks.
            await this.loadAllAssets();

        } catch (e) {
            console.warn("Audio Context Initialization Failed: " + e.message);
        }
    }

    async loadOneAsset(key, url) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            this.buffers[key] = await this.audioCtx.decodeAudioData(arrayBuffer);
        } catch (err) {
            // Leave the buffer null: playSFX/startGameDrone fall through to their
            // procedural synth paths, so a failed asset degrades rather than breaks.
            this.buffers[key] = null;
        }
    }

    /**
     * Loads everything needed before the player can meaningfully interact.
     *
     * PARALLEL, not sequential. This used to be an `await` inside a `for` loop, so
     * all 20 files were fetched one after another, each waiting on the previous —
     * the single largest contributor to a ~19s reported load time on CrazyGames.
     * These are independent requests with no ordering constraint.
     */
    async loadAllAssets() {
        await Promise.all(
            Object.entries(this.assetUrls).map(([key, url]) => this.loadOneAsset(key, url))
        );
    }

    /**
     * Loads assets NOT needed to reach the menu/hub — currently just game_drone.mp3,
     * which at ~4.3MB is over half the total download but is inaudible until a run
     * actually starts. Fire-and-forget on purpose: never awaited, so it cannot delay
     * time-to-interactive, and it is kicked off only AFTER the loading window closes
     * so its bytes don't count against the platform's measured load size.
     *
     * If a run somehow starts before this resolves, startGameDrone() falls back to
     * the synthesized drone, and the sampled one is picked up on the next run.
     * Idempotent — safe to call more than once.
     */
    loadDeferredAssets() {
        if (this._deferredLoadStarted) return;
        this._deferredLoadStarted = true;
        Object.entries(this.deferredAssetUrls).forEach(([key, url]) => {
            this.loadOneAsset(key, url);
        });
    }

    /**
     * Maps a 0..1 player setting onto a linear gain multiplier.
     *
     * Squared, not linear: loudness is roughly logarithmic, so a linear slider spends
     * most of its travel in a range that all sounds "loud" and gives almost no useful
     * resolution at the quiet end — which is the end the players who asked for this
     * are trying to reach. v^2 puts the halfway point at -12dB.
     *
     * Total by contract: this feeds a GainNode, and a NaN there poisons the bus for
     * the rest of the session with no error and no way back short of a reload.
     */
    _volumeToGain(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 1;
        const clamped = Math.max(0, Math.min(1, n));
        return clamped * clamped;
    }

    /**
     * The bus every one-shot sound belongs on. Falls back to masterGain if called
     * before the graph exists, so a mis-ordered call degrades to the old behaviour
     * rather than connecting to null and throwing inside the render path.
     */
    _sfxBus() {
        return this.sfxGain || this.masterGain;
    }

    /**
     * Player-facing volume, 0..1, for the music/ambience layer and the SFX layer.
     *
     * DELIBERATELY NOT setMuted(). That is a reason-based binary owned by the portal
     * ('ad' during video playback, 'platform' for the platform's own mute switch), it
     * hard-sets masterGain AND suspends the context, and it restores a captured
     * pre-mute value on release. Folding a player volume into it would mean an ad
     * ending stamps its restore value over whatever the player chose, and a player
     * sliding music to 0 clears an ad-mute that is still meant to be in force.
     *
     * These write to their own nodes further down the graph instead, so the two
     * systems multiply rather than fight: muted-during-ad AND music-at-30% is a
     * representable state, and each is restored independently.
     *
     * Ramped over 60ms rather than set: a step change on a running bus is an audible
     * click, and these are driven from a slider that fires continuously while dragged.
     */
    setMusicVolume(v) {
        const n = Number(v);
        this._musicVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
        if (this.musicGain) this.safeFade(this.musicGain, this._volumeToGain(this._musicVolume), 0.06);
    }

    setSfxVolume(v) {
        const n = Number(v);
        this._sfxVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
        if (this.sfxGain) this.safeFade(this.sfxGain, this._volumeToGain(this._sfxVolume), 0.06);
    }

    getMusicVolume() { return this._musicVolume; }
    getSfxVolume() { return this._sfxVolume; }

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

    playSFX(key, volumeMult = 1.0, randomizePitch = true) {
        if (!this.isInitialized || !this.audioCtx || this.audioCtx.state === 'suspended') return;
        
        const now = this.audioCtx.currentTime;
        
        if (this.lastPlayed[key] && now - this.lastPlayed[key] < 0.05) return;
        this.lastPlayed[key] = now;
        
        let finalVolume = volumeMult;
        if (key.includes('ui_')) finalVolume *= 0.4;
        if (key === 'pipe_swing') finalVolume *= 0.6;
        if (key === 'boss_intro') {
            finalVolume *= 1.2;
            this.triggerAudioDucking(2.0);
        }
        if (key === 'polaroid') finalVolume *= 2.0; 
        if (key === 'enemy_ambient') finalVolume *= 0.1;
        if (key.includes('_hurt') && key !== 'player_hurt') finalVolume *= 0.2; 
        if (key === 'ui_upgrade' || key === 'levelup') {
            this.triggerAudioDucking(2.0);
        }
        
        if (key === 'enemy_dash') {
            if (this.buffers['dash']) {
                try {
                    const source = this.audioCtx.createBufferSource();
                    source.buffer = this.buffers['dash'];
                    const gainNode = this.audioCtx.createGain();
                    
                    // Drop pitch to 50% for monsters
                    source.playbackRate.value = randomizePitch ? 0.5 + Math.random() * 0.1 : 0.5; 
                    gainNode.gain.value = Math.max(0, Math.min(finalVolume * 1.5, 2.0));
                    
                    source.connect(gainNode).connect(this._sfxBus());
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
                
                if (['dash', 'player_hurt', 'enemy_spawn', 'ui_click'].includes(key) && randomizePitch) {
                    source.playbackRate.value = 0.9 + Math.random() * 0.2; 
                } else if (randomizePitch) {
                    source.playbackRate.value = 0.95 + Math.random() * 0.1;
                }
                
                gainNode.gain.value = Math.max(0, Math.min(finalVolume, 2.0));
                source.connect(gainNode).connect(this._sfxBus());
                source.start();
            } catch (e) { console.warn(`Failed to play buffer ${key}:`, e); }
        } else {
            this.playProceduralSFX(key, finalVolume);
        }
    }

    triggerAudioDucking(duration) {
        if (!this.masterGain || !this.audioCtx) return;
        const now = this.audioCtx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
        this.masterGain.gain.linearRampToValueAtTime(0.3, now + 0.1);
        this.masterGain.gain.linearRampToValueAtTime(0.3, now + duration);
        this.masterGain.gain.linearRampToValueAtTime(1.2, now + duration + 1.0);
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

            noise.connect(filter).connect(gain).connect(this._sfxBus());
            noise.start(now);
        } catch(e) {}
    }

    stop() {
        if (this.masterGain && this.audioCtx) {
            this.safeFade(this.masterGain, 0, 2.0);
        }
    }

    /**
     * Hard mute/unmute with independently-tracked reasons. Two portal-driven
     * callers need this: video-ad playback (Patch 47, reason 'ad') and the
     * platform's own forced-mute setting (Patch 49, reason 'platform', see
     * PortalSDK.onPlatformMuteChange). Audio stays muted while ANY reason is
     * still active, and is only restored once EVERY reason has cleared — a naive
     * shared boolean would let an ad finishing unmute the game while the platform
     * still has it muted, or the platform unmuting cut off a still-playing ad.
     *
     * Deliberately NOT a safeFade: a fade is both audible over the start of a mute
     * and, more importantly, reversible by any other scheduled ramp — playMenuTheme,
     * triggerAudioDucking and stop() all write to masterGain.gain, and any of them
     * landing mid-mute would un-mute us. So this cancels scheduled values, hard-sets
     * the gain, AND suspends the AudioContext, which no gain ramp can override.
     * Suspending has a useful side effect: playSFX/playFootstep already early-return
     * while the context is suspended, so nothing can queue new sound while muted.
     *
     * The pre-mute gain is captured and restored rather than assuming the 1.2
     * nominal, so muting during a duck or a death-fade restores what was actually there.
     */
    setMuted(reason, muted) {
        if (!this.audioCtx || !this.masterGain) return;
        if (!this._muteReasons) this._muteReasons = new Set();
        const wasMuted = this._muteReasons.size > 0;
        if (muted) this._muteReasons.add(reason);
        else this._muteReasons.delete(reason);
        const isMuted = this._muteReasons.size > 0;
        if (isMuted === wasMuted) return;   // no reason-set transition, nothing to do

        try {
            const now = this.audioCtx.currentTime;
            if (isMuted) {
                this._preMuteGain = this.masterGain.gain.value;
                this.masterGain.gain.cancelScheduledValues(now);
                this.masterGain.gain.setValueAtTime(0, now);
                if (this.audioCtx.state === 'running') this.audioCtx.suspend();
            } else {
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
                const restore = (typeof this._preMuteGain === 'number') ? this._preMuteGain : 1.2;
                this.masterGain.gain.cancelScheduledValues(now);
                this.masterGain.gain.setValueAtTime(restore, now);
            }
        } catch (e) {
            // Never let an audio failure block the ad/mute flow or the game resuming.
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
        
        // Every voice below — including the sub-oscillators that used to name
        // this.masterGain directly — goes through this one bus. The routing was
        // previously split between the two names for no reason (they resolved to the
        // same node), which is how the SFX layer ended up with nowhere to attach a
        // volume control.
        const targetGainNode = this._sfxBus();

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
            gulpOsc.connect(gulpGain).connect(targetGainNode); gulpOsc.start(now); gulpOsc.stop(now + 0.6);
            
            let humOsc = this.audioCtx.createOscillator(); let humGain = this.audioCtx.createGain();
            humOsc.type = 'sine'; humOsc.frequency.setValueAtTime(80, now + 0.1); humGain.gain.setValueAtTime(0, now); humGain.gain.linearRampToValueAtTime(0.3 * volumeMult, now + 0.3); humGain.gain.exponentialRampToValueAtTime(0.01, now + 1.2);
            humOsc.connect(humGain).connect(targetGainNode); humOsc.start(now); humOsc.stop(now + 1.2);
        }
        else if (key === 'polaroid') {
            osc.type = 'square'; osc.frequency.setValueAtTime(1000, now); osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
            gain.gain.setValueAtTime(0.5 * volumeMult, now); gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
            osc.start(now); osc.stop(now + 0.05);

            let whineOsc = this.audioCtx.createOscillator(); let whineGain = this.audioCtx.createGain();
            whineOsc.type = 'sine'; whineOsc.frequency.setValueAtTime(400, now + 0.05); whineOsc.frequency.exponentialRampToValueAtTime(4000, now + 0.6);
            whineGain.gain.setValueAtTime(0, now); whineGain.gain.setValueAtTime(0.1 * volumeMult, now + 0.05); whineGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
            whineOsc.connect(whineGain).connect(targetGainNode); whineOsc.start(now + 0.05); whineOsc.stop(now + 0.6);
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

            noise.connect(filter).connect(noiseGain).connect(targetGainNode);
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