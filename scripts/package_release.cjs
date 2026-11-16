// scripts/package_release.cjs — Patch 159: the CrazyGames upload zip.
//
//   npm run package            (= node scripts/package_release.cjs)
//
// 1. Refuses to package uncommitted changes, so the build id baked into the bundle
//    (src/data/Build.js: version-mode-commit) names exactly what was uploaded.
//    Pass --allow-dirty to override (the id then ends in "+dirty").
// 2. `npm run build` (the crazygames mode: the SDK tag is injected).
// 3. Checks the bundle: the SDK tag is present; no dev hook or perf overlay
//    (Keep clause 41); no source maps; every file a CrazyGames-safe name.
// 4. Zips the CONTENTS of dist/ (index.html at the zip root, as the portal wants)
//    into release/fractured-<build id>.zip, and prints the sizes.
//
// It does not replace `node qa/smoke_check.cjs` (plays the bundle) or QA_CHECKLIST.md.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString().trim();
const die = msg => { console.error('PACKAGE FAILED: ' + msg); process.exit(1); };

const allowDirty = process.argv.includes('--allow-dirty');
if (!allowDirty && sh('git status --porcelain')) die('uncommitted changes. Commit first, or pass --allow-dirty.');

console.log('building (crazygames)...');
execSync('npm run -s build', { cwd: root, stdio: 'inherit' });

const dist = path.join(root, 'dist');
const files = [];
(function walk(d) {
    for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
    }
})(dist);

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
if (!html.includes('sdk.crazygames.com/crazygames-sdk-v3.js')) die('index.html has no CrazyGames SDK tag');
const js = files.filter(f => f.endsWith('.js'));
const leaks = js.filter(f => /__fractured|perf-overlay/.test(fs.readFileSync(f, 'utf8')));
if (leaks.length) die('dev hook or perf overlay in ' + leaks.map(f => path.relative(dist, f)).join(', '));
if (files.some(f => f.endsWith('.map'))) die('source maps in dist/');
const badNames = files.filter(f => !/^[A-Za-z0-9._\/-]+$/.test(path.relative(dist, f)));
if (badNames.length) die('file names with spaces or special characters: ' + badNames.join(', '));

const m = js.map(f => fs.readFileSync(f, 'utf8').match(/`(\d+\.\d+\.\d+-crazygames-[0-9a-f]+(?:\+dirty)?)`/)).find(Boolean);
const id = m ? m[1] : 'unknown';
const outDir = path.join(root, 'release');
fs.mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `fractured-${id}.zip`);
if (fs.existsSync(zip)) fs.unlinkSync(zip);
execSync(`zip -q -r -X "${zip}" .`, { cwd: dist, stdio: 'inherit' });

const kb = n => (n / 1024).toFixed(0) + ' KB';
const total = files.reduce((a, f) => a + fs.statSync(f).size, 0);
const code = files.filter(f => /\.(js|css|html)$/.test(f)).reduce((a, f) => a + fs.statSync(f).size, 0);
console.log(`\nbuild id   ${id}`);
console.log(`files      ${files.length} (code ${kb(code)}, everything ${kb(total)})`);
console.log(`zip        ${path.relative(root, zip)} (${kb(fs.statSync(zip).size)})`);
console.log('\nNext: node qa/smoke_check.cjs, then upload the zip and work through QA_CHECKLIST.md in the portal preview.');
