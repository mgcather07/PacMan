/* Home-page preview: a warehouse hand pushing a crate onto its pad, over and over. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).sokoban = function (canvas) {
  const ctx = canvas.getContext('2d');
  const COLS = 7, ROWS = 5;
  const wall = (x, y) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
  const GOALS = [[5, 1], [5, 2]];
  const DONE = [5, 1];                 // one crate is already delivered
  const START = { crate: [3, 2], you: [2, 2] };
  const STEP = 0.24, PAUSE = 0.9;      // seconds per push, and the rest between loops

  let raf = 0, last = performance.now(), t = 0, moved = 0, rest = 0, flash = 0;
  let crate = START.crate.slice(), you = START.you.slice();
  let fromC = crate.slice(), fromY = you.slice();

  function reset() {
    crate = START.crate.slice();
    you = START.you.slice();
    fromC = crate.slice();
    fromY = you.slice();
    moved = 0;
    t = 0;
  }

  function stepOnce() {
    fromC = crate.slice();
    fromY = you.slice();
    you = [you[0] + 1, you[1]];
    crate = [crate[0] + 1, crate[1]];
    moved++;
    if (crate[0] === GOALS[1][0] && crate[1] === GOALS[1][1]) flash = 1;
  }

  function brick(x, y, s) {
    ctx.fillStyle = '#242c3d';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#323c53';
    ctx.fillRect(x + 1, y + 1, s - 2, s / 2 - 2);
    ctx.fillRect(x + 1, y + s / 2 + 1, s / 2 - 2, s / 2 - 2);
    ctx.fillRect(x + s / 2 + 1, y + s / 2 + 1, s / 2 - 2, s / 2 - 2);
    ctx.fillStyle = 'rgba(139,212,80,0.13)';
    ctx.fillRect(x, y, s, 2);
  }

  function pad(x, y, s, glow) {
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.globalAlpha = 0.5 + 0.5 * glow;
    ctx.strokeStyle = '#8bd450';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.shadowColor = '#8bd450';
    ctx.shadowBlur = 8 + glow * 8;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function box(x, y, s, home) {
    const p = Math.max(2, s * 0.08);
    const g = ctx.createLinearGradient(x, y, x + s, y + s);
    if (home) { g.addColorStop(0, '#9fe063'); g.addColorStop(1, '#4e8f2a'); }
    else { g.addColorStop(0, '#b07a3f'); g.addColorStop(1, '#6b4420'); }
    ctx.save();
    if (home) { ctx.shadowColor = '#8bd450'; ctx.shadowBlur = 12; }
    ctx.fillStyle = g;
    ctx.fillRect(x + p, y + p, s - p * 2, s - p * 2);
    ctx.restore();
    ctx.strokeStyle = home ? 'rgba(20,50,10,0.45)' : 'rgba(50,28,10,0.55)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.beginPath();
    ctx.moveTo(x + p * 1.5, y + p * 1.5);
    ctx.lineTo(x + s - p * 1.5, y + s - p * 1.5);
    ctx.moveTo(x + s - p * 1.5, y + p * 1.5);
    ctx.lineTo(x + p * 1.5, y + s - p * 1.5);
    ctx.stroke();
    ctx.fillStyle = home ? '#dff6c4' : '#b9c3d1';
    const m = s * 0.16;
    for (const [cx, cy] of [[x + p, y + p], [x + s - p - m, y + p], [x + p, y + s - p - m], [x + s - p - m, y + s - p - m]]) {
      ctx.fillRect(cx, cy, m, m * 0.32);
      ctx.fillRect(cx, cy, m * 0.32, m);
    }
  }

  function guy(x, y, s) {
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    ctx.fillStyle = '#2b6fa8';
    ctx.fillRect(-s * 0.2, -s * 0.05, s * 0.4, s * 0.38);
    ctx.fillStyle = '#ffd9a8';
    ctx.beginPath();
    ctx.arc(0, -s * 0.18, s * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb703';
    ctx.beginPath();
    ctx.arc(0, -s * 0.2, s * 0.16, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-s * 0.2, -s * 0.21, s * 0.4, s * 0.04);
    ctx.fillStyle = '#20313f';
    ctx.beginPath();
    ctx.arc(s * 0.02, -s * 0.15, s * 0.026, 0, Math.PI * 2);
    ctx.arc(s * 0.12, -s * 0.15, s * 0.026, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#6cc7ff';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.14, s * 0.04);
    ctx.lineTo(s * 0.22, s * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c10';
    ctx.fillRect(0, 0, W, H);

    const s = Math.floor(Math.min((W - 16) / COLS, (H - 16) / ROWS));
    const ox = Math.round((W - s * COLS) / 2), oy = Math.round((H - s * ROWS) / 2);
    const glow = 0.5 + 0.5 * Math.sin(now / 420);

    if (rest > 0) rest -= dt;
    else {
      t += dt;
      if (t >= STEP) {
        t = 0;
        if (moved < 2) stepOnce();
        else { rest = PAUSE; reset(); }
      }
    }
    if (flash > 0) flash -= dt * 1.6;
    const p = Math.min(1, t / STEP);
    const ease = 1 - (1 - p) * (1 - p);

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const px = ox + x * s, py = oy + y * s;
        if (wall(x, y)) { brick(px, py, s); continue; }
        ctx.fillStyle = (x + y) % 2 ? '#111723' : '#0d1119';
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = 'rgba(139,212,80,0.07)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        if (GOALS.some((g) => g[0] === x && g[1] === y)) pad(px, py, s, glow);
      }
    }

    box(ox + DONE[0] * s, oy + DONE[1] * s, s, true);
    const cx = fromC[0] + (crate[0] - fromC[0]) * ease, cy = fromC[1] + (crate[1] - fromC[1]) * ease;
    const home = crate[0] === GOALS[1][0] && crate[1] === GOALS[1][1] && p > 0.6;
    box(ox + cx * s, oy + cy * s, s, home);
    const yx = fromY[0] + (you[0] - fromY[0]) * ease, yy = fromY[1] + (you[1] - fromY[1]) * ease;
    guy(ox + yx * s, oy + yy * s, s);

    if (flash > 0) {
      ctx.fillStyle = `rgba(139,212,80,${Math.min(0.2, flash * 0.2)})`;
      ctx.fillRect(ox, oy, s * COLS, s * ROWS);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
