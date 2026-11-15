// src/dev/PerfOverlay.js
/**
 * On-screen performance panel — PLAYTEST BUILDS ONLY (Patch 120).
 *
 * Loaded by main.js through a dynamic import guarded by
 * `import.meta.env.MODE === 'playtest'` (npm run build:playtest), so the crazygames
 * and itch builds never contain it. It exists because the cost that matters on a
 * real phone (GPU raster, compositing) is invisible to the headless checks in qa/,
 * which draw in software: a player on the device has to be able to measure it and
 * send the numbers back as text.
 *
 * What it does:
 *   - a small live strip: drawn frames per second, mean interval between draws, JS
 *     time per draw, quality tier;
 *   - a panel with per-effect switches (fog, darkness mask, vignette, film grain,
 *     CRT scanline overlay, DOM HUD) and the quality tier;
 *   - RUN BENCHMARK: holds a busy room (crowd at the live cap, player immortal)
 *     and measures 13 setups (drift-checked, one change each) for 4 s each, then prints a plain-text report
 *     with a COPY button, to paste into a chat or an issue.
 *
 * It reads and wraps only what window.__fractured exposes (renderer.drawGame and
 * game.processGameLogic are timed by wrapping the instance methods), and restores
 * every switch it touched when a benchmark ends.
 */

const STEP_MS = 4000;
const WARM_MS = 1000;
const KEEP_MS = 15000;

