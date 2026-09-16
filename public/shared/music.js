/*
 * Background chiptune for the arcade's menu pages — an original 16-bar loop synthesized with Web Audio.
 * Browsers only allow audio after a user gesture, so it starts on the first click / tap / key press
 * (unless the visitor turned it off; that choice is remembered).
 *
 *   ArcadeMusic.mount()                   → adds the ♫ toggle button and arms autoplay-on-first-interaction
 *   ArcadeMusic.mount({ screen: 'title' }) → same, but only plays (and shows the button) while #title is visible
 */
(function () {
  'use strict';

  const BPM = 124;
  const STEP = 60 / BPM / 4; // one 16th note
  const VOLUME = 0.2;
  const PREF_KEY = 'arcade.music';

  // --- the tune ---------------------------------------------------------------
  // Chords per bar: [root MIDI for bass, triad type]
  const CHORDS = {
    Am: [45, 'min'], F: [41, 'maj'], C: [48, 'maj'], G: [43, 'maj'], E: [40, 'maj'], Dm: [38, 'min'],
  };
  const PROGRESSION = ['Am', 'F', 'C', 'G', 'Am', 'F', 'E', 'E', 'Dm', 'Am', 'E', 'Am', 'F', 'G', 'C', 'E'];
  // Melody in 8th notes, 8 per bar; 0 = hold previous note, -1 = rest
  const MELODY = [
    [76, 0, 74, 72, 69, 0, 72, 74], [72, 0, 0, 69, 65, 0, 69, 72], [79, 0, 76, 0, 72, 0, 76, 79], [74, 0, 0, 0, 71, 0, 74, 0],
    [81, 0, 79, 76, 74, 0, 76, 79], [77, 0, 76, 72, 69, 0, 72, -1], [71, 0, 72, 0, 74, 0, 76, 0], [80, 0, 0, 0, 76, 0, 0, -1],
    [74, 0, 77, 0, 81, 0, 77, 74], [76, 0, 0, 72, 69, 0, 72, 76], [80, 0, 76, 0, 71, 0, 76, 80], [81, 0, 0, 0, 0, -1, 76, 0],
    [77, 0, 76, 77, 81, 0, 77, -1], [79, 0, 77, 79, 83, 0, 79, -1], [84, 0, 83, 79, 76, 0, 72, -1], [76, 0, 80, 0, 83, 0, 0, -1],
  ];
  const BARS = PROGRESSION.length;
  const STEPS = BARS * 16;
  const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Pre-compute every event in the loop, indexed by 16th step
  const events = Array.from({ length: STEPS }, () => []);
  PROGRESSION.forEach((name, bar) => {
    const [root, kind] = CHORDS[name];
    const triad = [0, kind === 'min' ? 3 : 4, 7];
    const base = bar * 16;
    for (let s = 0; s < 16; s++) {
      // bass: root / octave eighths
      if (s % 2 === 0) events[base + s].push({ type: 'bass', note: root + (s % 4 === 2 ? 12 : 0), len: 2 });
      // arpeggio: chord tones climbing in 16ths, an octave above the melody's floor
      events[base + s].push({ type: 'arp', note: root + 24 + triad[s % 3] + (s % 6 >= 3 ? 12 : 0), len: 1 });
      // drums: kick on 1 and 3 (plus a pickup), snare on 2 and 4, hats on 8ths
      if (s === 0 || s === 8 || (s === 14 && bar % 2 === 1)) events[base + s].push({ type: 'kick' });
      if (s === 4 || s === 12) events[base + s].push({ type: 'snare' });
      if (s % 2 === 0) events[base + s].push({ type: 'hat', open: s % 4 === 2 });
    }
    // melody: 8th notes with holds
    const line = MELODY[bar];
    line.forEach((n, i) => {
      if (n <= 0) return;
      let len = 1;
      while (i + len < line.length && line[i + len] === 0) len++;
      events[base + i * 2].push({ type: 'lead', note: n, len: len * 2 });
    });
  });

  // --- synth ------------------------------------------------------------------
  let ac = null, master = null, noiseBuf = null;
  let playing = false, timer = null, nextTime = 0, step = 0;

  function ensureContext() {
    if (ac) return true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return false;
    }
    master = ac.createGain();
    master.gain.value = 0;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function tone(type, f, t, dur, vol, attack = 0.005, release = 0.06, detune = 0) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
    return o;
  }

  function noise(t, dur, vol, filterType, filterFreq) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  function play(ev, t) {
    switch (ev.type) {
      case 'lead': {
        const o = tone('square', freq(ev.note), t, ev.len * STEP * 0.95, 0.16, 0.008, 0.08);
        // gentle vibrato on longer notes
        if (ev.len >= 4) {
          const lfo = ac.createOscillator(), depth = ac.createGain();
          lfo.frequency.value = 5.5;
          depth.gain.setValueAtTime(0, t);
          depth.gain.linearRampToValueAtTime(freq(ev.note) * 0.012, t + ev.len * STEP * 0.6);
          lfo.connect(depth).connect(o.frequency);
          lfo.start(t);
          lfo.stop(t + ev.len * STEP);
        }
        tone('square', freq(ev.note), t, ev.len * STEP * 0.95, 0.05, 0.008, 0.08, 9); // chorus layer
        break;
      }
      case 'bass': tone('triangle', freq(ev.note), t, ev.len * STEP * 0.9, 0.5, 0.004, 0.05); break;
      case 'arp': tone('square', freq(ev.note), t, STEP * 0.7, 0.035, 0.003, 0.04); break;
      case 'kick': {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.7, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + 0.2);
        break;
      }
      case 'snare': noise(t, 0.14, 0.32, 'bandpass', 1800); tone('triangle', 190, t, 0.08, 0.15, 0.002, 0.05); break;
      case 'hat': noise(t, ev.open ? 0.09 : 0.035, ev.open ? 0.1 : 0.07, 'highpass', 7000); break;
    }
  }

  function scheduler() {
    while (nextTime < ac.currentTime + 0.2) {
      for (const ev of events[step]) play(ev, nextTime);
      nextTime += STEP;
      step = (step + 1) % STEPS;
    }
  }

  function start() {
    if (playing || !ensureContext()) return;
    playing = true;
    if (ac.state === 'suspended') ac.resume();
    step = 0;
    nextTime = ac.currentTime + 0.08;
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setValueAtTime(0.0001, ac.currentTime);
    master.gain.exponentialRampToValueAtTime(VOLUME, ac.currentTime + 1.5);
    timer = setInterval(scheduler, 25);
    scheduler();
    render();
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    const now = ac.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    render();
  }

  // --- UI ---------------------------------------------------------------------
  const pref = () => { try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch (e) { return true; } };
  const setPref = (on) => { try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ } };
  let button = null, screen = null, unlocked = false;
  const allowed = () => !screen || !screen.hidden;

  function render() {
    if (!button) return;
    button.hidden = !allowed();
    const on = pref();
    button.setAttribute('aria-pressed', String(playing));
    button.classList.toggle('on', playing);
    button.innerHTML = playing
      ? '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span> Music on'
      : on ? '♫ Tap anywhere for music' : '♫ Music off';
    button.title = playing ? 'Turn music off' : 'Turn music on';
  }

  function mount(opts = {}) {
    if (button || !('AudioContext' in window || 'webkitAudioContext' in window)) return;
    screen = opts.screen ? document.getElementById(opts.screen) : null;
    const st = document.createElement('style');
    st.textContent = `
      .music-toggle[hidden] { display: none !important; }
      .music-toggle { position: fixed; left: 14px; bottom: 14px; z-index: 50; display: inline-flex; align-items: center; gap: 8px;
        font: 600 13px Inter, system-ui, -apple-system, sans-serif; color: #cfcfe6; background: #0b0b1dcc; backdrop-filter: blur(6px);
        border: 1px solid #ffffff26; border-radius: 999px; padding: 9px 14px; cursor: pointer; }
      .music-toggle:hover { border-color: #ffe60088; color: #fff; }
      .music-toggle.on { color: #ffe600; border-color: #ffe60066; }
      .music-toggle .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 12px; }
      .music-toggle .eq i { width: 3px; background: currentColor; border-radius: 1px; animation: music-eq .9s ease-in-out infinite; }
      .music-toggle .eq i:nth-child(2) { animation-delay: -.3s; } .music-toggle .eq i:nth-child(3) { animation-delay: -.6s; }
      @keyframes music-eq { 0%, 100% { height: 3px; } 50% { height: 12px; } }
      @media (prefers-reduced-motion: reduce) { .music-toggle .eq i { animation: none; height: 8px; } }
    `;
    document.head.appendChild(st);
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'music-toggle';
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      unlocked = true;
      if (playing) { stop(); setPref(false); } else { setPref(true); start(); }
      render();
      button.blur();
    });
    document.body.appendChild(button);
    render();

    // start on the first interaction if the visitor hasn't turned music off. The audio context is unlocked
    // inside the gesture, but playback waits a moment: if that click / key press started a game, stay quiet.
    const kick = (e) => {
      if (e.target && e.target.closest && e.target.closest('.music-toggle')) return;
      remove();
      unlocked = true;
      if (!pref() || !ensureContext()) return;
      if (ac.state === 'suspended') ac.resume();
      setTimeout(() => { if (pref() && allowed()) start(); }, 250);
    };
    const remove = () => ['pointerdown', 'keydown', 'touchstart'].forEach((t) => window.removeEventListener(t, kick, true));
    ['pointerdown', 'keydown', 'touchstart'].forEach((t) => window.addEventListener(t, kick, true));

    // follow the title screen: play while it's showing, fade out when a game starts
    if (screen) {
      new MutationObserver(() => {
        if (!allowed()) stop();
        else if (unlocked && pref()) start();
        render();
      }).observe(screen, { attributes: true, attributeFilter: ['hidden'] });
    }

    // pause while the tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (!ac) return;
      if (document.hidden) ac.suspend();
      else if (playing) ac.resume();
    });
  }

  window.ArcadeMusic = { mount, start, stop, get playing() { return playing; } };
})();
