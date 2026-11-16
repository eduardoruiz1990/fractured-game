// Patch 136 (V2 plan D1): the Patient picker on the title and in the EVALUATION pane,
// and a run launched with the chosen Patient. Assertion-based: exits 1 on any failure.
// Needs the dev server on :5199.
const { chromium } = require('playwright');
const S = process.argv[2] || __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ width: 384, height: 717 }, { width: 1280, height: 720 }]) {
    const tag = `${vp.width}x${vp.height}`;
    const touch = vp.width < 1000;
    const page = await browser.newPage({ viewport: vp, hasTouch: touch });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript({ path: S + '/sdkmock.js' });
    await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);

    // A first-time title: no picker at all.
    const hidden = await page.evaluate(() => getComputedStyle(document.getElementById('title-patient-strip')).display === 'none');
    ok(hidden, `${tag} first-time title shows no picker`);

    // Unlock the Vandal (first boss) — the title grows a compact picker.
    await page.evaluate(() => {
      const sm = window.__fractured.saveManager;
      sm.metaState.killCounts.BOSS = 1; sm.saveGame();
      window.__fractured.uiManager.patientStrips.render();
    });
    const t = await page.evaluate(() => {
      const host = document.getElementById('title-patient-strip');
      const chips = [...host.querySelectorAll('.patient-chip')];
      return { shown: getComputedStyle(host).display !== 'none', n: chips.length, isNew: !!host.querySelector('[data-patient="vandal"] .patient-new'),
               h: Math.min(...chips.map(c => c.getBoundingClientRect().height)),
               onScreen: chips.every(c => { const r = c.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0; }) };
    });
    ok(t.shown && t.n === 2 && t.isNew, `${tag} title picker: 2 admitted Patients, the Vandal marked NEW`);
    ok(t.h >= 44 && t.onScreen, `${tag} title chips >= 44px and on screen (${t.h}px)`);
    await page.screenshot({ path: `${S}/patients_title_${tag}.png` });

    if (touch) await page.tap('#title-patient-strip [data-patient="vandal"]'); else await page.click('#title-patient-strip [data-patient="vandal"]');
    const sel = await page.evaluate(() => ({ sel: window.__fractured.saveManager.metaState.selectedCharacter,
      label: document.querySelector('#title-patient-strip .patient-label').textContent,
      isNew: !!document.querySelector('#title-patient-strip [data-patient="vandal"] .patient-new') }));
    ok(sel.sel === 'vandal' && /VANDAL/.test(sel.label) && !sel.isNew, `${tag} choosing the Vandal saves it and clears NEW (${sel.label})`);

    // One click still starts the run — as the Vandal.
    await page.click('#btn-title-begin');
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => { const p = window.__fractured.game.state.player; return { c: p.character, pipe: p.weapons.lead_pipe.level, gs: window.__fractured.gameState }; });
    ok(r.gs === 'PLAYING' && r.c === 'vandal' && r.pipe === 1, `${tag} BEGIN DESCENT starts as the Vandal with the pipe (${JSON.stringify(r)})`);

    // The EVALUATION pane: all four, a locked one explains itself.
    await page.evaluate(() => { document.getElementById('clinical-folder-menu').style.display = 'flex'; document.querySelector('.tab-btn[data-target="tab-main"]').click(); });
    await page.waitForTimeout(150);
    await page.evaluate(() => document.querySelector('#folder-patient-strip [data-patient="photographer"]').click());
    const f = await page.evaluate(() => {
      const host = document.getElementById('folder-patient-strip');
      return { n: host.querySelectorAll('.patient-chip').length, locked: host.querySelectorAll('.patient-chip.locked').length,
               detail: host.querySelector('.patient-detail').textContent.replace(/\s+/g, ' ').trim(),
               sel: window.__fractured.saveManager.metaState.selectedCharacter };
    });
    ok(f.n === 4 && f.locked === 2 && /LOCKED/.test(f.detail) && /Panopticon/.test(f.detail) && f.sel === 'vandal',
       `${tag} EVALUATION: 4 Patients, 2 locked, tapping one explains it and changes nothing (${f.detail})`);
    await page.screenshot({ path: `${S}/patients_folder_${tag}.png` });

    ok(errors.length === 0, `${tag} no page errors ${JSON.stringify(errors)}`);
    await page.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
