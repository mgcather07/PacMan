/* Home-page preview: a bird flapping through scrolling gates over rolling hills. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).flyer = function (canvas) {
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  let raf = 0, last = performance.now(), t = 0, dist = 0;
  let y = 0.5, vy = 0, flapT = 0, seeded = false;
  const gates = [];

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ground = H - Math.max(14, H * 0.11);
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, '#27407e');
    sky.addColorStop(1, '#ffc38b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun
    ctx.fillStyle = 'rgba(255,243,196,0.3)';
    ctx.beginPath(); ctx.arc(W * 0.78, H * 0.26, H * 0.16, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(W * 0.78, H * 0.26, H * 0.075, 0, TAU); ctx.fill();

    const speed = W * 0.42;
    dist += speed * dt;

    // parallax hills
    [['#33538f', 0.1, 0.42, 0.06], ['#243b68', 0.22, 0.28, 0.05]].forEach(([c, par, top, amp]) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 10; x += 10) {
        const w = (x + dist * par) * 0.012;
        ctx.lineTo(x, ground - H * top + Math.sin(w) * H * amp);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    });

    // gates
    const gw = Math.max(12, W * 0.085), spacing = W * 0.52, gap = ground * 0.46;
    if (!seeded) { seeded = true; for (let i = 0; i < 4; i++) gates.push({ x: W + i * spacing, y: 0.3 + Math.random() * 0.4 }); }
    for (const g of gates) g.x -= speed * dt;
    while (gates.length && gates[0].x < -gw - 4) gates.shift();
    while (gates.length < 4) gates.push({ x: (gates.length ? gates[gates.length - 1].x : W) + spacing, y: 0.3 + Math.random() * 0.4 });
    for (const g of gates) {
      const cy = g.y * ground;
      const top = cy - gap / 2, bot = cy + gap / 2;
      const grad = ctx.createLinearGradient(g.x, 0, g.x + gw, 0);
      grad.addColorStop(0, '#2f7a3d'); grad.addColorStop(0.35, '#7ad37f'); grad.addColorStop(0.6, '#bdf3b6'); grad.addColorStop(1, '#2f7a3d');
      ctx.fillStyle = grad;
      ctx.fillRect(g.x + 2, -4, gw - 4, top + 4);
      ctx.fillRect(g.x - 2, top - 8, gw + 4, 8);
      ctx.fillRect(g.x + 2, bot, gw - 4, ground - bot);
      ctx.fillRect(g.x - 2, bot, gw + 4, 8);
    }

    // the bird aims for the gap in front of it
    const bx = W * 0.26;
    const ahead = gates.find((g) => g.x + gw > bx - gw) || { y: 0.5 };
    if (y * ground > ahead.y * ground + 6 && vy > -0.35) { vy = -0.62; flapT = 0.26; }
    vy += 2.0 * dt;
    y = Math.max(0.06, Math.min(0.92, y + vy * dt));
    if (flapT > 0) flapT -= dt;

    // ground
    ctx.fillStyle = '#6ab04c';
    ctx.fillRect(0, ground, W, H - ground);
    ctx.fillStyle = '#3a6829';
    ctx.fillRect(0, ground + Math.max(4, H * 0.03), W, H);
    for (let x = -(dist % 26); x < W + 26; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, ground + 8); ctx.lineTo(x + 6, ground + 1); ctx.lineTo(x + 12, ground + 8);
      ctx.closePath(); ctx.fill();
    }

    // coins
    for (let i = 0; i < 3; i++) {
      const cx = (W * 1.2 - ((dist * 1 + i * 30) % (W * 1.5)));
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.ellipse(cx, ground * 0.32, Math.max(2.5, W * 0.016) * Math.abs(Math.cos(t * 3 + i)), Math.max(2.5, W * 0.016), 0, 0, TAU); ctx.fill();
    }

    // bird
    const s = Math.max(0.5, H / 150);
    const wing = flapT > 0 ? -1.05 + (1 - flapT / 0.26) * 2.2 : Math.sin(t * 6) * 0.3;
    ctx.save();
    ctx.translate(bx, y * ground);
    ctx.rotate(Math.max(-0.5, Math.min(1.0, vy * 1.1)));
    ctx.scale(s, s);
    ctx.fillStyle = '#e88f27';
    ctx.beginPath(); ctx.moveTo(-8, -1); ctx.lineTo(-17, -7); ctx.lineTo(-16, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.ellipse(0, 0, 11, 9, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.rotate(wing);
    ctx.fillStyle = '#ff9e3d';
    ctx.beginPath(); ctx.ellipse(-3, 2, 8, 4.5, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ff7a3d';
    ctx.beginPath(); ctx.moveTo(9, -1); ctx.lineTo(17, 1); ctx.lineTo(9, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(4.5, -3, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#20182a';
    ctx.beginPath(); ctx.arc(5.6, -3, 1.6, 0, TAU); ctx.fill();
    ctx.restore();

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
