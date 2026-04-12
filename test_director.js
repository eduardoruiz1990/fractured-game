import { Game } from './src/core/Game.js';

global.document = {
    createElement: () => ({
        width: 1920, height: 1080,
        getContext: () => ({
            fillStyle: '', fillRect: () => {}, strokeStyle: '', lineWidth: 0,
            beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
            ellipse: () => {}, fill: () => {}, createPattern: () => {}, createImageData: () => ({ data: [] }),
            putImageData: () => {}, createRadialGradient: () => ({ addColorStop: () => {} }),
            createLinearGradient: () => ({ addColorStop: () => {} }), arc: () => {},
            translate: () => {}, scale: () => {}, restore: () => {}, save: () => {},
            clip: () => {}, rect: () => {}, closePath: () => {}
        })
    })
};
global.window = { addEventListener: () => {} };
global.localStorage = { getItem: () => null, setItem: () => {} };

const mockSave = {
    metaState: {
        upgrades: { hp: 0, speed: 0, light: 0 },
        killCounts: {},
        inventory: []
    }
};

const game = new Game();
game.init(mockSave);

for(let i=0; i<18000; i++) {
    game.update({ moveX:0, moveY:0, aimAngle:0, isMoving:false, isDashing:false }, 1920, 1080, 'PLAYING');
}

console.log("After 18000 frames: Entities length:", game.state.entities.length);
if (game.state.entities.length > 0) {
    console.log("Distances to player:");
    game.state.entities.forEach(e => {
        let d = Math.hypot(e.x - game.state.player.x, e.y - game.state.player.y);
        console.log(e.type, d, e.hp, e.x, e.y);
    });
}
