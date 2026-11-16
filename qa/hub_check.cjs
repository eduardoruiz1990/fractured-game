// Patch 129 (V2 plan C6): four folder groups, and DESCEND from the walkable hub.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const gs = (p) => p.evaluate(() => window.__fractured.gameState);
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 915, height: 412 }, { width: 1280, height: 720 }]) {
    const touch = vp.width < 1000;
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch });
    const page = await ctx.newPage();
    const tag = `${vp.width}x${vp.height}`;
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.click('#btn-title-hub');
    await page.waitForTimeout(700);

    // --- the hub button ---------------------------------------------------------
    const btn = await page.evaluate(() => {
      const b = document.getElementById('hub-descend');
      const r = b.getBoundingClientRect();
      return { shown: getComputedStyle(b).display !== 'none', h: r.height, onScreen: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
    });
    ok(await gs(page) === 'HUB' && btn.shown, `${tag} DESCEND shown in the hub`);
    ok(btn.h >= 44 && btn.onScreen, `${tag} DESCEND >= 44px and on screen (${btn.h}px)`);
    await page.screenshot({ path: `${S}/hub_${tag}.png` });

    // --- the folder: 4 groups, sub-tabs per group ------------------------------
    // Stand at the Mind Palace desk (the hub recomputes activeZone from the player's
    // position every frame, so setting it directly races the next frame).
    await page.evaluate(() => {
      const g = window.__fractured.game, z = g.hubWorld.zones.find(z => z.action === 'tab-trophies');
      g.state.player.x = z.x; g.state.player.y = z.y;
    });
    await page.waitForFunction(() => { const z = window.__fractured.game.hubWorld.activeZone; return z && z.action === 'tab-trophies'; }, null, { timeout: 3000 }).catch(() => {});
    await page.keyboard.press('e');
    await page.waitForTimeout(250);
    const f = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.folder-groups .group-btn')];
      const visibleSubs = [...document.querySelectorAll('.folder-tabs .tab-btn')].filter(b => getComputedStyle(b).display !== 'none');
      const strip = document.querySelector('.folder-groups').getBoundingClientRect();
      return {
        groups: groups.map(b => b.textContent), active: groups.filter(b => b.classList.contains('active')).map(b => b.textContent),
        subs: visibleSubs.map(b => b.textContent), activePane: document.querySelector('.tab-pane.active').id,
        fits: groups.every(b => { const r = b.getBoundingClientRect(); return r.left >= strip.left - 1 && r.right <= strip.right + 1; }),
        minH: Math.min(...groups.map(b => b.getBoundingClientRect().height)),
        hubBtn: getComputedStyle(document.getElementById('hub-descend')).display
      };
    });
    ok(JSON.stringify(f.groups) === '["DESCEND","SYNAPSES","LOADOUT","RECORDS"]', `${tag} four groups ${JSON.stringify(f.groups)}`);
    ok(f.active[0] === 'RECORDS' && f.activePane === 'tab-trophies', `${tag} the Mind Palace desk opens RECORDS / Mind Palace`);
    ok(f.subs.length === 4 && f.subs.includes('CLINICAL GUIDE') && f.subs.includes('CASE FILE'), `${tag} RECORDS shows its 4 sub-tabs (Patch 144: CASE FILE) ${JSON.stringify(f.subs)}`);
    ok(f.fits, `${tag} all four groups fit without scrolling`);
    ok(f.minH >= 44, `${tag} group tabs >= 44px (${f.minH})`);
    ok(f.hubBtn === 'none', `${tag} hub DESCEND hidden while the folder is open`);
    await page.screenshot({ path: `${S}/folder_${tag}.png` });

    // Group with a single pane hides the sub row; group click returns to the last pane.
    await page.click('.group-btn[data-group="synapses"]');
    await page.waitForTimeout(120);
    const syn = await page.evaluate(() => ({ pane: document.querySelector('.tab-pane.active').id, sub: getComputedStyle(document.querySelector('.folder-tabs')).display }));
    ok(syn.pane === 'tab-tree' && syn.sub === 'none', `${tag} SYNAPSES opens the tree with no sub-row`);
    await page.click('.group-btn[data-group="records"]');
    await page.click('.folder-tabs .tab-btn[data-target="tab-guide"]');
    await page.click('.group-btn[data-group="descend"]');
    await page.click('.group-btn[data-group="records"]');
    await page.waitForTimeout(120);
    ok(await page.evaluate(() => document.querySelector('.tab-pane.active').id) === 'tab-guide', `${tag} a group reopens on its last-used pane`);
    await page.click('.group-btn[data-group="loadout"]');
    await page.waitForTimeout(150);
    ok(await page.evaluate(() => document.querySelector('.tab-pane.active').id) === 'tab-loadout', `${tag} LOADOUT opens the regimen`);

    // --- close, then DESCEND by key (desktop) or tap (touch) --------------------
    await page.click('#btn-close-folder');
    await page.waitForTimeout(200);
    ok(await gs(page) === 'HUB', `${tag} back in the hub`);
    if (touch) await page.tap('#hub-descend'); else await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    ok(await gs(page) === 'PLAYING', `${tag} DESCEND (${touch ? 'tap' : 'Enter'}) starts a run (${await gs(page)})`);
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('hub-descend')).display) === 'none', `${tag} DESCEND hidden in a run`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    ok(await gs(page) === 'PLAYING', `${tag} Enter is inert during a run`);

    // --- a suspended run: DESCEND opens the machine's folder instead -------------
    await page.keyboard.press('p'); await page.waitForTimeout(100);
    await page.click('#btn-awaken'); await page.waitForTimeout(250);
    await page.click('#btn-restart'); await page.waitForTimeout(500);
    await page.evaluate(() => { window.__fractured.game.hubWorld.activeZone = null; });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    const sus = await page.evaluate(() => ({ gs: window.__fractured.gameState, folder: document.getElementById('clinical-folder-menu').style.display, pane: (document.querySelector('.tab-pane.active') || {}).id, resume: getComputedStyle(document.getElementById('btn-resume-run')).display }));
    ok(sus.gs === 'MENU' && sus.folder === 'flex' && sus.pane === 'tab-main' && sus.resume !== 'none',
       `${tag} with a suspended run, DESCEND opens EVALUATION with RESUME (${JSON.stringify(sus)})`);

    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
