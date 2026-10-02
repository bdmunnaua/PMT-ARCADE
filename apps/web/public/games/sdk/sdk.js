/* ============================================================
   ARCADE GAME SDK
   Gives every game: top bar, start/pause/game-over screens, sounds,
   confetti, best score, canvas fitting, ads, and the secure link to
   the hub (the hub talks to the backend; games never touch balances).
   ============================================================ */
(function () {
  'use strict';
  const CFG = window.ARCADE_CONFIG || { games: [] };
  const inHub = window.parent !== window;
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let opts = null, meta = null;
  let state = 'idle'; // idle | playing | paused | over
  let score = 0, best = 0;
  let muted = store.get('arcade.muted', false);
  let hub = { signedIn: false, name: null };
  let runPromise = null;
  let lastBump = 0;
  let ui = {};

  /* ---------------- Hub messaging ---------------- */
  let reqId = 0;
  const waiting = new Map();
  function post(type, data = {}) { if (inHub) window.parent.postMessage({ src: 'arcade-game', type, game: opts && opts.id, ...data }, '*'); }
  function ask(type, data, timeout = 15000) {
    if (!inHub) return Promise.resolve({ error: 'standalone' });
    const id = ++reqId;
    return new Promise((resolve) => {
      const t = setTimeout(() => { waiting.delete(id); resolve({ error: 'timeout' }); }, timeout);
      waiting.set(id, (msg) => { clearTimeout(t); resolve(msg); });
      post(type, { reqId: id, ...data });
    });
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.src !== 'arcade-hub') return;
    if (m.replyTo && waiting.has(m.replyTo)) { waiting.get(m.replyTo)(m); waiting.delete(m.replyTo); return; }
    if (m.type === 'hello' || m.type === 'auth') { hub.signedIn = !!m.signedIn; hub.name = m.name || null; refreshStartNote(); }
    if (m.type === 'pause' && state === 'playing') pause();
  });

  /* ---------------- Sound (synthesised, no files) ---------------- */
  let ac = null;
  function audio() {
    if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ac = new A(); }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(freq, dur, type = 'sine', vol = 0.12, slideTo = null, delay = 0) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur = 0.2, vol = 0.12, hp = 800) {
    if (muted) return;
    const a = audio(); if (!a) return;
    const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol;
    s.buffer = buf; s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const SFX = {
    click: () => tone(700, 0.05, 'triangle', 0.07),
    move: () => tone(420, 0.05, 'triangle', 0.06, 520),
    swap: () => tone(360, 0.08, 'sine', 0.1, 620),
    pop: (n = 0) => tone(520 * Math.pow(1.06, n), 0.09, 'sine', 0.14, 980 * Math.pow(1.06, n)),
    coin: () => { tone(988, 0.07, 'square', 0.05); tone(1319, 0.14, 'square', 0.05, null, 0.07); },
    combo: (n = 1) => { const f = 440 * Math.pow(1.122, Math.min(n, 12)); tone(f, 0.1, 'triangle', 0.12); tone(f * 1.5, 0.14, 'triangle', 0.08, null, 0.06); },
    drop: () => tone(240, 0.12, 'sine', 0.16, 110),
    place: () => { tone(300, 0.06, 'triangle', 0.12); noise(0.05, 0.05, 2000); },
    bounce: () => tone(600, 0.04, 'square', 0.05),
    hit: () => { tone(180, 0.25, 'sawtooth', 0.12, 50); noise(0.2, 0.1, 400); },
    bad: () => tone(170, 0.14, 'square', 0.06, 140),
    clear: () => [660, 880, 1100].forEach((f, i) => tone(f, 0.12, 'triangle', 0.1, null, i * 0.05)),
    level: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, 'triangle', 0.1, null, i * 0.07)),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, null, i * 0.11)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, i === 2 ? 0.4 : 0.18, 'triangle', 0.12, null, i * 0.17)),
    whoosh: () => noise(0.25, 0.08, 1200),
  };

  /* ---------------- Ads (Google H5 Games Ads) ---------------- */
  let adsReady = false, adPlaying = false;
  function loadAds() {
    const a = CFG.adsense;
    if (!a || !a.enabled || !a.client) return;
    const s = document.createElement('script');
    s.async = true; s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(a.client);
    s.setAttribute('data-ad-frequency-hint', '90s');
    document.head.appendChild(s);
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
    // Only use ads once Google says the Ad Placement API is ready (needs H5 Games Ads approval).
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on', onReady: () => { adsReady = true; } });
  }
  function showAd(kind = 'next') {
    if (!adsReady) return Promise.resolve({ shown: false });
    return new Promise((resolve) => {
      let done = false;
      const finish = (r) => { if (!done) { done = true; resolve(r); } };
      window.adBreak({
        type: kind, name: (opts && opts.id) + '-' + kind,
        beforeAd: () => { adPlaying = true; SDK.muteAll(true); },
        afterAd: () => { adPlaying = false; SDK.muteAll(false); },
        adBreakDone: (p) => finish({ shown: p && p.breakStatus === 'viewed' }),
      });
      // If no ad starts quickly, never keep the player waiting.
      setTimeout(() => { if (!adPlaying) finish({ shown: false }); }, 1500);
      setTimeout(() => finish({ shown: false }), 45000);
    });
  }

  /* ---------------- Confetti ---------------- */
  function confetti(n = 90) {
    const c = el('canvas', 'ag-confetti'); ui.stage.appendChild(c);
    const r = ui.stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    c.width = r.width * dpr; c.height = r.height * dpr; c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
    const x = c.getContext('2d'); x.scale(dpr, dpr);
    const colors = ['#fbbf24', '#8b5cf6', '#22d3ee', '#f472b6', '#34d399', '#fff'];
    const ps = Array.from({ length: n }, () => ({
      x: r.width / 2, y: r.height * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 13 - 4,
      s: 4 + Math.random() * 6, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0],
    }));
    let f = 0;
    (function tick() {
      x.clearRect(0, 0, r.width, r.height);
      ps.forEach((p) => { p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); });
      if (++f < 150) requestAnimationFrame(tick); else c.remove();
    })();
  }

  /* ---------------- UI ---------------- */
  function buildShell() {
    const app = el('div', 'ag-app');
    const top = el('div', 'ag-top');
    top.innerHTML = `
      <button class="ag-menu" data-act="exit" aria-label="Back to menu"><span>←</span><b>Menu</b></button>
      <div class="ag-title"><span class="ag-emoji">${meta.emoji}</span><span class="ag-name">${esc(meta.name)}</span></div>
      <div class="ag-spacer"></div>
      <div class="ag-extra" style="display:flex;gap:6px"></div>
      <div class="ag-chip accent"><b data-score>0</b><small>Score</small></div>
      <div class="ag-chip"><b data-best>0</b><small>Best</small></div>
      <button class="icon-btn" data-act="sound" aria-label="Sound">🔊</button>
      <button class="icon-btn" data-act="pause" aria-label="Pause">⏸</button>`;
    const stage = document.getElementById('stage') || el('div');
    stage.classList.add('ag-stage');
    app.append(top, stage);
    document.body.prepend(app);
    ui = { app, top, stage, score: $('[data-score]', top), best: $('[data-best]', top), extra: $('.ag-extra', top), sound: $('[data-act=sound]', top) };
    top.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      SFX.click();
      if (b.dataset.act === 'exit') exit();
      if (b.dataset.act === 'pause') state === 'playing' ? pause() : state === 'paused' && resume();
      if (b.dataset.act === 'sound') { muted = !muted; store.set('arcade.muted', muted); syncSound(); }
    });
    document.documentElement.style.setProperty('--accent', meta.colors[0]);
    syncSound();
    ui.best.textContent = fmt(best);
  }
  function syncSound() { ui.sound.textContent = muted ? '🔇' : '🔊'; }
  const fmt = (n) => Math.round(n).toLocaleString();

  function overlay(html) {
    closeOverlay();
    const o = el('div', 'ag-overlay');
    o.innerHTML = `<div class="ag-panel" style="--c1:${meta.colors[0]};--c2:${meta.colors[1]}">${html}</div>`;
    ui.stage.appendChild(o); ui.overlay = o;
    return o;
  }
  function closeOverlay() { if (ui.overlay) { ui.overlay.remove(); ui.overlay = null; } }

  function startNote() {
    if (!inHub) return `<div class="ag-reward dim"><span>Playing for fun. <a href="/arcade/${esc(opts.id)}" target="_top">Open it on PMT Arcade</a> and sign in to earn PMT.</span></div>`;
    if (!hub.signedIn) return `<div class="ag-reward dim"><span>Sign in on PMT Arcade to earn PMT for your scores.</span></div>`;
    return '';
  }
  function refreshStartNote() { const n = ui.overlay && ui.overlay.querySelector('[data-note]'); if (n) n.innerHTML = startNote(); }

  function showStart() {
    state = 'idle';
    const how = (opts.howTo || []).map((h) => `<div>${h}</div>`).join('');
    const extra = opts.startExtra ? opts.startExtra() : '';
    const o = overlay(`
      <div class="ag-art">${meta.emoji}</div>
      <div class="ag-h">${esc(meta.name)}</div>
      <div class="ag-sub">${esc(opts.subtitle || meta.tag)}</div>
      ${how ? `<div class="ag-how">${how}</div>` : ''}
      ${extra}
      <div data-note>${startNote()}</div>
      <div class="ag-actions"><button class="btn btn-primary btn-lg" data-go>▶ Play</button><button class="btn" data-exit>⌂ Back to menu</button></div>
      ${best ? `<div class="ag-best">Your best: <b class="num">${fmt(best)}</b></div>` : ''}`);
    $('[data-go]', o).onclick = () => { SFX.click(); goFullscreen(); start(); };
    $('[data-exit]', o).onclick = () => { SFX.click(); exit(); };
    if (opts.onStartScreen) opts.onStartScreen(o);
  }

  function start() {
    closeOverlay();
    score = 0; setScore(0);
    state = 'playing';
    runPromise = inHub && hub.signedIn ? ask('start', {}) : null;
    audio();
    opts.onStart && opts.onStart();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    opts.onPause && opts.onPause();
    const o = overlay(`
      <div class="ag-h">Paused</div>
      <div class="ag-sub">Score <b class="num">${fmt(score)}</b></div>
      <div class="ag-actions">
        <button class="btn btn-primary btn-lg" data-r>▶ Resume</button>
        <div class="ag-actions-row"><button class="btn" data-restart>↻ Restart</button><button class="btn" data-exit>⌂ Menu</button></div>
      </div>`);
    $('[data-r]', o).onclick = () => { SFX.click(); resume(); };
    $('[data-restart]', o).onclick = async () => { SFX.click(); await saveRunInProgress(); start(); };
    $('[data-exit]', o).onclick = () => { SFX.click(); exit(); };
  }
  function resume() { if (state !== 'paused') return; closeOverlay(); state = 'playing'; opts.onResume && opts.onResume(); }

  function setScore(n) {
    const prev = score; score = Math.max(0, Math.floor(n));
    ui.score.textContent = fmt(score);
    const now = performance.now();
    if (score > prev && now - lastBump > 300) { // throttled: restarting a CSS animation forces a layout
      lastBump = now; const chip = ui.score.parentElement;
      chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump');
    }
  }

  const chips = {};
  function setStat(id, label, value) {
    if (!chips[id]) { const c = el('div', 'ag-chip', `<b></b><small>${esc(label)}</small>`); ui.extra.appendChild(c); chips[id] = c; }
    chips[id].querySelector('b').textContent = value;
  }

  async function gameOver(finalScore, info = {}) {
    if (state === 'over') return;
    state = 'over';
    setScore(finalScore);
    const isBest = score > best && score > 0;
    if (isBest) { best = score; store.set('arcade.best.' + opts.id, best); ui.best.textContent = fmt(best); }
    (info.win ? SFX.win : SFX.lose)();
    if (info.win || isBest) confetti();
    const stats = (info.stats || []).map(([k, v]) => `<div><b>${esc(v)}</b><small>${esc(k)}</small></div>`).join('');
    const o = overlay(`
      <div class="ag-h">${esc(info.title || 'Game Over')}</div>
      <div class="ag-score" data-sc>0</div>
      ${isBest ? '<div class="ag-newbest">★ NEW BEST</div>' : `<div class="ag-sub">Best ${fmt(best)}</div>`}
      ${stats ? `<div class="ag-stats">${stats}</div>` : ''}
      <div class="ag-reward dim" data-reward>${inHub && hub.signedIn ? '<div class="spinner"></div> Saving your score…' : startNote().replace(/^<div class="ag-reward dim">|<\/div>$/g, '')}</div>
      <div class="ag-actions-row"><button class="btn btn-primary" data-again>↻ Play again</button><button class="btn" data-exit>⌂ Menu</button></div>`);
    countUp($('[data-sc]', o), score);
    $('[data-exit]', o).onclick = () => { SFX.click(); exit(); };
    $('[data-again]', o).onclick = async (e) => {
      const b = e.currentTarget; if (b.disabled) return;
      b.disabled = true; SFX.click();
      await showAd('next');
      start();
    };

    if (inHub && hub.signedIn && runPromise) {
      const run = await runPromise;
      const box = $('[data-reward]', o);
      if (run && run.runId) {
        const res = await ask('finish', { runId: run.runId, score, meta: info.meta || {} });
        if (!box.isConnected) return;
        if (res.coins > 0) {
          box.className = 'ag-reward';
          box.innerHTML = `<span class="coin" style="font-size:1.5rem"></span><span class="big">+${fmt(res.coins)}</span><span>PMT earned</span>`;
          SFX.coin();
        } else {
          box.innerHTML = esc(res.message || res.error || 'No PMT this time. Score higher to earn!');
        }
      } else if (box.isConnected) {
        box.innerHTML = esc((run && (run.message || run.error)) || 'Could not reach the server. Your score was not saved.');
      }
    }
  }
  function countUp(node, to) {
    const t0 = performance.now(), d = Math.min(900, 200 + to * 2);
    (function f(t) { const k = Math.min(1, (t - t0) / d); node.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f); })(t0);
  }

  // Leaving or restarting mid-game still saves the score so far (the server applies the same rules).
  async function saveRunInProgress() {
    const pending = runPromise; runPromise = null;
    if (!pending || !inHub || !(state === 'playing' || state === 'paused') || score <= 0) return;
    const run = await pending;
    if (run && run.runId) post('finish', { runId: run.runId, score, meta: { left: true }, quiet: true });
  }
  async function exit() {
    await saveRunInProgress();
    if (document.fullscreenElement && !inHub) document.exitFullscreen().catch(() => {});
    if (inHub) post('exit'); else location.href = '../../index.html';
  }
  // Phones: when a game is opened on its own page, go full screen on Play (the hub does this itself).
  const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
  function goFullscreen() {
    if (inHub || !isPhone() || document.fullscreenElement) return;
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait').catch(() => {})).catch(() => {});
  }

  function floatText(x, y, text, color = '#fff') {
    const f = el('div', 'ag-float'); f.textContent = text; f.style.left = x + 'px'; f.style.top = y + 'px'; f.style.color = color;
    ui.stage.appendChild(f); setTimeout(() => f.remove(), 900);
  }

  /* Fit a canvas into the stage. Logical width is fixed; height is fixed or flexible (minH..maxH).
     reserveH keeps room (in screen px) for controls placed under the canvas. */
  function fitCanvas(canvas, cfg) {
    const view = { canvas, ctx: canvas.getContext('2d'), w: cfg.w, h: cfg.h || cfg.minH, scale: 1, dpr: 1 };
    const pad = cfg.pad == null ? 8 : cfg.pad;
    function fit() {
      const r = ui.stage.getBoundingClientRect();
      const aw = Math.max(50, r.width - pad * 2), ah = Math.max(50, r.height - pad * 2 - (cfg.reserveH || 0));
      if (cfg.minH) view.h = Math.round(Math.max(cfg.minH, Math.min(cfg.maxH || 9999, (ah / aw) * view.w)));
      const s = Math.min(aw / view.w, ah / view.h);
      const cw = Math.floor(view.w * s), ch = Math.floor(view.h * s);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      view.scale = s; view.dpr = dpr;
      view.ctx.setTransform(canvas.width / view.w, 0, 0, canvas.height / view.h, 0, 0);
      cfg.onResize && cfg.onResize(view);
    }
    view.point = (e) => {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] || e.changedTouches[0] : e;
      return { x: ((p.clientX - r.left) / r.width) * view.w, y: ((p.clientY - r.top) / r.height) * view.h };
    };
    view.toStage = (x, y) => {
      const r = canvas.getBoundingClientRect(), s = ui.stage.getBoundingClientRect();
      return { x: r.left - s.left + (x / view.w) * r.width, y: r.top - s.top + (y / view.h) * r.height };
    };
    view.fit = fit;
    new ResizeObserver(fit).observe(ui.stage);
    fit();
    return view;
  }

  function init(o) {
    opts = o;
    meta = (CFG.games || []).find((g) => g.id === o.id) || { id: o.id, name: o.id, emoji: '🎮', colors: ['#8b5cf6', '#22d3ee'], tag: '' };
    best = store.get('arcade.best.' + o.id, 0);
    buildShell();
    loadAds();
    document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && (state === 'playing' || state === 'paused')) { e.preventDefault(); state === 'playing' ? pause() : resume(); }
      else if ((e.key === 'Enter' || e.key === ' ') && ui.overlay && state !== 'paused') { const b = ui.overlay.querySelector('[data-go],[data-again]'); if (b) { e.preventDefault(); b.click(); } }
    });
    // Stop iOS double-tap zoom / long-press menus inside games
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    post('ready');
    showStart();
  }

  const SDK = {
    init, start, pause, resume, gameOver, setScore, setStat, floatText, fitCanvas, confetti, showAd,
    sfx: (name, arg) => SFX[name] && SFX[name](arg),
    vibrate: (ms = 15) => { if (!muted && navigator.vibrate) navigator.vibrate(ms); },
    muteAll: (m) => { if (ac) m ? ac.suspend() : ac.resume(); },
    addScore: (n) => setScore(score + n),
    get score() { return score; },
    get best() { return best; },
    get playing() { return state === 'playing'; },
    get state() { return state; },
    store,
  };
  window.Arcade = SDK;
})();
