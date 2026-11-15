// Patch 113: a renderer exception must not leak canvas state into the next frame.
// Injects a drawPlayer that save()s, switches to 'screen' compositing and throws.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = []; p.on('console', m => logs.push(m.text()));
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.evaluate(() => { window.__fractured.saveManager.metaState.tutorialCompleted = true; });
  await p.click('#btn-title-begin'); await p.waitForTimeout(400);
  await p.evaluate(() => {
    const r = window.__fractured.renderer;
    const orig = r.drawPlayer.bind(r);
    window.__faults = 0;
    r.drawPlayer = function (...a) {
      if (window.__faults < 30) {
        window.__faults++;
        this.ctx.save(); this.ctx.save();
        this.ctx.globalCompositeOperation = 'screen';
        this.ctx.globalAlpha = 0.2;
        throw new Error('injected render fault');
      }
      return orig(...a);
    };
  });
  await p.waitForTimeout(1500);
  const st = await p.evaluate(() => {
    const r = window.__fractured.renderer, c = r.ctx;
    // Probe the base state and save-depth: after recovery a fresh save/restore pair
    // must land back on source-over / alpha 1.
    const comp = c.globalCompositeOperation, alpha = c.globalAlpha;
    // Sample the centre pixel: a smeared 'screen' frame goes near-white over time.
    const px = c.getImageData(r.canvas.width / 2 + 200, r.canvas.height / 2 + 150, 1, 1).data;
    return { faults: window.__faults, comp, alpha, px: [px[0], px[1], px[2]] };
  });
  const crashLines = logs.filter(l => l.includes('CRITICAL RENDERER')).length;
  console.log('faults injected:', st.faults, '| base comp:', st.comp, 'alpha:', st.alpha, '| sample px:', st.px.join(','), '| crash log lines:', crashLines);
  const ok = st.comp === 'source-over' && st.alpha === 1 && crashLines <= 1;
  console.log(ok ? 'OK' : 'FAIL'); await b.close(); process.exit(ok ? 0 : 1);
})();
