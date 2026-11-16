// Patch 150 (V2 plan F3, F4): reduced-motion defaults, colour-blind assist, text size.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
//   node qa/access_check.cjs <dir with sdkmock.js>
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 720 }, reducedMotion: opts.reducedMotion || 'no-preference', hasTouch: !!opts.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  // The mock's store is in memory; back it with sessionStorage so a reload keeps it.
  await page.addInitScript(() => {
    const d = window.CrazyGames.SDK.data;
    d.getItem = k => sessionStorage.getItem('mock:' + k);
    d.setItem = (k, v) => sessionStorage.setItem('mock:' + k, String(v));
    d.removeItem = k => sessionStorage.removeItem('mock:' + k);
  });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  return { ctx, page, errors };
}
const settingsState = (page) => page.evaluate(() => ({
  shake: document.getElementById('toggle-shake').checked,
  photo: document.getElementById('toggle-photo').checked,
  titleAnim: getComputedStyle(document.querySelector('#title-screen .title-glitch'), '::after').animationName   // Patch 162: the crack drift lives on the lower half
}));

(async () => {
  const browser = await chromium.launch();

  // --- F3: the OS asks for reduced motion ------------------------------------------------
  {
    const { ctx, page, errors } = await open(browser, { reducedMotion: 'reduce' });
    const s = await settingsState(page);
    ok(s.shake === false && s.photo === true, `reduced motion: shake off, photosensitivity on by default (${JSON.stringify(s)})`);
    ok(s.titleAnim === 'none', `reduced motion: the title does not glitch (${s.titleAnim})`);
    ok(await page.evaluate(() => document.body.classList.contains('calm-motion')), 'reduced motion: body.calm-motion');
    ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, {});
    const s = await settingsState(page);
    ok(s.shake === true && s.photo === false && s.titleAnim !== 'none', `no preference: the usual defaults and the title animates (${JSON.stringify(s)})`);
    await ctx.close();
  }
  {
    // A saved choice beats the OS default.
    const { ctx, page } = await open(browser, { reducedMotion: 'reduce' });
    await page.evaluate(() => { window.CrazyGames.SDK.data.setItem('fractured_settings', JSON.stringify({ screenShake: true, photosensitive: false })); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const s = await settingsState(page);
    ok(s.shake === true && s.photo === false, `a saved choice wins over the OS default (${JSON.stringify(s)})`);
    await ctx.close();
  }

  // --- F4: colour-blind assist and text size, in a run on a phone -------------------------------
  {
    const { ctx, page, errors } = await open(browser, { viewport: { width: 384, height: 717 }, touch: true });
    await page.evaluate(() => { window.__fractured.saveManager.metaState.story.coldOpenSeen = true; });
    await page.evaluate(() => { const t = document.getElementById('toggle-colorassist'); t.checked = true; t.dispatchEvent(new Event('change'));
      const s = document.getElementById('select-textsize'); s.value = 'larger'; s.dispatchEvent(new Event('change')); });
    const a = await page.evaluate(() => ({ cb: document.body.classList.contains('cb-assist'), html: getComputedStyle(document.documentElement).fontSize,
      r: window.__fractured.renderer.cbAssist, ts: window.__fractured.renderer.textScale,
      saved: JSON.parse(window.CrazyGames.SDK.data.getItem('fractured_settings') || '{}') }));
    ok(a.cb && a.r === true, 'colour assist: body class and renderer flag');
    ok(a.html === '20px' && a.ts === 1.25, `text LARGER: root 20px, canvas text ×1.25 (${a.html}, ${a.ts})`);
    ok(a.saved.colorAssist === true && a.saved.textSize === 'larger', 'both saved');
    await page.tap('#btn-title-begin');
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const g = window.__fractured.game, p = g.state.player;
      window.__fractured.saveManager.metaState.tutorialCompleted = true; g.state.isTutorial = false;
      g.director.releaseRoomState(g.state); g.director.spawnWave = () => {};
      const e = g.director.spawnEntity('PREDATOR', null, null, p.x + 120, p.y);
      e.update = () => {}; e.x = p.x + 120; e.y = p.y; e.attackState = 'telegraphing';
      g.state.entities = [e];
      g.state.sanity = g.state.player.maxHp * 0.9;
    });
    await page.waitForTimeout(400);
    const bar = await page.evaluate(() => getComputedStyle(document.getElementById('sanity-bar')).backgroundColor);
    ok(bar === 'rgb(77, 163, 255)', `colour assist: Sanity reads blue, not green (${bar})`);
    await page.evaluate(() => { const g = window.__fractured.game; g.state.sanity = g.state.player.maxHp * 0.2; });
    await page.waitForTimeout(900);   // past the bar's colour transition
    const low = await page.evaluate(() => getComputedStyle(document.getElementById('sanity-bar')).backgroundColor);
    ok(low === 'rgb(255, 154, 31)', `colour assist: low Sanity reads orange (${low})`);
    // The HUD still fits a 384px phone at the largest text.
    const fit = await page.evaluate(() => [...document.querySelectorAll('#ui-layer .sanity-section, #ui-layer .convergence-section, #ui-layer .score-section')]
      .map(e => e.getBoundingClientRect()).every(r => r.left >= -1 && r.right <= innerWidth + 1));
    ok(fit, 'text LARGER: the HUD panels stay on screen at 384px');
    await page.screenshot({ path: `${S}/access_phone.png` });
    ok(errors.length === 0, `phone: no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
