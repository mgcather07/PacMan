/* Home-page preview: a little stack of tiles where matching pairs keep lighting up and lifting off. */
(window.ArcadePreviews = window.ArcadePreviews || {}).mahjong = function (canvas) {
  const ctx = canvas.getContext('2d');
  const FACES = [
    { c: '#1d7a44', t: 'bar', n: 3 },     // bamboo
    { c: '#1a5fb4', t: 'dot', n: 4 },     // circles
    { c: '#b0232a', t: 'num', n: 7 },     // characters
    { c: '#2b3b52', t: 'txt', s: 'E' },   // wind
    { c: '#b0232a', t: 'box' },           // red dragon
    { c: '#c0397a', t: 'flw' },           // flower
    { c: '#1d7a44', t: 'num', n: 5 },
    { c: '#1a5fb4', t: 'dot', n: 2 },
  ];
  // a small three-tier stack: 7×3 on the table, 5×2 above it, 3×1 on top
  const SHAPE = [];
  [[7, 3, 0], [5, 2, 1], [3, 1, 2]].forEach(([w, h, z]) => {
    for (let r = 0; r < h; r++) for (let i = 0; i < w; i++) SHAPE.push({ x: (7 - w) + i * 2, y: (3 - h) + r * 2, z });
  });

  let tiles = [], picked = null, wait = 0, raf = 0, last = performance.now();

  const rnd = (n) => Math.floor(Math.random() * n);
  function free(t) {
    if (t.gone) return false;
    let l = false, r = false;
    for (const o of tiles) {
      if (o.gone || o === t) continue;
      if (o.z === t.z + 1 && Math.abs(o.x - t.x) < 2 && Math.abs(o.y - t.y) < 2) return false;
      if (o.z === t.z && Math.abs(o.y - t.y) < 2) { if (o.x === t.x - 2) l = true; else if (o.x === t.x + 2) r = true; }
    }
    return !(l && r);
  }
  function reset() {
    tiles = SHAPE.map((s) => ({ ...s, gone: false, f: 0, a: 0 }));
    for (let i = 0; i < tiles.length; i += 2) {
      const f = rnd(FACES.length);
      tiles[i].f = f;
      tiles[i + 1].f = f;
    }
    for (let i = tiles.length - 1; i > 0; i--) { const j = rnd(i + 1); const t = tiles[i].f; tiles[i].f = tiles[j].f; tiles[j].f = t; }
    picked = null;
    wait = 0.4;
  }
  function nextPair() {
    const open = tiles.filter(free);
    const by = {};
    open.forEach((t) => (by[t.f] = by[t.f] || []).push(t));
    const ready = Object.values(by).filter((g) => g.length >= 2);
    if (!ready.length || tiles.filter((t) => !t.gone).length <= 6) { reset(); return; }
    const g = ready[rnd(ready.length)];
    picked = { a: g[0], b: g[1], t: 0 };
  }

  function face(f, x, y, w, h) {
    const F = FACES[f], cx = x + w / 2, cy = y + h / 2;
    ctx.fillStyle = F.c;
    if (F.t === 'bar') {
      for (let i = 0; i < F.n; i++) ctx.fillRect(cx - w * 0.28 + i * w * 0.22, cy - h * 0.18, w * 0.1, h * 0.36);
    } else if (F.t === 'dot') {
      for (let i = 0; i < F.n; i++) {
        const a = (i / F.n) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.2, cy + Math.sin(a) * w * 0.2, w * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (F.t === 'box') {
      ctx.lineWidth = Math.max(1, w * 0.09);
      ctx.strokeStyle = F.c;
      ctx.strokeRect(cx - w * 0.2, cy - h * 0.15, w * 0.4, h * 0.3);
      ctx.fillRect(cx - ctx.lineWidth / 2, cy - h * 0.28, ctx.lineWidth, h * 0.56);
    } else if (F.t === 'flw') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * w * 0.16, cy + Math.sin(a) * w * 0.16, w * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.font = `700 ${Math.round(h * 0.5)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(F.t === 'txt' ? F.s : String(F.n), cx, cy + h * 0.02);
    }
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createRadialGradient(W / 2, H * 0.35, 0, W / 2, H * 0.35, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#15503a');
    bg.addColorStop(1, '#07190f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (!tiles.length) reset();
    const tw = Math.min((W - 16) / 7.8, (H - 16) / (3 * 1.34 + 0.8));
    const th = tw * 1.34, lift = tw * 0.15;
    const ox = (W - (7 * tw + 2 * lift)) / 2 + 2 * lift;
    const oy = (H - (3 * th + 2 * lift)) / 2 + 2 * lift;

    tiles.slice().sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x).forEach((t) => {
      if (t.gone && t.a <= 0) return;
      const x = ox + (t.x / 2) * tw - t.z * lift, y = oy + (t.y / 2) * th - t.z * lift;
      const hot = picked && (t === picked.a || t === picked.b);
      ctx.save();
      ctx.globalAlpha = t.gone ? Math.max(0, t.a) : 1;
      ctx.fillStyle = '#8f8465';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, tw + lift, th + lift, tw * 0.13); else ctx.rect(x, y, tw + lift, th + lift);
      ctx.fill();
      ctx.fillStyle = hot ? '#fff6d8' : '#f6f1e0';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, tw, th, tw * 0.13); else ctx.rect(x, y, tw, th);
      ctx.fill();
      face(t.f, x, y, tw, th);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, tw, th, tw * 0.13); else ctx.rect(x, y, tw, th);
      const shade = 0.07 * (2 - t.z);
      if (shade > 0 && !hot) { ctx.fillStyle = `rgba(6,18,14,${shade})`; ctx.fill(); }
      if (hot) {
        ctx.strokeStyle = '#d97b7b';
        ctx.lineWidth = Math.max(2, tw * 0.08);
        ctx.stroke();
      }
      ctx.restore();
    });

    // pick a pair, let it glow, then lift it off
    if (picked) {
      picked.t += dt;
      if (picked.t > 0.45) {
        picked.a.gone = picked.b.gone = true;
        picked.a.a = picked.b.a = 1;
        picked = null;
        wait = 0.35;
      }
    } else if ((wait -= dt) <= 0) nextPair();
    tiles.forEach((t) => { if (t.gone && t.a > 0) t.a -= dt * 3; });

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
