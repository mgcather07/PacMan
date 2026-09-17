/* Home-page preview: an endless minefield uncovering itself, numbers first, flags on the mines. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).minesweeper = function (canvas) {
  const ctx = canvas.getContext('2d');
  const NUM = ['', '#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#ff8f00', '#0097a7', '#424242', '#757575'];
  const REVEAL = 5.5, HOLD = 1.6;                           // seconds to uncover the field, then to admire it
  let raf = 0, cols = 0, rows = 0, cell = 0, ox = 0, oy = 0, start = 0;
  let mine = [], count = [], order = [], span = 1;

  // a fresh field: mines, neighbour counts, and the order tiles get uncovered in (outwards from a corner)
  function build() {
    mine = new Array(cols * rows); count = new Array(cols * rows); order = new Array(cols * rows);
    for (let i = 0; i < mine.length; i++) mine[i] = Math.random() < 0.13;
    const sx = Math.random() * cols, sy = Math.random() * rows;
    span = 1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows && mine[ny * cols + nx]) n++;
      }
      count[i] = n;
      order[i] = Math.hypot(x - sx, y - sy) + Math.random() * 2.5;
      if (order[i] > span) span = order[i];
    }
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    const c = Math.max(18, Math.round(H / 7));
    if (c !== cell || Math.ceil(W / c) + 1 !== cols) {
      cell = c; cols = Math.ceil(W / c) + 1; rows = Math.ceil(H / c) + 1;
      ox = (W - cols * cell) / 2; oy = (H - rows * cell) / 2;
      start = t; build();
    }
    if (t - start > REVEAL + HOLD) { start = t; build(); }
    const edge = ((t - start) / REVEAL) * span;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1c2b12';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(cell * 0.55)}px Inter, system-ui, sans-serif`;

    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x, px = ox + x * cell, py = oy + y * cell, dark = (x + y) % 2 === 1;
      const dug = order[i] <= edge && !mine[i];
      if (!dug) {
        ctx.fillStyle = dark ? '#a2d149' : '#aad751';
        ctx.fillRect(px, py, cell, cell);
        if (mine[i] && order[i] <= edge) {                  // a mine the sweeper walked around: flag it
          ctx.fillStyle = '#6d4c1b';
          ctx.fillRect(px + cell * 0.46, py + cell * 0.22, cell * 0.07, cell * 0.56);
          ctx.fillStyle = '#e53935';
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.46, py + cell * 0.22);
          ctx.lineTo(px + cell * 0.2, py + cell * 0.36);
          ctx.lineTo(px + cell * 0.46, py + cell * 0.5);
          ctx.closePath(); ctx.fill();
        }
        continue;
      }
      const k = Math.min(1, Math.max(0, (edge - order[i]) / 1.5));   // a little pop as each tile opens
      const g = cell * (1 - k) * 0.2;
      ctx.fillStyle = dark ? '#d7b899' : '#e5c29f';
      ctx.fillRect(px + g, py + g, cell - g * 2, cell - g * 2);
      if (count[i]) {
        ctx.fillStyle = NUM[count[i]];
        ctx.globalAlpha = k;
        ctx.fillText(String(count[i]), px + cell / 2, py + cell / 2 + 1);
        ctx.globalAlpha = 1;
      }
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
