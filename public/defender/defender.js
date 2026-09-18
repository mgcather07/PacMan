/*
 * Infinite Rescue Patrol: a wrapping mountain planet, ten humanoids, and raiders that want them.
 * Landers carry humanoids to the top of the sky to become mutants; lose them all and the planet dies.
 * See docs/ADDING_A_GAME.md.
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('defender') || (CLASSIC ? 'defender-classic' : 'defender');
  const FINAL_WAVE = 10;          // classic: clear ten waves to win
  const WORLD = 3200;             // the planet wraps every WORLD units (about 4 screens)
  const TSTEP = 40, TN = WORLD / TSTEP;
  const FH = 700;                 // the field is a fixed height; its width follows the window aspect
  const BASE_Y = FH - 30;         // the foot of the mountains
  const HUMANS = 10;
  const POINTS = { lander: 150, mutant: 150, bomber: 250, pod: 1000, swarmer: 150, baiter: 200 };
  const RADIUS = { lander: 14, mutant: 14, bomber: 15, pod: 13, swarmer: 8, baiter: 13 };
  const COLORS = {
    lander: '#7dff6a', mutant: '#ff5ecf', bomber: '#3fd8ff', pod: '#b77dff', swarmer: '#ffd23f',
    baiter: '#ff4d6d', mine: '#ff9f43', human: '#ffe6a7', ship: '#5b8cff', laser: '#dce9ff',
  };

  let FW = 900, SKY_TOP = 170, RADAR_TOP = 90, RADAR_H = 52;

  // world randomness (terrain, humanoid spots, wave make-up, spawn timing) is seeded for dailies
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const wpick = (arr) => arr[Math.floor(wrand() * arr.length)];

  let state = 'title';
  let paused = false;
  let player, enemies, shots, bolts, mines, humans, particles, popups, stars, queue, terrain;
  let score, lives, wave, bombs, kills, saved, time, baitT, nextLifeAt;
  let camX, flash, banner, waveClearT, planetDead, hyperT, overT;
  let high = store.get(Arcade.modeKey('defender.high'), 0);

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    // keep the field as tall as the window and as wide as the aspect allows, so the world fills the screen
    FW = clamp(Math.round((FH * v.W) / v.H), 300, 1600);
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    RADAR_TOP = clamp(Math.round(104 / scale), 54, 170);
    RADAR_H = clamp(Math.round(56 / scale), 40, 74);
    SKY_TOP = RADAR_TOP + RADAR_H + 14;
  });
  const ctx = view.ctx;

  // ---------------------------------------------------------------------------
  // The wrapping planet
  // ---------------------------------------------------------------------------
  const wrapX = (x) => ((x % WORLD) + WORLD) % WORLD;
  const wrapDelta = (d) => { d = wrapX(d); return d > WORLD / 2 ? d - WORLD : d; };
  const sxOf = (wx) => { const d = wrapX(wx - camX); return d > WORLD - 400 ? d - WORLD : d; };
  const onScreen = (sx, m = 90) => sx > -m && sx < FW + m;

  function makeTerrain() {
    terrain = [];
    const harmonics = [1, 2, 3, 5, 8].map((f) => ({ f, a: wr(6, 34), p: wr(0, TAU) }));
    for (let i = 0; i < TN; i++) {
      let h = 0;
      for (const hm of harmonics) h += Math.sin((i / TN) * TAU * hm.f + hm.p) * hm.a;
      h += wr(0, 26) * (i % 2 ? 1 : 0.25); // jagged teeth between the rolling ridges
      terrain.push(BASE_Y - clamp(h + 34, 10, 152));
    }
  }

  function groundY(wx) {
    if (planetDead) return BASE_Y;
    const t = wrapX(wx) / TSTEP;
    const i = Math.floor(t), f = t - i;
    const a = terrain[i % TN], b = terrain[(i + 1) % TN];
    return a + (b - a) * f;
  }

  function makeHumans() {
    humans = [];
    for (let i = 0; i < HUMANS; i++) {
      const x = wrapX((i + wr(0.2, 0.8)) * (WORLD / HUMANS));
      humans.push({ x, y: groundY(x), vy: 0, state: 'stand', fallY: 0, walk: wr(0, TAU), dir: wpick([-1, 1]) });
    }
  }
  const humansLeft = () => humans.filter((h) => h.state !== 'dead').length;

  function makeStars() {
    stars = [];
    for (let i = 0; i < 140; i++) stars.push({ x: rand(0, WORLD), y: rand(0, FH * 0.8), s: rand(0.6, 2), tw: rand(0, TAU) });
  }

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function newGame() {
    wrand = DAILY ? Daily.rng('defender') : Math.random;
    planetDead = false;
    makeTerrain();
    makeHumans();
    makeStars();
    player = { x: WORLD * 0.5, y: FH * 0.45, vx: 0, vy: 0, dir: 1, alive: true, respawn: 0, invuln: 2, reload: 0, held: null };
    enemies = []; shots = []; bolts = []; mines = []; particles = []; popups = []; queue = [];
    score = 0; lives = 3; wave = 0; bombs = 2; kills = 0; saved = 0; time = 0;
    camX = wrapX(player.x - FW / 2); flash = 0; banner = null; waveClearT = 0; hyperT = 0; overT = 0; nextLifeAt = 20000;
    buildWave();
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
  const speedUp = () => (CLASSIC ? 1 + (wave - 1) * 0.05 : 1 + (wave - 1) * 0.07);

  function spawn(kind, x, y, extra) {
    const e = Object.assign({
      kind, x: wrapX(x), y, vx: 0, vy: 0, r: RADIUS[kind], hp: 1, t: 0, fireT: wr(1.5, 4),
      phase: 'hunt', target: null, wobble: wr(0, TAU), hit: 0,
    }, extra || {});
    enemies.push(e);
    return e;
  }

  function buildWave() {
    wave++;
    if (planetDead && wave % 5 === 1) {
      planetDead = false;
      makeTerrain();
      makeHumans();
      toast('THE PLANET IS REBUILT · 10 HUMANOIDS');
      Sound.arp([262, 330, 392, 523], 0.12, 'triangle', 0.045);
    }
    const w = wave;
    const landers = CLASSIC ? Math.min(3 + w * 2, 14) : Math.min(4 + w * 2, 18);
    const bombers = Math.min(1 + Math.floor(w / 2), CLASSIC ? 4 : 6);
    const pods = w >= 2 ? Math.min(1 + Math.floor((w - 2) / 2), CLASSIC ? 3 : 6) : 0;
    const mutants = !CLASSIC && w >= 6 ? Math.min(Math.floor((w - 4) / 2), 6) : 0;
    enemies = []; bolts = []; mines = []; shots = []; queue = [];
    const at = (kind, n, delayed) => {
      for (let i = 0; i < n; i++) {
        const x = wr(0, WORLD);
        const y = wr(SKY_TOP + 20, SKY_TOP + 200);
        if (delayed && i >= Math.ceil(n / 2)) queue.push({ t: wr(4, 22), kind, x, y });
        else spawn(kind, x, y);
      }
    };
    at('lander', planetDead ? 0 : landers, true);
    at('mutant', planetDead ? landers : mutants, false);
    at('bomber', bombers, true);
    at('pod', pods, true);
    baitT = Math.max(CLASSIC ? 22 : 16, (CLASSIC ? 50 : 42) - w * 1.5);
    bombs = Math.min(bombs + 1, 6);
    waveClearT = 0;
    banner = { text: CLASSIC ? `WAVE ${wave}/${FINAL_WAVE}` : `WAVE ${wave}`, t: 0 };
    Sound.arp([392, 523, 659], 0.09, 'square', 0.035);
  }

  function nextWave() {
    if (CLASSIC && wave >= FINAL_WAVE) return endGame(true);
    buildWave();
  }

  // ---------------------------------------------------------------------------
  // Scoring and explosions
  // ---------------------------------------------------------------------------
  function addScore(n, wx, y) {
    score += n;
    if (wx !== undefined) popups.push({ x: wx, y, text: '+' + n, t: 0 });
    if (score >= nextLifeAt) {
      nextLifeAt += 20000; lives++; bombs = Math.min(bombs + 1, 6);
      toast('EXTRA SHIP + SMART BOMB!');
      Sound.arp([523, 659, 784, 1046], 0.07);
    }
    if (score > high) { high = score; store.set(Arcade.modeKey('defender.high'), high); }
  }

  function explode(wx, y, color, n, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(40, speed);
      particles.push({ x: wx, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.25, 0.8), c: Math.random() < 0.3 ? '#fff' : color, s: rand(2, 4) });
    }
  }

  function killEnemy(e, silent) {
    e.dead = true;
    kills++;
    addScore(POINTS[e.kind] || 150, e.x, e.y);
    explode(e.x, e.y, COLORS[e.kind], e.kind === 'swarmer' ? 8 : 16);
    if (!silent) Sound.noise(0.13, 0.06, 0, 2400);
    if (e.carrying) dropHuman(e.carrying, e.y);
    if (e.kind === 'pod') {
      const n = Math.min(6, 3 + Math.floor(wave / 3));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        spawn('swarmer', e.x + Math.cos(a) * 20, clamp(e.y + Math.sin(a) * 20, SKY_TOP + 10, BASE_Y - 40), {
          vx: Math.cos(a) * 180, vy: Math.sin(a) * 140, fireT: wr(2, 6),
        });
      }
      Sound.arp([880, 660, 440], 0.05, 'sawtooth', 0.04);
    }
  }

  function dropHuman(h, fromY) {
    h.state = 'falling';
    h.carrier = null;
    h.vy = 0;
    h.fallY = fromY !== undefined ? fromY : h.y;
  }

  function blowPlanet() {
    planetDead = true;
    flash = 0.9;
    let turned = 0;
    for (const e of enemies) {
      if (e.kind === 'lander') { e.kind = 'mutant'; e.r = RADIUS.mutant; e.phase = 'chase'; e.carrying = null; turned++; }
    }
    queue = queue.filter((q) => q.kind !== 'lander');
    for (let i = 0; i < 40; i++) explode(wrapX(camX + rand(-200, FW + 200)), rand(BASE_Y - 120, BASE_Y), '#ff7a3d', 6, 360);
    Sound.noise(1.6, 0.26, 0, 420);
    Sound.tone(220, 40, 1.6, 'sawtooth', 0.05);
    toast(turned ? `PLANET DESTROYED · ${turned} MUTANTS` : 'PLANET DESTROYED');
  }

  // ---------------------------------------------------------------------------
  // Weapons
  // ---------------------------------------------------------------------------
  function fire() {
    if (!player.alive || player.reload > 0 || shots.length >= 4) return;
    shots.push({ x: wrapX(player.x + player.dir * 18), y: player.y, dir: player.dir, len: 40, t: 0 });
    player.reload = 0.14;
    Sound.tone(1500, 300, 0.07, 'square', 0.022);
  }

  function smartBomb() {
    if (!player.alive || bombs <= 0 || state !== 'play') return;
    bombs--;
    flash = 0.55;
    let hitCount = 0;
    for (const e of enemies) {
      if (!e.dead && onScreen(sxOf(e.x), 40)) { killEnemy(e, true); hitCount++; }
    }
    mines = mines.filter((m) => !onScreen(sxOf(m.x), 40));
    bolts = bolts.filter((b) => !onScreen(sxOf(b.x), 40));
    Sound.noise(0.8, 0.2, 0, 1600);
    Sound.tone(900, 80, 0.7, 'sawtooth', 0.05);
    toast(hitCount ? `SMART BOMB · ${hitCount} DOWN` : 'SMART BOMB');
  }

  function hyperspace() {
    if (!player.alive || hyperT > 0 || state !== 'play') return;
    hyperT = 0.8;
    explode(player.x, player.y, '#fff', 20, 200);
    player.x = wrapX(wr(0, WORLD));
    player.y = wr(SKY_TOP + 40, BASE_Y - 120);
    player.vx = 0; player.vy = 0;
    camX = wrapX(player.x - FW / 2 + player.dir * FW * 0.2);
    Sound.arp([200, 400, 800, 1600], 0.05, 'sine', 0.05);
    if (wrand() < 0.15) { toast('BAD EXIT!'); killPlayer(true); }
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------
  function killPlayer(force) {
    if (!player.alive || (player.invuln > 0 && !force)) return;
    player.alive = false;
    player.respawn = 1.9;
    lives--;
    flash = 0.35;
    if (player.held) { dropHuman(player.held, player.y); player.held = null; }
    explode(player.x, player.y, COLORS.ship, 60, 400);
    explode(player.x, player.y, '#fff', 24, 260);
    Sound.noise(1, 0.22, 0, 700);
    bolts = [];
    if (lives <= 0) overT = 1.3;   // let the last explosion play out before the game-over screen
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-wave').textContent = CLASSIC ? `${Math.min(wave, FINAL_WAVE)}/${FINAL_WAVE}` : wave;
    $('o-kills').textContent = kills.toLocaleString();
    $('o-saved').textContent = saved.toLocaleString();
    Arcade.endScreen(won, won ? 'Ten waves repelled. The planet is yours.' : planetDead ? 'The planet is gone.' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won, time }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let touchDrag = null;

  function updatePlayer(dt) {
    if (!player.alive) {
      if (lives > 0) {
        player.respawn -= dt;
        if (player.respawn <= 0) {
          Object.assign(player, { alive: true, invuln: 2.8, vx: 0, vy: 0, y: FH * 0.42 });
          // clear a little room around the respawn point
          for (const e of enemies) if (Math.abs(wrapDelta(e.x - player.x)) < 150) e.x = wrapX(e.x + 320);
        }
      }
      return;
    }
    if (player.invuln > 0) player.invuln -= dt;
    if (player.reload > 0) player.reload -= dt;
    if (hyperT > 0) hyperT -= dt;

    const ACC = 1700, MAXVX = 620, VACC = 1500, MAXVY = 400;
    let ax = 0, ay = 0;
    if (keys.has('left')) ax -= 1;
    if (keys.has('right')) ax += 1;
    if (keys.has('up')) ay -= 1;
    if (keys.has('down')) ay += 1;
    if (touchDrag) { ax += clamp(touchDrag.dx / 40, -1, 1); ay += clamp(touchDrag.dy / 34, -1, 1); }
    ax = clamp(ax, -1, 1); ay = clamp(ay, -1, 1);

    if (ax) { player.vx = clamp(player.vx + ax * ACC * dt, -MAXVX, MAXVX); if (Math.abs(ax) > 0.25 && Math.sign(ax) !== player.dir) player.dir = Math.sign(ax); }
    else player.vx -= player.vx * Math.min(1, dt * 2.6);
    if (ay) player.vy = clamp(player.vy + ay * VACC * dt, -MAXVY, MAXVY);
    else player.vy -= player.vy * Math.min(1, dt * 5);

    player.x = wrapX(player.x + player.vx * dt);
    player.y = clamp(player.y + player.vy * dt, SKY_TOP + 14, BASE_Y - 8);
    if (player.y <= SKY_TOP + 14 || player.y >= BASE_Y - 8) player.vy *= -0.2;
    if (keys.has('fire')) fire();

    // carrying a humanoid home: fly low and it hops off
    if (player.held) {
      player.held.x = player.x;
      player.held.y = player.y + 20;
      if (player.held.y >= groundY(player.x) - 10) {
        const h = player.held;
        player.held = null;
        h.state = 'stand';
        h.y = groundY(h.x);
        saved++;
        addScore(1000, h.x, h.y - 30);
        toast('HUMANOID RETURNED · +1000');
        Sound.arp([523, 659, 784, 1046, 1318], 0.06, 'triangle', 0.05);
      }
    }
  }

  function updateCamera(dt) {
    const want = wrapX(player.x - FW / 2 + player.dir * FW * 0.2);
    const d = wrapDelta(want - camX);
    camX = wrapX(camX + (Math.abs(d) > FW ? d : d * Math.min(1, dt * 4)));
  }

  function updateHumans(dt) {
    for (const h of humans) {
      if (h.state === 'dead') continue;
      if (h.state === 'stand') {
        h.walk += dt;
        if (h.walk > 2.4) { h.walk = 0; h.dir = -h.dir; }
        h.x = wrapX(h.x + h.dir * 12 * dt);
        h.y = groundY(h.x);
      } else if (h.state === 'carried') {
        if (!h.carrier || h.carrier.dead) { dropHuman(h); continue; }
        h.x = h.carrier.x;
        h.y = h.carrier.y + 22;
      } else if (h.state === 'falling') {
        h.vy = Math.min(320, h.vy + 420 * dt);
        h.y += h.vy * dt;
        // the ship scoops up anything it touches
        if (player.alive && !player.held && Math.abs(wrapDelta(h.x - player.x)) < 24 && Math.abs(h.y - player.y - 12) < 26) {
          h.state = 'held';
          player.held = h;
          addScore(500, h.x, h.y);
          toast('HUMANOID CAUGHT · +500');
          Sound.arp([660, 990, 1320], 0.05, 'triangle', 0.05);
          continue;
        }
        const g = groundY(h.x);
        if (h.y >= g) {
          if (g - h.fallY > 250) {
            h.state = 'dead';
            explode(h.x, g, COLORS.human, 14, 160);
            Sound.noise(0.25, 0.08, 0, 900);
            toast('HUMANOID LOST');
            if (!humansLeft()) blowPlanet();
          } else {
            h.state = 'stand';
            h.y = g;
            h.vy = 0;
          }
        }
      }
    }
  }

  function targetHuman(e) {
    let best = null, bestD = Infinity;
    for (const h of humans) {
      if (h.state !== 'stand') continue;
      if (enemies.some((o) => o !== e && !o.dead && o.carrying === h)) continue;
      const d = Math.abs(wrapDelta(h.x - e.x));
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
  }

  function enemyFire(e, speed, spread) {
    if (!player.alive) return;
    const dx = wrapDelta(player.x - e.x), dy = player.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const a = Math.atan2(dy, dx) + wr(-spread, spread); // seeded: how straight a raider shoots is part of the world
    if (d > FW * 0.8) return;
    bolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, t: 0, c: COLORS[e.kind] });
    Sound.tone(420, 160, 0.09, 'sawtooth', 0.016);
  }

  function updateEnemies(dt) {
    const sp = speedUp();
    for (const e of enemies) {
      if (e.dead) continue;
      e.t += dt;
      if (e.hit > 0) e.hit -= dt;
      const dxp = wrapDelta(player.x - e.x), dyp = player.y - e.y;

      if (e.kind === 'lander') {
        if (e.phase === 'hunt') {
          if (!e.target || e.target.state !== 'stand') e.target = targetHuman(e);
          if (!e.target) {
            e.vx = Math.cos(e.t * 0.6 + e.wobble) * 70 * sp;
            e.vy = Math.sin(e.t * 0.9) * 50;
          } else {
            const dx = wrapDelta(e.target.x - e.x);
            e.vx = clamp(dx * 1.3, -95 * sp, 95 * sp);
            e.vy = Math.abs(dx) < 90 ? 58 * sp : Math.sin(e.t * 1.4) * 34;
            if (Math.abs(dx) < 12 && Math.abs(e.target.y - 22 - e.y) < 16) {
              e.phase = 'lift';
              e.carrying = e.target;
              e.target.state = 'carried';
              e.target.carrier = e;
              Sound.tone(260, 620, 0.35, 'sine', 0.03);
            }
          }
        } else {
          e.vx = Math.sin(e.t * 2) * 26;
          e.vy = -56 * sp;
          if (e.y <= SKY_TOP + 16) {
            // it made it: the humanoid is eaten and the lander becomes a mutant
            const h = e.carrying;
            if (h) { h.state = 'dead'; h.carrier = null; }
            e.carrying = null;
            e.kind = 'mutant'; e.r = RADIUS.mutant; e.phase = 'chase'; e.fireT = wr(0.6, 1.6);
            explode(e.x, e.y, COLORS.mutant, 18, 220);
            Sound.arp([180, 300, 180, 420], 0.06, 'sawtooth', 0.045);
            toast('MUTANT!');
            if (!humansLeft()) blowPlanet();
          }
        }
        e.fireT -= dt;
        if (e.fireT <= 0) { e.fireT = wr(2, 5) / sp; enemyFire(e, 300 + wave * 6, 0.12); }
      } else if (e.kind === 'mutant') {
        const d = Math.hypot(dxp, dyp) || 1;
        const jitter = Math.sin(e.t * 9 + e.wobble) * 260;
        e.vx = clamp((dxp / d) * 230 * sp + jitter * 0.5, -430, 430);
        e.vy = clamp((dyp / d) * 190 * sp + Math.cos(e.t * 11 + e.wobble) * 180, -360, 360);
        e.fireT -= dt;
        if (e.fireT <= 0) { e.fireT = wr(1.2, 3) / sp; enemyFire(e, 340 + wave * 6, 0.2); }
      } else if (e.kind === 'bomber') {
        e.vx = (e.wobble > Math.PI ? -1 : 1) * 95 * sp;
        e.vy = Math.sin(e.t * 1.6 + e.wobble) * 120;
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT = wr(2.6, 4.4) / sp;
          mines.push({ x: e.x, y: e.y, t: 0 });
          Sound.tone(180, 120, 0.12, 'triangle', 0.02);
        }
      } else if (e.kind === 'pod') {
        e.vx = Math.cos(e.t * 0.5 + e.wobble) * 55;
        e.vy = Math.sin(e.t * 0.7 + e.wobble) * 45;
      } else if (e.kind === 'swarmer') {
        const d = Math.hypot(dxp, dyp) || 1;
        e.vx += ((dxp / d) * 340 * sp - e.vx) * Math.min(1, dt * 1.6) + Math.sin(e.t * 14) * 12;
        e.vy += ((dyp / d) * 280 * sp - e.vy) * Math.min(1, dt * 1.6) + Math.cos(e.t * 13) * 10;
        e.fireT -= dt;
        if (e.fireT <= 0) { e.fireT = wr(3, 7); enemyFire(e, 320, 0.25); }
      } else if (e.kind === 'baiter') {
        e.vx = clamp(dxp * 3, -560, 560);
        e.vy = clamp(dyp * 2.4, -320, 320);
        e.fireT -= dt;
        if (e.fireT <= 0) { e.fireT = wr(0.7, 1.6); enemyFire(e, 420, 0.1); }
      }

      e.x = wrapX(e.x + e.vx * dt);
      const floor = e.kind === 'lander' && e.phase === 'hunt' && e.target ? groundY(e.x) - 20 : Math.min(groundY(e.x) - 10, BASE_Y - 10);
      e.y = clamp(e.y + e.vy * dt, SKY_TOP + 8, floor);

      // the raiders are solid: touching one costs a ship
      if (player.alive && player.invuln <= 0 && Math.abs(wrapDelta(e.x - player.x)) < e.r + 9 && Math.abs(e.y - player.y) < e.r + 6) {
        e.dead = true;                       // a collision destroys the raider, but pays nothing
        if (e.carrying) dropHuman(e.carrying, e.y);
        explode(e.x, e.y, COLORS[e.kind], 16);
        killPlayer();
      }
    }
    enemies = enemies.filter((e) => !e.dead);
  }

  function updateShots(dt) {
    for (const s of shots) {
      s.t += dt;
      s.x = wrapX(s.x + s.dir * 2400 * dt);
      s.len = Math.min(230, s.len + 1500 * dt);
      for (const e of enemies) {
        if (e.dead) continue;
        const d = wrapDelta(e.x - s.x) * s.dir;   // 0 at the muzzle, negative back along the beam
        if (d > e.r || d < -s.len - e.r) continue;
        if (Math.abs(e.y - s.y) > e.r + 5) continue;
        e.hp--;
        e.hit = 0.1;
        if (e.hp <= 0) killEnemy(e);
        s.t = 9;
        break;
      }
    }
    shots = shots.filter((s) => s.t < 0.42);

    for (const b of bolts) {
      b.t += dt;
      b.x = wrapX(b.x + b.vx * dt);
      b.y += b.vy * dt;
      if (player.alive && player.invuln <= 0 && Math.abs(wrapDelta(b.x - player.x)) < 12 && Math.abs(b.y - player.y) < 8) {
        b.t = 99;
        killPlayer();
      }
    }
    bolts = bolts.filter((b) => b.t < 3.2 && b.y > SKY_TOP - 20 && b.y < BASE_Y + 10);

    for (const m of mines) {
      m.t += dt;
      if (player.alive && player.invuln <= 0 && Math.abs(wrapDelta(m.x - player.x)) < 16 && Math.abs(m.y - player.y) < 11) {
        m.t = 99;
        explode(m.x, m.y, COLORS.mine, 18);
        killPlayer();
      } else {
        for (const s of shots) {
          if (Math.abs(wrapDelta(m.x - s.x) * s.dir + s.len / 2) < s.len / 2 + 8 && Math.abs(m.y - s.y) < 12) {
            m.t = 99;
            addScore(25, m.x, m.y);
            explode(m.x, m.y, COLORS.mine, 10);
            break;
          }
        }
      }
    }
    mines = mines.filter((m) => m.t < 9);
  }

  function update(dt) {
    time += dt;
    for (const s of stars) s.tw += dt * 2;
    for (const p of particles) { p.t += dt; p.x = wrapX(p.x + p.vx * dt); p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    if (flash > 0) flash -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2) banner = null; }
    if (state !== 'play') return;
    if (overT > 0) { overT -= dt; if (overT <= 0) return endGame(false); }

    updatePlayer(dt);
    updateCamera(dt);
    updateHumans(dt);
    if (!planetDead && !humansLeft()) blowPlanet();
    updateEnemies(dt);
    updateShots(dt);
    enemies = enemies.filter((e) => !e.dead);

    // staggered arrivals
    for (const q of queue) q.t -= dt;
    for (const due of queue.filter((q) => q.t <= 0)) spawn(due.kind, due.x, due.y);
    queue = queue.filter((q) => q.t > 0);

    // baiters hurry along anyone who takes too long
    baitT -= dt;
    const maxBaiters = CLASSIC ? (wave < 3 ? 0 : 2) : Math.min(3, 1 + Math.floor(wave / 5));
    if (baitT <= 0 && state === 'play' && (enemies.length || queue.length) && enemies.filter((e) => e.kind === 'baiter').length < maxBaiters) {
      baitT = Math.max(7, 16 - wave * 0.4);
      spawn('baiter', player.x + wpick([-1, 1]) * FW * 0.6, wr(SKY_TOP + 30, BASE_Y - 80), { fireT: 1.2 });
      toast('BAITER INBOUND');
      Sound.tone(700, 1400, 0.25, 'sawtooth', 0.03);
    }

    // wave cleared
    if (!enemies.length && !queue.length && player.alive) {
      waveClearT += dt;
      if (waveClearT <= dt) {
        const left = humansLeft();
        const bonus = 100 * left * wave;
        if (bonus) { addScore(bonus); toast(`WAVE ${wave} CLEARED · ${left} HUMANOIDS · +${bonus.toLocaleString()}`); }
        else toast(`WAVE ${wave} CLEARED`);
        Sound.arp([523, 659, 784, 1046], 0.08, 'square', 0.04);
      }
      if (waveClearT > 2) nextWave();
    } else waveClearT = 0;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawShip(x, y, dir, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(dir, 1);
    ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(16, 0); ctx.lineTo(4, -6); ctx.lineTo(-10, -6); ctx.lineTo(-14, -1);
    ctx.lineTo(-14, 3); ctx.lineTo(-8, 7); ctx.lineTo(6, 6);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    ctx.fillRect(2, -3, 9, 3);
    // engine flare
    ctx.fillStyle = '#ff9f43';
    const f = 6 + Math.sin(performance.now() / 40) * 4;
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-14 - f, 1); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e, x, y) {
    const col = e.hit > 0 ? '#fff' : COLORS[e.kind];
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.fillStyle = col;
    if (e.kind === 'lander') {
      ctx.fillRect(-9, -9, 18, 6);
      ctx.fillRect(-4, -3, 8, 5);
      ctx.fillStyle = '#fff'; ctx.fillRect(-2, -8, 4, 4);
      ctx.fillStyle = col;
      ctx.fillRect(-9, 2, 3, 8); ctx.fillRect(6, 2, 3, 8);
    } else if (e.kind === 'mutant') {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU, r = i % 2 ? 6 : 13;
        i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(-2, -2, 4, 4);
    } else if (e.kind === 'bomber') {
      ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(14, 0); ctx.lineTo(0, 13); ctx.lineTo(-14, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#02030c';
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * 6 - 1.5, -4, 3, 8);
    } else if (e.kind === 'pod') {
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 6 + Math.sin(e.t * 4) * 2, 0, TAU); ctx.stroke();
    } else if (e.kind === 'swarmer') {
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(7, 0); ctx.lineTo(0, 7); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill();
    } else if (e.kind === 'baiter') {
      const d = e.vx >= 0 ? 1 : -1;
      ctx.scale(d, 1);
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  function drawHuman(x, y, held) {
    ctx.fillStyle = COLORS.human;
    ctx.shadowColor = COLORS.human; ctx.shadowBlur = 8;
    ctx.fillRect(x - 2, y - 12, 4, 4);       // head
    ctx.fillRect(x - 3, y - 8, 6, 5);        // body
    if (held) { ctx.fillRect(x - 5, y - 8, 2, 5); ctx.fillRect(x + 3, y - 8, 2, 5); }
    else { ctx.fillRect(x - 3, y - 3, 2, 3); ctx.fillRect(x + 1, y - 3, 2, 3); }
    ctx.shadowBlur = 0;
  }

  function drawRadar() {
    const x0 = 10, w = FW - 20, y0 = RADAR_TOP, h = RADAR_H;
    ctx.save();
    ctx.fillStyle = '#04061a';
    ctx.strokeStyle = '#5b8cff55';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, w, h, 6); else ctx.rect(x0, y0, w, h);
    ctx.fill(); ctx.stroke();
    ctx.clip();
    const rx = (wx) => x0 + (wrapX(wx) / WORLD) * w;
    const ry = (y) => y0 + 4 + ((clamp(y, SKY_TOP, BASE_Y) - SKY_TOP) / (BASE_Y - SKY_TOP)) * (h - 8);

    // the whole mountain range in miniature
    ctx.strokeStyle = planetDead ? '#ff5c3a88' : '#5b8cff88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= TN; i++) {
      const px = x0 + (i / TN) * w, py = ry(planetDead ? BASE_Y : terrain[i % TN]);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();

    // the slice of the world you can actually see
    const vx = rx(camX), vw = (FW / WORLD) * w;
    ctx.strokeStyle = '#ffffff44';
    ctx.strokeRect(vx, y0 + 1.5, vw, h - 3);
    if (vx + vw > x0 + w) ctx.strokeRect(vx - w, y0 + 1.5, vw, h - 3);

    for (const hm of humans) {
      if (hm.state === 'dead') continue;
      ctx.fillStyle = COLORS.human;
      ctx.fillRect(rx(hm.x) - 1, ry(hm.y) - 3, 2, 4);
    }
    for (const e of enemies) {
      ctx.fillStyle = COLORS[e.kind];
      const s = e.kind === 'swarmer' ? 2 : 3;
      ctx.fillRect(rx(e.x) - s / 2, ry(e.y) - s / 2, s, s);
    }
    if (player.alive) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(rx(player.x) - 2.5, ry(player.y) - 2, 5, 4);
    }
    ctx.restore();
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * offX, DPR * offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#02030c');
    bg.addColorStop(0.7, planetDead ? '#1a0508' : '#050a1e');
    bg.addColorStop(1, planetDead ? '#2a0a05' : '#0a0f2c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);

    // parallax stars
    for (const s of stars) {
      let sx = wrapX(s.x - camX * 0.45);
      if (sx > FW + 4) sx -= WORLD;
      if (sx < -4 || sx > FW + 4) continue;
      ctx.globalAlpha = 0.3 + Math.sin(s.tw) * 0.25;
      ctx.fillStyle = '#cfe4ff';
      ctx.fillRect(sx, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    // the mountain range
    const i0 = Math.floor(camX / TSTEP) - 1;
    const count = Math.ceil(FW / TSTEP) + 3;
    ctx.beginPath();
    ctx.moveTo(i0 * TSTEP - camX, FH);
    for (let k = 0; k <= count; k++) {
      const i = i0 + k;
      ctx.lineTo(i * TSTEP - camX, planetDead ? BASE_Y : terrain[((i % TN) + TN) % TN]);
    }
    ctx.lineTo((i0 + count) * TSTEP - camX, FH);
    ctx.closePath();
    ctx.fillStyle = planetDead ? '#180405' : '#060b1c';
    ctx.fill();
    ctx.strokeStyle = planetDead ? '#ff5c3a' : '#5b8cff';
    ctx.lineWidth = 2;
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // humanoids
    for (const h of humans) {
      if (h.state === 'dead') continue;
      const sx = sxOf(h.x);
      if (onScreen(sx, 30)) drawHuman(sx, h.y, h.state !== 'stand');
    }

    // mines
    for (const m of mines) {
      const sx = sxOf(m.x);
      if (!onScreen(sx, 30)) continue;
      const pulse = 5 + Math.sin(m.t * 9) * 2;
      ctx.strokeStyle = COLORS.mine; ctx.lineWidth = 2;
      ctx.shadowColor = COLORS.mine; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(sx, m.y, pulse, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // enemies
    for (const e of enemies) {
      const sx = sxOf(e.x);
      if (onScreen(sx, 40)) drawEnemy(e, sx, e.y);
    }

    // enemy bolts
    for (const b of bolts) {
      const sx = sxOf(b.x);
      if (!onScreen(sx, 20)) continue;
      ctx.fillStyle = b.c || '#fff';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
      ctx.fillRect(sx - 3, b.y - 3, 6, 6);
      ctx.shadowBlur = 0;
    }

    // lasers: a bright bar stretching out ahead of the ship
    for (const s of shots) {
      const sx = sxOf(s.x);
      const tail = sx - s.dir * s.len;
      if (!onScreen(sx, s.len + 40) && !onScreen(tail, 40)) continue;
      const g = ctx.createLinearGradient(tail, 0, sx, 0);
      g.addColorStop(0, '#5b8cff00');
      g.addColorStop(0.5, COLORS.laser);
      g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
      ctx.shadowColor = COLORS.ship; ctx.shadowBlur = 12;
      ctx.fillRect(Math.min(sx, tail), s.y - 1.5, s.len, 3);
      ctx.shadowBlur = 0;
    }

    // the ship
    if (player && player.alive && !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2)) {
      drawShip(sxOf(player.x), player.y, player.dir, COLORS.ship);
      if (player.held) drawHuman(sxOf(player.x), player.y + 24, true);
    }

    // explosions and score popups
    for (const p of particles) {
      const sx = sxOf(p.x);
      if (!onScreen(sx, 20)) continue;
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(sx - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '10px "Press Start 2P", monospace';
    for (const p of popups) {
      const sx = sxOf(p.x);
      if (!onScreen(sx, 40)) continue;
      ctx.globalAlpha = 1 - p.t / 0.9;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, sx, p.y - p.t * 44);
    }
    ctx.globalAlpha = 1;

    drawRadar();

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.6 ? (2 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(16, Math.round(FW / 34))}px "Press Start 2P", monospace`;
      ctx.shadowColor = COLORS.ship; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, FW / 2, FH * 0.46);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = COLORS.ship;
      ctx.font = '24px "Press Start 2P", monospace';
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
    if (!player) return;
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '▶'.repeat(Math.max(0, Math.min(lives, 8))));
    set('wave', state === 'title' ? '' : `WAVE ${wave}${CLASSIC ? '/' + FINAL_WAVE : ''}`);
    set('humans', state === 'title' ? '' : `HUMANS ${humansLeft()}/${HUMANS}`);
    set('bombs', state === 'title' ? '' : `BOMBS ${bombs}`);
  }

  const KEYMAP = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); if (state === 'play') keys.add(KEYMAP[k]); }
    else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat) start();
      else if (state === 'play') { paused = false; keys.add('fire'); }
    } else if (k === 'b') { if (state === 'play' && !paused) smartBomb(); }
    else if (k === 'h') { if (state === 'play' && !paused) hyperspace(); }
    else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
    if (k === ' ' || k === 'enter') keys.delete('fire');
  });
  window.addEventListener('blur', () => { keys.clear(); touchDrag = null; });

  // Mouse: hold a button to fire. Touch: drag anywhere to fly, a tap fires.
  const toField = (cx, cy) => ({ x: (cx - offX) / scale, y: (cy - offY) / scale });
  let pointer = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    const p = toField(e.clientX, e.clientY);
    pointer = { id: e.pointerId, sx: p.x, sy: p.y, moved: 0, t: performance.now(), touch: e.pointerType !== 'mouse' };
    if (pointer.touch) touchDrag = { dx: 0, dy: 0 };
    else keys.add('fire');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const p = toField(e.clientX, e.clientY);
    const dx = p.x - pointer.sx, dy = p.y - pointer.sy;
    pointer.moved = Math.max(pointer.moved, Math.hypot(dx, dy));
    if (pointer.touch) touchDrag = { dx, dy };
  });
  const endPointer = (e) => {
    if (!pointer || pointer.id !== e.pointerId) return;
    if (pointer.touch) {
      touchDrag = null;
      if (pointer.moved < 14 && performance.now() - pointer.t < 320) fire();
    } else keys.delete('fire');
    pointer = null;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  const holdButton = (btn, on, off) => {
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.classList.add('on'); on(); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => btn.addEventListener(t, () => { btn.classList.remove('on'); if (off) off(); }));
  };
  holdButton($('fire-btn'), () => keys.add('fire'), () => keys.delete('fire'));
  holdButton($('bomb-btn'), () => smartBomb());
  holdButton($('hyper-btn'), () => hyperspace());

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
      game: 'defender',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, score, lives, wave, bombs, kills, saved,
        humans: humansLeft(), enemies: enemies.length, queued: queue.length,
        mines: mines.length, shots: shots.length, bolts: bolts.length,
        planetDead, held: !!(player && player.held), x: player && Math.round(player.x), y: player && Math.round(player.y),
      }),
      set: (k, v) => {
        if (k === 'wave') { wave = v - 1; buildWave(); }
        else if (k === 'lives') lives = v;
        else if (k === 'score') score = v;
        else if (k === 'bombs') bombs = v;
        else if (k === 'humans') humans.forEach((h, i) => { if (i >= v) h.state = 'dead'; });
      },
      press: (k) => keys.add(k),
      release: (k) => keys.delete(k),
      fire, smartBomb, hyperspace,
      moveTo: (x, y) => { player.x = wrapX(x); if (y !== undefined) player.y = y; camX = wrapX(player.x - FW / 2); },
      drop: () => { const h = humans.find((v) => v.state === 'stand'); if (h) { h.x = player.x; h.y = player.y - 70; dropHuman(h, h.y); } return !!h; },
      clear: () => { enemies = []; queue = []; },
      win: () => {
        if (state !== 'play') start();
        wave = FINAL_WAVE; enemies = []; queue = []; mines = []; waveClearT = 0;
        for (let i = 0; i < 200 && state === 'play'; i++) update(1 / 60);
      },
    };
  }

  // attract mode behind the title screen: the planet turns while the raid drifts past
  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    if (state === 'title') {
      camX = wrapX(camX + dt * 90);
      for (const e of enemies) {
        e.t += dt;
        e.y = clamp(e.y + Math.sin(e.t * 1.2 + e.wobble) * 30 * dt, SKY_TOP + 20, BASE_Y - 60);
      }
    }
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
