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

// --- NEW: GLOBAL ACCESSIBILITY SETTINGS ---
let gameSettings = { screenShake: true, photosensitive: false };
try {
    const savedSettings = localStorage.getItem('fractured_settings');
    if (savedSettings) gameSettings = { ...gameSettings, ...JSON.parse(savedSettings) };
} catch(e) { console.warn("Could not load settings."); }

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

    // --- NEW: SETTINGS MENU INJECTION (THEME ALIGNED) ---
    if (!document.getElementById('settings-modal')) {
        // The Settings Modal
        const settingsUI = document.createElement('div');
        settingsUI.id = 'settings-modal';
        settingsUI.className = 'fullscreen-menu';
        settingsUI.style.display = 'none';
        settingsUI.style.zIndex = '10000';
        settingsUI.innerHTML = `
            <div class="medical-folder" style="height: auto; max-width: 500px; border-color: var(--ink-black);">
                <div class="folder-header" style="justify-content: center; border-bottom-color: var(--ink-black);">
                    <div class="title-typewriter" style="font-size: 2rem;">SYSTEM SETTINGS</div>
                </div>
                <div class="folder-content" style="display: flex; flex-direction: column; gap: 20px; align-items: flex-start;">
                    <label style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="toggle-shake" style="width: 20px; height: 20px; cursor: pointer;"> 
                        Enable Screen Shake
                    </label>
                    <p class="typewriter-text" style="color: #666; font-size: 0.9rem; margin-top: -15px; margin-left: 30px;">Toggle visual impact vibrations.</p>
                    
                    <label style="color: var(--ink-black); font-weight: bold; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; gap: 10px;">
                        <input type="checkbox" id="toggle-photo" style="width: 20px; height: 20px; cursor: pointer;"> 
                        Photosensitivity Mode
                    </label>
                    <p class="typewriter-text" style="color: #666; font-size: 0.9rem; margin-top: -15px; margin-left: 30px;">Disables strobing lights, camera flashes, and softens glitch overlays.</p>
                    
                    <button class="file-btn primary" id="btn-close-settings" style="margin-top: 20px;">APPLY & CLOSE</button>
                </div>
            </div>
        `;
        document.getElementById('game-container').appendChild(settingsUI);

        // Inject Settings Button into Pause Menu
        const pauseBtnContainer = document.getElementById('btn-awaken').parentNode;
        if (pauseBtnContainer && !document.getElementById('btn-pause-settings')) {
            const pauseSettingsBtn = document.createElement('button');
            pauseSettingsBtn.id = 'btn-pause-settings';
            pauseSettingsBtn.className = 'file-btn';
            pauseSettingsBtn.innerText = 'SYSTEM SETTINGS';
            pauseBtnContainer.appendChild(pauseSettingsBtn);
            
            pauseSettingsBtn.addEventListener('click', () => {
                settingsUI.style.display = 'flex';
            });
        }

        // Inject Settings Button into Main Menu (Clinical Folder)
        const clinicalBtnContainer = document.getElementById('btn-start').parentNode;
        if (clinicalBtnContainer && !document.getElementById('btn-clinical-settings')) {
            const clinicalSettingsBtn = document.createElement('button');
            clinicalSettingsBtn.id = 'btn-clinical-settings';
            clinicalSettingsBtn.className = 'file-btn';
            clinicalSettingsBtn.innerText = 'SYSTEM SETTINGS';
            clinicalBtnContainer.appendChild(clinicalSettingsBtn);
            
            clinicalSettingsBtn.addEventListener('click', () => {
                settingsUI.style.display = 'flex';
            });
        }

        const toggleShake = document.getElementById('toggle-shake');
        const togglePhoto = document.getElementById('toggle-photo');
        
        toggleShake.checked = gameSettings.screenShake;
        togglePhoto.checked = gameSettings.photosensitive;

        document.getElementById('btn-close-settings').addEventListener('click', () => {
            gameSettings.screenShake = toggleShake.checked;
            gameSettings.photosensitive = togglePhoto.checked;
            try { localStorage.setItem('fractured_settings', JSON.stringify(gameSettings)); } catch(e) {}
            settingsUI.style.display = 'none';
        });

        // --- PHASE 2: HUB INTERACTION EVENT LISTENERS ---
        const interactionPrompt = document.getElementById('interaction-prompt');
        const interactionText = document.getElementById('prompt-text');
        const btnCloseFolder = document.getElementById('btn-close-folder');

        if (interactionPrompt) {
            const triggerInteraction = () => {
                if (gameState === 'HUB' && game.hubWorld && game.hubWorld.activeZone) {
                    const zone = game.hubWorld.activeZone;
                    
                    // Switch to the correct HTML tab based on which desk/bed you interacted with!
                    const tabBtns = document.querySelectorAll('.tab-btn');
                    const tabPanes = document.querySelectorAll('.tab-pane');
                    tabBtns.forEach(b => b.classList.remove('active'));
                    tabPanes.forEach(p => p.classList.remove('active'));
                    
                    const targetBtn = document.querySelector(`.tab-btn[data-target="${zone.action}"]`);
                    const targetPane = document.getElementById(zone.action);
                    
                    if (targetBtn) targetBtn.classList.add('active');
                    if (targetPane) targetPane.classList.add('active');

                    if (zone.action === 'tab-loadout' && uiManager) uiManager.renderLoadoutUI();
                    
                    document.getElementById('clinical-folder-menu').style.display = 'flex';
                    interactionPrompt.style.display = 'none';
                    if (audioEngine) audioEngine.playSFX('ui_click');
                    inputManager.hideJoysticks();
                    gameState = 'MENU';
                }
            };

            window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'e') triggerInteraction(); });
            interactionPrompt.addEventListener('click', triggerInteraction);
            interactionPrompt.addEventListener('touchstart', (e) => { e.preventDefault(); triggerInteraction(); });
        }

        if (btnCloseFolder) {
            btnCloseFolder.addEventListener('click', () => {
                document.getElementById('clinical-folder-menu').style.display = 'none';
                if (audioEngine) audioEngine.playSFX('ui_click');
                gameState = 'HUB';
            });
        }
    }

    saveManager = new SaveManager();
    inputManager = new InputManager(canvas);
    renderer = new Renderer(canvas, ctx);
    audioEngine = new AudioEngine();
    game = new Game();
    levelUpUI = new LevelUpUI(audioEngine, saveManager);

    game.audioEngine = audioEngine;

    uiManager = new UIManager(saveManager, audioEngine, () => {
        // OVERRIDE: Instead of `game.init()`, we are ALREADY loaded. Just close menu and launch!
        document.getElementById('clinical-folder-menu').style.display = 'none';
        document.getElementById('ui-layer').style.display = 'flex';
        gameState = 'PLAYING';
        
        const devSelect = document.getElementById('dev-floor-select');
        if (devSelect && devSelect.value !== "1") {
            const chosenFloor = parseInt(devSelect.value);
            game.init(saveManager); // Re-initialize to lock in floor scalings properly
            game.state.floor = chosenFloor;
            game.state.maxConvergence = Math.floor(100 * Math.pow(1.3, chosenFloor - 1));
            game.state.xp += (chosenFloor - 1) * 1500; 
            console.log(`%c DEV OVERRIDE: Starting on Floor ${chosenFloor}. Free XP granted. `, 'background: #c5a059; color: #000;');
            
            if (chosenFloor > saveManager.metaState.maxFloorReached) {
                saveManager.metaState.maxFloorReached = chosenFloor;
                saveManager.saveGame();
            }
        }

        // Re-center player for the actual run
        game.state.player.x = canvas.width / 2;
        game.state.player.y = canvas.height / 2;
        game.state.mapOriginX = game.state.player.x;
        game.state.mapOriginY = game.state.player.y;
        
        if (audioEngine) audioEngine.stopMenuTheme(); 
        const resumeBtn = document.getElementById('btn-resume-run');
        if (resumeBtn) resumeBtn.style.display = 'none'; 
    });

    game.init(saveManager); // Initialize everything silently in the background

    const resumeBtn = document.getElementById('btn-resume-run');
    if (resumeBtn) {
        resumeBtn.addEventListener('click', () => {
            const savedRun = localStorage.getItem('fractured_suspended_run');
            if (savedRun) {
                const carriedData = JSON.parse(savedRun);
                game.init(saveManager, carriedData);
                game.state.player.x = canvas.width / 2;
                game.state.player.y = canvas.height / 2;
                game.state.mapOriginX = game.state.player.x;
                game.state.mapOriginY = game.state.player.y;
                
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
        game.init(saveManager); 
        game.state.player.x = 0; 
        game.state.player.y = 0;
        if (audioEngine) audioEngine.playMenuTheme(); 
        gameState = 'HUB'; 
    });
    
    // --- PHASE 2: INITIALIZE BUTTON GOES TO HUB ---
    const btnEnterSystem = document.getElementById('btn-enter-system');
    if (btnEnterSystem) {
        const newBtn = btnEnterSystem.cloneNode(true);
        btnEnterSystem.parentNode.replaceChild(newBtn, btnEnterSystem);
        newBtn.addEventListener('click', () => {
            if (audioEngine) {
                audioEngine.init(); 
                audioEngine.playMenuTheme(); 
            }
            document.getElementById('title-screen').style.display = 'none';
            game.init(saveManager);
            game.state.player.x = 0; 
            game.state.player.y = 0;
            gameState = 'HUB';
        });
    }

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
        const isMidFloor = (gameState === 'PAUSED'); 
        const isExitReached = (gameState === 'EXIT_REACHED'); 
        
        let earnedLucidity = 0;
        let retainedTokens = [];
        
        if (isExitReached) {
            earnedLucidity = game.state.lucidity;
            retainedTokens = game.state.runInventory || [];
            saveManager.addLucidity(earnedLucidity);
            
            if (retainedTokens.length > 0) {
                const tokenKeys = Object.keys(TOKENS);
                retainedTokens = retainedTokens.map(rarity => {
                    const randomTokenKey = tokenKeys[Math.floor(Math.random() * tokenKeys.length)];
                    saveManager.addTokenToInventory(randomTokenKey, rarity);
                    return { name: TOKENS[randomTokenKey].name, rarity: rarity };
                });
            }
        }

        let tokenHtml = "";
        if (retainedTokens.length > 0) {
             tokenHtml = `<br><br><span style="color:var(--ui-gold);">DECRYPTED TOKENS:</span><br>` + 
                        retainedTokens.map(t => `<span class="rarity-${t.rarity}">${t.name} (${t.rarity})</span>`).join('<br>');
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

        if (isExitReached) {
            if (folder) folder.style.borderColor = 'var(--ui-gold)';
            if (header) header.style.borderBottomColor = 'var(--ui-gold)';
            if (title) {
                title.style.color = 'var(--ui-gold)';
                title.innerText = 'CONSCIOUSNESS RETAINED';
            }
            if (btn) btn.innerText = 'REVIEW CLINICAL FILE';

            document.getElementById('final-stats').innerHTML = `
                Safely extracted from <strong>Floor ${game.state.floor}</strong>.<br><br>
                Earned <strong>${earnedLucidity}</strong> Lucidity.<br>
                Retained <strong>100%</strong> of gathered resources.<br>
                Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
                ${tokenHtml}
            `;
        } else {
            if (folder) folder.style.borderColor = 'var(--ui-red)';
            if (header) header.style.borderBottomColor = 'var(--ui-red)';
            if (title) {
                title.style.color = 'var(--ui-red)';
                title.innerText = 'PROTOCOL ABORTED';
            }
            if (btn) btn.innerText = 'RETURN TO WARD';

            document.getElementById('final-stats').innerHTML = `
                Cowardice detected on <strong>Floor ${game.state.floor}</strong>.<br><br>
                Earned <strong>0</strong> Lucidity (Aborted).<br>
                Retained <strong>0%</strong> of gathered resources.<br>
                Total Banked: <strong>${saveManager.metaState.lucidityBank}</strong>
            `;
        }

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
            devModeContainer.style.display = (gameState === 'TITLE' || gameState === 'MENU' || gameState === 'HUB') ? 'block' : 'none';
        }

        if (gameState === 'MENU' || gameState === 'TITLE') {
            renderer.drawMenuBackground(time, gameState);
        } 
        else if (gameState === 'PLAYING' || gameState === 'LEVEL_UP' || gameState === 'PAUSED' || gameState === 'EXIT_REACHED' || gameState === 'HUB') {
            
            inputManager.updateAimAngle(game.state.player.x, game.state.player.y);
            const isBreakdown = game.update(inputManager.state, canvas.width, canvas.height, gameState);
            
            // --- PHASE 2: HUB INTERACTION & PLAYER ROTATION ---
            if (gameState === 'HUB') {
                if (game.hubWorld) {
                    const interactionPrompt = document.getElementById('interaction-prompt');
                    const promptText = document.getElementById('prompt-text');
                    if (game.hubWorld.activeZone) {
                        interactionPrompt.style.display = 'block';
                        promptText.innerText = game.hubWorld.activeZone.prompt;
                        interactionPrompt.style.borderColor = game.hubWorld.activeZone.color;
                        interactionPrompt.style.color = game.hubWorld.activeZone.color;
                    } else {
                        interactionPrompt.style.display = 'none';
                    }
                }
                
                // Unify player rotation inside the Hub World based on mouse aim angle
                if (game.state && game.state.player) {
                    let diff = inputManager.state.aimAngle - game.state.player.angle;
                    if (Number.isFinite(diff)) {
                        while (diff < -Math.PI) diff += Math.PI * 2;
                        while (diff > Math.PI) diff -= Math.PI * 2;
                        game.state.player.angle += diff * 0.25;
                    }
                }
            }

            if (gameState === 'PLAYING') {
                // --- APPLY ACCESSIBILITY CLAMPS BEFORE RENDERING ---
                if (game.state) {
                    if (!gameSettings.screenShake && game.state.cameraShake > 0) {
                        game.state.cameraShake = 0; // Hard clamp shake
                    }
                    if (gameSettings.photosensitive) {
                        game.state.cameraFlash = 0; // Disable full screen strobes (e.g. Polaroid)
                        if (game.state.player) game.state.player.flashTime = 0; // Disable player hit flashing
                        if (game.state.entities) {
                            game.state.entities.forEach(e => e.flashTime = 0); // Disable enemy hit flashing
                        }
                    }
                }

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

                // Smoothly dim glitch overlay if photosensitive mode is active
                let targetGlitchOpacity = isBreakdown ? '1' : '0';
                if (isBreakdown && gameSettings.photosensitive) targetGlitchOpacity = '0.3'; 
                document.getElementById('glitch-overlay').style.opacity = targetGlitchOpacity;
                
                document.getElementById('score').innerHTML = `LUCIDITY: ${game.state.lucidity} <br> FLOOR: ${game.state.floor}`;
            }
            
            // Send the gameState so the renderer knows to bypass the Void code!
            renderer.drawGame(game.state, audioEngine, gameState);
        }
    } catch (e) {
        console.error("Main Loop Crash: " + e.message);
    }
    requestAnimationFrame(gameLoop);
}

initEngine();
console.log("FRACTURED Engine Online.");