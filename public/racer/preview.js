/* Home-page preview: three cars sweeping round a banked bend, leaving skid marks. */
(window.ArcadePreviews = window.ArcadePreviews || {}).racer = function (canvas) {
  const ctx = canvas.getContext('2d');
  const cars = [
    { col: '#e94f37', t: 0.00, sp: 0.52, lane: -0.34, drift: 0.30 },
    { col: '#3fd8ff', t: 0.16, sp: 0.49, lane: 0.16, drift: 0.20 },
    { col: '#ffd23f', t: 0.31, sp: 0.47, lane: 0.42, drift: 0.14 },
  ];
  const marks = [];
  let raf = 0, last = performance.now();

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // grass
    ctx.fillStyle = '#16301f';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#12281a';
    for (let x = 0; x < W; x += 26) for (let y = 0; y < H; y += 22) ctx.fillRect(x + ((y * 7) % 13), y + ((x * 5) % 11), 7, 3);

    // a bend: an arc centred off the bottom-left corner
    const cx = -W * 0.18, cy = H * 1.05, R = Math.min(W, H) * 1.05, road = Math.min(W, H) * 0.34;
    const a0 = -1.35, a1 = -0.06;
    const pos = (t, lane) => {
      const a = a0 + (a1 - a0) * t, r = R + lane * road * 0.5;
      return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, a: a + Math.PI / 2 };
    };

    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#2b2f38';
    ctx.lineWidth = road;
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();

    // kerbs
    for (const side of [-1, 1]) {
      const n = 16;
      for (let i = 0; i < n; i++) {
        ctx.strokeStyle = i % 2 ? '#f3f3f3' : '#e0413a';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(cx, cy, R + side * (road / 2 + 3), a0 + ((a1 - a0) * i) / n, a0 + ((a1 - a0) * (i + 1)) / n);
        ctx.stroke();
      }
    }
    // centre dashes
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([9, 12]);
    ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
    ctx.setLineDash([]);

    // skid marks fade out behind the cars
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      m.t += dt;
      if (m.t > 2.6) { marks.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(14,14,20,${0.45 * (1 - m.t / 2.6)})`;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); ctx.stroke();
    }

    for (const c of cars) {
      c.t += c.sp * dt * 0.42;
      if (c.t > 1.12) { c.t = -0.12; c.last = null; }
      const p = pos(c.t, c.lane + Math.sin(c.t * 5 + c.drift * 9) * 0.1);
      const slide = c.drift * (0.55 + 0.45 * Math.sin(c.t * 4));
      const ang = p.a + slide;
      if (c.t > 0 && c.t < 1.05 && c.last) {
        for (const sg of [-1, 1]) {
          const ox = -6, oy = sg * 4.5;
          const x = p.x + Math.cos(ang) * ox - Math.sin(ang) * oy;
          const y = p.y + Math.sin(ang) * ox + Math.cos(ang) * oy;
          const l = c.last[sg > 0 ? 1 : 0];
          if (l) marks.push({ x1: l.x, y1: l.y, x2: x, y2: y, t: 0 });
          c.last[sg > 0 ? 1 : 0] = { x, y };
        }
      } else c.last = [null, null];
      drawCar(p.x, p.y, ang, c.col);
    }
    raf = requestAnimationFrame(frame);
  }

  function drawCar(x, y, a, col) {
    const L = 22, Wd = 12;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-L / 2 + 2, -Wd / 2 + 3, L, Wd);
    ctx.fillStyle = '#14141c';
    ctx.fillRect(5, -Wd / 2 - 1, 7, 3.5);
    ctx.fillRect(5, Wd / 2 - 2.5, 7, 3.5);
    ctx.fillRect(-10, -Wd / 2 - 1, 7, 3.5);
    ctx.fillRect(-10, Wd / 2 - 2.5, 7, 3.5);
    ctx.fillStyle = col;
    ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
    ctx.fillStyle = '#0d1420';
    ctx.fillRect(-2, -Wd / 2 + 2, 6, Wd - 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-L / 2 + 0.5, -Wd / 2 + 0.5, L - 1, Wd - 1);
    ctx.restore();
  }

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
