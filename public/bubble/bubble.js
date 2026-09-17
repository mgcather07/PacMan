(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600, FH = 920;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('bubble') || (CLASSIC ? 'bubble-classic' : 'bubble');
  const FINAL_LEVEL = 20; // classic: clear twenty walls to win

  // Hex grid. Every row holds COLS cells; odd rows sit half a bubble to the right, so when the
  // ceiling drops a row every bubble slides down one index and flips to the other offset.
  const R = 20, D = R * 2, COLS = 14;
  const ROW_H = (D * Math.sqrt(3)) / 2;
  const WALL_L = (FW - (COLS * D + R)) / 2, WALL_R = WALL_L + COLS * D + R;
  const TOP = 118;
  const LAUNCH_X = FW / 2, LAUNCH_Y = FH - 84, MUZZLE = 30;
  const MAX_ROWS = 21, DEATH_ROW = Math.floor((LAUNCH_Y - 66 - TOP) / ROW_H); // 18
  const DEATH_Y = TOP + DEATH_ROW * ROW_H - R;
  const SPEED = 1150, MAX_COMBO = 8;
  const PALETTE = ['#ff4d6d', '#3fd8ff', '#ffd23f', '#7dff6a', '#c77dff', '#ff9f40', '#f2f2ff'];
  const ACCENT = '#ff6bd6';
  const AIM_MIN = -Math.PI + 0.14, AIM_MAX = -0.14;

  // world randomness (wall colours, the bubble sequence, specials) is seeded for daily challenges
  let wrand = Math.random;

  let scale = 1, offX = 0, offY = 0;
  const view = setupCanvas(canvas, (v) => {
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
  });
  const ctx = view.ctx;

  let state = 'title';
  let paused = false;
  let grid, fly, cur, next, queue, qi, rowStream, ri;
  let score, depth, level, popped, shots, combo, maxCombo, dropProg, time;
  let particles, falls, popups, rings;
  let laser, slow, aim, banner, flash, shake, dropAnim, hinted, didPop;
  let high = store.get(Arcade.modeKey('bubble.high'), 0);

  // ---------------------------------------------------------------------------
  // Grid geometry
  // ---------------------------------------------------------------------------
  const oddRow = (r) => r % 2 === 1;
  const cellX = (r, c) => WALL_L + R + c * D + (oddRow(r) ? R : 0);
  const cellY = (r) => TOP + r * ROW_H;
  const at = (r, c) => (r >= 0 && r < MAX_ROWS && c >= 0 && c < COLS ? grid[r][c] : null);
  const emptyRow = () => new Array(COLS).fill(null);
  const key = (r, c) => r * COLS + c;

  function neighbors(r, c) {
    const d = oddRow(r) ? 0 : -1;
    return [[r, c - 1], [r, c + 1], [r - 1, c + d], [r - 1, c + d + 1], [r + 1, c + d], [r + 1, c + d + 1]];
  }

  const colorOf = (b) => (b.color >= 0 ? PALETTE[b.color] : ACCENT);
  const colorCount = () => (CLASSIC ? 3 + Math.min(4, Math.floor((level - 1) / 4)) : clamp(4 + Math.floor(depth / 10), 4, 7));
  // Infinite: the ceiling comes down every few shots, for ever.
  // Classic: it only comes down when you waste a shot, so a clean run clears the wall.
  const dropEvery = () => (CLASSIC ? Math.max(3, 6 - Math.floor(level / 6)) : Math.max(5, 9 - Math.floor(depth / 12)));

  function eachBubble(fn) {
    for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) fn(grid[r][c], r, c);
  }
  function countBubbles() {
    let n = 0;
    eachBubble(() => { n++; });
    return n;
  }
  function presentColors() {
    const set = new Set();
    eachBubble((b) => { if (b.color >= 0) set.add(b.color); });
    return [...set].sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------------------
  // The seeded world: one fixed bubble sequence and one fixed stack of rows per game
  // ---------------------------------------------------------------------------
  function makeStreams() {
    queue = []; qi = 0;
    for (let i = 0; i < 900; i++) {
      const roll = wrand(), c = Math.floor(wrand() * 7);
      if (i > 2 && roll < 0.028) queue.push({ kind: 'bomb' });
      else if (i > 2 && roll < 0.07) queue.push({ kind: 'rainbow' });
      else queue.push({ kind: 'color', c });
    }
    rowStream = []; ri = 0;
    for (let i = 0; i < 260; i++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        const gift = wrand() < 0.022 ? (wrand() < 0.5 ? 'laser' : 'aim') : null;
        row.push({ c: Math.floor(wrand() * 7), gift });
      }
      rowStream.push(row);
    }
  }

  // A colour token always becomes a colour that is still on the wall, so the wall stays clearable.
  function resolveToken(tok) {
    if (tok.kind !== 'color') return { ...tok };
    const present = presentColors();
    return { kind: 'color', c: present.length ? present[tok.c % present.length] : tok.c % colorCount() };
  }
  const takeToken = () => queue[qi++ % queue.length];

  function newRow() {
    const src = rowStream[ri++ % rowStream.length];
    const n = colorCount();
    return src.map((s) => ({ color: s.c % n, gift: s.gift }));
  }

  // ---------------------------------------------------------------------------
  // Classic walls: twenty hand-shaped patterns over the hex grid
  // ---------------------------------------------------------------------------
  const SHAPES = [
    { rows: 4, fn: () => true },                                                              // 1 slab
    { rows: 6, fn: (u, v, r, c) => (r + c) % 2 === 0 },                                       // 2 checker
    { rows: 7, fn: (u, v) => Math.abs(u - 0.5) <= v * 0.5 + 0.1 },                            // 3 pyramid
    { rows: 7, fn: (u, v) => Math.abs(u - 0.5) <= (1 - v) * 0.5 + 0.1 },                      // 4 funnel
    { rows: 8, fn: (u, v) => Math.abs(u - 0.5) * 1.1 + Math.abs(v - 0.5) <= 0.56 },           // 5 diamond
    { rows: 7, fn: (u) => Math.floor(u * 7) % 2 === 0 },                                      // 6 stripes
    { rows: 10, fn: (u, v) => { const lobe = (cx) => Math.hypot((u - cx) * 1.25, v - 0.18) <= 0.22; return lobe(0.31) || lobe(0.69) || (v >= 0.14 && Math.abs(u - 0.5) * 1.15 <= (1 - v) * 0.55); } }, // 7 heart
    { rows: 9, fn: (u, v) => Math.abs(u - v) < 0.14 || Math.abs(u - (1 - v)) < 0.14 },        // 8 cross
    { rows: 9, fn: (u, v) => { const d = Math.hypot((u - 0.5) * 1.5, v - 0.5); return d < 0.5 && d > 0.27; } }, // 9 ring
    { rows: 9, fn: (u, v) => Math.abs(v - (0.5 + 0.38 * Math.sin(u * Math.PI * 2))) < 0.2 },  // 10 zigzag
    { rows: 9, fn: (u, v) => Math.abs(u - 0.5) <= Math.abs(v - 0.5) * 0.9 + 0.1 },            // 11 hourglass
    { rows: 10, fn: (u, v) => (v < 0.5 ? Math.abs(u - 0.5) <= v * 0.95 + 0.06 : Math.abs(u - 0.5) < 0.2) }, // 12 arrow
    { rows: 10, fn: (u, v) => Math.abs(v - (0.5 + 0.33 * Math.sin(u * Math.PI * 3))) < 0.2 }, // 13 wave
    { rows: 9, fn: (u) => u < 0.3 || u > 0.7 },                                               // 14 wings
    { rows: 10, fn: (u, v, r, c) => !(r % 3 === 1 && c % 3 === 1) },                          // 15 lattice
    { rows: 11, fn: (u, v) => { const x = (u - 0.5) * 1.15, y = v - 0.5; return Math.hypot(x, y) <= 0.3 + 0.24 * Math.cos(5 * Math.atan2(y, x) + Math.PI / 2); } }, // 16 star
    { rows: 10, fn: (u, v) => v > 0.4 || Math.floor(u * 9) % 2 === 0 },                       // 17 castle
    { rows: 11, fn: (u, v) => { const d = Math.abs(u - 0.5) * 1.1 + Math.abs(v - 0.5); return d <= 0.62 && d >= 0.24; } }, // 18 jewel
    { rows: 11, fn: (u, v, r, c) => r % 4 === 0 || c % 4 === (r % 8 < 4 ? 0 : 2) },           // 19 maze
    { rows: 11, fn: () => true },                                                             // 20 the wall
  ];

  function buildShape(spec) {
    const cells = [];
    for (let r = 0; r < spec.rows; r++) {
      for (let c = 0; c < COLS; c++) {
        const u = (cellX(r, c) - WALL_L - R) / ((COLS - 1) * D);
        const v = spec.rows > 1 ? r / (spec.rows - 1) : 0;
        if (spec.fn(u, v, r, c)) cells.push([r, c]);
      }
    }
    if (!cells.length) return;
    const top = Math.min(...cells.map(([r]) => r)); // pull the shape up so it hangs from the ceiling
    const n = colorCount();
    for (const [r, c] of cells) {
      grid[r - top][c] = { color: Math.floor(wrand() * n), gift: wrand() < 0.03 ? (wrand() < 0.5 ? 'laser' : 'aim') : null };
    }
    cutFloaters(true); // safety net: a pattern island that never touched the ceiling
  }

  // ---------------------------------------------------------------------------
  // Rounds
  // ---------------------------------------------------------------------------
  function newGame() {
    wrand = DAILY ? Daily.rng('bubble') : Math.random;
    grid = Array.from({ length: MAX_ROWS }, emptyRow);
    score = 0; depth = 0; level = 1; popped = 0; shots = 0; combo = 0; maxCombo = 0; time = 0;
    dropProg = 0; laser = 0; slow = 0; flash = 0; shake = 0; dropAnim = 0; hinted = false;
    particles = []; falls = []; popups = []; rings = [];
    fly = null; banner = null; aim = -Math.PI / 2; didPop = false;
    makeStreams();
    if (CLASSIC) startLevel(1);
    else refill(5);
    cur = resolveToken(takeToken());
    next = resolveToken(takeToken());
  }

  function startLevel(n) {
    level = n;
    grid = Array.from({ length: MAX_ROWS }, emptyRow);
    buildShape(SHAPES[(n - 1) % SHAPES.length]);
    dropProg = 0;
    banner = { text: `LEVEL ${n}/${FINAL_LEVEL}`, t: 0 };
    Sound.arp([392, 523, 659], 0.09, 'square', 0.035);
  }

  function refill(rows) {
    for (let r = 0; r < rows; r++) grid[r] = newRow();
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

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    fly = null;
    $('o-score').textContent = score.toLocaleString();
    $('o-pop').textContent = popped.toLocaleString();
    $('o-combo').textContent = '×' + maxCombo;
    $('o-depth').textContent = CLASSIC ? `${Math.min(level, FINAL_LEVEL)}/${FINAL_LEVEL}` : String(depth);
    Arcade.endScreen(won, won ? 'All twenty walls cleared. Not one bubble left!' : '');
    $('over').hidden = false;
    if (!won) { Sound.noise(1.1, 0.22, 0, 600); flash = 0.4; shake = 14; }
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Scoring and effects
  // ---------------------------------------------------------------------------
  function addScore(n, x, y) {
    score += n;
    if (x !== undefined) popups.push({ x, y, text: '+' + n.toLocaleString(), t: 0 });
    if (score > high) { high = score; store.set(Arcade.modeKey('bubble.high'), high); }
    return n;
  }

  function burst(x, y, color, n = 10) {
    rings.push({ x, y, t: 0, life: 0.34, c: color });
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(60, 260);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rand(0.25, 0.6), c: Math.random() < 0.28 ? '#fff' : color, s: rand(2.5, 5) });
    }
  }

  function grantGift(g) {
    if (g === 'laser') { laser = Math.max(laser, 5); toast('⚡ LASER SIGHT · 5 SHOTS'); }
    else { slow = Math.max(slow, 15); toast('🎯 PRECISION · CEILING SLOWED'); }
    Sound.arp([880, 1174, 1568, 2093], 0.055, 'triangle', 0.05);
  }

  // ---------------------------------------------------------------------------
  // Popping, cutting loose and the ceiling
  // ---------------------------------------------------------------------------
  function groupOf(r0, c0) {
    const start = at(r0, c0);
    if (!start) return [];
    const color = start.color;
    const seen = new Set([key(r0, c0)]);
    const out = [[r0, c0]], stack = [[r0, c0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of neighbors(r, c)) {
        const b = at(nr, nc);
        if (!b || seen.has(key(nr, nc))) continue;
        if (!(b.color === color || b.color === -1 || color === -1)) continue;
        seen.add(key(nr, nc));
        out.push([nr, nc]);
        stack.push([nr, nc]);
      }
    }
    return out;
  }

  function popCells(cells) {
    didPop = true;
    combo = Math.min(MAX_COMBO, combo + 1);
    maxCombo = Math.max(maxCombo, combo);
    let cx = 0, cy = 0;
    const gifts = [];
    for (const [r, c] of cells) {
      const b = grid[r][c];
      if (b.gift) gifts.push(b.gift);
      const x = cellX(r, c), y = cellY(r);
      cx += x; cy += y;
      burst(x, y, colorOf(b), 8);
      grid[r][c] = null;
    }
    popped += cells.length;
    cx /= cells.length; cy /= cells.length;
    addScore(10 * cells.length * combo, cx, cy);
    Sound.tone(420 + combo * 70, 900 + combo * 90, 0.12, 'triangle', 0.05);
    Sound.noise(0.16, 0.05, 0, 3000);
    if (cells.length >= 6) toast(`${cells.length} POPPED${combo > 1 ? ` · COMBO ×${combo}` : ''}`);
    gifts.forEach(grantGift);
    cutFloaters();
  }

  // Anything no longer hanging from the ceiling falls — the big points in this game.
  function cutFloaters(silent) {
    const seen = new Set();
    const stack = [];
    for (let c = 0; c < COLS; c++) if (grid[0][c]) { seen.add(key(0, c)); stack.push([0, c]); }
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of neighbors(r, c)) {
        if (at(nr, nc) && !seen.has(key(nr, nc))) { seen.add(key(nr, nc)); stack.push([nr, nc]); }
      }
    }
    const loose = [];
    for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] && !seen.has(key(r, c))) loose.push([r, c]);
    if (!loose.length) return;
    let lowest = 0;
    for (const [r, c] of loose) {
      const b = grid[r][c];
      grid[r][c] = null;
      if (silent) continue;
      lowest = Math.max(lowest, r);
      falls.push({ x: cellX(r, c), y: cellY(r), vx: rand(-70, 70), vy: rand(-140, -20), color: colorOf(b), rot: 0, vr: rand(-6, 6), t: 0 });
      if (b.gift) grantGift(b.gift);
    }
    if (silent) return;
    popped += loose.length;
    addScore(20 * loose.length, FW / 2, cellY(Math.max(1, lowest - 1)));
    if (loose.length >= 4) toast(`${loose.length} CUT LOOSE · +${(20 * loose.length).toLocaleString()}`);
    Sound.arp([740, 560, 420, 320], 0.05, 'triangle', 0.045);
  }

  function bombAt(r0, c0) {
    const cx = cellX(r0, c0), cy = cellY(r0);
    const hit = [];
    for (let r = Math.max(0, r0 - 2); r <= Math.min(MAX_ROWS - 1, r0 + 2); r++) {
      for (let c = 0; c < COLS; c++) {
        if (!grid[r][c]) continue;
        if (Math.hypot(cellX(r, c) - cx, cellY(r) - cy) <= D * 1.8) hit.push([r, c]);
      }
    }
    flash = 0.3; shake = 13;
    burst(cx, cy, '#ffb347', 26);
    Sound.noise(0.55, 0.2, 0, 900);
    Sound.tone(160, 50, 0.5, 'sawtooth', 0.06);
    if (hit.length) popCells(hit);
    else { combo = 0; cutFloaters(); }
  }

  function dropRow() {
    depth++;
    grid.pop();
    grid.unshift(newRow());
    dropAnim = 0.22;
    shake = 7;
    Sound.tone(170, 80, 0.32, 'sawtooth', 0.055);
  }

  const deadly = () => {
    for (let r = DEATH_ROW; r < MAX_ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c]) return true;
    return false;
  };

  function wallCleared() {
    const bonus = CLASSIC ? 500 + level * 150 : 2000 + depth * 120;
    addScore(bonus, FW / 2, TOP + 140);
    flash = 0.35;
    Sound.arp([523, 659, 784, 1046, 1318], 0.07, 'square', 0.05);
    if (CLASSIC) {
      if (level >= FINAL_LEVEL) { toast(`WALL CLEARED! +${bonus.toLocaleString()}`); return endGame(true); }
      toast(`LEVEL ${level} CLEARED! +${bonus.toLocaleString()}`);
      startLevel(level + 1);
    } else {
      toast(`WALL CLEARED! +${bonus.toLocaleString()}`);
      refill(5);
      banner = { text: 'NEW WALL', t: 0 };
    }
    // the loaded bubbles were picked for the old wall: point them at a colour that still exists
    if (cur && cur.kind === 'color') cur = resolveToken(cur);
    if (next && next.kind === 'color') next = resolveToken(next);
  }

  function afterShot() {
    shots++;
    if (countBubbles() === 0) return wallCleared();
    if (CLASSIC) dropProg = didPop ? 0 : dropProg + (slow > 0 ? 0.5 : 1); // only a run of wasted shots brings it down
    else dropProg += slow > 0 ? 0.5 : 1;
    if (dropProg >= dropEvery()) { dropProg -= dropEvery(); dropRow(); }
    if (deadly()) endGame(false);
  }

  // ---------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------
  function fire() {
    if (state !== 'play' || paused || fly) return;
    fly = { x: LAUNCH_X + Math.cos(aim) * MUZZLE, y: LAUNCH_Y + Math.sin(aim) * MUZZLE, vx: Math.cos(aim) * SPEED, vy: Math.sin(aim) * SPEED, tok: cur };
    cur = next;
    next = resolveToken(takeToken());
    if (laser > 0) laser--;
    hinted = true;
    Sound.tone(560, 1000, 0.08, 'square', 0.035);
  }

  // The cell a loose bubble at (x, y) overlaps, or null
  function gridHit(x, y) {
    const r0 = Math.floor((y - TOP) / ROW_H);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(MAX_ROWS - 1, r0 + 1); r++) {
      const c0 = Math.round((x - cellX(r, 0)) / D);
      for (let c = Math.max(0, c0 - 1); c <= Math.min(COLS - 1, c0 + 1); c++) {
        if (!grid[r][c]) continue;
        const dx = x - cellX(r, c), dy = y - cellY(r);
        if (dx * dx + dy * dy < D * 0.93 * (D * 0.93)) return [r, c];
      }
    }
    return null;
  }

  // Nearest free cell that touches the ceiling or an existing bubble
  function snapCell(x, y) {
    let best = null, bd = Infinity, loose = null, ld = Infinity;
    const r0 = Math.round((y - TOP) / ROW_H);
    for (let r = Math.max(0, r0 - 2); r <= Math.min(MAX_ROWS - 1, r0 + 2); r++) {
      const c0 = Math.round((x - cellX(r, 0)) / D);
      for (let c = Math.max(0, c0 - 2); c <= Math.min(COLS - 1, c0 + 2); c++) {
        if (grid[r][c]) continue;
        const d = Math.hypot(x - cellX(r, c), y - cellY(r));
        if (d < ld) { ld = d; loose = [r, c]; }
        if (r > 0 && !neighbors(r, c).some(([nr, nc]) => at(nr, nc))) continue;
        if (d < bd) { bd = d; best = [r, c]; }
      }
    }
    return best || loose;
  }

  function stick() {
    didPop = false;
    const tok = fly.tok, fx = fly.x, fy = fly.y;
    const cell = snapCell(fx, fy);
    fly = null;
    Sound.tone(260, 170, 0.07, 'sine', 0.05);
    if (!cell) { combo = 0; return afterShot(); }
    const [r, c] = cell;
    if (tok.kind === 'bomb') { grid[r][c] = { color: 0, gift: null }; bombAt(r, c); return afterShot(); }
    grid[r][c] = { color: tok.kind === 'rainbow' ? -1 : tok.c, gift: null };
    if (grid[r][c].color === -1) {
      // a rainbow takes the colour it touches most, so it always makes the biggest match it can
      const tally = {};
      for (const [nr, nc] of neighbors(r, c)) { const b = at(nr, nc); if (b && b.color >= 0) tally[b.color] = (tally[b.color] || 0) + 1; }
      const pickBest = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
      if (pickBest !== undefined) grid[r][c].color = +pickBest;
    }
    const group = groupOf(r, c);
    if (group.length >= 3) popCells(group);
    else { combo = 0; cutFloaters(); }
    afterShot();
  }

  // ---------------------------------------------------------------------------
  // Aim guide
  // ---------------------------------------------------------------------------
  function trace(a, maxLen, maxBounces) {
    const pts = [];
    let x = LAUNCH_X + Math.cos(a) * MUZZLE, y = LAUNCH_Y + Math.sin(a) * MUZZLE;
    let vx = Math.cos(a), vy = Math.sin(a), len = 0, bounces = 0;
    let hit = null;
    const L = WALL_L + R, RG = WALL_R - R, STEP = 5;
    pts.push({ x, y });
    while (len < maxLen) {
      x += vx * STEP; y += vy * STEP; len += STEP;
      if (x < L) { x = L + (L - x); vx = -vx; if (++bounces > maxBounces) break; }
      else if (x > RG) { x = RG - (x - RG); vx = -vx; if (++bounces > maxBounces) break; }
      if (y <= TOP) { y = TOP; hit = { x, y }; pts.push({ x, y }); break; }
      if (gridHit(x, y)) { hit = { x, y }; pts.push({ x, y }); break; }
      if (y > LAUNCH_Y + 40) break;
      pts.push({ x, y });
    }
    return { pts, hit };
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const keys = new Set();

  function update(dt) {
    time += dt;
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; p.vx *= 0.96; }
    particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) p.t += dt;
    popups = popups.filter((p) => p.t < 0.9);
    for (const g of rings) g.t += dt;
    rings = rings.filter((g) => g.t < g.life);
    for (const f of falls) { f.t += dt; f.vy += 1500 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt; }
    falls = falls.filter((f) => f.y < FH + 60);
    if (flash > 0) flash -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 45);
    if (dropAnim > 0) dropAnim = Math.max(0, dropAnim - dt);
    if (banner) { banner.t += dt; if (banner.t > 1.8) banner = null; }
    if (state !== 'play') return;

    if (slow > 0) slow = Math.max(0, slow - dt);
    if (keys.has('left')) aim = clamp(aim - 1.15 * dt, AIM_MIN, AIM_MAX);
    if (keys.has('right')) aim = clamp(aim + 1.15 * dt, AIM_MIN, AIM_MAX);

    if (fly) {
      // small steps so a fast bubble can never tunnel through the wall
      const L = WALL_L + R, RG = WALL_R - R;
      let left = Math.hypot(fly.vx, fly.vy) * dt;
      const step = 5;
      while (left > 0 && fly) {
        const s = Math.min(step, left);
        left -= s;
        const k = s / Math.hypot(fly.vx, fly.vy);
        fly.x += fly.vx * k;
        fly.y += fly.vy * k;
        if (fly.x < L) { fly.x = L + (L - fly.x); fly.vx = -fly.vx; Sound.tone(900, 700, 0.04, 'square', 0.02); }
        else if (fly.x > RG) { fly.x = RG - (fly.x - RG); fly.vx = -fly.vx; Sound.tone(900, 700, 0.04, 'square', 0.02); }
        if (fly.y <= TOP) { fly.y = TOP; return stick(); }
        if (gridHit(fly.x, fly.y)) return stick();
        if (fly.y > FH + 40) { fly = null; combo = 0; didPop = false; return afterShot(); }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Bubble art: each colour is drawn once into an offscreen canvas and blitted
  // ---------------------------------------------------------------------------
  const sprites = {};
  function mix(hex, other, t) {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
    const a = p(hex), b = p(other);
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  }
  function gloss(c, color, emoji) {
    const g = c.createRadialGradient(R * 0.62, R * 0.55, R * 0.08, R, R, R);
    g.addColorStop(0, mix(color, '#ffffff', 0.62));
    g.addColorStop(0.5, color);
    g.addColorStop(1, mix(color, '#000000', 0.5));
    c.fillStyle = g;
    c.beginPath(); c.arc(R, R, R - 0.8, 0, TAU); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1.4;
    c.beginPath(); c.arc(R, R, R - 1.6, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.beginPath(); c.ellipse(R * 0.68, R * 0.6, R * 0.3, R * 0.19, -0.6, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); c.ellipse(R * 1.3, R * 1.34, R * 0.2, R * 0.11, -0.6, 0, TAU); c.fill();
    if (emoji) { c.font = `${Math.round(R * 1.1)}px serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(emoji, R, R + 1); }
  }
  function sprite(id) {
    if (sprites[id]) return sprites[id];
    const cv = document.createElement('canvas');
    const SS = 2;
    cv.width = cv.height = D * SS;
    const c = cv.getContext('2d');
    c.scale(SS, SS);
    if (id === 'rainbow') {
      for (let i = 0; i < 7; i++) {
        c.fillStyle = PALETTE[i];
        c.beginPath(); c.moveTo(R, R);
        c.arc(R, R, R - 0.8, (i / 7) * TAU - 0.4, ((i + 1) / 7) * TAU - 0.4); c.fill();
      }
      c.globalCompositeOperation = 'source-atop';
      const g = c.createRadialGradient(R * 0.62, R * 0.55, R * 0.08, R, R, R);
      g.addColorStop(0, 'rgba(255,255,255,0.65)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      c.fillStyle = g; c.fillRect(0, 0, D, D);
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(R, R, R - 1.6, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.75)';
      c.beginPath(); c.ellipse(R * 0.68, R * 0.6, R * 0.3, R * 0.19, -0.6, 0, TAU); c.fill();
    } else if (id === 'bomb') {
      gloss(c, '#2b2b44', '💣');
    } else {
      gloss(c, id);
    }
    sprites[id] = cv;
    return cv;
  }
  const tokenSprite = (tok) => (tok.kind === 'bomb' ? sprite('bomb') : tok.kind === 'rainbow' ? sprite('rainbow') : sprite(PALETTE[tok.c]));
  const bubbleSprite = (b) => (b.color >= 0 ? sprite(PALETTE[b.color]) : sprite('rainbow'));
  const blit = (spr, x, y, s = D) => ctx.drawImage(spr, x - s / 2, y - s / 2, s, s);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#05030c';
    ctx.fillRect(0, 0, W, H);
    const sx = shake > 0 ? rand(-shake, shake) * 0.4 : 0;
    const sy = shake > 0 ? rand(-shake, shake) * 0.4 : 0;
    ctx.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * (offX + sx * scale), DPR * (offY + sy * scale));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();

    const bg = ctx.createLinearGradient(0, 0, 0, FH);
    bg.addColorStop(0, '#140628');
    bg.addColorStop(0.55, '#0a0416');
    bg.addColorStop(1, '#07030f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, FW, FH);
    if (!grid) { ctx.restore(); return; }

    // a soft glow hanging behind the wall
    let lowest = 0;
    eachBubble((b, r) => { lowest = Math.max(lowest, r); });
    const glowY = TOP + (lowest * ROW_H) / 2;
    const glow = ctx.createRadialGradient(FW / 2, glowY, 10, FW / 2, glowY, FW * 0.72);
    glow.addColorStop(0, 'rgba(255,107,214,0.16)');
    glow.addColorStop(1, 'rgba(255,107,214,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, FW, FH);

    // side walls
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(WALL_L - 6, TOP - 34, 6, FH);
    ctx.fillRect(WALL_R, TOP - 34, 6, FH);
    ctx.fillStyle = 'rgba(255,107,214,0.3)';
    ctx.fillRect(WALL_L - 6, TOP - 34, 2, FH);
    ctx.fillRect(WALL_R + 4, TOP - 34, 2, FH);
    // ceiling
    const ceil = ctx.createLinearGradient(0, TOP - 34, 0, TOP - 6);
    ceil.addColorStop(0, 'rgba(255,107,214,0.35)');
    ceil.addColorStop(1, 'rgba(255,107,214,0)');
    ctx.fillStyle = ceil;
    ctx.fillRect(WALL_L - 6, TOP - 34, WALL_R - WALL_L + 12, 28);

    const yOff = -ROW_H * (dropAnim / 0.22);
    ctx.save();
    ctx.translate(0, yOff);
    eachBubble((b, r, c) => {
      const x = cellX(r, c), y = cellY(r);
      if (y + yOff < TOP - D || y + yOff > FH) return;
      blit(bubbleSprite(b), x, y);
      if (b.gift) {
        ctx.font = '17px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 8;
        ctx.fillText(b.gift === 'laser' ? '⚡' : '🎯', x, y + 1);
        ctx.shadowBlur = 0;
      }
    });
    ctx.restore();

    // the line the wall must not cross
    const pulse = 0.25 + 0.2 * Math.sin(time * 4);
    ctx.strokeStyle = `rgba(255,77,109,${lowest >= DEATH_ROW - 3 ? 0.35 + pulse : pulse * 0.5})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.moveTo(WALL_L, DEATH_Y); ctx.lineTo(WALL_R, DEATH_Y); ctx.stroke();
    ctx.setLineDash([]);

    // falling bubbles
    for (const f of falls) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.globalAlpha = clamp(1.2 - f.t * 0.5, 0, 1);
      blit(sprite(f.color), 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // aim guide
    if (state === 'play' && !fly && !paused) {
      const t = laser > 0 ? trace(aim, 4000, 6) : trace(aim, 560, 1);
      const inc = laser > 0 ? 5 : 3;
      ctx.fillStyle = laser > 0 ? '#3fd8ff' : ACCENT;
      if (laser <= 0) { ctx.shadowColor = ACCENT; ctx.shadowBlur = 8; }
      for (let i = 4; i < t.pts.length; i += inc) {
        const p = t.pts[i];
        ctx.globalAlpha = laser > 0 ? 0.9 : clamp(1 - i / t.pts.length, 0.18, 0.75);
        ctx.beginPath(); ctx.arc(p.x, p.y, laser > 0 ? 2.8 : 2.2, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (laser > 0 && t.hit) {
        const cell = snapCell(t.hit.x, t.hit.y);
        if (cell) {
          ctx.strokeStyle = '#3fd8ff'; ctx.lineWidth = 2;
          ctx.globalAlpha = 0.85;
          ctx.beginPath(); ctx.arc(cellX(cell[0], cell[1]), cellY(cell[0]), R - 2, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    // launcher
    ctx.save();
    ctx.translate(LAUNCH_X, LAUNCH_Y);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.arc(0, 0, 42, Math.PI, TAU); ctx.fill();
    ctx.save();
    ctx.rotate(aim + Math.PI / 2);
    const barrel = ctx.createLinearGradient(0, 0, 0, -46);
    barrel.addColorStop(0, '#3a1a34');
    barrel.addColorStop(1, ACCENT);
    ctx.fillStyle = barrel;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-9, -46, 18, 52, 8); else ctx.rect(-9, -46, 18, 52);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1b0f22';
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 25, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (cur && state !== 'over') {
      ctx.shadowColor = ACCENT; ctx.shadowBlur = 14;
      blit(tokenSprite(cur), LAUNCH_X, LAUNCH_Y, D * 0.92);
      ctx.shadowBlur = 0;
    }
    if (next) {
      ctx.globalAlpha = 0.85;
      blit(tokenSprite(next), LAUNCH_X - 66, LAUNCH_Y + 10, D * 0.66);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff66'; ctx.font = '7px "Press Start 2P", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('NEXT', LAUNCH_X - 66, LAUNCH_Y + 34);
    }

    // the shot in flight
    if (fly) {
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 16;
      blit(tokenSprite(fly.tok), fly.x, fly.y);
      ctx.shadowBlur = 0;
    }

    // pops
    for (const g of rings) {
      const k = g.t / g.life;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = g.c;
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(g.x, g.y, R * (0.5 + k * 1.6), 0, TAU); ctx.stroke();
    }
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '12px "Press Start 2P", monospace';
    for (const p of popups) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.9);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = ACCENT; ctx.shadowBlur = 10;
      ctx.fillText(p.text, p.x, p.y - p.t * 46);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    if (banner && state === 'play') {
      const a = banner.t < 0.3 ? banner.t / 0.3 : banner.t > 1.4 ? (1.8 - banner.t) / 0.4 : 1;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#fff'; ctx.font = '22px "Press Start 2P", monospace';
      ctx.shadowColor = ACCENT; ctx.shadowBlur = 20;
      ctx.fillText(banner.text, FW / 2, FH * 0.55);
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, flash)})`; ctx.fillRect(0, 0, FW, FH); }
    if (paused && state === 'play') {
      ctx.fillStyle = '#000b'; ctx.fillRect(0, 0, FW, FH);
      ctx.fillStyle = ACCENT; ctx.font = '26px "Press Start 2P", monospace';
      ctx.fillText('PAUSED', FW / 2, FH / 2);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const last = {};
  const nextCtx = $('next').getContext('2d');
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('combo', combo > 1 ? `COMBO ×${combo}` : '');
    set('depth', state === 'title' ? '' : CLASSIC ? `LEVEL ${Math.min(level, FINAL_LEVEL)}/${FINAL_LEVEL}` : `LVL ${1 + Math.floor(depth / 6)} · DEPTH ${depth}`);
    set('dropin', state === 'title' ? '' : CLASSIC ? `${Math.max(1, Math.ceil(dropEvery() - dropProg))} MISSES LEFT` : `DROP IN ${Math.max(1, Math.ceil(dropEvery() - dropProg))}`);
    set('specials', [laser > 0 ? `⚡ ${laser}` : '', slow > 0 ? `🎯 ${Math.ceil(slow)}s` : ''].filter(Boolean).join(' · '));
    const k = next ? (next.kind === 'color' ? PALETTE[next.c] : next.kind) : '';
    if (last.next !== k) {
      last.next = k;
      nextCtx.clearRect(0, 0, 52, 52);
      if (next) nextCtx.drawImage(tokenSprite(next), 0, 0, 52, 52);
    }
    const hint = $('touch-hint');
    if (hint) hint.hidden = state !== 'play' || hinted;
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYMAP) { e.preventDefault(); if (state === 'play') keys.add(KEYMAP[k]); }
    else if (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat && (k === ' ' || k === 'enter')) start();
      else if (state === 'play' && !e.repeat) { if (paused) paused = false; else fire(); }
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
  });
  window.addEventListener('keyup', (e) => { keys.delete(KEYMAP[e.key.toLowerCase()]); });
  window.addEventListener('blur', () => keys.clear());

  // Mouse: the guide follows the pointer, a click fires.
  // Touch: drag to aim (the shot stays in view above your finger) and lift to fire.
  const toField = (cx, cy) => ({ x: (cx - offX) / scale, y: (cy - offY) / scale });
  function aimAt(cx, cy) {
    const p = toField(cx, cy);
    aim = clamp(Math.atan2(p.y - LAUNCH_Y, p.x - LAUNCH_X), AIM_MIN, AIM_MAX);
  }
  let touching = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    aimAt(e.clientX, e.clientY);
    if (e.pointerType !== 'mouse') touching = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (state !== 'play' || paused) return;
    if (e.pointerType === 'mouse' || touching) aimAt(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (state !== 'play' || paused) { touching = false; return; }
    aimAt(e.clientX, e.clientY);
    touching = false;
    fire();
  });
  canvas.addEventListener('pointercancel', () => { touching = false; });

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
      game: 'bubble',
      peek: () => ({
        state, paused, score, high, level: CLASSIC ? level : 1 + Math.floor(depth / 6), depth,
        rows: (() => { let n = 0; for (let r = 0; r < MAX_ROWS; r++) if (grid[r].some(Boolean)) n++; return n; })(),
        bubbles: countBubbles(), popped, shots, combo, maxCombo, laser, slow: Math.ceil(slow),
        flying: !!fly, cur: cur && (cur.kind === 'color' ? cur.c : cur.kind), next: next && (next.kind === 'color' ? next.c : next.kind),
        dropIn: Math.max(0, Math.ceil(dropEvery() - dropProg)), aim: Math.round((-aim * 180) / Math.PI),
      }),
      // the wall as colour indices (null = empty, -1 = an unmatched rainbow)
      cells: () => grid.map((row) => row.map((b) => (b ? b.color : null))),
      // advance the game without waiting for animation frames (they stop when the tab is hidden)
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      // aim in degrees (0 = right, 90 = straight up, 180 = left) and fire
      shoot: (deg = 90) => { aim = clamp(-(deg * Math.PI) / 180, AIM_MIN, AIM_MAX); fire(); },
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'level') startLevel(v);
        else if (k === 'depth') depth = v;
        else if (k === 'laser') laser = v;
        else if (k === 'slow') slow = v;
        else if (k === 'rows') { grid = Array.from({ length: MAX_ROWS }, emptyRow); refill(v); }
      },
      win: () => { level = FINAL_LEVEL; grid = Array.from({ length: MAX_ROWS }, emptyRow); wallCleared(); },
      start,
    };
  }

  // a wall hangs behind the title screen, with the launcher sweeping back and forth
  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    if (state === 'title') aim = -Math.PI / 2 + Math.sin(time * 0.6) * 0.75;
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
