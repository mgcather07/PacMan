(() => {
  'use strict';

  const { Sound, setupCanvas, toast, store, soundButton, rand, clamp } = Arcade;
  const canvas = document.getElementById('game');
  const $ = (id) => document.getElementById(id);

  const COLS = 10, VIEW_ROWS = 20, MAX_LEAKS = 5;
  const COLORS = { I: '#3fd8ff', O: '#ffd23f', T: '#c77dff', S: '#7dff6a', Z: '#ff4d6d', J: '#4d7dff', L: '#ff9f3d' };
  // spawn shapes, top row first
  const SHAPES = {
    I: ['....', 'IIII', '....', '....'],
    O: ['OO', 'OO'],
    T: ['.T.', 'TTT', '...'],
    S: ['.SS', 'SS.', '...'],
    Z: ['ZZ.', '.ZZ', '...'],
    J: ['J..', 'JJJ', '...'],
    L: ['..L', 'LLL', '...'],
  };
  // SRS wall kicks (x right, y up), keyed "from>to"
  const KICKS = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]], '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]], '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]], '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]], '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]], '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]], '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]], '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]], '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 1], [2, -2]],
  };

  // Precompute rotation states as y-up cell offsets within the piece box
  const ROT = {};
  for (const [k, rowsDef] of Object.entries(SHAPES)) {
    const n = rowsDef.length;
    let cells = [];
    rowsDef.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== '.') cells.push([c, n - 1 - r]); }));
    const states = [cells];
    const cc = (n - 1) / 2;
    for (let i = 1; i < 4; i++) {
      cells = cells.map(([x, y]) => [cc + (y - cc), cc - (x - cc)]);
      states.push(cells);
    }
    ROT[k] = { n, states };
  }

  let S = 28, boardX = 0, boardY = 0;
  const view = setupCanvas(canvas, layout);
  const ctx = view.ctx;
  function layout(v) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const top = 64, bottom = coarse ? 170 : 24;
    const availH = v.H - top - bottom;
    const panel = v.W < 560 ? 3.6 : 5.5;
    S = Math.floor(Math.min(availH / VIEW_ROWS, (v.W - 16) / (COLS + panel * 2)));
    boardX = Math.floor((v.W - COLS * S) / 2);
    boardY = Math.floor(top + (availH - VIEW_ROWS * S) / 2);
  }

  let mode = store.get('tetris.mode', 'tower');
  let state = 'title';
  let paused = false;
  let rows, piece, bag, queue, hold, holdUsed, score, lines, level, time, gravityT, lockT, lockMoves, camBottom, camDraw, tide, tideChecked, leaks, maxHeight, particles, flashes, combo, backToBack, lastClear, das;
  const highKey = () => `tetris.high.${mode}`;

  // ---------------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------------
  const emptyRow = () => ({ cells: Array(COLS).fill(null), gold: false });
  function cellAt(x, y) {
    if (x < 0 || x >= COLS || y < 0) return 'wall';
    if (y >= rows.length) return null;
    return rows[y].cells[x];
  }
  function topRow() {
    for (let y = rows.length - 1; y >= 0; y--) if (rows[y].cells.some(Boolean)) return y;
    return -1;
  }
  const cellsOf = (p, rot = p.rot, px = p.x, py = p.y) => ROT[p.type].states[rot].map(([cx, cy]) => [px + cx, py + cy]);
  const fits = (p, rot, px, py) => cellsOf(p, rot, px, py).every(([x, y]) => !cellAt(x, y));

  function refillBag() {
    const b = Object.keys(SHAPES);
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    bag.push(...b);
  }
  function nextType() {
    while (queue.length < 6) { if (!bag.length) refillBag(); queue.push(bag.shift()); }
    return queue.shift();
  }

  function spawn(type) {
    const spawnTop = mode === 'tower' ? Math.max(camBottom + VIEW_ROWS - 1, topRow() + 4) : VIEW_ROWS - 1;
    // spawn shapes have an empty row in their box; place the highest cell on the spawn row
    const highestCell = Math.max(...ROT[type].states[0].map(([, y]) => y));
    const p = { type, rot: 0, x: type === 'O' ? 4 : 3, y: spawnTop - highestCell };
    if (!fits(p, 0, p.x, p.y)) {
      if (mode === 'marathon') { p.y += 1; if (!fits(p, 0, p.x, p.y)) return gameOver('TOPPED OUT'); }
    }
    piece = p;
    lockT = 0;
    lockMoves = 0;
    gravityT = 0;
    holdUsed = false;
  }

  // ---------------------------------------------------------------------------
  // Game flow
  // ---------------------------------------------------------------------------
  function newGame() {
    rows = [];
    bag = []; queue = [];
    hold = null; holdUsed = false;
    score = 0; lines = 0; level = 1; time = 0; combo = -1; backToBack = false;
    camBottom = 0; camDraw = 0; tide = -4; tideChecked = 0; leaks = 0; maxHeight = 0;
    particles = []; flashes = []; lastClear = '';
    das = { dir: 0, t: 0 };
    spawn(nextType());
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    paused = false;
    newGame();
    state = 'play';
    $('mode-label').textContent = mode === 'tower' ? 'TOWER' : 'MARATHON';
  }

  function gameOver(reason) {
    state = 'over';
    piece = null;
    Sound.tone(600, 60, 1.0, 'sawtooth', 0.05);
    const high = store.get(highKey(), 0);
    if (score > high) store.set(highKey(), score);
    $('o-reason').textContent = reason;
    $('o-score').textContent = score.toLocaleString();
    $('o-lines').textContent = lines;
    $('o-third-label').textContent = mode === 'tower' ? 'HEIGHT' : 'LEVEL';
    $('o-third').textContent = mode === 'tower' ? maxHeight : level;
    $('over').hidden = false;
  }

  const gravityInterval = () => Math.pow(Math.max(0.05, 0.8 - (Math.min(level, 20) - 1) * 0.007), Math.min(level, 20) - 1);

  function tryMove(dx, dy) {
    if (!piece) return false;
    if (fits(piece, piece.rot, piece.x + dx, piece.y + dy)) {
      piece.x += dx; piece.y += dy;
      if (dx) piece.lastRotate = false;
      if (dx && onGround() && lockMoves < 15) { lockT = 0; lockMoves++; }
      return true;
    }
    return false;
  }
  const onGround = () => piece && !fits(piece, piece.rot, piece.x, piece.y - 1);

  function rotate(dir) {
    if (!piece || piece.type === 'O') return;
    const from = piece.rot, to = (from + dir + 4) % 4;
    const table = (piece.type === 'I' ? KICKS_I : KICKS)[`${from}>${to}`];
    for (const [kx, ky] of table) {
      if (fits(piece, to, piece.x + kx, piece.y + ky)) {
        piece.x += kx; piece.y += ky; piece.rot = to;
        piece.lastRotate = true;
        if (onGround() && lockMoves < 15) { lockT = 0; lockMoves++; }
        Sound.tone(520, 620, 0.04, 'triangle', 0.03);
        return;
      }
    }
  }

  function hardDrop() {
    if (!piece) return;
    let d = 0;
    while (tryMove(0, -1)) d++;
    score += d * 2;
    Sound.tone(180, 90, 0.08, 'square', 0.05);
    lock();
  }

  function holdPiece() {
    if (!piece || holdUsed) return;
    const t = piece.type;
    if (hold) { const h = hold; hold = t; spawn(h); } else { hold = t; spawn(nextType()); }
    holdUsed = true;
    Sound.tone(400, 300, 0.06, 'triangle', 0.03);
  }

  function isTSpin() {
    if (piece.type !== 'T' || !piece.lastRotate) return false;
    const cx = piece.x + 1, cy = piece.y + 1;
    let corners = 0;
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (cellAt(cx + dx, cy + dy)) corners++;
    return corners >= 3;
  }

  function lock() {
    const tspin = isTSpin();
    for (const [x, y] of cellsOf(piece)) {
      while (rows.length <= y) rows.push(emptyRow());
      rows[y].cells[x] = piece.type;
    }
    const lockedTop = Math.max(...cellsOf(piece).map(([, y]) => y));
    piece = null;

    // find newly completed rows
    const full = [];
    for (let y = 0; y < rows.length; y++) if (!rows[y].gold && rows[y].cells.every(Boolean)) full.push(y);
    const n = full.length;
    const labels = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'];
    if (n || tspin) {
      const base = tspin ? [400, 800, 1200, 1600][n] : [0, 100, 300, 500, 800][n];
      const b2b = (n === 4 || (tspin && n > 0)) && backToBack;
      combo = n ? combo + 1 : -1;
      const pts = Math.round(base * level * (b2b ? 1.5 : 1)) + (combo > 0 ? 50 * combo * level : 0);
      score += pts;
      if (n) backToBack = n === 4 || tspin;
      lastClear = `${tspin ? 'T-SPIN ' : ''}${labels[n]}${b2b ? ' B2B' : ''}${combo > 0 ? ` · COMBO ${combo}` : ''}`.trim();
      if (lastClear) showClear(lastClear);
    } else combo = -1;

    if (n) {
      lines += n;
      Sound.arp(n === 4 ? [523, 659, 784, 1046, 1318] : [440, 660, 880].slice(0, n + 1), 0.06, 'square', 0.04);
      for (const y of full) {
        flashes.push({ y, t: 0 });
        for (let x = 0; x < COLS; x++) particles.push({ x: x + 0.5, y: y + 0.5, vx: rand(-4, 4), vy: rand(2, 8), t: 0, life: rand(0.4, 0.8), c: COLORS[rows[y].cells[x]] });
      }
      if (mode === 'marathon') {
        for (let i = full.length - 1; i >= 0; i--) rows.splice(full[i], 1);
        const newLevel = 1 + Math.floor(lines / 10);
        if (newLevel > level) { level = newLevel; toast(`LEVEL ${level}`); }
      } else {
        for (const y of full) rows[y].gold = true;
        if (n === 4 && leaks > 0) { leaks--; toast('TETRIS! One leak repaired'); }
      }
    } else {
      Sound.tone(140, 120, 0.05, 'square', 0.03);
    }

    if (mode === 'marathon') {
      if (lockedTop >= VIEW_ROWS && !full.length) return gameOver('LOCKED OUT');
    } else {
      const h = topRow() + 1;
      if (h > maxHeight) { score += (h - maxHeight) * 10; maxHeight = h; }
      level = 1 + Math.floor(lines / 10);
      camBottom = Math.max(camBottom, topRow() + 1 - 11);
    }
    const high = store.get(highKey(), 0);
    if (score > high) store.set(highKey(), score);
    spawn(nextType());
  }

  let clearTimer = null;
  function showClear(text) {
    const el = $('clear');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(clearTimer);
    clearTimer = setTimeout(() => el.classList.remove('show'), 1100);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  const held = new Set();

  function update(dt) {
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 20 * dt; }
    particles = particles.filter((p) => p.t < p.life);
    for (const f of flashes) f.t += dt;
    flashes = flashes.filter((f) => f.t < 0.35);
    camDraw += (camBottom - camDraw) * Math.min(1, dt * 6);
    if (state !== 'play' || !piece) return;
    time += dt;

    // auto-shift
    const dir = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    if (dir !== das.dir) { das = { dir, t: 0 }; if (dir) tryMove(dir, 0); }
    else if (dir) {
      das.t += dt;
      while (das.t > 0.17) { if (!tryMove(dir, 0)) break; das.t -= 0.045; }
    }

    const soft = held.has('down');
    gravityT += dt;
    const interval = soft ? Math.min(0.04, gravityInterval() / 20) : gravityInterval();
    while (gravityT >= interval) {
      gravityT -= interval;
      if (tryMove(0, -1)) { piece.lastRotate = false; if (soft) score += 1; }
      else break;
    }
    if (onGround()) {
      lockT += dt;
      if (lockT >= 0.5) { lock(); return; }
    } else lockT = 0;

    if (mode === 'tower') {
      // The tide rises steadily; every row it reaches that isn't completed (gold) leaks
      tide += Math.min(0.4, 0.085 + time * 0.0006) * dt;
      while (tideChecked + 1 <= tide) {
        const row = rows[tideChecked];
        if (!row || !row.gold) {
          leaks++;
          if (row) row.leaked = true;
          Sound.tone(300, 120, 0.3, 'sine', 0.06);
          if (leaks >= MAX_LEAKS) return gameOver('YOUR TOWER FLOODED');
          toast(`💧 Row ${tideChecked + 1} leaked (${leaks}/${MAX_LEAKS})`);
        }
        tideChecked++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function drawCell(px, py, size, color, alpha = 1, gold = false) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gold ? '#ffcf40' : color;
    ctx.fillRect(px + 1, py + 1, size - 2, size - 2);
    ctx.fillStyle = '#ffffff55';
    ctx.fillRect(px + 1, py + 1, size - 2, Math.max(2, size * 0.14));
    ctx.fillStyle = '#00000040';
    ctx.fillRect(px + 1, py + size - 1 - Math.max(2, size * 0.14), size - 2, Math.max(2, size * 0.14));
    if (gold) { ctx.fillStyle = color; ctx.globalAlpha = alpha * 0.35; ctx.fillRect(px + size * 0.3, py + size * 0.3, size * 0.4, size * 0.4); }
    ctx.globalAlpha = 1;
  }

  const rowToY = (y, cam) => boardY + (VIEW_ROWS - 1 - (y - cam)) * S;

  function render(t) {
    const { W, H, DPR } = view;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#07061a';
    ctx.fillRect(0, 0, W, H);
    if (!rows) return;
    const cam = mode === 'tower' ? camDraw : 0;

    // board background
    ctx.fillStyle = '#0e0c2a';
    ctx.fillRect(boardX, boardY, COLS * S, VIEW_ROWS * S);
    ctx.strokeStyle = '#ffffff0d';
    ctx.lineWidth = 1;
    for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(boardX + x * S + 0.5, boardY); ctx.lineTo(boardX + x * S + 0.5, boardY + VIEW_ROWS * S); ctx.stroke(); }

    ctx.save();
    ctx.beginPath(); ctx.rect(boardX, boardY, COLS * S, VIEW_ROWS * S); ctx.clip();

    // height markers in tower mode
    if (mode === 'tower') {
      ctx.font = `${Math.max(7, S * 0.3)}px "Press Start 2P", monospace`;
      ctx.fillStyle = '#ffffff30';
      ctx.textAlign = 'left';
      for (let y = Math.ceil(cam / 10) * 10; y < cam + VIEW_ROWS + 1; y += 10) {
        const py = rowToY(y, cam) + S;
        ctx.fillRect(boardX, py, COLS * S, 1);
        ctx.fillText(String(y), boardX + 3, py - 3);
      }
    }

    const y0 = Math.max(0, Math.floor(cam) - 1), y1 = Math.ceil(cam) + VIEW_ROWS + 1;
    for (let y = y0; y <= y1 && y < rows.length; y++) {
      const row = rows[y];
      row.cells.forEach((c, x) => { if (c) drawCell(boardX + x * S, rowToY(y, cam), S, row.leaked ? '#4a6a9a' : COLORS[c], row.leaked ? 0.75 : 1, row.gold); });
    }
    for (const f of flashes) {
      ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - f.t / 0.35)})`;
      ctx.fillRect(boardX, rowToY(f.y, cam), COLS * S, S);
    }

    if (piece && state === 'play') {
      let gy = piece.y;
      while (fits(piece, piece.rot, piece.x, gy - 1)) gy--;
      for (const [x, y] of cellsOf(piece, piece.rot, piece.x, gy)) {
        ctx.strokeStyle = COLORS[piece.type] + 'aa';
        ctx.lineWidth = 2;
        ctx.strokeRect(boardX + x * S + 2.5, rowToY(y, cam) + 2.5, S - 5, S - 5);
      }
      const lockFade = onGround() ? 0.65 + 0.35 * Math.cos(lockT * 20) : 1;
      for (const [x, y] of cellsOf(piece)) drawCell(boardX + x * S, rowToY(y, cam), S, COLORS[piece.type], lockFade);
    }

    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(boardX + p.x * S - 3, rowToY(p.y, cam) + S / 2 - 3, 6, 6);
    }
    ctx.globalAlpha = 1;

    // the tide
    if (mode === 'tower') {
      const topY = boardY + (VIEW_ROWS - (tide - cam)) * S;
      if (topY < boardY + VIEW_ROWS * S) {
        const g = ctx.createLinearGradient(0, topY, 0, topY + S * 6);
        g.addColorStop(0, 'rgba(40,140,255,0.55)');
        g.addColorStop(1, 'rgba(10,40,140,0.85)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(boardX, boardY + VIEW_ROWS * S);
        for (let x = 0; x <= COLS * S; x += 6) ctx.lineTo(boardX + x, topY + Math.sin(t * 3 + x * 0.05) * 3);
        ctx.lineTo(boardX + COLS * S, boardY + VIEW_ROWS * S);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#9fd8ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x <= COLS * S; x += 6) { const yy = topY + Math.sin(t * 3 + x * 0.05) * 3; x ? ctx.lineTo(boardX + x, yy) : ctx.moveTo(boardX, yy); }
        ctx.stroke();
      }
    }
    ctx.restore();

    // frame
    ctx.strokeStyle = mode === 'tower' ? '#c77dff88' : '#3fd8ff88';
    ctx.lineWidth = 2;
    ctx.strokeRect(boardX - 1, boardY - 1, COLS * S + 2, VIEW_ROWS * S + 2);

    // tide indicator when below view
    if (mode === 'tower' && tide < cam) {
      const below = Math.ceil(cam - tide);
      ctx.fillStyle = '#9fd8ff';
      ctx.font = `${Math.max(7, S * 0.32)}px "Press Start 2P", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(`▼ TIDE ${below} ROWS BELOW`, boardX + (COLS * S) / 2, boardY + VIEW_ROWS * S + Math.max(12, S * 0.6));
    }

    // side panels: hold & next
    const small = S * 0.6;
    ctx.font = `${Math.max(7, S * 0.32)}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#ffffff99';
    ctx.textAlign = 'center';
    const leftX = boardX - S * 0.5 - small * 4.2, rightX = boardX + COLS * S + S * 0.5;
    ctx.fillText('HOLD', leftX + small * 2.1, boardY + S * 0.4);
    ctx.fillText('NEXT', rightX + small * 2.1, boardY + S * 0.4);
    if (hold) drawMini(hold, leftX, boardY + S * 0.9, small, holdUsed ? 0.35 : 1);
    if (queue) queue.slice(0, 5).forEach((q, i) => drawMini(q, rightX, boardY + S * 0.9 + i * small * 3.2, i === 0 ? small : small * 0.8, i === 0 ? 1 : 0.7));

    if (paused && state === 'play') {
      ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#c77dff'; ctx.font = '24px "Press Start 2P", monospace'; ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H / 2);
    }
  }

  function drawMini(type, x, y, size, alpha) {
    const cells = ROT[type].states[0];
    const minX = Math.min(...cells.map((c) => c[0])), maxX = Math.max(...cells.map((c) => c[0]));
    const maxY = Math.max(...cells.map((c) => c[1])), minY = Math.min(...cells.map((c) => c[1]));
    const w = (maxX - minX + 1) * size, h = (maxY - minY + 1) * size;
    const ox = x + (size * 4.2 - w) / 2, oy = y + (size * 2.6 - h) / 2;
    for (const [cx, cy] of cells) drawCell(ox + (cx - minX) * size, oy + (maxY - cy) * size, size, COLORS[type], alpha);
  }

  // ---------------------------------------------------------------------------
  // HUD & input
  // ---------------------------------------------------------------------------
  const last = {};
  function hud() {
    const set = (id, v) => { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } };
    set('score', score.toLocaleString());
    set('high', Math.max(score, store.get(highKey(), 0)).toLocaleString());
    set('lines', String(lines));
    set('level', mode === 'tower' ? `${'💧'.repeat(leaks)}${'·'.repeat(MAX_LEAKS - leaks)}` : `LEVEL ${level}`);
  }

  function act(action) {
    if (state !== 'play' || paused) return;
    switch (action) {
      case 'cw': rotate(1); break;
      case 'ccw': rotate(-1); break;
      case 'hard': hardDrop(); break;
      case 'hold': holdPiece(); break;
    }
  }

  const KEYS = {
    arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowdown: 'down', s: 'down',
    arrowup: 'cw', x: 'cw', w: 'cw', z: 'ccw', control: 'ccw', q: 'ccw', ' ': 'hard', c: 'hold', shift: 'hold',
  };
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in KEYS) {
      e.preventDefault();
      if (state === 'title' || state === 'over') { if (!e.repeat && (k === ' ' || k === 'enter')) start(); return; }
      const a = KEYS[k];
      if (a === 'left' || a === 'right' || a === 'down') held.add(a);
      else if (!e.repeat) act(a);
    } else if (k === 'p' || k === 'escape') { if (state === 'play') paused = !paused; }
    else if (k === 'm') $('sound-btn').click();
    else if (k === 'enter' && (state === 'title' || state === 'over')) start();
  });
  window.addEventListener('keyup', (e) => {
    const a = KEYS[e.key.toLowerCase()];
    if (a) held.delete(a);
  });
  window.addEventListener('blur', () => held.clear());

  document.querySelectorAll('[data-hold]').forEach((b) => {
    const a = b.dataset.hold;
    const down = (e) => { e.preventDefault(); held.add(a); b.classList.add('on'); };
    const up = (e) => { e.preventDefault(); held.delete(a); b.classList.remove('on'); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); act(b.dataset.act); }));

  function setMode(m) {
    mode = m;
    store.set('tetris.mode', m);
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  setMode(mode);

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('menu-btn').addEventListener('click', () => { $('over').hidden = true; $('title').hidden = false; state = 'title'; });
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });

  newGame();
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (!paused) update(dt);
    render(now / 1000);
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();
