(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  // Logical playfield (scaled to fit the screen)
  const FW = 540, FH = 860;
  const COLS = 12, BW = FW / COLS, BH = 24;
  const CEIL = 78;
  const PADDLE_Y = FH - 70;
  const DANGER_Y = PADDLE_Y - 46;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  // Classic mode levels: . empty, 1-3 hit points, # armored (not needed to clear), * brick with a power-up
  const LEVELS = [
    { name: 'WARM-UP', map: ['111111111111', '111111111111', '1*11111111*1', '111111111111', '111111111111'] },
    { name: 'PYRAMID', map: ['.....22.....', '....2112....', '...211*12...', '..21111112..', '.2111**1112.', '211111111112'] },
    { name: 'FORTRESS', map: ['2#22222222#2', '2.3......3.2', '2.3.1**1.3.2', '2.3.1111.3.2', '2.33333333.2', '222222222222'] },
    { name: 'CHECKERBOARD', map: ['3.3.3.3.3.3.', '.2.2.2.2.2.2', '1*1.1.1.1*1.', '.1.1.1.1.1.1', '##.##..##.##', '222222222222'] },
    { name: 'THE CITADEL', map: ['333333333333', '3#22222222#3', '32*111111*23', '321333333123', '321111111123', '3##.####.##3', '222222222222'] },
  ];

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  const ROW_COLORS = ['#ff4d6d', '#ff8a3d', '#ffd23f', '#7dff6a', '#3fd8ff', '#6a8bff', '#c77dff'];
  const POWERS = {
    multi: { label: 'M', color: '#3fd8ff', name: 'MULTIBALL' },
    wide: { label: 'W', color: '#7dff6a', name: 'WIDE PADDLE' },
    laser: { label: 'L', color: '#ff4d6d', name: 'LASERS — click / space to fire' },
    slow: { label: 'S', color: '#ffd23f', name: 'SLOW BALL' },
    fire: { label: 'F', color: '#ff8a3d', name: 'FIREBALL' },
    life: { label: '+', color: '#ff7ac8', name: 'EXTRA LIFE' },
    card: { label: '♠', color: '#ffffff', name: 'CARD' },
  };

  let state = 'title';
  let paused = false;
  let rows, balls, paddle, drops, bullets, particles, popups;
  let score, lives, rowsSpawned, elapsed, combo, suits, timers, shake, nextLifeAt, waiting, bricksBroken, laserCooldown;
  let high = store.get(Arcade.modeKey('breakout.high'), 0);
  let level = 0, endgameHelp = false;

  // ---------------------------------------------------------------------------
  // Brick rows
  // ---------------------------------------------------------------------------
  function makeRow(y) {
    const n = rowsSpawned++;
    const lvl = Math.floor(n / 18);
    const cells = Array(COLS).fill(null);
    const pattern = n < 6 ? 0 : Math.floor(wr(0, 7));
    const phase = Math.floor(wr(0, 4));
    for (let c = 0; c < COLS; c++) {
      let on;
      switch (pattern) {
        case 1: on = (c + n) % 2 === 0; break;
        case 2: on = c > 1 && c < COLS - 2; break;
        case 3: on = c < 4 || c > 7; break;
        case 4: on = (c + phase) % 4 !== 0; break;
        case 5: on = Math.abs(c - 5.5) < 2 + (n % 4); break;
        case 6: on = wrand() < 0.7; break;
        default: on = true;
      }
      if (!on) continue;
      let hp = 1;
      const r = wrand();
      if (r < Math.min(0.35, lvl * 0.05)) hp = 3;
      else if (r < Math.min(0.6, 0.08 + lvl * 0.08)) hp = 2;
      const armored = n > 20 && wrand() < Math.min(0.12, 0.02 + lvl * 0.01);
      if (armored) hp = 6;
      let drop = null;
      if (!armored && wrand() < 0.07) {
        const pool = ['multi', 'multi', 'wide', 'wide', 'laser', 'slow', 'fire', 'card', 'card'];
        if (wrand() < 0.08) pool.push('life');
        drop = pool[Math.floor(wr(0, pool.length))];
      }
      cells[c] = { hp, max: hp, armored, color: ROW_COLORS[n % ROW_COLORS.length], drop, flash: 0 };
    }
    return { y, cells };
  }

  function refillTop() {
    if (!rows.length) rows.push(makeRow(CEIL - BH));
    while (rows[0].y > CEIL - BH) rows.unshift(makeRow(rows[0].y - BH));
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function buildLevel(n) {
    return LEVELS[n].map.map((line, i) => ({
      y: CEIL + BH * (2 + i),
      cells: [...line].map((ch) => {
        if (ch === '.') return null;
        const armored = ch === '#';
        const hp = armored ? 6 : ch === '*' ? 1 : +ch;
        const pool = ['multi', 'wide', 'laser', 'slow', 'fire', 'card'];
        return { hp, max: hp, armored, color: ROW_COLORS[i % ROW_COLORS.length], drop: ch === '*' ? pool[Math.floor(rand(0, pool.length))] : null, flash: 0 };
      }),
    }));
  }
  const bricksLeft = () => rows.reduce((n, r) => n + r.cells.filter((c) => c && !c.armored).length, 0);

  function endGame(won) {
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-bricks').textContent = bricksBroken;
    $('o-time').textContent = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
    Arcade.endScreen(won, won ? `All ${LEVELS.length} levels cleared!` : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(Daily.board('breakout') || (Arcade.classic ? 'breakout-classic' : 'breakout'), { score, won: !!won }, document.querySelector('#over .panel'));
  }

  function nextLevel() {
    addScore(2000 * (level + 1) + lives * 500);
    if (level === LEVELS.length - 1) return endGame(true);
    level++;
    rows = buildLevel(level);
    endgameHelp = false;
    drops = []; bullets = [];
    timers = { wide: 0, laser: 0, slow: 0, fire: 0 };
    serve();
    toast(`LEVEL ${level + 1}: ${LEVELS[level].name}`, 2600);
    Sound.arp([523, 659, 784, 1046], 0.09, 'square', 0.05);
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('breakout') : Math.random;
    rows = [];
    rowsSpawned = 0;
    level = 0;
    endgameHelp = false;
    let y = CEIL + BH * 9;
    rows.push(makeRow(y));
    while (rows[0].y > CEIL) rows.unshift(makeRow(rows[0].y - BH));
    // makeRow numbers rows as they are created; renumber colours top-down for a tidy start
    rows.forEach((r, i) => r.cells.forEach((c) => { if (c) c.color = ROW_COLORS[i % ROW_COLORS.length]; }));
    if (CLASSIC) rows = buildLevel(0);
    paddle = { x: FW / 2, w: 96, targetX: FW / 2 };
    balls = [];
    drops = []; bullets = []; particles = []; popups = [];
    score = 0; lives = 3; elapsed = 0; combo = 0; suits = [false, false, false, false];
    timers = { wide: 0, laser: 0, slow: 0, fire: 0 };
    shake = 0; nextLifeAt = 20000; bricksBroken = 0; laserCooldown = 0;
    serve();
  }

  function serve() {
    balls = [{ x: paddle.x, y: PADDLE_Y - 12, vx: 0, vy: 0, r: 8, stuck: true }];
    waiting = 0;
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
  }

  const baseSpeed = () => (CLASSIC ? Math.min(600, 380 + level * 40 + elapsed * 0.3) : Math.min(640, 400 + elapsed * 1.1)) * (timers.slow > 0 ? 0.65 : 1);
  const descentSpeed = () => Math.min(34, 6 + elapsed * 0.09);

  function launch() {
    for (const b of balls) {
      if (!b.stuck) continue;
      b.stuck = false;
      const a = rand(-0.35, 0.35);
      const sp = baseSpeed();
      b.vx = Math.sin(a) * sp;
      b.vy = -Math.cos(a) * sp;
    }
  }

  function fire() {
    if (timers.laser <= 0 || laserCooldown > 0) return;
    laserCooldown = 0.28;
    const w = paddleWidth();
    bullets.push({ x: paddle.x - w / 2 + 8, y: PADDLE_Y - 8 }, { x: paddle.x + w / 2 - 8, y: PADDLE_Y - 8 });
    Sound.tone(1400, 700, 0.07, 'square', 0.025);
  }

  const paddleWidth = () => (timers.wide > 0 ? 150 : 96);

  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: '+' + n, t: 0 });
    if (score >= nextLifeAt) { nextLifeAt += 20000; lives++; toast('EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set(Arcade.modeKey('breakout.high'), high); }
  }

  function loseLife(reason) {
    lives--;
    shake = 0.5;
    Sound.tone(500, 60, 0.7, 'sawtooth', 0.05);
    timers = { wide: 0, laser: 0, slow: 0, fire: 0 };
    drops = []; bullets = [];
    combo = 0;
    if (lives <= 0) {
      endGame(false);
      return;
    }
    toast(reason);
    serve();
  }

  // Clears the lowest rows with a shockwave when bricks reach the danger line
  function shockwave() {
    let removed = 0;
    while (rows.length && removed < 8) {
      const r = rows[rows.length - 1];
      r.cells.forEach((c, i) => { if (c) burst(i * BW + BW / 2, r.y + BH / 2, c.color, 6); });
      rows.pop();
      removed++;
    }
    Sound.noise(0.6, 0.18, 0, 600);
  }

  function hitBrick(row, col, fromFire) {
    const c = row.cells[col];
    if (!c) return false;
    const dmg = fromFire && !c.armored ? c.hp : 1;
    c.hp -= dmg;
    c.flash = 0.12;
    const cx = col * BW + BW / 2, cy = row.y + BH / 2;
    if (c.hp <= 0) {
      row.cells[col] = null;
      bricksBroken++;
      combo++;
      const mult = Math.min(5, 1 + Math.floor(combo / 4));
      addScore(10 * c.max * mult, cx, cy);
      burst(cx, cy, c.color, 10);
      Sound.tone(300 + Math.min(combo, 20) * 40, 200 + Math.min(combo, 20) * 40, 0.06, 'square', 0.035);
      const drop = c.drop || (Math.random() < 0.03 ? 'multi' : null);
      if (drop) drops.push({ x: cx, y: cy, type: drop, suit: Math.floor(rand(0, 4)) });
    } else {
      Sound.tone(c.armored ? 180 : 520, c.armored ? 160 : 480, 0.05, 'triangle', 0.04);
    }
    return true;
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-160, 160), vy: rand(-200, 80), t: 0, life: rand(0.35, 0.7), c: color, s: rand(2, 5) });
  }

  function collect(d) {
    const p = POWERS[d.type];
    Sound.arp([660, 990], 0.06, 'triangle', 0.05);
    addScore(50);
    switch (d.type) {
      case 'multi': {
        const src = balls.find((b) => !b.stuck) || balls[0];
        if (!src) break;
        const sp = Math.hypot(src.vx, src.vy) || baseSpeed();
        for (const a of [-0.5, 0.5]) {
          if (balls.length >= 12) break;
          const ang = Math.atan2(src.vy || -1, src.vx) + a;
          balls.push({ x: src.x, y: src.stuck ? PADDLE_Y - 12 : src.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 8, stuck: false });
        }
        break;
      }
      case 'wide': timers.wide = 14; break;
      case 'laser': timers.laser = 10; break;
      case 'slow': timers.slow = 10; break;
      case 'fire': timers.fire = 8; break;
      case 'life': lives++; break;
      case 'card':
        if (suits[d.suit]) { toast(`Another ${SUITS[d.suit]} — +250`); addScore(200); return; }
        suits[d.suit] = true;
        if (suits.every(Boolean)) { suits = [false, false, false, false]; lives++; toast('♠♥♦♣ FULL SUIT SET — EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046, 1318], 0.08); }
        else toast(`Found ${SUITS[d.suit]} (${suits.filter(Boolean).length}/4 suits)`);
        return;
    }
    toast(p.name);
  }

  // ---------------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------------
  function stepBall(b, dt) {
    const sp = Math.hypot(b.vx, b.vy);
    const steps = Math.max(1, Math.ceil((sp * dt) / 4));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); Sound.tone(220, 220, 0.02, 'square', 0.015); }
      if (b.x > FW - b.r) { b.x = FW - b.r; b.vx = -Math.abs(b.vx); Sound.tone(220, 220, 0.02, 'square', 0.015); }
      if (b.y < CEIL + b.r) { b.y = CEIL + b.r; b.vy = Math.abs(b.vy); }

      // paddle
      const w = paddleWidth();
      if (b.vy > 0 && b.y + b.r >= PADDLE_Y - 7 && b.y - b.r <= PADDLE_Y + 7 && b.x >= paddle.x - w / 2 - b.r && b.x <= paddle.x + w / 2 + b.r) {
        const off = clamp((b.x - paddle.x) / (w / 2), -1, 1);
        const ang = off * 1.05;
        const speed = baseSpeed();
        b.vx = Math.sin(ang) * speed;
        b.vy = -Math.cos(ang) * speed;
        b.y = PADDLE_Y - 7 - b.r;
        combo = 0;
        Sound.tone(440, 440, 0.04, 'square', 0.03);
      }

      // bricks
      for (let ri = rows.length - 1; ri >= 0; ri--) {
        const row = rows[ri];
        if (b.y + b.r < row.y || b.y - b.r > row.y + BH) continue;
        const c0 = Math.max(0, Math.floor((b.x - b.r) / BW)), c1 = Math.min(COLS - 1, Math.floor((b.x + b.r) / BW));
        for (let c = c0; c <= c1; c++) {
          const cell = row.cells[c];
          if (!cell || row.y + BH <= CEIL) continue;
          const L = c * BW, R = L + BW, T = row.y, B = T + BH;
          const nx = clamp(b.x, L, R), ny = clamp(b.y, T, B);
          const dx = b.x - nx, dy = b.y - ny;
          if (dx * dx + dy * dy > b.r * b.r) continue;
          const fire = timers.fire > 0 && !cell.armored;
          hitBrick(row, c, fire);
          if (!fire) {
            const penX = Math.min(b.x + b.r - L, R - (b.x - b.r));
            const penY = Math.min(b.y + b.r - T, B - (b.y - b.r));
            if (penX < penY) { b.vx = b.x < (L + R) / 2 ? -Math.abs(b.vx) : Math.abs(b.vx); }
            else { b.vy = b.y < (T + B) / 2 ? -Math.abs(b.vy) : Math.abs(b.vy); }
            // keep the rally lively: nudge speed toward the current target
            const target = baseSpeed(), cur = Math.hypot(b.vx, b.vy);
            const k = (cur + (target - cur) * 0.2) / cur;
            b.vx *= k; b.vy *= k;
            return;
          }
        }
      }
    }
  }

  function update(dt) {
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    if (shake > 0) shake -= dt;
    if (state !== 'play') return;

    for (const k in timers) if (timers[k] > 0) timers[k] -= dt;
    if (laserCooldown > 0) laserCooldown -= dt;

    // paddle
    if (keys.has('left')) paddle.targetX -= 720 * dt;
    if (keys.has('right')) paddle.targetX += 720 * dt;
    const w = paddleWidth();
    paddle.targetX = clamp(paddle.targetX, w / 2, FW - w / 2);
    paddle.x += (paddle.targetX - paddle.x) * Math.min(1, dt * 25);

    const serving = balls.every((b) => b.stuck);
    if (serving) {
      waiting += dt;
      for (const b of balls) { b.x = paddle.x; b.y = PADDLE_Y - 7 - b.r; }
      if (waiting > 4) launch();
    } else {
      elapsed += dt;
      if (!CLASSIC) {
        const dy = descentSpeed() * dt;
        for (const r of rows) r.y += dy;
      }
    }
    if (!CLASSIC) refillTop();

    for (const b of balls) if (!b.stuck) stepBall(b, dt);
    const before = balls.length;
    balls = balls.filter((b) => b.y - b.r < FH);
    if (!balls.length && before) { loseLife('Ball lost!'); return; }

    // bricks reaching the danger line
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      if (r.y + BH < DANGER_Y) break;
      if (r.cells.some(Boolean)) { shockwave(); loseLife('The wall reached you!'); return; }
      rows.splice(i, 1);
    }

    // lasers
    for (const bl of bullets) {
      bl.y -= 900 * dt;
      for (const row of rows) {
        if (bl.y < row.y || bl.y > row.y + BH || row.y + BH <= CEIL) continue;
        const c = Math.floor(bl.x / BW);
        if (row.cells[c]) { hitBrick(row, c, false); bl.dead = true; break; }
      }
    }
    bullets = bullets.filter((bl) => !bl.dead && bl.y > CEIL);

    // capsules
    for (const d of drops) {
      d.y += 170 * dt;
      if (d.y > PADDLE_Y - 12 && d.y < PADDLE_Y + 12 && Math.abs(d.x - paddle.x) < w / 2 + 14) { d.got = true; collect(d); }
    }
    drops = drops.filter((d) => !d.got && d.y < FH + 20);

    for (const r of rows) for (const c of r.cells) if (c && c.flash > 0) c.flash -= dt;
    if (CLASSIC && state === 'play') {
      const left = bricksLeft();
      if (left === 0) nextLevel();
      else if (left <= 3 && !endgameHelp) {
        // last few bricks: drop a laser so the hunt doesn't drag on
        endgameHelp = true;
        drops.push({ x: clamp(paddle.x, 40, FW - 40), y: CEIL + 20, type: 'laser', suit: 0 });
        toast('LAST BRICKS — LASERS INCOMING');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }

  function render(t) {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);
    const sx = shake > 0 ? rand(-6, 6) * shake : 0, sy = shake > 0 ? rand(-6, 6) * shake : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (offX + sx), DPR * (offY + sy));

    // field
    const g = ctx.createLinearGradient(0, 0, 0, FH);
    g.addColorStop(0, '#0d0b2a'); g.addColorStop(1, '#170a2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FW, FH);
    ctx.strokeStyle = '#ffffff10';
    ctx.lineWidth = 1;
    for (let x = BW; x < FW; x += BW) { ctx.beginPath(); ctx.moveTo(x, CEIL); ctx.lineTo(x, FH); ctx.stroke(); }

    if (!rows) return;

    // danger line
    const nearest = rows.reduce((m, r) => (r.cells.some(Boolean) ? Math.max(m, r.y + BH) : m), 0);
    const danger = clamp((nearest - (DANGER_Y - 200)) / 200, 0, 1);
    ctx.strokeStyle = `rgba(255, 60, 90, ${0.15 + danger * 0.6 * (0.6 + 0.4 * Math.sin(t * 10))})`;
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, DANGER_Y); ctx.lineTo(FW, DANGER_Y); ctx.stroke();
    ctx.setLineDash([]);

    // bricks
    ctx.save();
    ctx.beginPath(); ctx.rect(0, CEIL, FW, FH - CEIL); ctx.clip();
    for (const row of rows) {
      if (row.y > FH || row.y + BH < CEIL) continue;
      row.cells.forEach((c, i) => {
        if (!c) return;
        const x = i * BW + 2, y = row.y + 2, w = BW - 4, h = BH - 4;
        let fill = c.color;
        if (c.armored) fill = '#56607a';
        else if (c.max === 3) fill = '#ffcf40';
        else if (c.max === 2) fill = '#c9d3e6';
        ctx.fillStyle = c.flash > 0 ? '#ffffff' : fill;
        rr(x, y, w, h, 4); ctx.fill();
        ctx.fillStyle = '#ffffff40';
        ctx.fillRect(x + 3, y + 2, w - 6, 3);
        ctx.fillStyle = '#00000030';
        ctx.fillRect(x + 3, y + h - 4, w - 6, 3);
        if (c.hp < c.max) {
          ctx.strokeStyle = '#0008'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(x + w * 0.3, y + 2); ctx.lineTo(x + w * 0.45, y + h * 0.6); ctx.lineTo(x + w * 0.62, y + h - 2);
          if (c.hp < c.max - 1) { ctx.moveTo(x + w * 0.45, y + h * 0.6); ctx.lineTo(x + w * 0.8, y + h * 0.4); }
          ctx.stroke();
        }
        if (c.armored) { ctx.fillStyle = '#ffffff55'; for (const px of [0.2, 0.8]) { ctx.beginPath(); ctx.arc(x + w * px, y + h / 2, 2, 0, 7); ctx.fill(); } }
        if (c.drop) { ctx.fillStyle = '#ffffffcc'; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, 3, 0, 7); ctx.fill(); }
      });
    }
    ctx.restore();

    // ceiling bar
    ctx.fillStyle = '#ffffff18';
    ctx.fillRect(0, CEIL - 3, FW, 3);

    // capsules
    ctx.font = 'bold 13px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const d of drops) {
      const p = POWERS[d.type];
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      rr(d.x - 18, d.y - 10, 36, 20, 10); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = d.type === 'card' ? (d.suit === 1 || d.suit === 2 ? '#e0153a' : '#111') : '#000';
      if (d.type === 'card') { ctx.font = '16px serif'; ctx.fillText(SUITS[d.suit], d.x, d.y + 1); ctx.font = 'bold 13px "Press Start 2P", monospace'; }
      else ctx.fillText(p.label, d.x + 1, d.y + 2);
    }

    // bullets
    ctx.fillStyle = '#ff4d6d';
    for (const bl of bullets) ctx.fillRect(bl.x - 2, bl.y - 10, 4, 14);

    // paddle
    const w = paddleWidth();
    const pg = ctx.createLinearGradient(0, PADDLE_Y - 7, 0, PADDLE_Y + 7);
    pg.addColorStop(0, timers.laser > 0 ? '#ff9aae' : '#9ffcff');
    pg.addColorStop(1, timers.laser > 0 ? '#c2185b' : '#1e88e5');
    ctx.fillStyle = pg;
    ctx.shadowColor = timers.laser > 0 ? '#ff4d6d' : '#3fd8ff'; ctx.shadowBlur = 18;
    rr(paddle.x - w / 2, PADDLE_Y - 7, w, 14, 7); ctx.fill();
    ctx.shadowBlur = 0;
    if (timers.laser > 0) { ctx.fillStyle = '#ffd23f'; ctx.fillRect(paddle.x - w / 2 + 5, PADDLE_Y - 12, 6, 6); ctx.fillRect(paddle.x + w / 2 - 11, PADDLE_Y - 12, 6, 6); }

    // balls
    for (const b of balls) {
      const fire = timers.fire > 0;
      ctx.fillStyle = fire ? '#ff8a3d' : '#ffffff';
      ctx.shadowColor = fire ? '#ff4d00' : '#9ffcff'; ctx.shadowBlur = fire ? 22 : 14;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.font = '12px "Press Start 2P", monospace';
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 0.8;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y - p.t * 40);
    }
    ctx.globalAlpha = 1;

    if (state === 'play' && balls.every((b) => b.stuck)) {
      ctx.fillStyle = '#ffffffcc';
      ctx.font = '13px "Press Start 2P", monospace';
      ctx.fillText(matchMedia('(pointer: coarse)').matches ? 'TAP TO LAUNCH' : 'CLICK OR SPACE TO LAUNCH', FW / 2, PADDLE_Y - 90);
    }
    if (paused && state === 'play') {
      ctx.fillStyle = '#0009'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#3fd8ff'; ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }

    // frame
    ctx.strokeStyle = '#3fd8ff55';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, FW - 2, FH - 2);
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v, html) => { if (last[id] !== v) { last[id] = v; html ? ($(id).innerHTML = v) : ($(id).textContent = v); } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '●'.repeat(Math.max(0, Math.min(lives, 8))));
    set('combo', combo >= 4 ? `COMBO x${Math.min(5, 1 + Math.floor(combo / 4))}` : '');
    if (CLASSIC) set('level', `LEVEL ${level + 1}/${LEVELS.length} · ${bricksLeft()} LEFT`);
    const active = Object.entries(timers).filter(([, v]) => v > 0).map(([k, v]) => `<span style="color:${POWERS[k].color}">${POWERS[k].label}${Math.ceil(v)}</span>`).join(' ');
    set('powers', active, true);
    set('suits', SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join(''), true);
  }

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') { keys.add('left'); e.preventDefault(); }
    else if (k === 'arrowright' || k === 'd') { keys.add('right'); e.preventDefault(); }
    else if (k === ' ' || k === 'arrowup' || k === 'w') {
      e.preventDefault();
      if (state === 'title' || state === 'over') { if (!e.repeat) start(); return; }
      launch(); fire();
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
    else if (k === 'enter' && (state === 'title' || state === 'over')) start();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') keys.delete('left');
    if (k === 'arrowright' || k === 'd') keys.delete('right');
  });

  const toField = (clientX) => (clientX - offX) / scale;
  canvas.addEventListener('pointermove', (e) => { if (state === 'play') paddle.targetX = toField(e.clientX); });
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    paddle.targetX = toField(e.clientX);
    if (paused) { paused = false; return; }
    launch(); fire();
  });

  $('play-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(Daily.board('breakout') || (Arcade.classic ? 'breakout-classic' : 'breakout'), document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  $('again-btn').addEventListener('click', start);
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    render(now / 1000);
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
