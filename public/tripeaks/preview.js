/* Home-page preview: three peaks shedding a chain of cards onto the waste, streak climbing. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).tripeaks = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const ROWS = [
    [1.5, 4.5, 7.5],
    [1, 2, 4, 5, 7, 8],
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  ];
  const SLOTS = [];
  ROWS.forEach((xs, row) => xs.forEach((col) => SLOTS.push({ row, col })));
  const COVERS = SLOTS.map((s) =>
    SLOTS.reduce((acc, o, j) => (o.row === s.row - 1 && Math.abs(o.col - s.col) === 0.5 ? acc.concat(j) : acc), []));
  // lower rows first, left to right, so each card overlaps the one below and to its left
  const DRAW = SLOTS.map((s, i) => i).sort((a, b) => SLOTS[b].row - SLOTS[a].row || SLOTS[a].col - SLOTS[b].col);
  const K = 0.62, RS = 0.5, STEP = 0.4, FLY = 0.3, CHAIN = 13, CYCLE = CHAIN * STEP + 2;

  let raf = 0, cards = [], chain = [], first = null, start = 0;
  const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
  const ease = (k) => k * k * (3 - 2 * k);
  const rnd = (n) => (Math.random() * n) | 0;

  // one deal, plus the order a player would take the first few cards in — always one rank apart
  function build() {
    const gone = new Array(28).fill(false);
    const order = [];
    for (let n = 0; n < 28; n++) {
      const open = [];
      for (let i = 0; i < 28; i++) if (!gone[i] && COVERS[i].every((c) => gone[c])) open.push(i);
      const pick = open[rnd(open.length)];
      gone[pick] = true;
      order.push(pick);
    }
    cards = SLOTS.map(() => ({ rank: 1 + rnd(13), suit: rnd(4), out: -1 }));
    chain = order.slice(0, CHAIN);
    let cur = 1 + rnd(13);
    first = { rank: cur, suit: rnd(4) };
    chain.forEach((slot, n) => {
      cur = Math.random() < 0.5 ? (cur === 1 ? 13 : cur - 1) : (cur === 13 ? 1 : cur + 1);
      cards[slot].rank = cur;
      cards[slot].suit = rnd(4);
      cards[slot].out = n * STEP;
    });
  }

  function shape(x, y, w, h) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w * 0.1)); }

  function back(x, y, w, h) {
    shape(x, y, w, h);
    ctx.fillStyle = '#1f3fa8'; ctx.fill();
    ctx.strokeStyle = '#f2efe2'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function face(x, y, w, h, c, glow) {
    if (glow) { ctx.save(); ctx.shadowColor = '#7ec8e3'; ctx.shadowBlur = w * 0.35; }
    shape(x, y, w, h);
    ctx.fillStyle = '#fffef9'; ctx.fill();
    ctx.strokeStyle = '#d8d2bf'; ctx.lineWidth = 1; ctx.stroke();
    if (glow) ctx.restore();
    ctx.fillStyle = c.suit === 1 || c.suit === 2 ? '#c8102e' : '#1b1b2b';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.34)}px Georgia, serif`;
    ctx.fillText(SUITS[c.suit], x + w * 0.62, y + h * 0.4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';       // the peaks overlap, so the index sits bottom-left
    ctx.font = `bold ${Math.round(h * 0.24)}px Georgia, serif`;
    ctx.fillText(RANKS[c.rank], x + w * 0.1, y + h * 0.94);
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    if (!cards.length || t - start > CYCLE) { build(); start = t; }
    const e = t - start;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(W / 2, 0, 10, W / 2, H, H * 1.2);
    g.addColorStop(0, '#1b6f7a'); g.addColorStop(1, '#082c22');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = 7;
    const cw = Math.min((W - pad * 2) / (9 * K + 1), (H - pad) / 5.24);
    const ch = cw * 1.4;
    const left = (W - (9 * K * cw + cw)) / 2;
    const topY = pad;
    const baseY = topY + 3 * RS * ch + ch + ch * 0.22;
    const stockX = W / 2 - cw * 1.44, wasteX = W / 2 - cw * 0.04;

    // the waste: the starting card, then everything that has landed on it
    const landed = [first];
    let flying = null, streak = 0, next = -1;
    for (let n = 0; n < chain.length; n++) {
      const slot = chain[n], c = cards[slot];
      const p = clamp01((e - c.out) / FLY);
      if (p <= 0) { next = slot; break; }
      if (p < 1) { flying = { slot, c, p }; streak = n + 1; break; }
      landed.push(c);
      streak = n + 1;
    }

    for (const i of DRAW) {
      const s = SLOTS[i], c = cards[i];
      if (c.out >= 0 && e >= c.out) continue;
      face(left + s.col * K * cw, topY + s.row * RS * ch, cw, ch, c, i === next);
    }

    back(stockX - 2, baseY - 2, cw, ch);
    back(stockX, baseY, cw, ch);
    landed.slice(-4).forEach((c, n) => face(wasteX + n * cw * 0.16, baseY, cw, ch, c));
    if (flying) {
      const s = SLOTS[flying.slot], q = ease(flying.p);
      const x0 = left + s.col * K * cw, y0 = topY + s.row * RS * ch;
      const x1 = wasteX + Math.min(3, landed.length) * cw * 0.16;
      face(x0 + (x1 - x0) * q, y0 + (baseY - y0) * q - Math.sin(q * Math.PI) * ch * 0.22, cw, ch, flying.c);
    }

    if (streak > 1) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `800 ${Math.round(Math.min(cw * 0.95, 14 + streak * 1.6))}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#ffe600';
      ctx.fillText('×' + streak, wasteX + cw * 1.1, baseY - ch * 0.18);
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
