// Patch 126 (V2 plan C3): the synergy-formed moment and the Synergy Codex.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 915, height: 412 }, { width: 1280, height: 720 }]) {
    const ctx = await browser.newContext({ viewport: vp, hasTouch: vp.width < 1000 });
    const page = await ctx.newPage();
    const tag = `${vp.width}x${vp.height}`;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.click('#btn-title-begin');
    await page.waitForTimeout(1200);
    const happy = () => page.evaluate(() => (window.__sdkCalls || []).filter(c => c[0] === 'happytime').length);
    const happy0 = await happy();

    // Form The Blinding Signal through a REAL level-up card: flashlight 5, static 4,
    // and pick the Static Receiver card when it is offered.
    let formed = false;
    for (let i = 0; i < 15 && !formed; i++) {
      formed = await page.evaluate(() => {
        const f = window.__fractured, g = f.game, w = g.state.player.weapons;
        w.flashlight.level = 5; w.static.level = 4;
        g.onLevelUp();
        const ui = f.levelUpUI; ui.armedAt = 0;
        const cards = [...document.querySelectorAll('#cards-container .card')];
        const idx = cards.findIndex(c => { const h = c.querySelector('h3'); return h && /^Static Receiver$/i.test(h.innerText.trim()); });
        ui.tryPick(idx >= 0 ? idx : 0);
        return idx >= 0;
      });
    }
    ok(formed, `${tag} a Static Receiver card was offered and picked`);
    await page.waitForTimeout(450);   // past the stamp animation
    const b = await page.evaluate(() => {
      const el = document.getElementById('synergy-banner');
      const g = window.__fractured.game;
      const r = el ? el.getBoundingClientRect() : null;
      return {
        shown: !!el && getComputedStyle(el).display !== 'none',
        text: el ? el.innerText.replace(/\s+/g, ' ') : '',
        z: el ? +getComputedStyle(el).zIndex : 0,
        onScreen: !!r && r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
        minFont: el ? Math.min(...[...el.querySelectorAll('div')].map(d => parseFloat(getComputedStyle(d).fontSize))) : 0,
        slowMo: g.state.slowMo,
        codex: window.__fractured.saveManager.metaState.discoveredSynergies,
        gs: window.__fractured.gameState,
        syn: g.state.player.synergies
      };
    });
    ok(b.gs === 'PLAYING' && b.syn.includes('blinding_signal'), `${tag} back in PLAYING with the synergy active (${b.gs}, ${JSON.stringify(b.syn)})`);
    ok(b.shown && /SYNERGY FORMED/.test(b.text) && /The Blinding Signal/.test(b.text), `${tag} banner names the synergy`);
    ok(/Rusted Flashlight/i.test(b.text) && /Static Receiver/i.test(b.text) && !/_/.test(b.text), `${tag} recipe in display names`);
    ok(/NEW CODEX ENTRY · 1 \/ 10/.test(b.text), `${tag} first formation reads NEW CODEX ENTRY · 1 / 10`);
    ok(b.z > 100, `${tag} banner above the scanlines (z ${b.z})`);
    ok(b.onScreen, `${tag} banner fully on screen`);
    ok(b.minFont >= 11, `${tag} banner text >= 11px (min ${b.minFont})`);
    ok(b.slowMo > 0, `${tag} slow-motion running (${b.slowMo} steps left)`);
    ok(b.codex && b.codex.blinding_signal === 1, `${tag} codex recorded it`);
    ok(await happy() === happy0 + 1, `${tag} happytime fired once`);
    console.log('    banner:', b.text);
    await page.screenshot({ path: `${S}/synergy_${tag}.png` });

    // Slow-motion ends and the banner clears itself.
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => ({
      shown: getComputedStyle(document.getElementById('synergy-banner')).display !== 'none',
      slowMo: window.__fractured.game.state.slowMo
    }));
    ok(!after.shown && after.slowMo === 0, `${tag} banner gone and slow-motion over`);

    // A second, different synergy: banner again, but happytime stays once per session.
    await page.evaluate(() => {
      const g = window.__fractured.game; g.state.player.weapons.broken_chalk.level = 5; g.refreshSynergies();
    });
    await page.waitForTimeout(100);
    const second = await page.evaluate(() => document.getElementById('synergy-banner').innerText.replace(/\s+/g, ' '));
    ok(/Ritual Focus/.test(second) && /2 \/ 10/.test(second), `${tag} second synergy announced (${second.slice(0, 60)}…)`);
    ok(await happy() === happy0 + 1, `${tag} happytime not repeated in the same session`);

    // The codex in the Mind Palace: 2 formed, 8 silhouettes that still give the recipe.
    await page.evaluate(() => {
      window.__fractured.uiManager.updateMenuUI();
      document.getElementById('clinical-folder-menu').style.display = 'flex';
      document.querySelector('.tab-btn[data-target="tab-trophies"]').click();
    });
    await page.waitForTimeout(200);
    const codex = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#trophy-grid .codex-card')];
      return {
        n: cards.length,
        locked: cards.filter(c => c.classList.contains('codex-locked')).length,
        lockedText: cards.filter(c => c.classList.contains('codex-locked')).map(c => c.innerText.replace(/\s+/g, ' ')),
        formedText: cards.filter(c => !c.classList.contains('codex-locked')).map(c => c.innerText.replace(/\s+/g, ' ')),
        heading: [...document.querySelectorAll('#trophy-grid strong')].map(e => e.innerText).find(t => /SYNERGY CODEX/.test(t)) || ''
      };
    });
    ok(codex.n === 10 && codex.locked === 8, `${tag} codex has 10 entries, 8 locked (${codex.n}/${codex.locked})`);
    ok(/2 \/ 10/.test(codex.heading), `${tag} codex heading counts 2 / 10`);
    ok(codex.lockedText.every(t => /\+/.test(t) && !/_/.test(t)), `${tag} locked entries show the recipe in display names`);
    ok(!codex.lockedText.some(t => /Overexposure|Centrifuge|Industrial Bleed/.test(t)), `${tag} locked entries withhold the name`);
    ok(codex.formedText.some(t => /The Blinding Signal/.test(t) && /FORMED ×1/.test(t)), `${tag} formed entry shows name and count`);
    await page.evaluate(() => { const el = document.querySelector('#trophy-grid .codex-card'); if (el) el.scrollIntoView({ block: 'center' }); });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${S}/codex_${tag}.png` });

    // Death clears any pending notice.
    await page.evaluate(() => { window.__fractured.game.state.player.weapons.lead_pipe.level = 5; window.__fractured.game.state.player.weapons.broken_chalk.level = 5; });
    await page.evaluate(() => { const g = window.__fractured.game; g.state.player.synergies = []; g.refreshSynergies(); g.onDeath(); });
    const afterDeath = await page.evaluate(() => getComputedStyle(document.getElementById('synergy-banner')).display);
    ok(afterDeath === 'none', `${tag} death clears queued notices`);
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
