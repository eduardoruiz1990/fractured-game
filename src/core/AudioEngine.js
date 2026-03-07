// src/core/AudioEngine.js
// Procedural Web Audio API synthesizer for BGM and SFX.

export class AudioEngine {
    constructor() {
        this.isInitialized = false;
        this.audioCtx = null;
        this.masterGain = null;
    }

    init() {
        try {
            if (this.isInitialized) {
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
                this.masterGain.gain.setTargetAtTime(0.4, this.audioCtx.currentTime, 0.5); // Fade in
                return;
            }

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContext();
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.value = 0.4;
            this.masterGain.connect(this.audioCtx.destination);

            // Sub-Bass Drone
            this.subOsc = this.audioCtx.createOscillator();
            this.subOsc.type = 'sine';
            this.subOsc.frequency.value = 45;
            let subGain = this.audioCtx.createGain();
            subGain.gain.value = 0.7;
            this.subOsc.connect(subGain).connect(this.masterGain);
            this.subOsc.start();

            // Grinding Metallic Drone
            this.droneOsc = this.audioCtx.createOscillator();
            this.droneOsc.type = 'sawtooth';
            this.droneOsc.frequency.value = 55;

            this.filter = this.audioCtx.createBiquadFilter();
            this.filter.type = 'lowpass';
            this.filter.frequency.value = 200;

            // Pulse LFO
            this.lfo = this.audioCtx.createOscillator();
            this.lfo.type = 'sine';
            this.lfo.frequency.value = 0.5;

            let lfoGain = this.audioCtx.createGain();
            lfoGain.gain.value = 150; 

            this.lfo.connect(lfoGain).connect(this.filter.frequency);

            let droneVol = this.audioCtx.createGain();
            droneVol.gain.value = 0.3;

            this.droneOsc.connect(this.filter).connect(droneVol).connect(this.masterGain);
            
            this.lfo.start();
            this.droneOsc.start();

            this.isInitialized = true;
        } catch (e) {
            console.warn("Audio Initialization Failed: " + e.message);
        }
    }

    updateState(stress, sanityRatio) {
        if (!this.isInitialized || !this.audioCtx) return;
        
        const danger = Math.max(0, Math.min(1, 1.0 - sanityRatio)); 
        
        try {
            this.lfo.frequency.setTargetAtTime(0.5 + (danger * 4.5) + (stress * 0.2), this.audioCtx.currentTime, 0.2);
            this.filter.frequency.setTargetAtTime(200 + (danger * 800) + (stress * 150), this.audioCtx.currentTime, 0.2);
            this.droneOsc.frequency.setTargetAtTime(55 + (danger * 12), this.audioCtx.currentTime, 0.2);
        } catch(e) { }
    }

    playSFX(type, intensity = 1) {
        if (!this.isInitialized || !this.audioCtx || this.audioCtx.state === 'suspended') return;
        
        try {
            let osc = this.audioCtx.createOscillator();
            let gain = this.audioCtx.createGain();
            
            osc.connect(gain);
            gain.connect(this.masterGain);
            
            const now = this.audioCtx.currentTime;

            if (type === 'pickup') {
                osc.type = 'sine';
                const baseFreq = 600 + (Math.min(intensity, 10) * 50) + (Math.random() * 200);
                osc.frequency.setValueAtTime(baseFreq, now);
                osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.1);
                
                const vol = Math.min(0.05 + (intensity * 0.01), 0.15);
                gain.gain.setValueAtTime(vol, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc.start(now); osc.stop(now + 0.1);
            }
            else if (type === 'death') {
                osc.type = 'sawtooth';
                const baseFreq = 150 - (Math.min(intensity, 5) * 10) + (Math.random() * 50);
                osc.frequency.setValueAtTime(baseFreq, now);
                osc.frequency.exponentialRampToValueAtTime(20, now + 0.2);
                
                const vol = Math.min(0.1 + (intensity * 0.02), 0.25);
                gain.gain.setValueAtTime(vol, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.start(now); osc.stop(now + 0.2);
            }
            else if (type === 'damage') {
                osc.type = 'square';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.4);
                
                gain.gain.setValueAtTime(0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.start(now); osc.stop(now + 0.4);
            }
            else if (type === 'levelup') {
                osc.type = 'square';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.linearRampToValueAtTime(800, now + 0.4);
                
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.linearRampToValueAtTime(0.001, now + 0.5);
                osc.start(now); osc.stop(now + 0.5);
            }
        } catch (e) {}
    }

    stop() {
        if (this.masterGain && this.audioCtx) {
            this.masterGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 2.0);
        }
    }
}