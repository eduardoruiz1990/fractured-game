import './style.css';
import { SaveManager } from './core/SaveManager.js';
import { UIManager } from './ui/UIManager.js';
import { InputManager } from './core/Input.js';
import { Renderer } from './core/Renderer.js';
import { AudioEngine } from './core/AudioEngine.js';
import { Game } from './core/Game.js';
import { LevelUpUI } from './ui/LevelUpUI.js';
import { TOKENS } from './data/Manifestations.js';

console.log("FRACTURED Engine Bootstrapping...");

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

let saveManager, inputManager, renderer, audioEngine, game, levelUpUI, uiManager;
let gameState = 'TITLE'; 

function initEngine() {
    if (!document.getElementById('dev-floor-select')) {
        const devUI = document.createElement('div');
        devUI.id = 'dev-mode-container';
        devUI.style.cssText = "position:absolute; bottom:10px; left:10px; z-index:9999; background:rgba(0,0,0,0.8); border:1px solid var(--ui-gold); padding:8px; color:var(--ui-gold); font-family:monospace; font-size:12px;";
        devUI.innerHTML = `
            DEV OVERRIDE - STARTING FLOOR: 
            <select id="dev-floor-select" style="background:#111; color:var(--ui-gold); border:1px solid #333; outline:none; font-family:inherit; margin-left:10px; padding:2px;">
                <option value="1">1 - SPHERE HEAD</option>
                <option value="2">2 - RORSCHACH</option>
                <option value="3">3 - PANOPTICON</option>
                <option value="4">4 - AMALGAMATION</option>
                <option value="5" selected>5 - ARCHITECT</option>
            </select>
        `;
        document.getElementById('game-container').appendChild(devUI);
    }

    saveManager = new SaveManager();
    inputManager = new InputManager(canvas);
    renderer = new Renderer(canvas, ctx);
    audioEngine = new AudioEngine();
    game = new Game();
    levelUpUI = new LevelUpUI(audioEngine, saveManager);

    game.audioEngine = audioEngine;

    uiManager = new UIManager(saveManager, audioEngine, () => {
        game.init(saveManager);
        
        const devSelect = document.getElementById('dev-floor-select');
        if (devSelect && devSelect.value !== "1") {
            const chosenFloor = parseInt(devSelect.value);
            game.state.floor = chosenFloor;
            game.state.maxConvergence = Math.floor(100 * Math.pow(1.3, chosenFloor - 1));
            game.state.xp += (chosenFloor - 1) * 1500; 
            console.log(`%c DEV OVERRIDE: Starting on Floor ${chosenFloor}. Free XP granted. `, 'background: #c5a059; color: #000;');
            
            if (chosenFloor > saveManager.metaState.maxFloorReached) {
                saveManager.metaState.maxFloorReached = chosenFloor;
                saveManager.saveGame();
            }
        }

        game.state.player.x = canvas.width / 2;
        game.state.player.y = canvas.height / 2;
        
        if (audioEngine) audioEngine.stopMenuTheme(); 
        
        gameState = 'PLAYING';
        const resumeBtn = document.getElementById('btn-resume-run');
        if (resumeBtn) resumeBtn.style.display = 'none'; 
    });

    const resumeBtn = document.getElementById('btn-resume-run');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            const savedRun = localStorage.getItem('fractured_suspended_run');
            if (savedRun) {
                const carriedData = JSON.parse(savedRun);
                game.init(saveManager, carriedData);
                game.state.player.x = canvas.width / 2;
                game.state.player.y = canvas.height / 2;
                
                if (audioEngine) audioEngine.stopMenuTheme();

                document.getElementById('clinical-folder-menu').style.display = 'none';
                document.getElementById('ui-layer').style.display = 'flex';
                resumeBtn.style.display = 'none';
                localStorage.removeItem('fractured_suspended_run'); 
                gameState = 'PLAYING';
            }
        });
    }

    if (localStorage.getItem('fractured_suspended_run') && resumeBtn) {
        resumeBtn.style.display = 'block';
    }

    document.getElementById('btn-restart').addEventListener('click', () => {
        document.getElementById('death-screen').style.display = 'none';
        document.getElementById('clinical-folder-menu').style.display = 'flex';
        uiManager.updateMenuUI();
        if (audioEngine) audioEngine.playMenuTheme(); 
        gameState = 'MENU'; 
    });

    const pauseMenu = document.getElementById('pause-menu');
    const pauseTitle = document.getElementById('pause-title');
    const btnDescend = document.getElementById('btn-descend');

    function togglePause() {
        if (gameState === 'PLAYING') {
            gameState = 'PAUSED';
            pauseTitle.innerText = "PROTOCOL SUSPENDED";
            pauseTitle.style.color = "var(--ink-black)";
            document.getElementById('pause-desc').innerText = "The nightmare pauses, but it does not end.";
            btnDescend.style.display = 'none';
            pauseMenu.style.display = 'flex';
            inputManager.hideJoysticks();
        } else if (gameState === 'PAUSED') {
            gameState = 'PLAYING';
            pauseMenu.style.display = 'none';
        }
    }

    document.getElementById('btn-pause').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') togglePause(); });
    document.getElementById('btn-unpause').addEventListener('click', togglePause);

    document.getElementById('btn-awaken').addEventListener('click', () => {
        saveManager.addLucidity(game.state.lucidity);
        
        let tokenHtml = "";
        if (game.state.runInventory && game.state.runInventory.length > 0) {
            const tokenKeys = Object.keys(TOKENS);
            const decrypted = game.state.runInventory.map(rarity => {
                const randomTokenKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
                saveManager.addTokenToInventory(randomTokenKey, rarity);
                return { name: TOKENS[randomTokenKey].name, rarity: rarity };
            });
            tokenHtml = `<br><br><span style="color:var(--ui-gold);">DECRYPTED TOKENS:</span><br>` + 
                        decrypted.map(t => `<span class="rarity-${t.rarity}">${t.name} (${t.rarity})</span>`).join('<br>');
            game.state.runInventory = []; 
        }

        localStorage.removeItem('fractured_suspended_run');
        if (resumeBtn) resumeBtn.style.display = 'none';

        pauseMenu.style.display = 'none';
        document.getElementById('ui-layer').style.display = 'none';
        document.getElementById('death-screen').style.display = 'flex';
        
        const deathScreen = document.getElementById('death-screen');
        const folder = deathScreen.querySelector('.medical-folder');
        const header = deathScreen.querySelector('.folder-header');
        const title = deathScreen.querySelector('.title-typewriter');
        const btn = document.getElementById('btn-restart');

        if (folder) folder.style.borderColor = 'var(--ui-gold)';
        if (header) header.style.borderBottomColor = 'var(--ui-gold)';
        if (title) {
            title.style.color = 'var(--ui-gold)';
            title.innerText = 'CONSCIOUSNESS RETAINED';
        }
        if (btn) btn.innerText = 'REVIEW CLINICAL FILE';

        document.getElementById('final-stats').innerHTML = `
            Safely extracted from <strong>Floor ${game.state.floor}</strong>.<br><br>
            Earned <strong>${game.state.lucidity}</strong> Lucidity.<br>
            Retained <strong>100%</strong> of gathered resources.<br>
            Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
            ${tokenHtml}
        `;

        inputManager.hideJoysticks();
        if (audioEngine) audioEngine.stop();
        gameState = 'DEAD'; 
    });

    document.getElementById('btn-descend').addEventListener('click', () => {
        const carryData = game.getCarriedState();
        carryData.floor += 1; 

        if (carryData.floor > saveManager.metaState.maxFloorReached) {
            saveManager.metaState.maxFloorReached = carryData.floor;
            saveManager.saveGame();
        }

        game.init(saveManager, carryData);
        game.state.player.x = canvas.width / 2;
        game.state.player.y = canvas.height / 2;
        pauseMenu.style.display = 'none';
        gameState = 'PLAYING';
    });

    game.onDeath = () => {
        gameState = 'DEAD';
        document.getElementById('ui-layer').style.display = 'none';
        document.getElementById('death-screen').style.display = 'flex';
        document.getElementById('glitch-overlay').style.opacity = '0';
        
        const recovered = Math.floor(game.state.lucidity * 0.5);
        saveManager.addLucidity(recovered);
        if (audioEngine) audioEngine.stop(); 

        let tokenHtml = "";
        if (game.state.runInventory && game.state.runInventory.length > 0) {
            const tokenKeys = Object.keys(TOKENS);
            const decrypted = game.state.runInventory.map(rarity => {
                const randomTokenKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
                saveManager.addTokenToInventory(randomTokenKey, rarity);
                return { name: TOKENS[randomTokenKey].name, rarity: rarity };
            });
            tokenHtml = `<br><br><span style="color:var(--ui-gold);">DECRYPTED TOKENS:</span><br>` + 
                        decrypted.map(t => `<span class="rarity-${t.rarity}">${t.name} (${t.rarity})</span>`).join('<br>');
            game.state.runInventory = []; 
        }

        const deathScreen = document.getElementById('death-screen');
        const folder = deathScreen.querySelector('.medical-folder');
        const header = deathScreen.querySelector('.folder-header');
        const title = deathScreen.querySelector('.title-typewriter');
        const btn = document.getElementById('btn-restart');

        if (folder) folder.style.borderColor = 'var(--ui-red)';
        if (header) header.style.borderBottomColor = 'var(--ui-red)';
        if (title) {
            title.style.color = 'var(--ui-red)';
            title.innerText = 'MIND BROKEN';
        }
        if (btn) btn.innerText = 'RECONSTRUCT FILE';

        document.getElementById('final-stats').innerHTML = `
            Died on <strong>Floor ${game.state.floor}</strong>.<br><br>
            Earned <strong>${game.state.lucidity}</strong> Lucidity.<br>
            Lost to the Void: <strong>${game.state.lucidity - recovered}</strong>.<br>
            Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
            ${tokenHtml}
        `;
        inputManager.hideJoysticks();
    };

    game.onLevelUp = () => {
        if (gameState === 'DEAD') return;
        gameState = 'LEVEL_UP';
        inputManager.keys = { w: false, a: false, s: false, d: false, space: false }; 
        inputManager.updateKeyboardInput();
        audioEngine.playSFX('levelup');
        levelUpUI.show(game, () => { gameState = 'PLAYING'; });
    };

    game.onFloorComplete = () => {
        gameState = 'EXIT_REACHED';
        pauseTitle.innerText = "THE DESCENT CALLS";
        pauseTitle.style.color = "var(--ui-red)";
        
        if (game.state.floor >= 5) {
            document.getElementById('pause-desc').innerText = `You have conquered the nightmare. The Architect has fallen.`;
            btnDescend.style.display = 'none'; // No floor 6 yet!
        } else {
            document.getElementById('pause-desc').innerText = `You survived Floor ${game.state.floor}. Awaken with your Lucidity, or risk descending deeper into the nightmare?`;
            btnDescend.style.display = 'block'; 
        }
        
        document.getElementById('btn-unpause').style.display = 'none'; 
        pauseMenu.style.display = 'flex';
        inputManager.hideJoysticks();
    };

    requestAnimationFrame(gameLoop);
}

