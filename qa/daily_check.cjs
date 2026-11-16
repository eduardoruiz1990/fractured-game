// Patch 140 (V2 plan D7): the Daily Session — hidden for a first-time player, shown
// after the tutorial, the dialog, a run with the day's Patient and thought, the score on
// the death screen, and no second attempt the same day (also after a reload).
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 1280, height: 720 }]) {
    const tag = `${vp.width}x${vp.height}`;
    const touch = vp.width < 1000;
    const ctx = await browser.newContext({ viewport: vp, hasTouch: touch });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    // The mock's store is in memory; back it with sessionStorage so a reload keeps the save.
    await page.addInitScript(() => {
      const d = window.CrazyGames.SDK.data;
      d.getItem = k => sessionStorage.getItem('mock:' + k);
      d.setItem = (k, v) => sessionStorage.setItem('mock:' + k, String(v));
      d.removeItem = k => sessionStorage.removeItem('mock:' + k);
    });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const vis = () => page.evaluate(() => { const b = document.getElementById('btn-title-daily'); return !!b && getComputedStyle(b).display !== 'none'; });
    ok(!(await vis()), `${tag} a first-time title has no Daily Session`);

    // A returning player.
    await page.evaluate(() => { const sm = window.__fractured.saveManager; sm.metaState.tutorialCompleted = true; sm.saveGame(); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    ok(await vis(), `${tag} shown once the tutorial is done`);
    const label = await page.evaluate(() => document.getElementById('btn-title-daily').innerText.replace(/\s+/g, ' '));
    const onScreen = await page.evaluate(() => { const r = document.getElementById('btn-title-daily').getBoundingClientRect(); return r.bottom <= innerHeight && r.height >= 44; });
    ok(/DAILY SESSION/.test(label) && onScreen, `${tag} title entry: ${label}`);
    await page.screenshot({ path: `${S}/daily_title_${tag}.png` });

    await page.click('#btn-title-daily');
    await page.waitForTimeout(200);
    const dlg = await page.evaluate(() => ({ t: document.getElementById('confirm-title').innerText, b: document.getElementById('confirm-body').innerText }));
    ok(/DAILY SESSION/.test(dlg.t) && /One attempt/.test(dlg.b), `${tag} dialog: ${dlg.b.slice(0, 80)}`);
    await page.screenshot({ path: `${S}/daily_dialog_${tag}.png` });
    await page.click('#btn-confirm-accept');
    await page.waitForTimeout(900);
    const run = await page.evaluate(async () => {
      const { dailySetup, dailyKey } = await import('/src/systems/Daily.js');
      const s = window.__fractured.game.state, set = dailySetup(dailyKey());
      return { gs: window.__fractured.gameState, daily: !!s.daily, patientOk: s.player.character === set.patient, curseOk: s.player.curses.includes(set.curse) };
    });
    ok(run.gs === 'PLAYING' && run.daily && run.patientOk && run.curseOk, `${tag} the day's run (${JSON.stringify(run)})`);

    // Clear a couple of rooms' worth (as data), then fall.
    await page.evaluate(() => { const s = window.__fractured.game.state; s.roomNumber = 3; s.runKills = 42; s.sanity = 0; });
    await page.waitForFunction(() => document.getElementById('death-screen').style.display === 'flex', null, { timeout: 5000 }).catch(() => {});
    const death = await page.evaluate(() => document.getElementById('death-cause').textContent);
    ok(/DAILY SESSION: 242 · NEW BEST/.test(death), `${tag} death screen: ${(death.match(/DAILY SESSION[^A-Z]*[A-Z ]*/) || [death.slice(0, 120)])[0]}`);

    // No second attempt — also after a reload.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    const done = await page.evaluate(() => document.getElementById('btn-title-daily').innerText.replace(/\s+/g, ' '));
    ok(/DONE/.test(done) && /TODAY 242/.test(done), `${tag} after: ${done}`);
    await page.click('#btn-title-daily');
    await page.waitForTimeout(200);
    const notice = await page.evaluate(() => document.getElementById('confirm-title').innerText);
    await page.click('#btn-confirm-accept');
    await page.waitForTimeout(300);
    ok(/SESSION ON FILE/.test(notice), `${tag} a second click only explains (${notice})`);
    const still = await page.evaluate(() => window.__fractured.gameState);
    ok(still === 'TITLE', `${tag} and starts nothing (${still})`);
    if (!touch) await page.mouse.move(2, 2);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${S}/daily_done_${tag}.png` });

    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
