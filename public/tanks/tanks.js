/*
 * Tank Battle — a Battle City style top-down tank game.
 *   Infinite  (/tanks/)                stages forever, procedurally generated mazes
 *   Classic   (/tanks/?mode=classic)   fifteen hand-shaped stages you can win
 *   Daily     (/tanks/?daily=…)        Infinite rules, every world decision seeded (see docs/ADDING_A_GAME.md)
 */
(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, bindPadButtons, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const COLS = 13, ROWS = 13, TS = 40, HALF = TS / 2;
  const FW = COLS * TS;                 // the battlefield fills the width; the canvas grows to fit tall screens
  const FIELD_H = ROWS * TS;
  const TANK = TS;                      // tanks are one tile wide and snap to half tiles, like the original
  const BULLET = 8;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('tanks') || (CLASSIC ? 'tanks-classic' : 'tanks');
  const FINAL_STAGE = 15;

  const T = { EMPTY: 0, BRICK: 1, STEEL: 2, WATER: 3, BUSH: 4, ICE: 5, BASE: 6, WRECK: 7 };
  const DIRV = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // up, right, down, left
  const DIRKEYS = ['up', 'right', 'down', 'left'];
  const SPAWNS = [[0, 0], [6, 0], [12, 0]];
  const BASE_C = 6, BASE_R = 12;
  const NEST = [[5, 11], [6, 11], [7, 11], [5, 12], [7, 12]];
  const PLAYER_SPAWN = [4, 12];

  const FOE = {
    basic:   { hp: 1, speed: 78,  bullet: 300, points: 100, body: '#98a2ad', trim: '#59626c', reload: [1.4, 3.2] },
    fast:    { hp: 1, speed: 152, bullet: 310, points: 200, body: '#e6e2cf', trim: '#8b8874', reload: [1.6, 3.4] },
    shooter: { hp: 1, speed: 92,  bullet: 520, points: 300, body: '#b8d94a', trim: '#5e7018', reload: [0.9, 2.2] },
    armour:  { hp: 4, speed: 72,  bullet: 320, points: 400, body: '#4ade80', trim: '#166534', reload: [1.2, 2.8] },
  };
  const ARMOUR_COLORS = ['#ef4444', '#f97316', '#facc15', '#4ade80'];   // by remaining hp (1..4)
  const POWERS = ['helmet', 'star', 'grenade', 'shovel', 'tank', 'clock'];
  const POWER_NAMES = { helmet: 'SHIELD 10s', star: 'GUN UP', grenade: 'WIPE OUT', shovel: 'STEEL BASE 20s', tank: 'EXTRA LIFE', clock: 'ENEMIES FROZEN 10s' };

  // 8×8 pixel icons for the power-ups: '.' is transparent, 1/2/3 index the palette below
  const ICONS = {
    helmet:  { p: ['#7fd4ff', '#1f5d94', '#eaf8ff'], a: ['..1111..', '.111111.', '11133111', '11111111', '11111111', '.111111.', '..1111..', '...11...'] },
    star:    { p: ['#ffd23f', '#a06c00', '#fff3b0'], a: ['...11...', '...33...', '.113311.', '11111111', '.111111.', '..1111..', '.11..11.', '11....11'] },
    grenade: { p: ['#4f7a3a', '#8e8e8e', '#9ad06a'], a: ['....22..', '...222..', '..1111..', '.113111.', '11113111', '11111111', '.111111.', '..1111..'] },
    shovel:  { p: ['#c9d2dc', '#a06a3a', '#ffffff'], a: ['...22...', '...22...', '...22...', '..2222..', '.111111.', '.113311.', '..1111..', '...11...'] },
    tank:    { p: ['#e8c060', '#7a5410', '#fff0c0'], a: ['...33...', '...11...', '.111111.', '21111112', '21133112', '21111112', '.111111.', '.2.11.2.'] },
    clock:   { p: ['#eef4fb', '#3f6f9f', '#1b2a3a'], a: ['..2222..', '.211112.', '21131122', '21131112', '21111112', '.211112.', '..2222..', '........'] },
  };

  // the eagle: 10×10, drawn inside the base tile
  const EAGLE = ['...2..2...', '..2222222.', '.211211112', '.211111112', '2111111111', '2111111111', '.211111112', '..2111112.', '...21112..', '..222222..'];
  const EAGLE_P = { 1: '#e8d9a0', 2: '#8a6a2a' };
  const EAGLE_DEAD = { 1: '#6b6b6b', 2: '#3a3a3a' };

  // ---------------------------------------------------------------------------
  // Classic campaign: fifteen hand-shaped battlefields (. empty  B brick  S steel  W water  T bush  I ice)
  // ---------------------------------------------------------------------------
  const STAGES = [
    ['.............', '.BB.BB.BB.BB.', '.BB.BB.BB.BB.', '.BB.BB.BB.BB.', '.BB.BB.BB.BB.', '.............', '.BB.BB.BB.BB.', '.BB.BB.BB.BB.', '.............', '.BB.BB.BB.BB.', '.BB.BB.BB.BB.', '.............', '.............'],
    ['.............', '..BBBBBBBBB..', '..B.......B..', '..B.SSSSS.B..', '..B.S...S.B..', '..B.S.S.S.B..', '..B.S...S.B..', '..B.SSSSS.B..', '..B.......B..', '..BBBBBBBBB..', '.............', '...B.....B...', '...B.....B...'],
    ['.............', '.BB.BB.BB.BB.', '.BB.BB.BB.BB.', '.............', 'WWWW.....WWWW', 'WWWW.BBB.WWWW', '.....BSB.....', '.....BBB.....', 'WWWW.....WWWW', 'WWWW.....WWWW', '.............', '..BB.....BB..', '..BB.....BB..'],
    ['.............', '.TTT.....TTT.', '.TBT.BBB.TBT.', '.TTT.BSB.TTT.', '.....BBB.....', '.BB.......BB.', '.BB.SSSSS.BB.', '.BB.......BB.', '.....BBB.....', '.TTT.BSB.TTT.', '.TBT.BBB.TBT.', '.TTT.....TTT.', '.............'],
    ['.............', '.IIIIIIIIIII.', '.I.BB...BB.I.', '.I.BB...BB.I.', '.I.........I.', '.IIIIIIIIIII.', '.....SSS.....', '.IIIIIIIIIII.', '.I.........I.', '.I.BB...BB.I.', '.I.BB...BB.I.', '.IIIIIIIIIII.', '.............'],
    ['.............', '.SBBBBBBBBBS.', '.B.........B.', '.B.BBBBBBB.B.', '.B.B.....B.B.', '.B.B.SSS.B.B.', '.B.B.S.S.B.B.', '.B.B.SSS.B.B.', '.B.B.....B.B.', '.B.BBBBBBB.B.', '.B.........B.', '.SBBBBBBBBBS.', '.............'],
    ['.............', '.BBB.WWW.BBB.', '.BBB.WWW.BBB.', '.....WWW.....', 'BBB.......BBB', 'WWW.SSSSS.WWW', 'WWW.......WWW', 'BBB.......BBB', '.....WWW.....', '.BBB.WWW.BBB.', '.BBB.WWW.BBB.', '.............', '.............'],
    ['.............', '.B.B.B.B.B.B.', '.B.B.B.B.B.B.', '.............', '.BBB.BBB.BBB.', '.....S.S.....', '.BBB.BBB.BBB.', '.....S.S.....', '.BBB.BBB.BBB.', '.............', '.B.B.B.B.B.B.', '.B.B.B.B.B.B.', '.............'],
    ['.............', '.IIIII.IIIII.', '.IIIII.IIIII.', '.....B.B.....', '.BBB.B.B.BBB.', '.BSB.....BSB.', '.BBB.SSS.BBB.', '.....SSS.....', '.BBB.....BBB.', '.IIIIIIIIIII.', '.IIIIIIIIIII.', '.....B.B.....', '.............'],
    ['.............', '.TTTTTTTTTTT.', '.T.BBBBBBB.T.', '.T.B.....B.T.', '.T.B.WWW.B.T.', '.T.B.WSW.B.T.', '.T.B.WWW.B.T.', '.T.B.....B.T.', '.T.BBBBBBB.T.', '.TTTTTTTTTTT.', '.............', '..BB.....BB..', '..BB.....BB..'],
    ['.............', '.S.S.S.S.S.S.', '.............', 'BBBBB.B.BBBBB', '.....B.B.....', '.SSS.B.B.SSS.', '.....B.B.....', 'BBBBB.B.BBBBB', '.............', '.S.S.S.S.S.S.', '.............', '..BB.....BB..', '..BB.....BB..'],
    ['.............', '.WWW.BBB.WWW.', '.WWW.BSB.WWW.', '.WWW.BBB.WWW.', '.............', 'BB.BBB.BBB.BB', '.....B.B.....', 'BB.BBB.BBB.BB', '.............', '.WWW.BBB.WWW.', '.WWW.BSB.WWW.', '.WWW.BBB.WWW.', '.............'],
    ['.............', '.IIIIIIIIIII.', '.I.SSSSSSS.I.', '.I.S.....S.I.', '.I.S.BBB.S.I.', '.I.S.B.B.S.I.', '.I.S.B.B.S.I.', '.I.S.BBB.S.I.', '.I.S.....S.I.', '.I.SSSSSSS.I.', '.IIIIIIIIIII.', '..BB.....BB..', '..BB.....BB..'],
    ['.............', '.BSB.BSB.BSB.', '.BBB.BBB.BBB.', '.............', '.WWWW...WWWW.', '.....BBB.....', '.SSS.BSB.SSS.', '.....BBB.....', '.WWWW...WWWW.', '.............', '.BBB.BBB.BBB.', '.BSB.BSB.BSB.', '.............'],
    ['.............', 'SBBBSBBBSBBBS', '.B.B.B.B.B.B.', '.B.B.B.B.B.B.', '.....WWW.....', 'BBB.WWWWW.BBB', 'BSB.WW.WW.BSB', 'BBB.WWWWW.BBB', '.....WWW.....', '.B.B.B.B.B.B.', '.B.B.B.B.B.B.', 'SBBBSBBBSBBBS', '.............'],
  ];
  const CHAR_TILE = { '.': T.EMPTY, B: T.BRICK, S: T.STEEL, W: T.WATER, T: T.BUSH, I: T.ICE };

  // world randomness (mazes, enemy order, power-up drops, enemy decisions) is seeded for daily challenges
  let wrand = Math.random;
  const wr = (a, b) => a + wrand() * (b - a);
  const wpick = (arr) => arr[Math.floor(wrand() * arr.length)];

  let state = 'title';
  let paused = false;
  let tiles, brick, baseIdx, baseAlive, shovelT;
  let player, enemies, bullets, powers, particles, booms, popups;
  let score, lives, stage, kills, time, queue, spawnT, spawnSlot, freezeT;
  let banner, flash, shake, clearT, powerQueue, powerSpots, powerAt;
  let high = store.get(Arcade.modeKey('tanks.high'), 0);

  let FH = 760, fieldY = 60;
  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    FH = clamp(Math.round((FW * v.H) / v.W), FIELD_H + 80, FIELD_H + 700);
    fieldY = Math.round(Math.max(Math.min(FH - FIELD_H, 64), (FH - FIELD_H) * 0.42));
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    v.ctx.imageSmoothingEnabled = false;
  });
  const ctx = view.ctx;
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------------------
  // Pixel-art tiles, baked once into small canvases and blitted per quarter
  // ---------------------------------------------------------------------------
  function bake(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    draw(g);
    return c;
  }

  const brickTile = bake(TS, TS, (g) => {
    g.fillStyle = '#4a1d0e'; g.fillRect(0, 0, TS, TS);
    for (let r = 0; r < 8; r++) {
      const off = r % 2 ? 0 : 5;
      for (let c = -1; c < 5; c++) {
        const x = c * 10 + off + 1, y = r * 5 + 1;
        g.fillStyle = '#b5542a'; g.fillRect(x, y, 8, 4);
        g.fillStyle = '#e0834a'; g.fillRect(x, y, 8, 1);
        g.fillStyle = '#7d3418'; g.fillRect(x, y + 3, 8, 1);
      }
    }
  });

  const steelTile = bake(TS, TS, (g) => {
    g.fillStyle = '#39424d'; g.fillRect(0, 0, TS, TS);
    for (let q = 0; q < 4; q++) {
      const x = (q % 2) * HALF, y = (q >> 1) * HALF;
      g.fillStyle = '#9aa6b4'; g.fillRect(x + 1, y + 1, HALF - 2, HALF - 2);
      g.fillStyle = '#e6eef7'; g.fillRect(x + 2, y + 2, HALF - 4, 4);
      g.fillStyle = '#ffffff'; g.fillRect(x + 3, y + 3, 5, 2);
      g.fillStyle = '#6a7684'; g.fillRect(x + 2, y + HALF - 6, HALF - 4, 4);
      g.fillStyle = '#39424d';
      g.fillRect(x + 3, y + 3, 2, 2); g.fillRect(x + HALF - 5, y + 3, 2, 2);
      g.fillRect(x + 3, y + HALF - 5, 2, 2); g.fillRect(x + HALF - 5, y + HALF - 5, 2, 2);
    }
  });

  const waterTiles = [0, 1, 2].map((f) => bake(TS, TS, (g) => {
    g.fillStyle = '#0e3260'; g.fillRect(0, 0, TS, TS);
    g.fillStyle = '#1a5596';
    for (let y = 0; y < TS; y += 4) g.fillRect(0, y, TS, 2);
    g.fillStyle = '#3f9de0';
    for (let y = 2; y < TS; y += 8) for (let x = (f * 5 + y) % 10; x < TS; x += 10) g.fillRect(x, y, 5, 2);
    g.fillStyle = '#9fdcff';
    for (let y = 6; y < TS; y += 12) for (let x = (f * 7) % 14; x < TS; x += 14) g.fillRect(x, y, 4, 1);
  }));

  const bushTile = bake(TS, TS, (g) => {
    g.fillStyle = '#134a22';
    for (let i = 0; i < 26; i++) {
      const x = (i * 13) % TS, y = (i * 7 + (i % 3) * 5) % TS;
      g.fillRect(x, y, 7, 7);
    }
    g.fillStyle = '#2f9c4a';
    for (let i = 0; i < 22; i++) g.fillRect((i * 17 + 3) % TS, (i * 11 + 2) % TS, 5, 5);
    g.fillStyle = '#65d47a';
    for (let i = 0; i < 10; i++) g.fillRect((i * 23 + 5) % TS, (i * 19 + 4) % TS, 3, 3);
  });

  const iceTile = bake(TS, TS, (g) => {
    g.fillStyle = '#a9c9e6'; g.fillRect(0, 0, TS, TS);
    g.fillStyle = '#d5ecff'; g.fillRect(0, 0, HALF - 1, HALF - 1); g.fillStyle = '#d5ecff'; g.fillRect(HALF + 1, HALF + 1, HALF - 1, HALF - 1);
    g.fillStyle = '#c2dff5'; g.fillRect(HALF + 1, 0, HALF - 1, HALF - 1); g.fillRect(0, HALF + 1, HALF - 1, HALF - 1);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    for (let i = -TS; i < TS; i += 13) { g.beginPath(); g.moveTo(i, TS); g.lineTo(i + TS, 0); g.stroke(); }
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 6; i++) g.fillRect((i * 19 + 4) % TS, (i * 13 + 6) % TS, 2, 2);
  });

  const iconTiles = {};
  for (const name of POWERS) {
    const def = ICONS[name];
    iconTiles[name] = bake(32, 32, (g) => {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const ch = def.a[r][c];
        if (ch === '.') continue;
        g.fillStyle = def.p[+ch - 1];
        g.fillRect(c * 4, r * 4, 4, 4);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // The battlefield
  // ---------------------------------------------------------------------------
  const idx = (c, r) => r * COLS + c;
  const inMap = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

  function setTile(c, r, t) {
    if (!inMap(c, r)) return;
    tiles[idx(c, r)] = t;
    brick[idx(c, r)] = t === T.BRICK ? 15 : 0;
  }

  function stampBase() {
    for (const [c, r] of NEST) setTile(c, r, T.BRICK);
    // a shelf of brick above the nest, so no stage leaves a clear shot straight down the middle
    for (const c of [5, 6, 7]) if (tiles[idx(c, BASE_R - 2)] === T.EMPTY) setTile(c, BASE_R - 2, T.BRICK);
    baseIdx = idx(BASE_C, BASE_R);
    tiles[baseIdx] = T.BASE;
    brick[baseIdx] = 0;
    baseAlive = true;
    shovelT = 0;
  }

  function clearSpawns() {
    for (const [c, r] of SPAWNS) { setTile(c, r, T.EMPTY); setTile(c, r + 1, T.EMPTY); }
    setTile(PLAYER_SPAWN[0], PLAYER_SPAWN[1], T.EMPTY);
    setTile(12 - PLAYER_SPAWN[0], PLAYER_SPAWN[1], T.EMPTY);
    setTile(PLAYER_SPAWN[0], PLAYER_SPAWN[1] - 1, T.EMPTY);
  }

  // every tile an enemy can drive or shoot its way through (brick counts: it breaks)
  function reachable(from) {
    const seen = new Uint8Array(COLS * ROWS);
    const q = [from];
    seen[from] = 1;
    while (q.length) {
      const i = q.pop();
      const c = i % COLS, r = (i / COLS) | 0;
      for (const [dx, dy] of DIRV) {
        const nc = c + dx, nr = r + dy;
        if (!inMap(nc, nr)) continue;
        const ni = idx(nc, nr);
        if (seen[ni]) continue;
        const t = tiles[ni];
        if (t === T.STEEL || t === T.WATER) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    return seen;
  }

  // dig a straight-ish path so no spawn is ever sealed behind steel or water
  function carveTo(c0, r0, c1, r1) {
    let c = c0, r = r0;
    while (c !== c1 || r !== r1) {
      if (c !== c1 && (r === r1 || wrand() < 0.5)) c += Math.sign(c1 - c);
      else r += Math.sign(r1 - r);
      const t = tiles[idx(c, r)];
      if (t === T.STEEL || t === T.WATER) setTile(c, r, T.EMPTY);
    }
  }

  function buildStage(n) {
    tiles = new Uint8Array(COLS * ROWS);
    brick = new Uint8Array(COLS * ROWS);
    if (CLASSIC) {
      const rows = STAGES[Math.min(n, STAGES.length) - 1];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) setTile(c, r, CHAR_TILE[rows[r][c]] || T.EMPTY);
    } else {
      // the maze thickens with the stage, but never past the point where you can still get around
      const brickP = clamp(0.26 + n * 0.010, 0, 0.40);
      const steelP = clamp(0.03 + n * 0.008, 0, 0.11);
      const waterP = clamp(0.02 + n * 0.006, 0, 0.08);
      const bushP = clamp(0.03 + n * 0.005, 0, 0.09);
      const iceP = n >= 3 ? clamp(0.02 + n * 0.005, 0, 0.09) : 0;
      // mirrored halves keep the maze readable and fair to both sides
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c <= (COLS - 1) / 2; c++) {
          const x = wrand();
          let v = T.EMPTY;
          if (x < brickP) v = T.BRICK;
          else if (x < brickP + steelP) v = T.STEEL;
          else if (x < brickP + steelP + waterP) v = T.WATER;
          else if (x < brickP + steelP + waterP + bushP) v = T.BUSH;
          else if (x < brickP + steelP + waterP + bushP + iceP) v = T.ICE;
          setTile(c, r, v);
          setTile(COLS - 1 - c, r, v);
        }
      }
      // open lanes so the maze never turns into a solid block
      for (let c = 0; c < COLS; c++) { setTile(c, 0, T.EMPTY); setTile(c, ROWS - 1, T.EMPTY); }
      const lane = 1 + Math.floor(wrand() * (COLS - 2));
      for (let r = 0; r < ROWS; r++) if (tiles[idx(lane, r)] !== T.BRICK) setTile(lane, r, T.EMPTY);
      const row = 3 + Math.floor(wrand() * (ROWS - 6));
      for (let c = 0; c < COLS; c++) if (tiles[idx(c, row)] === T.STEEL) setTile(c, row, T.EMPTY);
    }
    clearSpawns();
    stampBase();
    const seen = reachable(idx(PLAYER_SPAWN[0], PLAYER_SPAWN[1]));
    for (const [c, r] of SPAWNS) if (!seen[idx(c, r)]) carveTo(c, r, PLAYER_SPAWN[0], PLAYER_SPAWN[1]);
  }

  // ---------------------------------------------------------------------------
  // Collision, at half-tile resolution (bricks break a quarter at a time)
  // ---------------------------------------------------------------------------
  function subSolid(sc, sr, forBullet) {
    if (sc < 0 || sr < 0 || sc >= COLS * 2 || sr >= ROWS * 2) return true;
    const i = idx(sc >> 1, sr >> 1);
    const t = tiles[i];
    if (t === T.BRICK) return ((brick[i] >> (((sr & 1) << 1) | (sc & 1))) & 1) === 1;
    if (t === T.STEEL || t === T.BASE) return true;
    if (t === T.WATER) return !forBullet;
    return false;
  }

  function mapBlocked(x, y, w, h, forBullet) {
    const sc0 = Math.floor(x / HALF), sc1 = Math.floor((x + w - 0.01) / HALF);
    const sr0 = Math.floor(y / HALF), sr1 = Math.floor((y + h - 0.01) / HALF);
    for (let sr = sr0; sr <= sr1; sr++) for (let sc = sc0; sc <= sc1; sc++) if (subSolid(sc, sr, forBullet)) return true;
    return false;
  }

  const overlaps = (a, b) => a.x < b.x + TANK && a.x + TANK > b.x && a.y < b.y + TANK && a.y + TANK > b.y;

  function tankBlocked(x, y, self) {
    if (mapBlocked(x + 0.5, y + 0.5, TANK - 1, TANK - 1, false)) return true;
    const probe = { x, y };
    if (player && player !== self && player.alive && !player.spawn && overlaps(probe, player)) return true;
    for (const e of enemies) if (e !== self && !e.dead && overlaps(probe, e)) return true;
    return false;
  }

  function moveTank(t, dist) {
    const [dx, dy] = DIRV[t.dir];
    let moved = 0;
    while (moved < dist - 0.001) {
      const d = Math.min(3, dist - moved);
      const nx = t.x + dx * d, ny = t.y + dy * d;
      if (tankBlocked(nx, ny, t)) break;
      t.x = nx; t.y = ny; moved += d;
    }
    return moved > 0.01;
  }

  // turning snaps the other axis to the half-tile grid, so corridors line up
  function face(t, dir) {
    if (t.dir === dir) return;
    const vertical = dir === 0 || dir === 2;
    const cur = vertical ? t.x : t.y;
    const snap = Math.round(cur / HALF) * HALF;
    if (snap !== cur) {
      if (vertical && !tankBlocked(snap, t.y, t)) t.x = snap;
      else if (!vertical && !tankBlocked(t.x, snap, t)) t.y = snap;
    }
    t.dir = dir;
  }

  const tileUnder = (t) => tiles[idx(clamp(Math.floor((t.x + TANK / 2) / TS), 0, COLS - 1), clamp(Math.floor((t.y + TANK / 2) / TS), 0, ROWS - 1))];

  // the body snaps to the grid, the turret swings around to catch up
  function spinTurret(t, dt) {
    const target = t.dir * (Math.PI / 2);
    const d = ((target - t.turret + Math.PI) % TAU + TAU) % TAU - Math.PI;
    t.turret += clamp(d, -14 * dt, 14 * dt);
  }

  // ---------------------------------------------------------------------------
  // Stage setup, enemies and power-ups
  // ---------------------------------------------------------------------------
  function enemyQueue(n) {
    const total = CLASSIC ? 18 + Math.min(4, Math.floor(n / 4)) : Math.min(30, 16 + n * 2);
    const w = {
      basic: Math.max(1.5, 10 - n * 0.8),
      fast: Math.min(8, 1.5 + n * 0.6),
      shooter: n >= 2 ? Math.min(8, 0.5 + n * 0.7) : 0,
      armour: n >= 3 ? Math.min(7, (n - 2) * 0.8) : 0,
    };
    const kinds = Object.keys(w).filter((k) => w[k] > 0);
    const sum = kinds.reduce((s, k) => s + w[k], 0);
    const list = [];
    for (let i = 0; i < total; i++) {
      let x = wrand() * sum, type = kinds[0];
      for (const k of kinds) { if (x < w[k]) { type = k; break; } x -= w[k]; }
      list.push({ type, flash: i === 3 || i === 10 || i === 17 || (!CLASSIC && i === 24) });
    }
    return list;
  }

  // the power-up a flashing tank leaves behind is decided up front, so a daily plays out the same for everyone
  function powerPlan() {
    powerQueue = [];
    powerSpots = [];
    for (let i = 0; i < 6; i++) {
      const pool = POWERS.filter((p) => p !== 'tank' || wrand() < 0.5);
      powerQueue.push(wpick(pool.length ? pool : POWERS));
      powerSpots.push([1 + Math.floor(wrand() * (COLS - 2)), 1 + Math.floor(wrand() * (ROWS - 3))]);
    }
    powerAt = 0;
  }

  function newTank(c, r, type) {
    const cfg = FOE[type];
    const boost = CLASSIC ? 1 : 1 + Math.min(0.45, (stage - 1) * 0.03);
    return {
      x: c * TS, y: r * TS, dir: 2, turret: Math.PI, type, hp: cfg.hp, maxHp: cfg.hp,
      speed: cfg.speed * boost, bulletSpeed: cfg.bullet * boost, shots: 0, dead: false,
      spawn: 1.1, moveT: 0, fireT: wr(0.6, 1.6), tread: 0, slide: 0, slideDir: 2, flash: false,
      hunter: wrand() < (CLASSIC ? 0.10 + Math.min(0.12, stage * 0.012) : 0.12 + Math.min(0.16, stage * 0.012)),
    };
  }

  function startStage(n) {
    stage = n;
    buildStage(n);
    enemies = [];
    bullets = [];
    powers = [];
    queue = enemyQueue(n);
    powerPlan();
    spawnT = 0.6;
    spawnSlot = 0;
    freezeT = 0;
    clearT = 0;
    respawnPlayer(true);
    banner = { text: CLASSIC ? `STAGE ${n}/${FINAL_STAGE}` : `STAGE ${n}`, t: 0 };
    Sound.arp([262, 330, 392, 523], 0.09, 'square', 0.035);
  }

  function respawnPlayer(fresh) {
    const keep = player || {};
    player = {
      x: PLAYER_SPAWN[0] * TS, y: PLAYER_SPAWN[1] * TS, dir: 0, turret: 0, type: 'player',
      hp: 1, speed: 148, bulletSpeed: 320, shots: 0, dead: false, alive: true,
      spawn: 1, invuln: 0, shield: fresh ? 3 : 2.2, gun: fresh ? (keep.gun || 0) : 0,
      fireT: 0, tread: 0, slide: 0, slideDir: 0, respawn: 0,
    };
    applyGun();
  }

  function applyGun() {
    player.bulletSpeed = [320, 470, 470, 500][player.gun];
    player.maxShots = player.gun >= 2 ? 2 : 1;
    player.strong = player.gun >= 3;
  }

  function newGame() {
    wrand = DAILY ? Daily.rng('tanks') : Math.random;
    score = 0; lives = 3; kills = 0; time = 0; flash = 0; shake = 0;
    particles = []; booms = []; popups = [];
    player = null;
    enemies = []; bullets = []; powers = [];
    startStage(1);
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    heldOrder.length = 0;
    newGame();
    state = 'play';
    if (window.Leaderboard) Leaderboard.startRun(BOARD);
  }

  // ---------------------------------------------------------------------------
  // Scoring and effects
  // ---------------------------------------------------------------------------
  const mult = () => (CLASSIC ? 1 : 1 + (stage - 1) * 0.15);

  function addScore(n, x, y) {
    const pts = Math.max(10, Math.round((n * mult()) / 10) * 10);
    score += pts;
    if (x !== undefined) popups.push({ x, y, text: String(pts), t: 0 });
    if (score > high) { high = score; store.set(Arcade.modeKey('tanks.high'), high); }
    return pts;
  }

  function spark(x, y, color, n, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(30, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.2, 0.55), c: color, s: rand(2, 4), g: 0 });
    }
  }

  function chunks(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(60, 220);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 90, t: 0, life: rand(0.35, 0.8), c: i % 3 ? '#b5542a' : '#e0834a', s: rand(3, 6), g: 620 });
    }
  }

  const boom = (x, y, size) => booms.push({ x, y, size, t: 0, life: size > 40 ? 0.55 : 0.35 });

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------
  function shoot(t, fromPlayer) {
    const limit = fromPlayer ? player.maxShots : (t.type === 'shooter' ? 2 : 1);
    if (t.shots >= limit) return;
    const [dx, dy] = DIRV[t.dir];
    t.shots++;
    bullets.push({
      x: t.x + TANK / 2 - BULLET / 2 + dx * (TANK / 2 - 2), y: t.y + TANK / 2 - BULLET / 2 + dy * (TANK / 2 - 2),
      dx, dy, speed: t.bulletSpeed, owner: t, player: !!fromPlayer, strong: !!(fromPlayer && player.strong), dead: false, t: 0,
    });
    if (fromPlayer) Sound.tone(560, 190, 0.08, 'square', 0.026);
    else Sound.tone(340, 150, 0.07, 'square', 0.014);
  }

  function breakBrick(i, sc, sr, b) {
    const bit = (sr & 1) * 2 + (sc & 1);
    let mask = 1 << bit;
    // a shot chews the whole half-tile face it runs into; an upgraded gun takes the lot
    if (b.strong) mask = 15;
    else if (b.dx) mask |= 1 << (bit ^ 2);
    else mask |= 1 << (bit ^ 1);
    brick[i] &= ~mask;
    if (!brick[i]) tiles[i] = T.EMPTY;
    chunks((sc >> 1) * TS + TS / 2, (sr >> 1) * TS + TS / 2, b.strong ? 9 : 5);
    Sound.noise(0.07, 0.05, 0, 2000);
  }

  function hitBase() {
    if (!baseAlive) return;
    baseAlive = false;
    tiles[baseIdx] = T.WRECK;
    boom(BASE_C * TS + TS / 2, BASE_R * TS + TS / 2, 70);
    spark(BASE_C * TS + TS / 2, BASE_R * TS + TS / 2, '#ffb347', 40, 300);
    flash = 0.5; shake = 16;
    Sound.noise(1.3, 0.24, 0, 420);
    Sound.tone(220, 40, 1.1, 'sawtooth', 0.05);
    toast('THE EAGLE IS DOWN');
    setTimeout(() => { if (state === 'play') endGame(false); }, 1400);
  }

  function bulletMap(b) {
    const sc0 = Math.floor(b.x / HALF), sc1 = Math.floor((b.x + BULLET - 0.01) / HALF);
    const sr0 = Math.floor(b.y / HALF), sr1 = Math.floor((b.y + BULLET - 0.01) / HALF);
    for (let sr = sr0; sr <= sr1; sr++) {
      for (let sc = sc0; sc <= sc1; sc++) {
        if (!subSolid(sc, sr, true)) continue;
        b.dead = true;
        if (sc < 0 || sr < 0 || sc >= COLS * 2 || sr >= ROWS * 2) { spark(b.x + 4, b.y + 4, '#ffd9a0', 4, 90); return true; }
        const i = idx(sc >> 1, sr >> 1);
        if (tiles[i] === T.BRICK) breakBrick(i, sc, sr, b);
        // your own shells bounce off the eagle — only the enemy can take it down
        else if (tiles[i] === T.BASE) {
          if (b.player) { spark(b.x + 4, b.y + 4, '#e8d9a0', 6, 130); Sound.tone(900, 600, 0.06, 'triangle', 0.025); }
          else hitBase();
        }
        else if (tiles[i] === T.STEEL) {
          if (b.strong) { tiles[i] = T.EMPTY; spark((sc >> 1) * TS + TS / 2, (sr >> 1) * TS + TS / 2, '#e6eef7', 12, 200); Sound.noise(0.18, 0.08, 0, 3000); }
          else { spark(b.x + 4, b.y + 4, '#e6eef7', 6, 140); Sound.tone(1500, 900, 0.05, 'square', 0.03); }
        }
        return true;
      }
    }
    return false;
  }

  function damageEnemy(e) {
    e.hp--;
    if (e.hp > 0) {
      spark(e.x + TANK / 2, e.y + TANK / 2, '#fff', 6, 150);
      Sound.tone(900, 500, 0.06, 'square', 0.025);
      return;
    }
    e.dead = true;
    kills++;
    const pts = addScore(FOE[e.type].points, e.x + TANK / 2, e.y);
    boom(e.x + TANK / 2, e.y + TANK / 2, 52);
    spark(e.x + TANK / 2, e.y + TANK / 2, '#ffb347', 16, 240);
    Sound.noise(0.32, 0.11, 0, 900);
    if (e.flash) dropPower();
    return pts;
  }

  function dropPower() {
    const type = powerQueue[powerAt % powerQueue.length];
    let [c, r] = powerSpots[powerAt % powerSpots.length];
    powerAt++;
    // never drop it on top of the eagle
    if (Math.abs(c - BASE_C) <= 1 && r >= ROWS - 2) r -= 3;
    powers.push({ x: c * TS + 4, y: r * TS + 4, type, t: 0, life: 22 });
    Sound.arp([660, 990], 0.08, 'triangle', 0.035);
    toast('POWER-UP DROPPED');
  }

  function grabPower(p) {
    addScore(500, p.x + 16, p.y);
    Sound.arp([660, 880, 1320, 1760], 0.055, 'triangle', 0.05);
    toast(POWER_NAMES[p.type]);
    if (p.type === 'helmet') player.shield = Math.max(player.shield, 10);
    else if (p.type === 'star') { player.gun = Math.min(3, player.gun + 1); applyGun(); }
    else if (p.type === 'tank') lives++;
    else if (p.type === 'clock') freezeT = 10;
    else if (p.type === 'shovel') {
      for (const [c, r] of NEST) { tiles[idx(c, r)] = T.STEEL; brick[idx(c, r)] = 0; }
      shovelT = 20;
    } else if (p.type === 'grenade') {
      flash = 0.35; shake = 10;
      for (const e of enemies) { if (e.dead) continue; e.hp = 1; damageEnemy(e); }
      Sound.noise(0.8, 0.2, 0, 700);
    }
  }

  // the shovel's steel reverts to a full set of brick walls when it runs out
  function endShovel() {
    for (const [c, r] of NEST) { tiles[idx(c, r)] = T.BRICK; brick[idx(c, r)] = 15; }
    shovelT = 0;
  }

  function killPlayer() {
    if (!player.alive || player.spawn > 0 || player.shield > 0 || player.invuln > 0) return;
    player.alive = false;
    player.respawn = 1.5;
    lives--;
    flash = 0.3; shake = 12;
    boom(player.x + TANK / 2, player.y + TANK / 2, 64);
    spark(player.x + TANK / 2, player.y + TANK / 2, '#e8c060', 26, 300);
    Sound.noise(0.8, 0.18, 0, 600);
    for (const b of bullets) if (b.player) b.dead = true;
    if (lives <= 0) setTimeout(() => { if (state === 'play') endGame(false); }, 1300);
  }

  // ---------------------------------------------------------------------------
  // Stage flow
  // ---------------------------------------------------------------------------
  const wallsLeft = () => NEST.filter(([c, r]) => tiles[idx(c, r)] === T.STEEL || (tiles[idx(c, r)] === T.BRICK && brick[idx(c, r)])).length;
  const foesLeft = () => queue.length + enemies.filter((e) => !e.dead).length;

  function stageClear() {
    const walls = wallsLeft();
    const bonus = addScore(lives * 300 + walls * 100 + (CLASSIC ? 0 : stage * 200));
    toast(`STAGE ${stage} CLEARED · +${bonus.toLocaleString()}`);
    Sound.arp([523, 659, 784, 1046, 1318], 0.09, 'square', 0.045);
    if (CLASSIC && stage >= FINAL_STAGE) return endGame(true);
    startStage(stage + 1);
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    $('o-score').textContent = score.toLocaleString();
    $('o-stage').textContent = CLASSIC ? `${Math.min(stage, FINAL_STAGE)}/${FINAL_STAGE}` : stage;
    $('o-kills').textContent = kills.toLocaleString();
    $('o-base').textContent = baseAlive ? 'SAFE' : 'LOST';
    Arcade.endScreen(won, won ? 'Fifteen stages held and the eagle still stands.' : baseAlive ? 'Out of tanks.' : 'The eagle fell.');
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won, time: Math.round(time) }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();
  const heldOrder = [];

  function pressedDir() {
    for (const k of DIRKEYS) {
      const on = keys.has(k);
      const at = heldOrder.indexOf(k);
      if (on && at < 0) heldOrder.push(k);
      else if (!on && at >= 0) heldOrder.splice(at, 1);
    }
    return heldOrder.length ? DIRKEYS.indexOf(heldOrder[heldOrder.length - 1]) : -1;
  }

  function updatePlayer(dt) {
    if (!player.alive) {
      if (lives <= 0) return;
      player.respawn -= dt;
      if (player.respawn <= 0) respawnPlayer(false);
      return;
    }
    if (player.spawn > 0) { player.spawn -= dt; return; }
    if (player.shield > 0) player.shield -= dt;
    if (player.invuln > 0) player.invuln -= dt;
    if (player.fireT > 0) player.fireT -= dt;

    const want = pressedDir();
    const onIce = tileUnder(player) === T.ICE;
    const ice = onIce ? 1.35 : 1;
    let driving = false;
    if (want >= 0) {
      face(player, want);
      driving = moveTank(player, player.speed * ice * dt);
      player.slide = onIce ? 0.5 : 0;
      player.slideDir = player.dir;
    } else if (player.slide > 0) {
      // ice keeps you going for a moment after you let go
      player.slide -= dt;
      player.dir = player.slideDir;
      driving = moveTank(player, player.speed * ice * dt * Math.min(1, player.slide * 2.2));
    }
    spinTurret(player, dt);
    if (driving) {
      player.tread += dt * player.speed;
      if (player.tread > 26) { player.tread -= 26; Sound.tone(76, 68, 0.05, 'square', 0.007); }
    }
    if (keys.has('fire') && player.fireT <= 0) { shoot(player, true); player.fireT = player.gun >= 1 ? 0.16 : 0.24; }
  }

  // only a few tanks per stage actually hunt the eagle; the rest chase the player or roam
  function enemyAim(e) {
    const seen = player && player.alive && !player.spawn && Math.hypot(player.x - e.x, player.y - e.y) < TS * 5;
    let tx, ty;
    if (e.hunter) { tx = BASE_C * TS; ty = BASE_R * TS; }
    else if (seen) { tx = player.x; ty = player.y; }
    else return Math.floor(wrand() * 4);
    const dx = tx - e.x, dy = ty - e.y;
    let dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    if (wrand() < 0.38) dir = (dir + (wrand() < 0.5 ? 1 : 3)) % 4;
    return dir;
  }

  function updateEnemy(e, dt) {
    if (e.spawn > 0) { e.spawn -= dt; return; }
    if (freezeT > 0) return;
    e.moveT -= dt;
    if (e.moveT <= 0) {
      e.moveT = wr(0.45, 1.9);
      face(e, wrand() < 0.6 ? enemyAim(e) : Math.floor(wrand() * 4));
    }
    if (!moveTank(e, e.speed * (tileUnder(e) === T.ICE ? 1.35 : 1) * dt)) {
      e.moveT = 0;
      face(e, Math.floor(wrand() * 4));
    } else {
      e.tread += dt * e.speed;
    }
    e.fireT -= dt;
    // a tank that lines up on the player or the eagle takes the shot
    const lined = player && player.alive && ((e.dir % 2 === 0 && Math.abs(e.x - player.x) < TS * 0.7) || (e.dir % 2 === 1 && Math.abs(e.y - player.y) < TS * 0.7));
    if (e.fireT <= 0 || (lined && e.fireT < 0.35 && wrand() < 0.12)) {
      const [lo, hi] = FOE[e.type].reload;
      e.fireT = wr(lo, hi) / (CLASSIC ? 1 : 1 + Math.min(0.6, stage * 0.04));
      shoot(e, false);
    }
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      let left = b.speed * dt;
      while (left > 0 && !b.dead) {
        const step = Math.min(6, left);
        b.x += b.dx * step; b.y += b.dy * step;
        left -= step;
        b.t += dt;
        if (bulletMap(b)) break;
        // bullets cancel each other out
        for (const o of bullets) {
          if (o === b || o.dead || o.player === b.player) continue;
          if (Math.abs(o.x - b.x) < BULLET && Math.abs(o.y - b.y) < BULLET) {
            o.dead = true; b.dead = true;
            spark(b.x + 4, b.y + 4, '#fff', 6, 120);
            break;
          }
        }
        if (b.dead) break;
        if (b.player) {
          for (const e of enemies) {
            if (e.dead || e.spawn > 0) continue;
            if (b.x + BULLET > e.x + 3 && b.x < e.x + TANK - 3 && b.y + BULLET > e.y + 3 && b.y < e.y + TANK - 3) { b.dead = true; damageEnemy(e); break; }
          }
        } else if (player && player.alive && !player.spawn) {
          if (b.x + BULLET > player.x + 3 && b.x < player.x + TANK - 3 && b.y + BULLET > player.y + 3 && b.y < player.y + TANK - 3) {
            b.dead = true;
            if (player.shield > 0 || player.invuln > 0) { spark(b.x + 4, b.y + 4, '#7fd4ff', 10, 180); Sound.tone(1100, 400, 0.12, 'sine', 0.03); }
            else killPlayer();
          }
        }
      }
    }
    for (const b of bullets) if (b.dead && b.owner) b.owner.shots = Math.max(0, b.owner.shots - 1);
    bullets = bullets.filter((b) => !b.dead);
  }

  function updateSpawns(dt) {
    if (!queue.length) return;
    const cap = CLASSIC ? Math.min(6, 3 + Math.floor(stage / 4)) : Math.min(7, 4 + Math.floor(stage / 3));
    if (enemies.filter((e) => !e.dead).length >= cap) return;
    spawnT -= dt;
    if (spawnT > 0) return;
    const [c, r] = SPAWNS[spawnSlot % SPAWNS.length];
    spawnSlot++;
    const busy = enemies.some((e) => !e.dead && Math.abs(e.x - c * TS) < TANK && Math.abs(e.y - r * TS) < TANK);
    if (busy) { spawnT = 0.4; return; }
    const next = queue.shift();
    const e = newTank(c, r, next.type);
    e.flash = next.flash;
    enemies.push(e);
    spawnT = Math.max(0.9, (CLASSIC ? 3.4 : 3.2) - stage * 0.12) * wr(0.7, 1.3);
    Sound.tone(220, 660, 0.25, 'sine', 0.02);
  }

  function update(dt) {
    time += dt;
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.g || 0) * dt; p.vx *= 0.97; }
    particles = particles.filter((p) => p.t < p.life);
    for (const b of booms) b.t += dt;
    booms = booms.filter((b) => b.t < b.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.8);
    if (flash > 0) flash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
    if (state !== 'play') return;

    if (freezeT > 0) freezeT -= dt;
    if (shovelT > 0) {
      shovelT -= dt;
      if (shovelT <= 0) endShovel();
    }

    updatePlayer(dt);
    for (const e of enemies) if (!e.dead) { updateEnemy(e, dt); spinTurret(e, dt); }
    updateBullets(dt);
    updateSpawns(dt);
    enemies = enemies.filter((e) => !e.dead);

    for (const p of powers) {
      p.t += dt;
      p.life -= dt;
      if (player && player.alive && !player.spawn && p.x < player.x + TANK && p.x + 32 > player.x && p.y < player.y + TANK && p.y + 32 > player.y) { p.got = true; grabPower(p); }
    }
    powers = powers.filter((p) => !p.got && p.life > 0);

    if (!queue.length && !enemies.length && baseAlive && player.alive) {
      clearT += dt;
      if (clearT > 1.4) { clearT = 0; stageClear(); }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawTile(t, i, c, r) {
    const x = c * TS, y = r * TS;
    if (t === T.BRICK) {
      const m = brick[i];
      for (let q = 0; q < 4; q++) {
        if (!((m >> q) & 1)) continue;
        const qx = (q & 1) * HALF, qy = (q >> 1) * HALF;
        ctx.drawImage(brickTile, qx, qy, HALF, HALF, x + qx, y + qy, HALF, HALF);
      }
    } else if (t === T.STEEL) ctx.drawImage(steelTile, x, y);
    else if (t === T.WATER) ctx.drawImage(waterTiles[Math.floor(time * 3) % 3], x, y);
    else if (t === T.ICE) ctx.drawImage(iceTile, x, y);
  }

  function drawEagle(x, y, alive) {
    const px = TS / 10, pal = alive ? EAGLE_P : EAGLE_DEAD;
    ctx.fillStyle = alive ? '#2a2415' : '#1a1a1a';
    ctx.fillRect(x, y, TS, TS);
    for (let r = 0; r < EAGLE.length; r++) {
      for (let c = 0; c < EAGLE[r].length; c++) {
        const ch = EAGLE[r][c];
        if (ch === '.') continue;
        ctx.fillStyle = pal[ch];
        ctx.fillRect(x + c * px, y + r * px, px, px);
      }
    }
    if (!alive && Math.floor(time * 8) % 2) {
      ctx.fillStyle = '#ff8f4a';
      ctx.fillRect(x + TS * 0.35, y + TS * 0.15, TS * 0.3, TS * 0.2);
    }
  }

  function drawTank(t, isPlayer) {
    const cx = t.x + TANK / 2, cy = t.y + TANK / 2;
    let body, trim;
    if (isPlayer) {
      body = ['#e8c060', '#f0d080', '#ffe9a8', '#fff4d0'][t.gun];
      trim = '#7a5410';
    } else if (t.type === 'armour') {
      body = ARMOUR_COLORS[clamp(t.hp, 1, 4) - 1];
      trim = '#1b3a1f';
    } else {
      body = FOE[t.type].body;
      trim = FOE[t.type].trim;
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t.dir * (Math.PI / 2));
    const h = TANK / 2;
    // treads
    ctx.fillStyle = '#232830';
    ctx.fillRect(-h + 2, -h + 3, 9, TANK - 6);
    ctx.fillRect(h - 11, -h + 3, 9, TANK - 6);
    ctx.fillStyle = trim;
    const phase = Math.floor(t.tread / 5) % 3;
    for (let y = -h + 4 + phase * 2; y < h - 4; y += 6) {
      ctx.fillRect(-h + 3, y, 7, 2);
      ctx.fillRect(h - 10, y, 7, 2);
    }
    // hull
    ctx.fillStyle = body;
    ctx.fillRect(-h + 10, -h + 6, TANK - 20, TANK - 12);
    ctx.fillStyle = trim;
    ctx.fillRect(-h + 10, h - 9, TANK - 20, 3);
    ctx.restore();

    // turret rotates toward the way the tank is facing
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t.turret);
    ctx.fillStyle = body;
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillRect(-6, -6, 12, 4);
    ctx.fillStyle = trim;
    ctx.fillRect(-7, -7, 14, 1.5);
    ctx.fillStyle = '#2b3038';
    ctx.fillRect(-2.5, -h - 2, 5, h + 2);
    ctx.fillStyle = '#767f8b';
    ctx.fillRect(-1.5, -h - 1, 2, h);
    ctx.restore();

    if (!isPlayer && t.flash && Math.floor(time * 7) % 2) {
      ctx.fillStyle = 'rgba(255,60,90,0.55)';
      ctx.fillRect(t.x + 4, t.y + 4, TANK - 8, TANK - 8);
    }
  }

  function drawSpawnStar(t) {
    const k = 1 - t.spawn / (t.type === 'player' ? 1 : 1.1);
    const s = 6 + Math.abs(Math.sin(k * 9)) * 13;
    ctx.save();
    ctx.translate(t.x + TANK / 2, t.y + TANK / 2);
    ctx.rotate(k * 11);
    ctx.fillStyle = k > 0.6 ? '#fff' : '#7fd4ff';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(-s, -2, s * 2, 4);
      ctx.rotate(Math.PI / 4);
    }
    ctx.restore();
  }

  function drawShield(t) {
    ctx.save();
    ctx.translate(t.x + TANK / 2, t.y + TANK / 2);
    ctx.rotate(time * 4);
    ctx.strokeStyle = Math.floor(time * 12) % 2 ? '#bff0ff' : '#3fa9f5';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * TAU;
      const x = Math.cos(a) * (TANK / 2 + 3), y = Math.sin(a) * (TANK / 2 + 3);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05050b';
    ctx.fillRect(0, 0, W, H);
    const sx = shake ? rand(-shake, shake) * 0.3 : 0;
    const sy = shake ? rand(-shake, shake) * 0.3 : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (offX + sx), DPR * (offY + sy));
    ctx.save();

    // the ground around the battlefield
    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#12121f'); bg.addColorStop(1, '#0a0a12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);

    ctx.translate(0, fieldY);
    ctx.beginPath(); ctx.rect(-6, -6, FW + 12, FIELD_H + 12); ctx.clip();

    // battlefield floor
    ctx.fillStyle = '#1b1b26';
    ctx.fillRect(-6, -6, FW + 12, FIELD_H + 12);
    ctx.fillStyle = '#101019';
    ctx.fillRect(0, 0, FW, FIELD_H);
    ctx.strokeStyle = 'rgba(217,160,102,0.10)';
    ctx.lineWidth = 1;
    for (let c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(c * TS, 0); ctx.lineTo(c * TS, FIELD_H); ctx.stroke(); }
    for (let r = 1; r < ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r * TS); ctx.lineTo(FW, r * TS); ctx.stroke(); }

    if (!tiles) { ctx.restore(); return; }

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r), t = tiles[i];
        if (t === T.BUSH || t === T.EMPTY) continue;
        if (t === T.BASE || t === T.WRECK) { drawEagle(c * TS, r * TS, t === T.BASE); continue; }
        drawTile(t, i, c, r);
      }
    }

    // power-ups
    for (const p of powers) {
      if (p.life < 5 && Math.floor(p.life * 8) % 2) continue;
      ctx.save();
      ctx.translate(p.x + 16, p.y + 16);
      ctx.scale(1 + Math.sin(p.t * 5) * 0.06, 1 + Math.sin(p.t * 5) * 0.06);
      ctx.fillStyle = '#0d0d18';
      ctx.fillRect(-17, -17, 34, 34);
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
      ctx.strokeRect(-17, -17, 34, 34);
      ctx.drawImage(iconTiles[p.type], -16, -16, 32, 32);
      ctx.restore();
    }

    // tanks
    for (const e of enemies) {
      if (e.dead) continue;
      if (e.spawn > 0) { drawSpawnStar(e); continue; }
      drawTank(e, false);
    }
    if (player && player.alive) {
      if (player.spawn > 0) drawSpawnStar(player);
      else {
        drawTank(player, true);
        if (player.shield > 0 && (player.shield > 2.5 || Math.floor(player.shield * 6) % 2)) drawShield(player);
      }
    }

    // bullets
    for (const b of bullets) {
      ctx.fillStyle = b.strong ? '#ff8f4a' : b.player ? '#fff6d8' : '#ffd0d0';
      ctx.fillRect(b.x, b.y, BULLET, BULLET);
      ctx.fillStyle = b.player ? '#ffd23f' : '#ff7a6a';
      ctx.fillRect(b.x - b.dx * 6, b.y - b.dy * 6, BULLET - Math.abs(b.dx) * 4, BULLET - Math.abs(b.dy) * 4);
    }

    // bushes hide whatever is underneath
    ctx.globalAlpha = 0.88;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (tiles[idx(c, r)] === T.BUSH) ctx.drawImage(bushTile, c * TS, r * TS);
    ctx.globalAlpha = 1;

    // debris and explosions
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    for (const b of booms) {
      const k = b.t / b.life;
      const r0 = b.size * (0.35 + k * 0.85);
      ctx.globalAlpha = Math.max(0, 1 - k);
      const rings = [['#fff2c0', 0.35], ['#ffb347', 0.62], ['#ff5c3a', 1]];
      for (const [col, f] of rings) {
        ctx.fillStyle = col;
        const s = r0 * f;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + k * 2;
          ctx.fillRect(b.x + Math.cos(a) * s * 0.7 - s * 0.22, b.y + Math.sin(a) * s * 0.7 - s * 0.22, s * 0.44, s * 0.44);
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.font = '11px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of popups) {
      ctx.globalAlpha = 1 - p.t / 0.8;
      ctx.fillStyle = '#fff';
      ctx.fillText(p.text, p.x, p.y - p.t * 34);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // banners and overlays sit on the whole canvas
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.7 ? (2.2 - banner.t) / 0.5 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff';
      ctx.font = '22px "Press Start 2P", monospace';
      ctx.shadowColor = '#d9a066'; ctx.shadowBlur = 18;
      ctx.fillText(banner.text, FW / 2, fieldY + FIELD_H / 2);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (freezeT > 0 && state === 'play') {
      ctx.fillStyle = 'rgba(120,200,255,0.10)';
      ctx.fillRect(0, 0, FW, FH);
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,220,180,${Math.min(0.55, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000b';
      ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = '#d9a066';
      ctx.font = '24px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < FH; y += 4) ctx.fillRect(0, y, FW, 1);
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
    set('lives', '▮'.repeat(Math.max(0, Math.min(lives || 0, 8))));
    set('stage', state === 'title' ? '' : `STAGE ${stage}${CLASSIC ? '/' + FINAL_STAGE : ''}`);
    set('foes', state === 'title' ? '' : `ENEMIES ${foesLeft()}`);
    const walls = wallsLeft();
    const baseEl = $('base');
    set('base', state === 'title' ? '' : baseAlive ? (shovelT > 0 ? `BASE STEEL ${Math.ceil(shovelT)}` : `BASE ${walls}/5`) : 'BASE DOWN');
    baseEl.className = !baseAlive ? 'gone' : walls <= 2 ? 'hurt' : '';
    const bits = [];
    if (player && player.gun) bits.push(['', 'GUN II', 'GUN III', 'GUN IV'][player.gun]);
    if (player && player.shield > 0) bits.push(`SHIELD ${Math.ceil(player.shield)}`);
    if (freezeT > 0) bits.push(`FROZEN ${Math.ceil(freezeT)}`);
    set('power', bits.join(' · '));
  }

  const KEYMAP = {
    arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
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
  window.addEventListener('blur', () => keys.clear());

  bindPadButtons(keys);
  canvas.addEventListener('pointerdown', () => { if (state === 'play' && paused) paused = false; });

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // title-screen legend
  [['lg-brick', brickTile], ['lg-steel', steelTile], ['lg-water', waterTiles[0]], ['lg-bush', bushTile], ['lg-ice', iceTile]].forEach(([id, tile]) => {
    const g = $(id).getContext('2d');
    g.imageSmoothingEnabled = false;
    if (id === 'lg-bush') { g.fillStyle = '#101019'; g.fillRect(0, 0, 20, 20); }
    g.drawImage(tile, 0, 0, 20, 20);
  });
  for (const name of POWERS) {
    const g = $('lg-' + name).getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0d0d18';
    g.fillRect(0, 0, 20, 20);
    g.drawImage(iconTiles[name], 2, 2, 16, 16);
  }

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'tanks',
      start,
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      peek: () => ({
        state, paused, score, lives, stage, enemies: foesLeft(), base: baseAlive, walls: wallsLeft(),
        alive: enemies.filter((e) => !e.dead).length, queue: queue ? queue.length : 0, kills,
        gun: player ? player.gun : 0, shield: player ? Math.max(0, Math.round(player.shield)) : 0,
        freeze: Math.max(0, Math.round(freezeT)), bullets: bullets.length, powers: powers.length,
        playerX: player ? Math.round(player.x) : 0, playerY: player ? Math.round(player.y) : 0, time: Math.round(time),
      }),
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'lives') lives = v;
        else if (k === 'stage') startStage(v);
        else if (k === 'gun') { player.gun = v; applyGun(); }
        else if (k === 'queue') queue = queue.slice(0, v);
      },
      press: (k) => keys.add(k),
      release: (k) => keys.delete(k),
      foes: () => enemies.filter((e) => !e.dead).map((e) => ({ x: Math.round(e.x), y: Math.round(e.y), type: e.type, hp: e.hp, flash: e.flash, spawning: e.spawn > 0 })),
      power: (type) => grabPower({ x: player.x, y: player.y, type }),
      clear: () => { queue = []; for (const e of enemies) { e.dead = true; } enemies = []; },
      win: () => {
        if (!CLASSIC) return false;
        stage = FINAL_STAGE;
        queue = [];
        enemies = [];
        stageClear();
        return true;
      },
    };
  }

  // attract mode: a quiet battlefield sits behind the title screen
  newGame();
  state = 'title';
  player.spawn = 0;
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
