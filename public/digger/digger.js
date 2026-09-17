/* Digger: tunnel through layered soil, pump the monsters until they pop or drop a rock on them. */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, bindPadButtons, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const COLS = 14, ROWS = 15, TS = 40;
  const FW = COLS * TS;                 // the cave fills the width; the canvas grows to fit tall screens
  const FIELD_H = ROWS * TS;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('digger') || (CLASSIC ? 'digger-classic' : 'digger');
  const FINAL_LEVEL = 12;               // classic: clear twelve caves to win

  const DIRV = [[1, 0], [0, 1], [-1, 0], [0, -1]];      // right, down, left, up
  const DIRKEYS = ['right', 'down', 'left', 'up'];
  const START_C = 7, START_R = 3;
  const PUMP_POINTS = [200, 300, 400, 500];             // by soil layer
  const ROCK_POINTS = [1000, 2500, 4000];               // for 1 / 2 / 3+ enemies
  const BONUS_POINTS = [400, 600, 800, 1000, 2000, 3000, 4000, 5000];
  const MAX_HARPOON = TS * 2.4;

  // four soil layers, darkest and richest at the bottom
  const SOIL = [
    { base: '#b9743a', dark: '#8a5324', light: '#d99a5c' },
    { base: '#c0472e', dark: '#8f3120', light: '#e2704c' },
    { base: '#3a6cb6', dark: '#274b84', light: '#5f92d8' },
    { base: '#2b8f5b', dark: '#1a6740', light: '#4fb87b' },
  ];
  const CAVE = '#1c1009';
  const layerOf = (r) => (r <= 3 ? 0 : r <= 6 ? 1 : r <= 10 ? 2 : 3);

  // chunky pixel sprites: '.' is transparent, every other char is a palette key
  const PAL = {
    h: '#4aa8ff', g: '#16233f', f: '#ffd9a8', e: '#16233f', s: '#eef3ff', p: '#f4a259', b: '#2b3a67',
    r: '#ff4d4d', R: '#c22b2b', w: '#ffd23f', k: '#1b1030',
    d: '#3ddc6b', D: '#1f9b48', m: '#ffb03a', a: '#9aa0ad', A: '#6d7482', l: '#cfd6e2', n: '#454b5a',
  };
  const DIGGER_SIDE = [
    ['..hhhh..', '.hhhhhh.', '.gffffe.', '.gsssss.', 'ppsssss.', 'pssssss.', '..ss.ss.', '..bb.bb.'],
    ['..hhhh..', '.hhhhhh.', '.gffffe.', '.gsssss.', 'ppsssss.', 'pssssss.', '.ss...ss', '.bb...bb'],
  ];
  const DIGGER_FRONT = [
    ['..hhhh..', '.hhhhhh.', '.fefffe.', '.ffffff.', 'pssssssp', '.ssssss.', '..ss.ss.', '..bb.bb.'],
    ['..hhhh..', '.hhhhhh.', '.fefffe.', '.ffffff.', 'pssssssp', '.ssssss.', '.ss...ss', '.bb...bb'],
  ];
  const DIGGER_BACK = [
    ['..hhhh..', '.hhhhhh.', '.hhhhhh.', '.ssssss.', 'psssssss', 'pssssss.', '..ss.ss.', '..bb.bb.'],
    ['..hhhh..', '.hhhhhh.', '.hhhhhh.', '.ssssss.', 'psssssss', 'pssssss.', '.ss...ss', '.bb...bb'],
  ];
  const BLOB = [
    ['..RRRR..', '.RrrrrR.', 'RrwwwwrR', 'RrwkkwrR', 'RrwwwwrR', '.RrrrrR.', '.RrrrrR.', '.RR..RR.'],
    ['..RRRR..', '.RrrrrR.', 'RrwwwwrR', 'RrwkkwrR', 'RrwwwwrR', '.RrrrrR.', '.RrrrrR.', 'RR....RR'],
  ];
  const DRAGON = [
    ['....D..DD.', '..DdddddDD', '.DddddwkdD', 'DdddddddDD', 'Ddddddddmm', '.DdddddddD', '.dd.dd.dd.', '.D...D..D.'],
    ['....D..DD.', '..DdddddDD', '.DddddwkdD', 'DdddddddDD', 'Ddddddddmm', '.DdddddddD', 'dd..dd..dd', 'D...D...D.'],
  ];
  const ROCK = ['..nnnn..', '.nlaaan.', 'nlaaaaan', 'naaaaAan', 'naaAAAan', 'naAAAAAn', '.nAAAAn.', '..nnnn..'];

  // world randomness (caves, rocks, spawns, bonus timing) and enemy decisions get their own
  // seeded streams, so a daily's caves are the same for everyone whatever the player does
  let wrand = Math.random, arand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const ar = (a, b) => a + arand() * (b - a);

  let state = 'title';
  let paused = false;
  let dug, soil, soilCtx, player, enemies, rocks, particles, popups, bonus;
  let score, lives, level, kills, crushed, deepest, time, nextLifeAt;
  let harpoon, banner, flash, shake, clearT, bonusT, bonusCell, bonusCount, digSfxT;
  let high = store.get(Arcade.modeKey('digger.high'), 0);

  let FH = 780, fieldY = 90;
  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    // the cave keeps its size; a tall phone just gets more room for the pad below it
    FH = clamp(Math.round((FW * v.H) / v.W), FIELD_H + 170, FIELD_H + 620);
    fieldY = Math.round(clamp((FH - FIELD_H) * 0.42, 60, 160));
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    v.ctx.imageSmoothingEnabled = false;
  });
  const ctx = view.ctx;
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------
  function rrect(g, x, y, w, h, r) {
    if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); return; }
    g.beginPath(); g.rect(x, y, w, h);
  }
  function drawPix(g, rows, x, y, px, alt) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        g.fillStyle = (alt && alt[ch]) || PAL[ch] || '#fff';
        g.fillRect(x + c * px, y + r * px, px, px);
      }
    }
  }
  // each sprite is painted once into its own little canvas, then blitted
  const spriteCache = {};
  function baked(key, rows, alt) {
    let c = spriteCache[key];
    if (c) return c;
    c = document.createElement('canvas');
    c.width = rows[0].length * 4;
    c.height = rows.length * 4;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    drawPix(g, rows, 0, 0, 4, alt);
    spriteCache[key] = c;
    return c;
  }
  // sprites are baked facing right; mirror for left
  function drawSprite(g, img, cx, cy, px, flip) {
    const w = (img.width * px) / 4, h = (img.height * px) / 4;
    g.save();
    g.translate(cx, cy);
    if (flip) g.scale(-1, 1);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // The soil: one baked canvas that tunnels are erased from
  // ---------------------------------------------------------------------------
  const idx = (c, r) => r * COLS + c;
  const inGrid = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;
  const isDug = (c, r) => inGrid(c, r) && dug[idx(c, r)] === 1;
  const cellOf = (v) => Math.floor(v / TS);
  const centerOf = (c) => c * TS + TS / 2;

  function bakeSoil() {
    if (!soil) { soil = document.createElement('canvas'); soil.width = FW; soil.height = FIELD_H; }
    const g = soil.getContext('2d');
    soilCtx = g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, FW, FIELD_H);
    for (let r = 1; r < ROWS; r++) {
      const L = SOIL[layerOf(r)];
      g.fillStyle = L.base;
      g.fillRect(0, r * TS, FW, TS);
      // speckles of grit (cosmetic, so plain randomness is fine)
      for (let i = 0; i < 30; i++) {
        g.fillStyle = Math.random() < 0.5 ? L.dark : L.light;
        const w = 4 + Math.floor(Math.random() * 3) * 4;
        g.fillRect(Math.floor(Math.random() * (FW / 4)) * 4, r * TS + Math.floor(Math.random() * (TS / 4)) * 4, w, 4);
      }
      if (layerOf(r) !== layerOf(r - 1)) {
        g.fillStyle = L.dark; g.fillRect(0, r * TS, FW, 5);
        g.fillStyle = L.light; g.fillRect(0, r * TS + 5, FW, 2);
      }
    }
  }
  // erase a round-cornered bite out of the baked soil
  function bite(x, y, size) {
    const g = soilCtx;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    rrect(g, x - size / 2, y - size / 2, size, size, size * 0.32);
    g.fill();
    g.restore();
  }
  function carve(c, r) {
    if (!inGrid(c, r) || dug[idx(c, r)]) return false;
    dug[idx(c, r)] = 1;
    bite(centerOf(c), centerOf(r), TS);
    return true;
  }
  function carveRow(c0, c1, r) { for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) carve(c, r); }
  function carveCol(r0, r1, c) { for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) carve(c, r); }

  // ---------------------------------------------------------------------------
  // Level building
  // ---------------------------------------------------------------------------
  const enemyCount = () => (CLASSIC ? Math.min(8, 3 + Math.floor(level / 2)) : Math.min(9, 4 + Math.floor((level - 1) / 2)));
  const dragonCount = () => (CLASSIC ? Math.min(3, Math.floor(level / 4)) : Math.min(4, Math.floor((level + 2) / 3)));
  const enemySpeed = () => Math.min(96, (CLASSIC ? 46 : 48) + level * 2.4);
  const ghostSpeed = () => Math.min(64, 26 + level * 1.9);
  const ghostGap = () => Math.max(3.2, 11 - level * 0.55);

  function rockAt(c, r) { return rocks.find((k) => (k.state === 'set' || k.state === 'wobble') && k.c === c && k.r === r); }

  function buildLevel() {
    dug = new Uint8Array(COLS * ROWS);
    rocks = [];
    enemies = [];
    particles = []; popups = [];
    harpoon = null; bonus = null; bonusCount = 0;
    bakeSoil();
    for (let c = 0; c < COLS; c++) dug[idx(c, 0)] = 1;          // open sky along the top

    // the digger's own shaft down from the surface, plus a short side tunnel
    carveCol(0, START_R, START_C);
    carveRow(START_C - 1, START_C + 1, START_R);

    // starting tunnels: horizontal galleries joined by shafts, deeper as the levels go on
    const deep = Math.min(5, Math.floor(level / 3));
    const halls = Math.min(5, 3 + (level > 3 ? 1 : 0) + (level > 7 ? 1 : 0));
    for (let i = 0; i < halls; i++) {
      const r = clamp(Math.floor(wr(2 + deep, ROWS - 0.001)), 2, ROWS - 1);
      const c0 = Math.floor(wr(0, COLS - 3));
      carveRow(c0, Math.min(COLS - 1, c0 + Math.floor(wr(3, 8))), r);
    }
    for (let i = 0; i < 2 + (level > 5 ? 1 : 0); i++) {
      const c = Math.floor(wr(0, COLS));
      const r0 = Math.floor(wr(1, ROWS - 2));
      const r1 = clamp(r0 + Math.floor(wr(2, 6)), 1, ROWS - 1);
      carveCol(r0, r1, c);
    }

    // the bonus sits where the tunnels are most central
    const open = [];
    for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (dug[idx(c, r)]) open.push([c, r]);
    bonusCell = open.length
      ? open.reduce((best, p) => (Math.hypot(p[0] - (COLS - 1) / 2, p[1] - ROWS / 2) < Math.hypot(best[0] - (COLS - 1) / 2, best[1] - ROWS / 2) ? p : best), open[0])
      : [Math.floor(COLS / 2), Math.floor(ROWS / 2)];
    bonusT = wr(11, 17);

    // enemies live in the tunnels, well away from where the digger drops in, deepest first
    const total = enemyCount();
    const dragons = Math.min(total - 1, dragonCount());
    const spots = open
      .filter(([c, r]) => r >= 2 && Math.abs(c - START_C) + Math.abs(r - START_R) >= 5)
      .map(([c, r]) => [c, r, wrand()])
      .sort((a, b) => b[1] - a[1] || a[2] - b[2]);
    const picked = [];
    for (const [c, r] of spots) {
      if (picked.length >= total) break;
      if (picked.some(([pc, pr]) => Math.abs(pc - c) + Math.abs(pr - r) < 2)) continue;
      picked.push([c, r]);
    }
    let digs = 0;
    while (picked.length < total && digs++ < 120) {   // narrow caves: hollow out a pocket for the rest
      const c = Math.floor(wr(0, COLS)), r = Math.floor(wr(Math.min(ROWS - 4, 4 + deep), ROWS));
      if (picked.some(([pc, pr]) => pc === c && pr === r) || Math.abs(c - START_C) + Math.abs(r - START_R) < 5) continue;
      carve(c, r);
      carve(clamp(c + (wrand() < 0.5 ? -1 : 1), 0, COLS - 1), r);
      picked.push([c, r]);
    }
    picked.forEach(([c, r], i) => enemies.push(newEnemy(c, r, i < dragons ? 'dragon' : 'blob')));

    // rocks sit in untouched soil with room to fall
    const wanted = Math.min(7, 3 + Math.floor(level / 3));
    let tries = 0;
    while (rocks.length < wanted && tries++ < 200) {
      const c = Math.floor(wr(0, COLS)), r = Math.floor(wr(2, ROWS - 2));
      if (dug[idx(c, r)] || isDug(c, r + 1) || rockAt(c, r)) continue;   // nothing hanging over a tunnel at the start
      if (rocks.some((k) => Math.abs(k.c - c) <= 1 && Math.abs(k.r - r) <= 1)) continue;
      if (c === START_C && r <= START_R + 1) continue;
      rocks.push({ c, r, x: centerOf(c), y: centerOf(r), state: 'set', t: 0, vy: 0, hits: 0 });
    }
  }

  function newEnemy(c, r, type) {
    return {
      type, x: centerOf(c), y: centerOf(r), sc: c, sr: r, dir: 2, state: 'walk', cell: '',
      pump: 0, pumpT: 0, held: false, ghostT: ghostGap() * ar(0.7, 1.4), ghostFor: 0,
      fireT: ar(3, 6), fire: null, blocked: false, anim: ar(0, 3), dead: false,
    };
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('digger') : Math.random;
    arand = DAILY ? Daily.rng('digger') : Math.random;
    score = 0; lives = 3; level = 0; kills = 0; crushed = 0; deepest = 0; time = 0;
    nextLifeAt = 20000; flash = 0; shake = 0; clearT = 0; digSfxT = 0;
    player = { x: centerOf(START_C), y: centerOf(0), dir: 1, next: -1, alive: true, dying: 0, invuln: 1, anim: 0, moving: false };
    startLevel();
  }

  function startLevel() {
    if (CLASSIC && level >= FINAL_LEVEL) {
      addScore(lives * 1000);
      return endGame(true);
    }
    level++;
    buildLevel();
    resetPlayer();
    clearT = 0;
    banner = { text: CLASSIC ? `CAVE ${level}/${FINAL_LEVEL}` : `CAVE ${level}`, t: 0 };
    Sound.arp([196, 262, 330, 392], 0.09, 'triangle', 0.035);
  }

  function resetPlayer() {
    player.x = centerOf(START_C);
    player.y = centerOf(0);
    player.dir = 1; player.next = -1;
    player.alive = true; player.dying = 0; player.invuln = 1.2; player.moving = false;
    harpoon = null;
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
  // Scoring
  // ---------------------------------------------------------------------------
  function addScore(n, x, y, color) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: n.toLocaleString(), t: 0, c: color || '#fff' });
    if (score >= nextLifeAt) { nextLifeAt += 40000; lives++; toast('EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set(Arcade.modeKey('digger.high'), high); }
    return n;
  }

  function puff(x, y, color, n, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(20, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, t: 0, life: rand(0.25, 0.7), c: color, s: rand(3, 6) });
    }
  }

  // ---------------------------------------------------------------------------
  // Movement on the tunnel grid
  // ---------------------------------------------------------------------------
  function canEnter(c, r, who) {
    if (!inGrid(c, r)) return false;
    if (rockAt(c, r)) return false;
    return who === 'player' ? true : isDug(c, r);
  }
  // advance along one axis; the centre never passes the current cell's centre if the next cell is shut
  function advance(e, dir, dist, who) {
    const [dx, dy] = DIRV[dir];
    const c = cellOf(e.x), r = cellOf(e.y);
    let nx = e.x + dx * dist, ny = e.y + dy * dist;
    if (!canEnter(c + dx, r + dy, who)) {
      const cx = centerOf(c), cy = centerOf(r);
      if (dx > 0) nx = Math.min(nx, cx);
      if (dx < 0) nx = Math.max(nx, cx);
      if (dy > 0) ny = Math.min(ny, cy);
      if (dy < 0) ny = Math.max(ny, cy);
    }
    const moved = Math.abs(nx - e.x) > 0.001 || Math.abs(ny - e.y) > 0.001;
    e.x = nx; e.y = ny;
    return moved;
  }
  const overlap = (a, b, w = TS * 0.62) => Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < w;

  // ---------------------------------------------------------------------------
  // The digger
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let lastKeyDir = -1;

  function wantedDir() {
    if (lastKeyDir >= 0 && keys.has(DIRKEYS[lastKeyDir])) return lastKeyDir;
    for (let d = 0; d < 4; d++) if (keys.has(DIRKEYS[d])) return d;
    return -1;
  }

  function updatePlayer(dt) {
    if (!player.alive) {
      player.dying -= dt;
      if (player.dying <= 0) {
        if (lives <= 0) return endGame(false);
        for (const e of enemies) {
          e.x = centerOf(e.sc); e.y = centerOf(e.sr);
          e.state = 'walk'; e.pump = 0; e.held = false; e.fire = null; e.blocked = false;
          e.ghostT = ghostGap() * ar(0.7, 1.4);
        }
        rocks = rocks.filter((k) => k.state !== 'fall' && k.state !== 'gone');
        for (const k of rocks) if (k.state === 'wobble') { k.state = 'set'; k.t = 0; }
        resetPlayer();
      }
      return;
    }
    if (player.invuln > 0) player.invuln -= dt;

    const want = wantedDir();
    // while the harpoon has hold of something the digger stands still and pumps
    if (harpoon && harpoon.state === 'stuck') { player.moving = false; return; }

    if (want >= 0 && want !== player.dir) {
      const turning = want % 2 !== player.dir % 2;
      if (!turning) player.dir = want;
      else {
        // snap onto the lane once we are close enough to its centre, otherwise remember the turn
        const perpCell = want % 2 === 0 ? cellOf(player.y) : cellOf(player.x);
        const perpVal = want % 2 === 0 ? player.y : player.x;
        if (Math.abs(perpVal - centerOf(perpCell)) < 14) {
          if (want % 2 === 0) player.y = centerOf(perpCell); else player.x = centerOf(perpCell);
          player.dir = want;
          player.next = -1;
        } else player.next = want;
      }
    }
    if (player.next >= 0 && keys.has(DIRKEYS[player.next])) {
      const w = player.next;
      const perpCell = w % 2 === 0 ? cellOf(player.y) : cellOf(player.x);
      const perpVal = w % 2 === 0 ? player.y : player.x;
      if (Math.abs(perpVal - centerOf(perpCell)) < 8) {
        if (w % 2 === 0) player.y = centerOf(perpCell); else player.x = centerOf(perpCell);
        player.dir = w; player.next = -1;
      }
    }

    player.moving = want >= 0;
    if (player.moving) {
      const [dx, dy] = DIRV[player.dir];
      const ahead = isDug(cellOf(player.x) + dx, cellOf(player.y) + dy);
      const speed = ahead ? 118 : 70;                        // fresh soil is slow going
      const moved = advance(player, player.dir, speed * dt, 'player');
      if (moved) {
        player.anim += dt * (ahead ? 9 : 6);
        bite(player.x, player.y, TS);                        // the tunnel follows the digger
        const c = cellOf(player.x), r = cellOf(player.y);
        if (carve(c, r) && r > 0) {
          puff(player.x, player.y, SOIL[layerOf(r)].light, 4, 70);
          if (time - digSfxT > 0.13) { digSfxT = time; Sound.noise(0.08, 0.035, 0, 700); }
        }
        if (r > deepest) deepest = r;
      }
    }

    // bonus pickup
    if (bonus && overlap(player, bonus)) {
      const pts = BONUS_POINTS[Math.min(level - 1, BONUS_POINTS.length - 1)];
      addScore(pts, bonus.x, bonus.y, '#ffd23f');
      toast(`${bonus.name.toUpperCase()} +${pts.toLocaleString()}`);
      Sound.arp([660, 880, 1170, 1560], 0.06, 'triangle', 0.05);
      puff(bonus.x, bonus.y, '#ffd23f', 18, 180);
      bonus = null; bonusCount++; bonusT = wr(18, 26);
    }
  }

  function killPlayer(how) {
    if (!player.alive || player.invuln > 0 || state !== 'play') return;
    player.alive = false;
    player.dying = 1.5;
    lives--;
    flash = 0.25; shake = 0.5;
    harpoon = null;
    puff(player.x, player.y, '#eef3ff', 26, 240);
    Sound.noise(0.8, 0.18, 0, 600);
    Sound.tone(300, 60, 0.7, 'sawtooth', 0.05);
    if (how) toast(how);
  }

  // ---------------------------------------------------------------------------
  // Harpoon & pump
  // ---------------------------------------------------------------------------
  function fire() {
    if (harpoon || !player.alive || state !== 'play') return;
    harpoon = { dir: player.dir, len: 10, state: 'out', target: null, off: 0 };
    Sound.tone(900, 260, 0.1, 'square', 0.03);
  }

  function harpoonTip() {
    const [dx, dy] = DIRV[harpoon.dir];
    return { x: player.x + dx * harpoon.len, y: player.y + dy * harpoon.len };
  }

  function updateHarpoon(dt) {
    if (!harpoon) {
      if (keys.has('fire') && player.alive) fire();
      return;
    }
    if (harpoon.state === 'out') {
      harpoon.len += 560 * dt;
      const tip = harpoonTip();
      if (!isDug(cellOf(tip.x), cellOf(tip.y)) || harpoon.len > MAX_HARPOON) { harpoon.state = 'back'; return; }
      for (const e of enemies) {
        if (e.state === 'ghost' || e.dead) continue;
        if (Math.abs(e.x - tip.x) < TS * 0.45 && Math.abs(e.y - tip.y) < TS * 0.45) {
          harpoon.state = 'stuck';
          harpoon.target = e;
          harpoon.off = 0;
          e.held = true;
          e.fire = null;
          Sound.tone(500, 900, 0.08, 'square', 0.04);
          return;
        }
      }
      return;
    }
    if (harpoon.state === 'stuck') {
      const e = harpoon.target;
      if (!e || e.dead) { harpoon = null; return; }
      const [dx, dy] = DIRV[harpoon.dir];
      harpoon.len = Math.abs(dx) ? Math.abs(e.x - player.x) : Math.abs(e.y - player.y);
      if (harpoon.len > MAX_HARPOON + TS * 0.6) { detach(); return; }
      if (keys.has('fire')) {
        harpoon.off = 0;
        e.pumpT -= dt;
        if (e.pumpT <= 0) {
          e.pumpT = 0.34;
          e.pump++;
          Sound.tone(220 + e.pump * 90, 420 + e.pump * 110, 0.13, 'square', 0.04);
          puff(e.x, e.y, '#fff', 3, 60);
          if (e.pump >= (e.type === 'dragon' ? 4 : 3)) pop(e);
        }
      } else {
        harpoon.off += dt;
        if (harpoon.off > 0.5 || wantedDir() >= 0) detach();
      }
      return;
    }
    harpoon.len -= 900 * dt;
    if (harpoon.len <= 0) harpoon = null;
  }

  function detach() {
    if (harpoon && harpoon.target) { harpoon.target.held = false; harpoon.target.pumpT = 0.9; }
    if (harpoon) harpoon.state = 'back';
  }

  function pop(e) {
    e.dead = true;
    kills++;
    const pts = PUMP_POINTS[layerOf(clamp(cellOf(e.y), 0, ROWS - 1))];
    addScore(pts, e.x, e.y, e.type === 'dragon' ? '#3ddc6b' : '#ff7a7a');
    puff(e.x, e.y, e.type === 'dragon' ? '#3ddc6b' : '#ff4d4d', 22, 220);
    puff(e.x, e.y, '#fff', 8, 140);
    Sound.noise(0.18, 0.1, 0, 2400);
    Sound.tone(1200, 200, 0.18, 'square', 0.04);
    enemies = enemies.filter((x) => !x.dead);
    if (harpoon && harpoon.target === e) { harpoon.target = null; harpoon.state = 'back'; }
  }

  // ---------------------------------------------------------------------------
  // Enemies
  // ---------------------------------------------------------------------------
  function chooseDir(e, c, r) {
    const opts = [];
    for (let d = 0; d < 4; d++) if (canEnter(c + DIRV[d][0], r + DIRV[d][1], 'enemy')) opts.push(d);
    if (!opts.length) { e.ghostT = Math.min(e.ghostT, 0.3); return; }
    const back = (e.dir + 2) % 4;
    const fwd = opts.filter((d) => d !== back);
    const pool = fwd.length ? fwd : opts;
    let best = pool[0], bestD = Infinity;
    for (const d of pool) {
      const nx = centerOf(c + DIRV[d][0]), ny = centerOf(r + DIRV[d][1]);
      const dist = Math.hypot(nx - player.x, ny - player.y) + arand() * TS * 1.1;
      if (dist < bestD) { bestD = dist; best = d; }
    }
    e.dir = arand() < 0.12 ? pool[Math.floor(arand() * pool.length)] : best;
  }

  function startGhost(e) {
    e.state = 'ghost';
    e.ghostFor = 0;
    Sound.tone(160, 90, 0.35, 'sine', 0.02);
  }

  function updateEnemy(e, dt) {
    e.anim += dt * 5;
    if (e.held) return;
    if (e.pump > 0) {                     // inflated: stuck in place and deflating
      e.pumpT -= dt;
      if (e.pumpT <= 0) { e.pump--; e.pumpT = 0.9; }
      return;
    }
    if (e.state === 'flee') {
      const a = Math.atan2(TS * 0.6 - e.y, TS * 0.7 - e.x);
      const sp = enemySpeed() * 0.95;
      e.x += Math.cos(a) * sp * dt;
      e.y += Math.sin(a) * sp * dt;
      if (e.x < TS * 0.9 && e.y < TS * 1.1) {
        e.dead = true;
        enemies = enemies.filter((x) => !x.dead);
        toast('IT GOT AWAY!');
      }
      return;
    }
    if (e.state === 'ghost') {
      e.ghostFor += dt;
      const a = Math.atan2(player.y - e.y, player.x - e.x);
      const sp = ghostSpeed();
      e.x = clamp(e.x + Math.cos(a) * sp * dt, TS / 2, FW - TS / 2);
      e.y = clamp(e.y + Math.sin(a) * sp * dt, TS + TS / 2, FIELD_H - TS / 2);
      const c = cellOf(e.x), r = cellOf(e.y);
      if (e.ghostFor > 0.7 && (isDug(c, r) || e.ghostFor > 9)) {
        carve(c, r);
        e.x = centerOf(c); e.y = centerOf(r);
        e.state = 'walk'; e.cell = ''; e.blocked = false;
        e.ghostT = ghostGap() * ar(0.8, 1.5);
        puff(e.x, e.y, SOIL[layerOf(r)].light, 8, 90);
      }
      return;
    }

    // dragons stop to breathe fire down the tunnel
    if (e.type === 'dragon' && breathe(e, dt)) return;

    if (e.type === 'blob') {
      e.ghostT -= dt;
      if (e.ghostT <= 0) { startGhost(e); return; }
    }

    // pick the next turn once, on arriving at the middle of a new cell
    const c = cellOf(e.x), r = cellOf(e.y);
    const key = c + ',' + r;
    if ((e.cell !== key || e.blocked) && Math.abs(e.x - centerOf(c)) < 3 && Math.abs(e.y - centerOf(r)) < 3) {
      e.x = centerOf(c); e.y = centerOf(r);
      e.cell = key; e.blocked = false;
      chooseDir(e, c, r);
    }
    const moved = advance(e, e.dir, enemySpeed() * (e.type === 'dragon' ? 0.9 : 1) * dt, 'enemy');
    if (!moved) {
      e.blocked = true;
      if (e.type === 'dragon') e.ghostT -= dt * 3;           // a walled-in dragon gets desperate too
      if (e.ghostT <= 0) startGhost(e);
    }
  }

  function breathe(e, dt) {
    if (e.fire) {
      e.fire.t += dt;
      if (e.fire.phase === 'charge' && e.fire.t > 0.55) {
        e.fire = { phase: 'burn', t: 0, dir: e.dir };
        Sound.noise(0.6, 0.12, 0, 1400);
      } else if (e.fire.phase === 'burn') {
        const f = flameBox(e);
        if (f && player.alive && player.invuln <= 0 &&
            player.x + 12 > f.x && player.x - 12 < f.x + f.w && player.y + 12 > f.y && player.y - 12 < f.y + f.h) {
          killPlayer('BURNED!');
        }
        if (e.fire.t > 0.7) { e.fire = null; e.fireT = ar(3.5, 6.5) - Math.min(2, level * 0.1); }
      }
      return true;
    }
    e.fireT -= dt;
    if (e.fireT > 0) return false;
    const r = cellOf(e.y), pr = cellOf(player.y);
    const dir = player.x < e.x ? 2 : 0;
    if (r !== pr || !player.alive) { e.fireT = 0.4; return false; }
    // the flame only travels down a clear tunnel, so the digger has to be inside it
    const step = DIRV[dir][0];
    let reach = 0;
    for (let i = 1; i <= 3; i++) {
      const c = cellOf(e.x) + step * i;
      if (!isDug(c, r) || rockAt(c, r)) break;
      reach = i;
    }
    if (!reach || Math.abs(player.x - e.x) > (reach + 0.4) * TS) { e.fireT = 0.4; return false; }
    e.dir = dir;
    e.fire = { phase: 'charge', t: 0, dir };
    Sound.tone(120, 320, 0.5, 'sawtooth', 0.03);
    return true;
  }

  function flameBox(e) {
    if (!e.fire || e.fire.phase !== 'burn') return null;
    const dir = e.fire.dir;
    const step = DIRV[dir][0];
    const r = cellOf(e.y);
    let cells = 0;
    for (let i = 1; i <= 3; i++) {
      const c = cellOf(e.x) + step * i;
      if (!isDug(c, r) || rockAt(c, r)) break;
      cells = i;
    }
    if (!cells) return null;
    const grow = Math.min(1, e.fire.t / 0.18) * (e.fire.t > 0.5 ? Math.max(0, (0.7 - e.fire.t) / 0.2) : 1);
    const len = cells * TS * grow;
    if (len <= 2) return null;
    const x0 = step > 0 ? e.x + TS * 0.3 : e.x - TS * 0.3 - len;
    return { x: x0, y: e.y - TS * 0.28, w: len, h: TS * 0.56 };
  }

  // ---------------------------------------------------------------------------
  // Rocks
  // ---------------------------------------------------------------------------
  function updateRocks(dt) {
    for (const k of rocks) {
      if (k.state === 'set') {
        if (isDug(k.c, k.r + 1) && k.r + 1 < ROWS) { k.state = 'wobble'; k.t = 0; Sound.tone(260, 200, 0.12, 'triangle', 0.03); }
        continue;
      }
      if (k.state === 'wobble') {
        k.t += dt;
        if (k.t > 0.75) { k.state = 'fall'; k.vy = 60; k.hits = 0; }
        continue;
      }
      if (k.state === 'fall') {
        k.vy = Math.min(460, k.vy + 900 * dt);
        k.y += k.vy * dt;
        const c = cellOf(k.x), r = cellOf(k.y);
        k.c = c; k.r = r;
        bite(k.x, k.y, TS);
        carve(c, r);
        for (const e of enemies) {
          if (e.dead || e.state === 'ghost') continue;
          if (Math.abs(e.x - k.x) < TS * 0.6 && Math.abs(e.y - k.y) < TS * 0.65) {
            e.dead = true;
            k.hits++;
            crushed++;
            puff(e.x, e.y, e.type === 'dragon' ? '#3ddc6b' : '#ff4d4d', 18, 200);
            if (harpoon && harpoon.target === e) { harpoon.target = null; harpoon.state = 'back'; }
          }
        }
        if (k.hits) enemies = enemies.filter((e) => !e.dead);
        if (player.alive && player.invuln <= 0 && Math.abs(player.x - k.x) < TS * 0.55 && Math.abs(player.y - k.y) < TS * 0.6) killPlayer('SQUASHED!');
        if (k.y + TS / 2 >= FIELD_H) { land(k); }
        continue;
      }
      if (k.state === 'break') { k.t += dt; if (k.t > 0.45) k.state = 'gone'; }
    }
    rocks = rocks.filter((k) => k.state !== 'gone');
  }

  function land(k) {
    k.state = 'break';
    k.t = 0;
    k.y = FIELD_H - TS / 2;
    shake = Math.max(shake, 0.35);
    Sound.noise(0.4, 0.16, 0, 500);
    for (let i = 0; i < 16; i++) {
      const a = rand(Math.PI, TAU);
      particles.push({ x: k.x, y: k.y, vx: Math.cos(a) * rand(60, 220), vy: Math.sin(a) * rand(40, 180), t: 0, life: rand(0.3, 0.8), c: i % 2 ? '#9aa0ad' : '#6d7482', s: rand(3, 7) });
    }
    if (k.hits > 0) {
      const pts = ROCK_POINTS[Math.min(k.hits, 3) - 1];
      addScore(pts, k.x, k.y - TS, '#ffd23f');
      toast(k.hits > 1 ? `${k.hits} CRUSHED! +${pts.toLocaleString()}` : `CRUSHED! +${pts.toLocaleString()}`);
      Sound.arp([392, 523, 659, 880], 0.07, 'square', 0.05);
    }
  }

  // ---------------------------------------------------------------------------
  // Bonus vegetables
  // ---------------------------------------------------------------------------
  const BONUS_KINDS = [
    { name: 'Carrot', draw: (g) => { g.fillStyle = '#f4a259'; g.beginPath(); g.moveTo(-7, -6); g.lineTo(7, -6); g.lineTo(0, 11); g.closePath(); g.fill(); g.fillStyle = '#3ddc6b'; g.fillRect(-6, -12, 4, 7); g.fillRect(0, -13, 4, 8); } },
    { name: 'Tomato', draw: (g) => { g.fillStyle = '#ff4d4d'; g.beginPath(); g.arc(0, 2, 9, 0, TAU); g.fill(); g.fillStyle = '#3ddc6b'; g.fillRect(-7, -8, 14, 3); g.fillRect(-2, -12, 4, 5); } },
    { name: 'Eggplant', draw: (g) => { g.fillStyle = '#9b5de5'; g.beginPath(); g.ellipse(0, 3, 7, 10, 0, 0, TAU); g.fill(); g.fillStyle = '#3ddc6b'; g.fillRect(-6, -9, 12, 4); } },
    { name: 'Pineapple', draw: (g) => { g.fillStyle = '#ffd23f'; g.fillRect(-7, -4, 14, 14); g.fillStyle = '#c99b14'; for (let i = -6; i < 7; i += 4) g.fillRect(i, -4, 2, 14); g.fillStyle = '#3ddc6b'; g.fillRect(-5, -12, 3, 8); g.fillRect(-1, -14, 3, 10); g.fillRect(3, -12, 3, 8); } },
  ];

  function spawnBonus() {
    const [c, r] = bonusCell;
    carve(c, r);
    const kind = BONUS_KINDS[Math.floor(wrand() * BONUS_KINDS.length)];
    bonus = { x: centerOf(c), y: centerOf(r), t: 0, life: 12, name: kind.name, draw: kind.draw };
    Sound.arp([523, 784], 0.09, 'triangle', 0.04);
    toast(`${kind.name.toUpperCase()} IN THE CAVE!`);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    time += dt;
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; p.vx *= 0.97; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    if (flash > 0) flash -= dt;
    if (shake > 0) shake -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2) banner = null; }
    if (state !== 'play') return;

    updatePlayer(dt);
    if (state !== 'play') return;
    if (clearT > 0) {
      clearT -= dt;
      if (clearT <= 0) startLevel();
      return;
    }
    updateHarpoon(dt);
    for (const e of enemies) updateEnemy(e, dt);
    updateRocks(dt);

    // the last one alive bolts for the surface at the top left
    if (enemies.length === 1 && kills > 0) {
      const e = enemies[0];
      if (e.state !== 'flee' && !e.held && !e.pump) {
        e.fleeT = (e.fleeT || 1.6) - dt;
        if (e.fleeT <= 0) { e.state = 'flee'; e.fire = null; toast('IT IS RUNNING!'); }
      }
    }

    // contact
    if (player.alive && player.invuln <= 0) {
      for (const e of enemies) {
        if (e.pump > 0 || e.held) continue;
        if (overlap(player, e, TS * 0.56)) { killPlayer(e.type === 'dragon' ? 'THE DRAGON GOT YOU!' : 'A BLOB GOT YOU!'); break; }
      }
    }

    // bonus timing
    if (!bonus && bonusCount < 3 && enemies.length) {
      bonusT -= dt;
      if (bonusT <= 0) spawnBonus();
    } else if (bonus) {
      bonus.t += dt;
      if (bonus.t > bonus.life) { bonus = null; bonusCount++; bonusT = wr(18, 26); }
    }

    // cave cleared
    if (!enemies.length && clearT <= 0) {
      clearT = 1.9;
      banner = { text: 'CAVE CLEARED!', t: 0 };
      Sound.arp([523, 659, 784, 1046], 0.08, 'square', 0.045);
    }
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-level').textContent = CLASSIC ? `${Math.min(level, FINAL_LEVEL)}/${FINAL_LEVEL}` : level;
    $('o-popped').textContent = kills.toLocaleString();
    $('o-crushed').textContent = crushed.toLocaleString();
    Arcade.endScreen(won, won ? 'Twelve caves cleared. The soil is yours!' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawDigger() {
    if (!player.alive && player.dying <= 0) return;
    if (!player.alive) {
      // a puff of dust and a spinning helmet
      const t = 1.5 - player.dying;
      ctx.save();
      ctx.translate(player.x, player.y - t * 20);
      ctx.rotate(t * 6);
      ctx.globalAlpha = Math.max(0, 1 - t / 1.5);
      drawPix(ctx, ['..hhhh..', '.hhhhhh.', '.hhhhhh.'], -16, -6, 4);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2) return;
    const frame = player.moving ? Math.floor(player.anim) % 2 : 0;
    const set = player.dir === 1 ? 'front' : player.dir === 3 ? 'back' : 'side';
    const rows = (set === 'front' ? DIGGER_FRONT : set === 'back' ? DIGGER_BACK : DIGGER_SIDE)[frame];
    drawSprite(ctx, baked('dig-' + set + frame, rows), player.x, player.y, 4, player.dir === 2);
  }

  function drawEnemy(e) {
    const inflate = 1 + e.pump * 0.26;
    const px = 4 * inflate;
    const ghost = e.state === 'ghost';
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.42 + Math.sin(time * 8) * 0.08;
    const frame = Math.floor(e.anim) % 2;
    let img;
    if (e.type === 'dragon') {
      const lit = !!(e.fire && e.fire.phase === 'charge' && Math.floor(e.fire.t * 14) % 2);
      img = baked('dragon' + frame + (lit ? '-lit' : ''), DRAGON[frame], lit ? { d: '#bdf5cf', D: '#4de07f' } : null);
    } else {
      img = baked('blob' + frame + (e.pump ? '-fat' : ''), BLOB[frame], e.pump ? { r: '#ff8f8f', R: '#e04a4a' } : null);
    }
    drawSprite(ctx, img, e.x, e.y, px, e.dir === 2);
    if (e.pump) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, TS * 0.42 * inflate, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    const f = flameBox(e);
    if (f) {
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ['#ffd23f', '#ff8f2e', '#ff4d1a'][i];
        const inset = i * 3;
        const wob = Math.sin(time * 40 + i) * 2;
        ctx.fillRect(f.x, f.y + inset + wob, f.w, Math.max(2, f.h - inset * 2));
      }
    }
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0b0603';
    ctx.fillRect(0, 0, W, H);
    const sx = shake > 0 ? rand(-3, 3) * shake : 0;
    const sy = shake > 0 ? rand(-3, 3) * shake : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (offX + sx), DPR * (offY + sy));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(0, fieldY);
    ctx.beginPath(); ctx.rect(-4, -4, FW + 8, FIELD_H + 8); ctx.clip();

    // sky above the ground and the dark cave behind the soil
    const sky = ctx.createLinearGradient(0, 0, 0, TS);
    sky.addColorStop(0, '#221545'); sky.addColorStop(1, '#4a2b52');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, FW, TS);
    ctx.fillStyle = '#ffffff55';
    for (let i = 0; i < 9; i++) ctx.fillRect(((i * 97) % FW) + 5, 6 + ((i * 37) % 18), 2, 2);
    ctx.fillStyle = CAVE;
    ctx.fillRect(0, TS, FW, FIELD_H - TS);
    if (soil) ctx.drawImage(soil, 0, 0);
    ctx.fillStyle = '#3ddc6b';
    ctx.fillRect(0, TS - 5, FW, 5);
    ctx.fillStyle = '#2b8f5b';
    for (let x = 0; x < FW; x += 8) ctx.fillRect(x, TS - 8, 4, 3);

    // rocks
    for (const k of rocks) {
      if (k.state === 'break') {
        ctx.globalAlpha = Math.max(0, 1 - k.t / 0.45);
        ctx.drawImage(baked('rock-bits', ROCK.slice(4)), k.x - 16, k.y - 8);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.save();
      ctx.translate(k.x, k.y);
      if (k.state === 'wobble') ctx.rotate(Math.sin(k.t * 34) * 0.14);
      ctx.drawImage(baked('rock', ROCK), -16, -16);
      ctx.restore();
    }

    // bonus
    if (bonus) {
      const fade = bonus.t > bonus.life - 3 ? (Math.floor(bonus.t * 6) % 2 ? 0.35 : 1) : 1;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(bonus.x, bonus.y + Math.sin(time * 3) * 2);
      ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 14;
      bonus.draw(ctx);
      ctx.restore();
    }

    // harpoon
    if (harpoon && player.alive) {
      const [dx, dy] = DIRV[harpoon.dir];
      const len = Math.max(0, harpoon.len);
      ctx.fillStyle = '#d7dbe6';
      if (dx) ctx.fillRect(Math.min(player.x, player.x + dx * len), player.y - 2, len, 4);
      else ctx.fillRect(player.x - 2, Math.min(player.y, player.y + dy * len), 4, len);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(player.x + dx * len - 4, player.y + dy * len - 4, 8, 8);
    }

    for (const e of enemies) drawEnemy(e);
    drawDigger();

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.9);
      ctx.fillStyle = p.c;
      ctx.fillText(p.text, p.x, p.y - p.t * 36);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // frame around the cave
    ctx.strokeStyle = '#f4a25966';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, fieldY - 1, FW - 2, FIELD_H + 2);

    if (banner) {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.6 ? (2 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = '22px "Press Start 2P", monospace';
      ctx.shadowColor = '#f4a259'; ctx.shadowBlur = 18;
      ctx.fillText(banner.text, FW / 2, fieldY + FIELD_H * 0.45);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,120,60,${Math.min(0.5, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000b';
      ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#f4a259';
      ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < FH; y += 4) ctx.fillRect(0, y, FW, 1);
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '▮'.repeat(Math.max(0, Math.min(lives || 0, 6))));
    set('level', state === 'title' ? '' : `CAVE ${level}${CLASSIC ? '/' + FINAL_LEVEL : ''}`);
    set('foes', state === 'title' ? '' : `ENEMIES ${enemies.length}`);
    set('depth', state === 'title' ? '' : `DEPTH ${player && player.alive ? Math.max(0, cellOf(player.y)) : 0}`);
  }

  const KEYMAP = {
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) {
      e.preventDefault();
      if (state === 'play') { keys.add(KEYMAP[k]); lastKeyDir = DIRKEYS.indexOf(KEYMAP[k]); }
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat) start();
      else if (state === 'play') { if (paused) paused = false; keys.add('fire'); }
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { keys.delete(KEYMAP[k]); if (lastKeyDir === DIRKEYS.indexOf(KEYMAP[k])) lastKeyDir = -1; }
    if (k === ' ' || k === 'enter') keys.delete('fire');
  });
  window.addEventListener('blur', () => { keys.clear(); lastKeyDir = -1; });

  bindPadButtons(keys);
  document.querySelectorAll('[data-key]').forEach((b) => {
    b.addEventListener('pointerdown', () => { const d = DIRKEYS.indexOf(b.dataset.key); if (d >= 0) lastKeyDir = d; });
  });
  canvas.addEventListener('pointerdown', () => { if (state === 'play' && paused) paused = false; });

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // title-screen legend
  [['lg-blob', BLOB[0], 3], ['lg-dragon', DRAGON[0], 3], ['lg-rock', ROCK, 3]].forEach(([id, rows, px]) => {
    const c = $(id);
    if (!c) return;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    drawPix(g, rows, Math.floor((c.width - rows[0].length * px) / 2), Math.floor((c.height - rows.length * px) / 2), px);
  });
  if ($('lg-bonus')) {
    const g = $('lg-bonus').getContext('2d');
    g.save(); g.translate(15, 16); BONUS_KINDS[0].draw(g); g.restore();
  }

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'digger',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, score, lives, level, enemies: enemies ? enemies.length : 0,
        depth: player ? Math.max(0, cellOf(player.y)) : 0,
        layer: player ? layerOf(clamp(cellOf(player.y), 0, ROWS - 1)) : 0,
        deepest, kills, crushed, rocks: rocks ? rocks.length : 0,
        falling: rocks ? rocks.filter((k) => k.state === 'fall').length : 0,
        bonus: bonus ? bonus.name : null, harpoon: harpoon ? harpoon.state : null,
        pump: harpoon && harpoon.target ? harpoon.target.pump : 0,
        ghosts: enemies ? enemies.filter((e) => e.state === 'ghost').length : 0,
        dragons: enemies ? enemies.filter((e) => e.type === 'dragon').length : 0,
        playerX: player ? Math.round(player.x) : 0, playerY: player ? Math.round(player.y) : 0,
        tunnels: dug ? dug.reduce((n, v) => n + v, 0) : 0, time: Math.round(time),
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'lives') lives = v;
        else if (k === 'level') { level = v - 1; startLevel(); }
        else if (k === 'enemies') enemies = enemies.slice(0, v);
      },
      press: (k) => { keys.add(k); const d = DIRKEYS.indexOf(k); if (d >= 0) lastKeyDir = d; },
      release: (k) => { keys.delete(k); if (lastKeyDir === DIRKEYS.indexOf(k)) lastKeyDir = -1; },
      moveTo: (c, r) => { c = clamp(c, 0, COLS - 1); r = clamp(r, 0, ROWS - 1); player.x = centerOf(c); player.y = centerOf(r); carve(c, r); },
      foes: () => enemies.map((e) => ({ type: e.type, x: Math.round(e.x), y: Math.round(e.y), state: e.state, pump: e.pump, fire: e.fire ? e.fire.phase : null })),
      stones: () => rocks.map((k) => ({ c: k.c, r: k.r, state: k.state, hits: k.hits })),
      pop: (n = 99) => { for (const e of enemies.slice(0, n)) pop(e); },
      win: () => {
        if (!CLASSIC) return false;
        level = FINAL_LEVEL;
        enemies = [];
        clearT = 0;
        startLevel();
        return true;
      },
    };
  }

  // a quiet cave sits behind the title screen
  newGame();
  state = 'title';
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
