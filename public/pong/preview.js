/* Home-page preview: a neon rally bouncing between two paddles. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).pong = function (canvas) {
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  let raf = 0, last = performance.now();
  // everything is kept in 0..1 of the card so it reads at any size
  let ball = { x: 0.5, y: 0.5, vx: 0.62, vy: 0.34, hit: 0 };
  let left = 0.5, right = 0.5, trail = [];

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = 0.055, ph = 0.28, pw = Math.max(4, W * 0.018), r = Math.max(3, H * 0.035);
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (ball.y < 0.06) { ball.y = 0.06; ball.vy = Math.abs(ball.vy); }
    if (ball.y > 0.94) { ball.y = 0.94; ball.vy = -Math.abs(ball.vy); }
    if (ball.x < pad + 0.03 && ball.vx < 0) { ball.vx = Math.abs(ball.vx); ball.vy += (ball.y - left) * 1.6; ball.hit = 0.18; }
    if (ball.x > 1 - pad - 0.03 && ball.vx > 0) { ball.vx = -Math.abs(ball.vx); ball.vy += (ball.y - right) * 1.6; ball.hit = 0.18; }
    ball.vy = Math.max(-0.75, Math.min(0.75, ball.vy));
    if (ball.hit > 0) ball.hit -= dt;
    // the paddles chase the ball, each a little late
    const chase = (p, k) => p + Math.max(-dt * k, Math.min(dt * k, ball.y - p));
    left = chase(left, ball.vx < 0 ? 1.1 : 0.4);
    right = chase(right, ball.vx > 0 ? 1.0 : 0.4);
    trail.push(ball.x, ball.y);
    if (trail.length > 20) trail.splice(0, trail.length - 20);

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#080b1e'); bg.addColorStop(1, '#0a0718');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(190,210,255,0.35)';
    for (let y = H * 0.04; y < H * 0.96; y += H * 0.1) ctx.fillRect(W / 2 - pw / 4, y, pw / 2, H * 0.055);
    ctx.strokeStyle = 'rgba(120,150,220,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.24, 0, TAU); ctx.stroke();

    const n = trail.length / 2;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      ctx.globalAlpha = 0.5 * k * k;
      ctx.fillStyle = '#8fd8ff';
      ctx.beginPath(); ctx.arc(trail[i * 2] * W, trail[i * 2 + 1] * H, r * (0.3 + k * 0.7), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const paddle = (x, y, color) => {
      ctx.shadowColor = color; ctx.shadowBlur = 14 + (ball.hit > 0 ? 16 : 0);
      ctx.fillStyle = color;
      ctx.beginPath();
      const px = x * W - pw / 2, py = (y - ph / 2) * H;
      if (ctx.roundRect) ctx.roundRect(px, py, pw, ph * H, pw / 2); else ctx.rect(px, py, pw, ph * H);
      ctx.fill();
      ctx.shadowBlur = 0;
    };
    paddle(pad, left, '#e6eeff');
    paddle(1 - pad, right, '#ff7ac8');

    ctx.shadowColor = '#9fe8ff'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(ball.x * W, ball.y * H, r, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
