// Patch 133 (V2 plan D4): a named elite in the real game, its chest, and the notice.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 1280, height: 720 }]) {
    const tag = `${vp.width}x${vp.height}`;
    const page = await browser.newPage({ viewport: vp, hasTouch: vp.width < 1000 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.click('#btn-title-begin');
    await page.waitForTimeout(800);

    const el = await page.evaluate(async () => {
      const { promoteToElite } = await import('/src/systems/Elites.js');
      const g = window.__fractured.game, s = g.state;
      s.isTutorial = false; s.tutorialFreeze = false;
      s.sanity = s.player.maxHp = 9999;
      s.player.weapons.flashlight.radius = 0;   // keep it alive for the screenshot
      s.level = 60;   // the elite's orbs must not open the level-up modal mid-check
      // Patch 144: an elite also drops a Case File page half the time, whose notice would
      // go ahead of the chest's. File every page first so this check stays about chests
      // (qa/story_check.cjs covers pages).
      for (let i = 1; i <= 25; i++) window.__fractured.saveManager.collectPage('p' + String(i).padStart(2, '0'));
      const e = g.director.spawnEntity('PREDATOR', null, null, s.player.x + 140, s.player.y);
      promoteToElite(e);
      e.update = () => {};
      return { name: e.eliteName, hp: e.hp, max: e.maxHp };
    });
    ok(!!el.name && el.hp === el.max, `${tag} elite spawned: ${el.name}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${S}/elite_${tag}.png` });

    await page.evaluate(() => { const s = window.__fractured.game.state; s.entities.find(e => e.elite).hp = 0; });
    await page.waitForTimeout(300);
    const chest = await page.evaluate(() => {
      const s = window.__fractured.game.state;
      const c = s.interactables.find(o => o.type === 'CHEST');
      return c ? { x: c.x, y: c.y } : null;
    });
    ok(!!chest, `${tag} the elite dropped a chest`);
    await page.screenshot({ path: `${S}/chest_${tag}.png` });

    await page.evaluate(({ x, y }) => { const p = window.__fractured.game.state.player; p.x = x; p.y = y; }, chest);
    await page.waitForFunction(() => !window.__fractured.game.state.interactables.some(o => o.type === 'CHEST'), null, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    const notice = await page.evaluate(() => {
      const b = document.getElementById('synergy-banner');
      return b && getComputedStyle(b).display !== 'none' ? { text: b.textContent.replace(/\s+/g, ' ').trim(), tone: b.dataset.tone } : null;
    });
    ok(notice && /CHEST OPENED/.test(notice.text) && notice.tone === 'chest', `${tag} chest notice shown (${notice && notice.text})`);
    await page.screenshot({ path: `${S}/chest_open_${tag}.png` });
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
