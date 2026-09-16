(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, swipe, soundButton, rand } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const COLS = 13;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  // world randomness (lanes) comes from a seeded generator during daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const COURSES = [45, 65, 90]; // classic mode: finish line row for each course
  const PAD = 5;
  const HOP_T = 0.12;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const DIRS = [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }, { x: 0, y: 1 }]; // R, down(back), L, up(forward)

  let T = 40, boardLeft = 0;
  const view = setupCanvas(canvas, (v) => {
    T = Math.floor(Math.min(v.W / COLS, v.H / 11.5));
    boardLeft = Math.floor((v.W - COLS * T) / 2);
  });
  const ctx = view.ctx;

  let state = 'title';
  let paused = false;
  let lanes, frog, time, camBottom, score, maxRow, coins, lives, suits, deathT, deathKind, particles, creepHold, started, nextLifeRow;
  let high = store.get(Arcade.modeKey('frogger.high'), 0);
  let course = 0, finishRow = Infinity;

  const mod = (a, n) => ((a % n) + n) % n;

  // ---------------------------------------------------------------------------
  // Lane generation
  // ---------------------------------------------------------------------------
  let pending = [];
  let lastGroup = 'grass';

  function grassLane(r, safe) {
    const trees = new Set();
    if (!safe) {
      const n = Math.floor(wr(0, 4));
      for (let i = 0; i < n; i++) trees.add(Math.floor(wr(0, COLS)));
    }
    let coin = -1, card = -1;
    if (!safe && wrand() < 0.28) { do { coin = Math.floor(wr(0, COLS)); } while (trees.has(coin)); }
    if (!safe && r > 12 && wrand() < 0.06) { do { card = Math.floor(wr(0, COLS)); } while (trees.has(card) || card === coin); }
    return { type: 'grass', trees, coin, card, suit: Math.floor(wr(0, 4)) };
  }

  function movingLane(type, r, d, dir) {
    const lane = { type, items: [], speed: 0 };
    if (type === 'road') {
      const truckLane = wrand() < 0.3;
      lane.speed = dir * wr(1.3, 2.6) * (1 + d * 1.3);
      let x = wr(0, 3);
      const spanTarget = COLS + PAD * 2 + Math.floor(wr(4, 12));
      const color = ['#ff4d6d', '#ffd23f', '#3fa7ff', '#b37bff', '#ff8a3d', '#f5f5f5'][Math.floor(wr(0, 6))];
      while (x < spanTarget - 3) {
        const w = truckLane ? Math.floor(wr(2, 4)) : 1;
        lane.items.push({ x0: x, w, kind: truckLane ? 'truck' : 'car', color: truckLane ? '#e8e8f0' : color });
        x += w + wr(2.5, 6.5) * (1 - d * 0.35);
      }
      lane.span = Math.max(spanTarget, Math.ceil(x));
    } else if (type === 'river') {
      const turtles = wrand() < 0.35;
      lane.speed = dir * wr(0.9, 2.1) * (1 + d * 0.9);
      let x = 0;
      while (x < COLS + PAD * 2) {
        const w = turtles ? Math.floor(wr(2, 4)) : Math.floor(wr(2, 5) * (1 - d * 0.3)) + 1;
        lane.items.push({ x0: x, w, kind: turtles ? 'turtle' : 'log', dive: turtles && wrand() < 0.5, phase: wr(0, 4) });
        x += w + wr(1.6, 3.2) + d * 1.6;
      }
      lane.span = Math.ceil(x);
    } else if (type === 'rail') {
      lane.speed = dir * (16 + d * 8);
      lane.span = COLS + PAD * 2 + Math.floor(wr(40, 80));
      lane.items.push({ x0: wr(0, lane.span), w: 16, kind: 'train' });
    }
    return lane;
  }

  function makeGroup(r) {
    const d = Math.min(1, r / 350 + (CLASSIC ? course * 0.3 : 0));
    const roll = wrand();
    let type;
    if (lastGroup !== 'grass' && wrand() < 0.55) type = 'grass';
    else if (r > 18 && roll < 0.14) type = 'rail';
    else if (roll < 0.58) type = 'road';
    else type = 'river';
    if (type === lastGroup && type !== 'road') type = 'road';
    lastGroup = type;
    if (type === 'grass') {
      const n = wrand() < 0.6 ? 1 : 2;
      for (let i = 0; i < n; i++) pending.push(grassLane(r + i, false));
      return;
    }
    const maxN = type === 'rail' ? (d > 0.4 ? 2 : 1) : 2 + Math.round(d * 3);
    const n = 1 + Math.floor(wr(0, maxN));
    let dir = wrand() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      pending.push(movingLane(type, r + i, d, dir));
      if (type !== 'rail' || wrand() < 0.5) dir = -dir;
    }
  }

  function ensureLanes(upTo) {
    while (lanes.length <= upTo) {
      const r = lanes.length;
      if (r < 4) { lanes.push(grassLane(r, true)); continue; }
      if (r >= finishRow) {
        lanes.push(r === finishRow ? { type: 'finish', trees: new Set(), items: [], coin: -1, card: -1, suit: 0 } : grassLane(r, true));
        pending = [];
        continue;
      }
      if (!pending.length) makeGroup(r);
      lanes.push(pending.shift());
    }
  }

  const itemX = (lane, it, t) => mod(it.x0 + lane.speed * t, lane.span) - PAD;
  // turtles spend 1s of every 4s underwater, blinking in the half-second before
  const turtleState = (it, t) => {
    if (!it.dive) return 'up';
    const p = mod(t * 0.9 + it.phase, 4);
    return p > 3.2 ? 'under' : p > 2.5 ? 'sinking' : 'up';
  };

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function newGame() {
    wrand = DAILY ? Daily.rng('frogger') : Math.random;
    course = 0;
    finishRow = CLASSIC ? COURSES[0] : Infinity;
    lanes = [];
    pending = [];
    lastGroup = 'grass';
    ensureLanes(40);
    frog = { x: 6, row: 1, dir: 3, hop: null, queue: [] };
    time = 0;
    camBottom = 0;
    score = 0; maxRow = 1; coins = 0; lives = 3; suits = [false, false, false, false];
    deathT = 0; deathKind = ''; particles = []; creepHold = 0; started = false; nextLifeRow = 100;
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    if (window.Leaderboard) Leaderboard.startRun(Daily.board('frogger') || (Arcade.classic ? 'frogger-classic' : 'frogger'));
  }

  function tryHop(di) {
    if (state !== 'play' || paused) return;
    if (frog.hop) { if (frog.queue.length < 1) frog.queue.push(di); return; }
    const d = DIRS[di];
    const fromLane = lanes[frog.row];
    let nx = frog.x + d.x;
    const nr = frog.row + d.y;
    if (nr < 0) return;
    ensureLanes(nr + 30);
    const toLane = lanes[nr];
    if (toLane.type !== 'river') nx = Math.round(nx);
    else if (fromLane.type !== 'river') nx = Math.round(nx);
    if (nx < 0 || nx > COLS - 1) { if (fromLane.type !== 'river') return; }
    if (toLane.type === 'grass' && toLane.trees.has(Math.round(nx))) { frog.dir = di; Sound.tone(120, 90, 0.05, 'square', 0.03); return; }
    frog.dir = di;
    frog.hop = { fx: frog.x, fr: frog.row, tx: nx, tr: nr, t: 0 };
    started = true;
    Sound.tone(di === 3 ? 420 : 340, di === 3 ? 620 : 480, 0.06, 'square', 0.03);
  }

  function die(kind) {
    if (state !== 'play') return;
    state = 'dying';
    deathKind = kind;
    deathT = 0;
    frog.hop = null;
    frog.queue = [];
    const colors = { car: '#7dff6a', train: '#7dff6a', water: '#9fd8ff', eagle: '#ffffff' };
    for (let i = 0; i < 22; i++) particles.push({ x: frog.x, y: frog.row + 0.5, vx: rand(-3, 3), vy: rand(-1, 4), t: 0, life: rand(0.4, 0.9), c: colors[kind] });
    if (kind === 'water') { Sound.noise(0.5, 0.12, 0, 900); }
    else if (kind === 'eagle') { Sound.tone(1800, 900, 0.35, 'sawtooth', 0.04); }
    else { Sound.noise(0.25, 0.15, 0, 2500); Sound.tone(300, 60, 0.3, 'square', 0.04); }
    const msg = { car: 'SPLAT! Watch the traffic', train: 'Flattened by a train', water: 'SPLASH! Frogs can’t swim here', eagle: 'Too slow — the eagle got you' };
    toast(msg[kind]);
  }

  function respawn() {
    lives--;
    if (lives <= 0) {
      endGame(false);
      return;
    }
    let r = Math.max(Math.ceil(camBottom) + 2, 1);
    let best = -1;
    for (let k = frog.row; k >= r; k--) if (lanes[k] && lanes[k].type === 'grass') { best = k; break; }
    if (best < 0) for (let k = r; ; k++) { ensureLanes(k + 20); if (lanes[k].type === 'grass') { best = k; break; } }
    const lane = lanes[best];
    let x = 6;
    for (let off = 0; off < COLS; off++) {
      for (const c of [6 + off, 6 - off]) if (c >= 0 && c < COLS && !lane.trees.has(c)) { x = c; off = COLS; break; }
    }
    frog.x = x; frog.row = best; frog.dir = 3;
    camBottom = Math.min(camBottom, best - 2);
    creepHold = 2.5;
    state = 'play';
  }

  function endGame(won) {
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-rows').textContent = CLASSIC ? `${course + 1}/${COURSES.length}` : maxRow;
    $('o-coins').textContent = coins;
    Arcade.endScreen(won, won ? `All ${COURSES.length} courses crossed with ${lives} ${lives === 1 ? 'life' : 'lives'} to spare!` : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(Daily.board('frogger') || (Arcade.classic ? 'frogger-classic' : 'frogger'), { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // Classic mode: reaching the finish line completes the course
  function finishCourse() {
    const bonus = 1000 * (course + 1) + lives * 250;
    score += bonus;
    if (score > high) { high = score; store.set(Arcade.modeKey('frogger.high'), high); }
    burst(frog.x, frog.row, '#ffd23f');
    if (course === COURSES.length - 1) return endGame(true);
    course++;
    finishRow = COURSES[course];
    toast(`COURSE ${course} CLEAR! +${bonus} · Course ${course + 1} is longer and faster`, 2800);
    Sound.arp([523, 659, 784, 1046], 0.09, 'square', 0.05);
    lanes = [];
    pending = [];
    lastGroup = 'grass';
    ensureLanes(40);
    frog = { x: 6, row: 1, dir: 3, hop: null, queue: [] };
    camBottom = 0;
    maxRow = 1;
    started = false;
    creepHold = 0;
  }

  function land() {
    const lane = lanes[frog.row];
    if (CLASSIC && frog.row >= finishRow) { finishCourse(); return; }
    if (lane.type === 'grass') {
      const c = Math.round(frog.x);
      if (lane.coin === c) { lane.coin = -1; coins++; score += 50; Sound.arp([880, 1320], 0.05, 'square', 0.04); burst(c, frog.row, '#ffd23f'); }
      if (lane.card === c) {
        lane.card = -1;
        score += 250;
        Sound.arp([523, 659, 784], 0.07, 'triangle', 0.06);
        burst(c, frog.row, '#ffffff');
        if (suits[lane.suit]) toast(`Another ${SUITS[lane.suit]} — +250`);
        else {
          suits[lane.suit] = true;
          if (suits.every(Boolean)) { suits = [false, false, false, false]; lives++; toast('♠♥♦♣ FULL SUIT SET — EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046, 1318], 0.08); }
          else toast(`Found ${SUITS[lane.suit]} (${suits.filter(Boolean).length}/4 suits)`);
        }
      }
    }
    if (frog.row > maxRow) {
      score += (frog.row - maxRow) * 10;
      maxRow = frog.row;
      if (maxRow >= nextLifeRow) { nextLifeRow += 100; lives++; toast(`ROW ${maxRow}! EXTRA LIFE`); Sound.arp([660, 880, 1100, 1320], 0.07); }
    }
    if (score > high) { high = score; store.set(Arcade.modeKey('frogger.high'), high); }
  }

  function burst(x, row, c) {
    for (let i = 0; i < 10; i++) particles.push({ x, y: row + 0.5, vx: rand(-2.5, 2.5), vy: rand(0, 4), t: 0, life: rand(0.3, 0.6), c });
  }

  function checkHazards() {
    const lane = lanes[frog.row];
    if (lane.type === 'road' || lane.type === 'rail') {
      for (const it of lane.items) {
        const x = itemX(lane, it, time);
        if (frog.x + 0.3 > x - 0.5 && frog.x - 0.3 < x + it.w - 0.5) return die(lane.type === 'rail' ? 'train' : 'car');
      }
    } else if (lane.type === 'river') {
      let support = null;
      for (const it of lane.items) {
        const x = itemX(lane, it, time);
        if (frog.x > x - 0.65 && frog.x < x + it.w - 0.35 && turtleState(it, time) !== 'under') { support = it; break; }
      }
      if (!support) return die('water');
      if (frog.x < -0.45 || frog.x > COLS - 0.55) return die('water');
    }
  }

  function update(dt) {
    time += dt;
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 9 * dt; }
    particles = particles.filter((p) => p.t < p.life);

    if (state === 'dying') {
      deathT += dt;
      if (deathT > 1.1) respawn();
      return;
    }
    if (state !== 'play') return;

    // ride logs
    const lane = lanes[frog.row];
    if (!frog.hop && lane.type === 'river') frog.x += lane.speed * dt;

    if (frog.hop) {
      frog.hop.t += dt;
      const k = Math.min(1, frog.hop.t / HOP_T);
      frog.x = frog.hop.fx + (frog.hop.tx - frog.hop.fx) * k;
      if (k >= 1) {
        frog.row = frog.hop.tr;
        frog.x = frog.hop.tx;
        frog.hop = null;
        land();
        checkHazards();
        if (state === 'play' && frog.queue.length) tryHop(frog.queue.shift());
        return;
      }
    } else {
      checkHazards();
    }

    // camera: follow the frog, and creep forward so you can't dawdle
    const target = frog.row - 3.2;
    if (target > camBottom) camBottom += (target - camBottom) * Math.min(1, dt * 5);
    if (started) {
      if (creepHold > 0) creepHold -= dt;
      else camBottom += Math.min(1.1, 0.28 + maxRow * 0.0035) * dt;
    }
    if (frog.row < camBottom - 0.2 && !frog.hop) die('eagle');

    ensureLanes(Math.ceil(camBottom) + 40);
    // warning horn for trains near the frog
    for (let r = Math.floor(camBottom); r < camBottom + view.H / T + 1; r++) {
      const l = lanes[r];
      if (!l || l.type !== 'rail') continue;
      const warn = railWarning(l);
      if (warn && !l.horned) { l.horned = true; if (Math.abs(r - frog.row) < 6) Sound.tone(330, 320, 0.4, 'sawtooth', 0.025); }
      if (!warn) l.horned = false;
    }
  }

  function railWarning(lane) {
    const it = lane.items[0];
    for (const dt of [0, 0.4, 0.8, 1.2]) {
      const x = itemX(lane, it, time + dt);
      if (x + it.w > -1 && x < COLS) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function rowY(r) { return view.H - (r - camBottom + 1) * T; }
  const colX = (x) => boardLeft + x * T;

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#1b3a1b';
    ctx.fillRect(0, 0, W, H);
    if (!lanes) return;

    const r0 = Math.max(0, Math.floor(camBottom) - 1);
    const r1 = Math.ceil(camBottom + H / T) + 1;
    ensureLanes(r1 + 1);

    for (let r = r0; r <= r1; r++) drawLaneBg(lanes[r], r);
    for (let r = r0; r <= r1; r++) drawLaneItems(lanes[r], r);

    if (state !== 'title') drawFrog();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(colX(p.x) - 3, rowY(p.y) + T - 3, 6, 6);
    }
    ctx.globalAlpha = 1;

    // darken outside the playfield
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, boardLeft - T / 2, H);
    ctx.fillRect(boardLeft + COLS * T - T / 2, 0, W, H);

    if (paused && state === 'play') {
      ctx.fillStyle = '#0009';
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${Math.round(T * 0.6)}px "Press Start 2P", monospace`;
      ctx.fillStyle = '#7dff6a';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
  }

  function drawLaneBg(lane, r) {
    const { W } = view;
    const y = rowY(r);
    if (lane.type === 'grass') {
      ctx.fillStyle = r % 2 ? '#5fbf3f' : '#56b33a';
      ctx.fillRect(0, y, W, T);
    } else if (lane.type === 'finish') {
      const sq = T / 2;
      for (let k = 0; k * sq < W; k++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (k + j) % 2 ? '#111' : '#f5f5f5';
        ctx.fillRect(k * sq, y + j * sq, sq, sq);
      }
      ctx.fillStyle = '#ffd23f';
      ctx.font = `${Math.round(T * 0.34)}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000a';
      ctx.fillRect(boardLeft + COLS * T / 2 - T * 2.6, y + T * 0.2, T * 4.7, T * 0.6);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(course === COURSES.length - 1 ? 'FINAL FINISH' : 'FINISH', boardLeft + COLS * T / 2 - T / 2, y + T / 2);
    } else if (lane.type === 'road') {
      ctx.fillStyle = '#3b3b4a';
      ctx.fillRect(0, y, W, T);
      const above = lanes[r + 1];
      if (above && above.type === 'road') {
        ctx.fillStyle = '#ffffffaa';
        for (let x = -((time * 0) % 1); x < W; x += T) ctx.fillRect(x + T * 0.2, y - 1, T * 0.5, 2);
      }
    } else if (lane.type === 'river') {
      ctx.fillStyle = '#2f7fd8';
      ctx.fillRect(0, y, W, T);
      ctx.fillStyle = '#ffffff22';
      const off = mod(time * lane.speed * T * 0.5, T * 2);
      for (let x = -T * 2 + off; x < W; x += T * 2) ctx.fillRect(x, y + T * 0.3 + ((r % 2) * T * 0.3), T * 0.6, 2);
    } else if (lane.type === 'rail') {
      ctx.fillStyle = '#6b5a4a';
      ctx.fillRect(0, y, W, T);
      ctx.fillStyle = '#4a3b2e';
      for (let x = 0; x < W; x += T * 0.5) ctx.fillRect(x, y + T * 0.15, T * 0.18, T * 0.7);
      ctx.fillStyle = '#c9ced6';
      ctx.fillRect(0, y + T * 0.25, W, 3);
      ctx.fillRect(0, y + T * 0.72, W, 3);
      const warn = railWarning(lane);
      const lx = boardLeft - T * 0.15, ly = y + T * 0.5;
      ctx.fillStyle = '#222';
      ctx.fillRect(lx - T * 0.18, ly - T * 0.3, T * 0.36, T * 0.6);
      ctx.fillStyle = warn && Math.floor(time * 8) % 2 ? '#ff2a2a' : '#551111';
      ctx.beginPath(); ctx.arc(lx, ly, T * 0.13, 0, Math.PI * 2); ctx.fill();
    }
  }

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rad); else ctx.rect(x, y, w, h);
  }

  function drawLaneItems(lane, r) {
    const y = rowY(r);
    if (lane.type === 'grass') {
      for (const c of lane.trees) {
        const cx = colX(c), cy = y + T / 2;
        ctx.fillStyle = '#6b4a2b';
        ctx.fillRect(cx - T * 0.08, cy, T * 0.16, T * 0.35);
        ctx.fillStyle = '#2e7d32';
        ctx.beginPath(); ctx.arc(cx, cy - T * 0.02, T * 0.38, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#43a047';
        ctx.beginPath(); ctx.arc(cx - T * 0.1, cy - T * 0.12, T * 0.2, 0, Math.PI * 2); ctx.fill();
      }
      if (lane.coin >= 0) {
        const cx = colX(lane.coin), cy = y + T / 2 + Math.sin(time * 4 + r) * T * 0.05;
        const sx = Math.abs(Math.cos(time * 3 + r));
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.ellipse(cx, cy, T * 0.22 * Math.max(0.15, sx), T * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#b8860b'; ctx.lineWidth = 2; ctx.stroke();
      }
      if (lane.card >= 0) {
        const cx = colX(lane.card), cy = y + T / 2 + Math.sin(time * 3 + r) * T * 0.06;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.sin(time * 2 + r) * 0.15);
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 12;
        ctx.fillStyle = '#fbfbff';
        roundRect(-T * 0.24, -T * 0.32, T * 0.48, T * 0.64, 3); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = lane.suit === 1 || lane.suit === 2 ? '#e0153a' : '#111';
        ctx.font = `${Math.round(T * 0.4)}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(SUITS[lane.suit], 0, 1);
        ctx.restore();
      }
      return;
    }
    for (const it of lane.items) {
      const x = itemX(lane, it, time);
      const L = colX(x - 0.5), w = it.w * T;
      if (L > view.W || L + w < 0) continue;
      const dir = Math.sign(lane.speed);
      if (it.kind === 'car') {
        ctx.fillStyle = '#0005'; roundRect(L + 4, y + T * 0.2, w - 6, T * 0.66, 8); ctx.fill();
        ctx.fillStyle = it.color; roundRect(L + 3, y + T * 0.14, w - 6, T * 0.66, 8); ctx.fill();
        ctx.fillStyle = '#bfe6ff';
        const wx = dir > 0 ? L + w * 0.55 : L + w * 0.18;
        ctx.fillRect(wx, y + T * 0.24, w * 0.24, T * 0.46);
        ctx.fillStyle = '#fff6a0';
        const hx = dir > 0 ? L + w - 7 : L + 3;
        ctx.fillRect(hx, y + T * 0.2, 4, 5); ctx.fillRect(hx, y + T * 0.68, 4, 5);
      } else if (it.kind === 'truck') {
        ctx.fillStyle = '#0005'; roundRect(L + 4, y + T * 0.16, w - 6, T * 0.74, 5); ctx.fill();
        ctx.fillStyle = '#e8e8f0'; roundRect(L + 3, y + T * 0.1, w - 6, T * 0.74, 5); ctx.fill();
        ctx.fillStyle = '#e53935';
        const cab = T * 0.8;
        roundRect(dir > 0 ? L + w - cab - 3 : L + 3, y + T * 0.1, cab, T * 0.74, 5); ctx.fill();
        ctx.fillStyle = '#bfe6ff';
        ctx.fillRect(dir > 0 ? L + w - T * 0.35 : L + T * 0.15, y + T * 0.22, T * 0.18, T * 0.5);
      } else if (it.kind === 'log') {
        ctx.fillStyle = '#8b5a2b'; roundRect(L + 3, y + T * 0.16, w - 6, T * 0.68, T * 0.3); ctx.fill();
        ctx.fillStyle = '#a0703c'; ctx.fillRect(L + T * 0.3, y + T * 0.3, w - T * 0.6, 3);
        ctx.fillStyle = '#6b4220';
        ctx.beginPath(); ctx.ellipse(L + T * 0.25, y + T / 2, T * 0.12, T * 0.28, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(L + w - T * 0.25, y + T / 2, T * 0.12, T * 0.28, 0, 0, Math.PI * 2); ctx.fill();
      } else if (it.kind === 'turtle') {
        const st = turtleState(it, time);
        if (st === 'under') {
          ctx.fillStyle = '#ffffff22';
          for (let k = 0; k < it.w; k++) { ctx.beginPath(); ctx.arc(L + T * (k + 0.5), y + T / 2, T * 0.3, 0, Math.PI * 2); ctx.fill(); }
          continue;
        }
        ctx.globalAlpha = st === 'sinking' && Math.floor(time * 6) % 2 ? 0.45 : 1;
        for (let k = 0; k < it.w; k++) {
          const cx = L + T * (k + 0.5), cy = y + T / 2;
          ctx.fillStyle = '#7cb342';
          ctx.beginPath(); ctx.arc(cx + dir * T * 0.3, cy, T * 0.12, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#2e7d32';
          ctx.beginPath(); ctx.arc(cx, cy, T * 0.32, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = '#1b5e20'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, T * 0.18, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (it.kind === 'train') {
        ctx.fillStyle = '#0006'; ctx.fillRect(L, y + T * 0.14, w, T * 0.8);
        ctx.fillStyle = '#d8dde6'; roundRect(L, y + T * 0.08, w, T * 0.78, 6); ctx.fill();
        ctx.fillStyle = '#e53935'; ctx.fillRect(L, y + T * 0.55, w, T * 0.12);
        ctx.fillStyle = '#3b4b6b';
        for (let k = 0.6; k < it.w - 0.4; k += 1.1) ctx.fillRect(L + k * T, y + T * 0.2, T * 0.6, T * 0.25);
        ctx.fillStyle = '#fff6a0';
        ctx.fillRect(dir > 0 ? L + w - 6 : L + 2, y + T * 0.3, 4, T * 0.3);
      }
    }
  }

  function drawFrog() {
    let x = frog.x, row = frog.row, lift = 0;
    if (frog.hop) {
      const k = Math.min(1, frog.hop.t / HOP_T);
      row = frog.hop.fr + (frog.hop.tr - frog.hop.fr) * k;
      lift = Math.sin(k * Math.PI);
    }
    const cx = colX(x), cy = rowY(row) + T / 2;
    if (state === 'dying') {
      const k = Math.min(1, deathT / 0.5);
      if (deathKind === 'water') {
        ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, T * (0.2 + k * 0.5), 0, Math.PI * 2); ctx.stroke();
        return;
      }
      if (deathKind === 'eagle') {
        ctx.fillStyle = '#3b2a1a';
        const ey = cy - k * view.H * 0.6;
        ctx.beginPath(); ctx.moveTo(cx - T, ey); ctx.quadraticCurveTo(cx, ey - T * 0.8, cx + T, ey); ctx.quadraticCurveTo(cx, ey - T * 0.2, cx - T, ey); ctx.fill();
        return;
      }
      ctx.fillStyle = '#4caf50';
      ctx.beginPath(); ctx.ellipse(cx, cy, T * 0.45, T * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    const s = 1 + lift * 0.25;
    ctx.fillStyle = '#0004';
    ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.18, T * 0.28, T * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(cx, cy - lift * T * 0.18);
    ctx.scale(s, s);
    ctx.rotate([Math.PI / 2, Math.PI, -Math.PI / 2, 0][frog.dir]);
    ctx.fillStyle = '#2e7d32';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(sx * T * 0.26, T * 0.2, T * 0.1, T * 0.18, sx * 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx * T * 0.24, -T * 0.12, T * 0.07, T * 0.12, -sx * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#4caf50';
    ctx.beginPath(); ctx.ellipse(0, 0, T * 0.24, T * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#81c784';
    ctx.beginPath(); ctx.ellipse(0, T * 0.05, T * 0.12, T * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * T * 0.12, -T * 0.22, T * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(sx * T * 0.12, -T * 0.25, T * 0.04, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v, html) => { if (last[id] !== v) { last[id] = v; html ? ($(id).innerHTML = v) : ($(id).textContent = v); } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('rows', CLASSIC ? `${maxRow}/${finishRow} · C${course + 1}` : String(maxRow));
    set('lives', '🐸'.repeat(Math.max(0, Math.min(lives, 8))));
    set('suits', SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join(''), true);
  }

  const KEYS = { arrowright: 0, d: 0, arrowdown: 1, s: 1, arrowleft: 2, a: 2, arrowup: 3, w: 3 };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYS) {
      e.preventDefault();
      if (state === 'title' || state === 'over') { if (!e.repeat) start(); return; }
      if (!e.repeat) tryHop(KEYS[k]);
    } else if (k === 'p' || k === 'escape') {
      if (state === 'play') paused = !paused;
    } else if (k === 'm') $('sound-btn').click();
    else if ((k === 'enter' || k === ' ') && (state === 'title' || state === 'over')) { e.preventDefault(); start(); }
  });
  swipe(canvas, (d) => tryHop(d), () => tryHop(3));
  $('play-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(Daily.board('frogger') || (Arcade.classic ? 'frogger-classic' : 'frogger'), document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  $('again-btn').addEventListener('click', start);
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (state === 'title') { time += dt; camBottom += dt * 0.6; ensureLanes(Math.ceil(camBottom) + 40); }
    else if (!paused) update(dt);
    render();
    if (lanes) hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