function gameLoop(time) {
    try {
        const devModeContainer = document.getElementById('dev-mode-container');
        if (devModeContainer) {
            devModeContainer.style.display = (gameState === 'TITLE' || gameState === 'MENU') ? 'block' : 'none';
        }

        if (gameState === 'MENU' || gameState === 'TITLE') {
            renderer.drawMenuBackground(time, gameState);
        } 
        else if (gameState === 'PLAYING' || gameState === 'LEVEL_UP' || gameState === 'PAUSED' || gameState === 'EXIT_REACHED') {
            
            if (gameState === 'PLAYING') {
                inputManager.updateAimAngle(game.state.player.x, game.state.player.y);
                const isBreakdown = game.update(inputManager.state, canvas.width, canvas.height, gameState);
                
                const sanityBar = document.getElementById('sanity-bar');
                let ratio = game.state.sanity / game.state.player.maxHp;
                if (!Number.isFinite(ratio)) ratio = 0;
                sanityBar.style.width = Math.max(0, ratio) * 100 + '%';
                
                if (isBreakdown) { sanityBar.style.backgroundColor = 'var(--ui-red)'; sanityBar.style.boxShadow = '0 0 15px var(--ui-red)'; }
                else if (ratio < 0.3) { sanityBar.style.backgroundColor = '#ffaa00'; sanityBar.style.boxShadow = '0 0 10px #ffaa00'; }
                else { sanityBar.style.backgroundColor = 'var(--hud-green)'; sanityBar.style.boxShadow = '0 0 10px var(--hud-green)'; }
                
                const dashBar = document.getElementById('dash-bar');
                if (dashBar && game.state.player.dash) {
                    const dashReady = game.state.player.dash.cooldown <= 0;
                    dashBar.style.width = dashReady ? '100%' : ((1 - (game.state.player.dash.cooldown / 90)) * 100) + '%';
                    dashBar.style.background = dashReady ? '#88aaff' : '#555';
                }

                const conBar = document.getElementById('convergence-bar');
                const conText = document.getElementById('convergence-text');
                const conContainer = document.querySelector('.convergence-section');
                
                const activeBoss = game.state.entities.find(e => ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type));

                if (activeBoss) {
                    let hpRatio = Math.max(0, activeBoss.hp / activeBoss.maxHp);
                    conBar.style.width = (hpRatio * 100) + '%';
                    
                    let bossName = 'SUBJECT: SPHERE HEAD';
                    if (activeBoss.type === 'RORSCHACH') bossName = 'SUBJECT: RORSCHACH';
                    if (activeBoss.type === 'PANOPTICON') bossName = 'SUBJECT: THE PANOPTICON';
                    if (activeBoss.type === 'AMALGAMATION') bossName = 'SUBJECT: THE AMALGAMATION';
                    if (activeBoss.type === 'ARCHITECT') bossName = 'SUBJECT: THE ARCHITECT';

                    conText.innerText = `${bossName} - VITAL SIGNS: ${Math.ceil(hpRatio * 100)}%`;
                    conBar.style.background = 'linear-gradient(90deg, #8b0000, #ff0000)';
                    conText.style.color = 'var(--ui-red)';
                    conContainer.style.borderColor = 'var(--ui-red)';
                    conContainer.style.boxShadow = '0 0 20px rgba(139, 0, 0, 0.8)';
                } else if (conBar && game.state.maxConvergence) {
                    let conRatio = Math.min(1, game.state.convergence / game.state.maxConvergence);
                    conBar.style.width = (conRatio * 100) + '%';
                    conText.innerText = conRatio >= 1 ? "ANOMALY DETECTED" : `CONVERGENCE: ${Math.floor(conRatio * 100)}%`;
                    
                    if (conRatio >= 1) {
                        conBar.style.background = 'var(--ui-gold)';
                        conText.style.color = 'var(--ui-gold)';
                        conText.style.textShadow = '0 0 10px var(--ui-gold)';
                        conContainer.style.borderColor = 'var(--ui-gold)';
                        conContainer.style.boxShadow = '0 0 15px var(--ui-gold)';
                    } else {
                        conBar.style.background = 'linear-gradient(90deg, #555, #aaa)';
                        conText.style.color = 'rgba(255,255,255,0.7)';
                        conText.style.textShadow = '1px 1px 0 #000';
                        conContainer.style.borderColor = '#555';
                        conContainer.style.boxShadow = '0 0 15px rgba(0, 0, 0, 0.5)';
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

initEngine();
console.log("FRACTURED Engine Online.");