// src/ui/UIManager.js
// Master controller for DOM manipulation and screen transitions.
export class UIManager {
    constructor(saveManager, onStartGameCallback) {
        this.saveManager = saveManager;
        this.onStartGameCallback = onStartGameCallback;
        
        this.bindElements();
        this.attachEvents();
        this.updateMenuUI();
    }

    bindElements() {
        // Screens
        this.mainMenu = document.getElementById('main-menu');
        this.synapseTree = document.getElementById('synapse-tree');
        this.uiLayer = document.getElementById('ui-layer');
        this.deathScreen = document.getElementById('death-screen');
        
        // Buttons
        this.btnStart = document.getElementById('btn-start');
        this.btnTree = document.getElementById('btn-tree');
        this.btnCloseTree = document.getElementById('btn-close-tree');
        
        // Upgrade Buttons
        this.btnUpgHp = document.getElementById('btn-upg-hp');
        this.btnUpgSpeed = document.getElementById('btn-upg-speed');
        this.btnUpgLight = document.getElementById('btn-upg-light');
    }

    attachEvents() {
        // Main Menu
        this.btnStart.addEventListener('click', () => {
            this.mainMenu.style.display = 'none';
            this.uiLayer.style.display = 'flex';
            if (this.onStartGameCallback) this.onStartGameCallback();
        });

        this.btnTree.addEventListener('click', () => {
            this.mainMenu.style.display = 'none';
            this.synapseTree.style.display = 'flex';
            this.updateMenuUI();
        });

        this.btnCloseTree.addEventListener('click', () => {
            this.synapseTree.style.display = 'none';
            this.mainMenu.style.display = 'flex';
            this.updateMenuUI();
        });

        // Upgrade Purchases
        this.btnUpgHp.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('hp', 50)) this.updateMenuUI();
        });
        this.btnUpgSpeed.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('speed', 75)) this.updateMenuUI();
        });
        this.btnUpgLight.addEventListener('click', () => {
            if (this.saveManager.buyUpgrade('light', 100)) this.updateMenuUI();
        });
    }

    updateMenuUI() {
        const meta = this.saveManager.metaState;
        
        document.getElementById('menu-banked-lucidity').innerText = meta.lucidityBank;
        document.getElementById('tree-lucidity').innerText = meta.lucidityBank;
        
        const upgradeStats = [
            { id: 'hp', baseCost: 50, element: this.btnUpgHp },
            { id: 'speed', baseCost: 75, element: this.btnUpgSpeed },
            { id: 'light', baseCost: 100, element: this.btnUpgLight }
        ];

        upgradeStats.forEach(stat => {
            const currentLvl = meta.upgrades[stat.id];
            document.getElementById(`upg-${stat.id}-lvl`).innerText = currentLvl;
            
            const cost = stat.baseCost + (currentLvl * 25);
            stat.element.innerText = `${cost} L`;
            
            const canAfford = meta.lucidityBank >= cost;
            const isMaxed = currentLvl >= 5;
            
            stat.element.disabled = !canAfford || isMaxed;
            
            if (isMaxed) {
                stat.element.innerText = "MAX";
            }
        });
    }
}