// Patch 151 (V2 plan F5): every screen fits at the iframe sizes CrazyGames serves and on
// phones both ways up. Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
//   node qa/sizes_check.cjs <dir with sdkmock.js>
//
// For each size: the title's buttons, the DESCEND pane's Patient strip and AUTHORIZE
// DESCENT, the HUD, the level-up cards and the pause menu are all fully on screen with no
// scrolling. On touch, DASH and the notice strip stay off the level-up cards and DASH
// comes back after the pick. On a phone, the storm behind a full-screen folder is not drawn.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const SIZES = [[960, 540], [800, 600], [1280, 720], [1024, 768], [384, 717], [360, 640], [717, 384], [915, 412]];

// Elements matching `sel` that are visible but not fully inside the viewport.
const offscreen = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
  .filter(e => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.offsetParent !== null; })
  .map(e => ({ id: e.id || String(e.className).slice(0, 30) || e.tagName, r: e.getBoundingClientRect() }))
  .filter(o => o.r.width > 0 && (o.r.left < -1 || o.r.top < -1 || o.r.right > innerWidth + 1 || o.r.bottom > innerHeight + 1))
  .map(o => `${o.id}@${Math.round(o.r.left)},${Math.round(o.r.top)},${Math.round(o.r.right)},${Math.round(o.r.bottom)}`), sel);
const shown = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && e.offsetParent !== null; }, id);

(async () => {
  const browser = await chromium.launch();
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const touch = w < 1000 && (w < 800 || h < 500);
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    // --- title -----------------------------------------------------------------------------
    const title = await offscreen(page, '#title-screen button, #title-screen .title-glitch, .patient-chip');
    ok(title.length === 0, `${tag} title: everything on screen ${JSON.stringify(title)}`);

    // --- the folder, opened from the hub's desk the way a player does -----------------------------
    await page.evaluate(() => { const f = window.__fractured; if (f && f.saveManager) { f.saveManager.metaState.tutorialCompleted = true; f.saveManager.saveGame(); } document.body.classList.remove('first-time'); });   /* Patch 185: the Mind Hub button is hidden until the first room is behind the player (Patch 167); these checks are a returning player's */ await page.click('#btn-title-hub', { force: true });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const g = window.__fractured.game; const z = g.hubWorld.zones.find(z => z.action === 'tab-main') || g.hubWorld.zones[0];
      g.state.player.x = z.x; g.state.player.y = z.y - 60; });
    await page.waitForTimeout(250);
    await page.click('#interaction-prompt', { force: true });
    await page.waitForTimeout(400);
    // DESCEND / EVALUATION, whichever desk opened the folder
    await page.evaluate(() => { const b = document.querySelector('.tab-btn[data-target="tab-main"]'); if (b) b.click(); });
    await page.waitForTimeout(250);
    const folder = await offscreen(page, '#btn-start, #folder-patient-strip .patient-chip, #clinical-folder-menu .tab-btn:not(.subtab), #btn-close-folder');
    ok(folder.length === 0, `${tag} folder: AUTHORIZE, the Patient strip and the tabs on screen, unscrolled ${JSON.stringify(folder)}`);
    if (w <= 400) {
      // The storm behind a full-screen folder is skipped.
      const calls = await page.evaluate(() => new Promise(res => { const r = window.__fractured.renderer; const orig = r.drawMenuBackground; let n = 0;
        r.drawMenuBackground = function (...a) { n++; return orig.apply(this, a); };
        setTimeout(() => { r.drawMenuBackground = orig; res({ n, gs: window.__fractured.gameState }); }, 1200); }));
      ok(calls.gs === 'MENU' && calls.n === 0, `${tag} folder: no storm drawn behind a full-screen folder (${JSON.stringify(calls)})`);
    }
    const blur = await page.evaluate(() => ['#clinical-folder-menu', '#pause-menu', '.folder-header']
      .map(s => getComputedStyle(document.querySelector(s)).backdropFilter).filter(v => v && v !== 'none'));
    ok(blur.length === 0, `${tag} folder: no backdrop-filter over the live canvas ${JSON.stringify(blur)}`);
    await page.screenshot({ path: `${S}/sizes_folder_${tag}.png` });
    await page.click('#btn-close-folder', { force: true });
    await page.waitForTimeout(300);

    // --- a run: HUD, level-up, pause ----------------------------------------------------------------
    await page.evaluate(() => { const m = window.__fractured.saveManager.metaState; m.story.coldOpenSeen = true; m.tutorialCompleted = true; });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    await page.evaluate(() => { const m = window.__fractured.saveManager.metaState; m.story.coldOpenSeen = true; m.tutorialCompleted = true; });
    if (touch) await page.tap('#btn-title-begin'); else await page.click('#btn-title-begin');
    await page.waitForTimeout(900);
    if (touch) { await page.tap('#gameCanvas', { position: { x: 30, y: h - 40 }, timeout: 3000 }); await page.waitForTimeout(200); }
    const hud = await offscreen(page, '#ui-layer .sanity-section, #ui-layer .convergence-section, #ui-layer .score-section, #btn-pause, #btn-dash');
    ok(hud.length === 0, `${tag} HUD on screen ${JSON.stringify(hud)}`);
    const dashBefore = touch ? await shown(page, 'btn-dash') : null;

    await page.evaluate(() => {
      // SynergyBanner builds its element on first use; stand one in if none exists yet.
      let b = document.getElementById('synergy-banner');
      if (!b) { b = document.createElement('div'); b.id = 'synergy-banner'; b.style.cssText = 'position:fixed;left:0;bottom:0;'; document.body.appendChild(b); }
      b.style.display = 'block'; b.textContent = 'TEST NOTICE';
      window.__fractured.game.onLevelUp();
    });
    await page.waitForTimeout(500);
    const cards = await offscreen(page, '#cards-container .card, #levelup-screen button');
    ok(cards.length === 0, `${tag} level-up: every card on screen ${JSON.stringify(cards)}`);
    const strip = await page.evaluate(() => { const b = document.getElementById('synergy-banner');
      return { vis: b && getComputedStyle(b).visibility, cls: document.body.className, gs: window.__fractured.gameState }; });
    ok(!(await shown(page, 'synergy-banner')), `${tag} level-up: the notice strip waits ${JSON.stringify(strip)}`);
    if (touch) ok(!(await shown(page, 'btn-dash')), `${tag} level-up: DASH is not over the cards`);
    if (touch) {
      // Patch 153: a thumb on the canvas while the cards are up (it re-reveals DASH in Input.js).
      await page.evaluate(() => { const c = document.getElementById('gameCanvas'); const t = new Touch({ identifier: 9, target: c, clientX: 20, clientY: innerHeight - 10 });
        c.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
        c.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [t] })); });
      await page.waitForTimeout(100);
      ok(!(await shown(page, 'btn-dash')), `${tag} level-up: DASH stays hidden when a thumb touches the canvas`);
    }
    await page.screenshot({ path: `${S}/sizes_levelup_${tag}.png` });
    await page.evaluate(() => { const ui = window.__fractured.levelUpUI; ui.armedAt = 0; ui.tryPick(0); });
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.body.classList.contains('levelup-open')), `${tag} after the pick: the notice strip may show again`);
    if (touch && dashBefore) ok(await shown(page, 'btn-dash'), `${tag} after the pick: DASH is back`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const pause = await offscreen(page, '#pause-menu button');
    ok(pause.length === 0, `${tag} pause: every button on screen ${JSON.stringify(pause)}`);
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
