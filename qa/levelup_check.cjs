// Patch 125 (V2 plan C2): level-up cards that explain themselves.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 915, height: 412 }, { width: 1280, height: 720 }]) {
    const page = await browser.newPage({ viewport: vp, hasTouch: vp.width < 1000 });
    const tag = `${vp.width}x${vp.height}`;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.click('#btn-title-begin');
    await page.waitForTimeout(1200);

    // Patch 127: a fresh run owns only the flashlight. 64 XP (24 + 40) gives two
    // cards in a row, and each offers a NEW weapon.
    const fresh = await page.evaluate(() => {
      const g = window.__fractured.game; g.state.xp = 64; return g.state.level;
    });
    const newOffers = [];
    for (let k = 0; k < 2; k++) {
      await page.waitForFunction(() => window.__fractured.gameState === 'LEVEL_UP', null, { timeout: 3000 }).catch(() => {});
      newOffers.push(await page.evaluate(() => {
        const ui = window.__fractured.levelUpUI;
        const hasNew = [...document.querySelectorAll('#cards-container .card')].some(c => /NEW WEAPON/.test(c.innerText));
        const ch = ui.currentChoices || [];
        const idx = Math.max(0, ch.findIndex(c => c.type !== 'weapon' || !c.isNew));   // keep one weapon for card 2
        ui.armedAt = 0; ui.tryPick(idx);
        return hasNew;
      }));
      await page.waitForTimeout(100);
    }
    const lvlAfter = await page.evaluate(() => window.__fractured.game.state.level);
    ok(lvlAfter === fresh + 2, `${tag} 64 XP from level ${fresh} gives two cards (now ${lvlAfter})`);
    ok(newOffers.length === 2 && newOffers.every(Boolean), `${tag} both early offers include a NEW weapon ${JSON.stringify(newOffers)}`);

    // A deterministic offer: flashlight 5, static 4 (so static can complete a
    // synergy), pipe 2, everything else maxed or owned so the pool is mostly weapons.
    const open = () => page.evaluate(() => {
      const g = window.__fractured.game, w = g.state.player.weapons;
      w.flashlight.level = 5; w.static.level = 4; w.lead_pipe.level = 2;
      g.onLevelUp();
    });
    await open();
    await page.waitForTimeout(50);
    const info = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#cards-container .card')];
      const fs = sel => Math.min(...[...document.querySelectorAll(sel)].map(e => parseFloat(getComputedStyle(e).fontSize)));
      return {
        n: cards.length,
        text: cards.map(c => c.innerText.replace(/\s+/g, ' ')),
        onScreen: cards.every(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; }),
        minFont: Math.min(fs('#cards-container .card p'), fs('#cards-container .card-stats'), fs('#cards-container .lvl')),
        gs: window.__fractured.gameState
      };
    });
    ok(info.n === 3 && info.gs === 'LEVEL_UP', `${tag} three cards, LEVEL_UP`);
    ok(!info.text.some(t => /Upgrade this weapon/.test(t)), `${tag} no generic "Upgrade this weapon"`);
    ok(info.onScreen, `${tag} every card fully on screen`);
    ok(info.minFont >= 11, `${tag} card text >= 11px (min ${info.minFont})`);
    console.log('   ', info.text.join('\n     '));

    // Mis-tap guard: a key inside the arming window does nothing.
    await page.keyboard.press('2');
    ok(await page.evaluate(() => window.__fractured.gameState) === 'LEVEL_UP', `${tag} key inside 300 ms ignored`);
    await page.screenshot({ path: `${S}/levelup_${tag}.png` });
    await page.waitForTimeout(400);
    const before = await page.evaluate(() => { const g = window.__fractured.game; return { w: Object.fromEntries(Object.entries(g.state.player.weapons).map(([k, v]) => [k, v.level])), b: g.state.player.boons.length }; });
    await page.keyboard.press('2');
    await page.waitForTimeout(100);
    const after = await page.evaluate(() => { const g = window.__fractured.game; return { gs: window.__fractured.gameState, w: Object.fromEntries(Object.entries(g.state.player.weapons).map(([k, v]) => [k, v.level])), b: g.state.player.boons.length, modal: getComputedStyle(document.getElementById('level-up-modal')).display }; });
    const lvlDelta = Object.keys(after.w).reduce((s, k) => s + after.w[k] - before.w[k], 0);
    ok(after.gs === 'PLAYING' && after.modal === 'none', `${tag} key 2 picks and closes (${after.gs})`);
    ok(lvlDelta + (after.b - before.b) === 1, `${tag} exactly one weapon level or boon gained`);
    await page.keyboard.press('1');
    ok(await page.evaluate(() => window.__fractured.gameState) === 'PLAYING', `${tag} 1/2/3 inert while playing`);

    // SYNERGY READY appears on the static card when it would complete Blinding Signal.
    let sawReady = false;
    for (let i = 0; i < 12 && !sawReady; i++) {
      await open(); await page.waitForTimeout(20);
      sawReady = await page.evaluate(() => [...document.querySelectorAll('#cards-container .card')].some(c => /Static Receiver/.test(c.innerText) && /SYNERGY READY/.test(c.innerText)));
      await page.evaluate(() => { const ui = window.__fractured.levelUpUI; if (ui) { ui.armedAt = 0; ui.tryPick(0); } });
      await page.evaluate(() => { const w = window.__fractured.game.state.player.weapons; w.static.level = 4; });
    }
    ok(sawReady, `${tag} static card shows SYNERGY READY`);
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
