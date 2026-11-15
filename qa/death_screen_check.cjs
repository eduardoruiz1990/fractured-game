// Patch 124 (V2 plan C4): the death screen — cause line, four-number strip, PLAY AGAIN
// straight into a fresh run, and AWAKEN getting the old single-button layout back.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 915, height: 412 }, { width: 1280, height: 720 }]) {
    const page = await browser.newPage({ viewport: vp, hasTouch: vp.width < 1000 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => { errors.push('NATIVE DIALOG'); d.dismiss(); });
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    await page.click('#btn-title-begin');
    await page.waitForTimeout(1200);
    const tag = `${vp.width}x${vp.height}`;
    const vis = id => page.evaluate(i => { const e = document.getElementById(i); return !!e && getComputedStyle(e).display !== 'none' && e.offsetParent !== null; }, id);
    const inView = id => page.evaluate(i => { const r = document.getElementById(i).getBoundingClientRect(); return r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1; }, id);

    await page.evaluate(() => { const g = window.__fractured.game; Object.assign(g.state, { floor: 2, roomNumber: 3, runKills: 41, runFrames: 60 * 125, level: 7, lucidity: 80, lastDamageSource: 'PREDATOR', bestFloorAtStart: 1 }); g.state.sanity = 0; });
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => window.__fractured.gameState) === 'DEAD', `${tag} died`);
    const cause = await page.evaluate(() => document.getElementById('death-cause').innerText);
    ok(/Broken by HALL MONITORS/.test(cause), `${tag} cause names the bestiary entry: ${JSON.stringify(cause)}`);
    ok(/Floor 2, room 3\/5/.test(cause) && /2:05 survived/.test(cause), `${tag} cause has floor/room/time`);
    ok(/NEW DEEPEST FLOOR: 2/.test(cause), `${tag} new-deepest marker`);
    const stats = await page.evaluate(() => document.getElementById('death-stats').innerText.replace(/\s+/g, ' '));
    ok(/2:05/.test(stats) && /41/.test(stats) && /7/.test(stats) && /40/.test(stats), `${tag} stats strip: ${stats}`);
    ok(await vis('btn-play-again'), `${tag} PLAY AGAIN visible`);
    ok(await inView('btn-play-again'), `${tag} PLAY AGAIN on screen without scrolling, >=44px`);
    ok(await page.evaluate(() => document.getElementById('btn-restart').classList.contains('secondary')), `${tag} RETURN TO WARD is secondary`);
    ok(await page.evaluate(() => { const d = document.querySelector('#final-stats details.death-file'); return !!d && !d.open; }), `${tag} case file folded`);
    await page.screenshot({ path: `${S}/death_${tag}.png` });

    await page.click('#btn-play-again');
    await page.waitForTimeout(800);
    const fresh = await page.evaluate(() => { const f = window.__fractured, s = f.game.state; return { gs: f.gameState, floor: s.floor, kills: s.runKills, level: s.level, src: s.lastDamageSource, death: getComputedStyle(document.getElementById('death-screen')).display, hud: getComputedStyle(document.getElementById('ui-layer')).display }; });
    ok(fresh.gs === 'PLAYING' && fresh.kills === 0 && fresh.level === 1 && fresh.src !== 'PREDATOR', `${tag} PLAY AGAIN -> fresh run ${JSON.stringify(fresh)}`);
    ok(fresh.death === 'none' && fresh.hud !== 'none', `${tag} death screen hidden, HUD shown`);

    // AWAKEN reuses the folder: no cause/stats/PLAY AGAIN, btn-restart primary again.
    await page.evaluate(() => { document.getElementById('btn-awaken').click(); });
    await page.waitForTimeout(400);
    ok(!(await vis('btn-play-again')) && !(await vis('death-cause')) && !(await vis('death-stats')), `${tag} AWAKEN hides death-only parts`);
    ok(await page.evaluate(() => document.getElementById('btn-restart').classList.contains('primary')), `${tag} AWAKEN btn-restart primary`);
    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
