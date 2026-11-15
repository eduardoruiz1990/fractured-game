// Patch 120 helper: measures Game.processGameLogic alone (no render) under the soak
// scenario, so sim-side changes are not drowned out by software-canvas render cost.
//   node qa/sim_cost_check.cjs [--seconds 15] [--no-weapons]   (--no-weapons keeps the crowd at the cap)
const { chromium } = require('playwright');
const i = process.argv.indexOf('--seconds'); const SECONDS = i >= 0 ? Number(process.argv[i + 1]) : 15;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__fractured.saveManager.metaState.tutorialCompleted = true; });
  await p.click('#btn-title-begin'); await p.waitForTimeout(500);
  await p.evaluate((WEAPONS_OFF) => {
    const g = window.__fractured.game, st = g.state;
    st.floor = 9; st.roomNumber = 3;
    const off = WEAPONS_OFF; for (const w of Object.values(st.player.weapons)) { w.level = off ? 0 : 5; if ('active' in w) w.active = !off; }
    for (const t of ['BOSS', 'RORSCHACH', 'PANOPTICON', 'AMALGAMATION', 'ARCHITECT']) g.director.spawnEntity(t, null, null, null, null, 1, 600);
    const mix = ['SCAVENGER', 'PREDATOR', 'PARASITE'];
    for (let k = 0; g.director.hasRoomForEnemy() && k < 500; k++) g.director.spawnEntity(mix[k % 3], null, null);
    const orig = g.processGameLogic.bind(g);
    window.__sim = [];
    g.processGameLogic = (...a) => {
      const S = g.state; if (S.player) S.sanity = S.player.maxHp; S.xp = 0; S.enemyBudget = Math.max(S.enemyBudget || 0, 200);
      const t0 = performance.now(); const r = orig(...a); window.__sim.push(performance.now() - t0); return r;
    };
  }, process.argv.includes('--no-weapons'));
  await p.waitForTimeout(SECONDS * 1000);
  const r = await p.evaluate(() => { const s = window.__sim.slice(30).sort((a, b) => a - b); const q = x => s[Math.floor(x * (s.length - 1))];
    return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p95: q(0.95), ents: window.__fractured.game.state.entities.length }; });
  console.log(`sim steps ${r.n}  processGameLogic ms mean ${r.mean.toFixed(3)}  p50 ${r.p50.toFixed(3)}  p95 ${r.p95.toFixed(3)}  entities ${r.ents}  errors ${errors.length}`);
  await b.close(); if (errors.length) { console.log(errors.slice(0, 3)); process.exit(1); }
})();
