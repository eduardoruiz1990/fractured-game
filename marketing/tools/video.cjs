// marketing/tools/video.cjs: the gameplay frames for the preview videos.
//   node marketing/tools/video.cjs <W> <H> <framesDir> [--only shotName] [--every N]
// Needs the dev server (npx vite --port 5199 --strictPort). Then marketing/tools/encode.sh.
// Deterministic capture: the page runs on a virtual clock; each frame advances the game
// exactly 1000/30 ms (two 60 Hz sim steps) and is screenshotted. Frames: f00000.jpg ...
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const S = path.join(__dirname, '../../qa');
const W = +process.argv[2], H = +process.argv[3], OUT = process.argv[4];
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const every = process.argv.includes('--every') ? +process.argv[process.argv.indexOf('--every') + 1] : 1;
const FPS = 30;

// Shots: name, seconds, and page-side setup/tick (strings evaluated in the page).
const SHOTS = [
  { name: 'boss', sec: 4.4 },
  { name: 'swarm', sec: 3.8 },
  { name: 'chaos', sec: 4.2 },
  { name: 'finale', sec: 2.8 }
];

const pageLib = () => {
  const f = window.__fractured, g = f.game, R = f.renderer;
  const ui = f.levelUpUI;
  const lvl = (id, n) => { const w = g.state.player.weapons[id]; if (!w) return; while (w.level < n) ui.selectCard({ type: 'weapon', id }, g, () => {}); };
  const clear = () => {
    const s = g.state;
    s.entities.slice().forEach(e => { e.hp = -1; });
    s.xpDrops.length = 0; s.projectiles && (s.projectiles.length = 0); s.inkPuddles && (s.inkPuddles.length = 0);   // capture-only page: pools don't matter
  };
  const ring = (n, r0, r1, types) => {
    const s = g.state, px = s.player.x, py = s.player.y;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const e = g.director.spawnEntity(types[i % types.length], null, null, px + Math.cos(a) * r, py + Math.sin(a) * r);
      if (e) { e.x = px + Math.cos(a) * r; e.y = py + Math.sin(a) * r; }
    }
  };
  const count = () => g.state.entities.filter(e => !['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT'].includes(e.type)).length;
  const input = (mx, my) => { const st = f.inputManager.state; st.moveX = mx; st.moveY = my; st.isMoving = !!(mx || my); st.aimHeld = false; st.isDashing = false; };
  window.__shots = {
    swarm: {
      setup() {
        const s = g.state; s.floor = 2; clear();
        lvl('flashlight', 4); lvl('static', 3); lvl('fidget_spinner', 3);
        ring(52, 150, 430, ['SCAVENGER', 'SCAVENGER', 'PREDATOR', 'SPLITTER']);
        window.__zoom = 2.5 * window.__zk;
      },
      tick(i) {
        const a = i * 0.018; input(Math.cos(a), Math.sin(a) * 0.6);
        if (i % 3 === 0 && count() < 56) ring(3, 330, 460, ['SCAVENGER', 'PREDATOR', 'SPLITTER']);
      }
    },
    chaos: {
      setup() {
        const s = g.state; s.floor = 4; clear();
        lvl('flashlight', 5); lvl('static', 5); lvl('fidget_spinner', 5); lvl('broken_chalk', 4); lvl('polaroid_camera', 4); lvl('spilled_ink', 4);
        ['metronome', 'pill_bottle', 'lullaby', 'straitjacket'].forEach(id => lvl(id, 4));
        ring(58, 160, 480, ['SCAVENGER', 'PREDATOR', 'PARASITE', 'BURROWER', 'WARDEN', 'SCAVENGER']);
        window.__zoom = 2.1 * window.__zk;
      },
      tick(i) {
        const a = -i * 0.022; input(Math.cos(a) * 0.9, Math.sin(a) * 0.9);
        if (i % 3 === 0 && count() < 60) ring(4, 380, 520, ['SCAVENGER', 'PREDATOR', 'PARASITE', 'BURROWER']);
      }
    },
    boss: {
      setup() {
        const s = g.state; s.floor = 3; clear();
        ['metronome', 'pill_bottle', 'lullaby', 'straitjacket', 'broken_chalk', 'polaroid_camera', 'spilled_ink'].forEach(id => { const w = s.player.weapons[id]; if (w) { w.level = 0; } });
        lvl('flashlight', 5); lvl('static', 4); lvl('fidget_spinner', 4);
        const b = g.director.spawnEntity('PANOPTICON', null, null, s.player.x + 270, s.player.y - 110);
        if (b) { b.x = s.player.x + 270; b.y = s.player.y - 110; }
        window.__boss = b;
        ring(14, 260, 520, ['SCAVENGER', 'PREDATOR']);
        window.__zoom = 1.75 * window.__zk;
      },
      tick(i, n) {
        const s = g.state, b = window.__boss;
        // circle-strafe the boss at ~330px
        if (b && b.hp > 0) {
          const dx = s.player.x - b.x, dy = s.player.y - b.y, d = Math.hypot(dx, dy) || 1;
          const tx = -dy / d, ty = dx / d, pull = (d - 280) / 280;
          input(tx - dx / d * pull, ty - dy / d * pull);
          if (b.hp < b.maxHp * 0.5) b.hp = b.maxHp * 0.5;   // alive for this shot; it dies in the finale
        } else input(0, 0);
        if (i % 20 === 0 && count() < 16) ring(2, 420, 520, ['SCAVENGER', 'PREDATOR']);
      }
    },
    finale: {
      setup() {
        const s = g.state; s.floor = 3; clear();
        ['metronome', 'pill_bottle', 'lullaby', 'straitjacket', 'broken_chalk', 'polaroid_camera', 'spilled_ink'].forEach(id => { const w = s.player.weapons[id]; if (w) { w.level = 0; } });
        lvl('flashlight', 5); lvl('static', 4); lvl('fidget_spinner', 4);
        const b = g.director.spawnEntity('PANOPTICON', null, null, s.player.x + 200, s.player.y - 70);
        if (b) { b.x = s.player.x + 200; b.y = s.player.y - 70; b.hp = b.maxHp * 0.15; }
        window.__boss = b;
        ring(26, 170, 420, ['SCAVENGER', 'PREDATOR', 'SPLITTER']);
        window.__zoom = 1.9 * window.__zk;
      },
      tick(i) {
        const b = window.__boss;
        input(i < 12 ? 0.35 : 0, i < 12 ? -0.2 : 0);
        if (b && i === 12) b.hp = -1;   // Combat's death branch runs next step: freeze, slow-mo, burst
      }
    }
  };
  window.__keep = () => {
    const s = g.state;
    s.sanity = s.player.maxHp; s.xp = 0; s.subtitle = null; s.cameraShake = Math.min(s.cameraShake, 6);
    R.zoom = window.__zoom || 1.4; R.cameraCenterX = innerWidth / 2; R.cameraCenterY = innerHeight / 2;
    g.autoAimOn = true;
    if (s.interactables) for (let k = s.interactables.length - 1; k >= 0; k--) if (s.interactables[k].type !== 'CHEST') s.interactables.splice(k, 1);
  };
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.addInitScript(() => {
    const realRAF = window.requestAnimationFrame.bind(window), realNow = performance.now.bind(performance);
    let manual = false, vnow = 0; const q = [];
    window.requestAnimationFrame = cb => { if (manual) { q.push(cb); return q.length; } return realRAF(t => cb(manual ? vnow : t)); };
    performance.now = () => (manual ? vnow : realNow());
    window.__vt = {
      start() { vnow = realNow(); manual = true; },
      step(ms) { vnow += ms; const l = q.splice(0); for (const cb of l) { try { cb(vnow); } catch (e) { console.error(e); } } }
    };
  });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const f = window.__fractured; const m = f.saveManager.metaState; m.tutorialCompleted = true; m.story.coldOpenSeen = true; f.setQuality('high'); });
  await page.click('#btn-title-begin');
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: 'body > *:not(#game-container), #game-container > *:not(canvas), #crt-scanlines, #perf-overlay { display: none !important; } canvas { cursor: none !important; }' });
  await page.evaluate(pageLib);
  await page.evaluate(() => {
    const f = window.__fractured, g = f.game, R = f.renderer;
    g.onLevelUp = null;                 // no level-up cards mid-shot (the perf benchmark's trick)
    R.filmGrainEnabled = false;         // grain fights the video encoder
    R.drawDamageText = () => {};        // numbers clutter a 20 s preview
    // Trailer exposure: the darkness at 78% instead of 100%, so the room reads on a
    // small thumbnail; the flashlight still cuts it. Nothing else about the frame changes.
    const atm = R.getAtmosphere.bind(R);
    R.getAtmosphere = fl => { const a = atm(fl); const h = a.dark.replace('#', ''); const v = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      return Object.assign({}, a, { dark: 'rgba(' + v.join(',') + ',' + (window.__dark || 0.62) + ')' }); };
    // a portrait preview is watched small on a phone: 30% closer than the landscape framing
    window.__zk = Math.min(innerWidth, innerHeight * 16 / 9) / 1920 * (innerHeight > innerWidth ? 1.3 : 1.0) || 1;
    g.state.isTutorial = false; g.state.roomModifier = null; g.state.roomEvent = null;
    g.state.sanity = g.state.player.maxHp = 400;
    g.state.enemyBudget = 0;
    window.__vt.start();
  });
  let frame = 0;
  for (const shot of SHOTS) {
    const n = Math.round(shot.sec * FPS);
    if (only && shot.name !== only) continue;
    await page.evaluate(name => { window.__shots[name].setup(); window.__keep(); }, shot.name);
    // settle a few frames so the new floor/pools are drawn before recording
    for (let k = 0; k < 8; k++) await page.evaluate(i => { window.__keep(); window.__vt.step(1000 / 30); }, k);
    for (let i = 0; i < n; i++) {
      await page.evaluate(({ name, i, n }) => { window.__keep(); window.__shots[name].tick(i, n); window.__keep(); window.__vt.step(1000 / 30); }, { name: shot.name, i, n });
      if (i % every === 0) await page.screenshot({ path: path.join(OUT, `f${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 94 });
      frame++;
    }
    console.log(shot.name, 'done', frame);
  }
  console.log('frames', frame, 'errors', errs.slice(0, 5));
  await b.close();
})();
