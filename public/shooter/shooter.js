(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 540, FH = 900;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const FINAL_WAVE = 15; // classic mode: beat the wave-15 boss to win
  const SUITS = ['♠', '♥', '♦', '♣'];
  const NEBULAS = [['#1a0b3a', '#050314'], ['#0b2a3a', '#03060f'], ['#3a0b24', '#0f0308'], ['#0b3a1e', '#030f07'], ['#3a2a0b', '#0f0a03']];

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  let state = 'title';
  let paused = false;
  let player, enemies, shots, eshots, drops, particles, popups, stars;
  let score, lives, bombs, wave, waveT, schedule, banner, suits, chain, chainT, time, bossActive, flash, nextLifeAt, kills;
  let high = store.get(Arcade.modeKey('shooter.high'), 0);

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function makeStars() {
    stars = [];
    for (let i = 0; i < 140; i++) stars.push({ x: rand(0, FW), y: rand(0, FH), z: rand(0.2, 1) });
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('shooter') : Math.random;
    player = { x: FW / 2, y: FH - 120, tx: FW / 2, ty: FH - 120, level: 1, fireT: 0, invuln: 2, shield: 0, alive: true, respawn: 0 };
    enemies = []; shots = []; eshots = []; drops = []; particles = []; popups = [];
    score = 0; lives = 3; bombs = 2; wave = 0; suits = [false, false, false, false];
    chain = 0; chainT = 0; time = 0; bossActive = false; flash = 0; nextLifeAt = 50000; kills = 0;
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
    if (window.Leaderboard) Leaderboard.startRun(Daily.board('shooter') || (Arcade.classic ? 'shooter-classic' : 'shooter'));
  }

  // ---------------------------------------------------------------------------
  // Waves
  // ---------------------------------------------------------------------------
  function endGame(won) {
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-wave').textContent = CLASSIC ? `${Math.min(wave, FINAL_WAVE)}/${FINAL_WAVE}` : wave;
    $('o-kills').textContent = kills;
    Arcade.endScreen(won, won ? `All ${FINAL_WAVE} waves and 3 bosses defeated!` : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(Daily.board('shooter') || (Arcade.classic ? 'shooter-classic' : 'shooter'), { score, won: !!won }, document.querySelector('#over .panel'));
  }

  function startWave() {
    if (CLASSIC && wave >= FINAL_WAVE) { addScore(lives * 5000 + bombs * 1000); return endGame(true); }
    wave++;
    waveT = 0;
    schedule = [];
    const d = wave;
    if (wave % 5 === 0) {
      schedule.push({ t: 1.5, fn: () => spawnBoss() });
      banner = { text: CLASSIC && wave === FINAL_WAVE ? 'FINAL BOSS' : `WAVE ${wave} — BOSS`, t: 0 };
      Sound.arp([220, 196, 175, 147], 0.18, 'sawtooth', 0.04);
    } else {
      banner = { text: `WAVE ${wave}`, t: 0 };
      let t = 1.2;
      const groups = 3 + Math.min(6, Math.floor(d / 2));
      for (let g = 0; g < groups; g++) {
        const roll = wrand();
        if (roll < 0.3) addFormation(t, d);
        else if (roll < 0.5) addSwoopers(t, d);
        else if (roll < 0.68 && d >= 2) addGunship(t, d);
        else if (roll < 0.84 && d >= 3) addKamikazes(t, d);
        else addDrones(t, d);
        t += wr(2.2, 3.4) * Math.max(0.55, 1 - d * 0.03);
      }
      Sound.arp([392, 523, 659], 0.09, 'square', 0.035);
    }
  }

  const difficulty = () => 1 + wave * 0.08;

  function addDrones(t, d) {
    const n = 4 + Math.min(6, d);
    for (let i = 0; i < n; i++) schedule.push({ t: t + i * 0.35, fn: () => enemies.push(enemy('drone', wr(40, FW - 40), -30)) });
  }
  function addFormation(t, d) {
    const cx = wr(120, FW - 120), n = 5 + Math.min(4, Math.floor(d / 3));
    schedule.push({ t, fn: () => { for (let i = 0; i < n; i++) { const k = i - (n - 1) / 2; enemies.push(enemy('drone', cx + k * 42, -30 - Math.abs(k) * 36, { wobble: 0 })); } } });
  }
  function addSwoopers(t, d) {
    const dir = wrand() < 0.5 ? 1 : -1, n = 5 + Math.min(5, Math.floor(d / 2));
    for (let i = 0; i < n; i++) schedule.push({ t: t + i * 0.28, fn: () => enemies.push(enemy('swooper', dir > 0 ? -30 : FW + 30, wr(90, 180), { dir })) });
  }
  function addGunship(t, d) {
    const n = 1 + Math.floor(d / 6);
    for (let i = 0; i < n; i++) schedule.push({ t: t + i * 0.8, fn: () => enemies.push(enemy('gunship', wr(80, FW - 80), -60)) });
  }
  function addKamikazes(t, d) {
    const n = 3 + Math.min(5, Math.floor(d / 2));
    for (let i = 0; i < n; i++) schedule.push({ t: t + i * 0.45, fn: () => enemies.push(enemy('kamikaze', wr(40, FW - 40), -30)) });
  }

  function enemy(type, x, y, extra = {}) {
    const k = difficulty();
    const base = {
      drone: { hp: 1, r: 16, score: 100, color: '#ff4d6d' },
      swooper: { hp: 2, r: 16, score: 150, color: '#ffd23f' },
      gunship: { hp: Math.round(12 * k), r: 30, score: 800, color: '#c77dff' },
      kamikaze: { hp: 2, r: 14, score: 200, color: '#ff8a3d' },
    }[type];
    return { type, x, y, x0: x, t: 0, fireT: rand(0.8, 2.2), vx: 0, vy: 0, hit: 0, maxHp: base.hp, wobble: rand(20, 60), ...base, ...extra };
  }

  function spawnBoss() {
    const k = difficulty();
    const tier = wave / 5;
    const hp = Math.round((160 * k + tier * 60) * (CLASSIC && wave === FINAL_WAVE ? 1.5 : 1));
    enemies.push({ type: 'boss', x: FW / 2, y: -120, t: 0, hp, maxHp: hp, r: 64, score: 5000 * tier, color: NEBULAS[(tier - 1) % NEBULAS.length][0], hit: 0, phase: 0, phaseT: 0, fireT: 0, spin: 0 });
    bossActive = true;
    toast('⚠ WARNING: BOSS APPROACHING');
  }

  // ---------------------------------------------------------------------------
  // Combat
  // ---------------------------------------------------------------------------
  function fireEnemy(x, y, angle, speed, color = '#ff5ea8', r = 6) {
    eshots.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, color });
  }
  const aim = (e) => Math.atan2(player.y - e.y, player.x - e.x);

  function playerFire() {
    const L = player.level;
    const pattern = [[0], [-8, 8], [-0.12, 0, 0.12], [-0.22, -0.1, 0, 0.1, 0.22], [-0.3, -0.15, 0, 0.15, 0.3]][L - 1];
    if (L === 2) for (const dx of pattern) shots.push({ x: player.x + dx, y: player.y - 22, vx: 0, vy: -980, dmg: 1 });
    else for (const a of pattern) shots.push({ x: player.x, y: player.y - 22, vx: Math.sin(a) * 980, vy: -Math.cos(a) * 980, dmg: 1 });
    if (L >= 5) for (const s of [-1, 1]) shots.push({ x: player.x + s * 20, y: player.y, vx: s * 60, vy: -760, dmg: 2, missile: true });
    Sound.tone(1600, 900, 0.035, 'square', 0.012);
  }

  function addScore(n, x, y) {
    const mult = 1 + Math.min(9, Math.floor(chain / 10));
    const pts = n * mult;
    score += pts;
    if (x !== undefined) popups.push({ x, y, text: String(pts), t: 0 });
    if (score >= nextLifeAt) { nextLifeAt += 50000; lives++; toast('EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set(Arcade.modeKey('shooter.high'), high); }
  }

  function explode(x, y, color, n, speed = 240) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(30, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.3, 0.8), c: Math.random() < 0.3 ? '#ffffff' : color, s: rand(2, 5) });
    }
  }

  function killEnemy(e) {
    e.dead = true;
    kills++;
    chain++;
    chainT = 1.2;
    addScore(e.score, e.x, e.y);
    explode(e.x, e.y, e.color, e.type === 'boss' ? 120 : e.type === 'gunship' ? 40 : 16, e.type === 'boss' ? 420 : 240);
    Sound.noise(e.type === 'boss' ? 1.4 : e.type === 'gunship' ? 0.5 : 0.18, e.type === 'boss' ? 0.25 : 0.08, 0, e.type === 'boss' ? 500 : 1800);
    if (e.type === 'boss') {
      bossActive = false;
      flash = 0.6;
      eshots = [];
      for (let i = 0; i < 4; i++) drops.push(makeDrop(e.x + rand(-60, 60), e.y + rand(-30, 30), i === 0 ? 'power' : i === 1 ? 'bomb' : Math.random() < 0.5 ? 'card' : 'shield'));
      toast(`BOSS DESTROYED! +${(e.score).toLocaleString()}`);
      return;
    }
    const chance = e.type === 'gunship' ? 0.6 : 0.045;
    if (Math.random() < chance) {
      const r = Math.random();
      drops.push(makeDrop(e.x, e.y, r < 0.45 ? 'power' : r < 0.6 ? 'bomb' : r < 0.75 ? 'shield' : 'card'));
    }
  }

  const makeDrop = (x, y, type) => ({ x, y, type, suit: Math.floor(rand(0, 4)), t: 0 });

  function hitPlayer() {
    if (player.invuln > 0 || !player.alive) return;
    if (player.shield > 0) {
      player.shield--;
      player.invuln = 1;
      explode(player.x, player.y, '#3fd8ff', 24);
      Sound.tone(900, 200, 0.3, 'sawtooth', 0.04);
      return;
    }
    player.alive = false;
    player.respawn = 1.6;
    lives--;
    chain = 0;
    player.level = Math.max(1, player.level - 1);
    flash = 0.3;
    explode(player.x, player.y, '#3fd8ff', 60, 360);
    Sound.noise(1, 0.22, 0, 900);
    eshots = eshots.filter((s) => Math.hypot(s.x - player.x, s.y - player.y) > 220);
    if (lives <= 0) setTimeout(() => endGame(false), 1300);
  }

  function useBomb() {
    if (state !== 'play' || paused || bombs <= 0 || !player.alive) return;
    bombs--;
    flash = 0.5;
    player.invuln = Math.max(player.invuln, 1.2);
    for (const s of eshots) explode(s.x, s.y, s.color, 2, 80);
    eshots = [];
    for (const e of enemies) {
      e.hp -= e.type === 'boss' ? 40 : 25;
      e.hit = 0.15;
      if (e.hp <= 0 && !e.dead) killEnemy(e);
    }
    Sound.noise(1.2, 0.3, 0, 400);
    Sound.tone(80, 40, 1, 'sawtooth', 0.06);
  }

  function collect(d) {
    Sound.arp([660, 990, 1320], 0.05, 'triangle', 0.05);
    addScore(250);
    if (d.type === 'power') {
      if (player.level < 5) { player.level++; toast(`WEAPON LEVEL ${player.level}`); }
      else addScore(1000, d.x, d.y);
    } else if (d.type === 'bomb') { bombs = Math.min(9, bombs + 1); toast('+1 BOMB'); }
    else if (d.type === 'shield') { player.shield = Math.min(3, player.shield + 1); toast('SHIELD'); }
    else if (d.type === 'card') {
      if (suits[d.suit]) { toast(`Another ${SUITS[d.suit]} — +500`); addScore(500); return; }
      suits[d.suit] = true;
      if (suits.every(Boolean)) { suits = [false, false, false, false]; lives++; toast('♠♥♦♣ FULL SUIT SET — EXTRA LIFE!'); }
      else toast(`Found ${SUITS[d.suit]} (${suits.filter(Boolean).length}/4 suits)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();

  function update(dt) {
    time += dt;
    const scroll = 60 + Math.min(120, wave * 6);
    for (const s of stars) { s.y += scroll * s.z * dt * 2; if (s.y > FH) { s.y -= FH; s.x = rand(0, FW); } }
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    if (flash > 0) flash -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
    if (state !== 'play') return;

    // player
    if (player.alive) {
      const sp = 480 * dt;
      if (keys.has('left')) player.tx -= sp;
      if (keys.has('right')) player.tx += sp;
      if (keys.has('up')) player.ty -= sp;
      if (keys.has('down')) player.ty += sp;
      player.tx = clamp(player.tx, 20, FW - 20);
      player.ty = clamp(player.ty, 120, FH - 40);
      player.x += (player.tx - player.x) * Math.min(1, dt * 18);
      player.y += (player.ty - player.y) * Math.min(1, dt * 18);
      if (player.invuln > 0) player.invuln -= dt;
      player.fireT -= dt;
      if (player.fireT <= 0) { playerFire(); player.fireT = player.level >= 4 ? 0.085 : 0.11; }
    } else if (lives > 0) {
      player.respawn -= dt;
      if (player.respawn <= 0) Object.assign(player, { alive: true, invuln: 2.5, x: FW / 2, y: FH - 120, tx: FW / 2, ty: FH - 120 });
    }
    if (chainT > 0) { chainT -= dt; if (chainT <= 0) chain = 0; }

    // schedule
    waveT += dt;
    for (const s of schedule) if (!s.done && waveT >= s.t) { s.done = true; s.fn(); }
    if (schedule.every((s) => s.done) && !enemies.length && !bossActive && waveT > 2) startWave();

    // enemies
    const k = difficulty();
    for (const e of enemies) {
      e.t += dt;
      if (e.hit > 0) e.hit -= dt;
      e.fireT -= dt;
      switch (e.type) {
        case 'drone':
          e.y += (90 + 20 * k) * dt;
          e.x = e.x0 + Math.sin(e.t * 2.2) * (e.wobble || 0);
          if (e.fireT <= 0 && e.y > 40 && e.y < FH * 0.6 && wave > 1) { e.fireT = rand(2.2, 4) / k; fireEnemy(e.x, e.y + 10, aim(e), 220 * Math.sqrt(k)); }
          break;
        case 'swooper':
          e.x += e.dir * 190 * dt;
          e.y += Math.sin(e.t * 2.4) * 160 * dt + 40 * dt;
          if (e.fireT <= 0 && e.x > 0 && e.x < FW) { e.fireT = rand(1.8, 3) / k; fireEnemy(e.x, e.y, aim(e), 240 * Math.sqrt(k), '#ffd23f'); }
          break;
        case 'gunship': {
          const stop = 150 + (e.x0 % 120);
          if (e.y < stop) e.y += 80 * dt;
          else e.x = clamp(e.x0 + Math.sin(e.t * 0.8) * 140, 40, FW - 40);
          if (e.t > 14) e.y += 60 * dt;
          if (e.fireT <= 0 && e.y > 40) {
            e.fireT = 1.5 / Math.sqrt(k);
            const a = aim(e);
            for (const off of [-0.3, -0.15, 0, 0.15, 0.3].slice(0, 3 + Math.min(2, Math.floor(wave / 6)))) fireEnemy(e.x, e.y + 20, a + off, 230 * Math.sqrt(k), '#c77dff', 7);
          }
          break;
        }
        case 'kamikaze':
          if (e.t < 0.9) e.y += 140 * dt;
          else {
            if (!e.locked) { e.locked = true; const a = aim(e); e.vx = Math.cos(a); e.vy = Math.sin(a); Sound.tone(500, 1200, 0.2, 'sawtooth', 0.02); }
            const sp = Math.min(640, 200 + (e.t - 0.9) * 700);
            e.x += e.vx * sp * dt; e.y += e.vy * sp * dt;
          }
          break;
        case 'boss':
          updateBoss(e, dt, k);
          break;
      }
      if (e.type !== 'boss' && (e.y > FH + 60 || e.x < -80 || e.x > FW + 80)) e.gone = true;
    }

    // player shots
    for (const s of shots) {
      if (s.missile) {
        let target = null, bd = 260;
        for (const e of enemies) { const d = Math.hypot(e.x - s.x, e.y - s.y); if (d < bd && e.y < s.y) { bd = d; target = e; } }
        if (target) { s.vx += clamp(target.x - s.x, -1, 1) * 1400 * dt; }
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      for (const e of enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) < e.r + 4) {
          s.dead = true;
          if (e.type === 'boss' && e.y < 60) break;
          e.hp -= s.dmg;
          e.hit = 0.06;
          if (e.hp <= 0) killEnemy(e);
          else if (Math.random() < 0.3) particles.push({ x: s.x, y: s.y, vx: rand(-60, 60), vy: rand(-120, -20), t: 0, life: 0.2, c: '#9ffcff', s: 2 });
          break;
        }
      }
    }
    shots = shots.filter((s) => !s.dead && s.y > -20 && s.x > -20 && s.x < FW + 20);
    enemies = enemies.filter((e) => !e.dead && !e.gone);

    // enemy shots & collisions
    const hitR = 7;
    for (const s of eshots) {
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (player.alive && Math.hypot(s.x - player.x, s.y - player.y) < s.r + hitR) { s.dead = true; hitPlayer(); }
    }
    eshots = eshots.filter((s) => !s.dead && s.y < FH + 20 && s.y > -40 && s.x > -40 && s.x < FW + 40);
    if (player.alive) {
      for (const e of enemies) {
        if (Math.hypot(e.x - player.x, e.y - player.y) < e.r * 0.8 + hitR) {
          if (e.type !== 'boss' && player.invuln <= 0) { e.hp = 0; killEnemy(e); }
          hitPlayer();
          break;
        }
      }
    }

    for (const d of drops) {
      d.t += dt;
      const dist = Math.hypot(d.x - player.x, d.y - player.y);
      if (player.alive && dist < 140) { d.x += (player.x - d.x) * dt * 4; d.y += (player.y - d.y) * dt * 4; }
      else d.y += 110 * dt;
      if (player.alive && dist < 28) { d.got = true; collect(d); }
    }
    drops = drops.filter((d) => !d.got && d.y < FH + 30);
  }

  function updateBoss(e, dt, k) {
    if (e.y < 170) { e.y += 70 * dt; return; }
    e.x = FW / 2 + Math.sin(e.t * 0.6) * 150;
    e.phaseT += dt;
    const phases = 3;
    if (e.phaseT > 4.5) { e.phaseT = 0; e.phase = (e.phase + 1) % phases; }
    const enraged = e.hp < e.maxHp * 0.35;
    const rate = enraged ? 0.7 : 1;
    if (e.phase === 0) {
      // spiral
      e.spin += dt * 3.2;
      if (e.fireT <= 0) {
        e.fireT = 0.09 * rate / Math.sqrt(k);
        for (let i = 0; i < (enraged ? 3 : 2); i++) fireEnemy(e.x, e.y, e.spin + (i * TAU) / (enraged ? 3 : 2), 190 * Math.sqrt(k), '#ff5ea8', 6);
      }
    } else if (e.phase === 1) {
      // aimed fans
      if (e.fireT <= 0) {
        e.fireT = 0.9 * rate;
        const a = aim(e);
        const n = enraged ? 9 : 7;
        for (let i = 0; i < n; i++) fireEnemy(e.x, e.y + 40, a + (i - (n - 1) / 2) * 0.13, 260 * Math.sqrt(k), '#ffd23f', 6);
      }
    } else {
      // rings
      if (e.fireT <= 0) {
        e.fireT = 1.1 * rate;
        const n = enraged ? 28 : 22, off = rand(0, TAU);
        for (let i = 0; i < n; i++) fireEnemy(e.x, e.y, off + (i * TAU) / n, 170 * Math.sqrt(k), '#9ffcff', 7);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * offX, DPR * offY);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();

    const neb = NEBULAS[Math.floor(Math.max(0, wave - 1) / 5) % NEBULAS.length];
    const g = ctx.createRadialGradient(FW * 0.6, FH * 0.3, 40, FW / 2, FH / 2, FH * 0.8);
    g.addColorStop(0, neb[0]); g.addColorStop(1, neb[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FW, FH);
    for (const s of stars) { ctx.fillStyle = `rgba(220,230,255,${0.3 + s.z * 0.7})`; ctx.fillRect(s.x, s.y, s.z * 2.2, s.z * 2.2 + s.z * 4); }
    if (!player) { ctx.restore(); return; }

    // drops
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of drops) {
      const col = { power: '#ff4d6d', bomb: '#ffd23f', shield: '#3fd8ff', card: '#ffffff' }[d.type];
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.sin(d.t * 3) * 0.3);
      ctx.shadowColor = col; ctx.shadowBlur = 16;
      ctx.fillStyle = d.type === 'card' ? '#fbfbff' : '#0a0a1a';
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-14, -14, 28, 28, 7); else ctx.rect(-14, -14, 28, 28);
      ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      if (d.type === 'card') { ctx.fillStyle = d.suit === 1 || d.suit === 2 ? '#e0153a' : '#111'; ctx.font = '20px serif'; ctx.fillText(SUITS[d.suit], 0, 1); }
      else { ctx.fillStyle = col; ctx.font = '12px "Press Start 2P", monospace'; ctx.fillText({ power: 'P', bomb: 'B', shield: 'S' }[d.type], 1, 2); }
      ctx.restore();
    }

    // player shots
    for (const s of shots) {
      ctx.fillStyle = s.missile ? '#ffd23f' : '#9ffcff';
      ctx.shadowColor = s.missile ? '#ff8a3d' : '#3fd8ff'; ctx.shadowBlur = 8;
      ctx.fillRect(s.x - 2, s.y - 9, 4, 16);
    }
    ctx.shadowBlur = 0;

    // enemies
    for (const e of enemies) drawEnemy(e);

    // enemy shots
    for (const s of eshots) {
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 3, 0, TAU); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.45, 0, TAU); ctx.fill();
    }

    // player
    if (player.alive && state !== 'title' && !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2)) drawPlayer();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of popups) { ctx.globalAlpha = 1 - p.t / 0.8; ctx.fillStyle = '#fff'; ctx.fillText(p.text, p.x, p.y - p.t * 40); }
    ctx.globalAlpha = 1;

    // boss health bar
    const boss = enemies.find((e) => e.type === 'boss');
    if (boss) {
      ctx.fillStyle = '#0008'; ctx.fillRect(40, 92, FW - 80, 12);
      ctx.fillStyle = boss.hp < boss.maxHp * 0.35 ? '#ff4d6d' : '#c77dff';
      ctx.fillRect(42, 94, (FW - 84) * Math.max(0, boss.hp / boss.maxHp), 8);
    }

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.8 ? (2.2 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff'; ctx.font = '26px "Press Start 2P", monospace';
      ctx.shadowColor = '#3fd8ff'; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, FW / 2, FH * 0.4);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#3fd8ff'; ctx.font = '26px "Press Start 2P", monospace'; ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.restore();
  }

  function drawPlayer() {
    const { x, y } = player;
    ctx.save();
    ctx.translate(x, y);
    // engine flame
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath(); ctx.moveTo(-6, 16); ctx.lineTo(0, 30 + rand(0, 10)); ctx.lineTo(6, 16); ctx.fill();
    ctx.shadowColor = '#3fd8ff'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#dff7ff';
    ctx.beginPath();
    ctx.moveTo(0, -26); ctx.lineTo(8, -6); ctx.lineTo(22, 10); ctx.lineTo(22, 18); ctx.lineTo(8, 14); ctx.lineTo(0, 20); ctx.lineTo(-8, 14); ctx.lineTo(-22, 18); ctx.lineTo(-22, 10); ctx.lineTo(-8, -6);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#3fd8ff';
    ctx.beginPath(); ctx.ellipse(0, -4, 4, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff4d6d';
    ctx.fillRect(-20, 10, 4, 6); ctx.fillRect(16, 10, 4, 6);
    if (player.shield > 0) {
      ctx.strokeStyle = `rgba(63,216,255,${0.4 + 0.2 * player.shield})`; ctx.lineWidth = 2 + player.shield;
      ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.stroke();
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 2, 3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const col = e.hit > 0 ? '#ffffff' : e.color;
    ctx.fillStyle = col;
    ctx.shadowColor = e.color; ctx.shadowBlur = 12;
    if (e.type === 'drone') {
      ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(16, -6); ctx.lineTo(8, -14); ctx.lineTo(0, -6); ctx.lineTo(-8, -14); ctx.lineTo(-16, -6); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = '#1a0010'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
    } else if (e.type === 'swooper') {
      ctx.rotate(e.t * 5);
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 7 : 17; const a = (i / 8) * TAU; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(r, 0); } ctx.closePath(); ctx.fill();
    } else if (e.type === 'kamikaze') {
      ctx.rotate(e.locked ? Math.atan2(e.vy, e.vx) - Math.PI / 2 : 0);
      ctx.beginPath(); ctx.moveTo(0, 18); ctx.lineTo(12, -10); ctx.lineTo(0, -4); ctx.lineTo(-12, -10); ctx.closePath(); ctx.fill();
      if (e.locked) { ctx.fillStyle = '#ffd23f'; ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(0, -22 - rand(0, 8)); ctx.lineTo(5, -8); ctx.fill(); }
    } else if (e.type === 'gunship') {
      ctx.beginPath(); ctx.moveTo(0, 34); ctx.lineTo(30, 10); ctx.lineTo(36, -18); ctx.lineTo(12, -28); ctx.lineTo(-12, -28); ctx.lineTo(-36, -18); ctx.lineTo(-30, 10); ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#1a0a2a'; ctx.fillRect(-14, -8, 28, 18);
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(0, 2, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0008'; ctx.fillRect(-26, -40, 52, 5);
      ctx.fillStyle = '#7dff6a'; ctx.fillRect(-26, -40, 52 * Math.max(0, e.hp / e.maxHp), 5);
    } else if (e.type === 'boss') {
      const pulse = 1 + Math.sin(e.t * 4) * 0.03;
      ctx.scale(pulse, pulse);
      ctx.fillStyle = e.hit > 0 ? '#ffffff' : '#2a1640';
      ctx.shadowColor = '#c77dff'; ctx.shadowBlur = 30;
      ctx.beginPath();
      for (let i = 0; i < 12; i++) { const r = i % 2 ? 58 : 76; const a = (i / 12) * TAU + e.t * 0.3; i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = e.hp < e.maxHp * 0.35 ? '#ff4d6d' : '#ffd23f';
      ctx.beginPath(); ctx.arc(0, 0, 22 + Math.sin(e.t * 8) * 3, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(Math.cos(aim(e)) * 8, Math.sin(aim(e)) * 8, 9, 0, TAU); ctx.fill();
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
    set('lives', '▲'.repeat(Math.max(0, Math.min(lives, 8))));
    set('bombs', '●'.repeat(Math.max(0, Math.min(bombs, 9))));
    set('wave', `WAVE ${wave}${CLASSIC ? '/' + FINAL_WAVE : ''} · PWR ${player.level}`);
    set('chain', chain >= 10 ? `CHAIN ${chain} · x${1 + Math.min(9, Math.floor(chain / 10))}` : '');
    set('suits', SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join(''), true);
  }

  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); if (state === 'play') keys.add(KEYMAP[k]); }
    else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat) start();
    } else if ((k === 'x' || k === 'b' || k === 'shift') && !e.repeat) useBomb();
    else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => { const k = KEYMAP[e.key.toLowerCase()]; if (k) keys.delete(k); });
  window.addEventListener('blur', () => keys.clear());

  // Mouse: ship follows the pointer. Touch: relative drag so your finger doesn't cover the ship.
  const toField = (cx, cy) => ({ x: (cx - offX) / scale, y: (cy - offY) / scale });
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    const p = toField(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') { player.tx = p.x; player.ty = p.y; }
    else drag = { sx: p.x, sy: p.y, px: player.tx, py: player.ty, id: e.pointerId };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    const p = toField(e.clientX, e.clientY);
    if (e.pointerType === 'mouse') { player.tx = p.x; player.ty = p.y; }
    else if (drag && drag.id === e.pointerId) { player.tx = drag.px + (p.x - drag.sx) * 1.3; player.ty = drag.py + (p.y - drag.sy) * 1.3; }
  });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', useBomb);
  $('bomb-btn').addEventListener('pointerdown', (e) => { e.preventDefault(); useBomb(); });

  $('play-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(Daily.board('shooter') || (Arcade.classic ? 'shooter-classic' : 'shooter'), document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  $('again-btn').addEventListener('click', start);
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  newGame();
  wave = 0;
  enemies = [];
  schedule = [];
  banner = null;
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
