// Patch 139 (V2 plan D7): achievements and instrument unlocks in game — the "Admitted"
// notice on a first descent, locked instruments never offered, an unlock announced
// mid-run and joining the pool, the Mind Palace sections, the death-screen line.
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
  // Record every notice pushed.
  await page.click('#btn-title-begin');
  await page.waitForTimeout(800);
  const banner = () => page.evaluate(() => { const b = document.getElementById('synergy-banner'); return b && b.style.display !== 'none' ? b.textContent.replace(/\s+/g, ' ').trim() : ''; });
  const t0 = await banner();
  ok(!/ACHIEVEMENT/.test(t0), `the tutorial is not interrupted by achievements (${t0 || 'no notice'})`);
  // The tutorial done: the next check announces what was held.
  await page.evaluate(() => { const s = window.__fractured.game.state; window.__fractured.saveManager.metaState.tutorialCompleted = true; s.isTutorial = false; s.tutorialFreeze = false; });
  await page.waitForFunction(() => /Admitted/.test((document.getElementById('synergy-banner') || {}).textContent || ''), null, { timeout: 7000 }).catch(() => {});
  const first = await banner();
  ok(/ACHIEVEMENT/.test(first) && /Admitted/.test(first), `after the tutorial: ${first}`);

  // Locked instruments are never offered.
  const offered = await page.evaluate(() => {
    const g = window.__fractured.game, s = g.state, ui = window.__fractured.levelUpUI;
    s.isTutorial = false; s.tutorialFreeze = false;
    const names = new Set();
    for (let i = 0; i < 120; i++) {
      g.onLevelUp();
      document.querySelectorAll('#cards-container .card').forEach(c => names.add(c.textContent));
      ui.close();
    }
    return { locked: s.player.lockedWeapons.slice().sort(), text: [...names].join('|') };
  });
  await page.evaluate(() => { const g = window.__fractured.game, ui = window.__fractured.levelUpUI; g.onLevelUp(); ui.armedAt = 0; ui.tryPick(0); });
  ok(offered.locked.join() === 'lullaby,metronome,straitjacket', `fresh profile: ${offered.locked}`);
  ok(!/Metronome|Straitjacket Straps|Lullaby/.test(offered.text) && /Pill Bottle/.test(offered.text), 'no locked instrument in 120 level-ups; the Pill Bottle is offered');

  // A named elite falls: the Straps unlock mid-run, announced, and join this run's pool.
  await page.evaluate(() => {
    const sm = window.__fractured.saveManager, s = window.__fractured.game.state;
    sm.recordKill('ELITE');
    s.sanity = s.player.maxHp = 9999;
    window.__seen = [];
    const b = document.getElementById('synergy-banner');
    new MutationObserver(() => window.__seen.push(b.textContent.replace(/\s+/g, ' ').trim())).observe(b, { childList: true, subtree: true });
  });
  await page.waitForFunction(() => !window.__fractured.game.state.player.lockedWeapons.includes('straitjacket'), null, { timeout: 8000 }).catch(() => {});
  // Notices queue behind whatever is showing; wait for ours to come up.
  await page.waitForFunction(() => window.__seen.some(t => /Named and Faced|NEW INSTRUMENT/.test(t)), null, { timeout: 12000 }).catch(() => {});
  const mid = await page.evaluate(() => ({ locked: window.__fractured.game.state.player.lockedWeapons.slice(), seen: window.__seen.join(' || ') }));
  ok(!mid.locked.includes('straitjacket'), `the Straps join this run (${mid.locked})`);
  ok(/Named and Faced/.test(mid.seen) || /NEW INSTRUMENT/.test(mid.seen), `announced: ${mid.seen.slice(0, 160)}`);

  // The Mind Palace.
  const mp = await page.evaluate(() => {
    window.__fractured.uiManager.renderTrophies();
    const g = document.getElementById('trophy-grid');
    return { ach: g.querySelectorAll('[data-achievement]').length, earned: g.querySelectorAll('[data-achievement].earned').length,
             unlocks: g.querySelectorAll('[data-unlock]').length, records: g.querySelectorAll('.record-cell').length,
             straps: g.querySelector('[data-unlock="weapon:straitjacket"]').classList.contains('earned') };
  });
  ok(mp.ach === 31 && mp.earned >= 2 && mp.unlocks === 8 && mp.records === 6 && mp.straps, `Mind Palace: ${JSON.stringify(mp)}`);
  await page.evaluate(() => {
    document.getElementById('clinical-folder-menu').style.display = 'flex';
    const b = document.querySelector('.tab-btn[data-target="tab-trophies"]'); if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${S}/achievements_palace.png` });
  await page.evaluate(() => { document.getElementById('clinical-folder-menu').style.display = 'none'; });

  // The death screen lists what this run earned.
  await page.evaluate(() => {
    const sm = window.__fractured.saveManager, s = window.__fractured.game.state;
    sm.metaState.killCounts.SCAVENGER = (sm.metaState.killCounts.SCAVENGER || 0) + 150;
    s.sanity = 0; s.player.maxHp = 100;
  });
  await page.waitForFunction(() => document.getElementById('death-screen').style.display === 'flex', null, { timeout: 5000 }).catch(() => {});
  const death = await page.evaluate(() => document.getElementById('death-cause').textContent);
  ok(/ACHIEVEMENT: CASELOAD/.test(death), `death screen: ${death.replace(/\s+/g, ' ').slice(0, 200)}`);
  await page.screenshot({ path: `${S}/achievements_death.png` });

  ok(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
