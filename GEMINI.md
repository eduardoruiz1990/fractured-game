# FRACTURED: AI Developer Guidelines

## 1. Role & Tone
Act as a Senior Game Developer. Your code must be production-ready, highly optimized for HTML5 Canvas (60 FPS), and heavily defensively programmed. 

## 2. Core Architecture
* **Stack:** Vanilla JavaScript (ES6 Modules), HTML5 Canvas API, Web Audio API, Vite.
* **State Machine:** `Game.js` holds the master `state` object. `Renderer.js` handles all drawing. `Director.js` handles entity spawning and memory pooling. `Combat.js` resolves physics/damage.
* **Separation of Concerns:** Do NOT mix UI DOM manipulation with Canvas rendering. HTML/CSS is for menus (`UIManager.js`); Canvas is strictly for the game world.

## 3. The Golden Rules of Rendering (CRITICAL)
* **No `shadowBlur`:** HTML5 Canvas `shadowBlur` destroys CPU performance on complex shapes. NEVER use it for game entities or frequent draw loops. Use Faux-Glows (radial gradients with low alpha) instead.
* **State Hygiene:** If you change `ctx.globalCompositeOperation` (e.g., to `screen` or `destination-out`), you MUST reset it to `source-over` before the function ends. Failure to do so turns the player invisible.
* **Static Caching:** For complex, static background elements (like the Hub World floor), draw them ONCE to an off-screen canvas (`document.createElement('canvas')`) during initialization, and use `ctx.drawImage()` in the main render loop.

## 4. Memory Management & Object Pooling
* **No Array Splicing for Entities:** NEVER use `array.splice()` to delete particles, projectiles, or floating text directly inside `Game.js`. 
* **Strict Pooling:** All temporary visual entities MUST be returned to memory using the `ObjectPool.js` architecture (e.g., `this.director.pools.particle.release(p)`). Call `this.director.updateParticles()` to handle lifecycle management safely.

## 5. Save Data & Math Safety (NaN Prevention)
* **Defensive Fallbacks:** When reading from `SaveManager.js`, ALWAYS provide mathematical fallbacks (e.g., `const speed = meta.upgrades.speed || 0;`). 
* **Canvas Math:** Passing `undefined` or `NaN` into Canvas functions (like `createRadialGradient` or `arc`) will instantly crash the rendering loop with a `DOMException`. Always validate radii and angles with `Number.isFinite()`.

## 6. Input Architecture
* **Centralization:** All input (Keyboard WASD, Arrows, Spacebar, Mouse, and Virtual Mobile Joysticks/Buttons) MUST be routed through `Input.js`. 
* **No Rogue Listeners:** Do not scatter `window.addEventListener('keydown')` calls inside `Game.js` or entity classes. Read from the centralized `this.state.input` object.