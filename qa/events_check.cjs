// Patch 138 (V2 plan D5): the three room events in game — the Power Outage (dark, the
// breaker found and powered with the flashlight), the Lockdown (HUD timer, the lift and
// its chest) and the Session Bell (a wave with a named elite), with their notices.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
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
  // Record every event notice main.js is asked to show.
  await page.evaluate(() => {
    const g = window.__fractured.game, orig = g.onRoomEvent;
    window.__notices = [];
    g.onRoomEvent = (e) => { window.__notices.push(e.name); orig(e); };
  });

  const arm = (id, budget) => page.evaluate(async ({ id, budget }) => {
    const { armRoomEvent } = await import('/src/systems/RoomEvents.js');
    const g = window.__fractured.game, s = g.state;
    s.isTutorial = false; s.tutorialFreeze = false; s.floor = 3;
    s.sanity = s.player.maxHp = 9999; s.level = 60;
    s.roomCleared = false; s.combatActive = true; s.bossSpawned = false; s.roomModifier = null;
    s.enemyBudget = budget;
    armRoomEvent(s, id);
    s.enemyBudget = Math.min(budget, s.roomEvent.trigger === Infinity ? budget : s.roomEvent.trigger);
  }, { id, budget });
  const banner = () => page.evaluate(() => { const b = document.getElementById('synergy-banner'); return b && b.style.display !== 'none' ? b.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const hud = () => page.evaluate(() => document.getElementById('enemy-counter').textContent);

  // --- Power Outage ---------------------------------------------------------------
  await arm('POWER_OUTAGE', 40);
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => { const s = window.__fractured.game.state; return { p: s.powerOut, box: !!s.interactables.find(o => o.type === 'BREAKER_BOX' && o.roomEvent) }; });
  ok(out.p > 0 && out.box, `outage: lights out and a breaker (${JSON.stringify(out)})`);
  ok(/POWER OUTAGE/.test(await banner()), 'outage notice shown');
  ok(/POWER OUT/.test(await hud()), `outage HUD: ${await hud()}`);
  await page.screenshot({ path: `${S}/event_outage.png` });
  // Bring the breaker into the beam (the real aim comes from the input every frame).
  await page.evaluate(() => {
    const s = window.__fractured.game.state;
    const box = s.interactables.find(o => o.type === 'BREAKER_BOX');
    window.__aim = setInterval(() => { box.x = s.player.x + Math.cos(s.player.angle) * 150; box.y = s.player.y + Math.sin(s.player.angle) * 150; }, 4);
  });
  await page.waitForFunction(() => window.__fractured.game.state.powerOut === 0, null, { timeout: 6000 }).catch(() => {});
  await page.evaluate(() => clearInterval(window.__aim));
  await page.waitForTimeout(100);
  const rest = await page.evaluate(() => window.__fractured.game.state.roomEvent);
  ok(rest && rest.phase === 'done', `the outage ended (${rest && rest.phase}, restored=${rest && rest.restored})`);

  // --- Lockdown -------------------------------------------------------------------
  await page.waitForTimeout(3500);
  await arm('LOCKDOWN', 40);
  await page.waitForTimeout(600);
  const lh = await hud();
  ok(/^LOCKDOWN · SURVIVE \d+s$/.test(lh), `lockdown HUD: ${lh}`);
  await page.screenshot({ path: `${S}/event_lockdown.png` });
  await page.waitForTimeout(1200);   // past the 1.5 s warning
  await page.evaluate(() => { window.__fractured.game.state.lockdown = 3; });
  await page.waitForTimeout(400);
  const lift = await page.evaluate(() => { const s = window.__fractured.game.state; return { phase: s.roomEvent.phase, chest: s.interactables.some(o => o.type === 'CHEST'), regular: s.entities.filter(e => !e.elite).length }; });
  ok(lift.phase === 'done' && lift.chest && lift.regular === 0, `lockdown lifted: crowd dissolved, chest dropped (${JSON.stringify(lift)})`);

  // --- Session Bell -----------------------------------------------------------------
  await page.waitForTimeout(3500);
  await page.evaluate(() => { const g = window.__fractured.game; g.director.releaseRoomState(g.state); g.state.interactables = []; });
  await arm('SESSION_BELL', 40);
  await page.waitForTimeout(400);
  const bell = await page.evaluate(() => { const s = window.__fractured.game.state; return { n: s.entities.length, elites: s.entities.filter(e => e.elite).length }; });
  ok(bell.n >= 5 && bell.elites === 1, `bell: a wave of ${bell.n}, ${bell.elites} named elite`);
  const names = await page.evaluate(() => window.__notices);
  ok(JSON.stringify(names) === JSON.stringify(['POWER OUTAGE', 'POWER RESTORED', 'LOCKDOWN', 'LOCKDOWN LIFTED', 'SESSION BELL']), `notices in order: ${JSON.stringify(names)}`);
  await page.waitForTimeout(3600);
  await page.screenshot({ path: `${S}/event_bell.png` });

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
