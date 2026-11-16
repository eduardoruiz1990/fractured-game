// Patches 148-149 (V2 plan F1, F2, F6): aim assist and the double-tap dash in the real game.
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
    // Patch 149: double-tap the move side to dash, in the last heading.
    const L = (x, y) => [{ x, y, id: 3 }];
    await page.evaluate(() => { const p = window.__fractured.game.state.player; p.dash.charges = p.dash.maxCharges; p.dash.active = false; window.__vib = []; navigator.vibrate = (pt) => { window.__vib.push(pt); return true; }; });
    // steer left for a moment (a real heading), then let go
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(100, 500) });
    for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: L(100 - i * 10, 500) }); await page.waitForTimeout(30); }
    await page.waitForTimeout(250);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const c0 = await page.evaluate(() => window.__fractured.game.state.player.dash.charges);
    // a tap, then a second touch: the dash
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(110, 520) });
    await page.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(90);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(112, 522) });
    await page.waitForTimeout(80);
    const d = await page.evaluate(() => { const p = window.__fractured.game.state.player; return { charges: p.dash.charges, dx: p.dash.dx, vib: window.__vib.length }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(d.charges === c0 - 1, `touch: a double-tap on the left dashes (charges ${c0} -> ${d.charges})`);
    ok(d.dx < -0.9, `touch: along the last heading (left), not the aim (dx ${d.dx && d.dx.toFixed(2)})`);
    ok(d.vib >= 1, `touch: with a buzz (${d.vib})`);
    // a hold-and-release, then a touch: steering, not a dash
    await page.waitForTimeout(400);
    await page.evaluate(() => { const p = window.__fractured.game.state.player; p.dash.charges = p.dash.maxCharges; p.dash.active = false; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(110, 520) });
    await page.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(80);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: L(110, 520) });
    await page.waitForTimeout(80);
    const nd = await page.evaluate(() => { const p = window.__fractured.game.state.player; return p.dash.charges === p.dash.maxCharges; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(nd, 'touch: a hold then a touch is not a dash');
    // Patch 161: twin sticks in portrait. Both thumbs down; the move thumb drags right
    // ACROSS the midline (x 192) and keeps going. Before, the aim stick adopted it there
    // and the player froze; now the player keeps walking and the aim thumb keeps aiming.
    await page.waitForTimeout(300);
    const two = (mx, my, ax, ay) => [{ x: mx, y: my, id: 11 }, { x: ax, y: ay, id: 12 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 110, y: 600, id: 11 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(110, 600, 320, 560) });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two(110 + i * 25, 600, 320, 560 - i * 8) }); await page.waitForTimeout(20); }
    const x0 = await page.evaluate(() => window.__fractured.game.state.player.x);
    await page.waitForTimeout(500);
    const tw = await page.evaluate(() => { const f = window.__fractured, im = f.inputManager; return { x: f.game.state.player.x, l: im.leftTouch.id, r: im.rightTouch.id, mx: im.state.moveX, held: im.state.aimHeld }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(tw.l === 11 && tw.r === 12, `touch: each thumb keeps its own stick after the move thumb crosses the midline (${tw.l}/${tw.r})`);
    ok(tw.mx > 0.9 && tw.x - x0 > 40, `touch: and the player keeps walking right (moveX ${tw.mx.toFixed(2)}, +${(tw.x - x0).toFixed(0)} px)`);
    ok(tw.held === true, 'touch: while the other thumb still aims');
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
