// Patch 159 (release candidate): the text on every screen a player can reach.
// QA_CHECKLIST §7 asks for "no placeholder text ('TODO', 'lorem', raw ids like
// lead_pipe) on any screen" and credits that name no person. This walks the title,
// Settings, the hub and every folder tab, a run's HUD, the level-up cards, pause, the
// death screen and the ending with its credits, and fails on any of:
//   - placeholder words: TODO, FIXME, lorem, placeholder
//   - leaked values: undefined, NaN, null, [object ...], Infinity
//   - raw ids: a lowercase snake_case word (lead_pipe, broken_chalk, tab_trophies)
//   - an email address anywhere, and credits other than the generic team line
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
//   node qa/text_check.cjs <dir with sdkmock.js>
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const BAD = [
  [/\b(TODO|FIXME|lorem|ipsum|placeholder)\b/i, 'placeholder word'],
  [/\bundefined\b|\bNaN\b|\[object [A-Za-z]+\]|\bInfinity\b/, 'leaked value'],
  [/(^|[^\w.])null\b/, 'leaked null'],
  [/\b[a-z]+_[a-z]+(?:_[a-z]+)*\b/, 'raw snake_case id'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'email address']
];

const seen = new Map();   // screen -> text
function scan(screen, text) {
  seen.set(screen, text);
  for (const [re, what] of BAD) {
    const lines = text.split('\n').filter(l => re.test(l));
    ok(lines.length === 0, `${screen}: no ${what}${lines.length ? ' -> ' + JSON.stringify(lines.slice(0, 4).map(l => l.trim().slice(0, 120))) : ''}`);
  }
}
const visibleText = page => page.evaluate(() => document.body.innerText);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const gs = () => page.evaluate(() => window.__fractured.gameState);

  // --- title and Settings ---------------------------------------------------------------
  scan('title', await visibleText(page));
  await page.click('#btn-title-settings');
  await page.waitForTimeout(200);
  const settings = await visibleText(page);
  scan('settings', settings);
  ok(/build \d+\.\d+\.\d+-/.test(settings), 'settings: shows the build id');
  await page.click('#btn-close-settings');
  await page.waitForTimeout(150);

  // --- the hub and every folder pane --------------------------------------------------------
  await page.click('#btn-title-hub');
  await page.waitForTimeout(700);
  ok(await gs() === 'HUB', 'reached the hub');
  scan('hub', await visibleText(page));
  for (const action of ['tab-main', 'tab-tree', 'tab-loadout', 'tab-trophies']) {
    await page.evaluate(a => { const g = window.__fractured.game, z = g.hubWorld.zones.find(z => z.action === a); g.state.player.x = z.x; g.state.player.y = z.y; }, action);
    await page.waitForFunction(a => { const z = window.__fractured.game.hubWorld.activeZone; return z && z.action === a; }, action, { timeout: 3000 }).catch(() => {});
    await page.keyboard.press('e');
    await page.waitForTimeout(250);
    const groups = await page.$$eval('.folder-groups .group-btn', bs => bs.map(b => b.dataset.group));
    for (const g of groups) {
      await page.click(`.group-btn[data-group="${g}"]`);
      await page.waitForTimeout(120);
      const subs = await page.$$eval('.folder-tabs .tab-btn', bs => bs.filter(b => getComputedStyle(b).display !== 'none').map(b => b.dataset.tab || b.textContent));
      if (!subs.length) { scan(`folder ${g}`, await visibleText(page)); continue; }
      for (let i = 0; i < subs.length; i++) {
        await page.evaluate(i => [...document.querySelectorAll('.folder-tabs .tab-btn')].filter(b => getComputedStyle(b).display !== 'none')[i].click(), i);
        await page.waitForTimeout(150);
        scan(`folder ${g} / ${subs[i]}`, await visibleText(page));
      }
    }
    // close the folder (Escape, or its close button)
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    if (await page.evaluate(() => { const f = document.getElementById('clinical-folder-menu'); return f && f.style.display === 'flex'; })) {
      await page.evaluate(() => { const b = document.querySelector('#clinical-folder-menu .btn-close-folder, #btn-close-folder'); if (b) b.click(); });
      await page.waitForTimeout(200);
    }
    break;   // every group is reachable from one desk; the loop above covered them all
  }

  // --- a run: HUD, level-up, pause, death -------------------------------------------------
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.evaluate(() => { const m = window.__fractured.saveManager.metaState; m.tutorialCompleted = true; m.story.coldOpenSeen = true; });
  await page.click('#btn-title-begin');
  await page.waitForTimeout(1200);
  ok(await gs() === 'PLAYING', 'started a run');
  scan('run HUD', await visibleText(page));
  await page.evaluate(() => window.__fractured.game.onLevelUp());
  await page.waitForTimeout(500);
  scan('level-up cards', await visibleText(page));
  await page.evaluate(() => { const ui = window.__fractured.levelUpUI; ui.armedAt = 0; ui.tryPick(0); });
  await page.waitForTimeout(300);
  await page.keyboard.press('p');
  await page.waitForTimeout(250);
  ok(await gs() === 'PAUSED', 'paused');
  scan('pause', await visibleText(page));
  await page.keyboard.press('p');
  await page.waitForTimeout(250);
  await page.evaluate(() => { const g = window.__fractured.game; Object.assign(g.state, { floor: 2, roomNumber: 3, runKills: 12, lastDamageSource: 'PREDATOR' }); g.state.sanity = 0; });
  await page.waitForTimeout(900);
  ok(await gs() === 'DEAD', 'died');
  scan('death screen', await visibleText(page));

  // --- the ending and credits ---------------------------------------------------------------
  await page.evaluate(() => { document.getElementById('death-screen').style.display = 'none'; });
  await page.evaluate(() => { const f = window.__fractured; f.game.init(f.saveManager, null); });
  await page.evaluate(() => { const f = window.__fractured, g = f.game; g.state.floor = 5; g.state.isTutorial = false; g.onFloorComplete(); });
  await page.waitForTimeout(400);
  let guard = 0;
  while (guard++ < 30) {
    const step = await page.evaluate(() => { const e = document.getElementById('story-ending'); return e ? e.dataset.step : null; });
    if (!step) break;
    scan(`ending (${step}) #${guard}`, await visibleText(page));
    if (step === 'credits') {
      const credits = await page.evaluate(() => [...document.querySelectorAll('.story-credit')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
      const made = credits.find(c => /^MADE BY/.test(c)) || '';
      ok(made === 'MADE BY The FRACTURED team', `credits: generic team line only (${JSON.stringify(made)})`);
    }
    if (step === 'choice') break;
    const advanced = await page.evaluate(() => { const b = [...document.querySelectorAll('#story-ending button')].find(b => getComputedStyle(b).display !== 'none' && /NEXT|CONTINUE|›|→/i.test(b.textContent)); if (b) { b.click(); return true; } return false; });
    if (!advanced) break;
    await page.waitForTimeout(250);
  }
  ok([...seen.keys()].some(k => k.startsWith('ending (credits)')), 'reached the credits');

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  console.log(`screens scanned: ${seen.size}`);
  await browser.close();
  if (fails) { console.log(`FAIL (${fails})`); process.exit(1); }
  console.log('ALL PASS');
})();
