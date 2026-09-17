/* Home-page preview: a ball arcs up the alley into the rings and the machine spits tickets. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).skeeball = function (canvas) {
  const ctx = canvas.getContext('2d');
  const RINGS = [[1, '#c08b57'], [0.78, '#7fd1c4'], [0.57, '#57c7ff'], [0.36, '#ffd166'], [0.17, '#ff5d8f']];
  const TARGETS = [[0, 0.17, 50], [-1, 0, 100], [0, 0.36, 40], [1, 0, 100], [0, 0.57, 30]];
  let raf = 0, last = performance.now(), t = 0, shot = 0, tickets = [];

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a14';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H * 0.3, rx = W * 0.3, ry = rx * 0.44;
    const lipY = H * 0.6, lipW = W * 0.17, botW = W * 0.27;

    // lane and ramp
    const g = ctx.createLinearGradient(0, lipY, 0, H);
    g.addColorStop(0, '#e0a763');
    g.addColorStop(0.16, '#b57c46');
    g.addColorStop(1, '#8a5a2e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx - lipW, lipY);
    ctx.lineTo(cx + lipW, lipY);
    ctx.lineTo(cx + botW, H);
    ctx.lineTo(cx - botW, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#2ec4b6';
    ctx.lineWidth = 2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * lipW, lipY);
      ctx.lineTo(cx + s * botW, H);
      ctx.stroke();
    }
    ctx.fillStyle = '#ffe9c9';
    ctx.fillRect(cx - lipW, lipY - 3, lipW * 2, 3);

    // rings
    for (const [f, col] of RINGS) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2);
      ctx.fillStyle = f === 0.17 ? '#140c06' : f % 0.36 < 0.2 ? '#1c1109' : '#2b1a0e';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // the two corner 100s
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * rx * 0.9, cy - ry * 0.62, rx * 0.18, ry * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#140c06';
      ctx.fill();
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // one roll: up the lane, over the lip, into a ring
    t += dt * 0.55;
    if (t > 1) { t = 0; shot = (shot + 1) % TARGETS.length; }
    const [sx, fr, val] = TARGETS[shot];
    const tx = sx ? cx + sx * rx * 0.9 : cx;
    const ty = sx ? cy - ry * 0.62 : cy - ry * fr * 0.55;
    let bx, by, lift = 0;
    if (t < 0.4) {
      const u = t / 0.4;
      bx = cx + (tx - cx) * u * 0.25;
      by = H * 1.02 + (lipY - H * 1.02) * u;
    } else if (t < 0.72) {
      const u = (t - 0.4) / 0.32;
      bx = cx + (tx - cx) * (0.25 + 0.75 * u);
      by = lipY + (ty - lipY) * u;
      lift = Math.sin(Math.PI * u) * H * 0.16;
      if (u > 0.985 && tickets.length < 14) for (let i = 0; i < (val >= 100 ? 5 : 3); i++) tickets.push({ x: W * 0.12, y: H * 0.93, vx: 18 + Math.random() * 40, vy: -40 - Math.random() * 40, r: Math.random() * 6, vr: (Math.random() - 0.5) * 8, t: 0 });
    } else {
      bx = tx;
      by = ty;
    }
    const r = W * 0.035;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(bx, by, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    if (t < 0.72) {
      const bg = ctx.createRadialGradient(bx - r * 0.35, by - lift - r * 0.4, r * 0.15, bx, by - lift, r);
      bg.addColorStop(0, '#fffdf6');
      bg.addColorStop(1, '#9d8261');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by - lift, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = val >= 100 ? '#ffe066' : '#ff5d8f';
      ctx.font = `bold ${Math.round(H * 0.11)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.max(0, 1 - (t - 0.72) / 0.28);
      ctx.fillText('+' + val, tx, ty - H * 0.06 - (t - 0.72) * H * 0.4);
      ctx.globalAlpha = 1;
    }

    // ticket slot
    ctx.fillStyle = '#05040a';
    ctx.fillRect(W * 0.05, H * 0.9, W * 0.14, H * 0.05);
    ctx.strokeStyle = '#ffd16688';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(W * 0.05, H * 0.9, W * 0.14, H * 0.05);
    for (const k of tickets) {
      k.t += dt;
      k.vy += 150 * dt;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.r += k.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - k.t / 1.5);
      ctx.translate(k.x, k.y);
      ctx.rotate(k.r);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillRect(-7, -3, 14, 6);
      ctx.restore();
    }
    tickets = tickets.filter((k) => k.t < 1.5);

    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
};
