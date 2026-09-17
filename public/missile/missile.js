(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600;
  // the sky stretches to fill tall screens (phones); missile speeds scale with it so the
  // time you get to react is the same everywhere
  let FH = 900, GROUND_Y = FH - 84, MUZZLE_Y = GROUND_Y - 30;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('missile') || (CLASSIC ? 'missile-classic' : 'missile');
  const FINAL_WAVE = 12; // classic: survive twelve waves to win
  const AMMO_MAX = 10;
  const BLAST_R = 48, CHAIN_R = 42, GROUND_R = 30;
  const BAT_X = [46, FW / 2, FW - 46];
  const CITY_X = [110, 176, 242, 358, 424, 490];
  const CITY_W = 52;
  const POINTS = { missile: 25, plane: 100, smart: 125 };
  const COL = { enemy: '#ff5c7a', shot: '#7df9ff', city: '#b98cff', bat: '#ffd23f', bomber: '#ffb347', sat: '#c9b3ff', smart: '#7dff6a' };

  // world randomness (attack patterns, targets, enemy types) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const pick = (arr) => arr[Math.floor(wrand() * arr.length)];

  let state = 'title';
  let paused = false;
  let cities, batteries, enemies, shots, blasts, planes, particles, popups, stars;
  let score, wave, kills, fired, time, remaining, spawnT, planeT, loseT, bonusT, bonus;
  let banner, flash, shake, cursor, sel, kbd, lastEmpty, attractT, aiT, clearT;
  let high = store.get(Arcade.modeKey('missile.high'), 0);

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    FH = clamp(Math.round((FW * v.H) / v.W), 720, 1400);
    GROUND_Y = FH - 84;
    MUZZLE_Y = GROUND_Y - 30;
    if (stars) for (const s of stars) s.y = Math.min(s.y, GROUND_Y - 40);
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function makeStars() {
    stars = [];
    for (let i = 0; i < 70; i++) stars.push({ x: rand(0, FW), y: rand(0, GROUND_Y - 40), s: rand(0.5, 1.7), tw: rand(0, TAU) });
  }

  // a little skyline per city, seeded so a daily looks the same for everyone
  function makeCity(x) {
    const blocks = [];
    let dx = -CITY_W / 2;
    while (dx < CITY_W / 2 - 5) {
      const w = Math.round(wr(6, 12));
      blocks.push({ dx, w: Math.min(w, CITY_W / 2 - dx), h: Math.round(wr(13, 38)), lit: wrand() < 0.55 });
      dx += w + 2;
    }
    return { x, alive: true, blocks };
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('missile') : Math.random;
    cities = CITY_X.map(makeCity);
    batteries = BAT_X.map((x) => ({ x, ammo: AMMO_MAX, alive: true, flash: 0 }));
    enemies = []; shots = []; blasts = []; planes = []; particles = []; popups = [];
    score = 0; wave = 0; kills = 0; fired = 0; time = 0;
    remaining = 0; spawnT = 0; planeT = 0; loseT = 0; bonusT = 0; bonus = null; clearT = 0;
    flash = 0; shake = 0; sel = 1; kbd = false; lastEmpty = -9;
    cursor = { x: FW / 2, y: FH * 0.45 };
    banner = null;
    makeStars();
    startWave();
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

  // ---------------------------------------------------------------------------
  // Waves
  // ---------------------------------------------------------------------------
  const mult = () => Math.min(6, 1 + Math.floor((wave - 1) / 2));
  const liveCities = () => cities.filter((c) => c.alive).length;
  const fallScale = () => FH / 900; // keep the fall time equal on every screen

  function waveCfg(w) {
    const cfg = {
      n: Math.min(40, 5 + Math.round(w * 1.7)),
      speed: Math.min(250, 46 + w * 7),
      salvo: w < 3 ? 1 : w < 7 ? 2 : 3,
      gap: Math.max(0.55, 2.2 - w * 0.09),
      mirv: w < 4 ? 0 : Math.min(0.22, (w - 3) * 0.04),
      planes: w >= 3,
      sat: w >= 5,
      smart: w >= 8 ? Math.min(0.12, (w - 7) * 0.025) : 0,
    };
    // Classic has to be beatable: the same attack, a little thinner and slower
    if (CLASSIC) {
      cfg.n = Math.round(cfg.n * 0.82);
      cfg.speed = Math.min(cfg.speed, 46 + w * 5.5);
      cfg.mirv *= 0.7;
      cfg.smart *= 0.6;
    }
    return cfg;
  }

  function startWave() {
    wave++;
    const cfg = waveCfg(wave);
    remaining = cfg.n;
    spawnT = 1.4;
    planeT = cfg.planes ? wr(3.5, 8) : 0;
    clearT = 0;
    for (const b of batteries) { b.alive = true; b.ammo = AMMO_MAX; }
    banner = { text: CLASSIC ? `WAVE ${wave}/${FINAL_WAVE}  ×${mult()}` : `WAVE ${wave}  ×${mult()}`, t: 0 };
    Sound.arp([392, 330, 262], 0.14, 'sawtooth', 0.03);
  }

  function nextWave() {
    bonus = null;
    if (CLASSIC && wave >= FINAL_WAVE) return endGame(true);
    state = 'play';
    startWave();
  }

  // wave cleared: points for what you didn't spend, then a city may come back
  function waveDone() {
    const ammo = batteries.reduce((s, b) => s + b.ammo, 0);
    const alive = liveCities();
    bonus = { ammo, ammoPts: ammo * 5, cities: alive, cityPts: alive * 100, rebuilt: null };
    addScore(bonus.ammoPts + bonus.cityPts);
    if (wave % 3 === 0) {
      const dead = cities.filter((c) => !c.alive);
      if (dead.length) {
        const c = pick(dead);
        c.alive = true;
        bonus.rebuilt = c;
        Sound.arp([440, 587, 740, 880], 0.09, 'triangle', 0.045);
      }
    }
    state = 'bonus';
    bonusT = 3.4;
    Sound.arp([523, 659, 784, 1046], 0.08, 'square', 0.04);
  }

  // ---------------------------------------------------------------------------
  // Scoring & effects
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: String(n), t: 0 });
    if (score > high) { high = score; store.set(Arcade.modeKey('missile.high'), high); }
    return n;
  }

  function explode(x, y, color, n, speed = 220) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(30, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.3, 0.9), c: Math.random() < 0.3 ? '#fff' : color, s: rand(1.5, 3.5) });
    }
  }

  function addBlast(x, y, max, kills) {
    blasts.push({ x, y, max, t: 0, up: 0.4, hold: 0.34, down: 0.58, kills, seed: rand(0, TAU) });
    Sound.noise(0.36, kills ? 0.07 : 0.11, 0, kills ? 1600 : 600);
  }
  const blastLife = (b) => b.up + b.hold + b.down;
  function blastR(b) {
    if (b.t < b.up) return b.max * (b.t / b.up);
    if (b.t < b.up + b.hold) return b.max;
    return b.max * Math.max(0, 1 - (b.t - b.up - b.hold) / b.down);
  }

  // ---------------------------------------------------------------------------
  // Enemies
  // ---------------------------------------------------------------------------
  function pickTarget() {
    const t = [];
    for (const c of cities) if (c.alive) t.push(c.x);
    for (const b of batteries) if (b.alive) t.push(b.x);
    if (!t.length) return wr(60, FW - 60);
    return t[Math.floor(wrand() * t.length)];
  }

  function launchEnemy(sx, sy, tx, speed, opts = {}) {
    const dx = tx - sx, dy = GROUND_Y - sy;
    const d = Math.hypot(dx, dy) || 1;
    enemies.push({
      x: sx, y: sy, tx, speed, smart: !!opts.smart, mirv: opts.mirv || 0,
      vx: (dx / d) * speed, vy: (dy / d) * speed,
      pts: [[sx, sy]], trailT: 0, dead: false,
    });
  }

  function splitMirv(m) {
    m.mirv = 0;
    const n = wrand() < 0.35 ? 3 : 2;
    for (let i = 0; i < n; i++) launchEnemy(m.x, m.y, pickTarget(), m.speed * 0.96);
    m.dead = true;
    explode(m.x, m.y, COL.enemy, 8, 120);
    Sound.tone(520, 220, 0.14, 'square', 0.02);
  }

  function spawnPlane(kind) {
    const dir = wrand() < 0.5 ? 1 : -1;
    const y = kind === 'sat' ? wr(0.09, 0.19) * FH : wr(0.22, 0.36) * FH;
    const sp = (kind === 'sat' ? 64 : 92) + wave * 3;
    planes.push({ kind, x: dir > 0 ? -44 : FW + 44, y, vx: dir * sp, dropT: wr(0.8, 2), t: 0 });
  }

  function killEnemy(m) {
    m.dead = true;
    kills++;
    if (state === 'play') {
      const pts = (m.smart ? POINTS.smart : POINTS.missile) * mult();
      addScore(pts, m.x, m.y);
    }
    explode(m.x, m.y, m.smart ? COL.smart : COL.enemy, 10, 160);
    addBlast(m.x, m.y, CHAIN_R, true); // chains: every kill blooms into another blast
  }

  function killPlane(p) {
    p.dead = true;
    kills++;
    if (state === 'play') addScore(POINTS.plane * mult(), p.x, p.y);
    explode(p.x, p.y, p.kind === 'sat' ? COL.sat : COL.bomber, 26, 260);
    addBlast(p.x, p.y, CHAIN_R, true);
    Sound.arp([880, 660, 440], 0.06, 'square', 0.05);
  }

  // an enemy missile reached the ground
  function groundHit(x) {
    addBlast(x, GROUND_Y - 4, GROUND_R, false);
    explode(x, GROUND_Y - 4, COL.bomber, 16, 200);
    shake = Math.max(shake, 7);
    if (state !== 'play') return;
    let lost = 0;
    for (const c of cities) {
      if (!c.alive || Math.abs(c.x - x) > CITY_W / 2 + 4) continue;
      c.alive = false; lost++;
      explode(c.x, GROUND_Y - 16, COL.city, 40, 300);
    }
    for (const b of batteries) {
      if (!b.alive || Math.abs(b.x - x) > 28) continue;
      b.alive = false; b.ammo = 0; b.flash = 0.5;
      explode(b.x, GROUND_Y - 16, COL.bat, 30, 280);
      toast('BATTERY KNOCKED OUT');
    }
    if (lost) {
      flash = 0.5;
      shake = 18;
      Sound.noise(1.1, 0.22, 0, 420);
      const left = liveCities();
      toast(left ? `CITY DESTROYED · ${left} LEFT` : 'LAST CITY LOST');
      if (!left) loseT = 1.4;
    }
  }

  // ---------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------
  function fireAt(tx, ty, prefer, free) {
    if (state !== 'play' && !free) return;
    tx = clamp(tx, 8, FW - 8);
    ty = clamp(ty, 26, GROUND_Y - 26);
    let bat = null;
    if (prefer != null && batteries[prefer] && batteries[prefer].alive && (free || batteries[prefer].ammo > 0)) bat = batteries[prefer];
    if (!bat) {
      let best = Infinity;
      for (const b of batteries) {
        if (!b.alive || (!free && b.ammo <= 0)) continue;
        const d = Math.hypot(b.x - tx, MUZZLE_Y - ty);
        if (d < best) { best = d; bat = b; }
      }
    }
    if (!bat) {
      if (time - lastEmpty > 1.1) { lastEmpty = time; toast('OUT OF MISSILES'); Sound.tone(190, 110, 0.12, 'square', 0.03); }
      return;
    }
    if (!free) { bat.ammo--; fired++; }
    bat.flash = 0.12;
    const dx = tx - bat.x, dy = ty - MUZZLE_Y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = 640;
    shots.push({ x: bat.x, y: MUZZLE_Y, sx: bat.x, sy: MUZZLE_Y, tx, ty, vx: (dx / d) * sp, vy: (dy / d) * sp, left: d / sp });
    Sound.tone(180, 760, 0.16, 'sawtooth', 0.025);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function tickBlasts(dt) {
    for (const b of blasts) b.t += dt;
    blasts = blasts.filter((b) => b.t < blastLife(b));
  }

  function tickShots(dt) {
    for (const s of shots) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.left -= dt;
      if (s.left <= 0) { s.dead = true; addBlast(s.tx, s.ty, BLAST_R, true); }
    }
    shots = shots.filter((s) => !s.dead);
  }

  // smart bombs steer around live blasts but never stop coming down
  function steerSmart(m, dt) {
    let dx = clamp((m.tx - m.x) / 100, -1.1, 1.1), dy = 1;
    for (const b of blasts) {
      if (!b.kills) continue;
      const r = blastR(b) + 44;
      const ex = m.x - b.x, ey = m.y - b.y;
      const d = Math.hypot(ex, ey) || 1;
      if (d > r) continue;
      const w = ((r - d) / r) * 3.2;
      dx += (ex / d) * w;
      dy += (ey / d) * w * 0.35;
    }
    dy = Math.max(dy, 0.22);
    const l = Math.hypot(dx, dy) || 1;
    const turn = Math.min(1, dt * 5);
    m.vx += ((dx / l) * m.speed - m.vx) * turn;
    m.vy += ((dy / l) * m.speed - m.vy) * turn;
  }

  function tickEnemies(dt) {
    for (const m of enemies) {
      if (m.smart) {
        steerSmart(m, dt);
        m.trailT += dt;
        if (m.trailT > 0.09) { m.trailT = 0; m.pts.push([m.x, m.y]); if (m.pts.length > 60) m.pts.shift(); }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.x < 6 || m.x > FW - 6) { m.x = clamp(m.x, 6, FW - 6); m.vx *= -0.5; }
      if (m.mirv && m.y >= m.mirv) { splitMirv(m); continue; }
      if (m.y >= GROUND_Y - 2) { m.dead = true; groundHit(m.x); continue; }
      for (const b of blasts) {
        if (!b.kills) continue;
        if (Math.hypot(m.x - b.x, m.y - b.y) < blastR(b)) { killEnemy(m); break; }
      }
    }
    enemies = enemies.filter((m) => !m.dead);
  }

  function tickPlanes(dt) {
    for (const p of planes) {
      p.t += dt;
      p.x += p.vx * dt;
      p.dropT -= dt;
      if (p.dropT <= 0 && p.x > 10 && p.x < FW - 10 && state === 'play') {
        p.dropT = wr(1.1, 2.4);
        const cfg = waveCfg(wave);
        launchEnemy(p.x, p.y + 10, pickTarget(), cfg.speed * fallScale() * 0.9);
        Sound.tone(300, 150, 0.1, 'square', 0.015);
      }
      for (const b of blasts) {
        if (!b.kills) continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < blastR(b) + 8) { killPlane(p); break; }
      }
      if (p.x < -70 || p.x > FW + 70) p.dead = true;
    }
    planes = planes.filter((p) => !p.dead);
  }

  function tickCosmetics(dt) {
    for (const s of stars) s.tw += dt * 1.6;
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.vx *= 0.97; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    for (const b of batteries || []) if (b.flash > 0) b.flash -= dt;
    if (flash > 0) flash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 34);
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
  }

  // title screen: missiles rain and an invisible gunner answers them
  function attract(dt) {
    attractT -= dt;
    if (attractT <= 0 && enemies.length < 6) {
      attractT = rand(0.4, 1.3);
      launchEnemy(rand(30, FW - 30), -10, CITY_X[Math.floor(Math.random() * 6)], (70 + rand(0, 40)) * fallScale());
    }
    aiT -= dt;
    if (aiT <= 0) {
      aiT = rand(0.3, 0.7);
      let low = null;
      for (const m of enemies) if (m.y > FH * 0.2 && (!low || m.y > low.y)) low = m;
      if (low) fireAt(low.x + rand(-16, 16), low.y + rand(40, 110), null, true);
    }
  }

  function update(dt) {
    time += dt;
    tickCosmetics(dt);
    if (state === 'over') return;
    tickBlasts(dt);
    tickShots(dt);
    tickEnemies(dt);
    tickPlanes(dt);
    if (state === 'title') { attract(dt); return; }
    if (state === 'bonus') { bonusT -= dt; if (bonusT <= 0) nextWave(); return; }
    if (state !== 'play') return;

    // keyboard crosshair
    if (kbd) {
      const sp = 400 * dt;
      if (keys.has('left')) cursor.x -= sp;
      if (keys.has('right')) cursor.x += sp;
      if (keys.has('up')) cursor.y -= sp;
      if (keys.has('down')) cursor.y += sp;
      cursor.x = clamp(cursor.x, 8, FW - 8);
      cursor.y = clamp(cursor.y, 26, GROUND_Y - 26);
    }

    if (loseT > 0) {
      loseT -= dt;
      if (loseT <= 0) return endGame(false);
    }

    const cfg = waveCfg(wave);
    const speed = cfg.speed * fallScale();

    // the attack itself
    spawnT -= dt;
    if (spawnT <= 0 && remaining > 0) {
      spawnT = cfg.gap * wr(0.7, 1.35);
      const k = Math.min(remaining, 1 + Math.floor(wrand() * cfg.salvo));
      for (let i = 0; i < k; i++) {
        remaining--;
        const smart = wrand() < cfg.smart;
        const mirv = !smart && wrand() < cfg.mirv ? wr(0.24, 0.46) * FH : 0;
        launchEnemy(wr(24, FW - 24), -10, pickTarget(), smart ? speed * 0.6 : speed, { smart, mirv });
      }
    }
    if (planeT > 0 && remaining > 0) {
      planeT -= dt;
      if (planeT <= 0) {
        planeT = wr(7, 14);
        spawnPlane(cfg.sat && wrand() < 0.45 ? 'sat' : 'bomber');
      }
    }

    // sky clear → bonus screen
    if (!remaining && !enemies.length && !planes.length) {
      clearT += dt;
      if (clearT > 0.9) waveDone();
    } else clearT = 0;
  }

  function endGame(won) {
    if (state === 'over') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-wave').textContent = CLASSIC ? `${Math.min(wave, FINAL_WAVE)}/${FINAL_WAVE}` : wave;
    $('o-kills').textContent = kills.toLocaleString();
    $('o-cities').textContent = `${liveCities()}/6`;
    Arcade.endScreen(won, won ? 'Twelve waves repelled — the cities are still standing.' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won, time: Math.round(time) }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawCity(c) {
    if (!c.alive) {
      ctx.fillStyle = '#3a2438';
      for (let i = 0; i < 5; i++) {
        const w = 7 + ((i * 5) % 9);
        ctx.fillRect(c.x - CITY_W / 2 + i * 11, GROUND_Y - 4 - (i % 2) * 3, w, 4 + (i % 2) * 3);
      }
      return;
    }
    ctx.save();
    ctx.shadowColor = COL.city;
    ctx.shadowBlur = 12;
    ctx.fillStyle = COL.city;
    for (const b of c.blocks) ctx.fillRect(c.x + b.dx, GROUND_Y - b.h, b.w, b.h);
    ctx.restore();
    ctx.fillStyle = '#ffe9a8';
    for (const b of c.blocks) {
      if (!b.lit) continue;
      for (let y = GROUND_Y - b.h + 4; y < GROUND_Y - 4; y += 7) ctx.fillRect(c.x + b.dx + 2, y, 2, 3);
    }
  }

  function drawBattery(b, i) {
    const col = !b.alive ? '#5a4030' : b.flash > 0 ? '#fff' : COL.bat;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = b.alive ? 10 : 0;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(b.x - 26, GROUND_Y);
    ctx.lineTo(b.x - 13, GROUND_Y - 16);
    ctx.lineTo(b.x + 13, GROUND_Y - 16);
    ctx.lineTo(b.x + 26, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    if (b.alive) {
      // the classic pyramid of ready missiles, 1 + 2 + 3 + 4
      ctx.fillStyle = col;
      let n = 0;
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c <= r; c++) {
          if (++n > b.ammo) continue;
          const x = b.x - r * 4 + c * 8, y = GROUND_Y - 22 - (3 - r) * 7;
          ctx.fillRect(x - 1.5, y, 3, 5);
          ctx.beginPath();
          ctx.moveTo(x - 2.5, y); ctx.lineTo(x, y - 3.5); ctx.lineTo(x + 2.5, y);
          ctx.closePath(); ctx.fill();
        }
      }
    }
    // readable ammo count under each battery
    ctx.font = '15px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = !b.alive ? '#ff3b5c' : b.ammo === 0 ? '#6a5a70' : b.ammo <= 3 ? '#ffb347' : COL.bat;
    ctx.fillText(b.alive ? String(b.ammo) : 'X', b.x, GROUND_Y + 16);
    if (kbd && state === 'play' && sel === i && b.alive) {
      ctx.strokeStyle = COL.shot;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x - 30, GROUND_Y - 48, 60, 82);
    }
  }

  function drawTrail(m, color, head) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(m.pts[0][0], m.pts[0][1]);
    for (let i = 1; i < m.pts.length; i++) ctx.lineTo(m.pts[i][0], m.pts[i][1]);
    ctx.lineTo(m.x, m.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = head;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawPlane(p) {
    const col = p.kind === 'sat' ? COL.sat : COL.bomber;
    const d = Math.sign(p.vx) || 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(d, 1);
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.fillStyle = col;
    if (p.kind === 'sat') {
      ctx.fillRect(-6, -6, 12, 12);
      ctx.fillRect(-22, -3, 13, 6);
      ctx.fillRect(9, -3, 13, 6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(-2, -2, 4, 4);
    } else {
      ctx.beginPath();
      ctx.moveTo(-20, 0); ctx.lineTo(4, -6); ctx.lineTo(22, 0); ctx.lineTo(4, 6);
      ctx.closePath(); ctx.fill();
      ctx.fillRect(-6, -12, 5, 12);
      ctx.fillStyle = '#fff';
      if (Math.floor(p.t * 8) % 2) ctx.fillRect(14, -2, 5, 4);
    }
    ctx.restore();
  }

  function drawBlasts() {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blasts) {
      const r = blastR(b) * (1 + Math.sin(b.t * 26 + b.seed) * 0.05);
      if (r < 1) continue;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, b.kills ? 'rgba(255,214,63,0.8)' : 'rgba(255,150,60,0.75)');
      g.addColorStop(0.75, 'rgba(255,92,122,0.5)');
      g.addColorStop(1, 'rgba(255,92,122,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const b of blasts) {
      const r = blastR(b);
      if (r < 1) continue;
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - b.t / blastLife(b))})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.stroke();
    }
  }

  function drawCrosshair() {
    const x = cursor.x, y = cursor.y;
    ctx.strokeStyle = COL.shot;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(x - 14, y); ctx.lineTo(x - 4, y);
    ctx.moveTo(x + 4, y); ctx.lineTo(x + 14, y);
    ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 4);
    ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBonus() {
    const w = 380, h = 190, x = (FW - w) / 2, y = FH * 0.34;
    ctx.fillStyle = 'rgba(8,4,18,0.88)';
    ctx.strokeStyle = COL.enemy;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 10); else ctx.rect(x, y, w, h);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COL.enemy;
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillText(`WAVE ${wave} CLEARED`, FW / 2, y + 32);
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillStyle = '#fff';
    ctx.fillText(`MISSILES  ${bonus.ammo} × 5 = ${bonus.ammoPts}`, FW / 2, y + 74);
    ctx.fillText(`CITIES  ${bonus.cities} × 100 = ${bonus.cityPts}`, FW / 2, y + 104);
    ctx.fillStyle = COL.bat;
    ctx.fillText(`BONUS  ${(bonus.ammoPts + bonus.cityPts).toLocaleString()}`, FW / 2, y + 138);
    if (bonus.rebuilt) {
      ctx.fillStyle = COL.city;
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.fillText('A CITY HAS BEEN REBUILT', FW / 2, y + 166);
    }
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const sx = shake > 0 ? rand(-shake, shake) : 0;
    const sy = shake > 0 ? rand(-shake, shake) : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (offX + sx * scale), DPR * (offY + sy * scale));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#05030f');
    bg.addColorStop(0.72, '#150726');
    bg.addColorStop(1, '#2a0a24');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    for (const s of stars) { ctx.globalAlpha = 0.3 + Math.sin(s.tw) * 0.25; ctx.fillStyle = '#ffd9e6'; ctx.fillRect(s.x, s.y, s.s, s.s); }
    ctx.globalAlpha = 1;
    if (!cities) { ctx.restore(); return; }

    // ground
    ctx.fillStyle = '#170a1c';
    ctx.fillRect(0, GROUND_Y, FW, FH - GROUND_Y);
    ctx.save();
    ctx.shadowColor = COL.enemy;
    ctx.shadowBlur = 14;
    ctx.fillStyle = COL.enemy;
    ctx.fillRect(0, GROUND_Y, FW, 3);
    ctx.restore();

    cities.forEach(drawCity);
    batteries.forEach(drawBattery);

    for (const p of planes) drawPlane(p);
    for (const m of enemies) drawTrail(m, m.smart ? COL.smart : COL.enemy, '#fff');
    for (const s of shots) {
      ctx.strokeStyle = COL.shot;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(s.sx, s.sy); ctx.lineTo(s.x, s.y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.shadowColor = COL.shot; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = COL.shot;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.tx - 6, s.ty - 6); ctx.lineTo(s.tx + 6, s.ty + 6);
      ctx.moveTo(s.tx + 6, s.ty - 6); ctx.lineTo(s.tx - 6, s.ty + 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    drawBlasts();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of popups) { ctx.globalAlpha = 1 - p.t / 0.9; ctx.fillStyle = '#fff'; ctx.fillText(p.text, p.x, p.y - p.t * 42); }
    ctx.globalAlpha = 1;

    if (state === 'play' && !paused) drawCrosshair();
    if (state === 'bonus' && bonus) drawBonus();

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.8 ? (2.2 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = '22px "Press Start 2P", monospace';
      ctx.shadowColor = COL.enemy; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, FW / 2, FH * 0.42);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,120,150,${Math.min(0.55, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = COL.enemy; ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < FH; y += 4) ctx.fillRect(0, y, FW, 1);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    if (!cities) return;
    const set = (id, v, html) => { if (last[id] !== v) { last[id] = v; html ? ($(id).innerHTML = v) : ($(id).textContent = v); } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('wave', state === 'title' ? '' : `WAVE ${wave}${CLASSIC ? '/' + FINAL_WAVE : ''}`);
    set('mult', state === 'title' ? '' : `×${mult()}`);
    set('cities', cities.map((c) => `<i class="${c.alive ? 'on' : ''}"></i>`).join(''), true);
    set('ammo', batteries.map((b) => `<b class="${!b.alive ? 'dead' : b.ammo === 0 ? 'out' : b.ammo <= 3 ? 'low' : ''}">${b.alive ? b.ammo : 'X'}</b>`).join(''), true);
  }

  const keys = new Set();
  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      if (state === 'play') { keys.add(KEYMAP[k]); kbd = true; }
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'title' || state === 'over') start();
      else if (state === 'bonus') bonusT = Math.min(bonusT, 0.12);
      else if (state === 'play') { if (paused) paused = false; else { kbd = true; fireAt(cursor.x, cursor.y, sel); } }
    } else if (k === '1' || k === '2' || k === '3') {
      if (state === 'play') { sel = +k - 1; kbd = true; }
    } else if (k === 'p' || k === 'escape') {
      if (state === 'play') paused = !paused;
    } else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
  });
  window.addEventListener('blur', () => keys.clear());

  // Click or tap the sky: that point is the target.
  const toX = (cx) => (cx - offX) / scale;
  const toY = (cy) => (cy - offY) / scale;
  canvas.addEventListener('pointerdown', (e) => {
    if (state === 'bonus') { bonusT = Math.min(bonusT, 0.12); return; }
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    kbd = false;
    cursor.x = toX(e.clientX);
    cursor.y = toY(e.clientY);
    fireAt(cursor.x, cursor.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    kbd = false;
    cursor.x = toX(e.clientX);
    cursor.y = toY(e.clientY);
  });

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
      game: 'missile',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play' || state === 'bonus') update(dt); },
      // the bonus screen is part of a run, so it reads as 'play' to a test loop
      peek: () => ({
        state: state === 'bonus' ? 'play' : state, phase: state, paused, score, wave, mult: mult(),
        cities: liveCities(), ammo: batteries.map((b) => b.ammo), batteries: batteries.map((b) => b.alive),
        incoming: enemies.length, planes: planes.length, blasts: blasts.length, shots: shots.length,
        remaining, kills, fired, time: Math.round(time),
        // positions so a test can actually aim: [x, y, 'missile' | 'smart' | 'bomber' | 'sat']
        sky: enemies.map((m) => [Math.round(m.x), Math.round(m.y), m.smart ? 'smart' : 'missile'])
          .concat(planes.map((p) => [Math.round(p.x), Math.round(p.y), p.kind === 'sat' ? 'sat' : 'bomber'])),
        ground: GROUND_Y,
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'wave') { clear(); wave = v - 1; startWave(); }
        else if (k === 'cities') cities.forEach((c, i) => { c.alive = i < v; });
        else if (k === 'ammo') batteries.forEach((b) => { b.ammo = v; b.alive = true; });
      },
      fire: (x, y, bat) => fireAt(x, y, bat),
      clear,
      win: () => { clear(); wave = FINAL_WAVE; endGame(true); },
    };
  }

  function clear() {
    enemies = []; planes = []; shots = []; blasts = []; remaining = 0; loseT = 0;
  }

  // attract mode behind the title screen
  newGame();
  attractT = 0.6; aiT = 1.2;
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
