/* Home-page preview: ten Spider columns, a row off the stock, and a finished king-to-ace run flying home. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).spider = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const COLS = 10, RUN = 5, DONE_COL = 3;
  const T_DEAL = 0.2, T_RUN = 2.8, FLY = 0.38, CYCLE = 8;
  let raf = 0, piles = [], start = 0;

  const ease = (k) => k * k * (3 - 2 * k);
  const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);

  function build() {
    piles = [];
    for (let j = 0; j < COLS; j++) {
      const run = [];
      const len = j === DONE_COL ? RUN : 1 + (j % 3);
      const top = j === DONE_COL ? 12 : 4 + ((j * 5) % 8);
      for (let i = 0; i < len; i++) run.push({ rank: RANKS[Math.max(0, top - i)], suit: j === DONE_COL ? 0 : (j + i) % 2 });
      // the card dealt onto the finished column is the one that completes its run
      const dealt = j === DONE_COL ? { rank: RANKS[12 - RUN], suit: 0 } : { rank: RANKS[(Math.random() * 13) | 0], suit: (Math.random() * 2) | 0 };
      piles.push({ backs: 1 + (j % 3), run, dealt });
    }
  }

  function shape(x, y, w, h) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w * 0.12)); }

  function back(x, y, w, h) {
    shape(x, y, w, h);
    ctx.fillStyle = '#134b5a'; ctx.fill();
    ctx.strokeStyle = '#eef3f2'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#5fd4e055';
    for (let d = -h; d < w; d += Math.max(5, w * 0.2)) { ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke(); }
    ctx.restore();
  }

  function face(x, y, w, h, rank, suit, glow) {
    if (glow) { ctx.save(); ctx.shadowColor = '#5fd4e0'; ctx.shadowBlur = 12; }
    shape(x, y, w, h);
    ctx.fillStyle = '#fffef9'; ctx.fill();
    ctx.strokeStyle = '#d8d2bf'; ctx.lineWidth = 1; ctx.stroke();
    if (glow) ctx.restore();
    ctx.fillStyle = suit === 1 ? '#c8102e' : '#1b1b2b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.3)}px Georgia, serif`;
    ctx.fillText(rank, x + w * 0.12, y + h * 0.08);
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(h * 0.32)}px Georgia, serif`;
    ctx.fillText(SUITS[suit], x + w * 0.9, y + h * 0.44);
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    if (!piles.length) { build(); start = t; }
    if (t - start > CYCLE) { build(); start = t; }
    const e = t - start;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(W / 2, 0, 10, W / 2, H, H * 1.2);
    g.addColorStop(0, '#14706b'); g.addColorStop(1, '#052624');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = Math.max(3, W * 0.014);
    let cw = (W - pad * 11) / COLS;
    const ch = Math.min(cw * 1.45, H * 0.23);
    cw = Math.min(cw, ch / 1.38);
    const step = (W - pad * 2 - cw) / (COLS - 1);
    const topY = pad, tabY = pad + ch + pad * 2;
    const backLap = ch * 0.16, faceLap = ch * 0.3;
    const colX = (j) => pad + j * step;
    const stockX = W - pad - cw, homeX = pad;

    back(stockX, topY, cw, ch);                               // stock: one more row to deal
    back(stockX - cw * 0.35, topY, cw, ch);
    face(homeX, topY, cw, ch, 'K', 0);                        // suits already sent home

    const flying = [];
    for (let j = 0; j < COLS; j++) {
      const p = piles[j], x = colX(j);
      let y = tabY;
      for (let i = 0; i < p.backs; i++, y += backLap) back(x, y, cw, ch);
      const runY = y;
      p.run.forEach((c, i) => {
        const cy = runY + i * faceLap;
        if (j === DONE_COL) {
          const q = ease(clamp01((e - (T_RUN + i * 0.1)) / FLY));
          if (q > 0) { flying.push([x + (homeX + pad * 1.6 - x) * q, cy + (topY - cy) * q, c]); return; }
          face(x, cy, cw, ch, c.rank, c.suit, e > T_RUN - 0.6);
          return;
        }
        face(x, cy, cw, ch, c.rank, c.suit);
      });
      const dy = runY + p.run.length * faceLap;
      const d = ease(clamp01((e - (T_DEAL + j * 0.09)) / FLY));  // the new row slides off the stock
      if (d > 0) {
        const c = p.dealt, fx = stockX + (x - stockX) * d, fy = topY + (dy - topY) * d;
        const q = j === DONE_COL ? ease(clamp01((e - (T_RUN + p.run.length * 0.1)) / FLY)) : 0;
        if (q > 0) flying.push([x + (homeX + pad * 1.6 - x) * q, dy + (topY - dy) * q, c]);
        else face(fx, fy, cw, ch, c.rank, c.suit, j === DONE_COL && e > T_RUN - 0.6);
      }
    }
    for (const [x, y, c] of flying) face(x, y, cw, ch, c.rank, c.suit, true);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
