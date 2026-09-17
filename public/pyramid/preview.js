/* Home-page preview: a small pyramid deals itself, then pairs that add to 13 fly off it. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).pyramid = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const ROWS = 4, DEAL = 0.07, FLY = 0.32, PAIR = 0.5, CYCLE = 6.4;
  let raf = 0, cards = [], start = 0;

  const ease = (k) => k * k * (3 - 2 * k);
  const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
  const pick = () => 1 + Math.floor(Math.random() * 12);
  const suit = () => Math.floor(Math.random() * 4);

  // Build a pyramid that can always be cleared: each row comes off as a pair (or a lone king)
  function build() {
    const a = pick(), b = pick(), c = pick(), d = pick();
    const ranks = [[13], [d, 13 - d], [c, 13 - c, 13], [a, 13 - a, b, 13 - b]];
    const order = [[3, 0], [3, 1], [3, 2], [3, 3], [2, 0], [2, 1], [2, 2], [1, 0], [1, 1], [0, 0]];
    const goAt = {};
    const dealt = 10 * DEAL + FLY;
    [[0, 1], [2, 3], [4, 5], [6], [7, 8], [9]].forEach((group, g) => {
      group.forEach((k) => { goAt[order[k]] = dealt + 0.45 + g * PAIR; });
    });
    cards = [];
    let k = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col <= r; col++) {
        cards.push({ r, col, rank: ranks[r][col], suit: suit(), t0: k * DEAL, go: goAt[[r, col]] });
        k++;
      }
    }
  }

  function shape(x, y, w, h) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w * 0.12)); }

  function back(x, y, w, h) {
    shape(x, y, w, h);
    ctx.fillStyle = '#1f3fa8'; ctx.fill();
    ctx.strokeStyle = '#f2efe2'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function face(x, y, w, h, rank, st, glow) {
    if (glow) {
      shape(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = '#e8c07d'; ctx.fill();
    }
    shape(x, y, w, h);
    ctx.fillStyle = '#fffef9'; ctx.fill();
    ctx.strokeStyle = '#d8d2bf'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = st === 1 || st === 2 ? '#c8102e' : '#1b1b2b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.26)}px Georgia, serif`;
    ctx.fillText(RANKS[rank], x + w * 0.1, y + h * 0.08);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.42)}px Georgia, serif`;
    ctx.fillText(SUITS[st], x + w * 0.58, y + h * 0.62);
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
    g.addColorStop(0, '#1f7a4d'); g.addColorStop(1, '#093823');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = Math.max(6, W * 0.03);
    let ch = (H - pad * 2) / 2.6;                           // three half-rows plus a whole card
    let cw = ch / 1.4;
    const gap = Math.max(2, cw * 0.06);
    const maxW = (W - pad * 2 - gap * 3) / 4.6;             // leave room for the discard pile
    if (cw > maxW) { cw = maxW; ch = cw * 1.4; }
    const stepX = cw + gap, rowStep = ch * 0.52;
    const pyrW = cw * ROWS + gap * (ROWS - 1);
    const left = (W - pyrW) / 2 - cw * 0.35;
    const top = pad;
    const stockX = W - pad - cw, stockY = H - pad - ch;
    const posX = (c) => left + (c.col + (ROWS - 1 - c.r) / 2) * stepX;
    const posY = (c) => top + c.r * rowStep;

    back(stockX, stockY, cw, ch);                           // the stock the deal comes from
    const flying = [];
    for (const c of cards) {
      if (e < c.t0) continue;
      const tx = posX(c), ty = posY(c);
      const p = ease(clamp01((e - c.t0) / FLY));
      const x = stockX + (tx - stockX) * p, y = stockY + (ty - stockY) * p;
      if (e > c.go) {
        const q = ease(clamp01((e - c.go) / FLY));
        flying.push({ c, x: tx + (stockX - tx) * q, y: ty + (stockY - ty) * q, a: 1 - q * 0.85, glow: q < 0.25 });
        continue;
      }
      face(x, y, cw, ch, c.rank, c.suit, e > c.go - 0.18);
    }
    for (const f of flying) {
      ctx.globalAlpha = f.a;
      face(f.x, f.y, cw, ch, f.c.rank, f.c.suit, f.glow);
      ctx.globalAlpha = 1;
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
