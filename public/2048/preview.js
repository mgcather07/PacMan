/* Home-page preview: a little 4×4 board playing itself, tiles sliding and merging. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {})['2048'] = function (canvas) {
  const ctx = canvas.getContext('2d');
  const N = 4, SLIDE = 0.16, WAIT = 0.62;
  const SANS = 'Inter, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  const COLORS = {
    2: ['#eee4da', '#6b6257'], 4: ['#ede0c8', '#6b6257'], 8: ['#f2b179', '#2a1c10'], 16: ['#f59563', '#2a1c10'],
    32: ['#f67c5f', '#fff6ef'], 64: ['#f65e3b', '#fff6ef'], 128: ['#edcf72', '#2a1c10'], 256: ['#edcc61', '#2a1c10'],
    512: ['#edc850', '#2a1c10'], 1024: ['#edc53f', '#2a1c10'], 2048: ['#edc22e', '#2a1c10'],
  };
  let raf = 0, last = performance.now(), tiles = [], ghosts = [], anim = SLIDE, wait = 0.3;

  const at = (r, c) => tiles.find((t) => t.r === r && t.c === c);
  function spawn() {
    const free = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (!at(r, c)) free.push([r, c]);
    if (!free.length) return;
    const [r, c] = free[Math.floor(Math.random() * free.length)];
    tiles.push({ v: Math.random() < 0.9 ? 2 : 4, r, c, fr: r, fc: c, born: true });
  }
  function deal() { tiles = []; ghosts = []; spawn(); spawn(); spawn(); }

  function move(dir) {
    const before = tiles.map((t) => `${t.r},${t.c},${t.v}`).join('|');
    const kept = [];
    ghosts = [];
    for (const t of tiles) { t.fr = t.r; t.fc = t.c; t.born = false; }
    for (let i = 0; i < N; i++) {
      const coords = [];
      for (let k = 0; k < N; k++) {
        if (dir === 0) coords.push([i, N - 1 - k]);
        else if (dir === 1) coords.push([N - 1 - k, i]);
        else if (dir === 2) coords.push([i, k]);
        else coords.push([k, i]);
      }
      const line = coords.map(([r, c]) => at(r, c)).filter(Boolean);
      let slot = 0;
      for (let j = 0; j < line.length; j++) {
        const a = line[j], b = line[j + 1];
        const [r, c] = coords[slot];
        a.pop = false;
        if (b && b.v === a.v) { a.v *= 2; a.pop = true; ghosts.push({ v: b.v, fr: b.r, fc: b.c, r, c }); j++; }
        a.r = r; a.c = c;
        kept.push(a);
        slot++;
      }
    }
    tiles = kept;
    if (tiles.map((t) => `${t.r},${t.c},${t.v}`).join('|') === before && !ghosts.length) return false;
    spawn();
    return true;
  }
  deal();

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0810';
    ctx.fillRect(0, 0, W, H);

    anim += dt;
    if (anim >= SLIDE) {
      ghosts = [];
      wait += dt;
      if (wait > WAIT) {
        wait = 0; anim = 0;
        const dirs = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
        if (!dirs.some(move) || tiles.some((t) => t.v >= 512)) deal();
      }
    }

    const size = Math.min(W * 0.82, H * 0.88);
    const gap = size / 28, cell = (size - gap * (N + 1)) / N;
    const x0 = (W - size) / 2, y0 = (H - size) / 2;
    ctx.fillStyle = '#120e1c';
    ctx.beginPath();
    ctx.roundRect(x0, y0, size, size, size * 0.05);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,177,121,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      ctx.beginPath();
      ctx.roundRect(x0 + gap + c * (cell + gap), y0 + gap + r * (cell + gap), cell, cell, cell * 0.14);
      ctx.fill();
    }

    const p = Math.min(1, anim / SLIDE), e = 1 - (1 - p) * (1 - p);
    const tile = (v, fr, fc, r, c, s) => {
      const x = x0 + gap + (fc + (c - fc) * e) * (cell + gap);
      const y = y0 + gap + (fr + (r - fr) * e) * (cell + gap);
      const w = cell * s;
      const [bg, fg] = COLORS[v] || ['#b388ff', '#0b0810'];
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(x + (cell - w) / 2, y + (cell - w) / 2, w, w, w * 0.14);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = `600 ${Math.round(cell * (String(v).length > 2 ? 0.34 : 0.44) * s)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), x + cell / 2, y + cell / 2);
    };
    for (const g of ghosts) tile(g.v, g.fr, g.fc, g.r, g.c, 1);
    const pop = 1 + 0.16 * Math.sin(Math.PI * Math.min(1, Math.max(0, anim - SLIDE) / 0.18));
    for (const t of tiles) tile(t.v, t.fr, t.fc, t.r, t.c, t.born ? 0.35 + 0.65 * e : t.pop ? pop : 1);

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
