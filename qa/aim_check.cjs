// Patch 148 (V2 plan F1): aim assist in the real game.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
//   node qa/aim_check.cjs <dir with sdkmock.js>
//
// A touch phone: with nothing touching the right half, the light turns to an enemy by
// itself; a held right stick overrides it; letting go hands it back. A mouse desktop:
// AUTO leaves aiming to the mouse; the Settings select switches it ON.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function start(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__fractured.saveManager.metaState.story.coldOpenSeen = true; });
  if (vp.touch) await page.tap('#btn-title-begin'); else await page.click('#btn-title-begin');
  await page.waitForTimeout(900);
  // A single still enemy straight above the player; nothing else spawns.
  await page.evaluate(() => {
    const g = window.__fractured.game, p = g.state.player;
    window.__fractured.saveManager.metaState.tutorialCompleted = true;
    g.state.isTutorial = false;
    g.director.releaseRoomState(g.state);
    g.director.spawnWave = () => {};
    const e = g.director.spawnEntity('SCAVENGER', null, null, p.x, p.y - 180);
    e.update = () => {}; e.x = p.x; e.y = p.y - 180; e.hp = e.maxHp = 1e9;
    g.state.entities = [e];
    p.angle = 0;
  });
  return { ctx, page, errors };
}
const angle = (page) => page.evaluate(() => window.__fractured.game.state.player.angle);
const near = (a, b, eps = 0.2) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < eps;

(async () => {
  const browser = await chromium.launch();

  // --- a touch phone -----------------------------------------------------------------------
  {
    const { ctx, page, errors } = await start(browser, { width: 384, height: 717, touch: true });
    await page.waitForTimeout(700);
    const a = await angle(page);
    const mode = await page.evaluate(() => ({ on: window.__fractured.game.autoAimOn, m: window.__fractured.inputManager ? window.__fractured.inputManager.getInputMode() : '?' }));
    ok(mode.on === true, `touch: assist is on by default (${JSON.stringify(mode)})`);
    ok(near(a, -Math.PI / 2), `touch: the light turned to the enemy above with no aiming (${a.toFixed(2)})`);
    await page.screenshot({ path: `${S}/aim_touch.png` });

    // Hold the right stick pulling right (+x): the player's aim wins.
    const cdp = await ctx.newCDPSession(page);
    const tp = (x, y) => [{ x, y, id: 7 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(300, 420) });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(300 + i * 10, 420) }); await page.waitForTimeout(20); }
    await page.waitForTimeout(400);
    const held = await page.evaluate(() => ({ a: window.__fractured.game.state.player.angle, h: window.__fractured.inputManager.state.aimHeld }));
    ok(held.h === true && near(held.a, 0), `touch: a held right stick overrides assist (${held.a.toFixed(2)}, held=${held.h})`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(600);
    const back = await angle(page);
    ok(near(back, -Math.PI / 2), `touch: letting go hands aiming back to assist (${back.toFixed(2)})`);
    ok(errors.length === 0, `touch: no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }

  // --- a mouse desktop ----------------------------------------------------------------------------
  {
    const { ctx, page, errors } = await start(browser, { width: 1280, height: 720, touch: false });
    await page.mouse.move(1200, 360);   // aim right with the mouse
    await page.waitForTimeout(600);
    const a = await angle(page);
    ok(near(a, 0, 0.3), `desktop AUTO: the mouse aims, assist stays off (${a.toFixed(2)})`);
    await page.evaluate(() => { const s = document.getElementById('select-aim'); s.value = 'on'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(600);
    const b = await angle(page);
    ok(near(b, -Math.PI / 2), `desktop ON: assist aims at the enemy (${b.toFixed(2)})`);
    // Saved through the portal adapter (the SDK mock's data module here).
    const saved = await page.evaluate(() => JSON.parse(window.CrazyGames.SDK.data.getItem('fractured_settings') || '{}').aimAssist);
    ok(saved === 'on', `desktop: the choice is saved (${saved})`);
    ok(errors.length === 0, `desktop: no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
