(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const FW = 600;
  // the field stretches to fill tall screens (phones) so the board sits under the thumb
  let FH = 900;
  const TAU = Math.PI * 2;
  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = Daily.board('match3') || (CLASSIC ? 'match3-classic' : 'match3');
  const FINAL_LEVEL = 20; // classic: beat twenty levels to win

  const N = 8, CELL = 66, BOARD_PX = N * CELL;
  const BX = Math.round((FW - BOARD_PX) / 2);
  let BY = 200, BAR_Y = 124;

  const NCOL = 6;
  const COLORS = ['#ff4d6d', '#3fd8ff', '#ffd23f', '#7dff6a', '#c77dff', '#ff9f40'];
  const GLOW = ['#ffb3c1', '#b6f0ff', '#fff0b0', '#d5ffcc', '#ebd5ff', '#ffd9b0'];
  const DEEP = ['#5c0a1a', '#073d52', '#5c4300', '#134a0c', '#35135a', '#5c3009'];
  const NAMES = ['RED', 'BLUE', 'YELLOW', 'GREEN', 'PURPLE', 'ORANGE'];
  const SHAPES = ['round', 'diamond', 'hex', 'square', 'tri', 'oct'];
  const ACCENT = '#ffd166';

  const TIME_START = 60, TIME_CAP = 90, TIME_PER_GEM = 1;
  const SWAP_T = 0.15, CLEAR_T = 0.26, SHUFFLE_T = 1.0;
  const GRAV = 3400;
  // cascade 1, 2, 3, 4, 5 … → ×1, ×1.5, ×2, ×3, ×5 …
  const MULT = [1, 1, 1.5, 2, 3, 5, 7, 10, 14, 20];
  const BONUS = { 'striped-h': 200, 'striped-v': 200, bomb: 400, color: 800 };

  // Classic: twenty levels, each with one goal and a move budget
  const LEVELS = [
    { goal: 'clear', color: 0, need: 25, moves: 25 },
    { goal: 'score', need: 2500, moves: 25 },
    { goal: 'clear', color: 1, need: 30, moves: 24 },
    { goal: 'drop', need: 2, moves: 22 },
    { goal: 'clear', color: 3, need: 32, moves: 24 },
    { goal: 'score', need: 4500, moves: 25 },
    { goal: 'clear', color: 4, need: 35, moves: 24 },
    { goal: 'drop', need: 3, moves: 22 },
    { goal: 'clear', color: 2, need: 38, moves: 24 },
    { goal: 'score', need: 6500, moves: 26 },
    { goal: 'clear', color: 5, need: 40, moves: 24 },
    { goal: 'drop', need: 4, moves: 24 },
    { goal: 'clear', color: 0, need: 42, moves: 24 },
    { goal: 'score', need: 8500, moves: 28 },
    { goal: 'clear', color: 1, need: 45, moves: 24 },
    { goal: 'drop', need: 5, moves: 26 },
    { goal: 'clear', color: 3, need: 48, moves: 24 },
    { goal: 'score', need: 10500, moves: 28 },
    { goal: 'drop', need: 6, moves: 26 },
    { goal: 'score', need: 12000, moves: 30 },
  ];

  // world randomness (the deal, every refill gem, reshuffles) is seeded for daily challenges
  let wrand = Math.random;

  let state = 'title';
  let paused = false;
  let board, phase, phaseT, sel, cursor, swapA, swapB, swapCells, popping;
  let score, levelScore, level, moves, swaps, time, timeLeft, gemsCleared, specialsMade;
  let cascade, maxCascade, goalProg, keysOut, keysSpawned, firstMove;
  let particles, popups, rings, beams, banner, comboBan, flash, shake, shuffleT, hint, idleT, lastTick;
  let high = store.get(Arcade.modeKey('match3.high'), 0);

  let scale = 1, offX = 0, offY = 0, bgGrad = null, bgFor = 0;
  const view = setupCanvas(canvas, (v) => {
    FH = clamp(Math.round((FW * v.H) / v.W), 860, 1400);
    BY = clamp(Math.round((FH - BOARD_PX) / 2) + 40, 170, FH - BOARD_PX - 70);
    BAR_Y = BY - 76;
    scale = Math.min(v.W / FW, v.H / FH);
    offX = (v.W - FW * scale) / 2;
    offY = (v.H - FH * scale) / 2;
    bgGrad = null;
  });
  const ctx = view.ctx;

  // ---------------------------------------------------------------------------
  // Sound
  // ---------------------------------------------------------------------------
  const sfx = {
    select: () => Sound.tone(620, 880, 0.07, 'triangle', 0.03),
    swap: () => Sound.tone(420, 640, 0.09, 'sine', 0.035),
    bad: () => Sound.tone(220, 110, 0.16, 'sawtooth', 0.03),
    match: (n) => Sound.tone(440 * Math.pow(1.15, Math.min(n, 8)), 880 * Math.pow(1.12, Math.min(n, 8)), 0.14, 'triangle', 0.045),
    make: () => Sound.arp([659, 880, 1174], 0.055, 'square', 0.035),
    stripe: () => Sound.tone(1300, 240, 0.24, 'sawtooth', 0.035),
    bomb: () => { Sound.noise(0.3, 0.14, 0, 900); Sound.tone(190, 55, 0.3, 'square', 0.045); },
    rainbow: () => { Sound.noise(0.5, 0.16, 0, 2600); Sound.arp([523, 659, 784, 1046, 1318], 0.05, 'triangle', 0.04); },
    timeUp: () => Sound.tone(880, 1400, 0.1, 'sine', 0.028),
    tick: () => Sound.tone(1000, 700, 0.06, 'square', 0.03),
    level: () => Sound.arp([523, 659, 784, 1046], 0.09, 'square', 0.045),
    key: () => Sound.arp([784, 988, 1319], 0.07, 'triangle', 0.045),
    shuffle: () => Sound.arp([300, 420, 560, 420, 300], 0.06, 'triangle', 0.03),
    over: () => { Sound.noise(1.0, 0.18, 0, 500); Sound.arp([392, 330, 262, 196], 0.14, 'sawtooth', 0.04); },
  };

  // ---------------------------------------------------------------------------
  // Board helpers
  // ---------------------------------------------------------------------------
  const key = (r, c) => r * N + c;
  const rowOf = (k) => (k / N) | 0;
  const colOf = (k) => k % N;
  const inB = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
  const at = (r, c) => (inB(r, c) ? board[r][c] : null);
  // colour bombs and keys never take part in a line match
  const matchable = (g) => !!g && g.kind !== 'color' && g.kind !== 'key';
  const special = (g) => !!g && g.kind !== 'normal' && g.kind !== 'key';
  const cellCX = (c) => BX + c * CELL + CELL / 2;
  const cellCY = (r) => BY + r * CELL + CELL / 2;
  const makeGem = (c, kind) => ({ c, kind: kind || 'normal', dx: 0, dy: 0, vy: 0, bounce: 0, pop: 0, born: 0, slide: null, spin: 0 });
  const newColor = () => Math.floor(wrand() * NCOL);

  function wouldMatch(r, c, col) {
    const cAt = (rr, cc) => { const g = at(rr, cc); return matchable(g) ? g.c : -1; };
    if (cAt(r, c - 1) === col && cAt(r, c - 2) === col) return true;
    if (cAt(r - 1, c) === col && cAt(r - 2, c) === col) return true;
    return false;
  }

  function deal() {
    board = [];
    for (let r = 0; r < N; r++) {
      const row = [];
      board.push(row);
      for (let c = 0; c < N; c++) {
        let col = newColor(), guard = 0;
        row.push(null);
        while (wouldMatch(r, c, col) && guard++ < 24) col = newColor();
        row[c] = makeGem(col);
      }
    }
    // never deal a board that already has a match, and never one without a legal move
    let guard = 0;
    while ((findGroups().length || !bestMove()) && guard++ < 200) shuffleColors();
    if (!bestMove()) plantMove();
  }

  // Reassigns the colours already on the board — the gem kinds (and keys) stay where they are.
  function shuffleColors() {
    const cols = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const g = board[r][c]; if (g && g.kind !== 'key') cols.push(g.c); }
    for (let i = cols.length - 1; i > 0; i--) { const j = Math.floor(wrand() * (i + 1)); const t = cols[i]; cols[i] = cols[j]; cols[j] = t; }
    let i = 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const g = board[r][c]; if (g && g.kind !== 'key') g.c = cols[i++]; }
  }

  // Last resort: force a legal swap into the top-left corner (only reachable if shuffling failed 200×).
  function plantMove() {
    const a = 0, b = 1 % NCOL, d = 2 % NCOL;
    const put = (r, c, col) => { const g = board[r][c]; if (g && g.kind !== 'key') g.c = col; };
    put(0, 0, a); put(0, 1, a); put(0, 2, b); put(1, 2, a); put(0, 3, d); put(1, 0, b); put(1, 1, d);
  }

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------
  function findRuns() {
    const runs = [];
    for (let r = 0; r < N; r++) {
      let c = 0;
      while (c < N) {
        const g = board[r][c];
        if (!matchable(g)) { c++; continue; }
        let e = c + 1;
        while (e < N) { const h = board[r][e]; if (!matchable(h) || h.c !== g.c) break; e++; }
        if (e - c >= 3) { const cells = []; for (let i = c; i < e; i++) cells.push(key(r, i)); runs.push({ dir: 'h', len: e - c, color: g.c, cells }); }
        c = e;
      }
    }
    for (let c = 0; c < N; c++) {
      let r = 0;
      while (r < N) {
        const g = board[r][c];
        if (!matchable(g)) { r++; continue; }
        let e = r + 1;
        while (e < N) { const h = board[e][c]; if (!matchable(h) || h.c !== g.c) break; e++; }
        if (e - r >= 3) { const cells = []; for (let i = r; i < e; i++) cells.push(key(i, c)); runs.push({ dir: 'v', len: e - r, color: g.c, cells }); }
        r = e;
      }
    }
    return runs;
  }

  // Overlapping runs (an L or a T) become one group, so they make one special gem.
  function findGroups() {
    const runs = findRuns();
    if (!runs.length) return [];
    const parent = runs.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const owner = new Map();
    runs.forEach((run, i) => run.cells.forEach((k) => {
      if (owner.has(k)) { const a = find(owner.get(k)), b = find(i); if (a !== b) parent[b] = a; } else owner.set(k, i);
    }));
    const byRoot = new Map();
    runs.forEach((run, i) => {
      const root = find(i);
      if (!byRoot.has(root)) byRoot.set(root, { runs: [], cells: new Set(), color: run.color });
      const g = byRoot.get(root);
      g.runs.push(run);
      run.cells.forEach((k) => g.cells.add(k));
    });
    return [...byRoot.values()];
  }

  function specialFor(g) {
    let maxLen = 0, hasH = false, hasV = false, longest = g.runs[0];
    for (const run of g.runs) {
      if (run.len > maxLen) { maxLen = run.len; longest = run; }
      if (run.dir === 'h') hasH = true; else hasV = true;
    }
    if (maxLen >= 5) return { kind: 'color', run: longest };
    if (hasH && hasV) return { kind: 'bomb', run: longest };
    if (maxLen === 4) return { kind: longest.dir === 'h' ? 'striped-h' : 'striped-v', run: longest };
    return null;
  }

  // Where the new special appears: the cell the player moved if possible, else the corner of an L/T,
  // else the middle of the longest run.
  function specialCell(g, sp) {
    if (swapCells) for (const k of swapCells) if (g.cells.has(k)) return k;
    if (sp.kind === 'bomb') {
      for (const a of g.runs) {
        if (a.dir !== 'h') continue;
        for (const b of g.runs) {
          if (b.dir !== 'v') continue;
          for (const k of a.cells) if (b.cells.indexOf(k) >= 0) return k;
        }
      }
    }
    return sp.run.cells[Math.floor(sp.run.cells.length / 2)];
  }

  // Every swap the player could legally make, best (biggest match) first. Also used to spot a dead board.
  function bestMove() {
    let best = null;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        for (let d = 0; d < 2; d++) {
          const r2 = r + (d ? 1 : 0), c2 = c + (d ? 0 : 1);
          if (!inB(r2, c2)) continue;
          const g1 = board[r][c], g2 = board[r2][c2];
          if (!g1 || !g2 || g1.kind === 'key' || g2.kind === 'key') continue;
          let value = 0;
          if (g1.kind === 'color' || g2.kind === 'color') value = 40;
          else if (special(g1) && special(g2)) value = 30;
          else {
            board[r][c] = g2; board[r2][c2] = g1;
            for (const gr of findGroups()) value = Math.max(value, gr.cells.size);
            board[r][c] = g1; board[r2][c2] = g2;
            if (value < 3) value = 0;
          }
          if (value > 0 && (!best || value > best.value)) best = { r1: r, c1: c, r2, c2, value };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Scoring & effects
  // ---------------------------------------------------------------------------
  function addScore(n, x, y, color) {
    score += n;
    levelScore += n;
    if (x !== undefined) popups.push({ x, y, text: '+' + n.toLocaleString(), t: 0, c: color || '#fff', size: 15 });
    if (score > high) { high = score; store.set(Arcade.modeKey('match3.high'), high); }
  }

  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(60, 320);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, t: 0, life: rand(0.3, 0.7), c: Math.random() < 0.25 ? '#fff' : color, s: rand(3, 7), rot: rand(0, TAU), vr: rand(-8, 8) });
    }
  }

  const multOf = (n) => MULT[Math.min(Math.max(n, 1), MULT.length - 1)];

  // ---------------------------------------------------------------------------
  // Clearing, specials and gravity
  // ---------------------------------------------------------------------------
  // Walks the cells to clear, letting every special inside set off its own blast.
  function detonate(initial) {
    const cleared = new Set();
    const stack = [...initial];
    while (stack.length) {
      const k = stack.pop();
      if (cleared.has(k)) continue;
      const r = rowOf(k), c = colOf(k);
      const g = board[r][c];
      if (!g || g.kind === 'key') continue;
      cleared.add(k);
      if (g.kind === 'striped-h') {
        beams.push({ dir: 'h', r, c, t: 0, color: COLORS[g.c] });
        for (let i = 0; i < N; i++) stack.push(key(r, i));
        sfx.stripe(); shake = Math.max(shake, 5);
      } else if (g.kind === 'striped-v') {
        beams.push({ dir: 'v', r, c, t: 0, color: COLORS[g.c] });
        for (let i = 0; i < N; i++) stack.push(key(i, c));
        sfx.stripe(); shake = Math.max(shake, 5);
      } else if (g.kind === 'bomb') {
        rings.push({ x: cellCX(c), y: cellCY(r), t: 0, life: 0.45, r0: 10, r1: CELL * 2.2, c: COLORS[g.c] });
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inB(r + dr, c + dc)) stack.push(key(r + dr, c + dc));
        sfx.bomb(); shake = Math.max(shake, 10);
      } else if (g.kind === 'color') {
        const col = g.c;
        for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) {
          const h = board[rr][cc];
          if (h && h.kind !== 'key' && h.c === col) stack.push(key(rr, cc));
        }
        rings.push({ x: cellCX(c), y: cellCY(r), t: 0, life: 0.6, r0: 12, r1: BOARD_PX * 0.8, c: '#fff' });
        flash = Math.max(flash, 0.6); shake = Math.max(shake, 14);
        sfx.rainbow();
      }
    }
    return cleared;
  }

  // The one path every clear goes through: blow the cells up, score them, place new specials.
  function beginClear(initial, creations, bonus, extraTime) {
    const cleared = detonate(initial);
    creations.forEach((cr) => cleared.delete(cr.k));
    const m = multOf(cascade);

    let count = 0, sx = 0, sy = 0, colorHit = 0;
    const target = CLASSIC && LEVELS[level - 1].goal === 'clear' ? LEVELS[level - 1].color : -1;
    popping = [];
    for (const k of cleared) {
      const r = rowOf(k), c = colOf(k);
      const g = board[r][c];
      if (!g) continue;
      g.pop = 1;
      g.spin = rand(-3, 3);
      popping.push(k);
      count++;
      sx += cellCX(c); sy += cellCY(r);
      if (g.c === target) colorHit++;
      burst(cellCX(c), cellCY(r), COLORS[g.c], special(g) ? 12 : 6);
      rings.push({ x: cellCX(c), y: cellCY(r), t: 0, life: 0.3, r0: 6, r1: CELL * 0.7, c: GLOW[g.c] });
    }
    if (!count && !creations.length) { phase = 'fall'; phaseT = 0; return false; }
    if (cascade > maxCascade) maxCascade = cascade;

    for (const cr of creations) {
      const r = rowOf(cr.k), c = colOf(cr.k);
      const g = makeGem(cr.color, cr.kind);
      g.born = 1;
      board[r][c] = g;
      specialsMade++;
      bonus += BONUS[cr.kind] || 0;
      burst(cellCX(c), cellCY(r), GLOW[cr.color], 10);
      sfx.make();
    }

    const pts = Math.round((50 * count + bonus) * m);
    const cx = count ? sx / count : cellCX(colOf(creations[0].k));
    const cy = count ? sy / count : cellCY(rowOf(creations[0].k));
    addScore(pts, cx, cy, cascade >= 3 ? ACCENT : '#fff');
    gemsCleared += count;
    if (target >= 0) goalProg += colorHit;
    sfx.match(cascade + Math.floor(count / 4));

    if (!CLASSIC && count) {
      const add = count * TIME_PER_GEM + extraTime;
      timeLeft = Math.min(TIME_CAP, timeLeft + add);
      popups.push({ x: cx, y: cy - 26, text: '+' + Math.round(add) + 's', t: 0, c: '#7dff6a', size: 13 });
      sfx.timeUp();
    }
    if (cascade >= 2) {
      comboBan = { text: 'CASCADE ×' + cascade, mult: m, t: 0 };
      shake = Math.max(shake, 3 + cascade);
    }
    phase = 'clear';
    phaseT = 0;
    return true;
  }

  // One link of a cascade: find every line on the board and clear it.
  function resolveStep() {
    const groups = findGroups();
    if (!groups.length) return false;
    cascade++;
    if (cascade > maxCascade) maxCascade = cascade;
    const toClear = new Set();
    const creations = [];
    let extraTime = 0;
    for (const g of groups) {
      const sp = specialFor(g);
      let keep = -1;
      if (sp) {
        keep = specialCell(g, sp);
        creations.push({ k: keep, kind: sp.kind, color: g.color });
      }
      const size = g.cells.size;
      extraTime += size >= 5 ? 4 : size >= 4 ? 2 : 0;
      g.cells.forEach((k) => { if (k !== keep) toClear.add(k); });
    }
    beginClear(toClear, creations, 0, extraTime);
    swapCells = null;
    return true;
  }

  function finishClear() {
    for (const k of popping) {
      const r = rowOf(k), c = colOf(k);
      const g = board[r][c];
      if (g && g.pop) board[r][c] = null;
    }
    popping = [];
    applyGravity();
    phase = 'fall';
    phaseT = 0;
  }

  // Everything falls, then new gems drop in from above. Refills are drawn from the seeded stream
  // column by column, bottom-most new gem first — a daily challenge must deal the same drops twice.
  function applyGravity() {
    for (let c = 0; c < N; c++) {
      let write = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const g = board[r][c];
        if (!g) continue;
        if (write !== r) {
          board[write][c] = g;
          board[r][c] = null;
          g.dy -= (write - r) * CELL;
          g.vy = 0; g.bounce = 0; g.slide = null;
        }
        write--;
      }
      const above = (write + 1) * CELL;
      for (let r = write; r >= 0; r--) {
        const g = spawnGem();
        g.dy = -above;
        g.vy = 0; g.bounce = 0;
        board[r][c] = g;
      }
    }
  }

  function spawnGem() {
    if (CLASSIC && LEVELS[level - 1].goal === 'drop' && keysSpawned < LEVELS[level - 1].need && keysOut < 2 && wrand() < 0.34) {
      keysSpawned++;
      keysOut++;
      return makeGem(-1, 'key');
    }
    return makeGem(newColor());
  }

  function collectKeys() {
    let got = 0;
    for (let c = 0; c < N; c++) {
      const g = board[N - 1][c];
      if (g && g.kind === 'key') {
        board[N - 1][c] = null;
        keysOut--;
        goalProg++;
        got++;
        burst(cellCX(c), cellCY(N - 1), '#ffe08a', 16);
        rings.push({ x: cellCX(c), y: cellCY(N - 1), t: 0, life: 0.5, r0: 8, r1: CELL * 1.6, c: '#ffe08a' });
        addScore(500, cellCX(c), cellCY(N - 1), '#ffe08a');
      }
    }
    if (got) { sfx.key(); toast(got > 1 ? got + ' KEYS DELIVERED' : 'KEY DELIVERED'); }
    return got;
  }

  function afterFall() {
    if (CLASSIC && LEVELS[level - 1].goal === 'drop' && collectKeys()) {
      applyGravity();
      phase = 'fall';
      phaseT = 0;
      return;
    }
    if (resolveStep()) return;
    settle();
  }

  function settle() {
    cascade = 0;
    swapCells = null;
    idleT = 0;
    hint = null;
    if (CLASSIC && state === 'play' && checkGoal()) return;
    if (!bestMove()) { startShuffle(); return; }
    phase = 'idle';
  }

  function startShuffle() {
    phase = 'shuffle';
    phaseT = 0;
    shuffleT = 0;
    let guard = 0;
    do { shuffleColors(); } while ((findGroups().length || !bestMove()) && guard++ < 200);
    if (!bestMove()) plantMove();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const g = board[r][c]; if (g) g.born = 1; }
    toast('NO MOVES — RESHUFFLING');
    sfx.shuffle();
  }

  // ---------------------------------------------------------------------------
  // Swapping
  // ---------------------------------------------------------------------------
  function doSwap(r1, c1, r2, c2) {
    if (phase !== 'idle') return false;
    if (!inB(r1, c1) || !inB(r2, c2)) return false;
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
    const g1 = board[r1][c1], g2 = board[r2][c2];
    if (!g1 || !g2 || g1.kind === 'key' || g2.kind === 'key') { sfx.bad(); return false; }
    if (state === 'play' && !firstMove) { firstMove = true; if (window.Leaderboard) Leaderboard.played(BOARD); }
    if (state === 'play') swaps++;
    board[r1][c1] = g2;
    board[r2][c2] = g1;
    slideFrom(g2, (c2 - c1) * CELL, (r2 - r1) * CELL, SWAP_T);
    slideFrom(g1, (c1 - c2) * CELL, (r1 - r2) * CELL, SWAP_T);
    swapA = { r: r1, c: c1 };
    swapB = { r: r2, c: c2 };
    phase = 'swap';
    phaseT = 0;
    sel = null;
    hint = null;
    idleT = 0;
    sfx.swap();
    return true;
  }

  function slideFrom(g, fx, fy, dur) {
    g.slide = { fx, fy, t: 0, dur };
    g.dx = fx; g.dy = fy; g.vy = 0;
  }

  // Two specials swapped together do something bigger than either one alone.
  function comboOf(a, b) {
    if (a.kind === 'color' && b.kind === 'color') return 'all';
    if (a.kind === 'color' || b.kind === 'color') {
      const other = a.kind === 'color' ? b : a;
      if (other.kind === 'key') return null;
      return special(other) ? 'color-special' : 'color-plain';
    }
    const sa = special(a), sb = special(b);
    if (!sa || !sb) return null;
    const stripes = (a.kind.startsWith('striped') ? 1 : 0) + (b.kind.startsWith('striped') ? 1 : 0);
    if (stripes === 2) return 'cross';
    if (stripes === 1) return 'megacross';
    return 'big';
  }

  function runCombo(kind) {
    const A = board[swapA.r][swapA.c], B = board[swapB.r][swapB.c];
    const set = new Set();
    const add = (r, c) => { if (inB(r, c)) set.add(key(r, c)); };
    const br = swapB.r, bc = swapB.c;
    let bonus = 600;
    spendMove();
    cascade = 1;
    if (kind === 'all') {
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) add(r, c);
      bonus = 4000;
      flash = 0.9; shake = 20;
      sfx.rainbow();
    } else if (kind === 'color-plain') {
      const other = A.kind === 'color' ? B : A;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const g = board[r][c]; if (g && g.kind !== 'key' && g.c === other.c) add(r, c); }
      add(swapA.r, swapA.c); add(br, bc);
      bonus = 800;
      flash = 0.6; shake = 12;
      sfx.rainbow();
    } else if (kind === 'color-special') {
      const other = A.kind === 'color' ? B : A;
      const asKind = other.kind;
      let flip = 0;
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        const g = board[r][c];
        if (g && g.kind !== 'key' && g.kind !== 'color' && g.c === other.c) {
          g.kind = asKind === 'bomb' ? 'bomb' : (flip++ % 2 ? 'striped-v' : 'striped-h');
          add(r, c);
        }
      }
      add(swapA.r, swapA.c); add(br, bc);
      bonus = 2500;
      flash = 0.7; shake = 16;
      sfx.rainbow();
    } else if (kind === 'cross') {
      for (let i = 0; i < N; i++) { add(br, i); add(i, bc); }
      beams.push({ dir: 'h', r: br, c: bc, t: 0, color: COLORS[B.c] });
      beams.push({ dir: 'v', r: br, c: bc, t: 0, color: COLORS[A.c] });
      bonus = 900;
      shake = 12;
      sfx.stripe();
    } else if (kind === 'megacross') {
      for (let d = -1; d <= 1; d++) for (let i = 0; i < N; i++) { add(br + d, i); add(i, bc + d); }
      for (let d = -1; d <= 1; d++) {
        beams.push({ dir: 'h', r: br + d, c: bc, t: 0, color: COLORS[B.c] });
        beams.push({ dir: 'v', r: br, c: bc + d, t: 0, color: COLORS[A.c] });
      }
      bonus = 1600;
      shake = 16;
      sfx.stripe(); sfx.bomb();
    } else { // big: a 5×5 crater
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) add(br + dr, bc + dc);
      rings.push({ x: cellCX(bc), y: cellCY(br), t: 0, life: 0.6, r0: 14, r1: CELL * 3.4, c: COLORS[B.c] });
      bonus = 1800;
      shake = 18;
      sfx.bomb();
    }
    // the two swapped gems are consumed by the combo, not left behind
    board[swapA.r][swapA.c].kind = 'normal';
    board[br][bc].kind = 'normal';
    beginClear(set, [], bonus, 6);
  }

  function afterSwap() {
    const A = board[swapA.r][swapA.c], B = board[swapB.r][swapB.c];
    const combo = A && B ? comboOf(A, B) : null;
    if (combo) { runCombo(combo); return; }
    if (findGroups().length) {
      spendMove();
      cascade = 0;
      swapCells = [key(swapA.r, swapA.c), key(swapB.r, swapB.c)];
      resolveStep();
      return;
    }
    // nothing lines up: slide them back
    board[swapA.r][swapA.c] = B;
    board[swapB.r][swapB.c] = A;
    slideFrom(B, (swapB.c - swapA.c) * CELL, (swapB.r - swapA.r) * CELL, SWAP_T);
    slideFrom(A, (swapA.c - swapB.c) * CELL, (swapA.r - swapB.r) * CELL, SWAP_T);
    if (state === 'play') swaps = Math.max(0, swaps - 1);
    phase = 'unswap';
    phaseT = 0;
    sfx.bad();
  }

  function spendMove() {
    if (CLASSIC && state === 'play') moves = Math.max(0, moves - 1);
  }

  // ---------------------------------------------------------------------------
  // Classic levels
  // ---------------------------------------------------------------------------
  const goalText = (L) => (L.goal === 'clear' ? `CLEAR ${L.need} ${NAMES[L.color]}`
    : L.goal === 'score' ? `SCORE ${L.need.toLocaleString()}`
      : `DROP ${L.need} KEY${L.need > 1 ? 'S' : ''}`);
  const goalDone = () => {
    const L = LEVELS[level - 1];
    return L.goal === 'score' ? levelScore >= L.need : goalProg >= L.need;
  };
  const goalProgress = () => {
    const L = LEVELS[level - 1];
    return clamp((L.goal === 'score' ? levelScore : goalProg) / L.need, 0, 1);
  };

  function startLevel(n) {
    level = n;
    const L = LEVELS[n - 1];
    moves = L.moves;
    levelScore = 0;
    goalProg = 0;
    keysOut = 0;
    keysSpawned = 0;
    cascade = 0;
    deal();
    phase = 'idle';
    phaseT = 0;
    banner = { text: 'LEVEL ' + n, sub: goalText(L) + ' · ' + L.moves + ' MOVES', t: 0 };
  }

  function checkGoal() {
    if (goalDone()) {
      const bonus = moves * 200;
      addScore(bonus, FW / 2, BY + BOARD_PX / 2, ACCENT);
      if (level >= FINAL_LEVEL) { endGame(true); return true; }
      sfx.level();
      toast(`LEVEL ${level} CLEARED  +${bonus.toLocaleString()}`);
      startLevel(level + 1);
      return true;
    }
    if (moves <= 0) { endGame(false); return true; }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function newGame(withRun) {
    wrand = DAILY ? Daily.rng('match3') : Math.random;
    score = 0; levelScore = 0; swaps = 0; time = 0; gemsCleared = 0; specialsMade = 0;
    cascade = 0; maxCascade = 0; goalProg = 0; keysOut = 0; keysSpawned = 0;
    moves = 0; firstMove = false;
    particles = []; popups = []; rings = []; beams = []; popping = [];
    flash = 0; shake = 0; comboBan = null; banner = null; hint = null; idleT = 0;
    sel = null; cursor = null; swapCells = null; lastTick = 99;
    timeLeft = TIME_START;
    if (CLASSIC) startLevel(1);
    else { level = 1; deal(); phase = 'idle'; phaseT = 0; }
    if (withRun !== false && window.Leaderboard) Leaderboard.startRun(BOARD, { play: false });
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
  }

  function endGame(won) {
    if (state !== 'play') return;
    state = 'over';
    phase = 'idle';
    $('o-score').textContent = score.toLocaleString();
    $('o-cascade').textContent = '×' + maxCascade;
    $('o-specials').textContent = String(specialsMade);
    $('o-gems').textContent = CLASSIC ? `${Math.min(level, FINAL_LEVEL)}/${FINAL_LEVEL}` : gemsCleared.toLocaleString();
    Arcade.endScreen(won, won ? 'All twenty levels cleared. The board is yours.' : '');
    $('over').hidden = false;
    if (!won) { sfx.over(); flash = 0.35; shake = 14; }
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, document.querySelector('#over .panel'));
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function allStill() {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const g = board[r][c];
      if (g && (g.slide || g.dy !== 0 || g.vy !== 0)) return false;
    }
    return true;
  }

  function updateGems(dt) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const g = board[r][c];
      if (!g) continue;
      if (g.born > 0) g.born = Math.max(0, g.born - dt / 0.28);
      if (g.slide) {
        g.slide.t += dt;
        const k = Math.min(1, g.slide.t / g.slide.dur);
        const e = 1 - Math.pow(1 - k, 3);
        g.dx = g.slide.fx * (1 - e);
        g.dy = g.slide.fy * (1 - e);
        if (k >= 1) { g.dx = 0; g.dy = 0; g.slide = null; }
      } else if (g.dy !== 0 || g.vy !== 0) {
        g.vy += GRAV * dt;
        g.dy += g.vy * dt;
        if (g.dy >= 0) {
          if (g.bounce < 1 && g.vy > 700) { g.bounce++; g.dy = 0; g.vy = -g.vy * 0.2; }
          else { g.dy = 0; g.vy = 0; }
        }
      }
    }
  }

  function updateFx(dt) {
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.rot += p.vr * dt; }
    if (particles.length) particles = particles.filter((p) => p.t < p.life);
    for (const p of popups) { p.t += dt; }
    if (popups.length) popups = popups.filter((p) => p.t < 0.9);
    for (const g of rings) g.t += dt;
    if (rings.length) rings = rings.filter((g) => g.t < g.life);
    for (const b of beams) b.t += dt;
    if (beams.length) beams = beams.filter((b) => b.t < 0.35);
    if (comboBan) { comboBan.t += dt; if (comboBan.t > 1.3) comboBan = null; }
    if (banner) { banner.t += dt; if (banner.t > 2.2) banner = null; }
    if (flash > 0) flash = Math.max(0, flash - dt * 2.2);
    if (shake > 0) shake = Math.max(0, shake - dt * 45);
  }

  function update(dt) {
    if (state === 'play') {
      time += dt;
      if (!CLASSIC) {
        timeLeft -= dt;
        const s = Math.ceil(timeLeft);
        if (s <= 5 && s !== lastTick && s > 0) { lastTick = s; sfx.tick(); }
        if (s > 5) lastTick = 99;
        if (timeLeft <= 0) { timeLeft = 0; endGame(false); return; }
      }
    }
    updateFx(dt);
    updateGems(dt);
    phaseT += dt;
    if (phase === 'swap') { if (allStill()) afterSwap(); }
    else if (phase === 'unswap') { if (allStill()) { phase = 'idle'; swapA = swapB = null; } }
    else if (phase === 'clear') { if (phaseT >= CLEAR_T) finishClear(); }
    else if (phase === 'fall') { if (allStill()) afterFall(); }
    else if (phase === 'shuffle') { shuffleT += dt; if (shuffleT >= SHUFFLE_T) { shuffleT = 0; settle(); } }
    else if (phase === 'idle' && state === 'play') {
      idleT += dt;
      if (idleT > 7 && !hint) hint = bestMove();
    }
  }

  // ---------------------------------------------------------------------------
  // Gem art
  // ---------------------------------------------------------------------------
  function shapePath(g, shape, x, y, R) {
    g.beginPath();
    if (shape === 'round') { g.arc(x, y, R, 0, TAU); return; }
    if (shape === 'square') {
      const s = R * 0.86;
      if (g.roundRect) g.roundRect(x - s, y - s, s * 2, s * 2, R * 0.28);
      else g.rect(x - s, y - s, s * 2, s * 2);
      return;
    }
    const sides = shape === 'diamond' ? 4 : shape === 'hex' ? 6 : shape === 'tri' ? 3 : 8;
    const rot = shape === 'diamond' ? -Math.PI / 2 : shape === 'tri' ? -Math.PI / 2 : shape === 'hex' ? -Math.PI / 2 : Math.PI / 8;
    const rr = shape === 'tri' ? R * 1.16 : R;
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * TAU) / sides;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * (shape === 'tri' ? 1 : 1);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
  }

  function drawGem(g, gem, x, y, R, alpha) {
    const ci = gem.c >= 0 ? gem.c : 2;
    const col = COLORS[ci], lit = GLOW[ci], deep = DEEP[ci];
    g.save();
    g.globalAlpha = alpha;
    if (gem.kind === 'key') { drawKey(g, x, y, R); g.restore(); return; }
    if (gem.kind === 'color') { drawColorBomb(g, x, y, R); g.restore(); return; }

    const shape = SHAPES[ci];
    // body
    const grad = g.createRadialGradient(x - R * 0.32, y - R * 0.38, R * 0.08, x, y, R * 1.12);
    grad.addColorStop(0, lit);
    grad.addColorStop(0.42, col);
    grad.addColorStop(1, deep);
    shapePath(g, shape, x, y, R);
    g.fillStyle = grad;
    g.fill();
    // inner facet
    g.save();
    shapePath(g, shape, x, y, R);
    g.clip();
    g.globalAlpha = alpha * 0.5;
    shapePath(g, shape, x, y, R * 0.58);
    g.fillStyle = lit;
    g.fill();
    g.globalAlpha = alpha * 0.28;
    g.strokeStyle = '#fff';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x - R, y - R * 0.1); g.lineTo(x + R, y + R * 0.55);
    g.moveTo(x - R * 0.2, y - R); g.lineTo(x + R * 0.6, y + R);
    g.stroke();
    if (gem.kind === 'striped-h' || gem.kind === 'striped-v') {
      g.globalAlpha = alpha * 0.9;
      g.fillStyle = '#fff';
      for (let i = -1; i <= 1; i++) {
        if (gem.kind === 'striped-h') g.fillRect(x - R, y + i * R * 0.45 - R * 0.09, R * 2, R * 0.18);
        else g.fillRect(x + i * R * 0.45 - R * 0.09, y - R, R * 0.18, R * 2);
      }
    }
    if (gem.kind === 'bomb') {
      g.globalAlpha = alpha;
      g.fillStyle = '#120a1e';
      g.beginPath(); g.arc(x, y, R * 0.52, 0, TAU); g.fill();
      g.strokeStyle = lit;
      g.lineWidth = 2.4;
      g.beginPath(); g.arc(x, y, R * 0.52, 0, TAU); g.stroke();
      const p = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      g.globalAlpha = alpha * (0.35 + 0.45 * p);
      g.fillStyle = lit;
      g.beginPath(); g.arc(x, y, R * 0.26 + R * 0.1 * p, 0, TAU); g.fill();
    }
    g.restore();
    // rim + specular
    g.globalAlpha = alpha;
    shapePath(g, shape, x, y, R);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1.6;
    g.stroke();
    g.globalAlpha = alpha * 0.8;
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(x - R * 0.3, y - R * 0.42, R * 0.26, R * 0.15, -0.6, 0, TAU);
    g.fill();
    if (special(gem)) {
      g.globalAlpha = alpha * 0.5;
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      shapePath(g, shape, x, y, R * 1.12);
      g.stroke();
    }
    g.restore();
  }

  function drawColorBomb(g, x, y, R) {
    const t = performance.now() / 700;
    for (let i = 0; i < NCOL; i++) {
      g.beginPath();
      g.moveTo(x, y);
      g.arc(x, y, R, t + (i * TAU) / NCOL, t + ((i + 1) * TAU) / NCOL);
      g.closePath();
      g.fillStyle = COLORS[i];
      g.fill();
    }
    const grad = g.createRadialGradient(x, y, R * 0.05, x, y, R);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.beginPath(); g.arc(x, y, R, 0, TAU); g.fillStyle = grad; g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, R, 0, TAU); g.stroke();
    g.fillStyle = '#fff';
    g.globalAlpha *= 0.9;
    g.beginPath(); g.arc(x, y, R * 0.2 + R * 0.06 * Math.sin(performance.now() / 150), 0, TAU); g.fill();
  }

  function drawKey(g, x, y, R) {
    g.save();
    g.translate(x, y);
    g.rotate(-0.5);
    g.shadowColor = '#ffd166';
    g.shadowBlur = 14;
    g.strokeStyle = '#ffe9a8';
    g.fillStyle = '#ffc84d';
    g.lineWidth = R * 0.2;
    g.beginPath(); g.arc(0, -R * 0.45, R * 0.36, 0, TAU); g.stroke();
    g.fillRect(-R * 0.1, -R * 0.15, R * 0.2, R * 1.05);
    g.fillRect(-R * 0.1, R * 0.5, R * 0.5, R * 0.16);
    g.fillRect(-R * 0.1, R * 0.78, R * 0.38, R * 0.16);
    g.shadowBlur = 0;
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawBackground(g) {
    if (!bgGrad || bgFor !== FH) {
      bgGrad = g.createRadialGradient(FW / 2, BY + BOARD_PX / 2, 40, FW / 2, BY + BOARD_PX / 2, FW * 1.1);
      bgGrad.addColorStop(0, 'rgba(255,209,102,0.16)');
      bgGrad.addColorStop(0.45, 'rgba(120,60,200,0.10)');
      bgGrad.addColorStop(1, 'rgba(0,0,0,0)');
      bgFor = FH;
    }
    g.fillStyle = '#0a0718';
    g.fillRect(-200, -200, FW + 400, FH + 400);
    g.fillStyle = bgGrad;
    g.fillRect(-200, -200, FW + 400, FH + 400);
  }

  function drawFrame(g) {
    const pad = 10;
    g.save();
    g.shadowColor = 'rgba(255,209,102,0.35)';
    g.shadowBlur = 26;
    g.fillStyle = 'rgba(10,6,26,0.92)';
    g.beginPath();
    if (g.roundRect) g.roundRect(BX - pad, BY - pad, BOARD_PX + pad * 2, BOARD_PX + pad * 2, 18);
    else g.rect(BX - pad, BY - pad, BOARD_PX + pad * 2, BOARD_PX + pad * 2);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,209,102,0.55)';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      g.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)';
      g.fillRect(BX + c * CELL, BY + r * CELL, CELL, CELL);
    }
  }

  function drawGems(g) {
    g.save();
    g.beginPath();
    if (g.roundRect) g.roundRect(BX - 3, BY - 3, BOARD_PX + 6, BOARD_PX + 6, 12);
    else g.rect(BX - 3, BY - 3, BOARD_PX + 6, BOARD_PX + 6);
    g.clip();
    const popK = phase === 'clear' ? clamp(phaseT / CLEAR_T, 0, 1) : 0;
    const shk = phase === 'shuffle' ? Math.sin((shuffleT / SHUFFLE_T) * Math.PI) : 0;
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const gem = board[r][c];
      if (!gem) continue;
      let x = cellCX(c) + gem.dx, y = cellCY(r) + gem.dy;
      let R = CELL * 0.42, alpha = 1;
      if (shk) {
        const a = (r * N + c) * 0.7;
        x += Math.cos(a + shuffleT * 8) * shk * 26;
        y += Math.sin(a + shuffleT * 8) * shk * 26;
        R *= 1 - shk * 0.25;
      }
      if (gem.born > 0) R *= 1 + 0.55 * gem.born;
      if (gem.pop) { R *= 1 + popK * 0.45; alpha = 1 - popK; }
      const picked = sel && sel.r === r && sel.c === c;
      const hinted = hint && ((hint.r1 === r && hint.c1 === c) || (hint.r2 === r && hint.c2 === c));
      if (picked || hinted) {
        const p = 0.5 + 0.5 * Math.sin(performance.now() / (picked ? 130 : 240));
        g.save();
        g.globalAlpha = 0.3 + 0.35 * p;
        g.fillStyle = picked ? '#fff' : ACCENT;
        g.beginPath(); g.arc(x, y, R * (1.35 + 0.12 * p), 0, TAU); g.fill();
        g.restore();
        R *= 1 + 0.07 * p;
      }
      if (gem.pop && gem.spin) { g.save(); g.translate(x, y); g.rotate(gem.spin * popK); g.translate(-x, -y); }
      drawGem(g, gem, x, y, R, alpha);
      if (gem.pop && gem.spin) g.restore();
    }
    // beams left by striped gems
    for (const b of beams) {
      const a = Math.max(0, 1 - b.t / 0.35);
      g.globalAlpha = a * 0.85;
      const grad = b.dir === 'h'
        ? g.createLinearGradient(BX, 0, BX + BOARD_PX, 0)
        : g.createLinearGradient(0, BY, 0, BY + BOARD_PX);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, b.color);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      const w = CELL * (0.16 + 0.5 * a);
      if (b.dir === 'h') g.fillRect(BX, cellCY(b.r) - w / 2, BOARD_PX, w);
      else g.fillRect(cellCX(b.c) - w / 2, BY, w, BOARD_PX);
    }
    g.globalAlpha = 1;
    // cursor for keyboard play
    if (cursor && state === 'play') {
      g.strokeStyle = 'rgba(255,255,255,0.7)';
      g.lineWidth = 2;
      g.strokeRect(BX + cursor.c * CELL + 3, BY + cursor.r * CELL + 3, CELL - 6, CELL - 6);
    }
    g.restore();
  }

  function drawFx(g) {
    for (const p of particles) {
      const a = Math.max(0, 1 - p.t / p.life);
      g.globalAlpha = a;
      g.fillStyle = p.c;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 1.3);
      g.restore();
    }
    for (const r of rings) {
      const k = r.t / r.life;
      g.globalAlpha = Math.max(0, 1 - k) * 0.8;
      g.strokeStyle = r.c;
      g.lineWidth = 3 * (1 - k) + 1;
      g.beginPath();
      g.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2)), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of popups) {
      g.globalAlpha = Math.max(0, 1 - p.t / 0.9);
      g.font = `${p.size}px "Press Start 2P", monospace`;
      g.fillStyle = '#000';
      g.fillText(p.text, p.x + 2, p.y - p.t * 54 + 2);
      g.fillStyle = p.c;
      g.fillText(p.text, p.x, p.y - p.t * 54);
    }
    g.globalAlpha = 1;
  }

  function drawBar(g) {
    const w = BOARD_PX, h = 34, x = BX, y = BAR_Y;
    const classicGoal = CLASSIC ? LEVELS[level - 1] : null;
    const k = CLASSIC ? goalProgress() : clamp(timeLeft / TIME_CAP, 0, 1);
    g.save();
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1.5;
    g.stroke();
    // fill
    let c1, c2;
    if (CLASSIC) { c1 = '#7dff6a'; c2 = ACCENT; }
    else if (timeLeft > 30) { c1 = '#3fd8ff'; c2 = '#7dff6a'; }
    else if (timeLeft > 12) { c1 = '#ffd23f'; c2 = '#ff9f40'; }
    else { c1 = '#ff4d6d'; c2 = '#ff9f40'; }
    if (k > 0.005) {
      g.save();
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h);
      g.clip();
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      g.fillStyle = grad;
      g.fillRect(x, y, w * k, h);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(x, y, w * k, h * 0.42);
      g.restore();
    }
    if (!CLASSIC && timeLeft <= 12) {
      g.globalAlpha = 0.25 + 0.25 * Math.sin(performance.now() / 110);
      g.strokeStyle = '#ff4d6d';
      g.lineWidth = 3;
      g.beginPath();
      if (g.roundRect) g.roundRect(x, y, w, h, h / 2); else g.rect(x, y, w, h);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '11px "Press Start 2P", monospace';
    // the label sits on the fill once the bar is long enough to reach under it
    g.fillStyle = k > 0.36 ? '#0a0718' : '#fff';
    const label = CLASSIC ? goalText(classicGoal) : 'TIME';
    g.fillText(label, x + 14, y + h / 2 + 1);
    g.textAlign = 'right';
    g.fillStyle = k > 0.92 ? '#0a0718' : '#fff';
    const right = CLASSIC
      ? (classicGoal.goal === 'score' ? `${Math.min(levelScore, classicGoal.need).toLocaleString()}/${classicGoal.need.toLocaleString()}` : `${Math.min(goalProg, classicGoal.need)}/${classicGoal.need}`)
      : Math.ceil(timeLeft) + 's';
    g.fillText(right, x + w - 14, y + h / 2 + 1);
    g.restore();
  }

  function drawBanners(g) {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (comboBan) {
      const t = comboBan.t;
      const a = t < 0.15 ? t / 0.15 : t > 1.0 ? (1.3 - t) / 0.3 : 1;
      const s = 1 + 0.5 * Math.max(0, 1 - t / 0.25);
      g.save();
      g.globalAlpha = Math.max(0, a);
      g.translate(FW / 2, BY + BOARD_PX + 46);
      g.scale(s, s);
      g.shadowColor = '#ff6bd6';
      g.shadowBlur = 22;
      g.fillStyle = '#fff';
      g.font = '18px "Press Start 2P", monospace';
      g.fillText(comboBan.text, 0, 0);
      g.shadowBlur = 0;
      g.fillStyle = ACCENT;
      g.font = '11px "Press Start 2P", monospace';
      g.fillText('×' + comboBan.mult + ' SCORE', 0, 24);
      g.restore();
    }
    if (banner && state === 'play') {
      const t = banner.t;
      const a = t < 0.25 ? t / 0.25 : t > 1.7 ? (2.2 - t) / 0.5 : 1;
      g.save();
      g.globalAlpha = Math.max(0, a);
      g.fillStyle = '#000a';
      g.fillRect(0, BY + BOARD_PX / 2 - 58, FW, 116);
      g.fillStyle = '#fff';
      g.font = '26px "Press Start 2P", monospace';
      g.shadowColor = ACCENT;
      g.shadowBlur = 20;
      g.fillText(banner.text, FW / 2, BY + BOARD_PX / 2 - 16);
      g.shadowBlur = 0;
      g.fillStyle = ACCENT;
      g.font = '10px "Press Start 2P", monospace';
      g.fillText(banner.sub, FW / 2, BY + BOARD_PX / 2 + 24);
      g.restore();
    }
  }

  function render() {
    const g = ctx;
    g.setTransform(view.DPR, 0, 0, view.DPR, 0, 0);
    g.fillStyle = '#07040f';
    g.fillRect(0, 0, view.W, view.H);
    g.save();
    g.translate(offX, offY);
    g.scale(scale, scale);
    if (shake > 0.2) g.translate(rand(-shake, shake), rand(-shake, shake));
    drawBackground(g);
    drawFrame(g);
    drawGems(g);
    drawFx(g);
    if (state !== 'title') drawBar(g);
    drawBanners(g);
    if (flash > 0) {
      g.fillStyle = `rgba(255,255,255,${Math.min(0.65, flash)})`;
      g.fillRect(-200, -200, FW + 400, FH + 400);
    }
    if (paused && state === 'play') {
      g.fillStyle = '#000b';
      g.fillRect(-200, -200, FW + 400, FH + 400);
      g.fillStyle = ACCENT;
      g.font = '26px "Press Start 2P", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('PAUSED', FW / 2, BY + BOARD_PX / 2);
      g.font = '9px "Press Start 2P", monospace';
      g.fillStyle = '#bbb';
      g.fillText('P OR TAP TO RESUME', FW / 2, BY + BOARD_PX / 2 + 34);
    }
    g.restore();
  }

  // ---------------------------------------------------------------------------
  // HUD
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', high.toLocaleString());
    set('combo', cascade >= 2 ? 'CASCADE ×' + cascade : '');
    set('moves', CLASSIC ? String(Math.max(0, moves)) : String(swaps));
    set('level', state === 'title' ? '' : CLASSIC ? `LVL ${level}/${FINAL_LEVEL}` : `GEMS ${gemsCleared.toLocaleString()}`);
    set('goal', state === 'title' ? '' : CLASSIC ? goalText(LEVELS[level - 1]) : maxCascade >= 2 ? `BEST ×${maxCascade}` : '');
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  const toField = (cx, cy) => ({ x: (cx - offX) / scale, y: (cy - offY) / scale });
  function cellAt(fx, fy) {
    const c = Math.floor((fx - BX) / CELL), r = Math.floor((fy - BY) / CELL);
    return inB(r, c) ? { r, c } : null;
  }

  let press = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    if (paused) { paused = false; return; }
    const p = toField(e.clientX, e.clientY);
    const cell = cellAt(p.x, p.y);
    if (!cell) { sel = null; return; }
    press = { r: cell.r, c: cell.c, x: p.x, y: p.y, dragged: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!press || press.dragged || state !== 'play' || paused) return;
    const p = toField(e.clientX, e.clientY);
    const dx = p.x - press.x, dy = p.y - press.y;
    if (Math.hypot(dx, dy) < CELL * 0.42) return;
    press.dragged = true;
    sel = null;
    const r2 = press.r + (Math.abs(dx) > Math.abs(dy) ? 0 : dy > 0 ? 1 : -1);
    const c2 = press.c + (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : -1) : 0);
    doSwap(press.r, press.c, r2, c2);
  });
  const endPress = () => { press = null; };
  canvas.addEventListener('pointerup', (e) => {
    const p = press;
    press = null;
    if (!p || p.dragged || state !== 'play' || paused) return;
    const cell = { r: p.r, c: p.c };
    if (sel && sel.r === cell.r && sel.c === cell.c) { sel = null; return; }
    if (sel && Math.abs(sel.r - cell.r) + Math.abs(sel.c - cell.c) === 1) {
      const s = sel;
      sel = null;
      doSwap(s.r, s.c, cell.r, cell.c);
      return;
    }
    sel = cell;
    cursor = null;
    sfx.select();
  });
  canvas.addEventListener('pointercancel', endPress);

  const ARROWS = { arrowleft: [0, -1], a: [0, -1], arrowright: [0, 1], d: [0, 1], arrowup: [-1, 0], w: [-1, 0], arrowdown: [1, 0], s: [1, 0] };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in ARROWS) {
      e.preventDefault();
      if (state !== 'play' || paused) return;
      if (!cursor) cursor = sel ? { r: sel.r, c: sel.c } : { r: 3, c: 3 };
      const [dr, dc] = ARROWS[k];
      if (sel) { const s = sel; sel = null; cursor = { r: clamp(s.r + dr, 0, N - 1), c: clamp(s.c + dc, 0, N - 1) }; doSwap(s.r, s.c, s.r + dr, s.c + dc); }
      else { cursor = { r: clamp(cursor.r + dr, 0, N - 1), c: clamp(cursor.c + dc, 0, N - 1) }; }
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if ((state === 'title' || state === 'over') && !e.repeat) { start(); return; }
      if (state !== 'play' || e.repeat) return;
      if (paused) { paused = false; return; }
      if (!cursor) cursor = { r: 3, c: 3 };
      if (sel && sel.r === cursor.r && sel.c === cursor.c) sel = null;
      else { sel = { r: cursor.r, c: cursor.c }; sfx.select(); }
    } else if (k === 'p' || k === 'escape') {
      if (state === 'play') paused = !paused;
    } else if (k === 'm') $('sound-btn').click();
  });

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  if (window.Leaderboard) Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
  if (window.Leaderboard) Leaderboard.nameBar(document.querySelector('#title .panel'));
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  // title-screen legend gems
  [['lg-stripe', { c: 1, kind: 'striped-h' }], ['lg-bomb', { c: 0, kind: 'bomb' }], ['lg-color', { c: 4, kind: 'color' }]].forEach(([id, gem]) => {
    const el = $(id);
    if (!el) return;
    const g = el.getContext('2d');
    drawGem(g, Object.assign(makeGem(gem.c, gem.kind), gem), el.width / 2, el.height / 2, el.width * 0.42, 1);
  });

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'match3',
      peek: () => ({
        state, paused, phase, score, high, combo: cascade, maxCascade,
        gems: gemsCleared, specials: specialsMade, swaps,
        moves: CLASSIC ? moves : swaps,
        level: CLASSIC ? level : 1,
        time: CLASSIC ? null : Math.round(timeLeft * 100) / 100,
        goal: CLASSIC ? { type: LEVELS[level - 1].goal, need: LEVELS[level - 1].need, have: LEVELS[level - 1].goal === 'score' ? levelScore : goalProg, text: goalText(LEVELS[level - 1]) } : null,
        // the board as colour indices (-1 empty, -2 a classic drop key)
        board: board.map((row) => row.map((g) => (!g ? -1 : g.kind === 'key' ? -2 : g.c))),
        kinds: board.map((row) => row.map((g) => (g ? g.kind : null))),
      }),
      // advance the game without waiting for animation frames (they stop when the tab is hidden)
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
      swap: (r1, c1, r2, c2) => doSwap(r1, c1, r2, c2),
      bestMove,
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'time') timeLeft = v;
        else if (k === 'moves') moves = v;
        else if (k === 'level' && CLASSIC) startLevel(clamp(v, 1, FINAL_LEVEL));
        else if (k === 'goal') goalProg = v;
      },
      win: () => {
        if (!CLASSIC) { endGame(true); return; }
        level = FINAL_LEVEL;
        goalProg = LEVELS[FINAL_LEVEL - 1].need;
        levelScore = LEVELS[FINAL_LEVEL - 1].need;
        checkGoal();
      },
      start,
    };
  }

  // attract mode behind the title screen: the board plays itself
  newGame(false);
  state = 'title';
  let lastT = performance.now();
  let attractT = 0;
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    if (state === 'title') {
      attractT += dt;
      if (phase === 'idle' && attractT > 0.9) {
        attractT = 0;
        const m = bestMove();
        if (m) doSwap(m.r1, m.c1, m.r2, m.c2);
      }
    }
    render();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
