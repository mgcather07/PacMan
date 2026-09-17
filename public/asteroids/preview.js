/* Home-page preview: the ship drifting through a field of tumbling rocks. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).asteroids = function (canvas) {
  const ctx = canvas.getContext('2d');
  const rocks = Array.from({ length: 9 }, () => ({
    x: Math.random(), y: Math.random(), r: 0.05 + Math.random() * 0.12, a: Math.random() * 6,
    s: Math.random() - 0.5, v: Array.from({ length: 10 }, () => 0.75 + Math.random() * 0.3),
  }));
  const stars = Array.from({ length: 70 }, () => [Math.random(), Math.random(), Math.random()]);
  let raf = 0;

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#02020a';
    ctx.fillRect(0, 0, W, H);

    for (const [x, y, z] of stars) {
      ctx.fillStyle = `rgba(210,220,255,${0.3 + z * 0.6})`;
      ctx.fillRect(((x * W - t * 20 * z) % W + W) % W, y * H, 1 + z, 1 + z);
    }

    ctx.strokeStyle = '#c9d3ff'; ctx.lineWidth = 1.6;
    for (const rk of rocks) {
      const r = rk.r * H;
      const x = ((rk.x * W - t * 30) % (W + 80) + W + 80) % (W + 80) - 40;
      const y = rk.y * H + Math.sin(t * 0.5 + rk.a) * 10;
      ctx.beginPath();
      rk.v.forEach((k, i) => {
        const a = rk.a + t * rk.s + (i / 10) * 6.283;
        const px = x + Math.cos(a) * r * k, py = y + Math.sin(a) * r * k;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      });
      ctx.closePath(); ctx.stroke();
    }

    const sx = W * 0.45, sy = H * 0.55, a = -0.3 + Math.sin(t) * 0.6;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
    ctx.strokeStyle = '#ffe600'; ctx.shadowColor = '#ffe600'; ctx.shadowBlur = 12; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9); ctx.closePath(); ctx.stroke();
    ctx.restore(); ctx.shadowBlur = 0;
    ctx.fillStyle = '#fffbe0';
    for (let k = 0; k < 4; k++) {
      const d = ((t * 260 + k * 60) % 240) + 20;
      ctx.fillRect(sx + Math.cos(a) * d - 1.5, sy + Math.sin(a) * d - 1.5, 3, 3);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
