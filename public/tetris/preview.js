/* Home-page preview: Tower mode — pieces stacking upwards while the tide rises. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).tetris = function (canvas) {
  const ctx = canvas.getContext('2d');
  const colors = ['#3fd8ff', '#ffd23f', '#c77dff', '#7dff6a', '#ff4d6d', '#4d7dff', '#ff9f3d'];
  const pieces = [
    [[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[0, 0], [1, 0], [1, 1], [2, 1]], [[1, 0], [2, 0], [0, 1], [1, 1]], [[0, 0], [0, 1], [1, 0], [2, 0]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
  ];
  const COLS = 10;
  const stack = [];
  let raf = 0, last = 0, cur = null, fall = 0;

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    const dt = last ? Math.min(0.05, t - last) : 0;
    last = t;
    const s = Math.max(11, Math.min(16, H / 12)), bx = W / 2 - (COLS * s) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07061a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0e0c2a'; ctx.fillRect(bx, 0, COLS * s, H);

    // the camera climbs with the tower, so the stack never leaves the card
    const cam = Math.max(0, stack.length ? Math.max(...stack.map((b) => b[1])) - Math.floor(H / s) + 4 : 0);
    if (!cur) cur = { k: Math.floor(Math.random() * 7), x: Math.floor(Math.random() * 7), y: cam + Math.floor(H / s) + 4 };
    fall += dt;
    while (fall > 0.06) {
      fall -= 0.06;
      const blocked = pieces[cur.k].some(([dx, dy]) => cur.y + dy - 1 < 0 || stack.some((b) => b[0] === cur.x + dx && b[1] === cur.y + dy - 1));
      if (blocked) {
        pieces[cur.k].forEach(([dx, dy]) => stack.push([cur.x + dx, cur.y + dy, cur.k]));
        if (stack.length > 300) stack.length = 0;
        cur = null;
        break;
      }
      cur.y--;
    }

    const block = (x, y, k) => {
      const py = H - (y - cam + 1) * s;
      ctx.fillStyle = colors[k]; ctx.fillRect(bx + x * s + 1, py + 1, s - 2, s - 2);
      ctx.fillStyle = '#ffffff44'; ctx.fillRect(bx + x * s + 1, py + 1, s - 2, 3);
    };
    stack.forEach(([x, y, k]) => block(x, y, k));
    if (cur) pieces[cur.k].forEach(([dx, dy]) => block(cur.x + dx, cur.y + dy, cur.k));

    const tideY = H - 18 + Math.sin(t) * 4;
    ctx.fillStyle = 'rgba(40,140,255,0.5)';
    ctx.beginPath(); ctx.moveTo(bx, H);
    for (let x = 0; x <= COLS * s; x += 6) ctx.lineTo(bx + x, tideY + Math.sin(t * 3 + x * 0.08) * 3);
    ctx.lineTo(bx + COLS * s, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#c77dff88'; ctx.strokeRect(bx - 1, -1, COLS * s + 2, H + 2);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
