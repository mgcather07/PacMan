/* Home-page preview: the wall sliding down while the ball and paddle chip away at it. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).breakout = function (canvas) {
  const ctx = canvas.getContext('2d');
  const cols = ['#ff4d6d', '#ff8a3d', '#ffd23f', '#7dff6a', '#3fd8ff', '#6a8bff'];
  const gone = new Set();
  let raf = 0, last = 0, bx = 0, by = 0, vx = 170, vy = -190;

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 0;          // also covers a preview that was paused off-screen
    last = t;
    if (!bx) { bx = W * 0.4; by = H * 0.7; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0b2a';
    ctx.fillRect(0, 0, W, H);

    const n = Math.max(8, Math.round(W / 28)), bw = W / n, bh = Math.max(11, H * 0.075), off = (t * 6) % bh;
    for (let r = -1; r < 6; r++) for (let k = 0; k < n; k++) {
      if (gone.has(r + ',' + k)) continue;
      ctx.fillStyle = cols[(r + 6) % 6];
      ctx.fillRect(k * bw + 1.5, 10 + r * bh + off + 1.5, bw - 3, bh - 3);
    }

    bx += vx * dt; by += vy * dt;
    if (bx < 6 || bx > W - 6) vx = -vx;
    if (by < H * 0.45) vy = Math.abs(vy);
    if (by > H - 26 && vy > 0) vy = -Math.abs(vy);
    bx = Math.max(6, Math.min(W - 6, bx)); by = Math.max(8, Math.min(H - 8, by));
    if (Math.random() < 0.02) gone.add(Math.floor(Math.random() * 6) + ',' + Math.floor(Math.random() * n));
    if (gone.size > 30) gone.clear();

    const px = Math.max(40, Math.min(W - 40, bx));
    ctx.fillStyle = '#3fd8ff'; ctx.shadowColor = '#3fd8ff'; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.roundRect(px - 36, H - 20, 72, 9, 5); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 6, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
