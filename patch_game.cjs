const fs = require('fs');
let content = fs.readFileSync('src/core/Game.js', 'utf-8');

// 1. Remove rogue Q key
content = content.replace(/window\.addEventListener\('keydown', \(e\) => {[\s\S]*?if \(this\.audioEngine\).*?\n\s*}\n\s*}\);\n/m, '');

// 2. Add isDashing to currentInput
content = content.replace(
    /const currentInput = {\s*moveX: inputState\.moveX,\s*moveY: inputState\.moveY,\s*aimAngle: inputState\.aimAngle,\s*isMoving: inputState\.isMoving\s*};/m,
    `const currentInput = {
            moveX: inputState.moveX,
            moveY: inputState.moveY,
            aimAngle: inputState.aimAngle,
            isMoving: inputState.isMoving,
            isDashing: inputState.isDashing
        };`
);

// 3. Add spawnWave and ent.update
content = content.replace(
    /Combat\.resolveWeapons\(this\);\s*Combat\.collectXP\(this\);/m,
    `if (this.director && typeof this.director.spawnWave === 'function') {
            this.director.spawnWave(canvasWidth, canvasHeight);
        }
        
        for (let i = this.state.entities.length - 1; i >= 0; i--) {
            let ent = this.state.entities[i];
            if (typeof ent.update === 'function') {
                ent.update(this.state, this);
            }
        }

        Combat.resolveWeapons(this);
        Combat.collectXP(this);`
);

fs.writeFileSync('src/core/Game.js', content);
