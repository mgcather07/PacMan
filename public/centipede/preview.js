/* Home-page preview: a centipede winding down through the mushrooms while the gun fires. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).centipede = function (canvas) {
  const ctx = canvas.getContext('2d');
  const parse = (rows) => ({ w: rows[0].length, h: rows.length, rows });
  const SPR = {
    head: parse(['#......#', '.#....#.', '..####..', '.##..##.', '########', '##.##.##', '.######.', '..#..#..']),
    body: parse(['..####..', '.######.', '########', '##.##.##', '########', '.######.', '#.#..#.#', '..#..#..']),
    mush: parse(['..####..', '.######.', '##.##.##', '########', '.######.', '...##...', '...##...', '..####..']),
    gun: parse(['....#....', '...###...', '...###...', '.#######.', '#########', '##.###.##', '#########', '#.#...#.#']),
  };
  function sprite(s, x, y, px, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < s.h; r++) {
      const row = s.rows[r];
      let start = -1;
      for (let i = 0; i <= row.length; i++) {
        if (row[i] === '#') { if (start < 0) start = i; } else if (start >= 0) { ctx.fillRect(x + start * px, y + r * px, (i - start) * px, px); start = -1; }
      }
    }
  }
  const at = (s, x, y, px, color) => sprite(s, Math.round(x - (s.w * px) / 2), Math.round(y - (s.h * px) / 2), px, color);

  let raf = 0, last = performance.now(), W = 0, H = 0;
  let cell = 0, px = 2, cols = 0, rows = 0, grid = null, path = [], d = 0, segs = 8, dir = 1, vdir = 1;
  let gunX = 0.5, shot = null, fireT = 0.6;

  function reset() {
    cell = Math.max(9, Math.floor(H / 9));
    px = Math.max(1, Math.floor(cell / 9));
    cols = Math.max(6, Math.floor(W / cell));
    rows = Math.max(5, Math.floor(H / cell));
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(r > 0 && r < rows - 1 && Math.random() < 0.11 ? 4 : 0);
      grid.push(row);
    }
    segs = Math.min(8, cols - 2);
    dir = 1; vdir = 1; d = segs * cell;
    path = [];
    for (let i = 0; i <= segs; i++) path.push({ x: cx(-segs + i), y: cy(0) });
    shot = null; fireT = 0.5;
  }
  const cx = (c) => c * cell + cell / 2;
  const cy = (r) => r * cell + cell / 2;

  function extend() {
    const p = path[path.length - 1];
    const col = Math.round((p.x - cell / 2) / cell);
    const row = Math.round((p.y - cell / 2) / cell);
    if (col < 0 || col >= cols) { path.push({ x: cx(col + dir), y: p.y }); return; }
    let ncol = col, nrow = row;
    const ahead = col + dir;
    if (ahead < 0 || ahead >= cols || grid[row][ahead]) {
      dir = -dir;
      nrow = row + vdir;
      if (nrow < 0) { vdir = 1; nrow = 1; }
      if (nrow > rows - 1) { vdir = -1; nrow = rows - 2; }
    } else ncol = ahead;
    path.push({ x: cx(ncol), y: cy(nrow) });
  }

  function pointAt(dist) {
    const k = Math.floor(dist / cell);
    if (k < 0) return path[0];
    if (k >= path.length - 1) return path[path.length - 1];
    const f = dist / cell - k, a = path[k], b = path[k + 1];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || W !== cw || H !== ch) {
      canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      W = cw; H = ch;
      reset();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#04070f');
    bg.addColorStop(1, '#0c1405');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // the swarm walks its path, laying more of it as it goes
    d += cell * 3.4 * dt;
    let guard = 0;
    while ((path.length - 1) * cell <= d + cell && guard++ < 8) extend();
    while (d - (segs - 1) * cell >= cell && path.length > 2) { path.shift(); d -= cell; }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!grid[r][c]) continue;
        const col = ['#ff4d6d', '#ff9f45', '#ffd23f', '#b4f000'][grid[r][c] - 1];
        at(SPR.mush, cx(c), cy(r), px, col);
      }
    }

    const pts = [];
    for (let i = 0; i < segs; i++) pts.push(pointAt(d - i * cell));
    for (let i = pts.length - 1; i >= 0; i--) at(i ? SPR.body : SPR.head, pts[i].x, pts[i].y, px, i ? '#b4f000' : '#ff4d6d');

    // the gun slides under the head and fires
    const gy = H - cell * 0.7;
    const target = Math.max(0.05, Math.min(0.95, pts[0].x / W));
    gunX += Math.max(-dt * 0.9, Math.min(dt * 0.9, target - gunX));
    fireT -= dt;
    if (!shot && fireT <= 0) { shot = { x: gunX * W, y: gy - cell * 0.6 }; fireT = 0.7; }
    if (shot) {
      shot.y -= dt * H * 1.5;
      ctx.fillStyle = '#fff';
      ctx.fillRect(shot.x - px / 2, shot.y - px * 4, Math.max(1, px), px * 5);
      let hit = false;
      for (let i = 0; i < pts.length; i++) {
        if (Math.abs(pts[i].x - shot.x) < cell * 0.5 && Math.abs(pts[i].y - shot.y) < cell * 0.5) {
          const c = Math.max(0, Math.min(cols - 1, Math.round((pts[i].x - cell / 2) / cell)));
          const r = Math.max(0, Math.min(rows - 1, Math.round((pts[i].y - cell / 2) / cell)));
          grid[r][c] = 4;
          segs = Math.max(0, segs - 1);
          hit = true;
          break;
        }
      }
      const r = Math.max(0, Math.min(rows - 1, Math.round((shot.y - cell / 2) / cell)));
      const c = Math.max(0, Math.min(cols - 1, Math.round((shot.x - cell / 2) / cell)));
      if (!hit && grid[r][c]) { grid[r][c]--; hit = true; }
      if (hit || shot.y < 0) shot = null;
    }
    at(SPR.gun, gunX * W, gy, px, '#b4f000');

    if (segs < 3 || pts[0].y > H - cell) reset();
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
