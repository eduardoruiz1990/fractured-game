const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { errors.push('NATIVE DIALOG: ' + d.type()); d.dismiss(); });
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const m = await import('/src/ui/Dialog.js');
    m.showConfirm({ danger:false, noticeOnly:true, title:'BACK UP FILE', body:'Copy this text and keep it somewhere safe.',
      note:'Paste it into RESTORE FILE to recover your progress on any browser.', confirmLabel:'DONE',
      input:{ value: 'eyJsdWNpZGl0eUJhbmsiOjEyMzQ1LCJ1cGdyYWRlcyI6e319'.repeat(12), readOnly:true } });
  });
  await page.screenshot({ path: (process.argv[2] || __dirname) + '/dialog_export.png' });
  const sel = await page.evaluate(() => { const f = document.getElementById('confirm-input'); return [f.selectionStart, f.selectionEnd, f.value.length, getComputedStyle(f).userSelect]; });
  console.log('selection', sel);
  await page.click('#btn-confirm-accept');
  // import flow -> failure notice
  await page.evaluate(async () => {
    const m = await import('/src/ui/Dialog.js');
    m.showConfirm({ title:'RESTORE FILE', body:'Paste', confirmLabel:'GO', input:{ placeholder:'Paste the file text here' },
      onConfirm: v => { window.__got = v; } });
  });
  await page.fill('#confirm-input', 'hello-save');
  await page.click('#btn-confirm-accept');
  console.log('got value:', await page.evaluate(() => window.__got));
  await page.evaluate(async () => { const m = await import('/src/ui/Dialog.js'); m.showConfirm({ title:'X', body:'plain confirm', confirmLabel:'OK' }); });
  console.log('field hidden on plain confirm:', await page.evaluate(() => getComputedStyle(document.getElementById('confirm-input')).display));
  console.log('errors:', errors);
  await browser.close();
})();
