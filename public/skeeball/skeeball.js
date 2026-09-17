/*
 * Skee-Ball: pull back, let go, and roll a ball up the alley, over the ramp and into the rings.
 * Physics runs in a fixed 600 x 1000 "virtual alley"; only the lane stretches to fill tall screens,
 * so a roll behaves exactly the same on every device. See docs/ADDING_A_GAME.md.
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600, VH = 1000;                 // virtual alley (physics never changes size)
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('skeeball')) || (CLASSIC ? 'skeeball-classic' : 'skeeball');
  const TAU = Math.PI * 2;

  // the ring board, hanging at the top of the alley (drawn as a squashed circle: it lies flat)
  const BX = 300, BY = 286, SY = 0.75;
  const RINGS = [{ p: 50, r: 26 }, { p: 40, r: 58 }, { p: 30, r: 92 }, { p: 20, r: 126 }, { p: 10, r: 162 }];
  const HOLE_DX = 146, HOLE_Y = 200, HOLE_RX = 30, HOLE_RY = 22;
  const APRON_Y = 408;                       // below this the ball landed short, on the apron
  const RAMP_TOP = 432, RAMP_BOT = 534;      // the ramp: the ball leaves the lane at RAMP_TOP
  const LAUNCH_Y = 900;                      // the foul line; below it is the machine's deck
  const BALL_R = 12;

  const G = 1400, RAMP_VZ = 0.574, RAMP_FWD = 0.819;   // the lip throws 35 degrees up
  const A_LANE = 60, A_RAMP = 430;                     // rolling friction, then the climb
  const LOSS = 2 * (A_LANE * (LAUNCH_Y - RAMP_BOT) + A_RAMP * (RAMP_BOT - RAMP_TOP));
  const K = G / (2 * RAMP_FWD * RAMP_VZ);              // exit speed² = K x landing distance
  const D_MIN = 18, D_MAX = 292;                       // how far past the lip the ball can land
  const MAX_AIM = 0.215;                               // radians: full aim just grazes the rail
  const CATCH = 420;                                   // below this the ball drops straight in
  const BALLS_PER_LANE = 9;
  const TARGETS = [300, 350, 400];                     // classic: three frames, rising targets
  const COLORS = { 10: '#c08b57', 20: '#7fd1c4', 30: '#57c7ff', 40: '#ffd166', 50: '#ff5d8f', 100: '#ffe066', 200: '#b892ff' };
  const VARIANTS = ['movers', 'narrow', 'tilt', 'bumpers', 'jackpot'];
  const VARIANT_NAME = { movers: 'SLIDING 100s', narrow: 'NARROW RINGS', tilt: 'TILTING RAMP', bumpers: 'BUMPERS', jackpot: 'JACKPOT RING' };

  // everything about the alley (lane order, bumpers, jackpots) comes from one seeded generator
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const wpick = (arr) => arr[Math.floor(wrand() * arr.length)];

  let state = 'title';
  let paused = false;
  let ball, lane, tickets, popups, confetti, banner;
  let score, balls, ballsInLane, laneScore, frame, frameScore, lastRoll, bestRoll, hundreds, ticketCount, streak, time;
  let aim = 0, power = 0, charging = false, chargeDir = 1, rumbleT = 0, lastVariant = '';
  let high = store.get(Arcade.modeKey('skeeball.high'), 0);
  const keys = new Set();

  // the attract-mode demo rolls behind the title screen stay silent
  const sfx = {
    tone: (...a) => { if (state === 'play') Sound.tone(...a); },
    noise: (...a) => { if (state === 'play') Sound.noise(...a); },
    arp: (...a) => { if (state === 'play') Sound.arp(...a); },
  };

  let FH = VH, stretch = 1, scale = 1, offX = 0, offY = 0, PULL = 240;
  const view = setupCanvas(canvas, (v) => {
    // the board and ramp keep their size; the lane takes up whatever height is left
    FH = clamp(Math.round((FW * v.H) / v.W), 860, 1320);
    stretch = (FH - RAMP_BOT) / (VH - RAMP_BOT);
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    PULL = clamp((v.H * 0.26) / scale, 150, 330);
  });
  const ctx = view.ctx;

  const mult = () => (CLASSIC ? 1 : 1 + Math.min(lane.n - 1, 9) * 0.4);   // caps at x4.6
  const wobble = () => (CLASSIC ? 1 : Math.min(3.2, 1 + (lane.n - 1) * 0.12));  // a tiring hand
  const sy = (y) => (y <= RAMP_BOT ? y : RAMP_BOT + (y - RAMP_BOT) * stretch);
  const laneHalf = (y) => 118 + clamp((y - RAMP_TOP) / (LAUNCH_Y - RAMP_TOP), 0, 1) * 44;
  const distFor = (p) => D_MIN + clamp(p, 0, 1) * (D_MAX - D_MIN);
  const speedFor = (p) => Math.sqrt(LOSS + K * distFor(p));

  // ---------------------------------------------------------------------------
  // Lanes
  // ---------------------------------------------------------------------------
  function newLane(n) {
    const kinds = [];
    if (!CLASSIC && n > 1) {
      let k = wpick(VARIANTS);
      if (k === lastVariant) k = wpick(VARIANTS);
      kinds.push(k);
      lastVariant = k;
      if (n >= 5 && wrand() < 0.5) {
        const k2 = wpick(VARIANTS.filter((v) => v !== k));
        if (k2) kinds.push(k2);
      }
    }
    const shrink = CLASSIC ? 1 : clamp(1 - (n - 1) * 0.025, 0.7, 1);
    const hs = CLASSIC ? 1 : clamp(1 - (n - 1) * 0.035, 0.6, 1);
    lane = {
      n,
      kinds,
      ringScale: shrink * (kinds.includes('narrow') ? 0.8 : 1),
      movers: kinds.includes('movers'),
      tilt: kinds.includes('tilt') ? 170 : 0,
      bumpers: [],
      holes: [
        { base: BX - HOLE_DX, x: BX - HOLE_DX, y: HOLE_Y, rx: HOLE_RX * hs, ry: HOLE_RY * hs, p: 100, ph: wr(0, TAU) },
        { base: BX + HOLE_DX, x: BX + HOLE_DX, y: HOLE_Y, rx: HOLE_RX * hs, ry: HOLE_RY * hs, p: 100, ph: wr(0, TAU) },
      ],
    };
    if (kinds.includes('bumpers')) {
      const rows = 2 + Math.floor(wrand() * 2);
      for (let i = 0; i < rows; i++) {
        const y = RAMP_BOT + 60 + i * 110 + wr(-20, 20);
        const spread = laneHalf(y) - 46;
        lane.bumpers.push({ x: BX + wr(-spread, spread), y, r: 17 });
      }
    }
    if (kinds.includes('jackpot')) {
      lane.holes.push({ base: BX + wr(-104, 104), x: 0, y: BY + wr(-58, 34), rx: 28 * hs, ry: 21 * hs, p: 200, jackpot: true, ph: wr(0, TAU) });
      lane.holes[lane.holes.length - 1].x = lane.holes[lane.holes.length - 1].base;
    }
    laneScore = 0;
    ballsInLane = 0;
    const label = kinds.length ? kinds.map((k) => VARIANT_NAME[k]).join(' + ') : 'STANDARD LANE';
    banner = { text: CLASSIC ? `FRAME ${frame}/3 · TARGET ${TARGETS[frame - 1]}` : `LANE ${n} · ${label}${n > 1 ? ` · x${(1 + Math.min(n - 1, 9) * 0.4).toFixed(1)}` : ''}`, t: 0 };
    sfx.arp([392, 523, 659], 0.09, 'triangle', 0.035);
  }

  function moveHoles() {
    for (const h of lane.holes) {
      if (h.jackpot) h.x = h.base + Math.sin(time * 0.6 + h.ph) * (lane.movers ? 70 : 24);
      else if (lane.movers) h.x = h.base + Math.sin(time * 0.75 + h.ph) * 62;
    }
  }

  // ---------------------------------------------------------------------------
  // Ball & physics
  // ---------------------------------------------------------------------------
  function resetBall() {
    ball = { x: BX, y: LAUNCH_Y, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, phase: 'ready', bounces: 0, doneT: 0, points: 0, trail: [] };
    power = 0;
    charging = false;
    chargeDir = 1;
  }

  function launch(p, a, spin) {
    // a hand is never exact: a little wobble on release (seeded, so a daily is the same for everyone)
    const w = wobble();
    p = clamp(p + (wrand() - 0.5) * 0.035 * w, 0, 1);
    a = clamp(a + (wrand() - 0.5) * 0.07 * w, -1, 1);
    const s = speedFor(p);
    const th = clamp(a, -1, 1) * MAX_AIM;
    ball.vx = Math.sin(th) * s;
    ball.vy = -Math.cos(th) * s;
    ball.spin = clamp(spin || 0, -170, 170);
    ball.phase = 'roll';
    ball.bounces = 0;
    ball.z = 0;
    charging = false;
    rumbleT = 0;
    sfx.noise(0.45, 0.05 + p * 0.05, 0, 320);
  }

  function holeAt(x, y) {
    for (const h of lane.holes) {
      const dx = (x - h.x) / h.rx, dy = (y - h.y) / h.ry;
      if (dx * dx + dy * dy <= 1) return h;
    }
    const d = Math.hypot(x - BX, (y - BY) / SY);
    for (const r of RINGS) if (d <= r.r * lane.ringScale) return { p: r.p, x: BX, y: BY, ring: true };
    return null;
  }

  function stepBall(b, dt) {
    b.t = (b.t || 0) + dt;
    if (b.t > 9) return finish(b, 0, 'ROLLED BACK');
    if (b.phase === 'roll') {
      if (b.y > LAUNCH_Y + 16) return finish(b, 0, 'ROLLED BACK');
      const s = Math.hypot(b.vx, b.vy);
      const ns = s - (b.y <= RAMP_BOT ? A_RAMP : A_LANE) * dt;
      if (ns <= 30) { b.phase = 'back'; b.vx = 0; b.vy = 200; return; }
      const k = ns / s;
      b.vx = b.vx * k + b.spin * 0.5 * dt;
      b.vy *= k;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      const half = laneHalf(b.y) - BALL_R;
      if (Math.abs(b.x - BX) > half) {
        b.x = BX + Math.sign(b.x - BX) * half;
        b.vx = -b.vx * 0.55;
        b.spin *= -0.4;
        if (!b.sim) sfx.tone(190, 120, 0.09, 'square', 0.035);
      }
      for (const bp of lane.bumpers) {
        const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy);
        if (d < bp.r + BALL_R && d > 0.01) {
          const nx = dx / d, ny = dy / d;
          const dot = b.vx * nx + b.vy * ny;
          b.vx = (b.vx - 2 * dot * nx) * 0.82;
          b.vy = (b.vy - 2 * dot * ny) * 0.82;
          b.x = bp.x + nx * (bp.r + BALL_R);
          b.y = bp.y + ny * (bp.r + BALL_R);
          if (!b.sim) { bp.hit = 0.25; sfx.tone(660, 330, 0.12, 'square', 0.045); }
        }
      }
      if (b.y <= RAMP_TOP) {
        const s2 = Math.hypot(b.vx, b.vy) || 1;
        const ux = b.vx / s2, uy = b.vy / s2;
        b.vx = ux * s2 * RAMP_FWD + (lane.tilt ? Math.sin(time * 2.1) * lane.tilt : 0);
        b.vy = uy * s2 * RAMP_FWD;
        b.vz = s2 * RAMP_VZ;
        b.z = 1;
        b.phase = 'air';
        if (!b.sim) sfx.tone(300, 520, 0.12, 'triangle', 0.035);
      }
      return;
    }
    if (b.phase === 'air') {
      b.vz -= G * dt;
      b.z = Math.max(0, b.z + b.vz * dt);
      b.vx += b.spin * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < 124 || b.x < 30 || b.x > FW - 30) { land(b, true); return; }
      if (b.z <= 0 && b.vz < 0) land(b, false);
      return;
    }
    if (b.phase === 'back') {
      b.y += b.vy * dt;
      if (b.y > LAUNCH_Y - 60) settle(b, 0, 'ROLLED BACK');
    }
  }

  function land(b, offBoard) {
    b.z = 0;
    if (offBoard) return finish(b, 0, 'OFF THE BOARD');
    if (b.y > APRON_Y) return finish(b, 0, 'SHORT');
    const hole = holeAt(b.x, b.y);
    const hs = Math.hypot(b.vx, b.vy);
    if (hole && (hole.ring ? hs < CATCH || b.bounces >= 2 : hs < 560)) return finish(b, hole.p, null, hole);
    // rims and the flat surround: one lively bounce, then it drops into whatever it is sitting on
    b.bounces++;
    b.vz = -b.vz * 0.36;
    b.vx *= 0.55;
    b.vy *= 0.42;
    b.spin *= 0.5;
    b.z = 0.5;
    if (!b.sim) sfx.tone(220, 160, 0.08, 'triangle', 0.04);
    if (b.bounces > 2 || b.vz < 70) {
      const h = holeAt(b.x, b.y);
      finish(b, h ? h.p : 0, h ? null : 'OFF THE BOARD', h || null);
    }
  }

  // the prediction runs the same physics, so the marker shows where the ball really comes to rest
  function finish(b, points, label, hole) {
    if (b.sim) { b.phase = 'landed'; b.landX = b.x; b.landY = b.y; b.landP = points; return; }
    settle(b, points, label, hole);
  }

  function settle(b, points, label, hole) {
    b.phase = 'done';
    b.doneT = 0;
    b.vx = b.vy = b.vz = 0;
    const pts = points ? Math.round((points * mult()) / 10) * 10 : 0;
    b.points = pts;
    lastRoll = pts;
    const x = clamp(b.x, 60, FW - 60), y = clamp(b.y, 150, LAUNCH_Y - 40);
    if (pts > 0) {
      popups.push({ x, y, text: `+${pts}`, c: COLORS[points] || '#fff', t: 0 });
      sfx.tone(points >= 100 ? 720 : 300 + points * 4, 160, 0.22, 'triangle', 0.05);
      spitTickets(Math.max(1, Math.round(pts / 10)));
      if (points >= 100) { burstConfetti(x, y); sfx.arp([784, 988, 1175, 1568], 0.07, 'square', 0.05); }
    } else {
      popups.push({ x, y, text: label || 'MISS', c: '#8a8aa0', t: 0 });
      sfx.noise(0.2, 0.05, 0, 500);
    }
    if (state === 'play') scoreBall(points, pts, hole);
  }

  // the marker that shows where this roll would land: the same physics, run fast and silently
  function predict(p, a, spin) {
    const b = {
      sim: true, x: BX, y: LAUNCH_Y, z: 0, spin: clamp(spin || 0, -170, 170), phase: 'roll', bounces: 0,
      vx: Math.sin(clamp(a, -1, 1) * MAX_AIM) * speedFor(p), vy: -Math.cos(clamp(a, -1, 1) * MAX_AIM) * speedFor(p), vz: 0,
    };
    for (let i = 0; i < 1400 && (b.phase === 'roll' || b.phase === 'air'); i++) stepBall(b, 1 / 120);
    return b.phase === 'landed' ? b : null;
  }
  function predictFrom(src) {
    const b = { sim: true, x: src.x, y: src.y, z: src.z, vx: src.vx, vy: src.vy, vz: src.vz, spin: src.spin, phase: src.phase, bounces: 0 };
    for (let i = 0; i < 1400 && (b.phase === 'roll' || b.phase === 'air'); i++) stepBall(b, 1 / 120);
    return b.phase === 'landed' ? b : null;
  }

  // ---------------------------------------------------------------------------
  // Scoring & flow
  // ---------------------------------------------------------------------------
  function addScore(n) {
    score += n;
    if (score > high) { high = score; store.set(Arcade.modeKey('skeeball.high'), high); }
  }

  function scoreBall(raw, pts, hole) {
    addScore(pts);
    balls--;
    ballsInLane++;
    laneScore += pts;
    frameScore += pts;
    if (pts > bestRoll) bestRoll = pts;
    if (raw >= 100) hundreds++;
    if (CLASSIC) return;
    if (hole && !hole.ring) {
      balls += hole.jackpot ? 2 : 1;
      toast(hole.jackpot ? 'JACKPOT! +2 BALLS' : '100! EXTRA BALL');
    }
    // three clean rolls in a row also buy a ball, so a steady player keeps going too
    streak = raw >= 40 ? streak + 1 : 0;
    if (streak && streak % 3 === 0) {
      balls++;
      toast(`HOT STREAK x${streak} · +1 BALL`);
      sfx.arp([660, 880, 1100], 0.07, 'triangle', 0.045);
    }
  }

  function endLane() {
    if (CLASSIC) return endFrame();
    const par = Math.round((250 + lane.n * 10) * mult());
    if (laneScore >= par) {
      const bonus = lane.n * 150;
      balls += 3;
      addScore(bonus);
      spitTickets(Math.round(bonus / 10));
      toast(`LANE ${lane.n} PAR BEATEN · +${bonus} · +3 BALLS`);
      sfx.arp([523, 659, 880, 1046], 0.08, 'square', 0.05);
    }
    newLane(lane.n + 1);
  }

  function endFrame() {
    const target = TARGETS[frame - 1];
    if (frameScore < target) return endGame(false, `Frame ${frame}: ${frameScore} of ${target}.`);
    if (frame >= 3) return endGame(true);
    frame++;
    frameScore = 0;
    balls = BALLS_PER_LANE;
    toast(`FRAME ${frame - 1} CLEARED! NEXT TARGET ${TARGETS[frame - 1]}`);
    sfx.arp([523, 659, 784, 1046], 0.08, 'square', 0.045);
    newLane(frame);
  }

  function nextBall() {
    if (ballsInLane >= BALLS_PER_LANE) { endLane(); if (state !== 'play') return; }
    if (balls <= 0) return endGame(false);
    resetBall();
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('skeeball') : Math.random;
    score = 0; balls = BALLS_PER_LANE; frame = 1; frameScore = 0; laneScore = 0;
    lastRoll = -1; bestRoll = 0; hundreds = 0; ticketCount = 0; streak = 0; time = 0;
    tickets = []; popups = []; confetti = []; banner = null;
    aim = 0; lastVariant = '';
    newLane(1);
    resetBall();
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    state = 'play';
    newGame();
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
  }

  function endGame(won, message) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-best').textContent = bestRoll;
    $('o-hundreds').textContent = hundreds;
    $('o-tickets').textContent = ticketCount.toLocaleString();
    Arcade.endScreen(won, won ? 'Three frames beaten. The alley is yours!' : message || '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Tickets, confetti, popups
  // ---------------------------------------------------------------------------
  const deckTop = () => sy(LAUNCH_Y + 26);
  const slot = () => ({ x: 96, y: deckTop() + (FH - deckTop()) * 0.36 });
  function spitTickets(n) {
    if (state === 'play') ticketCount += n;
    const s = slot();
    for (let i = 0; i < Math.min(n, 12); i++) {
      tickets.push({ x: s.x, y: s.y, vx: rand(20, 90), vy: rand(-120, -60), rot: rand(0, TAU), vr: rand(-6, 6), t: -i * 0.06, life: rand(1.1, 1.8) });
    }
    sfx.tone(1400, 1900, 0.05, 'square', 0.02);
    sfx.tone(1200, 1700, 0.05, 'square', 0.02, 0.06);
  }
  function burstConfetti(x, y) {
    const cols = ['#ffe066', '#ff5d8f', '#57c7ff', '#7dff6a', '#b892ff'];
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU), s = rand(60, 260);
      confetti.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 90, rot: rand(0, TAU), vr: rand(-8, 8), t: 0, life: rand(0.8, 1.6), c: cols[i % cols.length] });
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    for (const t of tickets) { t.t += dt; if (t.t > 0) { t.vy += 240 * dt; t.x += t.vx * dt; t.y += t.vy * dt; t.rot += t.vr * dt; } }
    tickets = tickets.filter((t) => t.t < t.life);
    for (const c of confetti) { c.t += dt; c.vy += 420 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; }
    confetti = confetti.filter((c) => c.t < c.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 1.1);
    for (const bp of lane.bumpers) if (bp.hit > 0) bp.hit -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2.4) banner = null; }
    moveHoles();

    if (state === 'title') {
      // attract mode: the machine keeps rolling by itself behind the title screen
      if (ball.phase === 'ready') { ball.demoT = (ball.demoT || 0) + dt; if (ball.demoT > 0.9) launch(rand(0.25, 0.95), rand(-1, 1), rand(-60, 60)); }
      else if (ball.phase === 'done') { ball.doneT += dt; if (ball.doneT > 1) resetBall(); }
      else stepBall(ball, dt);
      return;
    }
    if (state !== 'play') return;

    if (ball.phase === 'ready') {
      if (keys.has('left')) aim = clamp(aim - dt * 1.5, -1, 1);
      if (keys.has('right')) aim = clamp(aim + dt * 1.5, -1, 1);
      if (charging) {
        power += dt * 0.85 * chargeDir;
        if (power >= 1) { power = 1; chargeDir = -1; }
        if (power <= 0) { power = 0; chargeDir = 1; }
      }
    } else if (ball.phase === 'done') {
      ball.doneT += dt;
      if (ball.doneT > 0.75) nextBall();
    } else {
      if (ball.phase === 'roll') {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > 8) ball.trail.shift();
        rumbleT -= dt;
        if (rumbleT <= 0) { rumbleT = 0.16; sfx.noise(0.18, 0.025, 0, 280); }
      }
      stepBall(ball, dt);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }
  function ellipse(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, TAU); }

  function drawBackboard() {
    const g = ctx.createLinearGradient(0, 144, 0, 430);
    g.addColorStop(0, '#2a1a10');
    g.addColorStop(1, '#4a2e19');
    ctx.fillStyle = g;
    roundRect(58, 140, 484, 268, 26);
    ctx.fill();
    ctx.strokeStyle = '#2ec4b6';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#2ec4b6';
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      ctx.moveTo(62, 146 + i * 18);
      ctx.bezierCurveTo(220, 142 + i * 18 + Math.sin(i) * 5, 380, 150 + i * 18 - Math.sin(i * 2) * 5, 538, 146 + i * 18);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawRings() {
    const s = lane.ringScale;
    for (let i = RINGS.length - 1; i >= 0; i--) {
      const r = RINGS[i];
      ellipse(BX, BY, r.r * s, r.r * s * SY);
      ctx.fillStyle = i % 2 ? '#1c1109' : '#2b1a0e';
      ctx.fill();
      ctx.strokeStyle = COLORS[r.p];
      ctx.lineWidth = 3;
      ctx.shadowColor = COLORS[r.p];
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = COLORS[r.p];
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      const mid = i === 0 ? 0 : ((r.r + RINGS[i - 1].r) / 2) * s * SY;
      if (i === 0) ctx.fillText('50', BX, BY + 4);
      else { ctx.fillText(String(r.p), BX, BY - mid + 4); ctx.fillText(String(r.p), BX, BY + mid + 4); }
    }
    for (const h of lane.holes) {
      const c = COLORS[h.p];
      ellipse(h.x, h.y, h.rx, h.ry);
      ctx.fillStyle = '#100a05';
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 3;
      ctx.shadowColor = c;
      ctx.shadowBlur = 14 + (h.jackpot ? Math.sin(time * 6) * 8 : 0);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = c;
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillText(h.jackpot ? '200' : '100', h.x, h.y + 3);
      if (h.jackpot) { ctx.font = '7px "Press Start 2P", monospace'; ctx.fillText('JACKPOT', h.x, h.y - h.ry - 8); }
    }
  }

  function drawLane() {
    const yTop = sy(RAMP_TOP), yRamp = sy(RAMP_BOT), yBot = sy(LAUNCH_Y + 26);
    const hTop = laneHalf(RAMP_TOP), hRamp = laneHalf(RAMP_BOT), hBot = laneHalf(LAUNCH_Y + 26);
    // apron between the board and the ramp lip: landing here is a miss
    ctx.fillStyle = '#17100a';
    ctx.beginPath();
    ctx.moveTo(BX - hTop - 26, sy(APRON_Y));
    ctx.lineTo(BX + hTop + 26, sy(APRON_Y));
    ctx.lineTo(BX + hTop, yTop);
    ctx.lineTo(BX - hTop, yTop);
    ctx.closePath();
    ctx.fill();

    const g = ctx.createLinearGradient(0, yTop, 0, yBot);
    g.addColorStop(0, '#8a5a2e');
    g.addColorStop(0.35, '#b57c46');
    g.addColorStop(1, '#8e5c32');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(BX - hTop, yTop);
    ctx.lineTo(BX + hTop, yTop);
    ctx.lineTo(BX + hBot, yBot);
    ctx.lineTo(BX - hBot, yBot);
    ctx.closePath();
    ctx.fill();

    // grain, converging on the lip
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#3d2413';
    ctx.lineWidth = 1.5;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath();
      ctx.moveTo(BX + (i / 6) * hTop, yTop);
      ctx.lineTo(BX + (i / 6) * hBot * 1.02, yBot);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(BX - hTop * 0.5, yTop);
    ctx.lineTo(BX - hTop * 0.1, yTop);
    ctx.lineTo(BX - hBot * 0.2, yBot);
    ctx.lineTo(BX - hBot * 0.7, yBot);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    // the ramp, brighter, with a lip that tilts on tilting lanes
    const tiltA = lane.tilt ? Math.sin(time * 2.1) * 0.05 : 0;
    const rg = ctx.createLinearGradient(0, yRamp, 0, yTop);
    rg.addColorStop(0, '#b57c46');
    rg.addColorStop(1, '#e0a763');
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.moveTo(BX - hRamp, yRamp);
    ctx.lineTo(BX + hRamp, yRamp);
    ctx.lineTo(BX + hTop, yTop);
    ctx.lineTo(BX - hTop, yTop);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(BX, yTop);
    ctx.rotate(tiltA);
    ctx.fillStyle = '#ffe9c9';
    ctx.fillRect(-hTop, -5, hTop * 2, 5);
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 12;
    ctx.fillRect(-hTop, -5, hTop * 2, 2);
    ctx.shadowBlur = 0;
    ctx.restore();

    // rails
    ctx.strokeStyle = '#2ec4b6';
    ctx.lineWidth = 5;
    ctx.shadowColor = '#2ec4b6';
    ctx.shadowBlur = 14;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(BX + s * hTop, yTop);
      ctx.lineTo(BX + s * hBot, yBot);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    // foul line
    ctx.strokeStyle = '#ffffff44';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BX - laneHalf(LAUNCH_Y) + 6, sy(LAUNCH_Y + 14));
    ctx.lineTo(BX + laneHalf(LAUNCH_Y) - 6, sy(LAUNCH_Y + 14));
    ctx.stroke();

    for (const bp of lane.bumpers) {
      const y = sy(bp.y);
      ellipse(bp.x, y, bp.r, bp.r * Math.max(0.4, stretch * 0.8));
      ctx.fillStyle = bp.hit > 0 ? '#fff' : '#1b2330';
      ctx.fill();
      ctx.strokeStyle = '#ff5d8f';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#ff5d8f';
      ctx.shadowBlur = bp.hit > 0 ? 24 : 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  function drawDeck() {
    const y0 = sy(LAUNCH_Y + 26);
    ctx.fillStyle = '#100e1c';
    ctx.fillRect(0, y0, FW, FH - y0);
    ctx.strokeStyle = '#2ec4b644';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(FW, y0);
    ctx.stroke();

    // ticket slot and counter
    const sp = slot(), sx = sp.x, syy = sp.y;
    ctx.fillStyle = '#05040a';
    roundRect(sx - 34, syy - 12, 68, 18, 5);
    ctx.fill();
    ctx.strokeStyle = '#ffd16688';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffd166';
    ctx.font = '9px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('🎟 ' + ticketCount.toLocaleString(), sx, Math.min(FH - 8, syy + 26));

    // power meter
    const mw = 220, mx = FW - mw - 40, my = syy - 6;
    ctx.fillStyle = '#05040a';
    roundRect(mx, my, mw, 16, 8);
    ctx.fill();
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 2;
    ctx.stroke();
    const pg = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    pg.addColorStop(0, '#2ec4b6');
    pg.addColorStop(0.5, '#ffd166');
    pg.addColorStop(1, '#ff5d8f');
    ctx.save();
    roundRect(mx + 2, my + 2, Math.max(0, (mw - 4) * power), 12, 6);
    ctx.clip();
    ctx.fillStyle = pg;
    ctx.fillRect(mx, my, mw, 16);
    ctx.restore();
    // the 50-ring window, marked on the meter
    const lo = (RAMP_TOP - BY - 22 - D_MIN) / (D_MAX - D_MIN), hi = (RAMP_TOP - BY + 22 - D_MIN) / (D_MAX - D_MIN);
    ctx.strokeStyle = '#ff5d8f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx + mw * lo, my - 4);
    ctx.lineTo(mx + mw * hi, my - 4);
    ctx.stroke();
    ctx.fillStyle = '#8a8aa0';
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('POWER', mx + mw, Math.min(FH - 8, my + 30));
    ctx.textAlign = 'center';
  }

  function drawMarker(x, y, points) {
    ctx.save();
    ctx.strokeStyle = points ? (COLORS[points] || '#fff') + 'cc' : '#8a8aa0cc';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ellipse(x, sy(y), 22, 22 * (y <= RAMP_BOT ? SY : SY * stretch));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x - 6, sy(y));
    ctx.lineTo(x + 6, sy(y));
    ctx.moveTo(x, sy(y) - 5);
    ctx.lineTo(x, sy(y) + 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawBall() {
    const b = ball;
    if (b.phase === 'ready' && state === 'over') return;
    const y = sy(b.y);
    const lift = b.z * 0.55;
    const shrink = clamp(1 - b.z / 900, 0.45, 1);
    // shadow on the alley floor
    ctx.fillStyle = `rgba(0,0,0,${0.45 * shrink})`;
    ellipse(b.x, y, BALL_R * shrink * 1.1, BALL_R * shrink * (b.y <= RAMP_BOT ? SY : SY * stretch) * 1.1);
    ctx.fill();
    // trail while rolling
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#fff';
    for (let i = 0; i < b.trail.length; i++) {
      const t = b.trail[i];
      ellipse(t.x, sy(t.y), BALL_R * (0.3 + i / b.trail.length * 0.5), BALL_R * 0.4);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const by = y - lift;
    const r = BALL_R * (1 + b.z / 1400);
    const g = ctx.createRadialGradient(b.x - r * 0.35, by - r * 0.4, r * 0.15, b.x, by, r);
    g.addColorStop(0, '#fffdf6');
    g.addColorStop(0.5, '#e7d8bf');
    g.addColorStop(1, '#9d8261');
    ctx.fillStyle = g;
    ellipse(b.x, by, r, r);
    ctx.fill();
    ctx.strokeStyle = '#00000055';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // spin streak
    if (Math.abs(b.spin) > 20 && (b.phase === 'roll' || b.phase === 'air')) {
      ctx.strokeStyle = '#2ec4b6aa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, by, r + 4, time * 12 * Math.sign(b.spin), time * 12 * Math.sign(b.spin) + 1.6);
      ctx.stroke();
    }
  }

  function drawAim() {
    if (ball.phase !== 'ready' || state !== 'play') return;
    const th = aim * MAX_AIM;
    const len = 60 + power * 150;
    const x0 = BX, y0 = sy(LAUNCH_Y);
    const x1 = x0 + Math.sin(th) * len, y1 = y0 - Math.cos(th) * len * Math.max(0.5, stretch);
    ctx.save();
    ctx.strokeStyle = power > 0.02 ? '#ffd166' : '#2ec4b6';
    ctx.lineWidth = 5;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - Math.sin(th - 0.5) * 16, y1 + Math.cos(th - 0.5) * 16);
    ctx.lineTo(x1 - Math.sin(th + 0.5) * 16, y1 + Math.cos(th + 0.5) * 16);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    ctx.restore();
    if (power > 0.02) {
      const hit = predict(power, aim, dragSpin());
      if (hit) drawMarker(hit.landX, hit.landY, hit.landP);
    }
    if (drag) {
      // the rubber band back to your finger
      ctx.save();
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(drag.x, drag.y);
      ctx.stroke();
      ctx.restore();
    } else if (power < 0.02 && lastRoll < 0) {
      ctx.fillStyle = '#ffffff88';
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillText('PULL BACK & RELEASE', BX, sy(LAUNCH_Y) + 34);
    }
  }

  function render() {
    ctx.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    ctx.fillStyle = '#05040c';
    ctx.fillRect(0, 0, view.W, view.H);
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // arcade room behind the machine
    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#171033');
    bg.addColorStop(0.35, '#0d0a1c');
    bg.addColorStop(1, '#07060f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    ctx.globalAlpha = 0.22;
    const halo = ctx.createRadialGradient(BX, BY, 20, BX, BY, 360);
    halo.addColorStop(0, '#2ec4b6');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, FW, 600);
    ctx.globalAlpha = 1;

    drawBackboard();
    drawRings();
    drawLane();
    drawDeck();
    if (ball.phase === 'air' || ball.phase === 'roll') {
      const hit = predictFrom(ball);
      if (hit && hit.landY <= APRON_Y) drawMarker(hit.landX, hit.landY, hit.landP);
    }
    drawBall();
    drawAim();

    for (const t of tickets) {
      if (t.t < 0) continue;
      ctx.save();
      ctx.globalAlpha = clamp(1 - t.t / t.life, 0, 1);
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rot);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(-11, -5, 22, 10);
      ctx.fillStyle = '#c99a2e';
      ctx.fillRect(-11, -1, 22, 2);
      ctx.restore();
    }
    for (const c of confetti) {
      ctx.save();
      ctx.globalAlpha = clamp(1 - c.t / c.life, 0, 1);
      ctx.translate(c.x, sy(c.y));
      ctx.rotate(c.rot);
      ctx.fillStyle = c.c;
      ctx.fillRect(-4, -2, 8, 4);
      ctx.restore();
    }
    ctx.font = '13px "Press Start 2P", monospace';
    for (const p of popups) {
      ctx.globalAlpha = clamp(1.3 - p.t / 1.1, 0, 1);
      ctx.fillStyle = p.c;
      ctx.shadowColor = p.c;
      ctx.shadowBlur = 10;
      ctx.fillText(p.text, p.x, sy(p.y) - p.t * 46);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.9 ? (2.4 - banner.t) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = '#fff';
      ctx.font = '14px "Press Start 2P", monospace';
      ctx.shadowColor = '#2ec4b6';
      ctx.shadowBlur = 18;
      ctx.fillText(banner.text, FW / 2, sy(RAMP_BOT + 70));
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a';
      ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#2ec4b6';
      ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let y = 0; y < FH; y += 4) ctx.fillRect(0, y, FW, 1);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('tickets', '🎟 ' + ticketCount.toLocaleString());
    set('lane', state === 'title' ? '' : CLASSIC ? `FRAME ${frame}/3 · ${frameScore}/${TARGETS[frame - 1]}` : `LANE ${lane.n} · x${mult().toFixed(1)}`);
    set('balls', state === 'title' ? '' : balls <= 9 ? '●'.repeat(Math.max(0, balls)) : `● x${balls}`);
    set('last', state === 'title' || lastRoll < 0 ? '' : `LAST ${lastRoll}`);
  }

  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); keys.add(KEYMAP[k]); }
    else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'title' || state === 'over') return start();
      if (paused) { paused = false; return; }
      if (ball.phase === 'done' && ball.doneT > 0.3) nextBall();
      if (state === 'play' && ball.phase === 'ready') { charging = true; power = 0; chargeDir = 1; Sound.init(); }
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
    if ((k === ' ' || k === 'enter') && charging && state === 'play' && ball.phase === 'ready') launch(power, aim, 0);
  });
  window.addEventListener('blur', () => { keys.clear(); charging = false; });

  // Drag back and release (slingshot), or flick up: both set power and direction.
  let drag = null;
  const toField = (cx, cy) => ({ x: (cx - offX) / scale, y: (cy - offY) / scale });
  function dragSpin() { return drag ? drag.spin : 0; }
  function applyDrag(pt) {
    const dx = pt.x - drag.sx, dy = pt.y - drag.sy;
    const up = dy < -20 && Math.abs(dy) > Math.abs(dx) * 0.6;   // a flick up throws the way you flick
    const len = up ? -dy : dy;
    // a flick up has less room than a pull back, so it counts for a little more
    power = clamp(len / (up ? PULL * 0.72 : PULL), 0, 1);
    if (len > 8) aim = clamp(((up ? dx : -dx) / PULL) * 2.4, -1, 1);
    drag.up = up;
  }
  canvas.addEventListener('pointerdown', (e) => {
    Sound.init();
    if (paused) { paused = false; return; }
    if (state === 'play' && ball.phase === 'done' && ball.doneT > 0.3) nextBall();
    if (state !== 'play' || ball.phase !== 'ready') return;
    const pt = toField(e.clientX, e.clientY);
    drag = { sx: pt.x, sy: pt.y, x: pt.x, y: pt.y, lx: pt.x, lt: performance.now(), spin: 0, id: e.pointerId };
    power = 0;
    charging = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    e.preventDefault();
    const pt = toField(e.clientX, e.clientY);
    const now = performance.now();
    if (now - drag.lt > 40) {
      // sideways movement at the end of the flick becomes english on the ball
      drag.spin = clamp(((pt.x - drag.lx) / ((now - drag.lt) / 1000)) * 0.18, -170, 170);
      drag.lx = pt.x;
      drag.lt = now;
    }
    drag.x = pt.x;
    drag.y = pt.y;
    applyDrag(pt);
  }, { passive: false });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const spin = drag.spin * (drag.up ? 1 : -1);
    const p = power;
    drag = null;
    if (state === 'play' && ball.phase === 'ready' && p > 0.04) launch(p, aim, spin);
    else power = 0;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'skeeball',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, score, balls, ballsLeft: balls, lane: lane ? lane.n : 0, kinds: lane ? lane.kinds.slice() : [],
        frame, frameScore, target: TARGETS[frame - 1], ballsInLane, lastRoll, bestRoll, hundreds, tickets: ticketCount,
        phase: ball ? ball.phase : '', high,
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'balls') balls = v;
        else if (k === 'tickets') ticketCount = v;
        else if (k === 'frame') { frame = v; frameScore = 0; newLane(v); resetBall(); }
        else if (k === 'lane') { newLane(v); resetBall(); }
      },
      // roll(power 0..1, angle in degrees, spin) — plays a ball from the test script
      roll: (p = 0.5, angle = 0, spin = 0) => {
        if (state !== 'play' || ball.phase !== 'ready') return false;
        aim = clamp((angle * Math.PI) / 180 / MAX_AIM, -1, 1);
        launch(clamp(p, 0, 1), aim, spin);
        return true;
      },
      predict: (p, a) => predict(p, a, 0),
      win: () => { if (!CLASSIC || state !== 'play') return; frame = 3; frameScore = TARGETS[2]; score = Math.max(score, TARGETS[0] + TARGETS[1] + TARGETS[2]); endFrame(); },
    };
  }

  // attract mode behind the title screen
  newGame();
  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    render();
    hud();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
