(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const TAU = Math.PI * 2;
  const FW = 600;
  // the field stretches on tall screens, but is capped so a phone doesn't get a different game
  let FH = 900, CX = FW / 2, CY = 420, R = 240;
  const DEPTH = 9.5;                 // perspective strength: z 0 = the rim, z 1 = the far end
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('tempest')) || (CLASSIC ? 'tempest-classic' : 'tempest');
  const FINAL_LEVEL = 16;            // classic: clear sixteen tubes to win
  const POINTS = { flipper: 150, tanker: 100, spiker: 50, fuseball: 250 };
  const COLORS = { flipper: '#ff4d6d', tanker: '#7dff6a', spiker: '#c77dff', fuseball: '#ffd23f', player: '#ffe600', bullet: '#ff9f1c' };

  // tube colour schemes, one per level (they cycle from a seeded offset)
  const PALETTES = [
    { rim: '#ff2e88', lane: '#5b1f7a' },
    { rim: '#3fd8ff', lane: '#12508c' },
    { rim: '#7dff6a', lane: '#1c6b2e' },
    { rim: '#ffd23f', lane: '#8a5a10' },
    { rim: '#c77dff', lane: '#4a2a7a' },
    { rim: '#ff7a3d', lane: '#7a2f10' },
    { rim: '#e6eeff', lane: '#33406b' },
    { rim: '#2bffc6', lane: '#0e6b58' },
  ];

  // world randomness (shapes, enemy mix, spawn timing, enemy decisions) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);

  let state = 'title';
  let phase = 'play';                // 'play' | 'warp'
  let paused = false;
  let tube, spikes, enemies, shots, bullets, particles, popups, stars, queue;
  let player, score, lives, level, zaps, kills, fired, hits, nextLifeAt, time, levelT;
  let cam, warp, banner, flash, shake, palette, paletteOffset, lastShape;
  let high = store.get(Arcade.modeKey('tempest.high'), 0);

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    FH = clamp(Math.round((FW * v.H) / v.W), 720, 1050);
    CX = FW / 2;
    CY = FH * 0.47;
    R = Math.min(FW * 0.44, FH * 0.34);
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    if (tube) layoutTube();
    makeStars();
  });
  let ctx = view.ctx;
  // the drawing helpers all talk to `ctx`, so the title legend borrows them for its own canvas
  function onCanvas(g, fn) { const real = ctx; ctx = g; try { fn(); } finally { ctx = real; } }

  // ---------------------------------------------------------------------------
  // Tube shapes
  // ---------------------------------------------------------------------------
  // Each shape is a path in unit space around a vanishing point at (0, 0). The rim is sampled
  // evenly along it: one point per lane on a closed tube, one more than that on an open one.
  function samplePath(corners, n, closed) {
    const path = closed ? corners.concat([corners[0]]) : corners;
    const segs = [];
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const d = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
      segs.push(d);
      total += d;
    }
    const out = [];
    for (let i = 0; i < (closed ? n : n + 1); i++) {
      const want = (total * i) / n;
      let acc = 0, k = 0;
      while (k < segs.length - 1 && acc + segs[k] < want) { acc += segs[k]; k++; }
      const t = segs[k] ? (want - acc) / segs[k] : 0;
      out.push([path[k][0] + (path[k + 1][0] - path[k][0]) * t, path[k][1] + (path[k + 1][1] - path[k][1]) * t]);
    }
    return out;
  }
  function paramPath(f, n, closed) {
    const out = [];
    for (let i = 0; i < (closed ? n : n + 1); i++) out.push(f(i / n));
    return out;
  }
  // scale a shape so its furthest point sits on the rim radius
  function fit(pts) {
    let m = 0;
    for (const p of pts) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]));
    return pts.map((p) => [p[0] / m, p[1] / m]);
  }

  const A = 0.36; // arm half-width of the cross
  const CROSS = [[0, 1], [A, 1], [A, A], [1, A], [1, -A], [A, -A], [A, -1], [-A, -1], [-A, -A], [-1, -A], [-1, A], [-A, A], [-A, 1]];
  const STAR = (() => {
    const p = [];
    for (let i = 0; i < 16; i++) { const a = Math.PI / 2 + (i * TAU) / 16, r = i % 2 ? 0.42 : 1; p.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return p;
  })();
  const polar = (f) => (t) => { const a = Math.PI / 2 + t * TAU, r = f(a); return [Math.cos(a) * r, Math.sin(a) * r]; };

  const SHAPES = [
    { name: 'CIRCLE', lanes: 16, closed: true, build: (n) => paramPath(polar(() => 1), n, true) },
    { name: 'SQUARE', lanes: 16, closed: true, build: (n) => samplePath([[0, 1], [1, 1], [1, -1], [-1, -1], [-1, 1]], n, true) },
    { name: 'CROSS', lanes: 16, closed: true, build: (n) => samplePath(CROSS, n, true) },
    { name: 'VEE', lanes: 14, closed: false, build: (n) => samplePath([[-1, -0.8], [0, 1], [1, -0.8]], n, false) },
    { name: 'FLAT', lanes: 16, closed: false, vp: [0, -0.55], build: (n) => samplePath([[-1, 0.85], [1, 0.85]], n, false) },
    { name: 'STAR', lanes: 16, closed: true, build: (n) => samplePath(STAR, n, true) },
    { name: 'FIGURE 8', lanes: 16, closed: true, build: (n) => paramPath(polar((a) => 0.32 + 0.68 * Math.abs(Math.sin(a))), n, true) },
    { name: 'TRIANGLE', lanes: 15, closed: true, build: (n) => samplePath([[0, 1], [1, -0.7], [-1, -0.7]], n, true) },
    { name: 'CLOVER', lanes: 16, closed: true, build: (n) => paramPath(polar((a) => 0.72 + 0.28 * Math.cos(4 * a)), n, true) },
    { name: 'ZIGZAG', lanes: 14, closed: false, vp: [0, -0.8], build: (n) => samplePath([[-1, -0.4], [-0.5, 0.5], [0, -0.4], [0.5, 0.5], [1, -0.4]], n, false) },
  ];
  const CLASSIC_ORDER = [0, 1, 2, 5, 3, 6, 0, 4, 7, 2, 8, 1, 9, 5, 6, 3];

  function buildTube(index) {
    const s = SHAPES[index];
    tube = { name: s.name, lanes: s.lanes, closed: s.closed, vp: s.vp || [0, 0], unit: fit(s.build(s.lanes)), rim: [], vx: CX, vy: CY };
    layoutTube();
  }
  function layoutTube() {
    tube.rim = tube.unit.map((p) => [(p[0] - tube.vp[0]) * R, (p[1] - tube.vp[1]) * R]);
    tube.vx = CX + tube.vp[0] * R;
    tube.vy = CY + tube.vp[1] * R;
  }

  const L = () => tube.lanes;
  const wrapU = (u) => (tube.closed ? ((u % L()) + L()) % L() : clamp(u, 0.5, L() - 0.5));
  // the shortest signed way round the rim from `from` to `to`
  function deltaU(to, from) {
    let d = to - from;
    if (!tube.closed) return d;
    const n = L();
    d = ((d % n) + n) % n;
    return d > n / 2 ? d - n : d;
  }
  function rimAt(u) {
    const n = L(), pts = tube.rim;
    if (tube.closed) {
      let i = Math.floor(u);
      const t = u - i;
      i = ((i % n) + n) % n;
      const a = pts[i], b = pts[(i + 1) % n];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    const uu = clamp(u, 0, n);
    const i = Math.min(n - 1, Math.floor(uu)), t = uu - i;
    const a = pts[i], b = pts[i + 1];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const persp = (z) => 1 / Math.max(0.14, 1 + (z - cam) * DEPTH);
  // a point on the tube wall: u around the rim, z down its length
  function P(u, z) {
    const r = rimAt(u), s = persp(z);
    return [tube.vx + r[0] * s, tube.vy + r[1] * s];
  }
  const laneOf = (u) => ((Math.floor(u) % L()) + L()) % L();

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function makeStars() {
    stars = [];
    for (let i = 0; i < 70; i++) stars.push({ a: rand(0, TAU), d: Math.random(), s: rand(0.6, 2) });
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('tempest') : Math.random;
    score = 0; lives = 3; level = 0; kills = 0; fired = 0; hits = 0;
    nextLifeAt = 20000; time = 0; flash = 0; shake = 0; cam = 0; warp = null; phase = 'play';
    particles = []; popups = []; lastShape = -1;
    paletteOffset = CLASSIC ? 0 : Math.floor(wrand() * PALETTES.length);
    player = { u: 0, dead: 0, invuln: 0, reload: 0 };
    makeStars();
    startLevel();
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
  // Levels
  // ---------------------------------------------------------------------------
  const mult = () => (CLASSIC ? 1 : 1 + (level - 1) * 0.1);
  const spikeFloor = () => clamp(0.56 - level * 0.022, 0.24, 0.56);

  function speedFor(type) {
    const base = Math.min(0.34, 0.105 + level * 0.0065);
    if (type === 'tanker') return base * 0.68;
    if (type === 'spiker') return base * 0.62;
    if (type === 'fuseball') return base * 0.9;
    return base;
  }

  // enemy mix: flippers from the start, then tankers, spikers and finally fuseballs
  function mixFor(lv) {
    const mix = [['flipper', 10]];
    if (lv >= 3) mix.push(['tanker', lv >= 6 ? 4 : 3]);
    if (lv >= 5) mix.push(['spiker', 3]);
    if (lv >= 7) mix.push(['fuseball', lv >= 11 ? 4 : 3]);
    return mix;
  }
  function pickMix(mix) {
    let total = 0;
    for (const m of mix) total += m[1];
    let r = wrand() * total;
    for (const m of mix) { r -= m[1]; if (r <= 0) return m[0]; }
    return mix[0][0];
  }

  function startLevel() {
    level++;
    let shapeIndex;
    if (CLASSIC) shapeIndex = CLASSIC_ORDER[Math.min(level, FINAL_LEVEL) - 1];
    else if (level === 1) shapeIndex = 0;
    else { shapeIndex = lastShape; while (shapeIndex === lastShape) shapeIndex = Math.floor(wrand() * SHAPES.length); }
    lastShape = shapeIndex;
    buildTube(shapeIndex);
    palette = PALETTES[(level - 1 + paletteOffset) % PALETTES.length];
    spikes = new Array(L()).fill(0);
    enemies = []; shots = []; bullets = []; queue = [];
    zaps = 1;
    levelT = 0;

    // the player starts on the lowest lane of whatever shape this is
    let best = 0, bestY = -Infinity;
    for (let i = 0; i < L(); i++) { const p = P(i + 0.5, 0); if (p[1] > bestY) { bestY = p[1]; best = i; } }
    player.u = best + 0.5;
    player.dead = 0; player.invuln = 1.2; player.reload = 0;

    const count = CLASSIC ? 10 + Math.min(level, 9) * 2 : 12 + Math.min(44, Math.floor(level * 1.6));
    const mix = mixFor(level);
    const gap = Math.max(0.36, 1.5 - level * 0.05);
    let t = 1.1;
    for (let i = 0; i < count; i++) {
      queue.push({ t, type: pickMix(mix), lane: Math.floor(wrand() * L()) });
      t += gap * wr(0.55, 1.45);
    }
    banner = { text: CLASSIC ? `LEVEL ${level}/${FINAL_LEVEL} · ${tube.name}` : `LEVEL ${level} · ${tube.name}`, t: 0 };
    Sound.arp([330, 440, 587, 784], 0.07, 'square', 0.03);
  }

  function makeEnemy(type, u, z) {
    return {
      type, u: wrapU(u), u0: u, z, flip: 0, fdir: 1, rim: false, dir: -1, t: wr(0, 6),
      timer: wr(0.3, 1.3), fireT: wr(0.9, 2.6), speed: speedFor(type), hit: 0, target: undefined,
      child: type === 'tanker' ? (level >= 9 && wrand() < 0.34 ? 'fuseball' : level >= 6 && wrand() < 0.3 ? 'spiker' : 'flipper') : null,
    };
  }
  function spawn(type, lane) {
    // fuseballs ride the lane lines, everything else rides the middle of a lane
    const u = type === 'fuseball' ? clamp(lane, tube.closed ? -Infinity : 1, tube.closed ? Infinity : L() - 1) : lane + 0.5;
    enemies.push(makeEnemy(type, u, 1));
  }

  function levelCleared() {
    const clear = spikes.filter((s) => s <= 0.001).length;
    if (clear) toast(`TUBE CLEAR +${addScore(clear * 100).toLocaleString()}`);
    if (CLASSIC && level >= FINAL_LEVEL) {
      addScore(lives * 2000);
      return endGame(true);
    }
    phase = 'warp';
    warp = { t: 0, stage: 0 };
    bullets = []; shots = [];
    Sound.tone(110, 1700, 0.85, 'sawtooth', 0.035);
    Sound.noise(0.9, 0.06, 0.05, 2600);
  }

  // ---------------------------------------------------------------------------
  // Scoring & effects
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    const pts = Math.round((n * mult()) / 10) * 10 || n;
    score += pts;
    if (x !== undefined) popups.push({ x, y, text: String(pts), t: 0 });
    if (score >= nextLifeAt) { nextLifeAt += 20000; lives++; toast('EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set(Arcade.modeKey('tempest.high'), high); }
    return pts;
  }

  function burst(x, y, color, n, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(40, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.25, 0.75), c: Math.random() < 0.35 ? '#fff' : color, s: rand(1.5, 3.5) });
    }
  }

  function split(e) {
    const z = clamp(e.z + 0.05, 0.12, 0.98);
    for (const d of [-1, 1]) {
      const u = tube.closed ? e.u + d : clamp(e.u + d, 0.5, L() - 0.5);
      enemies.push(makeEnemy(e.child, e.child === 'fuseball' ? Math.round(u) : Math.floor(u) + 0.5, z));
    }
    Sound.tone(260, 120, 0.2, 'sawtooth', 0.035);
  }

  function killEnemy(e, byZap) {
    e.dead = true;
    kills++;
    const p = P(e.u, Math.max(0, e.z));
    addScore(POINTS[e.type], p[0], p[1]);
    burst(p[0], p[1], COLORS[e.type], e.type === 'fuseball' ? 26 : 16, e.type === 'fuseball' ? 320 : 240);
    if (e.type === 'tanker' && !byZap) split(e);   // the zapper vaporises tankers whole
    if (!byZap) Sound.noise(0.1, 0.055, 0, e.type === 'fuseball' ? 3200 : 1800);
  }

  function hitPlayer(reason) {
    if (player.dead > 0 || player.invuln > 0 || state !== 'play' || phase !== 'play') return;
    lives--;
    player.dead = lives <= 0 ? 99 : 1.5;
    flash = 0.3;
    shake = 18;
    const p = P(player.u, 0);
    burst(p[0], p[1], COLORS.player, 60, 380);
    burst(p[0], p[1], '#fff', 24, 220);
    Sound.noise(0.85, 0.2, 0, 620);
    Sound.tone(300, 60, 0.7, 'sawtooth', 0.05);
    bullets = [];
    // push whatever is on the rim back down the tube, so respawning isn't instant death
    for (const e of enemies) { e.rim = false; e.z = Math.min(1, Math.max(e.z, 0) + 0.3); e.flip = 0; }
    if (reason) toast(reason);
    if (lives <= 0) setTimeout(() => { if (state === 'play') endGame(false); }, 1100);
  }

  function superZap() {
    if (zaps <= 0 || player.dead > 0 || state !== 'play' || phase !== 'play') return;
    zaps--;
    flash = 0.45;
    let n = 0;
    for (const e of enemies.slice()) if (!e.dead) { killEnemy(e, true); n++; }
    enemies = enemies.filter((e) => !e.dead);
    particles.push({ ring: true, x: tube.vx, y: tube.vy, t: 0, life: 0.55, c: palette.rim });
    Sound.arp([1600, 1200, 900, 660, 480, 330], 0.05, 'sawtooth', 0.05);
    Sound.noise(0.5, 0.12, 0, 4000);
    toast(n ? `SUPER ZAPPER · ${n} CLEARED` : 'SUPER ZAPPER');
  }

  function fire() {
    if (state !== 'play' || phase !== 'play' || player.dead > 0 || player.reload > 0 || shots.length >= 7) return;
    shots.push({ u: player.u, z: 0, pz: 0 });
    fired++;
    player.reload = 0.1;
    Sound.tone(1500, 620, 0.06, 'square', 0.02);
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    unlockPointer();
    $('o-score').textContent = score.toLocaleString();
    $('o-level').textContent = CLASSIC ? `${Math.min(level, FINAL_LEVEL)}/${FINAL_LEVEL}` : level;
    $('o-kills').textContent = kills.toLocaleString();
    $('o-acc').textContent = fired ? `${Math.round((hits / fired) * 100)}%` : '—';
    Arcade.endScreen(won, won ? 'Sixteen tubes cleared. The web is yours!' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();

  function startFlip(e, dir) {
    if (!tube.closed) {
      if (e.u + dir < 0.5 || e.u + dir > L() - 0.5) dir = -dir;
      if (e.u + dir < 0.5 || e.u + dir > L() - 0.5) return;
    }
    e.u0 = e.u;
    e.fdir = dir;
    e.flip = 0.0001;
  }
  function stepFlip(e, dt, rate) {
    e.flip += dt * rate;
    if (e.flip >= 1) { e.u = wrapU(e.u0 + e.fdir); e.flip = 0; e.timer = wr(0.45, 1.3); }
    else e.u = wrapU(e.u0 + e.fdir * e.flip);
  }

  // Between levels the camera flies down the tube and out the far end, then the next tube
  // rushes in from the distance.
  function updateWarp(dt) {
    warp.t += dt;
    if (warp.stage === 0) {
      const k = Math.min(1, warp.t / 0.85);
      cam = k * k * 1.15;
      if (k >= 1) { warp.stage = 1; warp.t = 0; cam = 0; startLevel(); cam = -2.6; }
    } else {
      const k = Math.min(1, warp.t / 0.8);
      cam = -2.6 * (1 - k) * (1 - k);
      if (k >= 1) { cam = 0; phase = 'play'; warp = null; }
    }
  }

  function update(dt) {
    time += dt;
    for (const s of stars) {
      s.d += dt * (phase === 'warp' ? 2.2 : 0.07);
      if (s.d > 1) { s.d -= 1; s.a = rand(0, TAU); }
    }
    for (const p of particles) {
      p.t += dt;
      if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    if (flash > 0) flash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
    if (state !== 'play') return;
    if (phase === 'warp') { updateWarp(dt); return; }

    levelT += dt;

    // player
    if (player.dead > 0) {
      if (lives > 0) {                       // on the last life the claw stays gone
        player.dead -= dt;
        if (player.dead <= 0) player.invuln = 1.6;
      }
    } else {
      if (keys.has('left')) player.u = wrapU(player.u - 4.2 * dt);
      if (keys.has('right')) player.u = wrapU(player.u + 4.2 * dt);
      if (player.invuln > 0) player.invuln -= dt;
      if (player.reload > 0) player.reload -= dt;
      if (keys.has('fire')) fire();
    }

    // spawning
    const maxAlive = Math.min(9, 4 + Math.floor(level / 3));
    while (queue.length && levelT >= queue[0].t && enemies.length < maxAlive) {
      const q = queue.shift();
      spawn(q.type, q.lane);
    }

    const rimSpeed = 1.6 + Math.min(1.8, level * 0.07);
    const maxBullets = Math.min(9, 2 + Math.floor(level / 2));

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.dead) continue;
      e.t += dt;
      if (e.hit > 0) e.hit -= dt;

      if (e.type === 'spiker') {
        // spikers walk a lane up and down, leaving a spike as tall as they have climbed
        e.z += e.dir * e.speed * dt;
        const floorZ = spikeFloor();
        if (e.z <= floorZ) { e.z = floorZ; e.dir = 1; }
        if (e.z >= 1) { e.z = 1; e.dir = -1; }
        const lane = laneOf(e.u);
        spikes[lane] = Math.max(spikes[lane], 1 - e.z);
        if (level >= 8) {
          e.fireT -= dt;
          if (e.fireT <= 0 && bullets.length < maxBullets) { e.fireT = wr(2, 4.5); bullets.push({ u: e.u, z: e.z, sp: 0.5 + level * 0.01 }); }
        }
        continue;
      }

      if (!e.rim) {
        e.z -= e.speed * (e.type === 'fuseball' ? 0.6 + Math.abs(Math.sin(e.t * 2.6)) * 1.1 : 1) * dt;
        if (e.z <= 0) {
          e.z = 0;
          if (e.type === 'tanker') { burstTanker(e); continue; }
          e.rim = true;
          e.flip = 0;
          Sound.tone(220, 140, 0.18, 'sawtooth', 0.03);
        }
      }

      if (e.type === 'flipper') {
        if (e.rim) {
          const d = deltaU(player.u, e.u);
          e.u = wrapU(e.u + Math.sign(d) * Math.min(Math.abs(d), rimSpeed * dt));
          e.flip = (e.flip + dt * 3.2) % 1;
        } else if (e.flip > 0) {
          stepFlip(e, dt, 3.4 + level * 0.06);
        } else {
          e.timer -= dt;
          if (e.timer <= 0 && L() > 2) {
            const d = deltaU(player.u, e.u);
            startFlip(e, wrand() < 0.72 && d !== 0 ? Math.sign(d) : (wrand() < 0.5 ? 1 : -1));
          }
        }
        e.fireT -= dt;
        if (e.fireT <= 0 && !e.rim && e.z > 0.08 && e.z < 0.95 && bullets.length < maxBullets) {
          e.fireT = wr(1.2, 3.4) / (1 + level * 0.03);
          bullets.push({ u: e.u, z: e.z, sp: 0.55 + level * 0.014 });
        }
      } else if (e.type === 'fuseball') {
        // fuseballs crackle along the lane lines, hopping sideways as they climb
        if (e.rim) {
          const d = deltaU(player.u, e.u);
          e.u = wrapU(e.u + Math.sign(d) * Math.min(Math.abs(d), rimSpeed * 0.85 * dt));
        } else {
          e.timer -= dt;
          if (e.timer <= 0) {
            e.timer = wr(0.5, 1.5);
            const d = deltaU(player.u, e.u);
            e.target = wrapU(e.u + (wrand() < 0.6 ? (Math.sign(d) || 1) : (wrand() < 0.5 ? 1 : -1)));
          }
          if (e.target !== undefined) {
            const d = deltaU(e.target, e.u);
            e.u = wrapU(e.u + Math.sign(d) * Math.min(Math.abs(d), 1.7 * dt));
          }
        }
      }

      // anything that reaches the rim beside you grabs you
      if (e.rim && Math.abs(deltaU(e.u, player.u)) < 0.62) hitPlayer(e.type === 'fuseball' ? 'FUSEBALL!' : 'GRABBED!');
    }
    enemies = enemies.filter((e) => !e.dead);

    // player shots run down the lane they were fired on
    for (const s of shots) {
      s.pz = s.z;
      s.z += 1.95 * dt;
      // enemies first, so a spiker sitting on the tip of its own spike is still a target
      for (const e of enemies) {
        if (e.dead) continue;
        const half = e.type === 'fuseball' ? 0.42 : 0.55;
        if (Math.abs(deltaU(e.u, s.u)) > half) continue;
        if (e.z > s.pz - 0.035 && e.z < s.z + 0.035) { s.dead = true; hits++; killEnemy(e); break; }
      }
      if (s.dead) continue;
      const lane = laneOf(s.u);
      const spike = spikes[lane];
      if (spike > 0 && s.z >= 1 - spike) {
        spikes[lane] = Math.max(0, spike - 0.09);
        const p = P(s.u, 1 - spike);
        burst(p[0], p[1], palette.rim, 5, 120);
        Sound.tone(520, 300, 0.05, 'square', 0.02);
        s.dead = true;
        continue;
      }
      if (s.z > 1) s.dead = true;
    }
    shots = shots.filter((s) => !s.dead);

    // enemy fire climbs back up towards the rim
    for (const b of bullets) {
      b.z -= b.sp * dt;
      if (b.z <= 0.02) {
        if (Math.abs(deltaU(b.u, player.u)) < 0.5) { b.dead = true; hitPlayer('HIT!'); continue; }
        if (b.z < -0.05) b.dead = true;
      }
    }
    bullets = bullets.filter((b) => !b.dead);

    if (!enemies.length && !queue.length) levelCleared();
  }

  // a tanker that makes the rim bursts open instead of grabbing you
  function burstTanker(e) {
    e.dead = true;
    const p = P(e.u, 0);
    burst(p[0], p[1], COLORS.tanker, 14);
    split(e);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const lerpP = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function line(a, b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  function glow(color, width, blur) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
  }

  function ringPath(z) {
    const n = L(), count = tube.closed ? n : n + 1;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = P(i, z);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    if (tube.closed) ctx.closePath();
  }

  function drawTube(alpha) {
    const n = L(), count = tube.closed ? n : n + 1;
    ctx.globalAlpha = alpha * 0.3;
    glow(palette.lane, 1.4, 0);
    ctx.beginPath();
    for (let i = 0; i < count; i++) line(P(i, 0), P(i, 1));
    ctx.stroke();

    // rings fading into the distance
    for (const z of [1, 0.62, 0.3]) {
      ctx.globalAlpha = alpha * (z === 1 ? 0.55 : 0.16);
      glow(palette.lane, z === 1 ? 1.6 : 1.1, z === 1 ? 6 : 0);
      ringPath(z);
      ctx.stroke();
    }

    // the lane you are standing on, lit up
    ctx.globalAlpha = alpha * 0.13;
    ctx.fillStyle = palette.rim;
    ctx.shadowBlur = 0;
    const a0 = P(player.u - 0.5, 0), b0 = P(player.u + 0.5, 0), b1 = P(player.u + 0.5, 1), a1 = P(player.u - 0.5, 1);
    ctx.beginPath();
    ctx.moveTo(a0[0], a0[1]); ctx.lineTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(a1[0], a1[1]);
    ctx.closePath();
    ctx.fill();

    // the rim itself
    ctx.globalAlpha = alpha;
    glow(palette.rim, 3.2, 18);
    ringPath(0);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function drawSpikes(alpha) {
    ctx.globalAlpha = alpha * 0.9;
    glow('#ff9f1c', 1.8, 8);
    ctx.beginPath();
    for (let i = 0; i < L(); i++) {
      const h = spikes[i];
      if (h <= 0.001) continue;
      for (let k = 0; k <= 10; k++) {
        const p = P(i + 0.5 + (k % 2 ? 0.2 : -0.2), 1 - (h * k) / 10);
        if (k === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // Every enemy is drawn inside the quad its lane cuts out of the tube wall, so it grows and
  // turns with the perspective for free. a/b = the near edge, a2/b2 = the far edge.
  function drawEnemy(type, a, b, a2, b2, color, t) {
    const nearMid = mid(a, b), farMid = mid(a2, b2);
    glow(color, 2.2, 12);
    if (type === 'fuseball') {
      const c = mid(nearMid, farMid);
      const rad = Math.max(3, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.36);
      ctx.beginPath();
      for (let k = 0; k < 7; k++) {
        const ang = (k / 7) * TAU + t * 5;
        const r1 = rad * (0.35 + Math.random() * 0.75);
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(c[0] + Math.cos(ang) * r1, c[1] + Math.sin(ang) * r1);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c[0], c[1], rad * 0.34, 0, TAU);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.shadowBlur = 0;
      return;
    }
    ctx.beginPath();
    if (type === 'flipper') {
      ctx.moveTo(a[0], a[1]); ctx.lineTo(farMid[0], farMid[1]); ctx.lineTo(b[0], b[1]);
      ctx.moveTo(a2[0], a2[1]); ctx.lineTo(nearMid[0], nearMid[1]); ctx.lineTo(b2[0], b2[1]);
    } else if (type === 'tanker') {
      const l = mid(a, a2), r = mid(b, b2);
      ctx.moveTo(nearMid[0], nearMid[1]); ctx.lineTo(r[0], r[1]); ctx.lineTo(farMid[0], farMid[1]); ctx.lineTo(l[0], l[1]); ctx.closePath();
      const il = lerpP(l, r, 0.3), ir = lerpP(l, r, 0.7);
      ctx.moveTo(il[0], il[1]); ctx.lineTo(ir[0], ir[1]);
    } else {
      for (let k = 0; k <= 4; k++) {
        const f = k / 4;
        const c = lerpP(nearMid, farMid, f);
        const edge = lerpP(lerpP(a, a2, f), lerpP(b, b2, f), k % 2 ? 0.9 : 0.1);
        const p = lerpP(c, edge, 0.78);
        if (k === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawEnemies() {
    for (const e of enemies.slice().sort((x, y) => y.z - x.z)) {
      const fold = e.flip > 0 ? Math.max(0.12, Math.abs(Math.cos(Math.PI * e.flip))) : 1;
      const hw = (e.type === 'fuseball' ? 0.44 : 0.5) * fold;
      const z = Math.max(0, e.z), d = 0.06;
      drawEnemy(e.type, P(e.u - hw, z), P(e.u + hw, z), P(e.u - hw, z + d), P(e.u + hw, z + d), e.hit > 0 ? '#fff' : COLORS[e.type], e.t);
    }
  }

  function drawPlayer() {
    if (player.dead > 0 || state === 'over') return;
    if (player.invuln > 0 && Math.floor(player.invuln * 14) % 2) return;
    const a = P(player.u - 0.5, 0), b = P(player.u + 0.5, 0), tip = P(player.u, 0.12);
    // little prongs poking out past the rim
    const out = (p) => {
      const dx = p[0] - tube.vx, dy = p[1] - tube.vy, m = Math.hypot(dx, dy) || 1;
      return [p[0] + (dx / m) * 13, p[1] + (dy / m) * 13];
    };
    const oa = out(a), ob = out(b);
    glow(COLORS.player, 3, 20);
    ctx.beginPath();
    ctx.moveTo(oa[0], oa[1]); ctx.lineTo(a[0], a[1]); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(ob[0], ob[1]);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tip[0], tip[1], 3.4, 0, TAU);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawShots() {
    glow('#fff', 2.4, 14);
    ctx.beginPath();
    for (const s of shots) line(P(s.u - 0.22, s.z), P(s.u + 0.22, s.z));
    ctx.stroke();
    glow(COLORS.bullet, 2.2, 12);
    ctx.beginPath();
    for (const b of bullets) {
      const l = P(b.u - 0.16, b.z), r = P(b.u + 0.16, b.z), n = P(b.u, b.z - 0.035), f = P(b.u, b.z + 0.035);
      ctx.moveTo(l[0], l[1]); ctx.lineTo(n[0], n[1]); ctx.lineTo(r[0], r[1]); ctx.lineTo(f[0], f[1]); ctx.closePath();
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawStars() {
    const far = Math.max(FW, FH) * 0.8;
    ctx.strokeStyle = '#8ea6ff';
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 0;
    for (const s of stars) {
      const d0 = Math.max(0, s.d - (phase === 'warp' ? 0.07 : 0.004));
      const r1 = s.d * s.d * far, r0 = d0 * d0 * far;
      const cx = Math.cos(s.a), cy = Math.sin(s.a);
      ctx.globalAlpha = Math.min(0.7, s.d * 1.2);
      ctx.beginPath();
      ctx.moveTo(CX + cx * r0, CY + cy * r0);
      ctx.lineTo(CX + cx * r1, CY + cy * r1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const sx = shake ? rand(-shake, shake) : 0, sy = shake ? rand(-shake, shake) : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (offX + sx), DPR * (offY + sy));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowBlur = 0;

    const bg = ctx.createRadialGradient(CX, CY, 0, CX, CY, Math.max(FW, FH) * 0.7);
    bg.addColorStop(0, '#0b0322');
    bg.addColorStop(1, '#03010a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    drawStars();
    if (!tube) { ctx.restore(); return; }

    // the tube fades out as it flies past the camera on a warp
    const alpha = phase === 'warp' && warp.stage === 0 ? Math.max(0, 1 - warp.t / 0.85) : 1;
    if (alpha > 0.03) {
      drawTube(alpha);
      drawSpikes(alpha);
      if (phase !== 'warp') { drawEnemies(); drawShots(); }
      ctx.globalAlpha = alpha;
      drawPlayer();
      ctx.globalAlpha = 1;
    }

    for (const p of particles) {
      const k = p.t / p.life;
      ctx.globalAlpha = Math.max(0, 1 - k);
      if (p.ring) {
        glow(p.c, 6 * (1 - k) + 1, 24);
        ringPath(0);
        ctx.stroke();
        ctx.shadowBlur = 0;
        continue;
      }
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 0.8;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y - p.t * 40);
    }
    ctx.globalAlpha = 1;

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.7 ? (2.2 - banner.t) / 0.5 : 1;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = '#fff';
      ctx.font = '15px "Press Start 2P", monospace';
      ctx.shadowColor = palette.rim;
      ctx.shadowBlur = 22;
      ctx.fillText(banner.text, FW / 2, FH * 0.16);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.55, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000b';
      ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = palette.rim;
      ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
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
    set('lives', '◆'.repeat(Math.max(0, Math.min(lives, 8))));
    set('level', state === 'title' ? '' : `LEVEL ${level}${CLASSIC ? '/' + FINAL_LEVEL : ''}`);
    set('shape', state === 'title' ? '' : tube.name);
    set('zap', state === 'title' ? '' : zaps > 0 ? '⚡ ZAPPER READY' : 'ZAPPER SPENT');
    if (zapBtn) zapBtn.classList.toggle('spent', zaps <= 0);
  }

  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); if (state === 'play') keys.add(KEYMAP[k]); }
    else if (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat && (k === ' ' || k === 'enter')) start();
      else if (state === 'play') { if (paused) paused = false; keys.add('fire'); }
    } else if (k === 'shift' || k === 'z') { if (state === 'play' && !e.repeat) { if (paused) paused = false; else superZap(); } }
    else if (k === 'p' || k === 'escape') { if (state === 'play') { paused = !paused; if (paused) unlockPointer(); } }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
    if (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w') keys.delete('fire');
  });
  window.addEventListener('blur', () => keys.clear());

  // Mouse/trackpad: horizontal movement slides you round the rim, like the arcade spinner. Clicking
  // takes the pointer so the cursor can't run out of screen; Escape gives it straight back.
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function lockPointer() {
    if (coarse || !canvas.requestPointerLock || document.pointerLockElement === canvas) return;
    try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* ignore */ }
  }
  function unlockPointer() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }

  let drag = null;
  function slide(dx, sens) {
    if (state !== 'play' || phase !== 'play' || player.dead > 0) return;
    player.u = wrapU(player.u + (dx / scale) * sens);
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    if (e.pointerType === 'mouse') { lockPointer(); fire(); keys.add('fire'); }
    else drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse') slide(typeof e.movementX === 'number' ? e.movementX : 0, 1 / 26);
    else if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      drag.moved += Math.abs(dx) + Math.abs(e.clientY - drag.y);
      drag.x = e.clientX; drag.y = e.clientY;
      slide(dx, 1 / 22);
    }
  });
  const endPointer = (e) => {
    if (e.pointerType === 'mouse') { keys.delete('fire'); return; }
    if (drag && drag.id === e.pointerId) {
      if (drag.moved < 12 && performance.now() - drag.t < 300) fire();
      drag = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const zapBtn = $('zap-btn');
  if (zapBtn) zapBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); superZap(); });

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') { paused = true; unlockPointer(); } });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  newGame();
  state = 'title';

  // title-screen legend: the very wireframes the game draws, in a little box each
  [['lg-flipper', 'flipper'], ['lg-tanker', 'tanker'], ['lg-spiker', 'spiker'], ['lg-fuse', 'fuseball']].forEach(([id, type]) => {
    const c = $(id);
    if (!c) return;
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    onCanvas(g, () => {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      drawEnemy(type, [5, H - 5], [W - 5, H - 5], [16, 5], [W - 16, 5], COLORS[type], 0.35);
    });
  });

  // attract mode behind the title screen: enemies keep climbing, nobody gets hurt
  function titleDemo(dt) {
    player.u = wrapU(player.u + Math.sin(time * 0.7) * dt * 2.4);
    player.invuln = 0;
    if (enemies.length < 5 && Math.random() < 0.02) spawn(Math.random() < 0.6 ? 'flipper' : Math.random() < 0.5 ? 'tanker' : 'fuseball', Math.floor(Math.random() * L()));
    for (const e of enemies) {
      e.t += dt;
      e.z -= e.speed * dt;
      if (e.type === 'flipper') {
        if (e.flip > 0) stepFlip(e, dt, 3);
        else if (Math.random() < 0.012) startFlip(e, Math.random() < 0.5 ? 1 : -1);
      }
      if (e.z <= 0) e.dead = true;
    }
    enemies = enemies.filter((e) => !e.dead);
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) {
      if (state === 'title') titleDemo(dt);
      update(dt);
    }
    render();
    hud();
    requestAnimationFrame(frame);
  }

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'tempest',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, phase, score, lives, level, shape: tube && tube.name, lanes: tube && tube.lanes,
        enemies: enemies.length, left: enemies.length + queue.length, rim: +player.u.toFixed(4),
        zaps, shots: shots.length, bullets: bullets.length, spikes: +spikes.reduce((a, b) => a + b, 0).toFixed(3), kills,
      }),
      set: (k, v) => {
        if (k === 'level') { cam = 0; phase = 'play'; warp = null; level = v - 1; startLevel(); }
        else if (k === 'lives') lives = v;
        else if (k === 'score') score = v;
        else if (k === 'zaps') zaps = v;
        else if (k === 'rim') player.u = wrapU(v);
      },
      // where everything is relative to the claw, for scripted play
      look: () => ({ dead: player.dead > 0, invuln: player.invuln > 0, enemies: enemies.map((e) => ({ type: e.type, z: +e.z.toFixed(3), du: +deltaU(e.u, player.u).toFixed(3), rim: e.rim })) }),
      fire,
      zap: superZap,
      clear: () => { enemies = []; queue = []; },
      win: () => {
        if (!CLASSIC) return endGame(true);
        level = FINAL_LEVEL;
        enemies = []; queue = [];
        levelCleared();
      },
    };
  }

  requestAnimationFrame(frame);
})();
