/* Home-page preview: a bubble is fired into the wall and pops the cluster it matches. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).bubble = function (canvas) {
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const PALETTE = ['#ff4d6d', '#3fd8ff', '#ffd23f', '#7dff6a', '#c77dff'];
  let raf = 0, last = performance.now(), grid = null, shot = null, wait = 0, parts = [], rings = [], cols = 0, rows = 4, R = 10;

  function build() {
    grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(Math.floor(Math.random() * PALETTE.length));
      grid.push(row);
    }
    // plant a cluster of one colour so the shot always pays off
    const col = Math.floor(Math.random() * PALETTE.length);
    const tc = 1 + Math.floor(Math.random() * Math.max(1, cols - 3));
    [[1, tc], [1, tc + 1], [2, tc], [2, tc + 1]].forEach(([r, c]) => { if (grid[r] && grid[r][c] !== undefined) grid[r][c] = col; });
    shot = null; wait = 0.5;
  }

  function bubble(x, y, color, a = 1) {
    ctx.globalAlpha = a;
    const g = ctx.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.1, x, y, R);
    g.addColorStop(0, '#ffffffcc');
    g.addColorStop(0.45, color);
    g.addColorStop(1, '#00000066');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R - 0.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffffb0';
    ctx.beginPath(); ctx.ellipse(x - R * 0.3, y - R * 0.38, R * 0.28, R * 0.17, -0.6, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); grid = null; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    R = Math.max(7, Math.min(13, Math.floor(W / 20)));
    const want = Math.max(5, Math.floor((W - 12) / (R * 2)));
    if (!grid || want !== cols) { cols = want; build(); }

    const D = R * 2, rowH = D * 0.866;
    const x0 = (W - cols * D) / 2 + R;
    const top = R + 6;
    const cellX = (r, c) => x0 + c * D + (r % 2 ? R : 0);
    const cellY = (r) => top + r * rowH;
    const launchY = H - R - 6;

    ctx.fillStyle = '#0a0416';
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W / 2, top + rowH, 4, W / 2, top + rowH, W * 0.7);
    glow.addColorStop(0, 'rgba(255,107,214,0.2)');
    glow.addColorStop(1, 'rgba(255,107,214,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c] >= 0) bubble(cellX(r, c), cellY(r), PALETTE[grid[r][c]]);

    if (!shot) {
      wait -= dt;
      if (wait <= 0) {
        // aim at a bubble whose colour has neighbours to pop
        let target = null;
        for (let r = rows - 1; r >= 0 && !target; r--) for (let c = 0; c < cols; c++) {
          if (grid[r][c] < 0) continue;
          const same = [[r, c - 1], [r, c + 1], [r - 1, c], [r + 1, c]].filter(([rr, cc]) => grid[rr] && grid[rr][cc] === grid[r][c]).length;
          if (same >= 2) { target = [r, c]; break; }
        }
        if (!target) { build(); }
        else {
          const [tr, tc] = target;
          const tx = cellX(tr, tc), ty = cellY(tr) + rowH;
          const a = Math.atan2(ty - launchY, tx - W / 2);
          shot = { x: W / 2, y: launchY, vx: Math.cos(a), vy: Math.sin(a), color: grid[tr][tc], target };
        }
      }
    } else {
      const sp = H * 1.5 * dt;
      shot.x += shot.vx * sp; shot.y += shot.vy * sp;
      if (shot.x < R || shot.x > W - R) shot.vx *= -1;
      const [tr, tc] = shot.target;
      if (shot.y <= cellY(tr) + rowH * 0.9) {
        // pop everything of that colour touching the target
        const col = grid[tr][tc];
        const seen = new Set(), stack = [[tr, tc]];
        while (stack.length) {
          const [r, c] = stack.pop();
          const k = r * 99 + c;
          if (seen.has(k) || !grid[r] || grid[r][c] !== col) continue;
          seen.add(k);
          [[r, c - 1], [r, c + 1], [r - 1, c], [r + 1, c]].forEach((n) => stack.push(n));
        }
        seen.forEach((k) => {
          const r = Math.floor(k / 99), c = k % 99;
          grid[r][c] = -1;
          rings.push({ x: cellX(r, c), y: cellY(r), t: 0, c: PALETTE[col] });
          for (let i = 0; i < 4; i++) {
            const a = Math.random() * TAU, s = 30 + Math.random() * 90;
            parts.push({ x: cellX(r, c), y: cellY(r), vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, c: PALETTE[col] });
          }
        });
        shot = null;
        wait = 0.9;
        if (grid.every((row) => row.every((v) => v < 0))) wait = 0.4;
      } else bubble(shot.x, shot.y, PALETTE[shot.color]);
    }

    for (const g of rings) {
      g.t += dt;
      ctx.globalAlpha = Math.max(0, 1 - g.t / 0.4);
      ctx.strokeStyle = g.c; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(g.x, g.y, R * (0.5 + (g.t / 0.4) * 1.4), 0, TAU); ctx.stroke();
    }
    rings = rings.filter((g) => g.t < 0.4);
    for (const p of parts) {
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt;
      ctx.globalAlpha = Math.max(0, 1 - p.t / 0.5);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill();
    }
    parts = parts.filter((p) => p.t < 0.5);
    ctx.globalAlpha = 1;

    // launcher
    ctx.fillStyle = '#1b0f22';
    ctx.strokeStyle = '#ff6bd6'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, launchY, R * 1.2, 0, TAU); ctx.fill(); ctx.stroke();
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
