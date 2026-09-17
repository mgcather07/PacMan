/* Home-page preview: the fighter weaving under a wave of enemies, guns wide open. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).shooter = function (canvas) {
  const ctx = canvas.getContext('2d');
  const stars = Array.from({ length: 60 }, () => [Math.random(), Math.random(), Math.random()]);
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
    const g = ctx.createRadialGradient(W * 0.6, H * 0.3, 10, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#1a0b3a'); g.addColorStop(1, '#050314');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const [x, y, z] of stars) {
      ctx.fillStyle = `rgba(220,230,255,${0.3 + z * 0.6})`;
      ctx.fillRect(x * W, (y * H + t * 90 * z) % H, 1.5 * z + 0.5, 3 * z + 1);
    }

    const px = W / 2 + Math.sin(t * 1.3) * W * 0.25, py = H - 30;
    ctx.fillStyle = '#9ffcff';
    for (let k = 0; k < 6; k++) {
      const yy = py - 20 - ((t * 400 + k * 40) % 240);
      for (const a of [-0.15, 0, 0.15]) ctx.fillRect(px + a * (py - yy) - 1.5, yy, 3, 10);
    }

    for (let i = 0; i < 5; i++) {
      const ex = W * (0.2 + i * 0.15) + Math.sin(t * 2 + i) * 20;
      const ey = H * 0.2 + Math.sin(t * 1.5 + i * 0.7) * 16;
      ctx.fillStyle = i % 2 ? '#ffd23f' : '#ff4d6d'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(ex, ey + 12); ctx.lineTo(ex + 12, ey - 5); ctx.lineTo(ex + 6, ey - 10);
      ctx.lineTo(ex, ey - 4); ctx.lineTo(ex - 6, ey - 10); ctx.lineTo(ex - 12, ey - 5);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff5ea8';
      ctx.beginPath(); ctx.arc(ex, ey + 20 + ((t * 120 + i * 30) % 160), 4, 0, 7); ctx.fill();
    }

    ctx.shadowColor = '#3fd8ff'; ctx.shadowBlur = 16; ctx.fillStyle = '#dff7ff';
    ctx.beginPath();
    ctx.moveTo(px, py - 20); ctx.lineTo(px + 7, py - 4); ctx.lineTo(px + 18, py + 8); ctx.lineTo(px + 6, py + 10);
    ctx.lineTo(px, py + 14); ctx.lineTo(px - 6, py + 10); ctx.lineTo(px - 18, py + 8); ctx.lineTo(px - 7, py - 4);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
