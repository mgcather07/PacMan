/*
 * 2048 — Infinite (5×5 with meltdowns), Classic (4×4, make the 2048 tile) and the seeded Daily.
 * Tiles are canvas-drawn and animated: everything slides over SLIDE seconds, merges pop, spawns scale in.
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600, FH = 840;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('2048')) || (CLASSIC ? '2048-classic' : '2048');
  const N = CLASSIC ? 4 : 5;            // infinite and daily play on the bigger board
  const WIN_TILE = 2048;                // classic: build it to win
  const MELTDOWNS = 3;                  // infinite: jams that cost tiles instead of the run
  const MELT_TILES = 4;                 // how many of the smallest tiles are vaporised
  const MELT_COST = 0.1;                // and what each meltdown costs you
  const BONUS_FROM = 64;                // a new biggest tile pays its own value from here up

  const SIZE = 540;                     // board edge in field units
  const GAP = N === 4 ? 16 : 13;
  const CELL = (SIZE - GAP * (N + 1)) / N;
  const BX = (FW - SIZE) / 2, BY = (FH - SIZE) / 2;
  const SLIDE = 0.09, POP = 0.18, SPAWN_T = 0.14;
  const SANS = 'Inter, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  const HIGH_KEY = Arcade.modeKey('2048.high');

  // the familiar warm 2048 palette, then neon once you go past the classic finish line
  const TILE = {
    2: ['#eee4da', '#6b6257'], 4: ['#ede0c8', '#6b6257'], 8: ['#f2b179', '#2a1c10'],
    16: ['#f59563', '#2a1c10'], 32: ['#f67c5f', '#fff6ef'], 64: ['#f65e3b', '#fff6ef'],
    128: ['#edcf72', '#2a1c10'], 256: ['#edcc61', '#2a1c10'], 512: ['#edc850', '#2a1c10'],
    1024: ['#edc53f', '#2a1c10'], 2048: ['#edc22e', '#2a1c10'],
  };
  const NEON = [['#b388ff', '#0b0810'], ['#3fd8ff', '#04121a'], ['#7dff6a', '#07200a'], ['#ff5ecf', '#20061a']];
  const tileColor = (v) => TILE[v] || NEON[(Math.round(Math.log2(v)) - 12) % NEON.length];

  // spawn randomness is seeded for the daily: same tiles, same values, same order for everyone
  let rngRaw = Math.random, rngCount = 0;
  function seedRng(skip = 0) {
    rngRaw = DAILY ? Daily.rng('2048') : Math.random;
    for (let i = 0; i < skip; i++) rngRaw();
    rngCount = skip;
  }
  const wrand = () => { rngCount++; return rngRaw(); };

  let scale = 1, offX = 0, offY = 0, sky = null;
  const view = setupCanvas(canvas, (v) => {
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    sky = null;
  });
  const ctx = view.ctx;

  let state = 'title';
  let tiles = [], ghosts = [], popups = [], parts = [], banner = null;
  let score, biggest, moves, time, melts, undosLeft, undoSnap, wonRun, posted;
  let slideT = SLIDE, jamT = -1, flash = 0, gainT = 0, lastGain = 0, nextId = 1;
  let high = store.get(HIGH_KEY, 0);

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------
  const cellX = (c) => BX + GAP + c * (CELL + GAP);
  const cellY = (r) => BY + GAP + r * (CELL + GAP);

  function grid() {
    const g = Array.from({ length: N }, () => new Array(N).fill(null));
    for (const t of tiles) g[t.r][t.c] = t;
    return g;
  }

  function spawn(delay = SLIDE) {
    const g = grid();
    const empty = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!g[r][c]) empty.push([r, c]);
    if (!empty.length) return null;
    const [r, c] = empty[Math.floor(wrand() * empty.length)];
    const t = { id: nextId++, v: wrand() < 0.9 ? 2 : 4, r, c, fr: r, fc: c, k: 1, a: -delay };
    tiles.push(t);
    return t;
  }

  function canMove() {
    const g = grid();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const t = g[r][c];
      if (!t) return true;
      if (c + 1 < N && g[r][c + 1] && g[r][c + 1].v === t.v) return true;
      if (r + 1 < N && g[r + 1][c] && g[r + 1][c].v === t.v) return true;
    }
    return false;
  }

  function newGame() {
    seedRng();
    tiles = []; ghosts = []; popups = []; parts = []; banner = null;
    score = 0; biggest = 0; moves = 0; time = 0;
    melts = MELTDOWNS; undosLeft = 1; undoSnap = null; wonRun = false;
    slideT = SLIDE; jamT = -1; flash = 0; gainT = 0; lastGain = 0;
    spawn(0); spawn(0);
    biggest = Math.max(...tiles.map((t) => t.v));
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    $('keep-btn').hidden = true;
    newGame();
    state = 'play';
    posted = false;
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
  }

  // ---------------------------------------------------------------------------
  // Moving
  // ---------------------------------------------------------------------------
  const DIRS = { right: 0, down: 1, left: 2, up: 3 };

  // the cells of one row/column, ordered from the wall the tiles are sliding into
  function lineCoords(dir, i) {
    const out = [];
    for (let k = 0; k < N; k++) {
      if (dir === 0) out.push([i, N - 1 - k]);
      else if (dir === 1) out.push([N - 1 - k, i]);
      else if (dir === 2) out.push([i, k]);
      else out.push([k, i]);
    }
    return out;
  }

  // slide + merge every line; tiles swallowed by a merge become ghosts that finish the slide
  function applyMove(dir) {
    const g = grid();
    for (const t of tiles) { t.fr = t.r; t.fc = t.c; t.k = 0; }
    ghosts = [];
    const merges = [];
    const kept = [];
    let moved = false, gained = 0, max = 0;
    for (let i = 0; i < N; i++) {
      const coords = lineCoords(dir, i);
      const line = coords.map(([r, c]) => g[r][c]).filter(Boolean);
      let slot = 0;
      for (let j = 0; j < line.length; j++) {
        const a = line[j], b = line[j + 1];
        const [r, c] = coords[slot];
        if (b && b.v === a.v) {
          a.v *= 2;
          a.k = 2; a.a = -SLIDE;
          ghosts.push({ v: b.v, fr: b.r, fc: b.c, r, c });
          gained += a.v;
          merges.push({ r, c, v: a.v });
          moved = true;
          j++;
        }
        if (a.r !== r || a.c !== c) moved = true;
        a.r = r; a.c = c;
        if (a.v > max) max = a.v;
        kept.push(a);
        slot++;
      }
    }
    tiles = kept;
    return { moved, gained, merges, max };
  }

  function doMove(dir) {
    if (state === 'over' || jamT >= 0 || !(dir >= 0 && dir < 4)) return false;
    const snap = state === 'play' && undosLeft > 0 ? snapshot() : null;
    const res = applyMove(dir);
    if (!res.moved) return false;
    undoSnap = snap;
    moves++;
    slideT = 0;
    if (res.gained) {
      score += res.gained;
      lastGain = res.gained; gainT = 1;
      for (const m of res.merges) {
        popups.push({ x: cellX(m.c) + CELL / 2, y: cellY(m.r) + CELL / 2, text: '+' + m.v, t: 0 });
        if (m.v >= 128) burst(cellX(m.c) + CELL / 2, cellY(m.r) + CELL / 2, tileColor(m.v)[0], 8, 160);
        const k = Math.log2(m.v);
        Sound.tone(150 + k * 34, 300 + k * 60, 0.1, 'triangle', 0.035);
      }
    } else {
      Sound.noise(0.05, 0.02, 0, 900);
    }
    spawn();
    if (res.max > biggest) newBiggest(res.max);
    if (state !== 'play') return true;
    if (CLASSIC && !wonRun && res.max >= WIN_TILE) { winRun(); return true; }
    if (!canMove()) jamT = 0.55;
    return true;
  }

  function newBiggest(v) {
    biggest = v;
    if (v < BONUS_FROM) return;
    score += v;
    banner = { text: String(v) + '!', sub: 'NEW BIGGEST · +' + v.toLocaleString(), t: 0 };
    burst(BX + SIZE / 2, BY + SIZE / 2, tileColor(v)[0], 22, 420);
    Sound.arp([523, 784, 1046, 1318], 0.07, 'square', 0.04);
  }

  // ---------------------------------------------------------------------------
  // Meltdown, undo and the end of a run
  // ---------------------------------------------------------------------------
  function meltdown() {
    melts--;
    const order = tiles.slice().sort((a, b) => a.v - b.v || (a.r * N + a.c) - (b.r * N + b.c));
    const gone = order.slice(0, MELT_TILES);
    for (const t of gone) burst(cellX(t.c) + CELL / 2, cellY(t.r) + CELL / 2, tileColor(t.v)[0], 14, 320);
    tiles = tiles.filter((t) => !gone.includes(t));
    const cost = Math.round(score * MELT_COST);
    score = Math.max(0, score - cost);
    banner = { text: 'MELTDOWN', sub: '−' + cost.toLocaleString() + ' · ' + melts + ' left', t: 0 };
    flash = 1;
    Sound.noise(0.8, 0.16, 0, 500);
    Sound.tone(320, 60, 0.7, 'sawtooth', 0.05);
    toast(melts ? `MELTDOWN · ${melts} left` : 'MELTDOWN · last one');
  }

  const snapshot = () => ({
    tiles: tiles.map((t) => ({ v: t.v, r: t.r, c: t.c })),
    score, biggest, moves, melts, wonRun, rngN: rngCount,
  });

  function undo() {
    if (state !== 'play' || !undoSnap || undosLeft <= 0) { toast(undosLeft ? 'Nothing to undo' : 'Undo already used'); return; }
    const s = undoSnap;
    tiles = s.tiles.map((t) => ({ id: nextId++, v: t.v, r: t.r, c: t.c, fr: t.r, fc: t.c, k: 1, a: 0 }));
    ghosts = []; popups = [];
    score = s.score; biggest = s.biggest; moves = s.moves; melts = s.melts; wonRun = s.wonRun;
    seedRng(s.rngN);          // the daily's tile sequence rewinds with the board
    undoSnap = null; undosLeft = 0; jamT = -1; slideT = SLIDE;
    Sound.tone(700, 300, 0.14, 'triangle', 0.03);
    toast('Undo used');
  }

  function winRun() {
    wonRun = true;
    endGame(true);
  }

  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    if (score > high) { high = score; store.set(HIGH_KEY, high); }
    $('o-score').textContent = score.toLocaleString();
    $('o-biggest').textContent = biggest.toLocaleString();
    $('o-moves').textContent = moves.toLocaleString();
    $('o-time').textContent = fmtTime(time);
    const done = posted ? 'Your winning run is already on the board.' : '';
    Arcade.endScreen(won, won ? 'You built the 2048 tile! Keep going for a bigger score.' : done || (CLASSIC ? '' : 'Out of meltdowns.'));
    $('keep-btn').hidden = !wonRun;   // only a Classic win can be continued
    $('again-btn').textContent = won ? 'PLAY AGAIN' : 'SLIDE AGAIN';
    $('over').hidden = false;
    if (!posted && window.Leaderboard) {
      posted = true;
      Leaderboard.offer(BOARD, { score, won: !!won, time }, document.querySelector('#over .panel'));
    }
  }

  // keep playing after a classic win: same run, same score, no second win screen
  function keepGoing() {
    if (state !== 'over' || !wonRun) return;
    $('over').hidden = true;
    $('keep-btn').hidden = true;
    state = 'play';
    if (!canMove()) jamT = 0.55;
    toast('Keep going!');
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  function burst(x, y, color, n, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = speed * (0.3 + Math.random() * 0.9);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, t: 0, life: 0.4 + Math.random() * 0.5, color, s: 3 + Math.random() * 5 });
    }
  }

  function update(dt) {
    slideT += dt;
    if (slideT >= SLIDE && ghosts.length) ghosts = [];
    for (const t of tiles) {
      if (!t.k) continue;
      t.a += dt;
      if (t.a >= (t.k === 1 ? SPAWN_T : POP)) t.k = 0;
    }
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    for (const p of parts) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.vx *= 0.98; }
    parts = parts.filter((p) => p.t < p.life);
    if (banner) { banner.t += dt; if (banner.t > 1.9) banner = null; }
    if (flash > 0) flash -= dt * 2.2;
    if (gainT > 0) gainT -= dt;
    if (state !== 'play') return;
    time += dt;
    if (jamT >= 0) {
      jamT -= dt;
      if (jamT < 0) { jamT = -1; if (!CLASSIC && melts > 0) meltdown(); else endGame(false); }
    }
  }

  const easeOut = (p) => 1 - (1 - p) * (1 - p);
  const easeBack = (p) => 1 + 2.2 * Math.pow(p - 1, 3) + 1.4 * Math.pow(p - 1, 2);

  function tileScale(t) {
    if (!t.k) return 1;
    const p = t.a / (t.k === 1 ? SPAWN_T : POP);
    if (p <= 0) return t.k === 1 ? 0 : 1;
    if (p >= 1) return 1;
    return t.k === 1 ? 0.3 + 0.7 * easeBack(p) : 1 + 0.22 * Math.sin(Math.PI * p);
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  const fontFor = (len) => (len <= 2 ? 0.44 : len === 3 ? 0.36 : len === 4 ? 0.29 : 0.23);

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  function drawTile(v, cx, cy, s, alpha = 1) {
    const [bg, fg] = tileColor(v);
    const w = CELL * s;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (v >= 128) { ctx.shadowColor = bg; ctx.shadowBlur = Math.min(30, 6 + Math.log2(v) * 2); }
    ctx.fillStyle = bg;
    roundRect(-w / 2, -w / 2, w, w, w * 0.12);
    ctx.fill();
    ctx.shadowBlur = 0;
    const str = String(v);
    ctx.fillStyle = fg;
    ctx.font = `600 ${Math.round(CELL * fontFor(str.length) * s)}px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, 0, CELL * 0.02 * s);
    ctx.restore();
  }

  function drawBackdrop(W, H) {
    if (!sky) {
      sky = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.8);
      sky.addColorStop(0, '#171126');
      sky.addColorStop(1, '#07060d');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(242,177,121,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (W / 2) % 48; x < W; x += 48) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = (H / 2) % 48; y < H; y += 48) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  function render() {
    const W = view.W, H = view.H;
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    drawBackdrop(W, H);
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);

    // board frame
    ctx.save();
    ctx.shadowColor = 'rgba(242,177,121,0.5)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#120e1c';
    roundRect(BX - 8, BY - 8, SIZE + 16, SIZE + 16, 20);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(242,177,121,0.55)';
    ctx.lineWidth = 2;
    roundRect(BX - 8, BY - 8, SIZE + 16, SIZE + 16, 20);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { roundRect(cellX(c), cellY(r), CELL, CELL, CELL * 0.12); ctx.fill(); }

    const p = easeOut(clamp(slideT / SLIDE, 0, 1));
    for (const g of ghosts) drawTile(g.v, cellX(g.fc + (g.c - g.fc) * p) + CELL / 2, cellY(g.fr + (g.r - g.fr) * p) + CELL / 2, 1);
    for (const t of tiles) {
      const s = tileScale(t);
      if (s <= 0) continue;
      drawTile(t.v, cellX(t.fc + (t.c - t.fc) * p) + CELL / 2, cellY(t.fr + (t.r - t.fr) * p) + CELL / 2, s);
    }

    for (const q of parts) {
      ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - q.s / 2, q.y - q.s / 2, q.s, q.s);
    }
    ctx.globalAlpha = 1;

    for (const q of popups) {
      const a = 1 - q.t / 0.8;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#ffd88a';
      ctx.font = `700 ${Math.round(CELL * 0.26)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(q.text, q.x, q.y - 12 - q.t * 46);
    }
    ctx.globalAlpha = 1;

    if (state === 'play' && moves === 0 && !banner) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('SWIPE OR USE THE ARROW KEYS', FW / 2, BY + SIZE + 44);
    }

    if (banner) {
      const a = banner.t < 0.2 ? banner.t / 0.2 : banner.t > 1.5 ? (1.9 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#f2b179';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#fff';
      ctx.font = '30px "Press Start 2P", monospace';
      ctx.fillText(banner.text, FW / 2, BY + SIZE / 2 - 14);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd88a';
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.fillText(banner.sub, FW / 2, BY + SIZE / 2 + 28);
      ctx.globalAlpha = 1;
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,120,60,${Math.min(0.35, flash * 0.35)})`;
      ctx.fillRect(BX - 8, BY - 8, SIZE + 16, SIZE + 16);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v, html) => { if (last[id] !== v) { last[id] = v; if (html) $(id).innerHTML = v; else $(id).textContent = v; } };
    const live = state !== 'title';
    set('score', (live ? score : 0).toLocaleString());
    set('high', high.toLocaleString());
    set('biggest', live && biggest ? biggest.toLocaleString() : '—');
    set('gain', live && gainT > 0 ? '+' + lastGain.toLocaleString() : '');
    set('melts', CLASSIC || !live ? '' : '◆'.repeat(melts) + `<span class="spent">${'◆'.repeat(MELTDOWNS - melts)}</span>`, true);
    set('undo-n', String(undosLeft === undefined ? 1 : undosLeft));
    const can = state === 'play' && !!undoSnap && undosLeft > 0;
    if (last.undoOn !== can) { last.undoOn = can; $('undo-btn').disabled = !can; }
  }

  const KEYMAP = { arrowright: 0, d: 0, arrowdown: 1, s: 1, arrowleft: 2, a: 2, arrowup: 3, w: 3 };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      if (state === 'play') doMove(KEYMAP[k]);
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (state !== 'play' && !e.repeat) (state === 'over' && wonRun ? keepGoing : start)();
    } else if (k === 'u' || k === 'z') {
      e.preventDefault();
      undo();
    } else if (k === 'm') {
      $('sound-btn').click();
    }
  });

  // one move per swipe: the gesture fires once and then waits for the finger to lift
  let sw = null;
  canvas.addEventListener('pointerdown', (e) => { sw = { x: e.clientX, y: e.clientY, id: e.pointerId, fired: false }; });
  canvas.addEventListener('pointermove', (e) => {
    if (!sw || sw.id !== e.pointerId || sw.fired) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.hypot(dx, dy) < 22) return;
    sw.fired = true;
    if (state === 'play') doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3));
  });
  const endSwipe = () => { sw = null; };
  canvas.addEventListener('pointerup', endSwipe);
  canvas.addEventListener('pointercancel', endSwipe);
  window.addEventListener('blur', endSwipe);

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('keep-btn').addEventListener('click', keepGoing);
  $('undo-btn').addEventListener('click', () => { undo(); $('undo-btn').blur(); });
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  // nothing to pause in a turn-based game — just don't let a hidden tab bank up animation time
  document.addEventListener('visibilitychange', () => { if (!document.hidden) lastT = performance.now(); });

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: '2048',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) update(dt); },
      move: (dir) => doMove(typeof dir === 'string' ? DIRS[dir.toLowerCase()] : dir),
      undo,
      peek: () => {
        const g = grid();
        return {
          state, score, biggest, moves, size: N, melts, undos: undosLeft, won: wonRun,
          time: Math.round(time), tiles: tiles.length,
          board: g.map((row) => row.map((t) => (t ? t.v : 0))),
        };
      },
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'biggest') biggest = v;
        else if (k === 'melts') melts = v;
        else if (k === 'undos') undosLeft = v;
        else if (k === 'board') {
          tiles = [];
          const flat = v.flat ? v.flat() : [].concat.apply([], v);
          flat.forEach((val, i) => { if (val) tiles.push({ id: nextId++, v: val, r: Math.floor(i / N), c: i % N, fr: Math.floor(i / N), fc: i % N, k: 0, a: 0 }); });
          biggest = Math.max(biggest, ...flat);
        }
      },
      win: () => {
        if (!tiles.length) spawn(0);
        tiles[0].v = WIN_TILE;
        biggest = WIN_TILE;
        if (state !== 'play') state = 'play';
        if (CLASSIC) winRun(); else endGame(true);
      },
    };
  }

  // attract mode behind the title screen: the board plays itself
  newGame();
  let lastT = performance.now();
  let attractT = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    if (state === 'title') {
      attractT += dt;
      if (attractT > 0.42) {
        attractT = 0;
        const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
        if (!order.some((d) => doMove(d))) newGame();
      }
    }
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
