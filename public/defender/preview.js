/* Home-page preview: the ship streaking over the mountains past landers, with a live radar strip. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).defender = function (canvas) {
  const ctx = canvas.getContext('2d');
  const WORLD = 1400;
  const TAU = Math.PI * 2;
  const ridge = [];
  for (let i = 0; i < 56; i++) {
    let h = 0;
    for (const [f, a, p] of [[1, 12, 0.7], [2, 9, 2.1], [3, 6, 4.4], [7, 4, 1.2]]) h += Math.sin((i / 56) * TAU * f + p) * a;
    ridge.push(h + (i % 2 ? 9 : 2));
  }
  const landers = [0.12, 0.34, 0.58, 0.81].map((f, i) => ({ x: f * WORLD, y: 0.3 + (i % 3) * 0.13, ph: i * 1.7 }));
  const humans = [0.2, 0.45, 0.7, 0.92].map((f) => f * WORLD);
  let raf = 0, last = performance.now(), cam = 0, t = 0, shot = -1;

  const wrap = (x) => ((x % WORLD) + WORLD) % WORLD;

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    cam = wrap(cam + dt * 190);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#02030c'); bg.addColorStop(1, '#0a0f2c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const radarH = Math.max(16, H * 0.14), radarY = 6;
    const skyTop = radarY + radarH + 6;
    const baseY = H - 6;
    const sx = (wx) => { const d = wrap(wx - cam); return d > WORLD - W ? d - WORLD : d; };
    const step = WORLD / 56;
    const groundAt = (screenX) => baseY - 8 - ridge[Math.floor(wrap(screenX + cam) / step) % 56] * (H / 150);

    // mountains
    ctx.beginPath();
    ctx.moveTo(-step, H);
    for (let x = -step; x <= W + step; x += step / 2) ctx.lineTo(x, groundAt(x));
    ctx.lineTo(W + step, H);
    ctx.closePath();
    ctx.fillStyle = '#060b1c';
    ctx.fill();
    ctx.strokeStyle = '#5b8cff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#5b8cff'; ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // humanoids on the ground
    for (const hx of humans) {
      const x = sx(hx);
      if (x < -8 || x > W + 8) continue;
      const g = groundAt(x);
      ctx.fillStyle = '#ffe6a7';
      ctx.fillRect(x - 1, g - 7, 2, 3);
      ctx.fillRect(x - 2, g - 4, 4, 4);
    }

    // landers drifting down towards them
    for (const l of landers) {
      const x = sx(l.x), y = skyTop + (H - skyTop) * l.y + Math.sin(t * 1.4 + l.ph) * 6;
      if (x < -14 || x > W + 14) continue;
      ctx.fillStyle = '#7dff6a';
      ctx.shadowColor = '#7dff6a'; ctx.shadowBlur = 6;
      ctx.fillRect(x - 6, y - 6, 12, 4);
      ctx.fillRect(x - 3, y - 2, 6, 3);
      ctx.fillRect(x - 6, y + 1, 2, 5);
      ctx.fillRect(x + 4, y + 1, 2, 5);
      ctx.shadowBlur = 0;
    }

    // the ship holds station on the left third and fires across the screen
    const shipX = W * 0.32, shipY = skyTop + (H - skyTop) * 0.34 + Math.sin(t * 1.9) * (H * 0.06);
    if (shot < 0 && Math.sin(t * 1.3) > 0.9) shot = 0;
    if (shot >= 0) {
      shot += dt * W * 3.4;
      const len = Math.min(W * 0.45, shot);
      const head = shipX + 12 + shot;
      const g = ctx.createLinearGradient(head - len, 0, head, 0);
      g.addColorStop(0, '#5b8cff00'); g.addColorStop(0.5, '#dce9ff'); g.addColorStop(1, '#ffffff');
      ctx.fillStyle = g;
      ctx.shadowColor = '#5b8cff'; ctx.shadowBlur = 8;
      ctx.fillRect(head - len, shipY - 1, len, 2);
      ctx.shadowBlur = 0;
      if (head - len > W) shot = -1;
    }
    ctx.save();
    ctx.translate(shipX, shipY);
    ctx.fillStyle = '#5b8cff';
    ctx.shadowColor = '#5b8cff'; ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(12, 0); ctx.lineTo(3, -5); ctx.lineTo(-8, -5); ctx.lineTo(-11, -1);
    ctx.lineTo(-11, 2); ctx.lineTo(-6, 5); ctx.lineTo(5, 5);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff9f43';
    const f = 5 + Math.sin(t * 22) * 3;
    ctx.beginPath(); ctx.moveTo(-11, -2); ctx.lineTo(-11 - f, 0); ctx.lineTo(-11, 3); ctx.closePath(); ctx.fill();
    ctx.restore();

    // radar strip: the whole world in miniature
    ctx.fillStyle = '#04061a';
    ctx.strokeStyle = '#5b8cff55';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(6, radarY, W - 12, radarH, 4); else ctx.rect(6, radarY, W - 12, radarH);
    ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = '#5b8cff88';
    ctx.beginPath();
    for (let i = 0; i <= 56; i++) {
      const px = 6 + (i / 56) * (W - 12), py = radarY + radarH - 3 - ridge[i % 56] * (radarH / 70);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    for (const l of landers) {
      ctx.fillStyle = '#7dff6a';
      ctx.fillRect(6 + (l.x / WORLD) * (W - 12) - 1, radarY + 3 + l.y * (radarH - 8), 2, 2);
    }
    for (const hx of humans) {
      ctx.fillStyle = '#ffe6a7';
      ctx.fillRect(6 + (hx / WORLD) * (W - 12) - 1, radarY + radarH - 6, 2, 3);
    }
    ctx.fillStyle = '#fff';
    const px = 6 + (wrap(cam + shipX) / WORLD) * (W - 12);
    ctx.fillRect(px - 2, radarY + radarH * 0.4, 4, 3);
    ctx.strokeStyle = '#ffffff44';
    ctx.strokeRect(6 + (cam / WORLD) * (W - 12), radarY + 1, (W / WORLD) * (W - 12), radarH - 2);
    ctx.restore();

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
