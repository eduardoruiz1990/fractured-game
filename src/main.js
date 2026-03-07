// src/main.js
import './style.css';

import { SaveManager } from './core/SaveManager.js';
import { UIManager } from './ui/UIManager.js';
import { InputManager } from './core/Input.js';
import { Renderer } from './core/Renderer.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Game } from './core/Game.js';
import { MANIFESTATIONS } from './data/Manifestations.js';

console.log("FRACTURED Engine Bootstrapping...");

// 1. Initialize DOM Elements
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

// 2. Initialize Core Systems
const saveManager = new SaveManager();
const inputManager = new InputManager(canvas);
const renderer = new Renderer(canvas, ctx);
const audioEngine = new AudioEngine();
const game = new Game();

game.audioEngine = audioEngine;

let gameState = 'MENU'; // MENU, PLAYING, LEVEL_UP, DEAD

// 3. Initialize UI & Event Callbacks
const uiManager = new UIManager(saveManager, () => {
    // START GAME CALLBACK
    game.init(saveManager);
    game.state.player.x = canvas.width / 2;
    game.state.player.y = canvas.height / 2;
    
    audioEngine.init();
    gameState = 'PLAYING';
});

// Update the Death Screen logic so UIManager can reset
document.getElementById('btn-restart').addEventListener('click', () => {
    document.getElementById('death-screen').style.display = 'none';
    document.getElementById('main-menu').style.display = 'flex';
    uiManager.updateMenuUI();
    gameState = 'MENU';
});

// 4. Game Callbacks
game.onDeath = () => {
    gameState = 'DEAD';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('death-screen').style.display = 'flex';
    document.getElementById('glitch-overlay').style.opacity = '0';
    
    saveManager.addLucidity(game.state.lucidity);
    audioEngine.stop();

    document.getElementById('final-stats').innerHTML = `
        You survived to <strong>Level ${game.state.level}</strong>.<br><br>
        Earned <strong>${game.state.lucidity}</strong> Lucidity.<br>
        Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
    `;
    inputManager.hideJoysticks();
};

game.onLevelUp = () => {
    if (gameState === 'DEAD') return;
    gameState = 'LEVEL_UP';
    
    // Reset inputs
    inputManager.keys = { w: false, a: false, s: false, d: false }; 
    inputManager.updateKeyboardInput();
    audioEngine.playSFX('levelup');

    const levelUpModal = document.getElementById('level-up-modal');
    const cardsContainer = document.getElementById('cards-container');
    levelUpModal.style.display = 'flex';
    cardsContainer.innerHTML = '';
    
    const keysList = Object.keys(MANIFESTATIONS);
    const shuffled = [...keysList].sort(() => 0.5 - Math.random());
    let selected = shuffled.slice(0, 3);
    
    selected.forEach(key => {
        const man = MANIFESTATIONS[key];
        const currentLvl = key === 'adrenaline' ? 0 : game.state.player.weapons[key].level;
        const card = document.createElement('div'); 
        card.className = 'card';
        
        if (currentLvl >= man.maxLvl) {
            card.innerHTML = `<h3>${man.name}</h3><p>MAX LEVEL</p>`;
            card.style.opacity = '0.5'; 
            card.style.cursor = 'not-allowed';
        } else {
            card.innerHTML = `<h3>${man.name}</h3><p>${man.desc}</p><div class="lvl">Level Up to ${currentLvl + 1}</div>`;
            card.onclick = () => {
                if (key === 'adrenaline') {
                    game.state.player.speedMultiplier += 0.1;
                    game.state.sanityDrainMult *= 0.85;
                } else {
                    const wep = game.state.player.weapons[key];
                    wep.level++;
                    if (key === 'flashlight') { wep.damage += 5; wep.radius += 20; wep.angle += 0.05; }
                    if (key === 'static') { wep.damage += 3; wep.radius += 15; wep.active = true; }
                }
                
                game.state.sanity = Math.min(game.state.player.maxHp, game.state.sanity + 20);
                gameState = 'PLAYING'; 
                levelUpModal.style.display = 'none';
                audioEngine.playSFX('levelup');
            };
        }
        cardsContainer.appendChild(card);
    });
};

// 5. The Main Loop
function gameLoop(time) {
    try {
        if (gameState === 'MENU') {
            renderer.drawMenuBackground(time);
        } 
        else if (gameState === 'PLAYING' || gameState === 'LEVEL_UP') {
            
            if (gameState === 'PLAYING') {
                inputManager.updateAimAngle(game.state.player.x, game.state.player.y);
                const isBreakdown = game.update(inputManager.state, canvas.width, canvas.height, gameState);
                
                // Update HUD
                const sanityBar = document.getElementById('sanity-bar');
                let ratio = game.state.sanity / game.state.player.maxHp;
                if (!Number.isFinite(ratio)) ratio = 0;
                sanityBar.style.width = Math.max(0, ratio) * 100 + '%';
                sanityBar.style.backgroundColor = isBreakdown ? 'var(--ui-red)' : 'var(--ui-gold)';
                document.getElementById('glitch-overlay').style.opacity = isBreakdown ? '1' : '0';
                document.getElementById('score').innerText = `LUCIDITY: ${game.state.lucidity} | LVL ${game.state.level}`;
            }
            
            renderer.drawGame(game.state);
        }
    } catch (e) {
        console.error("Main Loop Crash: " + e.message);
    }
    requestAnimationFrame(gameLoop);
}

// Start Engine
requestAnimationFrame(gameLoop);
console.log("FRACTURED Engine Online.");