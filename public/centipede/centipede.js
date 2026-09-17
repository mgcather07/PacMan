(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Pixel sprites (same idea as public/invaders/sprites.js, kept local to the game)
  // ---------------------------------------------------------------------------
  const parse = (rows) => ({ w: rows[0].length, h: rows.length, rows });
  const SPR = {
    head: [parse([
      '#......#',
      '.#....#.',
      '..####..',
      '.##..##.',
      '########',
      '##.##.##',
      '.######.',
      '..#..#..',
    ]), parse([
      '.#....#.',
      '..#..#..',
      '..####..',
      '.##..##.',
      '########',
      '##.##.##',
      '.######.',
      '.#....#.',
    ])],
    body: [parse([
      '..####..',
      '.######.',
      '########',
      '##.##.##',
      '########',
      '.######.',
      '#.#..#.#',
      '..#..#..',
    ]), parse([
      '..####..',
      '.######.',
      '########',
      '##.##.##',
      '########',
      '.######.',
      '.#.##.#.',
      '#......#',
    ])],
    // mushrooms wear down as they take hits: four sprites, four colours
    mush: [parse([
      '........',
      '........',
      '........',
      '..####..',
      '..####..',
      '...##...',
      '...##...',
      '..####..',
    ]), parse([
      '........',
      '........',
      '.#.##.#.',
      '.######.',
      '.######.',
      '...##...',
      '...##...',
      '..####..',
    ]), parse([
      '........',
      '.######.',
      '##.##.##',
      '########',
      '.######.',
      '...##...',
      '...##...',
      '..####..',
    ]), parse([
      '..####..',
      '.######.',
      '##.##.##',
      '########',
      '.######.',
      '...##...',
      '...##...',
      '..####..',
    ])],
    spider: [parse([
      '#.........#',
      '.#...#...#.',
      '..#.###.#..',
      '.#.#####.#.',
      '#.##.#.##.#',
      '..#######..',
      '.#.#...#.#.',
      '#..#...#..#',
    ]), parse([
      '..#.....#..',
      '#..#...#..#',
      '.#.#####.#.',
      '..#######..',
      '.###.#.###.',
      '#.#######.#',
      '..#.....#..',
      '.#.......#.',
    ])],
    flea: [parse([
      '..###..',
      '.#####.',
      '#######',
      '##.#.##',
      '#######',
      '.#.#.#.',
      '#.#.#.#',
      '..#.#..',
    ]), parse([
      '..###..',
      '.#####.',
      '#######',
      '##.#.##',
      '#######',
      '#.#.#.#',
      '.#.#.#.',
      '.#...#.',
    ])],
    scorp: [parse([
      '.........##.',
      '..#.....#..#',
      '.#.#...#..#.',
      '#####.###.#.',
      '.##########.',
      '#.##.##.##.#',
      '.#..#..#..#.',
    ]), parse([
      '.........##.',
      '..#.....#..#',
      '.#.#...#..#.',
      '#####.###.#.',
      '.##########.',
      '.#.##.##.##.',
      '#..#..#..#..',
    ])],
    gun: parse([
      '....#....',
      '...###...',
      '...###...',
      '.#######.',
      '#########',
      '##.###.##',
      '#########',
      '#.#...#.#',
    ]),
    burst: parse([
      '#...#..#...#',
      '.#..#..#..#.',
      '..#......#..',
      '##........##',
      '..#......#..',
      '.#..#..#..#.',
      '#...#..#...#',
    ]),
  };

  // run-length pixel blitter
  function sprite(c, s, x, y, px, color) {
    c.fillStyle = color;
    for (let r = 0; r < s.h; r++) {
      const row = s.rows[r];
      let start = -1;
      for (let i = 0; i <= row.length; i++) {
        if (row[i] === '#') { if (start < 0) start = i; } else if (start >= 0) {
          c.fillRect(x + start * px, y + r * px, (i - start) * px, px);
          start = -1;
        }
      }
    }
  }
  const drawAt = (c, s, x, y, px, color) => sprite(c, s, Math.round(x - (s.w * px) / 2), Math.round(y - (s.h * px) / 2), px, color);

  // ---------------------------------------------------------------------------
  // Field
  // ---------------------------------------------------------------------------
  const FW = 600, COLS = 20, ROWS = 26, CELL = 30, PX = 3;
  const FIELD_TOP = 76;        // the HUD lives above this
  const ZONE_ROWS = 6;         // rows the gun may roam in
  const ZONE_ROW = ROWS - ZONE_ROWS;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('centipede') || (CLASSIC ? 'centipede-classic' : 'centipede');
  const FINAL_WAVE = 12;       // classic: clear twelve waves to win
  const PTS = { body: 10, head: 100, mush: 1, flea: 200, scorp: 1000, restore: 5 };
  const COL = {
    head: '#ff4d6d', body: '#b4f000', spider: '#c46bff', flea: '#3fd8ff', scorp: '#ffd23f',
    gun: '#b4f000', shot: '#ffffff', poison: '#e05bff',
  };
  const MUSH_COL = ['#ff4d6d', '#ff9f45', '#ffd23f', '#b4f000']; // by hits left: 1 → 4

  // the garden is always the same 20 x 26 cells: only the height of a row stretches, so every
  // screen plays exactly the same game (and a tall phone still fills its screen)
  let FH = 1000, ROWH = 30, FLOOR = 0, ZONE_Y = 0;

  // world randomness (mushroom field, creature timing, centipede entries) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);

  let state = 'title';
  let paused = false;
  let grid, centipedes, creatures, shots, particles, popups, blades, player;
  let score, lives, wave, time, fired, hits, segsKilled, nextLifeAt;
  let spiderT, fleaT, scorpT, headT, clearT, cleared, banner, flash, chirpT;
  let high = store.get(Arcade.modeKey('centipede.high'), 0);

  const cx = (c) => c * CELL + CELL / 2;
  const cy = (r) => FIELD_TOP + r * ROWH + ROWH / 2;
  const colAt = (x) => Math.floor(x / CELL);
  const rowAt = (y) => Math.floor((y - FIELD_TOP) / ROWH);
  const inGrid = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const mushAt = (r, c) => (inGrid(r, c) ? grid[r][c] : null);

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    // rows stretch to fill the window, and everything that crosses the field moves with them
    ROWH = clamp(((FW * v.H) / v.W - FIELD_TOP - 8) / ROWS, 25, 52);
    FH = Math.round(FIELD_TOP + ROWS * ROWH + 8);
    FLOOR = FIELD_TOP + ROWS * ROWH;
    ZONE_Y = cy(ZONE_ROW) - ROWH / 2;
    if (player) { aim(player.tx, player.ty); player.y = clamp(player.y, ZONE_Y + 14, FLOOR - 14); }
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------
  function makeField() {
    grid = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(null));
    // thinner cover in the rows the gun lives in, so there is somewhere to stand
    for (let r = 1; r < ROWS - 1; r++) {
      const density = r >= ZONE_ROW ? 0.04 : 0.085;
      for (let c = 0; c < COLS; c++) if (wrand() < density) grid[r][c] = { hp: 4, poison: false, pop: 0 };
    }
  }

  // grass specks, kept as a fraction of the field so they still fill it after a resize
  function makeBlades() {
    blades = [];
    for (let i = 0; i < 70; i++) blades.push({ x: rand(0, FW), f: rand(0, 1), s: rand(0.6, 1.9), tw: rand(0, TAU) });
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('centipede') : Math.random;
    score = 0; lives = 3; wave = 0; time = 0; fired = 0; hits = 0; segsKilled = 0;
    nextLifeAt = 12000; flash = 0; chirpT = 0; banner = null;
    centipedes = []; creatures = []; shots = []; particles = []; popups = [];
    player = { x: FW / 2, y: 0, tx: FW / 2, ty: 0, alive: true, respawn: 0, invuln: 0, reload: 0 };
    makeField();
    makeBlades();
    resetGun();
    startWave();
  }

  function resetGun() {
    player.x = player.tx = FW / 2;
    player.y = player.ty = FLOOR - CELL * 1.4;
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
  const mult = () => (CLASSIC ? 1 : 1 + (wave - 1) * 0.1);
  // a taller row means a longer field, so everything that crosses it moves proportionally faster:
  // the swarm takes the same time to reach the gun on a phone as on a desktop
  const pace = () => ROWH / 30;
  const segSpeed = () => CELL * Math.min(11, 6 + wave * 0.35);
  const segsLeft = () => centipedes.reduce((n, c) => n + c.segs, 0);

  // a centipede enters from one side, its tail still off the field
  function spawnCentipede(len, row, delay = 0, extra) {
    const fromLeft = wrand() < 0.5;
    const path = [];
    for (let i = 0; i <= len; i++) {
      const col = fromLeft ? -(len + delay) + i : COLS - 1 + len + delay - i;
      path.push({ x: cx(col), y: cy(row), s: i * CELL });
    }
    centipedes.push(Object.assign({
      path, d: len * CELL, segs: len, dir: fromLeft ? 1 : -1, vdir: 1,
      poison: false, bottom: false, fast: 1, frame: 0, ft: 0, pts: [],
    }, extra));
  }

  function startWave() {
    if (CLASSIC && wave >= FINAL_WAVE) {
      addScore(lives * 1000);
      return endGame(true);
    }
    wave++;
    clearT = 0; cleared = false;
    centipedes = []; creatures = []; shots = [];
    // classic shape: one long centipede, plus a lone fast head for every wave after the first
    const heads = Math.min(wave - 1, CLASSIC ? 6 : 9);
    const total = CLASSIC ? 11 : 11 + Math.min(6, Math.floor((wave - 1) / 2));
    spawnCentipede(Math.max(1, total - heads), 0);
    for (let i = 0; i < heads; i++) spawnCentipede(1, 0, 3 + i * 4, { fast: 1.25 });
    spiderT = wr(4, 8); fleaT = 2; scorpT = wr(10, 16); headT = wr(3, 6);
    banner = { text: CLASSIC ? `WAVE ${wave}/${FINAL_WAVE}` : `WAVE ${wave}`, t: 0 };
    Sound.arp([330, 440, 587], 0.09, 'square', 0.035);
  }

  function waveCleared() {
    let restored = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const m = grid[r][c];
        if (!m) continue;
        if (m.poison) { m.poison = false; m.pop = 0.3; }
        if (m.hp < 4) { m.hp = 4; m.pop = 0.3; restored++; }
      }
    }
    const pts = restored ? addScore(PTS.restore * restored) : 0;
    toast(restored ? `WAVE ${wave} CLEARED! GARDEN RESTORED +${pts.toLocaleString()}` : `WAVE ${wave} CLEARED!`);
    Sound.arp([523, 659, 784, 1046], 0.08, 'square', 0.04);
  }

  // ---------------------------------------------------------------------------
  // Scoring & effects
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    const pts = Math.max(1, Math.round(n * mult()));
    score += pts;
    if (x !== undefined) popups.push({ x, y, text: String(pts), t: 0 });
    if (score >= nextLifeAt) { nextLifeAt += 12000; lives++; toast('EXTRA LIFE!'); Sound.arp([523, 659, 784, 1046], 0.07); }
    if (score > high) { high = score; store.set(Arcade.modeKey('centipede.high'), high); }
    return pts;
  }

  function explode(x, y, color, n, speed = 190) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(30, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.2, 0.65), c: Math.random() < 0.3 ? '#fff' : color, s: rand(2, 4) });
    }
  }
  const burst = (x, y, color) => particles.push({ burst: true, x, y, t: 0, life: 0.2, c: color });

  // ---------------------------------------------------------------------------
  // Mushrooms
  // ---------------------------------------------------------------------------
  function plant(r, c, poison) {
    if (!inGrid(r, c) || grid[r][c] || r < 1 || r > ROWS - 1) return;
    grid[r][c] = { hp: 4, poison: !!poison, pop: 0.3 };
  }

  function damageMush(r, c, x, y) {
    const m = grid[r][c];
    m.hp--;
    m.pop = 0.25;
    if (m.hp > 0) {
      explode(x, y, MUSH_COL[m.hp - 1], 4, 80);
      Sound.tone(260, 200, 0.04, 'triangle', 0.02);
      return;
    }
    grid[r][c] = null;
    addScore(PTS.mush, cx(c), cy(r));
    explode(cx(c), cy(r), m.poison ? COL.poison : COL.body, 10, 130);
    Sound.noise(0.09, 0.05, 0, 1700);
  }

  function zoneMushrooms() {
    let n = 0;
    for (let r = ZONE_ROW; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) n++;
    return n;
  }

  function mushCount() {
    let n = 0;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // The swarm: each centipede is a path its head lays down and its body follows
  // ---------------------------------------------------------------------------
  function pointAt(c, d) {
    const p = c.path;
    if (d <= p[0].s) return { x: p[0].x, y: p[0].y };
    const end = p[p.length - 1];
    if (d >= end.s) return { x: end.x, y: end.y };
    let k = 0;
    while (k < p.length - 2 && p[k + 1].s <= d) k++;
    const a = p[k], b = p[k + 1];
    const f = (d - a.s) / (b.s - a.s);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  // the head picks the next cell: forward, or down a row when a mushroom or wall stops it
  function extendPath(c) {
    const p = c.path[c.path.length - 1];
    const col = Math.round((p.x - CELL / 2) / CELL);
    const row = clamp(Math.round((p.y - FIELD_TOP - ROWH / 2) / ROWH), 0, ROWS - 1);
    if (col < 0 || col >= COLS) { c.path.push({ x: cx(col + c.dir), y: p.y, s: p.s + CELL }); return; } // still walking in
    let ncol = col, nrow = row;
    if (c.poison) {
      // a poisoned centipede dives straight at the gun, then works its way back up
      nrow = row + 1;
      if (nrow > ROWS - 1) { c.poison = false; c.vdir = -1; nrow = row - 1; c.dir = -c.dir; }
    } else {
      const ahead = col + c.dir;
      const m = mushAt(row, ahead);
      if (m && m.poison) {
        c.poison = true;
        nrow = Math.min(ROWS - 1, row + 1);
      } else if (m || ahead < 0 || ahead >= COLS) {
        c.dir = -c.dir;
        nrow = row + c.vdir;
        const top = c.bottom ? ZONE_ROW : 0;
        if (nrow < top) { c.vdir = 1; nrow = row + 1; }
        if (nrow > ROWS - 1) { c.vdir = -1; nrow = row - 1; }
      } else ncol = ahead;
    }
    nrow = clamp(nrow, 0, ROWS - 1);
    if (nrow >= ZONE_ROW) c.bottom = true;
    c.path.push({ x: cx(ncol), y: cy(nrow), s: p.s + (ncol === col ? ROWH : CELL) });
  }

  function moveSwarm(dt) {
    const base = segSpeed();
    for (const c of centipedes) {
      c.d += base * c.fast * dt;
      c.ft += dt;
      if (c.ft > 0.11) { c.ft = 0; c.frame ^= 1; }
      let guard = 0;
      while (c.path[c.path.length - 1].s <= c.d + CELL && guard++ < 12) extendPath(c);
      const tail = c.d - (c.segs - 1) * CELL;
      while (c.path.length > 2 && c.path[1].s <= tail) c.path.shift();
      c.pts.length = 0;
      for (let i = 0; i < c.segs; i++) c.pts.push(pointAt(c, c.d - i * CELL));
    }
  }

  // a hit splits the centipede: the part in front keeps going, the part behind becomes its own
  function splitAt(c, i) {
    const idx = centipedes.indexOf(c);
    if (idx < 0) return;
    const rear = c.segs - i - 1;
    const rearD = c.d - (i + 1) * CELL;
    centipedes.splice(idx, 1);
    if (i > 0) centipedes.push(Object.assign({}, c, { segs: i, pts: [] }));
    if (rear > 0) {
      // the rear half only knows the path up to its own head — from there it decides for itself
      let k = 1;
      while (k < c.path.length - 1 && c.path[k].s <= rearD) k++;
      centipedes.push(Object.assign({}, c, { segs: rear, d: rearD, path: c.path.slice(0, k + 1), pts: [] }));
    }
  }

  function hitSegment(c, i, x, y) {
    const head = i === 0;
    const p = c.pts[i];
    segsKilled++;
    addScore(head ? PTS.head : PTS.body, p.x, p.y);
    burst(p.x, p.y, head ? COL.head : COL.body);
    explode(p.x, p.y, head ? COL.head : COL.body, head ? 16 : 10, head ? 240 : 170);
    plant(clamp(rowAt(p.y), 1, ROWS - 1), clamp(colAt(p.x), 0, COLS - 1));
    if (head) Sound.arp([680, 940, 1180], 0.05, 'square', 0.045);
    else Sound.tone(520, 220, 0.06, 'square', 0.03);
    splitAt(c, i);
  }

  // ---------------------------------------------------------------------------
  // Spider, flea and scorpion
  // ---------------------------------------------------------------------------
  const has = (kind) => creatures.some((c) => c.kind === kind);

  function spawnSpider() {
    const left = wrand() < 0.5;
    const sp = 105 + Math.min(130, wave * 9);
    creatures.push({
      kind: 'spider', x: left ? -26 : FW + 26, y: cy(ROWS - 2),
      vx: (left ? 1 : -1) * sp * wr(0.75, 1.05), vy: -sp * 0.85 * pace(), zigT: wr(0.3, 0.8), sp,
      frame: 0, ft: 0, t: 0,
    });
    Sound.tone(300, 520, 0.16, 'sine', 0.025);
  }

  function spawnFlea() {
    creatures.push({
      kind: 'flea', x: cx(Math.floor(wrand() * COLS)), y: FIELD_TOP - 18,
      vy: (200 + wave * 6) * pace(), hp: 2, lastRow: -1, frame: 0, ft: 0, t: 0,
    });
    Sound.tone(900, 260, 0.35, 'triangle', 0.03);
  }

  function spawnScorpion() {
    const left = wrand() < 0.5;
    const row = 2 + Math.floor(wrand() * Math.max(1, ZONE_ROW - 5));
    creatures.push({
      kind: 'scorp', x: left ? -30 : FW + 30, y: cy(row), row,
      vx: (left ? 1 : -1) * (105 + wave * 5), frame: 0, ft: 0, t: 0,
    });
    Sound.tone(150, 110, 0.5, 'sawtooth', 0.03);
  }

  function killCreature(k, x, y) {
    const i = creatures.indexOf(k);
    if (i >= 0) creatures.splice(i, 1);
    if (k.kind === 'spider') {
      const d = Math.hypot(k.x - player.x, k.y - player.y);
      const pts = d < 70 ? 900 : d < 155 ? 600 : 300;
      addScore(pts, k.x, k.y);
      explode(k.x, k.y, COL.spider, 24, 250);
      Sound.arp([880, 660, 990, 1320], 0.05, 'square', 0.05);
    } else if (k.kind === 'flea') {
      addScore(PTS.flea, k.x, k.y);
      explode(k.x, k.y, COL.flea, 16, 200);
      Sound.arp([760, 1100], 0.05, 'square', 0.045);
    } else {
      addScore(PTS.scorp, k.x, k.y);
      explode(k.x, k.y, COL.scorp, 28, 280);
      flash = Math.max(flash, 0.18);
      Sound.arp([440, 660, 880, 1320], 0.06, 'square', 0.05);
    }
    burst(k.x, k.y, k.kind === 'spider' ? COL.spider : k.kind === 'flea' ? COL.flea : COL.scorp);
  }

  function updateCreatures(dt) {
    // spiders bounce through the gun's rows, eating mushrooms as they go
    spiderT -= dt;
    if (spiderT <= 0) {
      spiderT = wr(6, 12) / (1 + wave * 0.04);
      if (!has('spider')) spawnSpider();
    }
    // a flea drops in when the gun's rows are running out of cover
    fleaT -= dt;
    if (fleaT <= 0 && wave >= 2 && !has('flea') && zoneMushrooms() < 4 + Math.min(5, wave)) {
      fleaT = wr(4, 8);
      spawnFlea();
    }
    // scorpions poison a whole row of mushrooms
    scorpT -= dt;
    if (scorpT <= 0) {
      scorpT = wr(13, 22) / (CLASSIC ? 1 : 1 + wave * 0.03);
      if (wave >= 4 && !has('scorp')) spawnScorpion();
    }

    for (const k of creatures) {
      k.t += dt;
      k.ft += dt;
      if (k.ft > 0.09) { k.ft = 0; k.frame ^= 1; }
      if (k.kind === 'spider') {
        k.x += k.vx * dt;
        k.y += k.vy * dt;
        k.zigT -= dt;
        if (k.zigT <= 0) { k.zigT = wr(0.25, 0.7); k.vy = (wrand() < 0.5 ? -1 : 1) * k.sp * wr(0.45, 1.1) * pace(); }
        if (k.y < ZONE_Y + 10) { k.y = ZONE_Y + 10; k.vy = Math.abs(k.vy); }
        if (k.y > FLOOR - 12) { k.y = FLOOR - 12; k.vy = -Math.abs(k.vy); }
        const r = rowAt(k.y), c = colAt(k.x);
        if (mushAt(r, c)) { grid[r][c] = null; explode(cx(c), cy(r), COL.spider, 5, 90); }
        if (k.x < -40 || k.x > FW + 40) k.gone = true;
      } else if (k.kind === 'flea') {
        k.y += k.vy * dt;
        const r = rowAt(k.y);
        if (r !== k.lastRow) {
          k.lastRow = r;
          if (r > ROWS * 0.5 && wrand() < 0.35) plant(r, colAt(k.x));
        }
        if (k.y > FLOOR + 10) k.gone = true;
      } else {
        k.x += k.vx * dt;
        const c = colAt(k.x);
        const m = mushAt(k.row, c);
        if (m && !m.poison) { m.poison = true; m.pop = 0.25; }
        if (k.x < -50 || k.x > FW + 50) k.gone = true;
      }
      // anything that touches the gun takes a life
      if (player.alive && player.invuln <= 0 && Math.hypot(k.x - player.x, k.y - player.y) < 20) hitPlayer();
    }
    creatures = creatures.filter((k) => !k.gone);

    if (has('spider')) {
      chirpT -= dt;
      if (chirpT <= 0) { chirpT = 0.22; Sound.tone(420, 300, 0.05, 'sine', 0.012); }
    }
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------
  function fire() {
    if (!player.alive || player.reload > 0 || shots.length >= 3) return;
    shots.push({ x: player.x, y: player.y - 14 });
    fired++;
    player.reload = 0.1;
    Sound.tone(1250, 420, 0.05, 'square', 0.02);
  }

  function updateShots(dt) {
    const speed = 1150 * pace();
    for (const s of shots) {
      const steps = Math.max(1, Math.ceil((speed * dt) / 11));
      const step = (speed * dt) / steps;
      for (let n = 0; n < steps && !s.dead; n++) {
        s.y -= step;
        if (s.y < FIELD_TOP - 24) { s.dead = true; break; }
        // creatures sit on top of everything
        for (const k of creatures) {
          const w = k.kind === 'scorp' ? 20 : 16;
          if (Math.abs(k.x - s.x) < w && Math.abs(k.y - s.y) < 14) {
            s.dead = true; hits++;
            if (k.kind === 'flea' && --k.hp > 0) { k.vy *= 1.7; explode(k.x, k.y, COL.flea, 6, 120); Sound.tone(600, 400, 0.05, 'square', 0.03); }
            else killCreature(k, s.x, s.y);
            break;
          }
        }
        if (s.dead) break;
        for (const c of centipedes) {
          let found = -1;
          for (let i = 0; i < c.pts.length; i++) {
            const p = c.pts[i];
            if (Math.abs(p.x - s.x) < 14 && Math.abs(p.y - s.y) < 14) { found = i; break; }
          }
          if (found >= 0) { s.dead = true; hits++; hitSegment(c, found, s.x, s.y); break; }
        }
        if (s.dead) break;
        // mushrooms are shorter than a row, so a shot can slip through the gap between them
        const r = rowAt(s.y), c = colAt(s.x);
        if (mushAt(r, c) && Math.abs(s.y - cy(r)) < 13) { s.dead = true; damageMush(r, c, s.x, s.y); }
      }
    }
    shots = shots.filter((s) => !s.dead);
  }

  // ---------------------------------------------------------------------------
  // The gun
  // ---------------------------------------------------------------------------
  function aim(x, y) {
    player.tx = clamp(x, 14, FW - 14);
    player.ty = clamp(y, ZONE_Y + 14, FLOOR - 14);
  }

  function hitPlayer() {
    if (!player.alive || player.invuln > 0) return;
    player.alive = false;
    player.respawn = 1.3;
    lives--;
    flash = 0.3;
    shots = [];
    explode(player.x, player.y, COL.gun, 46, 300);
    Sound.noise(0.9, 0.2, 0, 650);
    // the garden survives, but the poison is washed out and chewed mushrooms grow back
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const m = grid[r][c];
        if (!m) continue;
        if (m.poison || m.hp < 4) m.pop = 0.3;
        m.poison = false;
        m.hp = 4;
      }
    }
    for (const c of centipedes) c.poison = false;
    creatures = [];
    if (lives <= 0) setTimeout(() => { if (state === 'play') endGame(false); }, 1100);
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-wave').textContent = CLASSIC ? `${Math.min(wave, FINAL_WAVE)}/${FINAL_WAVE}` : wave;
    $('o-segs').textContent = segsKilled.toLocaleString();
    $('o-acc').textContent = fired ? `${Math.round((hits / fired) * 100)}%` : '—';
    Arcade.endScreen(won, won ? 'Twelve waves cleared. The garden is yours!' : '');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();
  let pointerFire = false;

  function update(dt) {
    time += dt;
    for (const b of blades) b.tw += dt * 1.6;
    for (const p of particles) { p.t += dt; if (!p.burst) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95; } }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const m = grid[r][c]; if (m && m.pop > 0) m.pop -= dt; }
    if (flash > 0) flash -= dt;
    if (banner) { banner.t += dt; if (banner.t > 2) banner = null; }
    if (state !== 'play') { moveSwarm(dt); return; }

    // the gun follows the pointer (or the keys) smoothly and never leaves its rows
    if (player.alive) {
      const kx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
      const ky = (keys.has('down') ? 1 : 0) - (keys.has('up') ? 1 : 0);
      if (kx || ky) aim(player.tx + kx * 700 * dt, player.ty + ky * 700 * dt * pace());
      // eases towards the pointer, quick when it is far away but never a teleport
      const ease = Math.min(1, dt * 15), cap = 1400 * dt;
      player.x += clamp((player.tx - player.x) * ease, -cap, cap);
      player.y += clamp((player.ty - player.y) * ease, -cap * pace(), cap * pace());
      if (player.invuln > 0) player.invuln -= dt;
      if (player.reload > 0) player.reload -= dt;
      if (keys.has('fire') || pointerFire) fire();
    } else if (lives > 0) {
      player.respawn -= dt;
      if (player.respawn <= 0) { player.alive = true; player.invuln = 1.6; resetGun(); }
    }

    moveSwarm(dt);
    updateShots(dt);
    updateCreatures(dt);

    // segments that reach the gun take a life
    if (player.alive && player.invuln <= 0) {
      for (const c of centipedes) {
        for (const p of c.pts) {
          if (Math.abs(p.x - player.x) < 20 && Math.abs(p.y - player.y) < 20) { hitPlayer(); break; }
        }
        if (!player.alive) break;
      }
    }

    // once the swarm is in the gun's rows, fresh heads keep coming
    if (centipedes.some((c) => c.bottom)) {
      headT -= dt;
      if (headT <= 0) {
        headT = wr(3, 6.5) / (CLASSIC ? 1 : 1 + wave * 0.03);
        if (segsLeft() < 9) spawnCentipede(1, Math.max(0, ZONE_ROW - 2), 0, { fast: 1.3, bottom: true });
      }
    }

    if (!centipedes.length) {
      clearT += dt;
      if (!cleared) { cleared = true; waveCleared(); }
      if (clearT > 1.8) startWave();
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

    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#04070f');
    bg.addColorStop(0.65, '#050c07');
    bg.addColorStop(1, '#0c1405');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    if (!grid) { ctx.restore(); return; }

    // grass specks
    ctx.fillStyle = '#7bd35a';
    for (const b of blades) {
      ctx.globalAlpha = 0.18 + Math.sin(b.tw) * 0.12;
      ctx.fillRect(b.x, FIELD_TOP + b.f * (FLOOR - FIELD_TOP), b.s, b.s * 2);
    }
    ctx.globalAlpha = 1;

    // the gun's rows
    ctx.fillStyle = 'rgba(180,240,0,0.045)';
    ctx.fillRect(0, ZONE_Y, FW, FLOOR - ZONE_Y);
    ctx.fillStyle = 'rgba(180,240,0,0.28)';
    ctx.fillRect(0, ZONE_Y, FW, 1);

    // mushrooms
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const m = grid[r][c];
        if (!m) continue;
        const col = m.poison ? (Math.sin(time * 9 + r + c) > 0 ? COL.poison : '#ff4d6d') : MUSH_COL[m.hp - 1];
        const px = m.pop > 0 ? PX + 1 : PX;
        ctx.shadowColor = col;
        ctx.shadowBlur = m.poison ? 14 : 8;
        drawAt(ctx, SPR.mush[m.hp - 1], cx(c), cy(r), px, col);
      }
    }
    ctx.shadowBlur = 0;

    // the swarm
    for (const c of centipedes) {
      for (let i = c.pts.length - 1; i >= 0; i--) {
        const p = c.pts[i];
        if (p.y < FIELD_TOP - ROWH || p.x < -CELL || p.x > FW + CELL) continue;
        const head = i === 0;
        const col = head ? COL.head : c.poison ? COL.poison : COL.body;
        ctx.shadowColor = col;
        ctx.shadowBlur = head ? 14 : 8;
        drawAt(ctx, (head ? SPR.head : SPR.body)[(c.frame + i) & 1], p.x, p.y, PX, col);
      }
    }
    ctx.shadowBlur = 0;

    // creatures
    for (const k of creatures) {
      const col = k.kind === 'spider' ? COL.spider : k.kind === 'flea' ? COL.flea : COL.scorp;
      const spr = k.kind === 'spider' ? SPR.spider[k.frame] : k.kind === 'flea' ? SPR.flea[k.frame] : SPR.scorp[k.frame];
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      drawAt(ctx, spr, k.x, k.y, PX, col);
    }
    ctx.shadowBlur = 0;

    // shots
    ctx.fillStyle = COL.shot;
    ctx.shadowColor = COL.shot;
    ctx.shadowBlur = 8;
    for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 10, 3, 12);
    ctx.shadowBlur = 0;

    // the gun
    if (player.alive && !(player.invuln > 0 && Math.floor(player.invuln * 12) % 2)) {
      ctx.shadowColor = COL.gun;
      ctx.shadowBlur = 12;
      drawAt(ctx, SPR.gun, player.x, player.y, PX, COL.gun);
      ctx.shadowBlur = 0;
    }

    // explosions and score popups
    for (const p of particles) {
      if (p.burst) { drawAt(ctx, SPR.burst, p.x, p.y, PX, p.c); continue; }
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '11px "Press Start 2P", monospace';
    for (const p of popups) { ctx.globalAlpha = 1 - p.t / 0.8; ctx.fillStyle = '#fff'; ctx.fillText(p.text, p.x, p.y - p.t * 40); }
    ctx.globalAlpha = 1;

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.6 ? (2 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = '22px "Press Start 2P", monospace';
      ctx.shadowColor = COL.body; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, FW / 2, FH * 0.44);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,120,150,${Math.min(0.5, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = COL.body; ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
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
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('lives', '▲'.repeat(Math.max(0, Math.min(lives, 8))));
    set('wave', state === 'title' ? '' : `WAVE ${wave}${CLASSIC ? '/' + FINAL_WAVE : ''}`);
    set('mult', state === 'title' || CLASSIC ? '' : `×${mult().toFixed(1)}`);
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
      else if (state === 'play') { if (paused) paused = false; keys.add('fire'); }
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) keys.delete(KEYMAP[k]);
    if (k === ' ' || k === 'enter') keys.delete('fire');
  });
  window.addEventListener('blur', () => { keys.clear(); pointerFire = false; });

  // Mouse: the gun follows the pointer, hold the button to fire.
  // Touch: drag anywhere to move (relative, so your finger doesn't cover the gun) and keep firing while down.
  const toX = (v) => (v - offX) / scale;
  const toY = (v) => (v - offY) / scale;
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    if (e.pointerType === 'mouse') aim(toX(e.clientX), toY(e.clientY));
    else drag = { sx: toX(e.clientX), sy: toY(e.clientY), px: player.tx, py: player.ty, id: e.pointerId };
    pointerFire = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play') return;
    if (e.pointerType === 'mouse') aim(toX(e.clientX), toY(e.clientY));
    else if (drag && drag.id === e.pointerId) aim(drag.px + (toX(e.clientX) - drag.sx) * 1.3, drag.py + (toY(e.clientY) - drag.sy) * 1.3);
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

  // title-screen legend
  [['lg-head', SPR.head[0], COL.head], ['lg-body', SPR.body[0], COL.body], ['lg-mush', SPR.mush[3], MUSH_COL[3]],
    ['lg-spider', SPR.spider[0], COL.spider], ['lg-flea', SPR.flea[0], COL.flea], ['lg-scorp', SPR.scorp[0], COL.scorp]].forEach(([id, spr, col]) => {
    const c = $(id);
    if (!c) return;
    sprite(c.getContext('2d'), spr, Math.floor((c.width - spr.w * 3) / 2), Math.floor((c.height - spr.h * 3) / 2), 3, col);
  });

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'centipede',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, score, lives, wave, mult: mult(),
        segments: segsLeft(), centipedes: centipedes.length, mushrooms: mushCount(),
        poisoned: grid.reduce((n, row) => n + row.filter((m) => m && m.poison).length, 0),
        zoneMushrooms: zoneMushrooms(), creatures: creatures.map((k) => k.kind),
        shots: shots.length, fired, hits, segsKilled, rows: ROWS, rowh: Math.round(ROWH),
        gun: [Math.round(player.x), Math.round(player.y)], alive: player.alive, time: Math.round(time),
        // where the swarm is right now: [x, y] per segment, heads first
        swarm: centipedes.map((c) => c.pts.map((p) => [Math.round(p.x), Math.round(p.y)])),
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'lives') lives = v;
        else if (k === 'wave') { wave = v - 1; startWave(); }
        else if (k === 'mushrooms' && v === 0) { for (let r = 0; r < ROWS; r++) grid[r].fill(null); }
      },
      moveTo: (x, y) => { aim(x, y === undefined ? player.ty : y); player.x = player.tx; player.y = player.ty; },
      fire,
      kill: () => { centipedes = []; creatures = []; },
      spawn: (kind) => (kind === 'spider' ? spawnSpider() : kind === 'flea' ? spawnFlea() : spawnScorpion()),
      win: () => { centipedes = []; wave = FINAL_WAVE; addScore(lives * 1000); endGame(true); },
    };
  }

  // attract mode behind the title screen: the first centipede winding down the garden
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
