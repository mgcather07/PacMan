/* Sky Flyer — a one-button flyer: flap through gates across five changing skies. See docs/ADDING_A_GAME.md. */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 540, FH = 900;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('flyer')) || (CLASSIC ? 'flyer-classic' : 'flyer');
  const FINAL_GATE = 50;                    // classic: pass fifty gates to win
  const CEIL_Y = 28, GROUND_Y = FH - 84;    // both are deadly
  const BIRD_X = 150, BIRD_R = 15;
  const GRAV = 1500, FLAP_V = -470, MAX_FALL = 880;
  const GATE_W = 70, BIOME_LEN = 20;
  const GAP_MAX = 252, GAP_MIN = 158, EDGE = 74;
  const GATE_PTS = 10, COIN_PTS = 5, POWER_PTS = 25, BIOME_PTS = 200, WIN_PTS = 500;

  // Five skies, each with its own palette, gate shape and one gameplay wrinkle.
  const BIOMES = [
    {
      id: 'dawn', name: 'DAWN SKY', wrinkle: 'Clear air', style: 'pipe', mote: 'petal',
      sky: ['#27407e', '#ffc38b'], orb: '#fff3c4', accent: '#ffd166',
      hills: ['#33538f', '#243b68', '#172744'], ground: ['#6ab04c', '#3a6829'], gate: ['#7ad37f', '#2f7a3d', '#bdf3b6'],
    },
    {
      id: 'storm', name: 'THUNDERHEAD', wrinkle: 'Wind gusts', style: 'spire', mote: 'rain',
      sky: ['#111725', '#49546e'], orb: null, accent: '#8fd8ff',
      hills: ['#2c3347', '#1f2535', '#151a26'], ground: ['#3d4658', '#212837'], gate: ['#93a0b3', '#454f63', '#c9d2de'],
    },
    {
      id: 'night', name: 'FIREFLY NIGHT', wrinkle: 'Drifting gates', style: 'crystal', mote: 'firefly',
      sky: ['#04081c', '#17294f'], orb: '#eaf2ff', accent: '#ffe27a',
      hills: ['#13214a', '#0d1836', '#070f22'], ground: ['#101b36', '#060b18'], gate: ['#4468b0', '#1f3158', '#9cc0ff'],
    },
    {
      id: 'cave', name: 'DEEP CAVERN', wrinkle: 'Tight stone', style: 'stalac', mote: 'dust',
      sky: ['#170d18', '#3d222a'], orb: null, accent: '#ff9e6d',
      hills: ['#36222c', '#281920', '#1a1016'], ground: ['#3f2832', '#1d1217'], gate: ['#8a6470', '#412a34', '#c49a9a'],
    },
    {
      id: 'sunset', name: 'EMBER SUNSET', wrinkle: 'Thermals', style: 'cloud', mote: 'ember',
      sky: ['#3d1663', '#ff7a5c'], orb: '#ffe08a', accent: '#ffe27a',
      hills: ['#5d2573', '#3f1657', '#260c38'], ground: ['#4f2069', '#2b0e3e'], gate: ['#ffd2ab', '#cf7455', '#fff2e4'],
    },
  ];
  const PU = { feather: { icon: '🪶', label: 'SLOW-MO', color: '#bde0ff' }, shield: { icon: '🛡️', label: 'SHIELD', color: '#7dffcf' }, magnet: { icon: '🧲', label: 'MAGNET', color: '#ff8fa3' } };

  // world randomness (gate heights, coins, power-ups) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const wpick = (arr) => arr[Math.floor(wrand() * arr.length) % arr.length];

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  let state = 'title';
  let paused = false;
  let bird, gates, coins, pickups, particles, pops, clouds, motes;
  let score, gateCount, coinCount, gateSeq, dist, time, lastGapY;
  let biomeIdx, prevBiome, biomeT, ready, dying, invuln, shield, slow, magnet, hitFlash, bolt, banner, won;
  let high = store.get(Arcade.modeKey('flyer.high'), 0);

  // ---------------------------------------------------------------------------
  // Course generation — a pure function of the gate index, so a daily always
  // builds the exact same course whatever the frame rate.
  // ---------------------------------------------------------------------------
  const speedAt = (n) => Math.min(CLASSIC ? 330 : 380, 180 + n * (CLASSIC ? 2.2 : 2.4));
  const spacingAt = (n) => 268 + speedAt(n) * 0.36;
  const biomeFor = (n) => (CLASSIC ? Math.min(BIOMES.length - 1, Math.floor(n / BIOME_LEN)) : Math.floor(n / BIOME_LEN) % BIOMES.length);

  function spawnGate(x) {
    const idx = gateSeq++;
    const bi = BIOMES[biomeFor(idx)];
    let gap = Math.max(CLASSIC ? 172 : GAP_MIN, GAP_MAX - idx * (CLASSIC ? 1.2 : 1.6));
    if (bi.id === 'cave') gap -= 16;
    const half = gap / 2;
    const lo = CEIL_Y + EDGE + half, hi = GROUND_Y - EDGE - half;
    let gapY = wr(lo, hi);
    gapY = clamp(gapY, Math.max(lo, lastGapY - 200), Math.min(hi, lastGapY + 200));
    lastGapY = gapY;
    const amp = bi.id === 'night' ? wr(24, 58) : bi.id === 'sunset' ? wr(0, 20) : 0;
    gates.push({ x, idx, gapY, gap, amp, phase: wr(0, TAU), biome: biomeFor(idx), style: bi.style, passed: false });

    // coins drift in the open air after the gate
    const roll = wrand();
    const n = roll < 0.1 ? 0 : roll < 0.55 ? 3 : roll < 0.85 ? 5 : 7;
    const shape = wpick(['line', 'arc', 'col']);
    const cx0 = x + GATE_W + 88 + wr(0, 46);
    const cy0 = clamp(gapY + wr(-56, 56), CEIL_Y + 50, GROUND_Y - 50);
    for (let i = 0; i < n; i++) {
      let cx = cx0, cy = cy0;
      if (shape === 'line') cx += i * 34;
      else if (shape === 'col') cy += (i - (n - 1) / 2) * 34;
      else { cx += i * 30; cy -= n > 1 ? Math.sin((i / (n - 1)) * Math.PI) * 58 : 0; }
      coins.push({ x: cx, y: clamp(cy, CEIL_Y + 26, GROUND_Y - 26), t: wr(0, TAU), got: false });
    }

    // a power-up every few gates, bobbing between the gates
    if (idx >= 2 && wrand() < 0.17) {
      const type = wpick(['feather', 'shield', 'magnet']);
      pickups.push({ x: x + GATE_W + 200 + wr(0, 54), y: wr(CEIL_Y + 110, GROUND_Y - 110), type, t: wr(0, TAU), got: false });
    }
  }

  // keep three gates queued beyond the right edge
  function fillGates() {
    for (let guard = 0; guard < 16; guard++) {
      if (CLASSIC && state !== 'title' && gateSeq >= FINAL_GATE) return;
      const last = gates[gates.length - 1];
      const x = last ? last.x + spacingAt(last.idx) : FW + 150;
      if (x > FW + 560) return;
      spawnGate(x);
    }
  }

  function makeClouds() {
    clouds = [];
    for (let i = 0; i < 7; i++) clouds.push({ x: rand(-100, FW + 200), y: rand(60, 360), s: rand(0.5, 1.3), v: rand(0.16, 0.3) });
  }
  function makeMotes() {
    motes = [];
    for (let i = 0; i < 46; i++) motes.push({ x: rand(0, FW), y: rand(CEIL_Y, GROUND_Y), s: rand(0.6, 1.6), p: rand(0, TAU), v: rand(0.7, 1.5) });
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('flyer') : Math.random;
    bird = { y: FH * 0.42, vy: 0, flapT: 0, tilt: 0, spin: 0 };
    gates = []; coins = []; pickups = []; particles = []; pops = [];
    score = 0; gateCount = 0; coinCount = 0; gateSeq = 0; dist = 0; time = 0;
    lastGapY = FH * 0.44;
    biomeIdx = 0; prevBiome = 0; biomeT = 1;
    ready = true; dying = 0; invuln = 0; shield = 0; slow = 0; magnet = 0; hitFlash = 0; bolt = 0; won = false;
    banner = { text: BIOMES[0].name, sub: BIOMES[0].wrinkle, t: 0 };
    makeClouds();
    makeMotes();
    fillGates();
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    const hint = $('flap-hint');
    if (hint) hint.classList.remove('gone');
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
  }

  // ---------------------------------------------------------------------------
  // Scoring & effects
  // ---------------------------------------------------------------------------
  function addScore(n, x, y, color) {
    score += n;
    if (x !== undefined) pops.push({ x, y, text: '+' + n, t: 0, c: color || '#fff' });
    if (score > high) { high = score; store.set(Arcade.modeKey('flyer.high'), high); }
  }

  function puff(x, y, n, color, speed = 150) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(20, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.2, 0.6), c: color, s: rand(2, 4.5) });
    }
  }

  function feathers(x, y) {
    for (let i = 0; i < 16; i++) {
      const a = rand(-2.6, -0.5), s = rand(60, 260);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.5, 1.1), c: i % 3 ? '#ffd23f' : '#fff3c4', s: rand(3, 6) });
    }
  }

  function gapCenter(g) {
    if (!g.amp) return g.gapY;
    const half = g.gap / 2;
    return clamp(g.gapY + Math.sin(dist / 170 + g.phase) * g.amp, CEIL_Y + 40 + half, GROUND_Y - 40 - half);
  }

  function circleHitsRect(cx, cy, r, x, y, w, h) {
    const nx = clamp(cx, x, x + w), ny = clamp(cy, y, y + h);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function gateHit(g) {
    if (g.x > BIRD_X + BIRD_R || g.x + GATE_W < BIRD_X - BIRD_R) return false;
    const cy = gapCenter(g), r = BIRD_R - 2;
    const top = cy - g.gap / 2, bot = cy + g.gap / 2;
    return circleHitsRect(BIRD_X, bird.y, r, g.x, CEIL_Y - 200, GATE_W, top - CEIL_Y + 200)
      || circleHitsRect(BIRD_X, bird.y, r, g.x, bot, GATE_W, GROUND_Y - bot + 200);
  }

  function flap(quiet) {
    if (state === 'over' || dying > 0) return;
    if (ready) { ready = false; banner = null; }
    bird.vy = FLAP_V;
    bird.flapT = 0.26;
    puff(BIRD_X - 14, bird.y + 8, 3, '#ffffff66', 90);
    if (!quiet) { Sound.tone(480, 880, 0.07, 'sine', 0.035); Sound.noise(0.06, 0.025, 0, 1100); }
  }

  function hit(kind) {
    if (state !== 'play' || dying > 0 || invuln > 0) return;
    if (shield > 0) {
      shield--;
      invuln = 1.1;
      bird.vy = -520;                                                     // a free flap to get clear
      if (kind === 'ground') bird.y = GROUND_Y - BIRD_R - 4;
      if (kind === 'ceiling') { bird.y = CEIL_Y + BIRD_R + 4; bird.vy = 300; }
      puff(BIRD_X, bird.y, 22, '#7dffcf', 260);
      Sound.tone(880, 220, 0.3, 'sawtooth', 0.045);
      toast(shield ? `SHIELD HELD · ${shield} LEFT` : 'SHIELD BROKEN');
      return;
    }
    dying = 0.85;
    hitFlash = 0.3;
    feathers(BIRD_X, bird.y);
    Sound.noise(0.5, 0.16, 0, 800);
    Sound.tone(360, 90, 0.5, 'sawtooth', 0.05);
  }

  function grab(p) {
    p.got = true;
    const info = PU[p.type];
    if (p.type === 'feather') slow = Math.max(slow, 4);
    else if (p.type === 'shield') shield = Math.min(2, shield + 1);
    else magnet = Math.max(magnet, 8);
    addScore(POWER_PTS, p.x, p.y, info.color);
    puff(p.x, p.y, 16, info.color, 200);
    toast(`${info.icon} ${info.label}`);
    Sound.arp([660, 990, 1320, 1760], 0.055, 'triangle', 0.045);
  }

  function winNow() {
    if (state !== 'play') return;
    gateCount = Math.max(gateCount, FINAL_GATE);
    addScore(WIN_PTS);
    won = true;
    endGame(true);
  }

  function endGame(w) {
    if (state !== 'play') return;
    state = 'over';
    won = !!w;
    $('o-score').textContent = score.toLocaleString();
    $('o-gates').textContent = CLASSIC ? `${Math.min(gateCount, FINAL_GATE)}/${FINAL_GATE}` : gateCount.toLocaleString();
    $('o-coins').textContent = coinCount.toLocaleString();
    $('o-best').textContent = high.toLocaleString();
    Arcade.endScreen(won, won ? 'Fifty gates, three skies, one bird. Course cleared!' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won, time }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    const attract = state === 'title';
    time += dt;

    // cosmetics run on real time
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.vx *= 0.96; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of pops) p.t += dt;
    pops = pops.filter((p) => p.t < 0.9);
    if (hitFlash > 0) hitFlash -= dt;
    if (bolt > 0) bolt -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2.4) banner = null; }
    if (biomeT < 1) biomeT = Math.min(1, biomeT + dt / 1.1);
    if (bird.flapT > 0) bird.flapT -= dt;
    if (state === 'over') return;

    // power-up timers run on real time, the world runs on slow-mo time
    if (!attract) {
      if (slow > 0) slow -= dt;
      if (magnet > 0) magnet -= dt;
      if (invuln > 0) invuln -= dt;
    }
    const wdt = dt * (slow > 0 ? 0.55 : 1);
    const bio = BIOMES[biomeIdx];
    if (bio.id === 'storm' && Math.random() < dt * 0.35) bolt = 0.18;

    // the bird tumbles out of the sky before the game-over screen
    if (dying > 0) {
      dying -= dt;
      bird.vy = Math.min(MAX_FALL, bird.vy + GRAV * dt);
      bird.y = Math.min(GROUND_Y - BIRD_R, bird.y + bird.vy * dt);
      bird.spin += dt * 8;
      if (dying <= 0) endGame(false);
      return;
    }

    const worldX = dist + BIRD_X;
    let sp = speedAt(gateCount);
    if (bio.id === 'storm') sp *= 1 + Math.sin(worldX / 520) * 0.16;
    const rolling = attract || !ready;
    const adv = rolling ? sp * wdt : 0;
    dist += adv;

    // bird
    if (attract) {
      const g = gates.find((gt) => gt.x + GATE_W > BIRD_X - 30);
      const target = g ? gapCenter(g) : FH * 0.44;
      if (bird.y > target + 8 && bird.vy > -60) flap(true);
      bird.vy = clamp(bird.vy + GRAV * wdt, -700, MAX_FALL);
      bird.y = clamp(bird.y + bird.vy * wdt, CEIL_Y + BIRD_R + 4, GROUND_Y - BIRD_R - 4);
    } else if (ready) {
      bird.y = FH * 0.42 + Math.sin(time * 3) * 12;
      bird.vy = Math.cos(time * 3) * 36;
    } else {
      if (bio.id === 'storm') bird.vy += Math.sin(worldX / 230) * 210 * wdt;           // buffeting gusts
      if (bio.id === 'sunset' && Math.sin(worldX / 200) > 0.55) bird.vy -= 300 * wdt;  // rising thermals
      bird.vy = clamp(bird.vy + GRAV * wdt, -760, MAX_FALL);
      bird.y += bird.vy * wdt;
    }
    bird.tilt = clamp(Math.atan2(bird.vy, 560), -0.5, 1.15);

    // scroll the world
    if (adv) {
      for (const g of gates) g.x -= adv;
      for (const c of coins) c.x -= adv;
      for (const p of pickups) p.x -= adv;
    }
    for (const c of clouds) {
      c.x -= (adv * 0.22 + c.v * 12 * wdt);
      if (c.x < -140) { c.x = FW + rand(40, 220); c.y = rand(50, 370); c.s = rand(0.5, 1.3); }
    }
    for (const m of motes) {
      m.p += wdt * m.v * 3;
      m.x -= adv * 1.25 * m.s;
      if (bio.mote === 'rain') m.y += 620 * wdt * m.s;
      else if (bio.mote === 'ember') m.y -= 40 * wdt * m.s;
      else m.y += Math.sin(m.p) * 18 * wdt;
      if (m.x < -20) { m.x = FW + rand(0, 60); m.y = rand(CEIL_Y, GROUND_Y); }
      if (m.y > GROUND_Y) m.y = CEIL_Y;
      if (m.y < CEIL_Y) m.y = GROUND_Y;
    }

    // gates: pass, score, cull
    for (const g of gates) {
      if (!g.passed && g.x + GATE_W < BIRD_X - BIRD_R) {
        g.passed = true;
        gateCount++;
        if (!attract) {
          addScore(GATE_PTS, BIRD_X + 26, bird.y - 26, '#fff');
          Sound.tone(720, 980, 0.08, 'square', 0.03);
        }
        const nb = biomeFor(gateCount);
        if (nb !== biomeIdx) {
          prevBiome = biomeIdx; biomeIdx = nb; biomeT = 0;
          if (!attract) {
            addScore(BIOME_PTS);
            banner = { text: BIOMES[nb].name, sub: BIOMES[nb].wrinkle + ' · +' + BIOME_PTS, t: 0 };
            Sound.arp([523, 659, 784, 1046], 0.09, 'triangle', 0.04);
          }
        }
        if (!attract && CLASSIC && gateCount >= FINAL_GATE) { winNow(); return; }
      }
      if (!attract && dying <= 0 && invuln <= 0 && !ready && gateHit(g)) { hit('gate'); return; }
    }
    gates = gates.filter((g) => g.x > -GATE_W - 60);
    fillGates();

    // coins
    for (const c of coins) {
      if (c.got) continue;
      c.t += dt * 4;
      if (magnet > 0 && !attract) {
        const d = Math.hypot(c.x - BIRD_X, c.y - bird.y);
        if (d < 240) {
          const k = Math.min(1, 4 * wdt);
          c.x += (BIRD_X - c.x) * k;
          c.y += (bird.y - c.y) * k;
        }
      }
      if (!attract && !ready && Math.hypot(c.x - BIRD_X, c.y - bird.y) < BIRD_R + 13) {
        c.got = true;
        coinCount++;
        addScore(COIN_PTS, c.x, c.y, '#ffd23f');
        puff(c.x, c.y, 6, '#ffd23f', 120);
        Sound.tone(1180, 1560, 0.06, 'triangle', 0.03);
      }
    }
    coins = coins.filter((c) => !c.got && c.x > -40);

    // power-ups bob gently between the gates
    for (const p of pickups) {
      p.t += dt * 2;
      if (!attract && !ready && !p.got && Math.hypot(p.x - BIRD_X, p.y + Math.sin(p.t) * 16 - bird.y) < BIRD_R + 20) grab(p);
    }
    pickups = pickups.filter((p) => !p.got && p.x > -50);

    // ground and ceiling
    if (!attract && !ready) {
      if (bird.y - BIRD_R < CEIL_Y) { bird.y = CEIL_Y + BIRD_R; hit('ceiling'); }
      else if (bird.y + BIRD_R > GROUND_Y) { bird.y = GROUND_Y - BIRD_R; hit('ground'); }
    }
  }

  // ---------------------------------------------------------------------------
  // Palette blending
  // ---------------------------------------------------------------------------
  const rgbCache = new Map();
  function rgbOf(hex) {
    let v = rgbCache.get(hex);
    if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; rgbCache.set(hex, v); }
    return v;
  }
  function mix(a, b, t) {
    if (a === b) return a;
    const x = rgbOf(a), y = rgbOf(b);
    return `rgb(${Math.round(x[0] + (y[0] - x[0]) * t)},${Math.round(x[1] + (y[1] - x[1]) * t)},${Math.round(x[2] + (y[2] - x[2]) * t)})`;
  }
  function buildPal() {
    const b = BIOMES[biomeIdx];
    if (biomeT >= 1 || prevBiome === biomeIdx) return { ...b, orbA: b.orb ? 1 : 0, orbC: b.orb || '#fff' };
    const a = BIOMES[prevBiome], t = biomeT;
    return {
      ...b,
      sky: [mix(a.sky[0], b.sky[0], t), mix(a.sky[1], b.sky[1], t)],
      hills: b.hills.map((c, i) => mix(a.hills[i], c, t)),
      ground: b.ground.map((c, i) => mix(a.ground[i], c, t)),
      accent: mix(a.accent, b.accent, t),
      orbA: b.orb ? (a.orb ? 1 : t) : (a.orb ? 1 - t : 0),
      orbC: b.orb || a.orb || '#fff',
    };
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function hills(color, par, topY, amp, phase) {
    const off = dist * par;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, FH);
    for (let x = 0; x <= FW + 16; x += 18) {
      const w = (x + off) * 0.004;
      ctx.lineTo(x, topY + Math.sin(w + phase) * amp + Math.sin(w * 2.7 + phase * 1.6) * amp * 0.42);
    }
    ctx.lineTo(FW, FH);
    ctx.closePath();
    ctx.fill();
  }

  function cloudShape(x, y, s, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, TAU);
    ctx.arc(x + 24 * s, y + 5 * s, 16 * s, 0, TAU);
    ctx.arc(x - 24 * s, y + 6 * s, 15 * s, 0, TAU);
    ctx.arc(x + 6 * s, y - 14 * s, 17 * s, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // One column of a gate. tipY is the edge of the gap, baseY is off-screen.
  function column(style, x, tipY, baseY, c) {
    const h = baseY - tipY;
    const lipY = h > 0 ? tipY : tipY - 18;
    const grad = ctx.createLinearGradient(x, 0, x + GATE_W, 0);
    grad.addColorStop(0, c[1]); grad.addColorStop(0.32, c[0]); grad.addColorStop(0.55, c[2]); grad.addColorStop(1, c[1]);
    ctx.fillStyle = grad;
    if (style === 'pipe' || style === 'crystal') {
      const y0 = Math.min(tipY, baseY), y1 = Math.max(tipY, baseY);
      ctx.fillRect(x + 5, y0, GATE_W - 10, y1 - y0);
      ctx.fillRect(x - 3, lipY, GATE_W + 6, 18);
      if (style === 'crystal') {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = c[2];
        for (let i = 0; i < 3; i++) {
          const fy = tipY + h * (0.1 + i * 0.16);
          ctx.beginPath();
          ctx.moveTo(x + 12, fy); ctx.lineTo(x + 30, fy - h * 0.05); ctx.lineTo(x + 26, fy + h * 0.06); ctx.closePath(); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    } else if (style === 'spire') {
      ctx.beginPath();
      ctx.moveTo(x, baseY);
      ctx.lineTo(x + GATE_W, baseY);
      ctx.lineTo(x + GATE_W * 0.86, tipY + h * 0.34);
      ctx.lineTo(x + GATE_W * 0.66, tipY + h * 0.08);
      ctx.lineTo(x + GATE_W * 0.5, tipY);
      ctx.lineTo(x + GATE_W * 0.33, tipY + h * 0.1);
      ctx.lineTo(x + GATE_W * 0.12, tipY + h * 0.4);
      ctx.closePath();
      ctx.fill();
    } else if (style === 'stalac') {
      ctx.beginPath();
      ctx.moveTo(x - 6, baseY);
      ctx.lineTo(x + GATE_W + 6, baseY);
      ctx.lineTo(x + GATE_W * 0.7, tipY + h * 0.06);
      ctx.lineTo(x + GATE_W * 0.5, tipY);
      ctx.lineTo(x + GATE_W * 0.3, tipY + h * 0.06);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = c[1];
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x + GATE_W * 0.22, tipY + h * 0.22, 5, h * 0.4);
      ctx.globalAlpha = 1;
    } else {                                   // cloud arch
      const n = 6;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const cy = tipY + h * t;
        const r = 17 + 20 * t;
        ctx.fillStyle = i % 2 ? c[2] : c[0];
        ctx.beginPath();
        ctx.arc(x + GATE_W / 2 + Math.sin(i * 1.7) * 7, cy, r, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = c[1];
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(x + GATE_W / 2, tipY + h * 0.08, 19, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawBird(x, y, tilt, spin) {
    const wing = bird.flapT > 0 ? -1.05 + (1 - bird.flapT / 0.26) * 2.2 : Math.sin(time * 6) * 0.3;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt + spin);
    if (magnet > 0) {
      ctx.strokeStyle = `rgba(255,143,163,${0.2 + 0.12 * Math.sin(time * 9)})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 34 + Math.sin(time * 5) * 3, 0, TAU); ctx.stroke();
    }
    // tail
    ctx.fillStyle = '#e88f27';
    ctx.beginPath(); ctx.moveTo(-13, -2); ctx.lineTo(-27, -10); ctx.lineTo(-25, 6); ctx.closePath(); ctx.fill();
    // body
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.ellipse(0, 0, 17, 14, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.ellipse(1, 5, 12, 8, 0, 0, TAU); ctx.fill();
    // wing
    ctx.save();
    ctx.translate(-2, -1);
    ctx.rotate(wing);
    ctx.fillStyle = '#ff9e3d';
    ctx.beginPath(); ctx.ellipse(-4, 4, 13, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffbf6b';
    ctx.beginPath(); ctx.ellipse(-3, 2, 9, 4, 0, 0, TAU); ctx.fill();
    ctx.restore();
    // beak
    ctx.fillStyle = '#ff7a3d';
    ctx.beginPath(); ctx.moveTo(14, -2); ctx.lineTo(27, 2); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill();
    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(7, -5, 5.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#20182a';
    ctx.beginPath(); ctx.arc(8.6, -5, 2.6, 0, TAU); ctx.fill();
    if (shield > 0) {
      ctx.strokeStyle = `rgba(125,255,207,${invuln > 0 && Math.floor(invuln * 12) % 2 ? 0.95 : 0.45 + 0.18 * shield})`;
      ctx.lineWidth = 2 + shield;
      ctx.beginPath(); ctx.arc(0, 0, 27, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, W, H);
    // the course is a fixed 540x900 so everyone flies the same one; the bands around it
    // on other screen shapes get the biome's sky instead of black
    const pal0 = bird ? buildPal() : null;
    if (pal0) {
      const band = ctx.createLinearGradient(0, 0, 0, H);
      band.addColorStop(0, pal0.sky[0]);
      band.addColorStop(1, pal0.sky[1]);
      ctx.fillStyle = band;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * offX, DPR * offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();
    if (!bird) { ctx.restore(); return; }
    const pal = pal0;

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    sky.addColorStop(0, pal.sky[0]);
    sky.addColorStop(1, pal.sky[1]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, FW, FH);

    // sun or moon
    if (pal.orbA > 0.01) {
      const ox = FW * 0.74, oy = 168;
      ctx.globalAlpha = pal.orbA * 0.25;
      ctx.fillStyle = pal.orbC;
      ctx.beginPath(); ctx.arc(ox, oy, 96, 0, TAU); ctx.fill();
      ctx.globalAlpha = pal.orbA;
      ctx.beginPath(); ctx.arc(ox, oy, 44, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // parallax hills
    hills(pal.hills[0], 0.07, GROUND_Y - 250, 46, 0);
    hills(pal.hills[1], 0.15, GROUND_Y - 160, 34, 2.1);
    hills(pal.hills[2], 0.3, GROUND_Y - 86, 26, 4.3);

    // clouds
    for (const c of clouds) cloudShape(c.x, c.y, c.s, pal.sky[0], 0.18);

    // gates
    for (const g of gates) {
      const c = BIOMES[g.biome].gate;
      const cy = gapCenter(g);
      const glow = BIOMES[g.biome].id === 'night';
      if (glow) { ctx.shadowColor = c[2]; ctx.shadowBlur = 14; }
      column(g.style, g.x, cy - g.gap / 2, CEIL_Y - 40, c);
      column(g.style, g.x, cy + g.gap / 2, GROUND_Y + 40, c);
      ctx.shadowBlur = 0;
    }

    // coins
    for (const c of coins) {
      const sx = Math.abs(Math.cos(c.t)) * 0.85 + 0.15;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(sx, 1);
      ctx.fillStyle = '#c98b12';
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(0, -1, 10, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath(); ctx.arc(-3, -4, 3.4, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // power-ups
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of pickups) {
      const py = p.y + Math.sin(p.t) * 16;
      const info = PU[p.type];
      ctx.save();
      ctx.translate(p.x, py);
      ctx.rotate(Math.sin(p.t * 0.7) * 0.18);
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#12132aee';
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-18, -18, 36, 36, 9); else ctx.rect(-18, -18, 36, 36);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = '20px serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(info.icon, 0, 2);
      ctx.restore();
    }

    // ceiling
    ctx.fillStyle = pal.ground[1];
    ctx.fillRect(0, 0, FW, CEIL_Y - 6);
    ctx.beginPath();
    ctx.moveTo(0, CEIL_Y - 6);
    for (let x = -(dist % 36); x < FW + 36; x += 36) { ctx.lineTo(x + 18, CEIL_Y); ctx.lineTo(x + 36, CEIL_Y - 6); }
    ctx.lineTo(FW, 0); ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();

    // ground
    ctx.fillStyle = pal.ground[0];
    ctx.fillRect(0, GROUND_Y, FW, FH - GROUND_Y);
    ctx.fillStyle = pal.ground[1];
    ctx.fillRect(0, GROUND_Y + 18, FW, FH - GROUND_Y - 18);
    ctx.fillStyle = pal.accent;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, GROUND_Y, FW, 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.ground[1];
    for (let x = -(dist % 44); x < FW + 44; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 18); ctx.lineTo(x + 11, GROUND_Y + 3); ctx.lineTo(x + 22, GROUND_Y + 18);
      ctx.closePath(); ctx.fill();
    }

    // foreground motes: rain, fireflies, dust, petals or embers
    const kind = pal.mote;
    for (const m of motes) {
      if (kind === 'rain') {
        ctx.strokeStyle = 'rgba(160,200,235,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - 5, m.y + 16 * m.s); ctx.stroke();
      } else if (kind === 'firefly') {
        ctx.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(m.p));
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath(); ctx.arc(m.x, m.y, 2.4 * m.s, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = kind === 'ember' ? 0.55 : 0.3;
        ctx.fillStyle = kind === 'ember' ? '#ffb066' : kind === 'dust' ? '#c99a7a' : '#ffe3f0';
        ctx.beginPath(); ctx.arc(m.x, m.y, 2.2 * m.s, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // thermals shimmer in the sunset sky
    if (pal.id === 'sunset') {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#ffd7a0';
      for (let x = 0; x < FW; x += 8) {
        const w = dist + x;
        if (Math.sin(w / 200) > 0.55) ctx.fillRect(x, CEIL_Y, 8, GROUND_Y - CEIL_Y);
      }
      ctx.globalAlpha = 1;
    }

    // bird
    drawBird(BIRD_X, bird.y, bird.tilt, bird.spin);

    // particles and score pops
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of pops) {
      ctx.globalAlpha = 1 - p.t / 0.9;
      ctx.fillStyle = p.c;
      ctx.fillText(p.text, p.x, p.y - p.t * 44);
    }
    ctx.globalAlpha = 1;

    // banner
    if (banner && state !== 'over') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.9 ? (2.4 - banner.t) / 0.5 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = '20px "Press Start 2P", monospace';
      ctx.shadowColor = pal.accent;
      ctx.shadowBlur = 18;
      ctx.fillText(banner.text, FW / 2, FH * 0.3);
      ctx.shadowBlur = 0;
      ctx.font = '9px "Press Start 2P", monospace';
      ctx.fillStyle = pal.accent;
      ctx.fillText(banner.sub, FW / 2, FH * 0.3 + 26);
      ctx.globalAlpha = 1;
    }
    if (state === 'play' && ready) {
      ctx.globalAlpha = 0.55 + 0.35 * Math.sin(time * 5);
      ctx.fillStyle = '#fff';
      ctx.font = '12px "Press Start 2P", monospace';
      ctx.fillText('FLAP TO START', FW / 2, FH * 0.62);
      ctx.globalAlpha = 1;
    }

    if (bolt > 0) { ctx.fillStyle = `rgba(200,225,255,${bolt * 1.6})`; ctx.fillRect(0, 0, FW, FH); }
    if (hitFlash > 0) { ctx.fillStyle = `rgba(255,80,80,${Math.min(0.5, hitFlash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a';
      ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#ffa62b';
      ctx.font = '24px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; const el = $(id); if (el) el.textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('gate', state === 'title' ? '' : CLASSIC ? `GATE ${Math.min(gateCount, FINAL_GATE)}/${FINAL_GATE}` : `GATE ${gateCount}`);
    set('biome', state === 'title' ? '' : BIOMES[biomeIdx].name);
    const bits = [];
    if (shield > 0) bits.push('🛡️' + (shield > 1 ? '×' + shield : ''));
    if (slow > 0) bits.push('🪶' + Math.ceil(slow));
    if (magnet > 0) bits.push('🧲' + Math.ceil(magnet));
    set('power', bits.join(' '));
  }

  const hint = $('flap-hint');
  function hideHint() { if (hint) hint.classList.add('gone'); }

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'arrowup' || k === 'w' || k === 'enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'title' || state === 'over') start();
      else if (state === 'play') { if (paused) paused = false; else { Sound.init(); flap(); } }
    } else if (k === 'p' || k === 'escape') {
      if (state === 'play') paused = !paused;
    } else if (k === 'm') {
      const b = $('sound-btn');
      if (b) b.click();
    }
  });

  // Tap or click anywhere on the canvas to flap — the HUD and the corner buttons
  // sit above it with their own pointer targets, so a thumb never misses.
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    e.preventDefault();
    if (paused) { paused = false; return; }
    Sound.init();
    flap();
    hideHint();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });
  window.addEventListener('blur', () => { if (state === 'play') paused = true; });

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    // jump straight to a later gate, so the harder biomes can be tested
    const jumpTo = (n) => {
      gateCount = Math.max(0, Math.floor(n));
      gateSeq = gateCount;
      gates = []; coins = []; pickups = [];
      lastGapY = FH * 0.44;
      biomeIdx = prevBiome = biomeFor(gateCount);
      biomeT = 1;
      ready = false;
      dist = 0;
      fillGates();
    };
    window.ArcadeTest = {
      game: 'flyer',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => {
        const g = gates.find((gt) => gt.x + GATE_W > BIRD_X - BIRD_R);
        return {
          state, paused, won, ready, score, high,
          gates: gateCount, gate: gateCount, coins: coinCount,
          lives: state === 'over' || dying > 0 ? 0 : 1,
          shield, slow: Math.max(0, slow), magnet: Math.max(0, magnet), invuln: Math.max(0, invuln),
          biome: BIOMES[biomeIdx].id, biomeIndex: biomeIdx,
          y: bird.y, vy: bird.vy, speed: speedAt(gateCount), dist, time,
          next: g ? { x: g.x, gap: g.gap, y: gapCenter(g) } : null,
          pickups: pickups.length, coinsAhead: coins.length,
        };
      },
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'gate' || k === 'gates') jumpTo(v);
        else if (k === 'biome') jumpTo(v * BIOME_LEN);
        else if (k === 'shield' || k === 'lives') shield = Math.max(0, v);
        else if (k === 'slow') slow = v;
        else if (k === 'magnet') magnet = v;
        else if (k === 'y') { bird.y = v; bird.vy = 0; ready = false; }
        else if (k === 'ready') ready = !!v;
        return true;
      },
      win: () => { if (state !== 'play') start(); ready = false; winNow(); },
      flap: () => flap(true),
      kill: () => { ready = false; hit('test'); },
    };
  }

  // attract loop: a bird flying the opening course behind the title screen
  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (!paused) update(dt);
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
