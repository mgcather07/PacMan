/* Home-page preview: two tanks trading shots across a brick maze. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).tanks = function (canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0, last = performance.now(), t = 0;
  const cols = 11, rows = 7;
  let wall, tanks, shots, puffs;

  function reset() {
    wall = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(r > 0 && r < rows - 1 && (c + r) % 3 === 1 ? 1 : 0);
      wall.push(row);
    }
    tanks = [
      { c: 1.2, r: rows - 1.6, dir: 0, col: '#e8c060', trim: '#7a5410', fire: 0.7, turret: -Math.PI / 2 },
      { c: cols - 2.2, r: 0.6, dir: 2, col: '#98a2ad', trim: '#59626c', fire: 1.4, turret: Math.PI / 2 },
    ];
    shots = [];
    puffs = [];
  }
  reset();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#101019';
    ctx.fillRect(0, 0, W, H);

    const ts = Math.min(W / cols, H / rows);
    const ox = (W - ts * cols) / 2, oy = (H - ts * rows) / 2;
    const px = (c) => ox + c * ts;
    const py = (r) => oy + r * ts;

    // bricks
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!wall[r][c]) continue;
        const x = px(c), y = py(r), h = ts / 8;
        for (let i = 0; i < 8; i++) {
          const off = i % 2 ? 0 : ts / 8;
          for (let k = -1; k < 5; k++) {
            ctx.fillStyle = '#b5542a';
            ctx.fillRect(x + k * (ts / 4) + off, y + i * h, ts / 4 - 1.5, h - 1);
            ctx.fillStyle = '#e0834a';
            ctx.fillRect(x + k * (ts / 4) + off, y + i * h, ts / 4 - 1.5, 1);
          }
        }
      }
    }
    // the eagle's steel bunker at the bottom
    ctx.fillStyle = '#9aa6b4';
    ctx.fillRect(px(cols / 2 - 1), py(rows - 1), ts * 2, ts);
    ctx.fillStyle = '#e6eef7';
    ctx.fillRect(px(cols / 2 - 1) + 2, py(rows - 1) + 2, ts * 2 - 4, 3);
    ctx.fillStyle = '#e8d9a0';
    ctx.fillRect(px(cols / 2) - ts * 0.3, py(rows - 1) + ts * 0.25, ts * 0.6, ts * 0.5);

    // drive the tanks back and forth
    tanks.forEach((tk, i) => {
      const span = i ? [1, cols - 2] : [1, cols - 3];
      tk.c += (tk.dir === 1 ? 1 : -1) * dt * 1.1;
      if (tk.c < span[0]) { tk.c = span[0]; tk.dir = 1; }
      if (tk.c > span[1]) { tk.c = span[1]; tk.dir = 3; }
      const aim = i ? Math.PI / 2 : -Math.PI / 2;
      tk.turret += Math.max(-dt * 3, Math.min(dt * 3, aim - tk.turret));
      tk.fire -= dt;
      if (tk.fire <= 0) {
        tk.fire = 1.1 + Math.random() * 1.2;
        shots.push({ c: tk.c, r: tk.r, v: i ? 3.4 : -3.4, col: i ? '#ffd0d0' : '#fff6d8' });
      }
    });

    for (const s of shots) {
      s.r += s.v * dt;
      const c = Math.floor(s.c), r = Math.round(s.r);
      if (r >= 0 && r < rows && c >= 0 && c < cols && wall[r][c]) {
        wall[r][c] = 0;
        s.dead = true;
        for (let i = 0; i < 6; i++) puffs.push({ x: px(c) + ts / 2, y: py(r) + ts / 2, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90 - 40, t: 0 });
      }
      if (s.r < -0.5 || s.r > rows + 0.5) s.dead = true;
    }
    shots = shots.filter((s) => !s.dead);
    for (const p of puffs) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt; }
    puffs = puffs.filter((p) => p.t < 0.6);
    if (!wall.some((row) => row.some(Boolean))) reset();

    // tanks
    for (const tk of tanks) {
      const cx = px(tk.c) + ts / 2, cy = py(tk.r) + ts / 2, h = ts / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.fillStyle = '#232830';
      ctx.fillRect(-h + 1, -h + 2, ts * 0.22, ts - 4);
      ctx.fillRect(h - 1 - ts * 0.22, -h + 2, ts * 0.22, ts - 4);
      ctx.fillStyle = tk.trim;
      for (let y = -h + 3 + (Math.floor(t * 14) % 3) * 2; y < h - 4; y += ts * 0.16) {
        ctx.fillRect(-h + 2, y, ts * 0.18, 2);
        ctx.fillRect(h - 2 - ts * 0.18, y, ts * 0.18, 2);
      }
      ctx.fillStyle = tk.col;
      ctx.fillRect(-ts * 0.26, -ts * 0.36, ts * 0.52, ts * 0.72);
      ctx.rotate(tk.turret + Math.PI / 2);
      ctx.fillStyle = tk.col;
      ctx.fillRect(-ts * 0.17, -ts * 0.17, ts * 0.34, ts * 0.34);
      ctx.fillStyle = '#2b3038';
      ctx.fillRect(-ts * 0.06, -h - 1, ts * 0.12, h);
      ctx.restore();
    }

    for (const s of shots) {
      ctx.fillStyle = s.col;
      ctx.fillRect(px(s.c) + ts / 2 - 3, py(s.r) + ts / 2 - 3, 6, 6);
    }
    for (const p of puffs) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.6);
      ctx.fillStyle = '#e0834a';
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
