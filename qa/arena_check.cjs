// Patch 137 (V2 plan D5): each floor's room shape drawn in game (lit and in the dark),
// the player held by the walls, and the walls lowered on the clear.
// Assertion-based: exits 1 on any failure. Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript({ path: S + '/sdkmock.js' });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.click('#btn-title-begin');
  await page.waitForTimeout(800);

  const floors = { LOCKERS: 1, PILLARS: 2, YARD: 3, WARDS: 4, BLUEPRINT: 5 };
  for (const [id, floor] of Object.entries(floors)) {
    await page.evaluate(async ({ id, floor }) => {
      const { raiseArena } = await import('/src/systems/Arena.js');
      const g = window.__fractured.game, s = g.state;
      s.isTutorial = false; s.tutorialFreeze = false; s.floor = floor;
      s.sanity = s.player.maxHp = 9999; s.level = 60;
      s.roomCleared = false; s.combatActive = true; s.enemyBudget = 999; s.bossSpawned = false;
      raiseArena(s, id, s.player.x, s.player.y);
    }, { id, floor });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${S}/arena_${id}.png` });
    // Walk into the first solid wall for a second: the player must end up outside it.
    const r = await page.evaluate(async () => {
      const { overlaps } = await import('/src/systems/Arena.js');
      const s = window.__fractured.game.state;
      const o = s.obstacles.find(o => o.solid && !o.cap);
      s.player.x = o.x; s.player.y = o.kind === 'arc' ? o.y + o.r : o.y;   // dropped straight into it
      await new Promise(r => setTimeout(r, 200));
      return { inside: s.obstacles.some(w => w.solid && overlaps(w, s.player.x, s.player.y, (s.player.radius || 12) - 0.5)),
               n: s.obstacles.length, layout: s.arenaLayout };
    });
    ok(r.layout === id && r.n > 0 && !r.inside, `${id}: ${r.n} walls, a player dropped into one is pushed out`);
  }

  // The Blueprint after a shift: telegraphs are drawn.
  await page.evaluate(async () => {
    const { GRID_SHIFT_STEPS } = await import('/src/systems/Arena.js');
    window.__fractured.game.state.arenaShiftTimer = GRID_SHIFT_STEPS - 2;
  });
  await page.waitForTimeout(500);
  const tele = await page.evaluate(() => window.__fractured.game.state.obstacles.filter(o => o.telegraph > 0).length);
  ok(tele === 3, `the Blueprint telegraphs 3 rising blocks (${tele})`);
  await page.screenshot({ path: `${S}/arena_BLUEPRINT_shift.png` });

  // Clear: the walls sink and are gone.
  await page.evaluate(() => { const g = window.__fractured.game, s = g.state; g.director.releaseRoomState(s); s.enemyBudget = 0; });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => { const s = window.__fractured.game.state; return { n: s.obstacles.length, cleared: s.roomCleared }; });
  ok(after.cleared && after.n === 0, `the clear lowers the walls (${JSON.stringify(after)})`);

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
