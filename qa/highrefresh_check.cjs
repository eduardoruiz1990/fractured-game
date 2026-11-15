// Patch 114: behaviour on a ~144 Hz display (rAF driven every 7 ms).
// Checks that idle frames are not redrawn, and that the boss intro banner and the
// 240-step hitStop freeze it announces end together.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); // Small viewport: software canvas must be cheap enough to actually outrun 60 Hz here.
  const p = await b.newPage({ viewport: { width: 360, height: 240 } });
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => {
    window.__raf = 0;
    window.requestAnimationFrame = cb => setTimeout(() => { window.__raf++; cb(performance.now()); }, 7);
  });
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__fractured.saveManager.metaState.tutorialCompleted = true; });
  await p.evaluate(() => document.getElementById('btn-title-begin').click()); await p.waitForTimeout(500);
  const r = await p.evaluate(() => new Promise(resolve => {
    const f = window.__fractured, R = f.renderer, g = f.game;
    let draws = 0; const orig = R.drawGame.bind(R);
    // (draws is read once, at the 2 s mark, below)
    R.drawGame = (...a) => { draws++; return orig(...a); };
    const raf0 = window.__raf;
    setTimeout(() => {
      const frames = window.__raf - raf0;
      const drawRatio = draws / Math.max(1, frames);
      // Boss intro: spawn the floor boss and time banner vs freeze.
      g.state.bossSpawned = true; g.director.spawnEntity('BOSS', null, null, null, null, 1, 600);
      const start = performance.now(); let bannerEnd = null, freezeEnd = null;
      const poll = () => {
        const now = performance.now();
        if (bannerEnd === null && R.hasAnnouncedBoss && R.bossAnnouncementTimer <= 0) bannerEnd = now - start;
        if (freezeEnd === null && now - start > 100 && !(g.state.hitStop > 0)) freezeEnd = now - start;
        if ((bannerEnd !== null && freezeEnd !== null) || now - start > 9000) resolve({ drawRatio, frames, draws: Math.round(drawRatio * frames), bannerEnd, freezeEnd });
        else setTimeout(poll, 20);
      };
      poll();
    }, 2100);
  }));
  console.log(`~144Hz: ${r.frames} rAF frames, ${r.draws} draws (ratio ${r.drawRatio.toFixed(2)}) | boss banner ends ${Math.round(r.bannerEnd)} ms, freeze ends ${Math.round(r.freezeEnd)} ms`);
  const ok = r.drawRatio < 0.7 && Math.abs(r.bannerEnd - r.freezeEnd) < 400 && !errors.length;
  console.log(ok ? 'OK' : 'FAIL', errors); await b.close(); process.exit(ok ? 0 : 1);
})();
