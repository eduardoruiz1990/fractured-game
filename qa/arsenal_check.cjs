// Patch 132 (V2 plan D3): the four Phase D weapons in the real game, the six-slot cap,
// and their level-up cards. Assertion-based: exits 1 on any failure. Needs the dev
// server on :5199.
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

  // --- all four firing at once, among real enemies ------------------------------
  await page.evaluate(() => {
    const g = window.__fractured.game, s = g.state, W = s.player.weapons;
    s.isTutorial = false; s.tutorialFreeze = false;
    for (const id of ['pill_bottle', 'metronome', 'straitjacket', 'lullaby']) W[id].level = 3;
    W.straitjacket.straps = 4;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.director.spawnEntity('SCAVENGER', null, null, s.player.x + Math.cos(a) * 160, s.player.y + Math.sin(a) * 160);
    }
    s.sanity = s.player.maxHp = 9999;
    window.__seen = { shots: 0, rings: 0, notes: 0 };
    const tick = () => {
      window.__seen.shots = Math.max(window.__seen.shots, s.playerShots.length);
      window.__seen.rings = Math.max(window.__seen.rings, s.pulseRings.length);
      window.__seen.notes = Math.max(window.__seen.notes, s.lullabyNotes.length);
      if (!window.__stopSeen) requestAnimationFrame(tick);
    };
    tick();
  });
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${S}/arsenal_fight.png` });
  await page.waitForTimeout(1600);
  const seen = await page.evaluate(() => { window.__stopSeen = true; const s = window.__fractured.game.state; return { ...window.__seen, kills: s.runKills }; });
  ok(seen.shots > 0, `pill bottles thrown (${seen.shots} in flight at peak)`);
  ok(seen.rings > 0, `metronome pulses (${seen.rings})`);
  ok(seen.notes > 0, `lullaby notes (${seen.notes})`);
  ok(seen.kills > 0, `the new weapons kill (${seen.kills})`);

  // --- level-up card for a new weapon reads like the others ------------------------
  const card = await page.evaluate(async () => {
    const g = window.__fractured.game, W = g.state.player.weapons;
    for (const id in W) W[id].level = id === 'flashlight' ? 1 : 0;
    W.metronome.level = 2;
    const ui = window.__fractured.levelUpUI;
    for (let i = 0; i < 80; i++) {
      g.onLevelUp();
      const h = [...document.querySelectorAll('#cards-container .card h3')].map(x => x.textContent);
      const idx = h.indexOf('Metronome');
      if (idx >= 0) {
        const c = document.querySelectorAll('#cards-container .card')[idx];
        const txt = c.textContent;
        ui.close(); window.__fractured.gameState = 'PLAYING';
        return txt;
      }
      ui.close();
    }
    return null;
  });
  await page.evaluate(() => { document.getElementById('level-up-modal').style.display = 'none'; });
  ok(card && /Damage 14 → 20/.test(card) && /Pulse reach 200 → 230/.test(card) && /LVL 2 → 3/.test(card),
     `Metronome card states its numbers (${card && card.replace(/\s+/g, ' ').trim().slice(0, 120)})`);

  // --- six slots: no NEW weapon card once six are owned ----------------------------
  const cap = await page.evaluate(() => {
    const g = window.__fractured.game, W = g.state.player.weapons, ui = window.__fractured.levelUpUI;
    const ids = Object.keys(W);
    ids.forEach((id, i) => { W[id].level = i < 6 ? 1 : 0; });
    let newCards = 0;
    for (let i = 0; i < 40; i++) {
      g.onLevelUp();
      newCards += [...document.querySelectorAll('#cards-container .card-badge-new')].length;
      ui.close();
    }
    W[ids[5]].level = 0;   // five owned: new weapons come back
    let newAt5 = 0;
    for (let i = 0; i < 40; i++) {
      g.onLevelUp();
      newAt5 += [...document.querySelectorAll('#cards-container .card-badge-new')].length;
      ui.close();
    }
    return { newCards, newAt5 };
  });
  ok(cap.newCards === 0, `with six weapons owned, no NEW weapon is offered (${cap.newCards} in 40 draws)`);
  ok(cap.newAt5 > 0, `with five owned, new weapons are offered again (${cap.newAt5})`);

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
