(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  // Logical table, always played landscape: the player is on the left, the AI on the right.
  // On a portrait screen the whole table is rotated a quarter turn so the player ends up at the bottom.
  const FW = 900, FH = 560;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('pong') || (CLASSIC ? 'pong-classic' : 'pong');
  const WIN_TO = 11; // classic: first to eleven takes the match
  const PAD_X = 42, PADDLE_W = 14, PADDLE_H = 104, BALL_R = 9;
  const PLAYER_SPEED = 980;
  const BASE_SPEED = 380;
  const POWERS = {
    grow: { label: 'G', color: '#7dff6a', name: 'GROW PADDLE', secs: 12 },
    shrink: { label: 'X', color: '#ff4d6d', name: 'AI PADDLE SHRUNK', secs: 12 },
    multi: { label: 'M', color: '#3fd8ff', name: 'MULTI-BALL', secs: 10 },
    ghost: { label: '?', color: '#c77dff', name: 'GHOST BALL', secs: 10 },
    slow: { label: 'T', color: '#ffd23f', name: 'SLOW-MO', secs: 6 },
  };
  const POWER_KEYS = Object.keys(POWERS);
  // 3x5 pixel digits for the big score above the net
  const DIGITS = [
    [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 2, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
  ];

  // world randomness (serves, spin, power-up order, AI quirks) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);

  let portrait = false, scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    portrait = v.H > v.W * 1.04;
    const fw = portrait ? FH : FW, fh = portrait ? FW : FH;
    // on a wide screen the table would run under the HUD, so keep a strip clear at the top
    const padTop = portrait ? 0 : Math.min(54, v.H * 0.12);
    scale = Math.min(v.W / fw, (v.H - padTop) / fh) * 0.97;
    offX = (v.W - fw * scale) / 2;
    offY = padTop + (v.H - padTop - fh * scale) / 2;
  });
  const ctx = view.ctx;

  let state = 'title';
  let paused = false;
  let player, ai, balls, drop, particles, popups, quirk, bag;
  let score, lives, rally, longest, aces, hits, time, serveT, dropT, flash, shake, banner;
  let powers, playerPoints, aiPoints;
  let high = store.get(Arcade.modeKey('pong.high'), 0);

  // ---------------------------------------------------------------------------
  // Setup & serving
  // ---------------------------------------------------------------------------
  function newGame() {
    wrand = DAILY ? Daily.rng('pong') : Math.random;
    player = { x: PAD_X, y: FH / 2, ty: FH / 2, vy: 0, h: PADDLE_H, hit: 0 };
    ai = { x: FW - PAD_X, y: FH / 2, ty: FH / 2, vy: 0, h: PADDLE_H, hit: 0, react: 0, target: FH / 2 };
    balls = []; particles = []; popups = []; drop = null;
    score = 0; lives = 3; rally = 0; longest = 0; aces = 0; hits = 0; time = 0;
    flash = 0; shake = 0; banner = null;
    playerPoints = 0; aiPoints = 0;
    powers = { grow: 0, shrink: 0, multi: 0, ghost: 0, slow: 0 };
    // the AI's personal tics: a resting bias, how jittery it is and how eagerly it chases
    quirk = { bias: wr(-16, 16), jitter: wr(0.7, 1.35), eager: wr(0.9, 1.12) };
    bag = [];
    dropT = wr(9, 15);
    serve(wrand() < 0.5 ? -1 : 1);
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
  }

  const aiLevel = () => (CLASSIC
    ? Math.min(9, 3 + Math.floor((playerPoints + aiPoints) / 3))
    : Math.min(30, 1 + Math.floor(hits / 7)));
  const mult = () => Math.min(6, 1 + Math.floor(rally / 5) * 0.5);
  const timeFactor = () => (powers.slow > 0 ? 0.55 : 1);
  // the ball's ceiling rises with the AI, so the rally never settles into a stalemate
  const maxBallSpeed = () => Math.min(1700, 940 + aiLevel() * 24);

  function makeBall(dir, speed, angle, spin) {
    return {
      x: FW / 2, y: FH / 2, speed,
      vx: Math.cos(angle) * speed * dir, vy: Math.sin(angle) * speed,
      spin, trail: [],
    };
  }

  // dir -1 serves at the player, +1 at the AI
  function serve(dir) {
    const speed = BASE_SPEED * (1 + aiLevel() * 0.02);
    balls = [makeBall(dir, speed, wr(-0.3, 0.3), wr(-140, 140))];
    serveT = 0.85;
    rally = 0;
    powers.multi = 0;
    Sound.tone(300, 520, 0.09, 'sine', 0.03);
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    if (CLASSIC || state !== 'play') return 0;
    const pts = Math.round(n * mult());
    score += pts;
    if (x !== undefined) popups.push({ x, y, text: '+' + pts, t: 0 });
    if (score > high) { high = score; store.set(Arcade.modeKey('pong.high'), high); }
    return pts;
  }

  function spark(x, y, color, n, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(40, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.2, 0.6), c: Math.random() < 0.35 ? '#fff' : color, s: rand(2, 4.5) });
    }
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    if (CLASSIC) {
      score = playerPoints * 100 + Math.max(0, playerPoints - aiPoints) * 100;
      if (score > high) { high = score; store.set(Arcade.modeKey('pong.high'), high); }
    }
    $('o-score').textContent = score.toLocaleString();
    $('o-rally').textContent = longest;
    $('o-aces').textContent = aces;
    $('o-ai').textContent = CLASSIC ? `${playerPoints}–${aiPoints}` : aiLevel();
    Arcade.endScreen(won, won
      ? `Match won ${playerPoints}–${aiPoints}.`
      : CLASSIC ? `The AI took it ${aiPoints}–${playerPoints}.` : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Power-ups (infinite only)
  // ---------------------------------------------------------------------------
  function nextPower() {
    if (!bag.length) {
      bag = POWER_KEYS.slice();
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(wrand() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    return bag.pop();
  }

  function collect(d) {
    const p = POWERS[d.type];
    powers[d.type] = p.secs;
    addScore(100, d.x, d.y);
    toast(p.name);
    Sound.arp([660, 990, 1320], 0.05, 'triangle', 0.05);
    spark(d.x, d.y, p.color, 22, 300);
    if (d.type === 'multi') {
      const from = balls[0] || makeBall(1, BASE_SPEED, 0, 0);
      for (let i = 0; i < 2; i++) {
        const a = wr(-0.55, 0.55) + (i ? 0.35 : -0.35);
        const dir = from.vx >= 0 ? 1 : -1;
        const b = makeBall(dir, from.speed, a, wr(-160, 160));
        b.x = from.x; b.y = from.y;
        balls.push(b);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The AI
  // ---------------------------------------------------------------------------
  // where the ball will cross the AI's line, folded back off the walls
  function predictY(b) {
    if (b.vx <= 0) return FH / 2;
    const span = FH - BALL_R * 2;
    const t = (ai.x - PADDLE_W / 2 - BALL_R - b.x) / b.vx;
    let k = (b.y + b.vy * t - BALL_R) % (2 * span);
    if (k < 0) k += 2 * span;
    return BALL_R + (k > span ? 2 * span - k : k);
  }

  function threatBall() {
    let best = null, bestT = Infinity;
    for (const b of balls) {
      if (b.vx <= 0) continue;
      const t = (ai.x - b.x) / b.vx;
      if (t < bestT) { bestT = t; best = b; }
    }
    return best;
  }

  function updateAi(dt) {
    const L = aiLevel();
    const maxSpeed = Math.min(1150, 250 + L * 44) * quirk.eager;
    const reaction = Math.max(0.045, 0.34 - L * 0.026);
    const foresight = Math.min(1, 0.12 + L * 0.085);
    const error = Math.max(4, 74 - L * 6) * quirk.jitter;

    ai.react -= dt;
    if (ai.react <= 0) {
      ai.react = reaction;
      const b = threatBall();
      // a ghost ball goes invisible over the middle of the table, so the AI stops updating
      const blind = b && powers.ghost > 0 && Math.abs(b.x - FW / 2) < FW * 0.22;
      if (!b) ai.target = FH / 2 + quirk.bias;
      else if (!blind) ai.target = predictY(b) * foresight + b.y * (1 - foresight) + wr(-error, error) + quirk.bias * 0.5;
    }
    ai.ty = clamp(ai.target, ai.h / 2, FH - ai.h / 2);
    const step = maxSpeed * dt;
    const dy = clamp(ai.ty - ai.y, -step, step);
    ai.vy = dt > 0 ? dy / dt : 0;
    ai.y = clamp(ai.y + dy, ai.h / 2, FH - ai.h / 2);
  }

  // ---------------------------------------------------------------------------
  // Ball physics
  // ---------------------------------------------------------------------------
  const keys = new Set();

  function bounceOffPaddle(b, pad, mine) {
    const rel = clamp((b.y - pad.y) / (pad.h / 2), -1, 1);
    const angle = rel * 0.92;
    b.speed = Math.min(maxBallSpeed(), b.speed * (CLASSIC ? 1.06 : 1.035) + (CLASSIC ? 10 : 7));
    const dir = mine ? 1 : -1;
    b.vx = Math.cos(angle) * b.speed * dir;
    b.vy = Math.sin(angle) * b.speed;
    b.spin = clamp(b.spin * 0.3 + pad.vy * 0.6, -520, 520);
    b.x = mine ? pad.x + PADDLE_W / 2 + BALL_R + 0.5 : pad.x - PADDLE_W / 2 - BALL_R - 0.5;
    pad.hit = 0.16;
    flash = Math.max(flash, 0.1);
    shake = Math.max(shake, mine ? 3 : 2);
    const color = mine ? '#e6eeff' : '#ff7ac8';
    spark(b.x, b.y, color, Math.abs(rel) > 0.7 ? 16 : 10, 220);
    if (mine) {
      if (state === 'play') hits++;
      rally++;
      longest = Math.max(longest, rally);
      addScore(10, b.x, b.y - 18);
      Sound.tone(620 + Math.abs(rel) * 240, 900, 0.045, 'square', 0.05);
      if (rally && rally % 10 === 0 && state === 'play') banner = { text: `RALLY ${rally}`, t: 0 };
    } else {
      rally++;
      longest = Math.max(longest, rally);
      Sound.tone(420, 300, 0.045, 'square', 0.045);
    }
  }

  // one ball leaves past the player's end
  function outLeft(b) {
    balls = balls.filter((x) => x !== b);
    if (balls.length) return;
    spark(0, b.y, '#ff4d6d', 26, 320);
    flash = 0.3; shake = 9;
    Sound.tone(220, 70, 0.45, 'sawtooth', 0.06);
    Sound.noise(0.3, 0.09, 0, 650);
    if (state !== 'play') return serve(wrand() < 0.5 ? -1 : 1);
    if (CLASSIC) {
      aiPoints++;
      if (aiPoints >= WIN_TO) return endGame(false);
      banner = { text: aiPoints === WIN_TO - 1 ? 'AI MATCH POINT' : `${playerPoints} – ${aiPoints}`, t: 0 };
    } else {
      lives--;
      if (lives <= 0) return endGame(false);
      toast(`BALL LOST · ${lives} LEFT`);
    }
    serve(wrand() < 0.5 ? -1 : 1);
  }

  // one ball leaves past the AI's end: an ace
  function outRight(b) {
    balls = balls.filter((x) => x !== b);
    if (state === 'play') aces++;
    spark(FW, b.y, '#7dff6a', 26, 320);
    flash = 0.22; shake = 6;
    Sound.arp([784, 1046, 1318], 0.06, 'square', 0.05);
    if (state === 'play' && !CLASSIC) {
      const pts = addScore(250, FW - 70, b.y);
      toast(`ACE! +${pts.toLocaleString()}`);
    }
    if (balls.length) return;
    if (state !== 'play') return serve(wrand() < 0.5 ? -1 : 1);
    if (CLASSIC) {
      playerPoints++;
      if (playerPoints >= WIN_TO) return endGame(true);
      banner = { text: playerPoints === WIN_TO - 1 ? 'MATCH POINT' : `${playerPoints} – ${aiPoints}`, t: 0 };
    }
    serve(wrand() < 0.5 ? -1 : 1);
  }

  function ballStep(dt) {
    for (const b of balls.slice()) {
      if (serveT > 0) break;
      if (!balls.includes(b)) continue;
      // spin curves the flight, then the speed is normalised back so the ball never stalls
      b.spin *= Math.pow(0.2, dt);
      b.vy += b.spin * dt;
      const mag = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / mag) * b.speed;
      b.vy = (b.vy / mag) * b.speed;
      const maxVy = b.speed * 0.84;
      if (Math.abs(b.vy) > maxVy) {
        b.vy = Math.sign(b.vy) * maxVy;
        b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(b.speed * b.speed - maxVy * maxVy);
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); b.spin *= -0.4; wallBlip(b); }
      else if (b.y > FH - BALL_R) { b.y = FH - BALL_R; b.vy = -Math.abs(b.vy); b.spin *= -0.4; wallBlip(b); }

      if (b.vx < 0 && b.x - BALL_R <= player.x + PADDLE_W / 2 && b.x + BALL_R >= player.x - PADDLE_W / 2
        && Math.abs(b.y - player.y) <= player.h / 2 + BALL_R) bounceOffPaddle(b, player, true);
      else if (b.vx > 0 && b.x + BALL_R >= ai.x - PADDLE_W / 2 && b.x - BALL_R <= ai.x + PADDLE_W / 2
        && Math.abs(b.y - ai.y) <= ai.h / 2 + BALL_R) bounceOffPaddle(b, ai, false);

      if (b.x < -40) outLeft(b);
      else if (b.x > FW + 40) outRight(b);
    }
  }

  function wallBlip(b) {
    Sound.tone(210, 195, 0.05, 'triangle', 0.045);
    spark(b.x, clamp(b.y, BALL_R, FH - BALL_R), '#6a8bff', 5, 120);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    const demo = state === 'title';
    time += dt;
    if (flash > 0) flash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 26);
    if (player.hit > 0) player.hit -= dt;
    if (ai.hit > 0) ai.hit -= dt;
    if (banner) { banner.t += dt; if (banner.t > 1.6) banner = null; }
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);

    for (const k of POWER_KEYS) if (powers[k] > 0) powers[k] = Math.max(0, powers[k] - dt);
    if (powers.multi === 0 && balls.length > 1) balls = [balls[0]];
    player.h = PADDLE_H * (powers.grow > 0 ? 1.6 : 1);
    ai.h = PADDLE_H * (powers.shrink > 0 ? 0.55 : 1);

    // player paddle: the pointer/keys set a target, the paddle glides to it
    if (demo) {
      const b = balls.find((x) => x.vx < 0) || balls[0];
      if (b) player.ty = b.y + Math.sin(time * 1.7) * 46;
    } else if (keys.has('up') || keys.has('down')) {
      player.ty = player.y + (keys.has('down') ? 1 : -1) * PLAYER_SPEED * dt * 1.6;
    }
    player.ty = clamp(player.ty, player.h / 2, FH - player.h / 2);
    const step = PLAYER_SPEED * dt;
    const pdy = clamp(player.ty - player.y, -step, step);
    player.vy = dt > 0 ? pdy / dt : 0;
    player.y = clamp(player.y + pdy, player.h / 2, FH - player.h / 2);

    updateAi(dt);

    if (serveT > 0) { serveT -= dt; if (balls[0]) { balls[0].x = FW / 2; balls[0].y = FH / 2; } }
    const tf = timeFactor();
    let fastest = 0;
    for (const b of balls) fastest = Math.max(fastest, b.speed);
    const sub = clamp(Math.ceil((fastest * tf * dt) / 9), 1, 8);
    for (let i = 0; i < sub; i++) ballStep((dt * tf) / sub);
    for (const b of balls) {
      b.trail.push(b.x, b.y);
      if (b.trail.length > 28) b.trail.splice(0, b.trail.length - 28);
    }

    // power-up capsules float in over the middle of the table and are collected by the ball
    if (!CLASSIC && !demo && state === 'play') {
      if (!drop) {
        dropT -= dt;
        if (dropT <= 0) {
          dropT = wr(11, 18);
          drop = { x: wr(FW * 0.32, FW * 0.68), y: wr(70, FH - 70), type: nextPower(), t: 0, life: 12 };
        }
      } else {
        drop.t += dt;
        if (drop.t > drop.life) drop = null;
        else for (const b of balls) {
          if (Math.hypot(b.x - drop.x, b.y - drop.y) < 26 + BALL_R) { collect(drop); drop = null; break; }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const fw = () => (portrait ? FH : FW);
  const fh = () => (portrait ? FW : FH);
  // field coordinates → screen pixels (the table turns a quarter turn on portrait screens)
  const toScreen = (x, y) => (portrait
    ? [offX + y * scale, offY + (FW - x) * scale]
    : [offX + x * scale, offY + y * scale]);

  function fieldTransform(sx, sy) {
    const D = view.DPR;
    if (portrait) ctx.setTransform(0, -D * scale, D * scale, 0, D * (offX + sx), D * (offY + FW * scale + sy));
    else ctx.setTransform(D * scale, 0, 0, D * scale, D * (offX + sx), D * (offY + sy));
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function drawPaddle(pad, color) {
    const x = pad.x - PADDLE_W / 2, y = pad.y - pad.h / 2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20 + (pad.hit > 0 ? 34 : 0);
    ctx.fillStyle = pad.hit > 0 ? '#fff' : color;
    roundRect(x, y, PADDLE_W, pad.h, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    roundRect(x + 4, y + 8, PADDLE_W - 8, pad.h - 16, 3);
    ctx.fill();
  }

  function ballAlpha(b) {
    if (powers.ghost <= 0) return 1;
    const u = Math.abs(b.x - FW / 2) / (FW * 0.42);
    return clamp(u * u, 0.07, 1);
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#03040e';
    ctx.fillRect(0, 0, W, H);
    const sx = shake ? rand(-shake, shake) : 0, sy = shake ? rand(-shake, shake) : 0;
    fieldTransform(sx, sy);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, FW, FH);
    bg.addColorStop(0, '#080b1e'); bg.addColorStop(0.5, '#05081a'); bg.addColorStop(1, '#0a0718');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);

    // table markings: glowing border, centre circle and the dashed net
    ctx.strokeStyle = 'rgba(120,150,220,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, FW - 3, FH - 3);
    ctx.strokeStyle = 'rgba(120,150,220,0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(FW / 2, FH / 2, 96, 0, TAU); ctx.stroke();
    ctx.save();
    ctx.shadowColor = '#7f9cff'; ctx.shadowBlur = 12;
    ctx.fillStyle = 'rgba(190,210,255,0.45)';
    for (let y = 10; y < FH - 10; y += 34) ctx.fillRect(FW / 2 - 3, y, 6, 20);
    ctx.restore();

    // power-up capsule
    if (drop) {
      const p = POWERS[drop.type];
      const fade = drop.life - drop.t < 2.5 && Math.floor(drop.t * 8) % 2 ? 0.25 : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(drop.x, drop.y);
      ctx.rotate(Math.sin(drop.t * 2.4) * 0.22);
      ctx.shadowColor = p.color; ctx.shadowBlur = 20;
      ctx.fillStyle = '#0b0d22'; ctx.strokeStyle = p.color; ctx.lineWidth = 3;
      roundRect(-24, -20, 48, 40, 12);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = p.color;
      ctx.font = '18px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.label, 0, 2);
      ctx.restore();
    }

    drawPaddle(player, '#e6eeff');
    drawPaddle(ai, '#ff7ac8');

    // ball trails and balls
    for (const b of balls) {
      const a = ballAlpha(b);
      const n = b.trail.length / 2;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        ctx.globalAlpha = a * 0.5 * k * k;
        ctx.fillStyle = powers.ghost > 0 ? '#c77dff' : '#8fd8ff';
        const r = BALL_R * (0.25 + k * 0.75);
        ctx.beginPath(); ctx.arc(b.trail[i * 2], b.trail[i * 2 + 1], r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = a;
      ctx.shadowColor = powers.slow > 0 ? '#ffd23f' : '#9fe8ff';
      ctx.shadowBlur = 26;
      ctx.fillStyle = '#fff';
      const pulse = serveT > 0 ? 1 + Math.sin(time * 18) * 0.18 : 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R * pulse, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;

    if (flash > 0) { ctx.fillStyle = `rgba(200,225,255,${Math.min(0.45, flash * 0.9)})`; ctx.fillRect(0, 0, FW, FH); }
    ctx.restore();

    // everything with text stays upright, whichever way round the table is
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawScoreboard();
    for (const p of popups) {
      const [px, py] = toScreen(p.x, p.y);
      ctx.globalAlpha = 1 - p.t / 0.8;
      ctx.fillStyle = '#fff';
      ctx.font = '11px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.text, px, py - p.t * 40);
    }
    ctx.globalAlpha = 1;
    if (banner) {
      const a = banner.t < 0.2 ? banner.t / 0.2 : banner.t > 1.2 ? (1.6 - banner.t) / 0.4 : 1;
      const [bx, by] = toScreen(FW / 2, FH / 2);
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.round(clamp(fw() * scale * 0.045, 14, 30))}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#7f9cff'; ctx.shadowBlur = 22;
      ctx.fillText(banner.text, bx, by);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#e6eeff';
      ctx.font = '26px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }

    // CRT scanlines over the whole screen
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  }

  // big pixel digits, drawn in screen space either side of the net
  function digits(text, cx, cy, px, color, alpha) {
    const w = text.length * 4 * px - px;
    let x = cx - w / 2;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    for (const ch of text) {
      const d = DIGITS[+ch];
      if (d) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (d[r] & (4 >> c)) ctx.fillRect(x + c * px, cy + r * px, px, px);
      x += 4 * px;
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function drawScoreboard() {
    const left = CLASSIC ? String(playerPoints) : String(rally);
    const right = CLASSIC ? String(aiPoints) : String(aiLevel());
    const px = Math.max(2, Math.round(Math.min(fw(), fh()) * scale * 0.018));
    const [cx, cy] = toScreen(FW / 2, FH / 2);
    if (portrait) {
      digits(left, cx - fw() * scale * 0.26, cy + px * 3, px, '#e6eeff', 0.5);
      digits(right, cx + fw() * scale * 0.26, cy - px * 8, px, '#ff7ac8', 0.5);
    } else {
      const top = offY + fh() * scale * 0.1;
      digits(left, cx - fw() * scale * 0.16, top, px, '#e6eeff', 0.5);
      digits(right, cx + fw() * scale * 0.16, top, px, '#ff7ac8', 0.5);
    }
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    if (!player) return;
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '●'.repeat(Math.max(0, Math.min(lives, 8))));
    set('match', `YOU ${playerPoints} · CPU ${aiPoints}`);
    set('rally', state === 'title' ? '' : `RALLY ${rally}${rally >= 5 ? ` ×${mult()}` : ''}`);
    set('ai', state === 'title' ? '' : `AI LEVEL ${aiLevel()}`);
    set('power', POWER_KEYS.filter((k) => powers[k] > 0).map((k) => `${POWERS[k].name} ${Math.ceil(powers[k])}`).join(' · '));
  }

  const KEYMAP = { arrowup: 'up', w: 'up', arrowleft: 'up', a: 'up', arrowdown: 'down', s: 'down', arrowright: 'down', d: 'down' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); if (state === 'play') { keys.add(KEYMAP[k]); paused = false; } }
    else if (k === ' ' || k === 'enter') { e.preventDefault(); if ((state === 'title' || state === 'over') && !e.repeat) start(); else if (state === 'play') paused = false; }
    else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (k in KEYMAP) keys.delete(KEYMAP[k]); });
  window.addEventListener('blur', () => keys.clear());

  // Mouse: the paddle follows the pointer. Touch: drag anywhere (relative, so your finger doesn't cover it).
  // the paddle only ever moves along the field's y axis: across the screen when the table is turned
  const toFieldY = (cx, cy) => (portrait ? cx - offX : cy - offY) / scale;
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    keys.clear();
    if (e.pointerType === 'mouse') player.ty = toFieldY(e.clientX, e.clientY);
    else drag = { s: toFieldY(e.clientX, e.clientY), p: player.ty, id: e.pointerId };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse') { keys.clear(); player.ty = toFieldY(e.clientX, e.clientY); }
    else if (drag && drag.id === e.pointerId) player.ty = drag.p + (toFieldY(e.clientX, e.clientY) - drag.s) * 1.35;
  });
  const endPointer = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

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
      game: 'pong',
      peek: () => ({
        state, paused, score, lives, rally, longest, aces, hits, aiLevel: aiLevel(),
        playerPoints, aiPoints, balls: balls.length, ballY: balls[0] ? Math.round(balls[0].y) : null,
        speed: balls[0] ? Math.round(balls[0].speed) : 0, playerY: Math.round(player.y), aiY: Math.round(ai.y),
        serving: serveT > 0, drop: drop && drop.type, powers: { ...powers },
      }),
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      moveTo: (y) => { player.ty = y; player.y = clamp(y, player.h / 2, FH - player.h / 2); },
      press: (k) => keys.add(k),
      release: (k) => keys.delete(k),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'lives') lives = v;
        else if (k === 'rally') { rally = v; longest = Math.max(longest, v); }
        else if (k === 'ai' || k === 'hits') hits = k === 'ai' ? (v - 1) * 7 : v;
        else if (k === 'points') playerPoints = v;
        else if (k === 'aipoints') aiPoints = v;
        else if (k === 'power') powers[v] = POWERS[v].secs;
      },
      win: () => { playerPoints = WIN_TO; aiPoints = Math.min(aiPoints, WIN_TO - 2); endGame(true); },
      start,
    };
  }

  // attract mode behind the title screen: an AI-vs-AI rally
  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused && (state === 'play' || state === 'title')) update(dt);
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
