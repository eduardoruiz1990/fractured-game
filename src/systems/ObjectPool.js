// src/systems/ObjectPool.js
// Pre-allocates memory for objects to prevent Garbage Collection stutters.
export class ObjectPool {
    constructor(createFunc, initialSize = 50) {
        this.createFunc = createFunc;
        this.pool = [];
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.createFunc());
        }
    }

    get() {
        if (this.pool.length > 0) {
            return this.pool.pop();
        }
        // Fallback: If we run out of pooled objects (e.g. insane difficulty), create a new one to prevent a crash
        return this.createFunc();
    }

    release(item) {
        this.pool.push(item);
    }
}