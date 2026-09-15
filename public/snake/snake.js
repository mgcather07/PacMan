(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Deterministic infinite world
  // ---------------------------------------------------------------------------
  let SEED = 1;
  function hash(x, y, salt) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((salt + SEED) | 0, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  const key = (x, y) => x + ',' + y;
  const DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }]; // R D L U

  const BLOCK = 10;
  const SPAWN_CLEAR = 7;
  function isRock(x, y) {
    if (Math.abs(x) < SPAWN_CLEAR && Math.abs(y) < SPAWN_CLEAR) return false;
    const bx = Math.floor(x / BLOCK), by = Math.floor(y / BLOCK);
    if (hash(bx, by, 3) > 0.5) return false;
    const ox = bx * BLOCK + 1 + Math.floor(hash(bx, by, 4) * 5);
    const oy = by * BLOCK + 1 + Math.floor(hash(bx, by, 5) * 5);
    const len = 3 + Math.floor(hash(bx, by, 7) * 5);
    const lx = x - ox, ly = y - oy;
    switch (Math.floor(hash(bx, by, 6) * 5)) {
      case 0: return ly === 0 && lx >= 0 && lx < len;
      case 1: return lx === 0 && ly >= 0 && ly < len;
      case 2: return (ly === 0 && lx >= 0 && lx < len) || (lx === 0 && ly >= 0 && ly < len);
      case 3: return lx >= 0 && lx < 2 && ly >= 0 && ly < 2;
      default: return (ly === 0 || ly === 4) && lx >= 0 && lx < len && !(lx === 1 && ly === 4);
    }
  }

  const FOOD = 1, GOLD = 2, CARD = 3;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const eaten = new Set();
  const dropped = new Map();
  function foodAt(x, y) {
    const k = key(x, y);
    if (dropped.has(k)) return dropped.get(k);
    if (eaten.has(k) || isRock(x, y)) return 0;
    if (hash(x, y, 13) < 0.0016) return CARD;
    const h = hash(x, y, 9);
    if (h < 0.0022) return GOLD;
    if (h < 0.02) return FOOD;
    return 0;
  }
  const cardSuit = (x, y) => Math.floor(hash(x, y, 71) * 4);
  function consume(x, y) {
    const k = key(x, y);
    const f = foodAt(x, y);
    if (!f) return 0;
    if (dropped.has(k)) dropped.delete(k); else eaten.add(k);
    return f;
  }

  // ---------------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------------
  const Sound = {
    ac: null, on: true,
    init() { if (!this.ac) try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* none */ } },
    tone(f1, f2, dur, type = 'square', vol = 0.04, delay = 0) {
      if (!this.on || !this.ac) return;
      const t = this.ac.currentTime + delay;
      const o = this.ac.createOscillator(), g = this.ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    eat() { this.tone(500, 900, 0.07, 'triangle', 0.07); },
    gold() { [660, 880, 1320].forEach((f, i) => this.tone(f, f, 0.08, 'square', 0.04, i * 0.06)); },
    card() { [523, 659, 784].forEach((f, i) => this.tone(f, f * 1.01, 0.1, 'triangle', 0.06, i * 0.07)); },
    kill() { this.tone(200, 1400, 0.25, 'square', 0.04); },
    shield() { this.tone(1200, 200, 0.4, 'sawtooth', 0.04); },
    die() { this.tone(700, 50, 0.9, 'sawtooth', 0.05); },
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const AI_COLORS = ['#ff5ea8', '#ffb13b', '#4dd9ff', '#b98cff', '#ff6b4a', '#f5f06a'];
  let W = 0, H = 0, DPR = 1, T = 24;
  let state = 'title'; // title | play | dead | over
  let paused = false;
  let player, ais, particles, popups;
  let score, farthest, kills, suits, shield, invuln, deadT, time = 0;
  let camX = 0, camY = 0;
  let high = 0;
  try { high = +localStorage.getItem('infsnake.high') || 0; } catch (e) { /* ignore */ }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    T = Math.max(16, Math.min(30, Math.round(Math.min(W, H) / 26)));
  }
  window.addEventListener('resize', resize);
  resize();

  function makeSnake(x, y, dir, len, color) {
    const body = [];
    const back = DIRS[(dir + 2) % 4];
    for (let i = 0; i < len; i++) body.push({ x: x + back.x * i, y: y + back.y * i });
    return { body, prev: body.map((p) => ({ ...p })), dir, queue: [], grow: 0, acc: 0, color, alive: true };
  }

  function newGame(seed) {
    SEED = seed ?? ((Math.random() * 2 ** 31) | 0);
    eaten.clear();
    dropped.clear();
    player = makeSnake(0, 0, 0, 5, '#3cff8a');
    ais = [];
    particles = [];
    popups = [];
    score = 0; farthest = 0; kills = 0; suits = [false, false, false, false]; shield = false; invuln = 0; deadT = 0;
    camX = 0.5; camY = 0.5;
  }

  const playerSpeed = () => Math.min(15, 8 + (player.body.length - 5) * 0.06);
  const aiTarget = () => Math.min(10, 4 + Math.floor(score / 400));

  // ---------------------------------------------------------------------------
  // Occupancy
  // ---------------------------------------------------------------------------
  let occ = new Map();
  function rebuildOcc() {
    occ = new Map();
    if (player.alive) player.body.forEach((p, i) => occ.set(key(p.x, p.y), { s: player, i }));
    for (const a of ais) if (a.alive) a.body.forEach((p, i) => { const k = key(p.x, p.y); if (!occ.has(k)) occ.set(k, { s: a, i }); });
  }
  function blockedFor(snake, x, y) {
    if (isRock(x, y)) return 'rock';
    const o = occ.get(key(x, y));
    if (!o) return null;
    // our own tail cell frees up this tick unless we are growing
    if (o.s === snake && o.i === snake.body.length - 1 && snake.grow === 0) return null;
    return o.s;
  }

  // ---------------------------------------------------------------------------
  // Stepping
  // ---------------------------------------------------------------------------
  function moveSnake(s, nx, ny) {
    s.prev = s.body.map((p) => ({ ...p }));
    s.body.unshift({ x: nx, y: ny });
    if (s.grow > 0) s.grow--; else s.body.pop();
  }

  function stepPlayer() {
    while (player.queue.length) {
      const d = player.queue.shift();
      if (d !== (player.dir + 2) % 4 && d !== player.dir) { player.dir = d; break; }
    }
    const h = player.body[0];
    const nx = h.x + DIRS[player.dir].x, ny = h.y + DIRS[player.dir].y;
    rebuildOcc();
    const hit = blockedFor(player, nx, ny);
    if (hit && invuln <= 0) {
      if (shield) {
        shield = false;
        invuln = 2.2;
        Sound.shield();
        toast('🛡️ SHIELD BROKEN — 2s of ghost mode');
      } else {
        return die(hit === 'rock' ? 'Crashed into a rock' : hit === player ? 'Bit your own tail' : 'Hit another snake');
      }
    }
    moveSnake(player, nx, ny);
    farthest = Math.max(farthest, Math.round(Math.hypot(nx, ny)));

    const f = consume(nx, ny);
    if (f === FOOD) { player.grow += 1; addScore(10); Sound.eat(); spark(nx, ny, '#ff5ea8', 6); }
    else if (f === GOLD) { player.grow += 5; addScore(100, nx, ny); Sound.gold(); spark(nx, ny, '#ffe600', 18); }
    else if (f === 'bits') { player.grow += 1; addScore(15); Sound.eat(); spark(nx, ny, '#9cf', 5); }
    else if (f === CARD) {
      const s = cardSuit(nx, ny);
      addScore(250, nx, ny);
      Sound.card();
      spark(nx, ny, '#fff', 14);
      if (!suits[s]) {
        suits[s] = true;
        if (suits.every(Boolean)) {
          suits = [false, false, false, false];
          shield = true;
          toast('♠♥♦♣ FULL SUIT SET — SHIELD READY 🛡️');
        } else toast(`Found ${SUITS[s]} (${suits.filter(Boolean).length}/4 suits)`);
      } else toast(`Another ${SUITS[s]} — +250`);
    }
  }

  function stepAI(a) {
    const h = a.body[0];
    rebuildOcc();
    // now and then an AI snake doesn't notice your body — that's how you get kills
    const careless = state === 'play' && Math.random() < 0.2;
    const opts = [];
    let nearPlayer = false;
    for (let d = 0; d < 4; d++) {
      if (d === (a.dir + 2) % 4) continue;
      const nx = h.x + DIRS[d].x, ny = h.y + DIRS[d].y;
      const b = blockedFor(a, nx, ny);
      if (b === player) nearPlayer = true;
      if (!b) opts.push(d);
      else if (careless && b === player && occ.get(key(nx, ny)).i > 0) opts.push(d);
    }
    if (!opts.length) return killAI(a, nearPlayer && state === 'play');

    // look for food nearby
    let target = null, bestD = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const f = foodAt(h.x + dx, h.y + dy);
      if (f && f !== CARD) { const dd = Math.abs(dx) + Math.abs(dy); if (dd < bestD) { bestD = dd; target = { x: h.x + dx, y: h.y + dy }; } }
    }
    let dir;
    if (target && Math.random() < 0.85) {
      dir = opts.reduce((best, d) => {
        const dd = Math.abs(h.x + DIRS[d].x - target.x) + Math.abs(h.y + DIRS[d].y - target.y);
        const bd = Math.abs(h.x + DIRS[best].x - target.x) + Math.abs(h.y + DIRS[best].y - target.y);
        return dd < bd ? d : best;
      }, opts[0]);
    } else {
      dir = opts.includes(a.dir) && Math.random() > 0.12 ? a.dir : opts[(Math.random() * opts.length) | 0];
    }
    a.dir = dir;
    const nx = h.x + DIRS[dir].x, ny = h.y + DIRS[dir].y;
    const b = blockedFor(a, nx, ny);
    if (b === player) {
      if (invuln > 0) return; // player is a ghost; just wait
      if (occ.get(key(nx, ny)).i === 0) return die('Head-on with another snake');
      return killAI(a, true);
    }
    moveSnake(a, nx, ny);
    const f = consume(nx, ny);
    if (f === FOOD || f === 'bits') a.grow += 1;
    else if (f === GOLD) a.grow += 4;
  }

  function killAI(a, byPlayer) {
    a.alive = false;
    a.body.forEach((p, i) => {
      if (i % 2 === 0 && !isRock(p.x, p.y)) dropped.set(key(p.x, p.y), 'bits');
      if (i % 3 === 0) spark(p.x, p.y, a.color, 3);
    });
    if (byPlayer) {
      kills++;
      addScore(50 + a.body.length * 10, a.body[0].x, a.body[0].y);
      Sound.kill();
    }
  }

  function spawnAI() {
    const h = player.body[0];
    for (let tries = 0; tries < 30; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 16 + Math.random() * 14;
      const x = Math.round(h.x + Math.cos(ang) * r), y = Math.round(h.y + Math.sin(ang) * r);
      const dir = (Math.random() * 4) | 0;
      const len = 5 + ((Math.random() * 10) | 0);
      const back = DIRS[(dir + 2) % 4];
      let ok = true;
      for (let i = 0; i < len + 3 && ok; i++) {
        const cx = x + back.x * (i - 3), cy = y + back.y * (i - 3);
        if (isRock(cx, cy) || occ.has(key(cx, cy))) ok = false;
      }
      if (!ok) continue;
      const a = makeSnake(x, y, dir, len, AI_COLORS[(Math.random() * AI_COLORS.length) | 0]);
      a.speed = 6 + Math.random() * 3;
      a.acc = Math.random();
      ais.push(a);
      return;
    }
  }

  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: '+' + n, t: 0 });
    if (score > high) {
      high = score;
      try { localStorage.setItem('infsnake.high', String(high)); } catch (e) { /* ignore */ }
    }
  }

  function die(reason) {
    player.alive = false;
    state = 'dead';
    deadT = 0;
    Sound.die();
    player.body.forEach((p, i) => { if (i % 2 === 0) spark(p.x, p.y, '#3cff8a', 3); });
    $('o-reason').textContent = reason;
  }

  function spark(x, y, c, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 5;
      particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.4 + Math.random() * 0.5, c });
    }
  }

  function update(dt) {
    time += dt;
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 1);

    if (state === 'dead') {
      deadT += dt;
      if (deadT > 1.2) { state = 'over'; showOver(); }
    }
    if (state !== 'play') {
      if (state === 'title') { // attract mode: AIs roam behind the menu
        for (const a of ais) { a.acc += dt * 7; while (a.acc >= 1 && a.alive) { a.acc -= 1; stepAI(a); } }
        const c = player.body[0];
        ais = ais.filter((a) => a.alive && Math.hypot(a.body[0].x - c.x, a.body[0].y - c.y) < 45);
        if (ais.length < 6) spawnAI();
      }
      return;
    }

    if (invuln > 0) invuln -= dt;

    player.acc += dt * playerSpeed();
    while (player.acc >= 1 && state === 'play') { player.acc -= 1; stepPlayer(); }

    for (const a of ais) {
      if (!a.alive || state !== 'play') continue;
      a.acc += dt * a.speed;
      while (a.acc >= 1 && a.alive && state === 'play') {
        a.acc -= 1;
        stepAI(a);
      }
    }
    const ph = player.body[0];
    ais = ais.filter((a) => a.alive && Math.hypot(a.body[0].x - ph.x, a.body[0].y - ph.y) < 60);
    rebuildOcc();
    if (ais.length < aiTarget() && Math.random() < dt * 2) spawnAI();

    // forget far-away eaten food so the world regrows behind you
    if (eaten.size > 4000 && Math.random() < dt) {
      for (const k of eaten) {
        const [x, y] = k.split(',').map(Number);
        if (Math.abs(x - ph.x) + Math.abs(y - ph.y) > 120) eaten.delete(k);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function interp(s, alpha) {
    return s.body.map((p, i) => {
      const q = s.prev[i] || p;
      return { x: q.x + (p.x - q.x) * alpha + 0.5, y: q.y + (p.y - q.y) * alpha + 0.5 };
    });
  }

  function drawSnake(s, pts, alpha, isPlayer) {
    if (!pts.length) return;
    const sx = (x) => W / 2 + (x - camX) * T, sy = (y) => H / 2 + (y - camY) * T;
    ctx.save();
    if (isPlayer && invuln > 0) ctx.globalAlpha = 0.35 + 0.35 * Math.sin(time * 30);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = new Path2D();
    pts.forEach((p, i) => (i ? path.lineTo(sx(p.x), sy(p.y)) : path.moveTo(sx(p.x), sy(p.y))));
    if (pts.length === 1) path.lineTo(sx(pts[0].x) + 0.1, sy(pts[0].y));
    ctx.shadowColor = s.color;
    ctx.shadowBlur = isPlayer ? 16 : 8;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = T * 0.78;
    ctx.stroke(path);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff40';
    ctx.lineWidth = T * 0.22;
    ctx.stroke(path);
    if (isPlayer && shield) {
      ctx.strokeStyle = '#7fd6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(pts[0].x), sy(pts[0].y), T * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }
    // eyes
    const h = pts[0];
    const d = DIRS[s.dir];
    const px = -d.y, py = d.x;
    for (const side of [-1, 1]) {
      const ex = sx(h.x) + (d.x * 0.12 + px * 0.2 * side) * T;
      const ey = sy(h.y) + (d.y * 0.12 + py * 0.2 * side) * T;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, T * 0.14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.beginPath(); ctx.arc(ex + d.x * T * 0.05, ey + d.y * T * 0.05, T * 0.07, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#07071a';
    ctx.fillRect(0, 0, W, H);

    const alpha = state === 'play' ? Math.min(1, player.acc) : 1;
    const ppts = interp(player, alpha);
    if (player.alive) {
      camX += (ppts[0].x - camX) * 0.18;
      camY += (ppts[0].y - camY) * 0.18;
    }
    const x0 = Math.floor(camX - W / 2 / T) - 1, x1 = Math.ceil(camX + W / 2 / T) + 1;
    const y0 = Math.floor(camY - H / 2 / T) - 1, y1 = Math.ceil(camY + H / 2 / T) + 1;
    const sx = (x) => W / 2 + (x - camX) * T, sy = (y) => H / 2 + (y - camY) * T;

    const grid = new Path2D();
    const rocks = new Path2D();
    const food = new Path2D();
    const r = T * 0.06;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const cx = sx(x + 0.5), cy = sy(y + 0.5);
        if (isRock(x, y)) {
          rocks.rect(sx(x) + 1, sy(y) + 1, T - 2, T - 2);
          continue;
        }
        grid.moveTo(cx + r, cy); grid.arc(cx, cy, r, 0, Math.PI * 2);
        const f = foodAt(x, y);
        if (f === FOOD || f === 'bits') {
          const fr = T * (f === 'bits' ? 0.16 : 0.2) * (1 + 0.12 * Math.sin(time * 5 + x * 3 + y));
          food.moveTo(cx + fr, cy); food.arc(cx, cy, fr, 0, Math.PI * 2);
        } else if (f === GOLD) {
          drawStar(cx, cy, T * 0.42, time * 2);
        } else if (f === CARD) {
          drawCard(cx, cy + Math.sin(time * 3 + x) * T * 0.08, cardSuit(x, y));
        }
      }
    }
    ctx.fillStyle = '#1b1b44';
    ctx.fill(grid);
    ctx.fillStyle = '#26114a';
    ctx.fill(rocks);
    ctx.strokeStyle = '#8b5cff';
    ctx.lineWidth = 2;
    ctx.stroke(rocks);
    ctx.fillStyle = '#ff5ea8';
    ctx.shadowColor = '#ff5ea8';
    ctx.shadowBlur = 10;
    ctx.fill(food);
    ctx.shadowBlur = 0;

    for (const a of ais) {
      const aa = state === 'play' || state === 'title' ? Math.min(1, a.acc) : 1;
      drawSnake(a, interp(a, aa), aa, false);
    }
    if (player.alive && state !== 'title') drawSnake(player, ppts, alpha, true);

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(sx(p.x) - 2.5, sy(p.y) - 2.5, 5, 5);
    }
    ctx.globalAlpha = 1;

    ctx.font = `${Math.round(T * 0.5)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t;
      ctx.fillStyle = '#ffe600';
      ctx.fillText(p.text, sx(p.x + 0.5), sy(p.y + 0.5) - p.t * T * 1.2);
    }
    ctx.globalAlpha = 1;

    if (paused && state === 'play') {
      ctx.fillStyle = '#0009';
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${Math.round(T)}px "Press Start 2P", monospace`;
      ctx.fillStyle = '#3cff8a';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
  }

  function drawStar(cx, cy, r, rot) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = '#ffe600';
    ctx.shadowColor = '#ffe600';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r;
      const a = (i * Math.PI) / 5 - Math.PI / 2;
      i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCard(cx, cy, suit) {
    const w = T * 0.66, h = T * 0.9;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time * 2 + cx) * 0.12);
    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fbfbff';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-w / 2, -h / 2, w, h, 3); else ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = suit === 1 || suit === 2 ? '#e0153a' : '#111';
    ctx.font = `${Math.round(T * 0.55)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(SUITS[suit], 0, 1);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const last = {};
  function hudSet(id, v, html) { if (last[id] !== v) { last[id] = v; html ? ($(id).innerHTML = v) : ($(id).textContent = v); } }
  function updateHud() {
    hudSet('score', score.toLocaleString());
    hudSet('high', high.toLocaleString());
    hudSet('length', String(player.body.length + player.grow));
    hudSet('kills', String(kills));
    hudSet('suits', SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join('') + (shield ? '<span class="shield">🛡️</span>' : ''), true);
  }

  let toastT = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 2000);
  }

  function showOver() {
    $('o-score').textContent = score.toLocaleString();
    $('o-length').textContent = player.body.length;
    $('o-dist').textContent = farthest;
    $('o-kills').textContent = kills;
    $('over').hidden = false;
  }

  function start() {
    Sound.init();
    if (Sound.ac && Sound.ac.state === 'suspended') Sound.ac.resume();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
  }
  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('sound-btn').addEventListener('click', (e) => {
    Sound.on = !Sound.on;
    e.currentTarget.textContent = Sound.on ? '🔊' : '🔇';
    e.currentTarget.blur();
  });

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function steer(d) {
    if (state !== 'play') return;
    const lastDir = player.queue.length ? player.queue[player.queue.length - 1] : player.dir;
    if (d === lastDir || d === (lastDir + 2) % 4) return;
    if (player.queue.length < 3) player.queue.push(d);
  }
  const KEYS = { arrowright: 0, arrowdown: 1, arrowleft: 2, arrowup: 3, d: 0, s: 1, a: 2, w: 3 };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYS) {
      e.preventDefault();
      if (state === 'title' || state === 'over') { if (!e.repeat) start(); return; }
      steer(KEYS[k]);
    } else if (k === 'p' || k === 'escape') {
      if (state === 'play') paused = !paused;
    } else if (k === 'm') $('sound-btn').click();
    else if ((k === 'enter' || k === ' ') && (state === 'title' || state === 'over')) { e.preventDefault(); start(); }
  });

  let touch = null;
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; touch = { x: t.clientX, y: t.clientY }; }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (!touch) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.hypot(dx, dy) > 22) {
      steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : (dy > 0 ? 1 : 3));
      touch = { x: t.clientX, y: t.clientY };
    }
  }, { passive: false });
  canvas.addEventListener('touchend', () => { touch = null; });
  document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); steer(+b.dataset.dir); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  newGame();
  player.alive = false;
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (state === 'title') { camX += dt * 1.5; camY += dt * 0.6; player.body[0].x = Math.round(camX); player.body[0].y = Math.round(camY); }
    if (!paused) update(dt);
    render();
    updateHud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
