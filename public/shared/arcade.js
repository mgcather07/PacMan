/* Shared helpers for the canvas arcade games: sound synth, canvas sizing, toast, high scores, swipe. */
(function () {
  'use strict';

  const Sound = {
    ac: null,
    on: true,
    init() {
      if (!this.ac) {
        try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; }
      }
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    },
    tone(f1, f2, dur, type = 'square', vol = 0.04, delay = 0) {
      if (!this.on || !this.ac) return;
      const t = this.ac.currentTime + delay;
      const o = this.ac.createOscillator();
      const g = this.ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    noise(dur, vol = 0.08, delay = 0, lowpass = 1200) {
      if (!this.on || !this.ac) return;
      const t = this.ac.currentTime + delay;
      const len = Math.floor(this.ac.sampleRate * dur);
      const buf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ac.createBufferSource();
      src.buffer = buf;
      const f = this.ac.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      const g = this.ac.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(this.ac.destination);
      src.start(t);
    },
    arp(freqs, step = 0.08, type = 'square', vol = 0.04) {
      freqs.forEach((f, i) => this.tone(f, f, step * 1.2, type, vol, i * step));
    },
  };

  function setupCanvas(canvas, onResize) {
    const ctx = canvas.getContext('2d');
    const view = { W: 0, H: 0, DPR: 1, ctx };
    function resize() {
      view.DPR = Math.min(window.devicePixelRatio || 1, 2);
      view.W = window.innerWidth;
      view.H = window.innerHeight;
      canvas.width = Math.round(view.W * view.DPR);
      canvas.height = Math.round(view.H * view.DPR);
      canvas.style.width = view.W + 'px';
      canvas.style.height = view.H + 'px';
      if (onResize) onResize(view);
    }
    window.addEventListener('resize', resize);
    resize();
    return view;
  }

  let toastTimer = null;
  function toast(msg, ms = 2000) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  const store = {
    get(key, fallback = 0) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    },
  };

  // Swipe → direction index (0 right, 1 down, 2 left, 3 up). Taps call onTap.
  function swipe(el, onDir, onTap, threshold = 24) {
    let start = null, fired = false;
    el.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      start = { x: t.clientX, y: t.clientY };
      fired = false;
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (!start) return;
      e.preventDefault();
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x, dy = t.clientY - start.y;
      if (Math.hypot(dx, dy) > threshold) {
        onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3));
        start = { x: t.clientX, y: t.clientY };
        fired = true;
      }
    }, { passive: false });
    el.addEventListener('touchend', () => {
      if (start && !fired && onTap) onTap();
      start = null;
    });
  }

  // Hold-to-press on-screen buttons: data-key="left" etc. → keys Set
  function bindPadButtons(keys) {
    document.querySelectorAll('[data-key]').forEach((b) => {
      const k = b.dataset.key;
      const down = (e) => { e.preventDefault(); keys.add(k); b.classList.add('on'); };
      const up = (e) => { e.preventDefault(); keys.delete(k); b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
    });
  }

  function soundButton(btn) {
    if (!btn) return;
    Sound.on = store.get('arcade.sound', true);
    btn.textContent = Sound.on ? '🔊' : '🔇';
    btn.addEventListener('click', () => {
      Sound.on = !Sound.on;
      store.set('arcade.sound', Sound.on);
      btn.textContent = Sound.on ? '🔊' : '🔇';
      btn.blur();
    });
  }


  // Infinite vs Classic (beatable) mode, chosen by ?mode=classic
  // daily challenges always use the endless (infinite) rules
  const mode = !(window.Daily && Daily.active) && new URLSearchParams(location.search).get('mode') === 'classic' ? 'classic' : 'infinite';
  const classic = mode === 'classic';
  function applyMode() {
    document.documentElement.dataset.mode = mode;
    if (!classic) return;
    document.title = document.title.replace(/^Infinite /, 'Classic ');
    document.querySelectorAll('a[href="/"]').forEach((a) => { a.href = '/#classic'; });
  }
  applyMode();
  const modeKey = (k) => (classic ? k + '.classic' : k);
  // Reuse the game-over overlay for wins: sets its heading and optional message
  function endScreen(won, message) {
    const over = document.getElementById('over');
    if (!over) return;
    const h = over.querySelector('h1, h2');
    if (!h.dataset.lose) h.dataset.lose = h.textContent;
    h.textContent = won ? 'YOU WIN!' : h.dataset.lose;
    let p = over.querySelector('.end-message');
    if (!p) { p = document.createElement('p'); p.className = 'end-message'; h.after(p); }
    p.textContent = message || '';
    p.hidden = !message;
    over.classList.toggle('won', !!won);
    if (won) { Sound.init(); Sound.arp([523, 659, 784, 1046, 784, 1046, 1318], 0.11, 'square', 0.05); }
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  window.Arcade = { Sound, setupCanvas, toast, store, swipe, bindPadButtons, soundButton, rand, clamp, mode, classic, modeKey, endScreen };
})();
