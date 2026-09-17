/* Home-page preview: Pac-Man eating a corridor of dots with the ghost train behind. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).pacman = function (canvas) {
  const ctx = canvas.getContext('2d');
  const colors = ['#ff2a2a', '#ffb8ff', '#00e5ff', '#ffb852'];
  let raf = 0;

  function ghost(x, y, r, col, t) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.1, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r * 0.95);
    const ph = Math.floor(t * 8) % 2;                       // the skirt wobbles between two shapes
    for (let k = 1; k <= 6; k++) ctx.lineTo(x + r - (2 * r * k) / 6, y + r * 0.95 - ((k + ph) % 2 ? r * 0.28 : 0));
    ctx.closePath(); ctx.fill();
    for (const s of [-1, 1]) {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(x + s * r * 0.36 - r * 0.08, y - r * 0.2, r * 0.26, r * 0.32, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#1b2bff'; ctx.beginPath(); ctx.arc(x + s * r * 0.36 - r * 0.2, y - r * 0.2, r * 0.13, 0, 7); ctx.fill();
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const cy = H / 2, r = Math.max(11, H * 0.1), spacing = r * 1.64;
    ctx.strokeStyle = '#3b4bff'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, cy - r * 1.9); ctx.lineTo(W, cy - r * 1.9);
    ctx.moveTo(0, cy + r * 1.9); ctx.lineTo(W, cy + r * 1.9);
    ctx.stroke();

    const cycle = W + r * 15;
    const px = ((t * 110) % cycle) - r * 2.7;
    ctx.fillStyle = '#ffb8ae';
    for (let x = spacing / 2; x < W; x += spacing) if (x > px) { ctx.beginPath(); ctx.arc(x, cy, 3.5, 0, 7); ctx.fill(); }
    const m = Math.abs(Math.sin(t * 12)) * 1.1 + 0.05;      // mouth angle
    ctx.fillStyle = '#ffe600';
    ctx.beginPath(); ctx.moveTo(px, cy); ctx.arc(px, cy, r, m / 2, Math.PI * 2 - m / 2); ctx.closePath(); ctx.fill();
    colors.forEach((col, i) => ghost(px - r * 3.2 - i * r * 2.36, cy, r, col, t));
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
