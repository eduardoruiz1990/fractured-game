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
            const item = this.pool.pop();
            item.__inPool = false;
            return item;
        }
        // Fallback: If we run out of pooled objects (e.g. insane difficulty), create a new one to prevent a crash
        return this.createFunc();
    }

    // Patch 116 (V2 plan B8): a double release used to push the same object twice, so
    // two later get() calls would hand ONE object to two owners — two enemies sharing
    // a body, a particle drawn twice. The marker makes a second release a no-op.
    release(item) {
        if (!item || item.__inPool === true) return;
        item.__inPool = true;
        this.pool.push(item);
    }
}