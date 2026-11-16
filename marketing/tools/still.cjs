// marketing/tools/still.cjs: one frozen frame of the real game, for the cover layers.
//   node marketing/tools/still.cjs <W> <H> <out.png> '<scene json>'
// Needs the dev server (npx vite --port 5199 --strictPort). Scene keys: boss, bossDx/bossDy,
// zoom, floor, crowd, ring [r0,r1], mobs[], plain, angle, lights, fog, noPlayer, noCone,
// noVignette, noGrain, blackFloor, camX/camY, freeze, wait. The layer recipes are in
// marketing/README.md.
const { chromium } = require('playwright');
const S = require('path').join(__dirname, '../../qa');
const W = +process.argv[2], H = +process.argv[3], out = process.argv[4];
const scene = Object.assign({ boss: 'PANOPTICON', bossDx: 0, bossDy: -260, zoom: 2.2, floor: 3, crowd: 26, ring: [260, 520], angle: -Math.PI / 2, fl: 0, lights: true, fog: true, wait: 1500, freeze: true, camDx: 0, camDy: -120 }, JSON.parse(process.argv[5] || '{}'));
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: W, height: H } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
  await page.evaluate(() => { const f = window.__fractured; const m = f.saveManager.metaState; m.tutorialCompleted = true; m.story.coldOpenSeen = true; f.setQuality('high'); });
  await page.click('#btn-title-begin'); await page.waitForTimeout(1200);
  await page.addStyleTag({ content: 'body > *:not(#game-container), #game-container > *:not(canvas), #crt-scanlines, #perf-overlay { display: none !important; }' });
  await page.evaluate((sc) => {
    const f = window.__fractured, g = f.game, s = g.state, ui = f.levelUpUI, R = f.renderer;
    s.floor = sc.floor; s.isTutorial = false; s.roomModifier = null;
    for (const id of ['flashlight']) for (let i = 0; i < 4 + sc.fl; i++) ui.selectCard({ type: 'weapon', id }, g, () => {});
    s.sanity = s.player.maxHp = 400;
    R.drawDamageText = () => {};
    if (sc.noPlayer) R.drawPlayer = () => {};
    if (sc.noCone) { const fl = s.player.weapons.flashlight; fl.radius = 1; fl.angle = 0.001; }
    if (sc.blackFloor) R.cachedFloorPatterns = R.cachedFloorPatterns.map(() => '#000');
    const cx0 = R.cameraCenterX, cy0 = R.cameraCenterY;
    if (sc.noVignette) R.diag.vignette = false;
    if (sc.noGrain) R.filmGrainEnabled = false;
    R.diag.lights = sc.lights; R.diag.fog = sc.fog;
    g.state.entities.slice().forEach(e => { e.hp = -1; });
    const px = s.player.x, py = s.player.y;
    const place = (e, x, y) => { if (e) { e.x = x; e.y = y; } return e; };
    if (sc.boss) window.__boss = place(g.director.spawnEntity(sc.boss, null, null, px + sc.bossDx, py + sc.bossDy), px + sc.bossDx, py + sc.bossDy);
    for (let i = 0; i < sc.crowd; i++) { const a = (i / sc.crowd) * 6.283 + Math.random() * 0.2, r = sc.ring[0] + Math.random() * (sc.ring[1] - sc.ring[0]); place(g.director.spawnEntity((sc.mobs || ['SCAVENGER', 'PREDATOR', 'PARASITE', 'SCAVENGER'])[i % (sc.mobs ? sc.mobs.length : 4)], null, null, px + Math.cos(a) * r, py + Math.sin(a) * r), px + Math.cos(a) * r, py + Math.sin(a) * r); }
    if (sc.plain) g.state.entities.forEach(e => { if (e.variant) { e.variant = null; e.variantTint = null; e.color = e.originalColor; } e.buffed = false; e.isElite = false; });
    s.player.angle = sc.angle;
    window.__sc = sc;
    window.__iv = setInterval(() => { s.sanity = s.player.maxHp; s.xp = 0; s.cameraShake = 0; if (sc.plain) s.xpDrops.length = 0; g.autoAimOn = false; f.inputManager.state.aimAngle = sc.angle; s.player.angle = sc.angle; R.zoom = sc.zoom; R.cameraCenterX = cx0 + (sc.camX || 0); R.cameraCenterY = cy0 + (sc.camY || 0); }, 16);
  }, scene);
  await page.waitForTimeout(400);
  if (scene.freeze) await page.evaluate(() => { const g = window.__fractured.game; g.state.devFreezeEntities = true; g.state.damageTexts && (g.state.damageTexts.length = 0); });
  await page.waitForTimeout(scene.wait);
  await page.screenshot({ path: out });
  console.log('errors', errs);
  await b.close();
})();
