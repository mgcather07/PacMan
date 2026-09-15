(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, bindPadButtons, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);
  const view = setupCanvas(canvas);
  const ctx = view.ctx;

  const TAU = Math.PI * 2;
  const SIZES = { 3: { r: 54, score: 20 }, 2: { r: 30, score: 50 }, 1: { r: 16, score: 100 } };
  const SUITS = ['♠', '♥', '♦', '♣'];
  const PICKUPS = {
    shield: { color: '#3fd8ff', label: 'S', name: 'SHIELD' },
    triple: { color: '#ffd23f', label: '3', name: 'TRIPLE SHOT' },
    rapid: { color: '#ff4d6d', label: 'R', name: 'RAPID FIRE' },
    card: { color: '#ffffff', label: '♠', name: 'CARD' },
  };

  let state = 'title';
  let paused = false;
  let ship, rocks, bullets, ufos, ufoShots, pickups, particles, popups;
  let score, lives, time, farthest, suits, powers, nextLifeAt, ufoTimer, kills, fireCd, thrustSnd, shake;
  let high = store.get('asteroids.high', 0);

  function hash(x, y, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------------------
  function makeRock(x, y, size, vx, vy) {
    const r = SIZES[size].r * rand(0.9, 1.1);
    const n = 9 + Math.floor(rand(0, 5));
    const verts = [];
    for (let i = 0; i < n; i++) verts.push(r * rand(0.72, 1.08));
    return { x, y, vx, vy, r, size, verts, a: rand(0, TAU), spin: rand(-1, 1) };
  }

  const spawnRadius = () => Math.hypot(view.W, view.H) / 2 + 90;

  function spawnRock(size = 3) {
    const ang = rand(0, TAU);
    const R = spawnRadius();
    const x = ship.x + Math.cos(ang) * R, y = ship.y + Math.sin(ang) * R;
    // drift roughly toward where the ship is heading
    const toShip = Math.atan2(ship.y + ship.vy - y, ship.x + ship.vx - x) + rand(-0.9, 0.9);
    const sp = rand(35, 110) * (1 + Math.min(1.5, time / 240));
    rocks.push(makeRock(x, y, size, Math.cos(toShip) * sp + ship.vx * 0.3, Math.sin(toShip) * sp + ship.vy * 0.3));
  }

  function spawnUfo() {
    const small = time > 90 && Math.random() < Math.min(0.6, time / 400);
    const ang = rand(0, TAU), R = spawnRadius();
    ufos.push({ x: ship.x + Math.cos(ang) * R, y: ship.y + Math.sin(ang) * R, vx: 0, vy: 0, r: small ? 14 : 24, small, t: 0, shot: 1.2, turn: 0 });
    toast(small ? '⚠ SMALL SAUCER — it aims!' : '⚠ SAUCER INBOUND');
  }

  function newGame() {
    ship = { x: 0, y: 0, vx: 0, vy: 0, a: -Math.PI / 2, r: 13, invuln: 2.5, alive: true, respawn: 0, shield: 0 };
    rocks = []; bullets = []; ufos = []; ufoShots = []; pickups = []; particles = []; popups = [];
    score = 0; lives = 3; time = 0; farthest = 0; suits = [false, false, false, false];
    powers = { triple: 0, rapid: 0 };
    nextLifeAt = 10000; ufoTimer = rand(25, 35); kills = 0; fireCd = 0; thrustSnd = 0; shake = 0;
    for (let i = 0; i < 8; i++) spawnRock(Math.random() < 0.7 ? 3 : 2);
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
  }

  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), t: 0 });
    if (score >= nextLifeAt) { nextLifeAt += 10000; lives++; toast('EXTRA SHIP!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set('asteroids.high', high); }
  }

  function explode(x, y, n, color, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(20, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.4, 1.1), c: color, len: rand(2, 7), a: rand(0, TAU) });
    }
  }

  function breakRock(rock, byShip) {
    rocks.splice(rocks.indexOf(rock), 1);
    explode(rock.x, rock.y, rock.size * 7, '#c9d3ff');
    Sound.noise(0.12 + rock.size * 0.12, 0.05 + rock.size * 0.04, 0, 400 + (3 - rock.size) * 900);
    if (byShip) { addScore(SIZES[rock.size].score, rock.x, rock.y); kills++; }
    if (rock.size > 1) {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU), sp = rand(50, 120) * (1 + Math.min(1, time / 300));
        rocks.push(makeRock(rock.x, rock.y, rock.size - 1, rock.vx * 0.6 + Math.cos(a) * sp, rock.vy * 0.6 + Math.sin(a) * sp));
      }
    }
    if (byShip && rock.size >= 2 && Math.random() < (rock.size === 3 ? 0.12 : 0.05)) {
      const pool = ['shield', 'triple', 'rapid', 'card', 'card'];
      pickups.push({ x: rock.x, y: rock.y, vx: rock.vx * 0.3, vy: rock.vy * 0.3, type: pool[Math.floor(rand(0, pool.length))], suit: Math.floor(rand(0, 4)), t: 0 });
    }
  }

  function killShip() {
    if (ship.invuln > 0 || !ship.alive) return;
    if (ship.shield > 0) {
      ship.shield = 0;
      ship.invuln = 1.2;
      explode(ship.x, ship.y, 20, '#3fd8ff');
      Sound.tone(900, 200, 0.3, 'sawtooth', 0.04);
      toast('SHIELD ABSORBED THE HIT');
      return;
    }
    ship.alive = false;
    ship.respawn = 2;
    shake = 0.6;
    explode(ship.x, ship.y, 50, '#ffe600', 260);
    Sound.noise(1.0, 0.2, 0, 700);
    lives--;
    powers = { triple: 0, rapid: 0 };
    if (lives <= 0) {
      setTimeout(() => {
        state = 'over';
        $('o-score').textContent = score.toLocaleString();
        $('o-kills').textContent = kills;
        $('o-dist').textContent = Math.round(farthest / 100);
        $('over').hidden = false;
      }, 1400);
    }
  }

  function shoot() {
    const sp = 820;
    const spread = powers.triple > 0 ? [-0.14, 0, 0.14] : [0];
    for (const off of spread) {
      const a = ship.a + off;
      bullets.push({ x: ship.x + Math.cos(a) * 16, y: ship.y + Math.sin(a) * 16, vx: ship.vx + Math.cos(a) * sp, vy: ship.vy + Math.sin(a) * sp, t: 0 });
    }
    Sound.tone(1200, 300, 0.08, 'square', 0.025);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();

  function update(dt) {
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.985; p.vy *= 0.985; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    if (shake > 0) shake -= dt;
    if (state === 'title') { time += dt; moveWorld(dt); ship.x += 60 * dt; ship.y += 25 * dt; maintainRocks(); return; }
    if (state !== 'play') return;
    time += dt;

    if (ship.alive) {
      if (keys.has('left')) ship.a -= 4.4 * dt;
      if (keys.has('right')) ship.a += 4.4 * dt;
      ship.thrusting = keys.has('thrust');
      if (ship.thrusting) {
        ship.vx += Math.cos(ship.a) * 430 * dt;
        ship.vy += Math.sin(ship.a) * 430 * dt;
        thrustSnd -= dt;
        if (thrustSnd <= 0) { Sound.noise(0.09, 0.03, 0, 300); thrustSnd = 0.08; }
        if (Math.random() < 0.7) {
          const a = ship.a + Math.PI + rand(-0.3, 0.3);
          particles.push({ x: ship.x - Math.cos(ship.a) * 12, y: ship.y - Math.sin(ship.a) * 12, vx: ship.vx + Math.cos(a) * 180, vy: ship.vy + Math.sin(a) * 180, t: 0, life: 0.25, c: '#ff8a3d', len: 3, a });
        }
      }
      const sp = Math.hypot(ship.vx, ship.vy);
      if (sp > 560) { ship.vx *= 560 / sp; ship.vy *= 560 / sp; }
      const drag = Math.pow(0.55, dt);
      ship.vx *= drag; ship.vy *= drag;
      ship.x += ship.vx * dt; ship.y += ship.vy * dt;
      if (ship.invuln > 0) ship.invuln -= dt;
      if (ship.shield > 0) ship.shield -= dt;
      fireCd -= dt;
      if (keys.has('fire') && fireCd <= 0) { shoot(); fireCd = powers.rapid > 0 ? 0.08 : 0.2; }
      if (keys.has('hyper')) { keys.delete('hyper'); hyperspace(); }
      farthest = Math.max(farthest, Math.hypot(ship.x, ship.y));
    } else if (lives > 0) {
      ship.respawn -= dt;
      if (ship.respawn <= 0) {
        // respawn somewhere clear
        let tries = 0;
        while (tries++ < 20 && rocks.some((r) => Math.hypot(r.x - ship.x, r.y - ship.y) < r.r + 120)) { ship.x += rand(-200, 200); ship.y += rand(-200, 200); }
        Object.assign(ship, { vx: 0, vy: 0, a: -Math.PI / 2, alive: true, invuln: 3 });
      }
    }
    for (const k in powers) if (powers[k] > 0) powers[k] -= dt;

    moveWorld(dt);

    // bullets vs rocks / ufos
    for (const b of bullets) {
      b.t += dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      for (const r of rocks) {
        if (Math.hypot(r.x - b.x, r.y - b.y) < r.r) { b.dead = true; breakRock(r, true); break; }
      }
      if (b.dead) continue;
      for (const u of ufos) {
        if (Math.hypot(u.x - b.x, u.y - b.y) < u.r + 4) {
          b.dead = true; u.dead = true;
          addScore(u.small ? 1000 : 250, u.x, u.y);
          explode(u.x, u.y, 40, '#ff4dff', 220);
          Sound.noise(0.5, 0.15, 0, 1500);
          break;
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead && b.t < 0.95);
    ufos = ufos.filter((u) => !u.dead);

    // ufo shots
    for (const s of ufoShots) {
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (ship.alive && Math.hypot(s.x - ship.x, s.y - ship.y) < ship.r + 3) { s.dead = true; killShip(); }
    }
    ufoShots = ufoShots.filter((s) => !s.dead && s.t < 2.2);

    // ship collisions
    if (ship.alive) {
      for (const r of rocks) {
        if (Math.hypot(r.x - ship.x, r.y - ship.y) < r.r * 0.88 + ship.r) {
          if (ship.invuln <= 0) { const had = ship.shield > 0; killShip(); if (had || !ship.alive) breakRock(r, true); }
          break;
        }
      }
      for (const u of ufos) if (Math.hypot(u.x - ship.x, u.y - ship.y) < u.r + ship.r && ship.invuln <= 0) { u.dead = true; explode(u.x, u.y, 30, '#ff4dff'); killShip(); }
      for (const p of pickups) {
        if (Math.hypot(p.x - ship.x, p.y - ship.y) < 26) { p.dead = true; collect(p); }
      }
    }
    pickups = pickups.filter((p) => !p.dead && p.t < 14);

    // saucers
    ufoTimer -= dt;
    if (ufoTimer <= 0 && ufos.length < 1 + Math.floor(time / 180)) { spawnUfo(); ufoTimer = rand(18, 32) * Math.max(0.45, 1 - time / 600); }
    for (const u of ufos) {
      u.t += dt; u.turn -= dt; u.shot -= dt;
      const dx = ship.x - u.x, dy = ship.y - u.y, d = Math.hypot(dx, dy);
      if (u.turn <= 0) {
        u.turn = rand(0.8, 1.8);
        const want = d > 380 ? Math.atan2(dy, dx) : rand(0, TAU);
        const sp = u.small ? 190 : 140;
        u.vx = Math.cos(want) * sp + ship.vx * 0.6; u.vy = Math.sin(want) * sp + ship.vy * 0.6;
      }
      u.x += u.vx * dt; u.y += u.vy * dt;
      if (u.shot <= 0 && d < 700 && ship.alive) {
        u.shot = u.small ? 0.9 : 1.4;
        const err = u.small ? rand(-0.12, 0.12) : rand(-0.6, 0.6);
        const a = Math.atan2(dy + ship.vy * 0.3, dx + ship.vx * 0.3) + err;
        ufoShots.push({ x: u.x, y: u.y, vx: Math.cos(a) * 420 + u.vx * 0.3, vy: Math.sin(a) * 420 + u.vy * 0.3, t: 0 });
        Sound.tone(600, 900, 0.08, 'triangle', 0.03);
      }
      if (Math.floor(u.t * 6) !== Math.floor((u.t - dt) * 6)) Sound.tone(u.small ? 1100 : 700, u.small ? 900 : 560, 0.08, 'sine', 0.012);
    }
    ufos = ufos.filter((u) => Math.hypot(u.x - ship.x, u.y - ship.y) < spawnRadius() * 3);

    maintainRocks();
  }

  function moveWorld(dt) {
    for (const r of rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.a += r.spin * dt; }
    for (const p of pickups) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  }

  function maintainRocks() {
    const R = spawnRadius();
    rocks = rocks.filter((r) => Math.hypot(r.x - ship.x, r.y - ship.y) < R * 2.4);
    const mass = rocks.reduce((m, r) => m + r.size, 0);
    const target = 22 + Math.min(40, time / 6 + farthest / 700);
    if (mass < target && Math.random() < 0.2) spawnRock(Math.random() < 0.75 ? 3 : 2);
  }

  function hyperspace() {
    if (!ship.alive) return;
    explode(ship.x, ship.y, 16, '#9ffcff');
    const a = rand(0, TAU), d = rand(250, 500);
    ship.x += Math.cos(a) * d; ship.y += Math.sin(a) * d;
    ship.vx *= 0.2; ship.vy *= 0.2;
    ship.invuln = Math.max(ship.invuln, 0.6);
    explode(ship.x, ship.y, 16, '#9ffcff');
    Sound.tone(200, 1600, 0.25, 'sine', 0.05);
  }

  function collect(p) {
    const info = PICKUPS[p.type];
    Sound.arp([660, 990, 1320], 0.05, 'triangle', 0.05);
    addScore(100);
    if (p.type === 'shield') ship.shield = 15;
    else if (p.type === 'triple') powers.triple = 14;
    else if (p.type === 'rapid') powers.rapid = 14;
    else if (p.type === 'card') {
      if (suits[p.suit]) { toast(`Another ${SUITS[p.suit]} — +250`); addScore(150); return; }
      suits[p.suit] = true;
      if (suits.every(Boolean)) { suits = [false, false, false, false]; lives++; toast('♠♥♦♣ FULL SUIT SET — EXTRA SHIP!'); }
      else toast(`Found ${SUITS[p.suit]} (${suits.filter(Boolean).length}/4 suits)`);
      return;
    }
    toast(info.name);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#02020a';
    ctx.fillRect(0, 0, W, H);
    if (!ship) return;
    const camX = ship.x - W / 2 + (shake > 0 ? rand(-8, 8) * shake : 0);
    const camY = ship.y - H / 2 + (shake > 0 ? rand(-8, 8) * shake : 0);

    // parallax stars
    for (const [layer, par, cell, size, alpha] of [[1, 0.15, 140, 1, 0.45], [2, 0.4, 180, 1.5, 0.7], [3, 0.8, 260, 2, 0.95]]) {
      const ox = camX * par, oy = camY * par;
      const cx0 = Math.floor(ox / cell), cy0 = Math.floor(oy / cell);
      ctx.fillStyle = `rgba(210,220,255,${alpha})`;
      for (let cy = cy0; cy * cell < oy + H; cy++) {
        for (let cx = cx0; cx * cell < ox + W; cx++) {
          const n = 1 + Math.floor(hash(cx, cy, layer) * 2);
          for (let k = 0; k < n; k++) {
            const sx = cx * cell + hash(cx, cy, layer * 10 + k) * cell - ox;
            const sy = cy * cell + hash(cx, cy, layer * 20 + k) * cell - oy;
            ctx.fillRect(sx, sy, size, size);
          }
        }
      }
    }

    ctx.save();
    ctx.translate(-camX, -camY);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // rocks
    const rockPath = new Path2D();
    for (const r of rocks) {
      if (r.x + r.r < camX || r.x - r.r > camX + W || r.y + r.r < camY || r.y - r.r > camY + H) continue;
      r.verts.forEach((v, i) => {
        const a = r.a + (i / r.verts.length) * TAU;
        const px = r.x + Math.cos(a) * v, py = r.y + Math.sin(a) * v;
        i ? rockPath.lineTo(px, py) : rockPath.moveTo(px, py);
      });
      rockPath.closePath();
    }
    ctx.fillStyle = '#0c0f24';
    ctx.fill(rockPath);
    ctx.strokeStyle = 'rgba(140,160,255,0.25)'; ctx.lineWidth = 6; ctx.stroke(rockPath);
    ctx.strokeStyle = '#c9d3ff'; ctx.lineWidth = 2; ctx.stroke(rockPath);

    // pickups
    for (const p of pickups) {
      const info = PICKUPS[p.type];
      const blink = p.t > 11 && Math.floor(p.t * 8) % 2;
      if (blink) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.t * 1.5);
      ctx.strokeStyle = info.color; ctx.lineWidth = 2;
      ctx.shadowColor = info.color; ctx.shadowBlur = 14;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; i ? ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15) : ctx.moveTo(15, 0); } ctx.closePath(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.rotate(-p.t * 1.5);
      ctx.fillStyle = p.type === 'card' ? (p.suit === 1 || p.suit === 2 ? '#ff4d6d' : '#fff') : info.color;
      ctx.font = p.type === 'card' ? '16px serif' : '11px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.type === 'card' ? SUITS[p.suit] : info.label, 0, 1);
      ctx.restore();
    }

    // bullets
    ctx.fillStyle = '#fffbe0';
    ctx.shadowColor = '#ffe600'; ctx.shadowBlur = 8;
    for (const b of bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ff4dff'; ctx.shadowColor = '#ff4dff';
    for (const s of ufoShots) { ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, TAU); ctx.fill(); }
    ctx.shadowBlur = 0;

    // ufos
    for (const u of ufos) {
      const s = u.r;
      ctx.strokeStyle = '#ff4dff'; ctx.lineWidth = 2;
      ctx.shadowColor = '#ff4dff'; ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(u.x - s, u.y); ctx.lineTo(u.x - s * 0.45, u.y - s * 0.35); ctx.lineTo(u.x + s * 0.45, u.y - s * 0.35); ctx.lineTo(u.x + s, u.y);
      ctx.lineTo(u.x + s * 0.5, u.y + s * 0.35); ctx.lineTo(u.x - s * 0.5, u.y + s * 0.35); ctx.closePath();
      ctx.moveTo(u.x - s, u.y); ctx.lineTo(u.x + s, u.y);
      ctx.moveTo(u.x - s * 0.3, u.y - s * 0.35); ctx.quadraticCurveTo(u.x, u.y - s * 0.9, u.x + s * 0.3, u.y - s * 0.35);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // ship
    if (ship.alive && state !== 'title' && !(ship.invuln > 0 && Math.floor(ship.invuln * 10) % 2)) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.rotate(ship.a);
      ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 2.2;
      ctx.shadowColor = '#ffe600'; ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(18, 0); ctx.lineTo(-12, -11); ctx.lineTo(-7, 0); ctx.lineTo(-12, 11); ctx.closePath();
      ctx.stroke();
      if (ship.thrusting && Math.random() < 0.8) {
        ctx.strokeStyle = '#ff8a3d'; ctx.shadowColor = '#ff8a3d';
        ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-18 - rand(0, 10), 0); ctx.lineTo(-8, 5); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (ship.shield > 0 && !(ship.shield < 3 && Math.floor(ship.shield * 6) % 2)) {
        ctx.strokeStyle = '#3fd8ffaa'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, 26, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }

    // particles
    ctx.lineWidth = 2;
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.strokeStyle = p.c;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.a) * p.len, p.y + Math.sin(p.a) * p.len); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 0.9;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y - p.t * 30);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (state !== 'title') drawRadar();

    if (paused && state === 'play') {
      ctx.fillStyle = '#0009'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffe600'; ctx.font = '24px "Press Start 2P", monospace'; ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
  }

  function drawRadar() {
    const { W, H } = view;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const R = Math.min(70, Math.min(W, H) * 0.12);
    const cx = coarse ? W - R - 12 : R + 16, cy = coarse ? 84 + R : H - R - 16;
    const range = 2000;
    ctx.fillStyle = '#0008';
    ctx.strokeStyle = '#ffe60055'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.stroke();
    const dot = (x, y, c, s) => {
      const dx = (x - ship.x) / range * R, dy = (y - ship.y) / range * R;
      if (dx * dx + dy * dy > R * R) return;
      ctx.fillStyle = c; ctx.fillRect(cx + dx - s / 2, cy + dy - s / 2, s, s);
    };
    for (const r of rocks) dot(r.x, r.y, '#c9d3ff', r.size + 1);
    for (const u of ufos) dot(u.x, u.y, '#ff4dff', 5);
    for (const p of pickups) dot(p.x, p.y, PICKUPS[p.type].color, 4);
    ctx.fillStyle = '#ffe600'; ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v, html) => { if (last[id] !== v) { last[id] = v; html ? ($(id).innerHTML = v) : ($(id).textContent = v); } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '▲'.repeat(Math.max(0, Math.min(lives, 8))));
    set('dist', `${Math.round(Math.hypot(ship.x, ship.y) / 100)} ly from home`);
    const act = [];
    if (ship.shield > 0) act.push(`<span style="color:#3fd8ff">S${Math.ceil(ship.shield)}</span>`);
    if (powers.triple > 0) act.push(`<span style="color:#ffd23f">3${Math.ceil(powers.triple)}</span>`);
    if (powers.rapid > 0) act.push(`<span style="color:#ff4d6d">R${Math.ceil(powers.rapid)}</span>`);
    set('powers', act.join(' '), true);
    set('suits', SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join(''), true);
  }

  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'thrust', w: 'thrust', ' ': 'fire', j: 'fire', shift: 'hyper', arrowdown: 'hyper', s: 'hyper' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      if (state === 'title' || state === 'over') { if (!e.repeat && (k === ' ' || k === 'arrowup' || k === 'w')) start(); return; }
      if (!e.repeat || KEYMAP[k] !== 'hyper') keys.add(KEYMAP[k]);
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
    else if (k === 'enter' && (state === 'title' || state === 'over')) start();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP && KEYMAP[k] !== 'hyper') keys.delete(KEYMAP[k]);
  });
  window.addEventListener('blur', () => keys.clear());
  bindPadButtons(keys);

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
