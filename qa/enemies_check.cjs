// Patch 135 (V2 plan D4): the Photocopy, the Fire Warden and the Crawlspace drawn in
// the real game (frozen in place for the screenshot), the Photocopy's split, and the
// Crawlspace's lit warning ring. Assertion-based: exits 1 on any failure. Needs the
// dev server on :5199.
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

  const spawned = await page.evaluate(() => {
    const g = window.__fractured.game, s = g.state;
    s.isTutorial = false; s.tutorialFreeze = false; s.stress = 1; s.level = 60;
    s.sanity = s.player.maxHp = 9999;
    s.player.weapons.flashlight.radius = 0;
    const at = (t, dx, dy) => { const e = g.director.spawnEntity(t, null, null, s.player.x + dx, s.player.y + dy); return e; };
    const sp = at('SPLITTER', -150, -60);
    const wa = at('WARDEN', 0, -170);
    const sc = at('SCAVENGER', 50, -200);
    const b1 = at('BURROWER', 160, 40); b1.burrowState = 'warning'; b1.burrowTimer = 999; b1.burrowed = true;
    const b2 = at('BURROWER', -160, 110); b2.burrowState = 'exposed'; b2.burrowTimer = 999; b2.burrowed = false;
    s.devFreezeEntities = true;
    wa.update = () => {};
    // one ward pass so the scavenger shows the shield arc
    s.entities.forEach(e => { if (e !== wa && Math.hypot(e.x - wa.x, e.y - wa.y) < 150) e.shieldTimer = 9999; });
    return s.entities.map(e => e.type);
  });
  ok(['SPLITTER', 'WARDEN', 'BURROWER'].every(t => spawned.includes(t)), `spawned ${spawned.join(', ')}`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${S}/enemies_new.png` });

  const split = await page.evaluate(() => {
    const g = window.__fractured.game, s = g.state;
    s.devFreezeEntities = false;
    const sp = s.entities.find(e => e.type === 'SPLITTER' && e.generation === 1);
    sp.hp = 0;
    return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() =>
      r(s.entities.filter(e => e.type === 'SPLITTER').map(e => e.generation)))));
  });
  ok(split.length === 2 && split.every(g => g === 2), `the Photocopy split into ${JSON.stringify(split)}`);
  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
