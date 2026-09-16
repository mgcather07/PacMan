(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Deterministic world
  // ---------------------------------------------------------------------------
  function hash(x, y, salt, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((salt + seed) | 0, 1103515245);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  const key = (x, y) => x + ',' + y;
  const unkey = (k) => k.split(',').map(Number);

  const NUM_COLORS = ['', '#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#ff8f00', '#0097a7', '#424242', '#9e9e9e'];
  const MIN_ZOOM = 14, MAX_ZOOM = 72;

  let G; // saved game
  let W = 0, H = 0, DPR = 1;
  let cam = { x: 0, y: 0, z: 34 };
  let flagMode = false;
  let shakeT = 0;
  let particles = [];
  let dirty = true;
  let best = 0;
  try { best = +localStorage.getItem('infmines.best') || 0; } catch (e) { /* ignore */ }

  // Classic mode: a finite board with a fixed mine count, one life and a timer
  const CLASSIC = !!(window.Arcade && Arcade.classic);
  const DIFFS = {
    beginner: { w: 9, h: 9, m: 10, name: 'Beginner' },
    intermediate: { w: 16, h: 16, m: 40, name: 'Intermediate' },
    expert: { w: 30, h: 16, m: 99, name: 'Expert' },
  };
  let diff = 'beginner';
  try { diff = localStorage.getItem('mines.classic.diff') || 'beginner'; } catch (e) { /* ignore */ }
  if (!DIFFS[diff]) diff = 'beginner';
  const inBoard = (x, y) => !CLASSIC || (x >= 0 && y >= 0 && x < G.w && y < G.h);
  const elapsed = () => (G.startT ? ((G.endT || performance.now()) - G.startT) / 1000 : 0);
  const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const bestTimeKey = () => `mines.classic.best.${diff}`;

  function freshGame() {
    return {
      seed: (Math.random() * 2 ** 31) | 0,
      safe: null,
      revealed: new Set(),
      flags: new Set(),
      exploded: new Set(),
      lives: 3,
      score: 0,
      farthest: 0,
      over: false,
      ...(CLASSIC ? { w: DIFFS[diff].w, h: DIFFS[diff].h, m: DIFFS[diff].m, mines: null, lives: 1, startT: 0, endT: 0 } : {}),
    };
  }

  function placeMines(sx, sy) {
    const cells = [];
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (Math.abs(x - sx) > 1 || Math.abs(y - sy) > 1) cells.push(key(x, y));
    for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    G.mines = new Set(cells.slice(0, G.m));
    G.startT = performance.now();
  }

  // Mines get denser the farther you travel from where you started
  function density(x, y) {
    const r = Math.hypot(x - G.safe.x, y - G.safe.y);
    return 0.15 + Math.min(0.08, r / 1500);
  }
  function isMine(x, y) {
    if (CLASSIC) return !!G.mines && G.mines.has(key(x, y));
    if (!G.safe) return false;
    if (Math.abs(x - G.safe.x) <= 1 && Math.abs(y - G.safe.y) <= 1) return false;
    return hash(x, y, 5, G.seed) < density(x, y);
  }
  function countAround(x, y) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isMine(x + dx, y + dy)) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  function reveal(x, y) {
    if (G.over || !inBoard(x, y)) return;
    const k = key(x, y);
    if (G.flags.has(k) || G.revealed.has(k) || G.exploded.has(k)) return;
    if (!G.safe) {
      G.safe = { x, y };
      if (CLASSIC) placeMines(x, y);
      $('hint').classList.add('gone');
    }
    if (isMine(x, y)) return explode(x, y);

    const queue = [[x, y]];
    let n = 0;
    while (queue.length && n < 30000) {
      const [cx, cy] = queue.pop();
      const ck = key(cx, cy);
      if (G.revealed.has(ck) || G.flags.has(ck)) continue;
      G.revealed.add(ck);
      n++;
      G.farthest = Math.max(G.farthest, Math.max(Math.abs(cx - G.safe.x), Math.abs(cy - G.safe.y)));
      if (countAround(cx, cy) === 0) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) {
            const nk = key(cx + dx, cy + dy);
            if (!G.revealed.has(nk) && !G.flags.has(nk) && inBoard(cx + dx, cy + dy)) queue.push([cx + dx, cy + dy]);
          }
        }
      }
    }
    G.score += n;
    if (n > 40) burst(x, y, '#ffe600', Math.min(40, n / 4));
    if (CLASSIC) {
      if (G.revealed.size === G.w * G.h - G.m) winBoard();
      changed();
      return;
    }
    if (G.score > best) {
      best = G.score;
      try { localStorage.setItem('infmines.best', String(best)); } catch (e) { /* ignore */ }
    }
    changed();
  }

  function winBoard() {
    G.over = true;
    G.won = true;
    G.endT = performance.now();
    for (const k of G.mines) G.flags.add(k);
    burst(G.w / 2, G.h / 2, '#ffe600', 60);
    setTimeout(() => showOver(true), 600);
  }

  function explode(x, y) {
    G.exploded.add(key(x, y));
    G.lives--;
    shakeT = 0.4;
    burst(x, y, '#ff3b30', 30);
    if (G.lives <= 0) {
      G.over = true;
      G.endT = performance.now();
      setTimeout(() => showOver(false), 900);
    } else {
      toast(`💥 BOOM! ${G.lives} ${G.lives === 1 ? 'life' : 'lives'} left`);
    }
    changed();
  }

  function toggleFlag(x, y) {
    if (G.over || !G.safe || !inBoard(x, y)) return;
    const k = key(x, y);
    if (G.revealed.has(k) || G.exploded.has(k)) return;
    if (G.flags.has(k)) G.flags.delete(k); else G.flags.add(k);
    changed();
  }

  // Click a satisfied number to open all its unflagged neighbours
  function chord(x, y) {
    const n = countAround(x, y);
    if (!n) return;
    let marked = 0;
    const open = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const k = key(x + dx, y + dy);
      if (G.flags.has(k) || G.exploded.has(k)) marked++;
      else if (!G.revealed.has(k)) open.push([x + dx, y + dy]);
    }
    if (marked !== n) return;
    for (const [ox, oy] of open) {
      if (G.over) break;
      reveal(ox, oy);
    }
  }

  function act(x, y, flag) {
    const k = key(x, y);
    if (G.revealed.has(k)) chord(x, y);
    else if (flag) toggleFlag(x, y);
    else reveal(x, y);
  }

  // ---------------------------------------------------------------------------
  // Persistence — your minefield is kept between visits
  // ---------------------------------------------------------------------------
  let saveTimer = null;
  function changed() {
    dirty = true;
    if (CLASSIC) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
  }
  function save() {
    try {
      if (G.revealed.size > 200000) return;
      localStorage.setItem('infmines.game', JSON.stringify({
        ...G,
        revealed: [...G.revealed],
        flags: [...G.flags],
        exploded: [...G.exploded],
        cam,
      }));
    } catch (e) { /* ignore */ }
  }
  function load() {
    if (CLASSIC) return false;
    try {
      const raw = JSON.parse(localStorage.getItem('infmines.game') || 'null');
      if (!raw || raw.over) return false;
      G = { ...raw, revealed: new Set(raw.revealed), flags: new Set(raw.flags), exploded: new Set(raw.exploded) };
      if (raw.cam) cam = raw.cam;
      if (G.safe) $('hint').classList.add('gone');
      return true;
    } catch (e) {
      return false;
    }
  }

  function newField() {
    G = freshGame();
    cam = { x: 0, y: 0, z: cam.z };
    if (CLASSIC) {
      cam = { x: G.w / 2, y: G.h / 2 - 20 / Math.max(1, cam.z), z: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(Math.min((W - 30) / G.w, (H - 150) / G.h)))) };
      cam.y = G.h / 2 - 25 / cam.z;
    }
    particles = [];
    $('over').hidden = true;
    $('hint').classList.remove('gone');
    changed();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    dirty = true;
  }
  window.addEventListener('resize', resize);

  const screenToCell = (sx, sy) => ({
    x: Math.floor((sx - W / 2) / cam.z + cam.x),
    y: Math.floor((sy - H / 2) / cam.z + cam.y),
  });

  function render(time) {
    const z = cam.z;
    let sx = 0, sy = 0;
    if (shakeT > 0) { sx = (Math.random() - 0.5) * 14 * shakeT; sy = (Math.random() - 0.5) * 14 * shakeT; }
    ctx.setTransform(DPR, 0, 0, DPR, sx * DPR, sy * DPR);
    ctx.fillStyle = '#1c2b12';
    ctx.fillRect(-20, -20, W + 40, H + 40);

    const x0 = Math.floor(cam.x - W / 2 / z) - 1, x1 = Math.ceil(cam.x + W / 2 / z) + 1;
    const y0 = Math.floor(cam.y - H / 2 / z) - 1, y1 = Math.ceil(cam.y + H / 2 / z) + 1;
    const px = (x) => Math.round(W / 2 + (x - cam.x) * z);
    const py = (y) => Math.round(H / 2 + (y - cam.y) * z);

    const edges = new Path2D();
    const numbers = [];
    const flags = [];
    const mines = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBoard(x, y)) continue;
        const k = key(x, y);
        const L = px(x), T = py(y), R = px(x + 1), B = py(y + 1);
        const odd = (x + y) & 1;
        if (G.revealed.has(k)) {
          ctx.fillStyle = odd ? '#d7b899' : '#e5c29f';
          ctx.fillRect(L, T, R - L, B - T);
          const n = countAround(x, y);
          if (n) numbers.push([n, (L + R) / 2, (T + B) / 2]);
        } else if (G.exploded.has(k)) {
          ctx.fillStyle = '#e04a3f';
          ctx.fillRect(L, T, R - L, B - T);
          mines.push([(L + R) / 2, (T + B) / 2, true]);
        } else {
          ctx.fillStyle = odd ? '#a2d149' : '#aad751';
          ctx.fillRect(L, T, R - L, B - T);
          const e = Math.max(1, z * 0.07);
          if (G.revealed.has(key(x - 1, y))) edges.rect(L, T, e, B - T);
          if (G.revealed.has(key(x + 1, y))) edges.rect(R - e, T, e, B - T);
          if (G.revealed.has(key(x, y - 1))) edges.rect(L, T, R - L, e);
          if (G.revealed.has(key(x, y + 1))) edges.rect(L, B - e, R - L, e);
          if (G.flags.has(k)) flags.push([(L + R) / 2, (T + B) / 2]);
          else if (G.over && isMine(x, y)) mines.push([(L + R) / 2, (T + B) / 2, false]);
        }
      }
    }
    ctx.fillStyle = '#87af3a';
    ctx.fill(edges);
    if (CLASSIC) {
      ctx.strokeStyle = '#4a752c';
      ctx.lineWidth = 4;
      ctx.strokeRect(px(0) - 2, py(0) - 2, px(G.w) - px(0) + 4, py(G.h) - py(0) + 4);
    }

    if (z >= 16) {
      ctx.font = `800 ${Math.round(z * 0.62)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const [n, cx, cy] of numbers) {
        ctx.fillStyle = NUM_COLORS[n];
        ctx.fillText(n, cx, cy + z * 0.04);
      }
    }

    for (const [cx, cy, boom] of mines) {
      const r = z * 0.24;
      ctx.fillStyle = boom ? '#5a0d08' : '#2b2b2b';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(1, z * 0.06);
      ctx.beginPath();
      for (let a = 0; a < 4; a++) {
        const ang = (a * Math.PI) / 4;
        ctx.moveTo(cx + Math.cos(ang) * r * 1.5, cy + Math.sin(ang) * r * 1.5);
        ctx.lineTo(cx - Math.cos(ang) * r * 1.5, cy - Math.sin(ang) * r * 1.5);
      }
      ctx.stroke();
      ctx.fillStyle = '#ffffffaa';
      ctx.beginPath();
      ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const [cx, cy] of flags) {
      const s = z * 0.5;
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(cx - s * 0.32, cy - s * 0.55, Math.max(1.5, s * 0.1), s * 1.1);
      ctx.fillStyle = '#f23607';
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.25, cy - s * 0.55);
      ctx.lineTo(cx + s * 0.5, cy - s * 0.25);
      ctx.lineTo(cx - s * 0.25, cy + s * 0.05);
      ctx.closePath();
      ctx.fill();
    }

    // start marker
    if (G.safe) {
      const L = px(G.safe.x - 1), T = py(G.safe.y - 1);
      ctx.strokeStyle = '#ffffff55';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(L, T, z * 3, z * 3);
      ctx.setLineDash([]);
    }

    // hover highlight
    if (hover && !G.over && !drag) {
      const L = px(hover.x), T = py(hover.y);
      ctx.fillStyle = '#ffffff30';
      ctx.fillRect(L, T, z, z);
    }

    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(W / 2 + (p.x - cam.x) * z - 3, H / 2 + (p.y - cam.y) * z - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3, t: 0, life: 0.6 + Math.random() * 0.5, c: color });
    }
  }

  // ---------------------------------------------------------------------------
  // HUD / overlays
  // ---------------------------------------------------------------------------
  const last = {};
  function hudSet(id, v) { if (last[id] !== v) { last[id] = v; $(id).textContent = v; } }
  function updateHud() {
    if (CLASSIC) {
      hudSet('score', String(G.m - G.flags.size));
      const bt = +(localStorage.getItem(bestTimeKey()) || 0);
      hudSet('best', bt ? fmtTime(bt) : '—');
      hudSet('lives', G.over ? (G.won ? '🏆' : '💥') : '❤️');
      hudSet('flags', `${G.revealed.size}/${G.w * G.h - G.m}`);
      hudSet('dist', fmtTime(elapsed()));
      return;
    }
    hudSet('score', G.score.toLocaleString());
    hudSet('best', best.toLocaleString());
    hudSet('lives', '❤️'.repeat(Math.max(0, G.lives)) + '🖤'.repeat(Math.max(0, 3 - G.lives)));
    hudSet('flags', String(G.flags.size));
    hudSet('dist', String(G.farthest));
  }

  let toastT = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function showOver(won) {
    $('o-score').textContent = G.score.toLocaleString();
    $('o-dist').textContent = CLASSIC ? fmtTime(elapsed()) : G.farthest;
    $('o-flags').textContent = G.flags.size;
    let msg = '';
    if (CLASSIC && won) {
      const t = elapsed();
      let prev = 0;
      try { prev = +(localStorage.getItem(bestTimeKey()) || 0); } catch (e) { /* ignore */ }
      if (!prev || t < prev) { try { localStorage.setItem(bestTimeKey(), String(t)); } catch (e) { /* ignore */ } msg = `${DIFFS[diff].name} cleared in ${fmtTime(t)} — new best!`; }
      else msg = `${DIFFS[diff].name} cleared in ${fmtTime(t)} (best ${fmtTime(prev)})`;
    }
    if (window.Arcade) Arcade.endScreen(!!won, msg);
    $('over').hidden = false;
    if (!CLASSIC) { try { localStorage.removeItem('infmines.game'); } catch (e) { /* ignore */ } }
  }

  function setFlagMode(on) {
    flagMode = on;
    const b = $('mode-btn');
    b.textContent = on ? '🚩 Flag' : '⛏️ Dig';
    b.classList.toggle('flag', on);
  }

  // ---------------------------------------------------------------------------
  // Input: click = dig, right-click / long-press / flag mode = flag, drag = pan
  // ---------------------------------------------------------------------------
  const pointers = new Map();
  let drag = null;
  let hover = null;
  let pinch = null;
  let longPressTimer = null;

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      clearTimeout(longPressTimer);
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.z };
      drag = null;
      return;
    }
    drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false, button: e.button, handled: false };
    if (e.pointerType !== 'mouse') {
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        if (drag && !drag.moved) {
          drag.handled = true;
          const c = screenToCell(drag.sx, drag.sy);
          act(c.x, c.y, !flagMode);
          if (navigator.vibrate) navigator.vibrate(30);
        }
      }, 420);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.z * (d / pinch.d)));
      dirty = true;
      return;
    }
    if (e.pointerType === 'mouse') {
      const c = screenToCell(e.clientX, e.clientY);
      if (!hover || hover.x !== c.x || hover.y !== c.y) { hover = c; dirty = true; }
    }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 7) { drag.moved = true; clearTimeout(longPressTimer); canvas.classList.add('panning'); }
    if (drag.moved) {
      cam.x = drag.cx - dx / cam.z;
      cam.y = drag.cy - dy / cam.z;
      dirty = true;
    }
  });

  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    clearTimeout(longPressTimer);
    canvas.classList.remove('panning');
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) { changed(); return; }
    if (d.handled || e.type === 'pointercancel') return;
    const c = screenToCell(e.clientX, e.clientY);
    act(c.x, c.y, d.button === 2 ? true : flagMode);
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', () => { hover = null; dirty = true; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const before = { x: (e.clientX - W / 2) / cam.z + cam.x, y: (e.clientY - H / 2) / cam.z + cam.y };
    cam.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.z * Math.exp(-e.deltaY * 0.0015)));
    cam.x = before.x - (e.clientX - W / 2) / cam.z;
    cam.y = before.y - (e.clientY - H / 2) / cam.z;
    dirty = true;
  }, { passive: false });

  const held = new Set();
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) { e.preventDefault(); held.add(k); }
    else if (k === 'f') setFlagMode(!flagMode);
    else if (k === 'h') goHome();
    else if (k === '=' || k === '+') { cam.z = Math.min(MAX_ZOOM, cam.z * 1.2); dirty = true; }
    else if (k === '-') { cam.z = Math.max(MIN_ZOOM, cam.z / 1.2); dirty = true; }
    else if (k === ' ' && hover) { e.preventDefault(); act(hover.x, hover.y, true); }
  });
  window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));

  function goHome() {
    if (CLASSIC) { homeAnim = { x: G.w / 2, y: G.h / 2 - 25 / cam.z }; return; }
    const c = G.safe || { x: 0, y: 0 };
    homeAnim = { x: c.x + 0.5, y: c.y + 0.5 };
  }
  let homeAnim = null;

  $('mode-btn').addEventListener('click', (e) => { setFlagMode(!flagMode); e.currentTarget.blur(); });
  $('home-btn').addEventListener('click', goHome);
  $('new-btn').addEventListener('click', () => {
    if (!CLASSIC && G.safe && !G.over && !confirm('Start a brand-new minefield? Your current field will be lost.')) return;
    newField();
  });
  $('again-btn').addEventListener('click', newField);
  $('zin').addEventListener('click', () => { cam.z = Math.min(MAX_ZOOM, cam.z * 1.25); dirty = true; });
  $('zout').addEventListener('click', () => { cam.z = Math.max(MIN_ZOOM, cam.z / 1.25); dirty = true; });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    if (held.size) {
      const sp = (600 / cam.z) * dt;
      if (held.has('arrowleft') || held.has('a')) cam.x -= sp;
      if (held.has('arrowright') || held.has('d')) cam.x += sp;
      if (held.has('arrowup') || held.has('w')) cam.y -= sp;
      if (held.has('arrowdown') || held.has('s')) cam.y += sp;
      dirty = true;
    }
    if (homeAnim) {
      cam.x += (homeAnim.x - cam.x) * Math.min(1, dt * 8);
      cam.y += (homeAnim.y - cam.y) * Math.min(1, dt * 8);
      if (Math.hypot(homeAnim.x - cam.x, homeAnim.y - cam.y) < 0.05) homeAnim = null;
      dirty = true;
    }
    if (shakeT > 0) { shakeT -= dt; dirty = true; }
    if (CLASSIC && G.startT && !G.over && Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) dirty = true;
    if (particles.length) {
      for (const p of particles) { p.t += dt; p.vy += 14 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
      particles = particles.filter((p) => p.t < p.life);
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      render(now);
      updateHud();
    }
    requestAnimationFrame(frame);
  }

  resize();
  if (CLASSIC) {
    const sel = $('diff');
    sel.value = diff;
    sel.addEventListener('change', () => {
      diff = sel.value;
      try { localStorage.setItem('mines.classic.diff', diff); } catch (e) { /* ignore */ }
      sel.blur();
      newField();
    });
    newField();
  } else {
    if (!load()) newField();
    cam.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.z || Math.round(Math.min(W, H) / 18)));
    if (!G.safe) cam.z = Math.max(24, Math.min(40, Math.round(Math.min(W, H) / 18)));
  }
  setFlagMode(false);
  requestAnimationFrame(frame);
})();