function pct(sorted, p) {
    if (!sorted.length) return NaN;
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
function f1(n) { return Number.isFinite(n) ? n.toFixed(1) : '-'; }
function f0(n) { return Number.isFinite(n) ? String(Math.round(n)) : '-'; }

export function installPerfOverlay() {
    const F = window.__fractured;
    if (!F || !F.renderer || !F.game || document.getElementById('perf-overlay')) return;
    const R = F.renderer;
    const G = F.game;

    // ---- instrumentation -------------------------------------------------------
    const rec = { drawAt: [], drawJs: [], simAt: [], simMs: [], rafAt: [] };
    const origDraw = R.drawGame;
    R.drawGame = function (...args) {
        const t0 = performance.now();
        const r = origDraw.apply(this, args);
        rec.drawAt.push(t0); rec.drawJs.push(performance.now() - t0);
        return r;
    };
    const origSim = G.processGameLogic;
    G.processGameLogic = function (...args) {
        const t0 = performance.now();
        const r = origSim.apply(this, args);
        rec.simAt.push(t0); rec.simMs.push(performance.now() - t0);
        return r;
    };
    const rafTick = (t) => { rec.rafAt.push(t); requestAnimationFrame(rafTick); };
    requestAnimationFrame(rafTick);

    function trim(now) {
        const cut = now - KEEP_MS;
        const drop = (at, vals) => {
            let i = 0; while (i < at.length && at[i] < cut) i++;
            if (i) { at.splice(0, i); if (vals) vals.splice(0, i); }
        };
        drop(rec.drawAt, rec.drawJs); drop(rec.simAt, rec.simMs); drop(rec.rafAt, null);
    }

    function stats(from, to) {
        const secs = Math.max(0.001, (to - from) / 1000);
        const di = [], js = [], sim = [];
        let prev = null, draws = 0;
        for (let i = 0; i < rec.drawAt.length; i++) {
            const t = rec.drawAt[i];
            if (t < from || t > to) continue;
            draws++; js.push(rec.drawJs[i]);
            if (prev !== null) di.push(t - prev);
            prev = t;
        }
        for (let i = 0; i < rec.simAt.length; i++) {
            const t = rec.simAt[i];
            if (t >= from && t <= to) sim.push(rec.simMs[i]);
        }
        let rafs = 0;
        for (const t of rec.rafAt) if (t >= from && t <= to) rafs++;
        di.sort((a, b) => a - b); js.sort((a, b) => a - b);
        return {
            fps: draws / secs, refresh: rafs / secs, steps: sim.length / secs,
            intMean: mean(di), intP95: pct(di, 0.95), worst: di.length ? di[di.length - 1] : NaN,
            jsMean: mean(js), jsP95: pct(js, 0.95), simMean: mean(sim)
        };
    }

    // ---- DOM -------------------------------------------------------------------
    const style = document.createElement('style');
    style.textContent = `
#perf-overlay, #perf-panel { font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #e8dcc4; }
#perf-overlay { position: fixed; z-index: 10000; left: max(6px, env(safe-area-inset-left)); top: 42%;
  background: rgba(10,5,5,0.82); border: 1px solid #c5a059; padding: 6px 10px; min-height: 40px;
  display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; -webkit-user-select: none;
  touch-action: manipulation; }
#perf-overlay b { color: #c5a059; font-weight: 700; }
#perf-panel { position: fixed; z-index: 10001; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); padding: max(8px, env(safe-area-inset-top)) max(8px, env(safe-area-inset-right))
  max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); box-sizing: border-box; }
#perf-panel[hidden] { display: none; }
#perf-box { background: #120b09; border: 1px solid #c5a059; width: min(640px, 100%); max-height: 100%;
  overflow: auto; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px;
  user-select: text; -webkit-user-select: text; }
#perf-box h2 { margin: 0; font-size: 14px; letter-spacing: 0.08em; color: #c5a059; }
#perf-box .row { display: flex; flex-wrap: wrap; gap: 6px; }
#perf-box button { font: inherit; color: #e8dcc4; background: #241612; border: 1px solid #6b5a3a;
  min-height: 40px; padding: 0 12px; cursor: pointer; }
#perf-box button.on { background: #c5a059; color: #120b09; border-color: #c5a059; }
#perf-box button.primary { border-color: #c5a059; }
#perf-box button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
#perf-box pre, #perf-box textarea { margin: 0; white-space: pre; overflow-x: auto; background: #0a0505;
  border: 1px solid #3a2a20; padding: 8px; color: #e8dcc4; font: inherit; }
#perf-device, #perf-stats { white-space: pre-wrap; overflow-wrap: anywhere; }
#perf-box textarea { width: 100%; box-sizing: border-box; min-height: 160px; white-space: pre; }
#perf-box .note { color: #a89880; }
#perf-run { position: fixed; z-index: 10002; left: 50%; top: max(8px, env(safe-area-inset-top)); transform: translateX(-50%);
  background: rgba(10,5,5,0.85); border: 1px solid #c5a059; padding: 6px 12px; font: 12px ui-monospace, monospace; color: #e8dcc4; }
`;
    document.head.appendChild(style);

    const pill = document.createElement('div');
    pill.id = 'perf-overlay';
    pill.setAttribute('role', 'button');
    pill.setAttribute('aria-label', 'Open performance panel');
    pill.innerHTML = '<b>PERF</b><span id="perf-live">…</span>';
    document.body.appendChild(pill);

    const panel = document.createElement('div');
    panel.id = 'perf-panel';
    panel.hidden = true;
    panel.innerHTML = `
<div id="perf-box">
  <h2>PERFORMANCE PANEL · playtest build</h2>
  <pre id="perf-device"></pre>
  <pre id="perf-stats"></pre>
  <div class="row" id="perf-quality"></div>
  <div class="row" id="perf-toggles"></div>
  <div class="row">
    <button id="perf-bench" class="primary">RUN BENCHMARK (~55 s)</button>
    <button id="perf-copy">COPY REPORT</button>
    <button id="perf-close">CLOSE</button>
  </div>
  <p class="note" id="perf-hint">Start a run first. The benchmark fills the room to the enemy cap, keeps you alive, and measures 13 setups for 4 s each. Hands off the screen while it runs.</p>
  <textarea id="perf-report" readonly spellcheck="false" hidden></textarea>
</div>`;
    document.body.appendChild(panel);
    for (const el of [pill, panel]) {
        for (const ev of ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'mousedown']) {
            el.addEventListener(ev, e => e.stopPropagation());
        }
    }
    const $ = id => document.getElementById(id);

    // ---- switches --------------------------------------------------------------
    const scan = () => document.getElementById('crt-scanlines');
    const hud = () => document.getElementById('ui-layer');
    const sw = {
        fog:      { label: 'FOG',        get: () => R.diag.fog,      set: v => { R.diag.fog = v; } },
        lights:   { label: 'DARKNESS',   get: () => R.diag.lights,   set: v => { R.diag.lights = v; } },
        vignette: { label: 'VIGNETTE',   get: () => R.diag.vignette, set: v => { R.diag.vignette = v; } },
        grain:    { label: 'FILM GRAIN', get: () => R.filmGrainEnabled !== false, set: v => { R.filmGrainEnabled = v; } },
        fogbuf:   { label: 'FOG BUFFER', get: () => !!R.fogBuffered, set: v => { R.fogBuffered = v; } },
        crt:      { label: 'CRT LINES',  get: () => !scan() || scan().style.display !== 'none', set: v => { if (scan()) scan().style.display = v ? '' : 'none'; } },
        hud:      { label: 'HUD',        get: () => !hud() || hud().style.visibility !== 'hidden', set: v => { if (hud()) hud().style.visibility = v ? '' : 'hidden'; } }
    };
    function setQuality(q) {
        const grain = sw.grain.get();
        F.setQuality(q);
        // setQuality resets film grain to the tier default; keep an explicit OFF.
        if (!grain) sw.grain.set(false);
    }
    function renderControls() {
        const qRow = $('perf-quality');
        qRow.innerHTML = '';
        const cur = F.qualitySetting;
        for (const q of ['auto', 'high', 'low']) {
            const b = document.createElement('button');
            b.textContent = 'QUALITY ' + q.toUpperCase() + (q === 'auto' && cur === 'auto' ? ' (' + String(F.qualityTier).toUpperCase() + ')' : '');
            b.className = cur === q ? 'on' : '';
            b.onclick = () => { setQuality(q); renderControls(); };
            qRow.appendChild(b);
        }
        const tRow = $('perf-toggles');
        tRow.innerHTML = '';
        for (const k of Object.keys(sw)) {
            const b = document.createElement('button');
            const on = sw[k].get();
            b.textContent = sw[k].label + (on ? ' ON' : ' OFF');
            b.className = on ? 'on' : '';
            b.onclick = () => { sw[k].set(!sw[k].get()); renderControls(); };
            tRow.appendChild(b);
        }
    }

    function deviceText() {
        const ua = navigator.userAgent || '';
        const os = (ua.match(/Android [^;)]+|iPhone OS [\d_]+|iPad; CPU OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/) || ['?'])[0];
        const br = (ua.match(/SamsungBrowser\/[\d.]+|EdgA?\/[\d.]+|Firefox\/[\d.]+|Chrome\/[\d.]+|Version\/[\d.]+ Mobile.*Safari/) || ['?'])[0];
        const wv = /; wv\)/.test(ua) ? ' (Android WebView)' : '';
        const c = document.getElementById('gameCanvas');
        const st = G.state || {};
        return [
            `device   ${os} · ${br}${wv}`,
            `screen   dpr ${f1(window.devicePixelRatio)} · viewport ${innerWidth}x${innerHeight} · canvas ${c ? c.width + 'x' + c.height : '?'} · cores ${navigator.hardwareConcurrency || '?'}`,
            `game     ${F.gameState} · floor ${st.floor ?? '-'} room ${st.roomNumber ?? '-'}${st.isTutorial ? ' (tutorial)' : ''} · tier ${String(F.qualityTier).toUpperCase()} · entities ${(st.entities || []).length} · particles ${(st.particles || []).length}`
        ].join('\n');
    }

    function statsText(s) {
        return [
            `drawn fps ${f0(s.fps)}  (screen refresh ${f0(s.refresh)} Hz, sim ${f0(s.steps)} steps/s)`,
            `frame interval mean ${f1(s.intMean)} ms · p95 ${f1(s.intP95)} · worst ${f1(s.worst)}`,
            `JS per draw mean ${f1(s.jsMean)} ms · p95 ${f1(s.jsP95)} · sim per step ${f1(s.simMean)} ms`,
            `(interval high but JS low = GPU/compositor bound; JS high = CPU bound)`
        ].join('\n');
    }

    // ---- live strip ------------------------------------------------------------
    setInterval(() => {
        const now = performance.now();
        trim(now);
        const s = stats(now - 1000, now);
        $('perf-live').textContent = `${f0(s.fps)} fps · ${f1(s.intMean)} ms · js ${f1(s.jsMean)} · ${String(F.qualityTier).toUpperCase()}`;
        if (!panel.hidden) {
            $('perf-device').textContent = deviceText();
            $('perf-stats').textContent = statsText(stats(now - 2000, now));
        }
    }, 500);

    pill.addEventListener('click', () => { renderControls(); panel.hidden = false; });
    $('perf-close').onclick = () => { panel.hidden = true; };

    // ---- benchmark -------------------------------------------------------------
    let report = '';
    let running = false;
    // Patch 121, benchmark v2. v1 (one switch at a time, single pass) produced
    // non-monotonic rows on a Samsung A56 (darkness OFF slower than ON; LOW 60 fps at
    // the start and 21 fps later), so v2 controls for drift: the reference setup runs
    // FIRST and again near the END, and every other row removes or swaps ONE thing
    // from that over-budget reference, so each row reads as that thing's marginal
    // cost. It also tries the two candidate optimisations (fog buffer, darkness-mask
    // resolution) on the device itself, because headless Chromium cannot model a
    // phone GPU (there the fog buffer measured slower than direct fog).
    const ALL = { q: 'high', fog: 1, lights: 1, vignette: 1, grain: 1, crt: 1, hud: 1, fogBuf: 0, ls: null };
    const STEPS = [
        { name: 'REF: HIGH all on',       cfg: { ...ALL } },
        { name: 'REF minus fog',          cfg: { ...ALL, fog: 0 } },
        { name: 'REF, fog buffered 1/2',  cfg: { ...ALL, fogBuf: 1 } },
        { name: 'REF minus darkness',     cfg: { ...ALL, lights: 0 } },
        { name: 'REF, darkness at 1/2',   cfg: { ...ALL, ls: 0.5 } },
        { name: 'REF, darkness at 0.35',  cfg: { ...ALL, ls: 0.35 } },
        { name: 'REF minus vignette',     cfg: { ...ALL, vignette: 0 } },
        { name: 'REF minus film grain',   cfg: { ...ALL, grain: 0 } },
        { name: 'REF minus CRT and HUD',  cfg: { ...ALL, crt: 0, hud: 0 } },
        { name: 'LOW as shipped',         cfg: { ...ALL, q: 'low', grain: 0 } },
        { name: 'LOW, fog buffered 1/4',  cfg: { ...ALL, q: 'low', grain: 0, fogBuf: 1 } },
        { name: 'REF again (drift check)',cfg: { ...ALL } },
        { name: 'everything off',         cfg: { q: 'low', fog: 0, lights: 0, vignette: 0, grain: 0, crt: 0, hud: 0, fogBuf: 0, ls: null } }
    ];
    function apply(cfg) {
        F.setQuality(cfg.q);
        if (cfg.ls) R.lightScale = cfg.ls;
        R.fogBuffered = !!cfg.fogBuf;
        for (const k of ['fog', 'lights', 'vignette', 'grain', 'crt', 'hud']) sw[k].set(!!cfg[k]);
    }

    $('perf-bench').onclick = () => {
        if (running) return;
        if (F.gameState !== 'PLAYING') {
            $('perf-hint').textContent = 'Start a run first (BEGIN DESCENT), then open this panel and press RUN BENCHMARK.';
            return;
        }
        running = true;
        const saved = { q: F.qualitySetting || 'auto', fogBuf: !!R.fogBuffered };
        for (const k of Object.keys(sw)) saved[k] = sw[k].get();
        panel.hidden = true;
        const banner = document.createElement('div');
        banner.id = 'perf-run';
        document.body.appendChild(banner);

        // Hold a busy, stable room for the whole run.
        const st = G.state;
        const d = G.director;
        const mix = ['SCAVENGER', 'PREDATOR', 'PARASITE'];
        try { for (let i = 0; d.hasRoomForEnemy() && i < 80; i++) d.spawnEntity(mix[i % 3], null, null); } catch (e) {}
        // No level-up cards mid-run: LEVEL_UP stops the sim and would measure a frozen
        // screen. Game checks `this.onLevelUp` before levelling, so parking the callback
        // suspends levelling without touching Game; it is put back in finish().
        const savedLevelUp = G.onLevelUp;
        G.onLevelUp = null;
        const keep = setInterval(() => {
            const S = G.state;
            if (!S || !S.player) return;
            if (Number.isFinite(S.player.maxHp)) S.sanity = S.player.maxHp;
            S.xp = 0;
            S.enemyBudget = Math.max(S.enemyBudget || 0, 200);
        }, 50);

        const rows = [];
        let i = 0;
        const next = () => {
            if (i >= STEPS.length) return finish();
            const step = STEPS[i];
            if (step.cfg) apply(step.cfg);
            banner.textContent = `BENCHMARK ${i + 1}/${STEPS.length}: ${step.name} — hands off`;
            const t0 = performance.now();
            setTimeout(() => {
                const now = performance.now();
                const s = stats(t0 + WARM_MS, now);
                s.ents = (G.state.entities || []).length;
                s.tier = String(F.qualityTier).toUpperCase();
                rows.push({ name: step.name, s });
                i++;
                next();
            }, STEP_MS);
        };
        const finish = () => {
            clearInterval(keep);
            G.onLevelUp = savedLevelUp;
            if (G.state) G.state.xp = 0;
            banner.remove();
            F.setQuality(saved.q);
            R.fogBuffered = saved.fogBuf;
            for (const k of Object.keys(sw)) sw[k].set(saved[k]);
            running = false;
            const pad = (v, n) => String(v).padStart(n);
            const refMs = rows.length ? rows[0].s.intMean : NaN;
            const lines = [
                'FRACTURED perf report v2 · playtest build (Patch 121)',
                deviceText(),
                '',
                'setup                    tier  fps  int ms  vs REF  p95 ms  js ms  sim ms  ents',
                ...rows.map(({ name, s }) =>
                    name.padEnd(24) + pad(s.tier, 5) + pad(f0(s.fps), 5) + pad(f1(s.intMean), 8) +
                    pad((s.intMean - refMs >= 0 ? '+' : '') + f1(s.intMean - refMs), 8) +
                    pad(f1(s.intP95), 8) + pad(f1(s.jsMean), 7) + pad(f1(s.simMean), 8) + pad(s.ents, 6)),
                '',
                `screen refresh ~${f0(rows.length ? rows[0].s.refresh : NaN)} Hz · sim should be 60 steps/s; "-" in sim ms means the game was paused`
            ];
            report = lines.join('\n');
            const ta = $('perf-report');
            ta.value = report;
            ta.hidden = false;
            $('perf-hint').textContent = 'Done. Press COPY REPORT and paste it into the chat.';
            renderControls();
            panel.hidden = false;
        };
        next();
    };

    $('perf-copy').onclick = () => {
        const text = report || (deviceText() + '\n' + statsText(stats(performance.now() - 2000, performance.now())));
        const ta = $('perf-report');
        ta.value = text;
        ta.hidden = false;
        const fallback = () => {
            ta.focus(); ta.select();
            $('perf-hint').textContent = 'Copy was blocked here: the report is selected below; copy it by hand.';
        };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(
                    () => { $('perf-hint').textContent = 'Copied. Paste it into the chat.'; },
                    fallback);
            } else fallback();
        } catch (e) { fallback(); }
    };
}
