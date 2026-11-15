// Minimal CrazyGames SDK v3 mock for headless checks. window.__adMode controls ads:
// 'finish' | 'error:<code>'. All calls are recorded in window.__sdkCalls.
(() => {
  const calls = window.__sdkCalls = [];
  const rec = (n, a) => calls.push([n, a, Math.round(performance.now())]);
  const store = {};
  window.__adMode = 'finish';
  window.CrazyGames = { SDK: {
    environment: 'crazygames',
    init: async () => { rec('init'); },
    ad: { requestAd: (type, cb) => { rec('requestAd', type);
      setTimeout(() => { const m = window.__adMode;
        if (m.startsWith('error:')) { cb.adError && cb.adError({ code: m.slice(6) }); return; }
        cb.adStarted && cb.adStarted(); setTimeout(() => cb.adFinished && cb.adFinished(), 50); }, 20); } },
    game: { gameplayStart: () => rec('gameplayStart'), gameplayStop: () => rec('gameplayStop'),
      loadingStart: () => rec('loadingStart'), loadingStop: () => rec('loadingStop'),
      happytime: () => rec('happytime'), setGameContext: c => { rec('setGameContext', c); window.__gameContext = c; }, settings: { muteAudio: false },
      addSettingsChangeListener: () => {} },
    data: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    user: { isUserAccountAvailable: false, addAuthListener: () => {}, getUser: async () => null }
  } };
})();
