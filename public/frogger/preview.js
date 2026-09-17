/* Home-page preview: the frog hopping up through traffic and river lanes. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).frogger = function (canvas) {
  const ctx = canvas.getContext('2d');
  const lanes = ['grass', 'road', 'road', 'grass', 'river', 'river', 'grass'];
  const speeds = [0, 70, -110, 0, 45, -60, 0];
  const cars = ['#ff4d6d', '#ffd23f', '#3fa7ff', '#b37bff'];
  let raf = 0;

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000, lh = H / lanes.length;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    lanes.forEach((type, i) => {
      const y = H - (i + 1) * lh;
      ctx.fillStyle = type === 'grass' ? (i % 2 ? '#5fbf3f' : '#56b33a') : type === 'road' ? '#3b3b4a' : '#2f7fd8';
      ctx.fillRect(0, y, W, lh);
      if (type === 'grass') return;
      const gap = type === 'road' ? Math.max(110, lh * 5) : Math.max(140, lh * 6);
      for (let k = -1; k < W / gap + 1; k++) {
        const x = (((k * gap + t * speeds[i]) % (W + gap)) + W + gap) % (W + gap) - gap;
        if (type === 'road') {
          ctx.fillStyle = cars[(i + k + 8) % 4];
          ctx.beginPath(); ctx.roundRect(x, y + lh * 0.18, lh * 1.3, lh * 0.64, 7); ctx.fill();
          ctx.fillStyle = '#bfe6ff'; ctx.fillRect(x + lh * (speeds[i] > 0 ? 0.8 : 0.2), y + lh * 0.28, lh * 0.3, lh * 0.44);
        } else {
          ctx.fillStyle = '#8b5a2b';
          ctx.beginPath(); ctx.roundRect(x, y + lh * 0.18, lh * 3, lh * 0.64, lh * 0.3); ctx.fill();
        }
      }
    });

    // the frog hops up one lane per beat, drawn exactly like the in-game frog
    const cycle = 3.2, p = (t % cycle) / cycle, n = Math.floor(p * 8), k = Math.min(1, ((p * 8) % 1) * 4);
    const row = n >= 6 ? 6 : n + k, lift = n >= 6 ? 0 : Math.sin(k * Math.PI);
    const T = lh, cx = W / 2, cy = H - (row + 0.5) * lh, s = 1 + lift * 0.25;
    ctx.fillStyle = '#0004';
    ctx.beginPath(); ctx.ellipse(cx, cy + T * 0.18, T * 0.28, T * 0.12, 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(cx, cy - lift * T * 0.18);
    ctx.scale(s, s);
    ctx.fillStyle = '#2e7d32';
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(sx * T * 0.26, T * 0.2, T * 0.1, T * 0.18, sx * 0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(sx * T * 0.24, -T * 0.12, T * 0.07, T * 0.12, -sx * 0.4, 0, 7); ctx.fill();
    }
    ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.ellipse(0, 0, T * 0.24, T * 0.3, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#81c784'; ctx.beginPath(); ctx.ellipse(0, T * 0.05, T * 0.12, T * 0.16, 0, 0, 7); ctx.fill();
    for (const sx of [-1, 1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx * T * 0.12, -T * 0.22, T * 0.08, 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(sx * T * 0.12, -T * 0.25, T * 0.04, 0, 7); ctx.fill();
    }
    ctx.restore();
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
