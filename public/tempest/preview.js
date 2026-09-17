/* Home-page preview: a slowly turning neon tube with flippers climbing its lanes. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).tempest = function (canvas) {
  const ctx = canvas.getContext('2d');
  const TAU = Math.PI * 2;
  const LANES = 12;
  const PALETTES = [['#ff2e88', '#5b1f7a'], ['#3fd8ff', '#12508c'], ['#7dff6a', '#1c6b2e'], ['#c77dff', '#4a2a7a']];
  const ENEMY = ['#ff4d6d', '#7dff6a'];
  let raf = 0, last = performance.now(), spin = 0, t = 0, pal = 0, palT = 0;
  let player = 0.5;
  const foes = [];

  const persp = (z) => 1 / (1 + z * 7);

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    spin += dt * 0.35;
    palT += dt;
    if (palT > 6) { palT = 0; pal = (pal + 1) % PALETTES.length; }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const CX = W / 2, CY = H / 2, R = Math.min(W, H) * 0.42;

    const rim = (u) => {
      const a = Math.PI / 2 + (u / LANES) * TAU + spin;
      const r = R * (0.66 + 0.34 * Math.cos(5 * (a - spin)));
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const P = (u, z) => { const p = rim(u), s = persp(z); return [CX + p[0] * s, CY + p[1] * s]; };
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

    ctx.fillStyle = '#04010c';
    ctx.fillRect(0, 0, W, H);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const [rimCol, laneCol] = PALETTES[pal];

    // lanes and the far ring
    ctx.strokeStyle = laneCol;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let i = 0; i < LANES; i++) { const a = P(i, 0), b = P(i, 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= LANES; i++) { const p = P(i % LANES, 1); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // the rim
    ctx.strokeStyle = rimCol;
    ctx.shadowColor = rimCol;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let i = 0; i <= LANES; i++) { const p = P(i % LANES, 0); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
    ctx.stroke();

    // flippers climbing towards the rim
    if (foes.length < 4 && Math.random() < 0.03) foes.push({ u: Math.floor(Math.random() * LANES) + 0.5, u0: 0, z: 1, flip: 0, fdir: 1, c: ENEMY[Math.random() < 0.7 ? 0 : 1] });
    for (const f of foes) {
      f.z -= dt * 0.17;
      if (f.flip > 0) {
        f.flip += dt * 2.6;
        if (f.flip >= 1) { f.u = f.u0 + f.fdir; f.flip = 0; } else f.u = f.u0 + f.fdir * f.flip;
      } else if (Math.random() < 0.012) { f.u0 = f.u; f.fdir = Math.random() < 0.5 ? 1 : -1; f.flip = 0.001; }
      const fold = f.flip > 0 ? Math.max(0.15, Math.abs(Math.cos(Math.PI * f.flip))) : 1;
      const hw = 0.5 * fold, z = Math.max(0, f.z);
      const a = P(f.u - hw, z), b = P(f.u + hw, z), a2 = P(f.u - hw, z + 0.07), b2 = P(f.u + hw, z + 0.07);
      const nm = mid(a, b), fm = mid(a2, b2);
      ctx.strokeStyle = f.c;
      ctx.shadowColor = f.c;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(fm[0], fm[1]); ctx.lineTo(b[0], b[1]);
      ctx.moveTo(a2[0], a2[1]); ctx.lineTo(nm[0], nm[1]); ctx.lineTo(b2[0], b2[1]);
      ctx.stroke();
    }
    for (let i = foes.length - 1; i >= 0; i--) if (foes[i].z <= -0.04) foes.splice(i, 1);

    // the claw, sliding round the rim
    player += dt * 1.1 * Math.sin(t * 0.8);
    const a = P(player - 0.5, 0), b = P(player + 0.5, 0), tip = P(player, 0.16);
    ctx.strokeStyle = '#ffe600';
    ctx.shadowColor = '#ffe600';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(b[0], b[1]);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.shadowBlur = 0;

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
