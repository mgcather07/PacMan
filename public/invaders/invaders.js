(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const SPR = window.InvaderSprites;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600;
  // the sky stretches to fill tall screens (phones), so nothing is wasted above the invaders
  let FH = 840, PLAYER_Y = FH - 80, GROUND_Y = FH - 44, BUNKER_Y = PLAYER_Y - 120;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('invaders') || (CLASSIC ? 'invaders-classic' : 'invaders');
  const FINAL_WAVE = 10; // classic: clear ten waves to win
  const SUITS = ['♠', '♥', '♦', '♣'];
  const PX = 3; // sprite pixel size
  const COLS = 11, CELL_W = 46, CELL_H = 40;
  const BUNKER_COLS = 22, BUNKER_ROWS = 16, BUNKER_CELL = 3;
  const COLORS = { squid: '#ff5ecf', crab: '#3fd8ff', octo: '#39ff14', diver: '#ffb347', armor: '#ffd23f' };
  const POINTS = { squid: 30, crab: 20, octo: 10, diver: 40 };
  const HEARTBEAT = [98, 87, 78, 73];

  // world randomness (formations, UFO timing, bombs) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const pick = (arr) => arr[Math.floor(wrand() * arr.length)];


  let state = 'title';
  let paused = false;
  let player, invaders, shots, bombs, drops, particles, popups, bunkers, stars, ufo, mother;
  let score, lives, wave, suits, kills, fired, hits, nextLifeAt, time;
  let group, stepT, beat, bombT, ufoT, diveT, banner, flash, waveClearT, landed;
  let power; // { rapid: seconds, double: seconds, shield: hits }
  let high = store.get(Arcade.modeKey('invaders.high'), 0);

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    // capped so a very tall screen doesn't hand players a longer runway in the daily challenge
    FH = clamp(Math.round((FW * v.H) / v.W), 720, 1000);
    PLAYER_Y = FH - 80;
    GROUND_Y = FH - 44;
    BUNKER_Y = PLAYER_Y - 120;
    if (bunkers) for (const b of bunkers) b.y = BUNKER_Y;
    if (stars) for (const s of stars) s.y = Math.min(s.y, GROUND_Y);
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
    for (let i = 0; i < 90; i++) stars.push({ x: rand(0, FW), y: rand(0, GROUND_Y), s: rand(0.5, 1.8), tw: rand(0, TAU) });
  }

  function makeBunker(cx) {
    const cells = [];
    for (let r = 0; r < BUNKER_ROWS; r++) {
      const row = [];
      for (let c = 0; c < BUNKER_COLS; c++) {
        const topCut = r < 4 && (c < 4 - r || c > BUNKER_COLS - 5 + r);
        const arch = r >= 11 && c >= 6 && c <= BUNKER_COLS - 7 && !(r === 11 && (c === 6 || c === BUNKER_COLS - 7));
        row.push(!topCut && !arch);
      }
      cells.push(row);
    }
    return { x: Math.round(cx - (BUNKER_COLS * BUNKER_CELL) / 2), y: BUNKER_Y, cells };
  }
  const makeBunkers = () => [1, 2, 3, 4].map((i) => makeBunker((FW * i) / 5));

  function newGame() {
    wrand = DAILY ? Daily.rng('invaders') : Math.random;
    player = { x: FW / 2, tx: FW / 2, alive: true, respawn: 0, invuln: 0, reload: 0 };
    shots = []; bombs = []; drops = []; particles = []; popups = [];
    score = 0; lives = 3; wave = 0; suits = [false, false, false, false];
    kills = 0; fired = 0; hits = 0; nextLifeAt = 15000; time = 0; flash = 0; landed = false;
    power = { rapid: 0, double: 0, shield: 0 };
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
  // Waves & formations
  // ---------------------------------------------------------------------------
  const mult = () => (CLASSIC ? 1 : 1 + (wave - 1) * 0.1);
  const isMotherWave = () => !CLASSIC && wave % 5 === 0;

  // which grid cells are filled for a formation
  function layout(kind, rows) {
    const on = (r, c) => {
      switch (kind) {
        case 'checker': return (r + c) % 2 === 0;
        case 'diamond': { const mid = (COLS - 1) / 2; return Math.abs(c - mid) <= Math.min(r + 1, rows - r) + 1.5; }
        case 'wings': return c <= 3 || c >= COLS - 4;
        case 'arrow': { const mid = (COLS - 1) / 2; return Math.abs(c - mid) >= r - 1 || r === 0; }
        case 'columns': return c % 3 !== 1;
        default: return true;
      }
    };
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) if (on(r, c)) cells.push([r, c]);
    return cells;
  }

  function startWave() {
    if (CLASSIC && wave >= FINAL_WAVE) {
      addScore(lives * 1000);
      return endGame(true);
    }
    wave++;
    const mothership = isMotherWave();
    const rows = mothership ? 3 : CLASSIC ? 5 : 5 + (wave >= 10 ? 1 : 0);
    const kinds = ['classic', 'checker', 'diamond', 'wings', 'arrow', 'columns'];
    const kind = CLASSIC || wave === 1 ? 'classic' : mothership ? pick(['classic', 'checker', 'wings']) : pick(kinds);
    const armorChance = CLASSIC ? 0 : Math.min(0.35, Math.max(0, (wave - 2) * 0.05));
    const diverChance = CLASSIC ? 0 : wave >= 4 ? Math.min(0.2, 0.06 + wave * 0.01) : 0;
    // start height follows the field height, so a tall phone screen isn't an easy ride
    const top = Math.round(FH * 0.17);
    const startY = CLASSIC ? top + Math.min(wave - 1, 6) * 22 : (mothership ? top + 70 : top + ((wave - 1) % 5) * 16);
    group = { x: (FW - COLS * CELL_W) / 2, y: startY, dir: 1, frame: 0, total: 0 };
    invaders = [];
    for (const [r, c] of layout(kind, rows)) {
      const type = r === 0 ? 'squid' : r <= Math.floor(rows / 2) ? 'crab' : 'octo';
      const diver = wrand() < diverChance;
      const armored = !diver && wrand() < armorChance;
      invaders.push({
        type: diver ? 'diver' : type, row: r, col: c, hp: armored ? 2 : 1, armored, alive: true,
        dive: null, x: 0, y: 0,
      });
    }
    group.total = invaders.length;
    positionInvaders();
    mother = mothership ? { x: FW / 2, y: 118, dir: 1, hp: 24 + wave * 4, maxHp: 24 + wave * 4, fireT: 2, hit: 0, t: 0 } : null;
    bunkers = makeBunkers();
    shots = []; bombs = [];
    ufo = null;
    stepT = 0; beat = 0; bombT = 1.5; ufoT = wr(14, 22); diveT = wr(5, 8); waveClearT = 0;
    banner = { text: mothership ? `WAVE ${wave} · MOTHERSHIP` : CLASSIC ? `WAVE ${wave}/${FINAL_WAVE}` : `WAVE ${wave}`, t: 0 };
    Sound.arp(mothership ? [220, 196, 175, 147] : [392, 523, 659], mothership ? 0.18 : 0.09, mothership ? 'sawtooth' : 'square', 0.035);
  }

  const spriteOf = (inv) => SPR[inv.type][group.frame];
  function slotPos(inv) {
    const spr = SPR[inv.type][0];
    return { x: group.x + inv.col * CELL_W + (CELL_W - spr.w * PX) / 2, y: group.y + inv.row * CELL_H };
  }
  function positionInvaders() {
    for (const inv of invaders) {
      if (inv.dive) continue;
      const p = slotPos(inv);
      inv.x = p.x; inv.y = p.y;
    }
  }
  const alive = () => invaders.filter((i) => i.alive);

  // ---------------------------------------------------------------------------
  // Scoring, drops, damage
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    const pts = Math.round((n * mult()) / 10) * 10 || n;
    score += pts;
    if (x !== undefined) popups.push({ x, y, text: String(pts), t: 0 });
    if (score >= nextLifeAt) { nextLifeAt += 15000; lives++; toast('EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set(Arcade.modeKey('invaders.high'), high); }
    return pts;
  }

  function explode(x, y, color, n, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(30, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.25, 0.7), c: Math.random() < 0.3 ? '#fff' : color, s: rand(2, 4) });
    }
  }

  function dropItem(x, y, types) {
    const type = pick(types);
    drops.push({ x, y, type, suit: Math.floor(wrand() * 4), t: 0 });
  }

  function killInvader(inv) {
    inv.alive = false;
    kills++;
    const w = SPR[inv.type][0].w * PX;
    const base = POINTS[inv.type] * (inv.armored ? 2 : 1) * (inv.dive ? 2 : 1);
    addScore(base, inv.x + w / 2, inv.y);
    particles.push({ burst: true, x: inv.x + w / 2, y: inv.y + 12, t: 0, life: 0.22, c: inv.armored ? COLORS.armor : COLORS[inv.type] });
    explode(inv.x + w / 2, inv.y + 12, COLORS[inv.type], 10);
    Sound.noise(0.12, 0.07, 0, 2200);
    if (!CLASSIC && Math.random() < 0.02) dropItem(inv.x + w / 2, inv.y + 12, ['rapid', 'double', 'shield', 'card']);
    else if (Math.random() < 0.012) dropItem(inv.x + w / 2, inv.y + 12, ['card']);
  }

  function hitPlayer() {
    if (!player.alive || player.invuln > 0) return;
    if (power.shield > 0) {
      power.shield--;
      player.invuln = 0.8;
      explode(player.x, PLAYER_Y + 10, '#3fd8ff', 22);
      Sound.tone(900, 200, 0.3, 'sawtooth', 0.04);
      toast(power.shield ? `SHIELD ×${power.shield}` : 'SHIELD DOWN');
      return;
    }
    player.alive = false;
    player.respawn = 1.6;
    lives--;
    flash = 0.25;
    power.rapid = 0; power.double = 0;
    explode(player.x, PLAYER_Y + 10, COLORS.octo, 50, 320);
    Sound.noise(0.9, 0.2, 0, 700);
    bombs = [];
    if (lives <= 0) setTimeout(() => { if (state === 'play') endGame(false); }, 1200);
  }

  function collect(d) {
    Sound.arp([660, 990, 1320], 0.05, 'triangle', 0.05);
    addScore(100);
    if (d.type === 'rapid') { power.rapid = 12; toast('RAPID FIRE'); }
    else if (d.type === 'double') { power.double = 12; toast('DOUBLE SHOT'); }
    else if (d.type === 'shield') { power.shield = Math.min(3, power.shield + 1); toast('SHIELD'); }
    else if (d.type === 'card') {
      if (suits[d.suit]) { toast(`Another ${SUITS[d.suit]}: +250`); addScore(250); return; }
      suits[d.suit] = true;
      if (suits.every(Boolean)) { suits = [false, false, false, false]; lives++; toast('♠♥♦♣ FULL SUIT SET: EXTRA LIFE!'); }
      else toast(`Found ${SUITS[d.suit]} (${suits.filter(Boolean).length}/4 suits)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Bunkers
  // ---------------------------------------------------------------------------
  function bunkerCell(x, y) {
    for (const b of bunkers) {
      const c = Math.floor((x - b.x) / BUNKER_CELL), r = Math.floor((y - b.y) / BUNKER_CELL);
      if (c >= 0 && c < BUNKER_COLS && r >= 0 && r < BUNKER_ROWS && b.cells[r][c]) return { b, r, c };
    }
    return null;
  }
  function chip(hit, radius) {
    const { b, r, c } = hit;
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= BUNKER_ROWS || cc < 0 || cc >= BUNKER_COLS) continue;
        if (Math.hypot(dr, dc) <= radius + 0.3 && Math.random() < 0.8 - Math.hypot(dr, dc) * 0.15) b.cells[rr][cc] = false;
      }
    }
    b.cells[r][c] = false;
  }
  function eraseRect(x, y, w, h) {
    for (const b of bunkers) {
      if (x + w < b.x || x > b.x + BUNKER_COLS * BUNKER_CELL || y + h < b.y || y > b.y + BUNKER_ROWS * BUNKER_CELL) continue;
      for (let r = 0; r < BUNKER_ROWS; r++) {
        for (let c = 0; c < BUNKER_COLS; c++) {
          const cx = b.x + c * BUNKER_CELL, cy = b.y + r * BUNKER_CELL;
          if (cx + BUNKER_CELL > x && cx < x + w && cy + BUNKER_CELL > y && cy < y + h) b.cells[r][c] = false;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let pointerFire = false;

  function fire() {
    if (!player.alive || player.reload > 0) return;
    const maxVolleys = power.rapid > 0 ? 3 : 1;
    const volleys = new Set(shots.map((s) => s.volley)).size;
    if (volleys >= maxVolleys) return;
    const volley = Math.random();
    const speed = power.rapid > 0 ? 980 : CLASSIC ? 720 : 820;
    const xs = power.double > 0 ? [-10, 10] : [0];
    for (const dx of xs) shots.push({ x: player.x + dx, y: PLAYER_Y - 6, vy: -speed, volley });
    fired++;
    player.reload = power.rapid > 0 ? 0.12 : 0.22;
    Sound.tone(1400, 500, 0.08, 'square', 0.02);
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-wave').textContent = CLASSIC ? `${Math.min(wave, FINAL_WAVE)}/${FINAL_WAVE}` : wave;
    $('o-kills').textContent = kills.toLocaleString();
    $('o-acc').textContent = fired ? `${Math.round((hits / fired) * 100)}%` : '—';
    Arcade.endScreen(won, won ? 'All ten waves repelled. The Earth is safe!' : landed ? 'The invaders landed.' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  function update(dt) {
    time += dt;
    for (const s of stars) s.tw += dt * 2;
    for (const p of particles) { p.t += dt; if (!p.burst) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; } }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    if (flash > 0) flash -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2) banner = null; }
    if (state !== 'play') return;

    // player
    if (player.alive) {
      const sp = 360 * dt;
      if (keys.has('left')) player.tx = player.x - 40;
      if (keys.has('right')) player.tx = player.x + 40;
      if (!keys.has('left') && !keys.has('right') && (keys.has('kbd'))) player.tx = player.x;
      player.tx = clamp(player.tx, 24, FW - 24);
      player.x += clamp(player.tx - player.x, -sp, sp);
      if (player.invuln > 0) player.invuln -= dt;
      if (player.reload > 0) player.reload -= dt;
      if (keys.has('fire') || pointerFire) fire();
    } else if (lives > 0) {
      player.respawn -= dt;
      if (player.respawn <= 0) Object.assign(player, { alive: true, invuln: 1.8, x: FW / 2, tx: FW / 2 });
    }
    if (power.rapid > 0) power.rapid -= dt;
    if (power.double > 0) power.double -= dt;

    const living = alive();
    const formation = living.filter((i) => !i.dive);

    // formation march: fewer invaders → faster steps
    const speedUp = CLASSIC ? 1 + (wave - 1) * 0.05 : 1 + (wave - 1) * 0.07;
    const ratio = group.total ? formation.length / group.total : 0;
    const interval = Math.max(0.018, (0.03 + 0.62 * Math.pow(ratio, 1.5)) / speedUp);
    stepT += dt;
    if (formation.length && stepT >= interval) {
      stepT = 0;
      group.frame ^= 1;
      Sound.tone(HEARTBEAT[beat % 4], HEARTBEAT[beat % 4] * 0.9, 0.09, 'square', 0.05);
      beat++;
      let minX = Infinity, maxX = -Infinity;
      for (const inv of formation) { const p = slotPos(inv); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + SPR[inv.type][0].w * PX); }
      const stepX = 9;
      if ((group.dir > 0 && maxX + stepX > FW - 14) || (group.dir < 0 && minX - stepX < 14)) {
        group.y += 20;
        group.dir *= -1;
      } else group.x += group.dir * stepX;
      positionInvaders();
    }

    // invaders chew through bunkers and land
    for (const inv of formation) {
      const spr = SPR[inv.type][0];
      if (inv.y + spr.h * PX >= BUNKER_Y) eraseRect(inv.x, inv.y, spr.w * PX, spr.h * PX);
      if (inv.y + spr.h * PX >= PLAYER_Y) { landed = true; lives = 0; player.alive = false; explode(player.x, PLAYER_Y + 10, COLORS.octo, 50, 320); Sound.noise(1.2, 0.25, 0, 500); endGame(false); return; }
    }

    // divers peel off and swoop at the player, then fly back to their slot
    if (!CLASSIC && wave >= 4) {
      diveT -= dt;
      if (diveT <= 0) {
        diveT = wr(3.5, 7) / Math.min(2, 1 + wave * 0.03);
        const candidates = formation.filter((i) => i.type === 'diver');
        if (candidates.length) {
          const inv = pick(candidates);
          inv.dive = { t: 0, phase: 'down', vx: 0, amp: wr(60, 140), fired: false, sx: inv.x };
          Sound.tone(300, 900, 0.3, 'sawtooth', 0.02);
        }
      }
    }
    for (const inv of living) {
      if (!inv.dive) continue;
      const d = inv.dive;
      d.t += dt;
      if (d.phase === 'down') {
        const targetX = player.x - 16;
        d.sx += clamp(targetX - d.sx, -140 * dt, 140 * dt);
        inv.x = d.sx + Math.sin(d.t * 3) * d.amp * Math.min(1, d.t);
        inv.y += (230 + wave * 6) * dt;
        if (!d.fired && inv.y > 320) { d.fired = true; dropBomb(inv.x + 16, inv.y + 24, 'plunger'); }
        if (player.alive && player.invuln <= 0 && Math.abs(inv.x + 16 - player.x) < 30 && Math.abs(inv.y + 12 - (PLAYER_Y + 10)) < 26) { killInvader(inv); hitPlayer(); continue; }
        if (inv.y > FH + 20) { d.phase = 'back'; inv.y = -40; }
      } else {
        const p = slotPos(inv);
        inv.x += (p.x - inv.x) * Math.min(1, dt * 3);
        inv.y += (p.y - inv.y) * Math.min(1, dt * 3);
        if (Math.hypot(p.x - inv.x, p.y - inv.y) < 3) inv.dive = null;
      }
    }

    // invader bombs
    bombT -= dt;
    const maxBombs = Math.min(8, (CLASSIC ? 3 : 3 + Math.floor(wave / 3)));
    if (bombT <= 0 && formation.length) {
      bombT = Math.max(CLASSIC ? 0.45 : 0.32, (CLASSIC ? 1.25 : 1.3) - wave * (CLASSIC ? 0.06 : 0.07)) * wr(0.6, 1.3);
      if (bombs.length < maxBombs) {
        const cols = [...new Set(formation.map((i) => i.col))];
        const nearest = cols.reduce((best, c) => {
          const inv = formation.find((i) => i.col === c);
          const d = Math.abs(slotPos(inv).x + 16 - player.x);
          return d < best.d ? { c, d } : best;
        }, { c: cols[0], d: Infinity }).c;
        const col = wrand() < 0.45 ? nearest : pick(cols);
        const shooter = formation.filter((i) => i.col === col).sort((a, b) => b.row - a.row)[0];
        const spr = SPR[shooter.type][0];
        dropBomb(shooter.x + (spr.w * PX) / 2, shooter.y + spr.h * PX, pick(['zig', 'plunger', 'roll']));
      }
    }
    const bombSpeed = Math.min(430, (CLASSIC ? 220 : 240) + wave * 9);
    for (const b of bombs) {
      b.t += dt;
      b.y += (b.vy || bombSpeed) * dt;
      if (b.vx) b.x += b.vx * dt;
      const hit = bunkerCell(b.x, b.y + 8);
      if (hit) { chip(hit, 2); b.dead = true; continue; }
      if (player.alive && Math.abs(b.x - player.x) < 20 && b.y + 10 > PLAYER_Y && b.y < PLAYER_Y + 24) { b.dead = true; hitPlayer(); continue; }
      if (b.y > GROUND_Y) { b.dead = true; explode(b.x, GROUND_Y, '#39ff14', 4, 60); }
    }
    bombs = bombs.filter((b) => !b.dead);

    // player shots
    for (const s of shots) {
      s.y += s.vy * dt;
      if (s.y < 40) { s.dead = true; continue; }
      const hit = bunkerCell(s.x, s.y);
      if (hit) { chip(hit, 1); s.dead = true; continue; }
      for (const b of bombs) if (Math.abs(b.x - s.x) < 7 && Math.abs(b.y - s.y) < 14) { b.dead = true; s.dead = true; explode(s.x, s.y, '#fff', 6, 90); addScore(5); break; }
      if (s.dead) continue;
      if (ufo && Math.abs(s.x - (ufo.x + 24)) < 26 && Math.abs(s.y - (ufo.y + 10)) < 14) { s.dead = true; hits++; killUfo(); continue; }
      if (mother && s.x > mother.x - 36 && s.x < mother.x + 36 && s.y > mother.y - 2 && s.y < mother.y + 30) {
        s.dead = true; hits++;
        mother.hp--; mother.hit = 0.08;
        explode(s.x, s.y, '#ff3b5c', 4, 100);
        if (mother.hp <= 0) killMother();
        continue;
      }
      for (const inv of living) {
        if (!inv.alive) continue;
        const spr = SPR[inv.type][0];
        if (s.x >= inv.x - 2 && s.x <= inv.x + spr.w * PX + 2 && s.y >= inv.y && s.y <= inv.y + spr.h * PX) {
          s.dead = true; hits++;
          inv.hp--;
          if (inv.hp <= 0) killInvader(inv);
          else { inv.armored = false; explode(s.x, s.y, COLORS.armor, 6, 90); Sound.tone(700, 400, 0.06, 'square', 0.03); }
          break;
        }
      }
    }
    shots = shots.filter((s) => !s.dead);

    // mystery UFO
    if (!mother) {
      ufoT -= dt;
      if (ufoT <= 0 && !ufo && formation.length > 6) {
        const dir = wrand() < 0.5 ? 1 : -1;
        ufo = { x: dir > 0 ? -50 : FW + 2, y: 96, dir, value: pick([50, 100, 150, 300]) };
        ufoT = wr(15, 25);
      }
    }
    if (ufo) {
      ufo.x += ufo.dir * 150 * dt;
      if (Math.floor(time * 10) % 3 === 0) Sound.tone(620 + Math.sin(time * 30) * 80, 600, 0.05, 'sine', 0.012);
      if (ufo.x < -60 || ufo.x > FW + 10) ufo = null;
    }

    // mothership
    if (mother) {
      mother.t += dt;
      if (mother.hit > 0) mother.hit -= dt;
      mother.x += mother.dir * (70 + wave * 3) * dt;
      if (mother.x > FW - 50 || mother.x < 50) mother.dir *= -1;
      mother.fireT -= dt;
      if (mother.fireT <= 0) {
        mother.fireT = Math.max(0.9, 2 - wave * 0.03);
        const spread = mother.hp < mother.maxHp * 0.4 ? [-150, -75, 0, 75, 150] : [-90, 0, 90];
        for (const vx of spread) bombs.push({ x: mother.x, y: mother.y + 30, vx, vy: 260, kind: 'orb', t: 0 });
        Sound.tone(180, 90, 0.25, 'sawtooth', 0.04);
      }
    }

    // drops
    for (const d of drops) {
      d.t += dt;
      d.y += 150 * dt;
      if (player.alive && Math.abs(d.x - player.x) < 30 && Math.abs(d.y - (PLAYER_Y + 10)) < 26) { d.got = true; collect(d); }
    }
    drops = drops.filter((d) => !d.got && d.y < GROUND_Y);

    // wave cleared
    if (!living.length && !mother) {
      waveClearT += dt;
      if (waveClearT === dt) {
        if (!CLASSIC) { addScore(500 + wave * 100); toast(`WAVE ${wave} CLEARED! +${(Math.round(((500 + wave * 100) * mult()) / 10) * 10).toLocaleString()}`); }
        else toast(`WAVE ${wave} CLEARED!`);
        Sound.arp([523, 659, 784, 1046], 0.08, 'square', 0.04);
      }
      if (waveClearT > 1.6) startWave();
    }
  }

  function dropBomb(x, y, kind) {
    bombs.push({ x, y, kind, t: 0 });
  }

  function killUfo() {
    const pts = addScore(ufo.value, ufo.x + 24, ufo.y + 6);
    popups[popups.length - 1].text = String(pts);
    explode(ufo.x + 24, ufo.y + 10, '#ff3b5c', 26, 240);
    Sound.arp([880, 660, 990, 1320], 0.06, 'square', 0.05);
    dropItem(ufo.x + 24, ufo.y + 10, CLASSIC ? ['card'] : ['rapid', 'double', 'shield', 'card']);
    ufo = null;
  }

  function killMother() {
    const tier = wave / 5;
    addScore(1500 * tier, mother.x, mother.y);
    explode(mother.x, mother.y + 14, '#ff3b5c', 90, 380);
    explode(mother.x, mother.y + 14, '#ffd23f', 50, 260);
    flash = 0.5;
    Sound.noise(1.4, 0.25, 0, 500);
    for (let i = 0; i < 3; i++) dropItem(mother.x + (i - 1) * 50, mother.y + 20, i === 0 ? ['shield'] : ['rapid', 'double', 'card']);
    toast(`MOTHERSHIP DESTROYED!`);
    mother = null;
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

    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#02030a'); bg.addColorStop(1, '#06120a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    for (const s of stars) { ctx.globalAlpha = 0.35 + Math.sin(s.tw) * 0.25; ctx.fillStyle = '#cfe'; ctx.fillRect(s.x, s.y, s.s, s.s); }
    ctx.globalAlpha = 1;
    if (!invaders) { ctx.restore(); return; }

    // ground
    ctx.fillStyle = '#39ff14';
    ctx.fillRect(0, GROUND_Y, FW, 3);

    // bunkers
    ctx.fillStyle = '#39ff14';
    for (const b of bunkers) {
      for (let r = 0; r < BUNKER_ROWS; r++) {
        const row = b.cells[r];
        for (let c = 0; c < BUNKER_COLS; c++) if (row[c]) ctx.fillRect(b.x + c * BUNKER_CELL, b.y + r * BUNKER_CELL, BUNKER_CELL, BUNKER_CELL);
      }
    }

    // invaders
    for (const inv of invaders) {
      if (!inv.alive) continue;
      const col = inv.armored ? COLORS.armor : COLORS[inv.type];
      ctx.shadowColor = col; ctx.shadowBlur = 8;
      SPR.draw(ctx, spriteOf(inv), Math.round(inv.x), Math.round(inv.y), PX, col);
      if (inv.armored) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1;
        const spr = SPR[inv.type][0];
        ctx.strokeRect(Math.round(inv.x) - 2.5, Math.round(inv.y) - 2.5, spr.w * PX + 5, spr.h * PX + 5);
      }
    }
    ctx.shadowBlur = 0;

    // UFO and mothership
    if (ufo) { ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 14; SPR.draw(ctx, SPR.ufo, Math.round(ufo.x), ufo.y, 3, '#ff3b5c'); ctx.shadowBlur = 0; }
    if (mother) {
      const w = SPR.mothership.w * 3;
      ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = 22;
      SPR.draw(ctx, SPR.mothership, Math.round(mother.x - w / 2), mother.y, 3, mother.hit > 0 ? '#fff' : '#ff3b5c');
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffd23f';
      if (Math.floor(mother.t * 6) % 2) for (let i = 0; i < 4; i++) ctx.fillRect(mother.x - w / 2 + 12 + i * 15, mother.y + 12, 6, 3);
      ctx.fillStyle = '#0008'; ctx.fillRect(60, 84, FW - 120, 8);
      ctx.fillStyle = mother.hp < mother.maxHp * 0.4 ? '#ff4d6d' : '#ffd23f';
      ctx.fillRect(62, 86, (FW - 124) * Math.max(0, mother.hp / mother.maxHp), 4);
    }

    // bombs
    for (const b of bombs) {
      if (b.kind === 'orb') {
        ctx.fillStyle = '#ff3b5c';
        ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, TAU); ctx.fill();
        continue;
      }
      ctx.fillStyle = '#fff';
      const f = Math.floor(b.t * 12) % 4;
      if (b.kind === 'zig') { for (let i = 0; i < 5; i++) ctx.fillRect(b.x - 1 + (((i + f) % 2) ? 2 : -2), b.y + i * 3, 3, 3); }
      else if (b.kind === 'plunger') { ctx.fillRect(b.x - 1, b.y, 3, 14); ctx.fillRect(b.x - 4, b.y + (f < 2 ? 0 : 11), 9, 3); }
      else { ctx.fillRect(b.x - 1, b.y, 3, 14); ctx.fillRect(b.x + (f % 2 ? -4 : 2), b.y + 5, 3, 3); }
    }

    // player shots
    ctx.fillStyle = power.rapid > 0 ? '#ffd23f' : '#fff';
    for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 12, 3, 12);

    // drops
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const d of drops) {
      const col = { rapid: '#ffd23f', double: '#ff4d6d', shield: '#3fd8ff', card: '#ffffff' }[d.type];
      ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.sin(d.t * 4) * 0.25);
      ctx.shadowColor = col; ctx.shadowBlur = 14;
      ctx.fillStyle = d.type === 'card' ? '#fbfbff' : '#0a0a1a';
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-13, -13, 26, 26, 6); else ctx.rect(-13, -13, 26, 26);
      ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
      if (d.type === 'card') { ctx.fillStyle = d.suit === 1 || d.suit === 2 ? '#e0153a' : '#111'; ctx.font = '19px serif'; ctx.fillText(SUITS[d.suit], 0, 1); }
      else { ctx.fillStyle = col; ctx.font = '11px "Press Start 2P", monospace'; ctx.fillText({ rapid: 'R', double: '2', shield: 'S' }[d.type], 1, 2); }
      ctx.restore();
    }

    // player
    if (player.alive && state !== 'title' && !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2)) {
      const w = SPR.cannon.w * PX;
      ctx.shadowColor = '#39ff14'; ctx.shadowBlur = 12;
      SPR.draw(ctx, SPR.cannon, Math.round(player.x - w / 2), PLAYER_Y, PX, '#39ff14');
      ctx.shadowBlur = 0;
      if (power.shield > 0) {
        ctx.strokeStyle = `rgba(63,216,255,${0.35 + 0.2 * power.shield})`; ctx.lineWidth = 1.5 + power.shield;
        ctx.beginPath(); ctx.arc(player.x, PLAYER_Y + 14, 34, Math.PI, TAU); ctx.stroke();
      }
    }

    // explosions
    for (const p of particles) {
      if (p.burst) { const w = SPR.burst.w * PX; SPR.draw(ctx, SPR.burst, Math.round(p.x - w / 2), Math.round(p.y - 10), PX, p.c); continue; }
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of popups) { ctx.globalAlpha = 1 - p.t / 0.8; ctx.fillStyle = '#fff'; ctx.fillText(p.text, p.x, p.y - p.t * 40); }
    ctx.globalAlpha = 1;

    // reserve cannons on the ground line
    for (let i = 0; i < Math.min(lives - (player.alive ? 1 : 0), 6); i++) SPR.draw(ctx, SPR.cannon, 16 + i * 30, GROUND_Y + 12, 2, '#39ff14');

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.6 ? (2 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff'; ctx.font = '24px "Press Start 2P", monospace';
      ctx.shadowColor = '#39ff14'; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, FW / 2, FH * 0.52);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#39ff14'; ctx.font = '26px "Press Start 2P", monospace'; ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    // scanlines
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
    const set = (id, v, html) => { if (last[id] !== v) { last[id] = v; html ? ($(id).innerHTML = v) : ($(id).textContent = v); } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '▲'.repeat(Math.max(0, Math.min(lives, 8))));
    set('wave', state === 'title' ? '' : `WAVE ${wave}${CLASSIC ? '/' + FINAL_WAVE : ''}`);
    const pw = [power.rapid > 0 ? `RAPID ${Math.ceil(power.rapid)}` : '', power.double > 0 ? `DOUBLE ${Math.ceil(power.double)}` : '', power.shield ? `SHIELD ×${power.shield}` : ''].filter(Boolean).join(' · ');
    set('power', pw);
    set('suits', SUITS.map((s, i) => `<span class="suit ${suits[i] ? 'got' : ''} ${i === 1 || i === 2 ? 'red' : ''}">${s}</span>`).join(''), true);
  }

  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); if (state === 'play') { keys.add(KEYMAP[k]); keys.add('kbd'); } }
    else if (k === ' ' || k === 'arrowup' || k === 'w' || k === 'enter') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat && (k === ' ' || k === 'enter')) start();
      else if (state === 'play') { if (paused) paused = false; keys.add('fire'); }
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
    if (k === ' ' || k === 'arrowup' || k === 'w' || k === 'enter') keys.delete('fire');
  });
  window.addEventListener('blur', () => { keys.clear(); pointerFire = false; });

  // Mouse: the cannon follows the pointer, hold the button to fire.
  // Touch: drag anywhere to move (relative, so your finger doesn't cover the cannon) and keep firing while touching.
  const toField = (cx) => (cx - offX) / scale;
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    keys.delete('kbd');
    if (e.pointerType === 'mouse') { player.tx = toField(e.clientX); pointerFire = true; }
    else { drag = { sx: toField(e.clientX), px: player.tx, id: e.pointerId }; pointerFire = true; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse') { keys.delete('kbd'); player.tx = toField(e.clientX); }
    else if (drag && drag.id === e.pointerId) player.tx = drag.px + (toField(e.clientX) - drag.sx) * 1.4;
  });
  const endPointer = (e) => { if (!drag || drag.id === e.pointerId) { drag = null; pointerFire = false; } };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  const fireBtn = $('fire-btn');
  fireBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); keys.add('fire'); fireBtn.classList.add('on'); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => fireBtn.addEventListener(t, () => { keys.delete('fire'); fireBtn.classList.remove('on'); }));

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // title-screen legend sprites
  [['lg-squid', SPR.squid[0], COLORS.squid], ['lg-crab', SPR.crab[0], COLORS.crab], ['lg-octo', SPR.octo[0], COLORS.octo], ['lg-ufo', SPR.ufo, '#ff3b5c']].forEach(([id, spr, col]) => {
    const c = $(id);
    const x = c.getContext('2d');
    SPR.draw(x, spr, Math.floor((c.width - spr.w) / 2), Math.floor((c.height - spr.h) / 2), 1, col);
  });

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'invaders',
      peek: () => ({ state, paused, score, lives, wave, kills, alive: alive().length, shots: shots.length, bombs: bombs.length, drops: drops.length, playerX: player.x, ufo: !!ufo, mother: mother && mother.hp, power: { ...power }, suits: suits.filter(Boolean).length }),
      // advance the game without waiting for animation frames (they stop when the tab is hidden)
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      press: (k) => keys.add(k),
      release: (k) => keys.delete(k),
      moveTo: (x) => { player.tx = x; player.x = x; },
      set: (k, v) => { if (k === 'wave') { wave = v - 1; startWave(); } else if (k === 'lives') lives = v; else if (k === 'score') score = v; else if (k === 'power') Object.assign(power, v); },
      kill: (n = 999) => { for (const inv of alive().slice(0, n)) killInvader(inv); },
      dropAt: (type) => dropItem(player.x, PLAYER_Y - 60, [type]),
      start,
    };
  }

  // attract mode behind the title screen: the first formation marching
  newGame();
  let lastT = performance.now();
  let attractT = 0;
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    if (state === 'title') {
      attractT += dt;
      if (attractT > 0.35) { attractT = 0; group.frame ^= 1; group.x += group.dir * 9; if (group.x > 40 || group.x < 0) group.dir *= -1; positionInvaders(); }
    }
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
