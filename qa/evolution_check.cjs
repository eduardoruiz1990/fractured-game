// Patch 134 (V2 plan D2): an evolution from an elite's chest, its notice, the codex,
// and the EVOLUTION READY card. Assertion-based: exits 1 on any failure. Needs the
// dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 384, height: 717 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.click('#btn-title-begin');
  await page.waitForTimeout(800);

  // --- the card that completes it -----------------------------------------------
  const card = await page.evaluate(() => {
    const g = window.__fractured.game, s = g.state, ui = window.__fractured.levelUpUI;
    s.isTutorial = false; s.tutorialFreeze = false;
    s.player.weapons.flashlight.level = 1;
    s.player.weapons.lead_pipe.level = 4;
    s.player.boons.push('heavy_swing');
    for (let i = 0; i < 80; i++) {
      g.onLevelUp();
      const badge = [...document.querySelectorAll('#cards-container .card-badge-evolution')].map(b => b.textContent);
      ui.close();
      if (badge.length) return badge[0];
    }
    return null;
  });
  // Resume play the way a player does: pick a card (main.js's callback returns to PLAYING).
  await page.evaluate(() => { const g = window.__fractured.game, ui = window.__fractured.levelUpUI; g.onLevelUp(); ui.armedAt = 0; ui.tryPick(0); });
  await page.waitForTimeout(200);
  ok(card === 'EVOLUTION READY: Wrecking Bar', `the pipe's 4→5 card says ${card}`);

  // --- the chest evolves it -------------------------------------------------------
  await page.evaluate(async () => {
    const { promoteToElite, dropChest } = await import('/src/systems/Elites.js');
    const g = window.__fractured.game, s = g.state;
    s.level = 60; s.sanity = s.player.maxHp = 9999;
    s.player.weapons.lead_pipe.level = 5;
    const c = dropChest(s, s.player.x, s.player.y);
  });
  await page.waitForFunction(() => !window.__fractured.game.state.interactables.some(o => o.type === 'CHEST'), null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(250);
  const res = await page.evaluate(() => {
    const b = document.getElementById('synergy-banner');
    const w = window.__fractured.game.state.player.weapons.lead_pipe;
    return { evo: w.evolution, text: b ? b.textContent.replace(/\s+/g, ' ').trim() : '', tone: b && b.dataset.tone,
             saved: (window.__fractured.saveManager.metaState.discoveredEvolutions || {}).wrecking_bar };
  });
  ok(res.evo === 'wrecking_bar', `the pipe evolved (${res.evo})`);
  ok(/EVOLUTION/.test(res.text) && /Wrecking Bar/.test(res.text) && /NEW CODEX ENTRY · 1 \/ 12/.test(res.text) && res.tone === 'evolution',
     `evolution notice: ${res.text}`);
  ok(res.saved === 1, 'recorded in the evolution codex');
  await page.screenshot({ path: `${S}/evolution_notice.png` });

  // --- the codex ------------------------------------------------------------------
  const codex = await page.evaluate(() => {
    window.__fractured.uiManager.renderTrophies();
    const cards = [...document.querySelectorAll('#trophy-grid [data-evolution]')];
    return { n: cards.length, open: cards.filter(c => !c.classList.contains('codex-locked')).map(c => c.dataset.evolution) };
  });
  ok(codex.n === 12 && codex.open.length === 1 && codex.open[0] === 'wrecking_bar', `codex: ${codex.n} entries, open ${JSON.stringify(codex.open)}`);

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
