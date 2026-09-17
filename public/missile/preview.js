/* Home-page preview: missiles streaking down on a skyline while counter-blasts bloom. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).missile = function (canvas) {
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  let raf = 0, last = performance.now(), spawnT = 0;
  let missiles = [], blasts = [], skyline = null, W = 0, H = 0;

  function buildSkyline(w, h) {
    const towns = [];
    for (let i = 0; i < 4; i++) {
      const cx = w * (0.16 + i * 0.23);
      const blocks = [];
      for (let dx = -w * 0.055; dx < w * 0.05; dx += w * 0.022) {
        blocks.push({ dx, w: w * 0.018, h: h * (0.05 + Math.random() * 0.1) });
      }
      towns.push({ cx, blocks });
    }
    return towns;
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); skyline = null; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cw; H = ch;
    if (!skyline) skyline = buildSkyline(W, H);
    const groundY = H - Math.max(10, H * 0.07);

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05030f');
    bg.addColorStop(0.7, '#150726');
    bg.addColorStop(1, '#2a0a24');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // incoming missiles
    spawnT -= dt;
    if (spawnT <= 0 && missiles.length < 4) {
      spawnT = 0.5 + Math.random() * 0.9;
      const sx = W * (0.1 + Math.random() * 0.8);
      const tx = skyline[Math.floor(Math.random() * skyline.length)].cx;
      const sp = H * (0.28 + Math.random() * 0.2);
      const d = Math.hypot(tx - sx, groundY);
      missiles.push({ sx, sy: -4, x: sx, y: -4, vx: ((tx - sx) / d) * sp, vy: (groundY / d) * sp, burst: groundY * (0.4 + Math.random() * 0.35) });
    }
    for (const m of missiles) {
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.y > m.burst) { m.dead = true; blasts.push({ x: m.x, y: m.y, t: 0, max: Math.max(12, W * 0.075) }); }
    }
    missiles = missiles.filter((m) => !m.dead);

    ctx.lineWidth = 2;
    for (const m of missiles) {
      ctx.strokeStyle = 'rgba(255,92,122,0.6)';
      ctx.beginPath(); ctx.moveTo(m.sx, m.sy); ctx.lineTo(m.x, m.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(m.x, m.y, 2.2, 0, TAU); ctx.fill();
    }

    // ground, cities and batteries
    ctx.fillStyle = '#170a1c';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = '#ff5c7a';
    ctx.fillRect(0, groundY, W, 2);
    ctx.fillStyle = '#b98cff';
    for (const t of skyline) for (const b of t.blocks) ctx.fillRect(t.cx + b.dx, groundY - b.h, b.w, b.h);
    ctx.fillStyle = '#ffd23f';
    for (const bx of [W * 0.04, W * 0.5, W * 0.96]) {
      ctx.beginPath();
      ctx.moveTo(bx - W * 0.035, groundY);
      ctx.lineTo(bx - W * 0.016, groundY - H * 0.045);
      ctx.lineTo(bx + W * 0.016, groundY - H * 0.045);
      ctx.lineTo(bx + W * 0.035, groundY);
      ctx.closePath();
      ctx.fill();
    }

    // blasts
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blasts) {
      b.t += dt;
      const k = b.t / 1.1;
      const r = b.max * (k < 0.4 ? k / 0.4 : Math.max(0, 1 - (k - 0.4) / 0.6));
      if (r < 0.5) continue;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.35, 'rgba(255,214,63,0.8)');
      g.addColorStop(1, 'rgba(255,92,122,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    blasts = blasts.filter((b) => b.t < 1.1);

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
