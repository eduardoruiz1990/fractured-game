// Patch 130 (V2 plan C8): juice — level-up flash/deal-in/ease, boss-death impact,
// token-pickup burst, and the photosensitivity opt-out.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.click('#btn-title-begin');
  await page.waitForTimeout(800);

  // --- level-up: flash + cards dealt in, then an eased return --------------------
  await page.evaluate(() => window.__fractured.game.onLevelUp());
  await page.waitForTimeout(40);
  const lv = await page.evaluate(() => {
    const f = document.getElementById('juice-flash');
    const cards = [...document.querySelectorAll('#cards-container .card')];
    return {
      flash: !!f && f.classList.contains('juice-flash-on'),
      z: f ? +getComputedStyle(f).zIndex : 0,
      modalZ: +getComputedStyle(document.getElementById('level-up-modal')).zIndex,
      dealing: cards.length === 3 && cards.every(c => c.getAnimations().some(a => a.animationName === 'cardDealIn')),
      inlineRot: cards.every(c => /rotate/.test(c.style.transform))
    };
  });
  ok(lv.flash, 'level-up flash shown');
  ok(lv.z < lv.modalZ, `flash sits under the cards (${lv.z} < ${lv.modalZ})`);
  ok(lv.dealing, 'all three cards deal in');
  ok(lv.inlineRot, 'cards keep their inline tilt (deal-in composes, does not override)');
  await page.screenshot({ path: `${S}/juice_levelup.png` });
  await page.waitForTimeout(400);
  const eased = await page.evaluate(() => {
    const ui = window.__fractured.levelUpUI; ui.armedAt = 0; ui.tryPick(0);
    return window.__fractured.game.state.slowMo;
  });
  ok(eased >= 20, `after the pick the game eases back in at half speed (slowMo ${eased})`);
  await page.waitForTimeout(700);

  // --- boss death: impact freeze, slow motion, flash, fragments ------------------
  const boss = await page.evaluate(async () => {
    const g = window.__fractured.game, s = g.state;
    g.director.spawnEntity('BOSS', null, null, s.player.x + 120, s.player.y);
    const b = s.entities.find(e => e.type === 'BOSS');
    if (!b) return { spawned: false };
    const p0 = s.particles.length;
    b.hp = 0;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { spawned: true, hitStop: s.hitStop, slowMo: s.slowMo, flash: s.cameraFlash,
             parts: s.particles.length - p0, exit: s.interactables.some(o => o.type === 'EXIT_ELEVATOR'),
             gone: !s.entities.some(e => e.type === 'BOSS') };
  });
  ok(boss.spawned && boss.gone && boss.exit, 'boss killed, exit spawned');
  ok(boss.hitStop > 0, `impact freeze on the kill (hitStop ${boss.hitStop})`);
  ok(boss.slowMo >= 60, `slow motion queued after it (slowMo ${boss.slowMo})`);
  ok(boss.flash > 0, `soft flash (cameraFlash ${boss.flash})`);
  ok(boss.parts >= 100, `fragment burst (${boss.parts} particles)`);
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${S}/juice_boss.png` });
  await page.waitForTimeout(2200);
  ok(await page.evaluate(() => window.__fractured.game.state.slowMo === 0 && window.__fractured.game.state.hitStop === 0),
     'boss slow motion ends');

  // --- token pickup: anticipation then a burst that grows with rarity ------------
  const tok = await page.evaluate(async () => {
    const g = window.__fractured.game, s = g.state;
    const n0 = s.runInventory.length;
    s.hitStop = 0; s.slowMo = 0; s.cameraShake = 0;
    g.director.spawnToken(s.player.x + 2, s.player.y, { type: 'legendary', color: '#ff8c00' });
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
    return { got: s.runInventory.length - n0, hitStop: s.hitStop, shake: s.cameraShake };
  });
  ok(tok.got === 1, 'token collected');
  ok(tok.hitStop > 0 && tok.shake > 0, `pickup beat: freeze ${tok.hitStop}, shake ${tok.shake}`);

  // --- photosensitivity: no flash --------------------------------------------------
  await page.evaluate(() => {
    const t = document.getElementById('toggle-photo');
    if (t) t.checked = true;
    document.getElementById('btn-close-settings').click();   // settings apply on close
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.getElementById('juice-flash').classList.remove('juice-flash-on'); window.__fractured.game.onLevelUp(); });
  await page.waitForTimeout(40);
  const calm = await page.evaluate(() => document.getElementById('juice-flash').classList.contains('juice-flash-on'));
  ok(!calm, 'photosensitivity mode: no level-up flash');

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
