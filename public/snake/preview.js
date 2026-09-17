/* Home-page preview: a snake winding through the endless world, eating as it goes. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).snake = function (canvas) {
  const ctx = canvas.getContext('2d');
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
    ctx.fillStyle = '#07071a';
    ctx.fillRect(0, 0, W, H);

    const G = 22, cols = Math.max(6, Math.floor(W / G)), rows = Math.max(4, Math.floor(H / G));
    ctx.fillStyle = '#1b1b44';
    for (let y = G / 2; y < H; y += G) for (let x = G / 2; x < W; x += G) { ctx.beginPath(); ctx.arc(x, y, 1.5, 0, 7); ctx.fill(); }

    ctx.fillStyle = '#26114a'; ctx.strokeStyle = '#8b5cff'; ctx.lineWidth = 2;
    const rocks = [[2, 1], [2, 2], [3, 1], [cols - 4, rows - 2], [cols - 3, rows - 2], [cols - 2, rows - 2]];
    rocks.forEach(([x, y]) => { ctx.fillRect(x * G + 1, y * G + 1, G - 2, G - 2); ctx.strokeRect(x * G + 1, y * G + 1, G - 2, G - 2); });

    const amp = H * 0.17;
    const cycle = W + 400;
    const head = ((t * 90) % cycle) - 40;
    const pts = [];
    for (let i = 0; i < 26; i++) { const x = head - i * 12; pts.push([x, H / 2 + Math.sin(x * 0.025) * amp]); }

    ctx.shadowColor = '#ff5ea8'; ctx.shadowBlur = 10; ctx.fillStyle = '#ff5ea8';
    for (let x = 30; x < W; x += 70) if (x > head) { ctx.beginPath(); ctx.arc(x, H / 2 + Math.sin(x * 0.025) * amp, 5, 0, 7); ctx.fill(); }
    ctx.shadowColor = '#3cff8a'; ctx.shadowBlur = 16; ctx.strokeStyle = '#3cff8a';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 16;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#ffffff40'; ctx.lineWidth = 5; ctx.stroke();

    const [hx, hy] = pts[0];
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx + 2, hy - 4, 3.2, 0, 7); ctx.arc(hx + 2, hy + 4, 3.2, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx + 3, hy - 4, 1.6, 0, 7); ctx.arc(hx + 3, hy + 4, 1.6, 0, 7); ctx.fill();
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
