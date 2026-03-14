import './style.css';

import { SaveManager } from './core/SaveManager.js';
import { UIManager } from './ui/UIManager.js';
import { InputManager } from './core/Input.js';
import { Renderer } from './core/Renderer.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Game } from './core/Game.js';
import { LevelUpUI } from './ui/LevelUpUI.js';

console.log("FRACTURED Engine Bootstrapping...");

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const saveManager = new SaveManager();
const inputManager = new InputManager(canvas);
const renderer = new Renderer(canvas, ctx);
const audioEngine = new AudioEngine();
const game = new Game();
const levelUpUI = new LevelUpUI(audioEngine);

game.audioEngine = audioEngine;

let gameState = 'MENU'; // MENU, PLAYING, LEVEL_UP, DEAD, PAUSED, EXIT_REACHED
let suspendedRunState = null; // Temp holder for descents

// 1. Setup UI / Main Menu Callbacks
const uiManager = new UIManager(saveManager, () => {
    // Start fresh Descent
    game.init(saveManager);
    game.state.player.x = canvas.width / 2;
    game.state.player.y = canvas.height / 2;
    
    audioEngine.init();
    gameState = 'PLAYING';
    document.getElementById('btn-resume-run').style.display = 'none'; // Clear suspended visual
});

// Hook for resuming a suspended run
document.getElementById('btn-resume-run').addEventListener('click', () => {
    const savedRun = localStorage.getItem('fractured_suspended_run');
    if (savedRun) {
        const carriedData = JSON.parse(savedRun);
        game.init(saveManager, carriedData);
        game.state.player.x = canvas.width / 2;
        game.state.player.y = canvas.height / 2;
        
        audioEngine.init();
        document.getElementById('main-menu').style.display = 'none';
        document.getElementById('ui-layer').style.display = 'flex';
        document.getElementById('btn-resume-run').style.display = 'none';
        localStorage.removeItem('fractured_suspended_run'); // Clear it so they can't save scum
        gameState = 'PLAYING';
    }
});

// Check if a suspended run exists on boot
if (localStorage.getItem('fractured_suspended_run')) {
    document.getElementById('btn-resume-run').style.display = 'block';
}

document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('death-screen').style.display = 'none';
    document.getElementById('main-menu').style.display = 'flex';
    uiManager.updateMenuUI();
    gameState = 'MENU';
});

// 2. Pause Menu Logic
const pauseMenu = document.getElementById('pause-menu');
const pauseTitle = document.getElementById('pause-title');
const btnDescend = document.getElementById('btn-descend');

function togglePause() {
    if (gameState === 'PLAYING') {
        gameState = 'PAUSED';
        pauseTitle.innerText = "SUSPENDED";
        pauseTitle.style.color = "white";
        pauseTitle.style.textShadow = "4px 0 var(--ui-red), -4px 0 var(--ui-gold)";
        document.getElementById('pause-desc').innerText = "The nightmare pauses, but it does not end.";
        btnDescend.style.display = 'none';
        pauseMenu.style.display = 'flex';
        inputManager.hideJoysticks();
    } else if (gameState === 'PAUSED') {
        gameState = 'PLAYING';
        pauseMenu.style.display = 'none';
    }
}

// Bind pause toggle
document.getElementById('btn-pause').addEventListener('click', togglePause);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') togglePause(); });

document.getElementById('btn-unpause').addEventListener('click', togglePause);

document.getElementById('btn-awaken').addEventListener('click', () => {
    // 1. Bank Lucidity 
    saveManager.addLucidity(game.state.lucidity);
    
    // 2. Save suspended run logic (only if pausing midway, not if finishing a floor)
    if (gameState === 'PAUSED') {
        const stateToSave = game.getCarriedState();
        localStorage.setItem('fractured_suspended_run', JSON.stringify(stateToSave));
        document.getElementById('btn-resume-run').style.display = 'block';
    } else if (gameState === 'EXIT_REACHED') {
        // Just cleanly end the run, do not suspend it
    }

    // 3. UI Cleanup
    pauseMenu.style.display = 'none';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('main-menu').style.display = 'flex';
    uiManager.updateMenuUI();
    audioEngine.stop();
    gameState = 'MENU';
});

document.getElementById('btn-descend').addEventListener('click', () => {
    // Player chose to go to Floor N+1
    const carryData = game.getCarriedState();
    carryData.floor += 1; // Bump floor!
    
    game.init(saveManager, carryData);
    game.state.player.x = canvas.width / 2;
    game.state.player.y = canvas.height / 2;
    
    pauseMenu.style.display = 'none';
    gameState = 'PLAYING';
});


