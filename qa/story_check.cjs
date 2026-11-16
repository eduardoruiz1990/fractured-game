// Patches 142–147 (V2 plan E): the story layer, end to end in the real game.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
//   node qa/story_check.cjs <dir with sdkmock.js>
//
// Covers: the cold open (adds no click; the first key dismisses it; once per profile),
// a Case File page dropped, drifting in, filed, and its notice opening to the text;
// the CASE FILE pane; the boss banner's lines and the skip; the death subtitle; the
// session note on a floor clear and on AWAKEN; the first ending on a floor-5 clear
// (cards -> credits -> AWAKEN); the true ending with every page (-> RECURSE into floor
// 6); a replay from the pane; the content note in the Clinical Guide.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function boot(browser, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717, touch: true }, { width: 1280, height: 720, touch: false }]) {
    const tag = `${vp.width}x${vp.height}`;
    const { ctx, page, errors } = await boot(browser, vp);

    // --- E1: the cold open --------------------------------------------------------------
    await page.click('#btn-title-begin');
    await page.waitForTimeout(700);
    const c0 = await page.evaluate(() => {
      const el = document.getElementById('story-coldopen');
      return { shown: !!el, card: el && el.dataset.card, text: el ? el.innerText : '', pe: el ? getComputedStyle(el).pointerEvents : '',
               gs: window.__fractured.gameState, seen: window.__fractured.saveManager.metaState.story.coldOpenSeen };
    });
    ok(c0.shown && c0.card === '0' && /CONTENT NOTE/.test(c0.text) && /self-harm/.test(c0.text), `${tag} cold open starts on the content note`);
    ok(c0.gs === 'PLAYING' && c0.pe === 'none', `${tag} it adds no click: the game is PLAYING under it and it takes no pointer input (${c0.gs}, ${c0.pe})`);
    ok(c0.seen === true, `${tag} coldOpenSeen recorded when shown`);
    await page.waitForTimeout(3700);
    ok(await page.evaluate(() => (document.getElementById('story-coldopen') || {}).dataset?.card) === '1', `${tag} advances on its own`);
    const x0 = await page.evaluate(() => window.__fractured.game.state.player.x);
    await page.keyboard.down('d'); await page.waitForTimeout(400); await page.keyboard.up('d');
    await page.waitForTimeout(500);
    const c1 = await page.evaluate(() => ({ gone: !document.getElementById('story-coldopen'), x: window.__fractured.game.state.player.x }));
    ok(c1.gone, `${tag} the first key dismisses it`);
    ok(c1.x > x0 + 5, `${tag} and that key still moved the player (${Math.round(x0)} -> ${Math.round(c1.x)})`);

    // Out of the tutorial for the rest.
    await page.evaluate(() => { const f = window.__fractured, g = f.game; f.saveManager.metaState.tutorialCompleted = true; g.state.isTutorial = false; });

    // --- E3: a page, dropped and filed -------------------------------------------------------
    const drop = await page.evaluate(async () => {
      const g = window.__fractured.game;
      const { dropPage } = await import('/src/systems/CasePages.js');
      const p = dropPage(g, g.state.player.x + 200, g.state.player.y, 'boss', () => 0);
      return p && p.pageId;
    });
    ok(drop === 'p01', `${tag} a boss drop is the first page (${drop})`);
    await page.waitForTimeout(1500);
    const filed = await page.evaluate(() => ({ pages: Object.keys(window.__fractured.saveManager.metaState.story.pages),
      banner: document.getElementById('synergy-banner').innerText.replace(/\s+/g, ' ') }));
    ok(filed.pages.join() === 'p01', `${tag} it drifted in and was filed (${filed.pages})`);
    ok(/PAGE FILED · 1 \/ 25/.test(filed.banner) && /Attendance Slip/.test(filed.banner), `${tag} compact notice names it (${filed.banner.slice(0, 60)})`);
    if (vp.touch) await page.tap('#synergy-banner'); else await page.click('#synergy-banner');
    await page.waitForTimeout(200);
    const open = await page.evaluate(() => document.getElementById('synergy-banner').innerText.replace(/\s+/g, ' '));
    ok(/Bring your coat/.test(open) && /CHAPTER 1 · THE OFFICE/.test(open), `${tag} a tap opens the page text`);
    if (vp.touch) await page.tap('#synergy-banner'); else await page.click('#synergy-banner');

    // --- E4: the boss speaks, and can be skipped -------------------------------------------------
    await page.evaluate(() => { const g = window.__fractured.game; g.director.releaseRoomState(g.state); g.state.interactables = []; g.state.roomNumber = 5; g.director.spawnRoom(1, 5); });
    await page.waitForTimeout(400);
    const early = await page.evaluate(() => window.__fractured.renderer.bossAnnouncementTimer);
    await page.keyboard.press('k');   // inside the ~0.75 s arm: ignored
    const notSkipped = await page.evaluate(() => window.__fractured.renderer.bossAnnouncementTimer);
    ok(early > 195 && notSkipped > 150, `${tag} a key inside the first ~0.75 s does not skip (${early} -> ${notSkipped})`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${S}/story_banner_${tag}.png` });
    await page.keyboard.press('k');
    await page.waitForTimeout(30);
    const sk = await page.evaluate(() => ({ t: window.__fractured.renderer.bossAnnouncementTimer, hs: window.__fractured.game.state.hitStop }));
    ok(sk.t <= 30 && sk.hs <= 30, `${tag} a later key skips the banner and its freeze (${sk.t}, ${sk.hs})`);
    await page.waitForTimeout(700);
    await page.evaluate(() => { const g = window.__fractured.game; const b = g.state.entities.find(e => e.type === 'BOSS'); if (b) b.hp = -1; });
    await page.waitForTimeout(1200);
    const death = await page.evaluate(() => ({ sub: window.__fractured.game.state.subtitle,
      pages: window.__fractured.game.state.interactables.filter(o => o.type === 'CASE_PAGE').map(o => o.pageId) }));
    ok(death.sub && /Something did happen/.test(death.sub.text) && death.sub.steps > 0, `${tag} the boss's last line is up as a subtitle`);
    ok(death.pages.join() === 'p02', `${tag} the boss dropped the next page (${death.pages})`);
    await page.screenshot({ path: `${S}/story_subtitle_${tag}.png` });

    // --- E2: the session note -------------------------------------------------------------------------
    await page.evaluate(() => window.__fractured.game.onFloorComplete());
    await page.waitForTimeout(200);
    const note = await page.evaluate(() => { const n = document.getElementById('session-note'); return n ? { shown: getComputedStyle(n).display !== 'none', text: n.innerText.replace(/\s+/g, ' ') } : null; });
    ok(note && note.shown && /SESSION NOTE · FLOOR 1/.test(note.text) && /office door/.test(note.text), `${tag} a floor clear shows the clinician's note`);
    ok(!(await page.evaluate(() => !!document.getElementById('story-ending'))), `${tag} no ending off floor 1`);
    await page.click('#btn-awaken');
    await page.waitForTimeout(300);
    const an = await page.evaluate(() => (document.querySelector('#final-stats .session-note') || {}).innerText || '');
    ok(/END OF SESSION/.test(an) && /Stopping is allowed/.test(an), `${tag} AWAKEN ends with the end-of-session note`);

    // --- E5: the first ending on a floor-5 clear -----------------------------------------------------
    await page.evaluate(() => { document.getElementById('death-screen').style.display = 'none'; });
    // A new run (Game.init, as startNewRun does) cleared at floor 5.
    await page.evaluate(() => { const f = window.__fractured; f.game.init(f.saveManager, null); });
    await page.evaluate(() => { const f = window.__fractured, g = f.game; g.state.floor = 5; g.state.isTutorial = false; g.onFloorComplete(); });
    await page.waitForTimeout(200);
    const e0 = await page.evaluate(() => { const e = document.getElementById('story-ending'); return e ? { step: e.dataset.step, text: e.innerText.replace(/\s+/g, ' '),
      seen: window.__fractured.saveManager.metaState.story.endingSeen, gs: window.__fractured.gameState } : null; });
    ok(e0 && e0.step === 'card-0' && /THE ARCHITECT/.test(e0.text) && /holding a pencil/.test(e0.text), `${tag} first Architect clear: the first ending plays`);
    ok(e0 && e0.seen === true && e0.gs === 'EXIT_REACHED', `${tag} marked seen before it plays; the game waits on EXIT_REACHED`);
    await page.keyboard.press('Escape');   // skip -> credits; must not reach the pause handler
    await page.waitForTimeout(100);
    const cr = await page.evaluate(() => ({ step: document.getElementById('story-ending').dataset.step, text: document.getElementById('story-ending').innerText.replace(/\s+/g, ' '), gs: window.__fractured.gameState }));
    ok(cr.step === 'credits' && /The FRACTURED team/.test(cr.text) && cr.gs === 'EXIT_REACHED', `${tag} Escape skips to the credits (and nothing else)`);
    await page.screenshot({ path: `${S}/story_credits_${tag}.png` });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const ch = await page.evaluate(() => [...document.querySelectorAll('#story-ending button')].map(b => b.innerText));
    ok(ch.join() === 'AWAKEN,RECURSE', `${tag} the choice: ${ch}`);
    await page.screenshot({ path: `${S}/story_choice_${tag}.png` });
    await page.click('#story-ending .story-btn-awaken');
    await page.waitForTimeout(300);
    const aw = await page.evaluate(() => ({ gs: window.__fractured.gameState, title: document.querySelector('#death-screen .title-typewriter').innerText, gone: !document.getElementById('story-ending') }));
    ok(aw.gone && aw.gs === 'DEAD' && /CONSCIOUSNESS RETAINED/.test(aw.title), `${tag} AWAKEN extracts (${aw.gs}, ${aw.title})`);
    await page.evaluate(() => { const f = window.__fractured; f.game.init(f.saveManager, null); const g = f.game; g.state.floor = 5; g.onFloorComplete(); });
    await page.waitForTimeout(100);
    ok(!(await page.evaluate(() => !!document.getElementById('story-ending'))), `${tag} the first ending plays once`);

    // --- E5: the true ending, every page filed -> RECURSE -----------------------------------------------
    await page.evaluate(() => { document.getElementById('pause-menu').style.display = 'none'; document.getElementById('death-screen').style.display = 'none';
      const f = window.__fractured; for (let i = 1; i <= 25; i++) f.saveManager.collectPage('p' + String(i).padStart(2, '0'));
      f.game.init(f.saveManager, null); const g = f.game; g.state.floor = 5; g.onFloorComplete(); });
    await page.waitForTimeout(150);
    const t0 = await page.evaluate(() => (document.getElementById('story-ending') || {}).innerText || '');
    ok(/See you tonight, kiddo/.test(t0), `${tag} every page filed: the true ending plays`);
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(60); }
    ok(await page.evaluate(() => document.getElementById('story-ending').dataset.step) === 'choice', `${tag} Enter walks the cards and credits to the choice`);
    await page.click('#story-ending .story-btn-recurse');
    await page.waitForTimeout(800);
    const rc = await page.evaluate(() => ({ gs: window.__fractured.gameState, floor: window.__fractured.game.state.floor, s: window.__fractured.saveManager.metaState.story }));
    ok(rc.gs === 'PLAYING' && rc.floor === 6, `${tag} RECURSE descends into floor 6 (${rc.gs}, ${rc.floor})`);
    ok(rc.s.trueEndingSeen && rc.s.endingSeen, `${tag} both endings recorded`);

    // --- replays and the content note in the menus -------------------------------------------------------
    await page.evaluate(() => { window.__fractured.uiManager.updateMenuUI(); document.getElementById('clinical-folder-menu').style.display = 'flex';
      document.querySelector('.group-btn[data-group="records"]').click(); document.querySelector('.tab-btn[data-target="tab-casefile"]').click(); });
    await page.waitForTimeout(200);
    const pane = await page.evaluate(() => ({ pages: document.querySelectorAll('#tab-casefile details').length, missing: document.querySelectorAll('#tab-casefile .casefile-missing').length,
      replays: [...document.querySelectorAll('.casefile-replay')].map(b => b.dataset.ending) }));
    ok(pane.pages === 25 && pane.missing === 0 && pane.replays.join() === 'first,true', `${tag} CASE FILE: 25 pages, both replays (${JSON.stringify(pane)})`);
    await page.click('.casefile-replay[data-ending="true"]');
    await page.waitForTimeout(100);
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(60); }
    const rp = await page.evaluate(() => [...document.querySelectorAll('#story-ending button')].map(b => b.innerText));
    ok(rp.join() === 'CLOSE FILE', `${tag} a replay ends in CLOSE FILE, not the choice (${rp})`);
    await page.click('#story-ending button');
    ok(await page.evaluate(() => !document.getElementById('story-ending') && window.__fractured.gameState === 'PLAYING'), `${tag} closing a replay changes nothing`);
    ok(await page.evaluate(() => /no self-harm/.test((document.getElementById('guide-content-note') || {}).innerText || '')), `${tag} the content note heads the Clinical Guide`);
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }

  // A second visit to the tutorial on the same profile: no cold open (simulated reload).
  {
    const { ctx, page } = await boot(browser, { width: 1280, height: 720, touch: false });
    await page.evaluate(() => { window.__fractured.saveManager.metaState.story.coldOpenSeen = true; });
    await page.click('#btn-title-begin');
    await page.waitForTimeout(600);
    ok(!(await page.evaluate(() => !!document.getElementById('story-coldopen'))), 'cold open plays once per profile');
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
