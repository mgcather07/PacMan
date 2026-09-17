/* Home-page preview: the climber hopping a barrel while the ape beats his chest above. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).climber = function (canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0, last = performance.now(), t = 0;
  let barrels = [], spawn = 0.4, jump = null, manX = 0.42;

  const MAN = [
    '...1111.....', '..111111....', '..133331....', '..333343....',
    '..333333....', '...3333.....', '..111111....', '.3111111....',
    '..222222....', '..222222....', '..22..22....', '.444..444...',
  ];
  const MAN_JUMP = [
    '..3.1111.3..', '..31111113..', '...133331...', '...333343...',
    '...333333...', '....3333....', '...111111...', '...222222...',
    '..22....22..', '.222....222.', '.44......44.', '............',
  ];
  const APE = [
    '...2222222222...', '..222222222222..', '..223333333322..', '..233443344332..',
    '..233443344332..', '..233333333332..', '..223344443322..', '.22233333333222.',
    '.22222222222222.', '..2222....2222..',
  ];
  const MAN_P = { 1: '#ff3b5c', 2: '#2f6bff', 3: '#ffcc99', 4: '#2a1c12' };
  const APE_P = { 2: '#a0603a', 3: '#f0c48a', 4: '#2a1408' };

  function sprite(rows, pal, x, y, px) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === '.' || ch === ' ') continue;
        ctx.fillStyle = pal[ch];
        ctx.fillRect(Math.round(x + c * px), Math.round(y + r * px), px, px);
      }
    }
  }

  function girder(x, y, w, px) {
    ctx.fillStyle = '#6e1b08';
    ctx.fillRect(x, y + px * 2, w, px);
    ctx.fillStyle = '#c93a1e';
    ctx.fillRect(x, y, w, px * 2.5);
    ctx.fillStyle = '#ff7a52';
    ctx.fillRect(x, y, w, px * 0.8);
    ctx.fillStyle = '#ffd23f';
    for (let i = px * 2; i < w - px; i += px * 5) ctx.fillRect(x + i, y + px, px * 0.8, px * 0.8);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1b0b33'); bg.addColorStop(1, '#0a0518');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const px = Math.max(2, Math.round(H / 64));
    const floorY = H - px * 5;
    const topY = H * 0.36;

    // a sloped girder up top for the ape, a flat one below for the chase
    girder(0, topY, W, px);
    girder(0, floorY, W, px);
    ctx.fillStyle = '#7fd4ff';
    const lx = W * 0.78;
    ctx.fillRect(lx - px * 4, topY, px, floorY - topY);
    ctx.fillRect(lx + px * 3, topY, px, floorY - topY);
    ctx.fillStyle = '#cfeaff';
    for (let y = topY + px * 3; y < floorY; y += px * 4) ctx.fillRect(lx - px * 4, y, px * 8, px);

    // the ape, beating his chest on the upper girder
    const beat = Math.sin(t * 5) > 0.2 ? px : 0;
    sprite(APE, APE_P, W * 0.1, topY - APE.length * px - beat, px);

    // barrels roll along the lower girder towards the climber
    spawn -= dt;
    if (spawn <= 0 && barrels.length < 3) { spawn = 1.9; barrels.push({ x: W + 20, rot: 0 }); }
    for (const b of barrels) { b.x -= dt * W * 0.28; b.rot += dt * 5; }
    barrels = barrels.filter((b) => b.x > -24);

    // the climber hops whatever is closest
    const mx = manX * W;
    const near = barrels.find((b) => b.x - mx < px * 9 && b.x > mx - px * 4);
    if (near && !jump) jump = 0;
    let lift = 0;
    if (jump !== null) {
      jump += dt;
      lift = Math.max(0, 300 * jump - 560 * jump * jump) * (px / 5);
      if (jump > 0.55) { jump = null; lift = 0; }
    }

    for (const b of barrels) {
      const w = px * 5, h = px * 4, x = b.x, y = floorY - h / 2;
      ctx.fillStyle = '#8a4f18'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.fillStyle = '#d98a3a'; ctx.fillRect(x - w / 2 + 1, y - h / 2 + 1, w - 2, h - 2);
      ctx.fillStyle = '#8a4f18';
      const off = ((b.rot * 6) % 6 + 6) % 6;
      for (let i = -w / 2 + off - 6; i < w / 2; i += px * 2) {
        const sx = Math.max(-w / 2 + 1, Math.min(w / 2 - 2, i));
        ctx.fillRect(x + sx, y - h / 2 + 1, 2, h - 2);
      }
      ctx.fillStyle = '#7a4212';
      ctx.fillRect(x - w / 2, y - h / 2 + 2, w, 1.5);
      ctx.fillRect(x - w / 2, y + h / 2 - 3, w, 1.5);
    }

    const rows = lift > 1 ? MAN_JUMP : MAN;
    sprite(rows, MAN_P, mx - (px * 12) / 2, floorY - rows.length * px - lift, px);

    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
