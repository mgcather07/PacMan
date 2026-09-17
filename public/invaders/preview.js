/* Home-page preview: a formation marching over bunkers while the cannon fires. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).invaders = function (canvas) {
  const SPR = window.InvaderSprites;
  const ctx = canvas.getContext('2d');
  const colors = ['#ff5ecf', '#3fd8ff', '#3fd8ff', '#39ff14'];
  const types = ['squid', 'crab', 'crab', 'octo'];
  let raf = 0, last = performance.now(), stepT = 0, frame = 0, gx = 0, dir = 1, shot = null, cannonX = 0.5, killed = new Set();

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#02030a';
    ctx.fillRect(0, 0, W, H);

    const px = Math.max(2, Math.floor(H / 70));
    const cellW = px * 15, cellH = px * 11, cols = Math.min(9, Math.floor((W - 40) / cellW));
    stepT += dt;
    if (stepT > 0.4) {
      stepT = 0; frame ^= 1; gx += dir * px * 3;
      if (Math.abs(gx) > px * 12) dir *= -1;
      if (killed.size > cols * 2) killed.clear();
    }
    const x0 = (W - cols * cellW) / 2 + gx;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < cols; c++) {
        if (killed.has(`${r},${c}`)) continue;
        const spr = SPR[types[r]][frame];
        SPR.draw(ctx, spr, Math.round(x0 + c * cellW + (cellW - spr.w * px) / 2), Math.round(18 + r * cellH), px, colors[r]);
      }
    }

    // bunkers
    ctx.fillStyle = '#39ff14';
    for (let i = 1; i <= 4; i++) {
      const bx = (W * i) / 5 - px * 9, by = H - px * 22;
      ctx.fillRect(bx, by + px * 2, px * 18, px * 8);
      ctx.fillRect(bx + px * 2, by, px * 14, px * 2);
      ctx.clearRect(bx + px * 6, by + px * 7, px * 6, px * 3);
      ctx.fillStyle = '#02030a'; ctx.fillRect(bx + px * 6, by + px * 7, px * 6, px * 3); ctx.fillStyle = '#39ff14';
    }

    // cannon glides and fires at a random column
    if (!shot) {
      const c = Math.floor(Math.random() * cols);
      shot = { tx: x0 + c * cellW + cellW / 2, x: null, y: H - px * 10, col: c };
    }
    const target = shot.tx / W;
    cannonX += Math.max(-dt * 0.8, Math.min(dt * 0.8, target - cannonX));
    const cx = cannonX * W;
    if (shot.x === null && Math.abs(target - cannonX) < 0.01) shot.x = cx;
    if (shot.x !== null) {
      shot.y -= dt * H * 1.6;
      ctx.fillStyle = '#fff';
      ctx.fillRect(shot.x - px / 2, shot.y, px, px * 4);
      const row = Math.floor((shot.y - 18) / cellH);
      const col = Math.floor((shot.x - x0) / cellW);
      if (row >= 0 && row < 4 && col >= 0 && col < cols && !killed.has(`${row},${col}`) && shot.y < 18 + (row + 1) * cellH - px * 3) { killed.add(`${row},${col}`); shot = null; }
      else if (shot.y < 0) shot = null;
    }
    SPR.draw(ctx, SPR.cannon, Math.round(cx - (SPR.cannon.w * px) / 2), H - px * 9, px, '#39ff14');
    ctx.fillStyle = '#39ff14';
    ctx.fillRect(0, H - px, W, px / 2);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
