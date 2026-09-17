/* Home-page preview: a gem is swapped into a line, the match pops and the board cascades. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).match3 = function (canvas) {
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const COLORS = ['#ff4d6d', '#3fd8ff', '#ffd23f', '#7dff6a', '#c77dff', '#ff9f40'];
  const GLOW = ['#ffb3c1', '#b6f0ff', '#fff0b0', '#d5ffcc', '#ebd5ff', '#ffd9b0'];
  const DEEP = ['#5c0a1a', '#073d52', '#5c4300', '#134a0c', '#35135a', '#5c3009'];
  const SHAPES = ['round', 'diamond', 'hex', 'square', 'tri', 'oct'];
  let raf = 0, last = performance.now();
  let grid = null, cols = 0, rows = 0, cell = 0, x0 = 0, y0 = 0;
  let phase = 'wait', t = 0, pair = null, popping = null, parts = [], rings = [];

  const rnd = (n) => Math.floor(Math.random() * n);

  function build() {
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(rnd(6));
      grid.push(row);
    }
    // plant a swap that pays off: three of a colour in a row, one of them one step away
    const col = rnd(6);
    const r = 1 + rnd(Math.max(1, rows - 2));
    const c = rnd(Math.max(1, cols - 3));
    grid[r][c] = col;
    grid[r][c + 1] = col;
    if (c + 2 < cols) grid[r][c + 2] = (col + 1 + rnd(5)) % 6;
    const src = r + 1 < rows ? r + 1 : r - 1;
    if (c + 2 < cols) grid[src][c + 2] = col;
    pair = { r: src, c: c + 2, tr: r, tc: c + 2, line: [[r, c], [r, c + 1], [r, c + 2]] };
    phase = 'wait';
    t = 0;
  }

  function shapePath(shape, x, y, R) {
    ctx.beginPath();
    if (shape === 'round') { ctx.arc(x, y, R, 0, TAU); return; }
    if (shape === 'square') {
      const s = R * 0.86;
      if (ctx.roundRect) ctx.roundRect(x - s, y - s, s * 2, s * 2, R * 0.3); else ctx.rect(x - s, y - s, s * 2, s * 2);
      return;
    }
    const sides = shape === 'diamond' ? 4 : shape === 'hex' ? 6 : shape === 'tri' ? 3 : 8;
    const rot = shape === 'oct' ? Math.PI / 8 : -Math.PI / 2;
    const rr = shape === 'tri' ? R * 1.15 : R;
    for (let i = 0; i < sides; i++) {
      const a = rot + (i * TAU) / sides;
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function gem(ci, x, y, R, alpha) {
    ctx.globalAlpha = alpha;
    const shape = SHAPES[ci];
    const g = ctx.createRadialGradient(x - R * 0.32, y - R * 0.38, R * 0.08, x, y, R * 1.1);
    g.addColorStop(0, GLOW[ci]);
    g.addColorStop(0.42, COLORS[ci]);
    g.addColorStop(1, DEEP[ci]);
    shapePath(shape, x, y, R);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.ellipse(x - R * 0.3, y - R * 0.4, R * 0.25, R * 0.14, -0.6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); grid = null; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const want = Math.max(5, Math.min(8, Math.floor(W / 40)));
    if (!grid || want !== cols) {
      cols = want;
      cell = Math.floor(Math.min((W - 14) / cols, (H - 14) / 6));
      rows = Math.max(4, Math.min(8, Math.floor((H - 12) / cell)));
      x0 = (W - cols * cell) / 2;
      y0 = (H - rows * cell) / 2;
      build();
    }

    ctx.fillStyle = '#0a0718';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, H / 2, 6, W / 2, H / 2, W * 0.75);
    glow.addColorStop(0, 'rgba(255,209,102,0.18)');
    glow.addColorStop(1, 'rgba(255,209,102,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.015)';
      ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
    }

    t += dt;
    let slide = 0;
    if (phase === 'wait' && t > 0.7) { phase = 'swap'; t = 0; }
    else if (phase === 'swap') {
      slide = Math.min(1, t / 0.32);
      if (slide >= 1) {
        phase = 'pop';
        t = 0;
        popping = pair.line.slice();
        const moved = grid[pair.r][pair.c];
        grid[pair.r][pair.c] = grid[pair.tr][pair.tc];
        grid[pair.tr][pair.tc] = moved;
        const ci = moved;
        for (const [r, c] of popping) {
          const px = x0 + c * cell + cell / 2, py = y0 + r * cell + cell / 2;
          rings.push({ x: px, y: py, t: 0, c: GLOW[ci] });
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * TAU, s = 40 + Math.random() * 130;
            parts.push({ x: px, y: py, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30, t: 0, c: Math.random() < 0.3 ? '#fff' : COLORS[ci] });
          }
        }
      }
    } else if (phase === 'pop' && t > 0.3) { phase = 'done'; t = 0; }
    else if (phase === 'done' && t > 0.5) { build(); }

    const R = cell * 0.4;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const moving = phase === 'swap' && ((r === pair.r && c === pair.c) || (r === pair.tr && c === pair.tc));
      if (moving) continue;
      if (popping && phase !== 'swap' && popping.some((p) => p[0] === r && p[1] === c)) {
        if (phase === 'pop') gem(grid[r][c], x0 + c * cell + cell / 2, y0 + r * cell + cell / 2, R * (1 + t * 1.2), Math.max(0, 1 - t / 0.3));
        continue;
      }
      gem(grid[r][c], x0 + c * cell + cell / 2, y0 + r * cell + cell / 2, R, 1);
    }
    if (phase === 'swap') {
      const e = 1 - Math.pow(1 - slide, 3);
      const ax = x0 + pair.c * cell + cell / 2, ay = y0 + pair.r * cell + cell / 2;
      const bx = x0 + pair.tc * cell + cell / 2, by = y0 + pair.tr * cell + cell / 2;
      gem(grid[pair.r][pair.c], ax + (bx - ax) * e, ay + (by - ay) * e, R * (1 + 0.12 * Math.sin(slide * Math.PI)), 1);
      gem(grid[pair.tr][pair.tc], bx + (ax - bx) * e, by + (ay - by) * e, R, 1);
    }

    for (const g of rings) {
      g.t += dt;
      ctx.globalAlpha = Math.max(0, 1 - g.t / 0.4);
      ctx.strokeStyle = g.c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(g.x, g.y, R * (0.5 + (g.t / 0.4) * 1.6), 0, TAU);
      ctx.stroke();
    }
    if (rings.length) rings = rings.filter((g) => g.t < 0.4);
    for (const p of parts) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.55);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    if (parts.length) parts = parts.filter((p) => p.t < 0.55);
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