// 3. Game State Callbacks
game.onDeath = () => {
    gameState = 'DEAD';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('death-screen').style.display = 'flex';
    document.getElementById('glitch-overlay').style.opacity = '0';
    
    // Death Penalty: Lose 50% of unbanked Lucidity if you die deep in the descent!
    const recovered = Math.floor(game.state.lucidity * 0.5);
    saveManager.addLucidity(recovered);
    audioEngine.stop();

    document.getElementById('final-stats').innerHTML = `
        Died on <strong>Floor ${game.state.floor}</strong>.<br><br>
        Earned <strong>${game.state.lucidity}</strong> Lucidity.<br>
        Lost to the Void: <strong>${game.state.lucidity - recovered}</strong>.<br>
        Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
    `;
    inputManager.hideJoysticks();
};

game.onLevelUp = () => {
    if (gameState === 'DEAD') return;
    gameState = 'LEVEL_UP';
    
    inputManager.keys = { w: false, a: false, s: false, d: false, space: false }; 
    inputManager.updateKeyboardInput();
    audioEngine.playSFX('levelup');

    levelUpUI.show(game, () => {
        gameState = 'PLAYING';
    });
};

game.onFloorComplete = () => {
    gameState = 'EXIT_REACHED';
    
    pauseTitle.innerText = "THE DESCENT CALLS";
    pauseTitle.style.color = "var(--ui-red)";
    pauseTitle.style.textShadow = "4px 0 white, -4px 0 var(--ui-gold)";
    document.getElementById('pause-desc').innerText = `You survived Floor ${game.state.floor}. Awaken with your Lucidity, or risk descending deeper into the nightmare?`;
    
    document.getElementById('btn-unpause').style.display = 'none'; // Cannot just 'resume' an ended floor
    btnDescend.style.display = 'block'; // Show the Descend button
    pauseMenu.style.display = 'flex';
    
    inputManager.hideJoysticks();
};

// 4. The Main Loop
function gameLoop(time) {
    try {
        if (gameState === 'MENU') {
            renderer.drawMenuBackground(time);
        } 
        else if (gameState === 'PLAYING' || gameState === 'LEVEL_UP' || gameState === 'PAUSED' || gameState === 'EXIT_REACHED') {
            
            if (gameState === 'PLAYING') {
                inputManager.updateAimAngle(game.state.player.x, game.state.player.y);
                const isBreakdown = game.update(inputManager.state, canvas.width, canvas.height, gameState);
                
                // Update HUD
                const sanityBar = document.getElementById('sanity-bar');
                let ratio = game.state.sanity / game.state.player.maxHp;
                if (!Number.isFinite(ratio)) ratio = 0;
                sanityBar.style.width = Math.max(0, ratio) * 100 + '%';
                sanityBar.style.backgroundColor = isBreakdown ? 'var(--ui-red)' : 'var(--ui-gold)';
                
                const dashBar = document.getElementById('dash-bar');
                if (dashBar && game.state.player.dash) {
                    const dashReady = game.state.player.dash.cooldown <= 0;
                    dashBar.style.width = dashReady ? '100%' : ((1 - (game.state.player.dash.cooldown / 90)) * 100) + '%';
                    dashBar.style.background = dashReady ? '#88aaff' : '#555';
                }

                // Update Convergence Bar
                const conBar = document.getElementById('convergence-bar');
                const conText = document.getElementById('convergence-text');
                if (conBar && game.state.convergenceMax) {
                    let conRatio = Math.min(1, game.state.convergence / game.state.convergenceMax);
                    conBar.style.width = (conRatio * 100) + '%';
                    conText.innerText = conRatio >= 1 ? "ANOMALY DETECTED" : `CONVERGENCE: ${Math.floor(conRatio * 100)}%`;
                    
                    if (conRatio >= 1) {
                        conBar.style.background = 'var(--ui-gold)';
                        conText.style.color = 'var(--ui-gold)';
                        conText.style.textShadow = '0 0 10px var(--ui-gold)';
                    } else {
                        conBar.style.background = 'linear-gradient(90deg, #8b0000, #ff3333)';
                        conText.style.color = 'var(--ui-red)';
                        conText.style.textShadow = '0 0 5px var(--ui-red)';
                    }
                }

                document.getElementById('glitch-overlay').style.opacity = isBreakdown ? '1' : '0';
                document.getElementById('score').innerHTML = `LUCIDITY: ${game.state.lucidity} <br> FLOOR: ${game.state.floor}`;
            }
            
            renderer.drawGame(game.state, audioEngine);
        }
    } catch (e) {
        console.error("Main Loop Crash: " + e.message);
    }
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
console.log("FRACTURED Engine Online.");