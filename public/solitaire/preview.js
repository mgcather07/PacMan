/* Home-page preview: a Klondike tableau dealing itself, then sending the aces up to the foundations. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).klondike = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const DEAL = 0.085, FLY = 0.3, LIFT = 0.45, CYCLE = 9;
  let raf = 0, cards = [], start = 0;

  const ease = (k) => k * k * (3 - 2 * k);
  const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);

  // one Klondike deal: pile j gets j + 1 cards, the last of them face up
  function build() {
    cards = [];
    let k = 0;
    for (let row = 0; row < 7; row++) {
      for (let col = row; col < 7; col++) {
        cards.push({ col, row, up: row === col, rank: RANKS[(Math.random() * 13) | 0], suit: (Math.random() * 4) | 0, t0: k * DEAL, move: -1 });
        k++;
      }
    }
    const dealt = 27 * DEAL + FLY;
    for (let m = 0; m < 4; m++) {                            // the four aces leave for the foundations
      const col = 6 - m;
      const c = cards.find((x) => x.col === col && x.row === col);
      c.rank = 'A'; c.suit = m; c.move = dealt + 0.3 + m * 0.8;
    }
  }

  function shape(x, y, w, h) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w * 0.12)); }

  function slot(x, y, w, h) {
    shape(x, y, w, h);
    ctx.fillStyle = '#ffffff12'; ctx.fill();
    ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 1; ctx.stroke();
  }

  function back(x, y, w, h) {
    shape(x, y, w, h);
    ctx.fillStyle = '#1f3fa8'; ctx.fill();
    ctx.strokeStyle = '#f2efe2'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.strokeStyle = '#ffffff33';
    for (let d = -h; d < w; d += Math.max(5, w * 0.18)) { ctx.beginPath(); ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); ctx.stroke(); }
    ctx.restore();
  }

  function face(x, y, w, h, rank, suit) {
    shape(x, y, w, h);
    ctx.fillStyle = '#fffef9'; ctx.fill();
    ctx.strokeStyle = '#d8d2bf'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = suit === 1 || suit === 2 ? '#c8102e' : '#1b1b2b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.26)}px Georgia, serif`;
    ctx.fillText(rank, x + w * 0.1, y + h * 0.08);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.42)}px Georgia, serif`;
    ctx.fillText(SUITS[suit], x + w * 0.58, y + h * 0.62);
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const t = now / 1000;
    if (!cards.length) { build(); start = t; }
    if (t - start > CYCLE) { build(); start = t; }
    const e = t - start;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createRadialGradient(W / 2, 0, 10, W / 2, H, H * 1.2);
    g.addColorStop(0, '#1f7a4d'); g.addColorStop(1, '#093823');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = Math.max(5, W * 0.025);
    let cw = (W - pad * 8) / 7;
    const ch = Math.min(cw * 1.42, H * 0.25);
    cw = Math.min(cw, ch / 1.35);
    const step = (W - pad * 2 - cw) / 6, overlap = ch * 0.24;
    const topY = pad, tabY = pad + ch + pad * 0.9;
    const colX = (j) => pad + j * step;
    const foundX = (i) => W - pad - cw - (3 - i) * (cw + pad * 0.5);

    back(pad, topY, cw, ch);                                  // stock
    for (let i = 0; i < 4; i++) slot(foundX(i), topY, cw, ch);

    const flying = [];
    for (const c of cards) {
      if (e < c.t0) continue;
      const tx = colX(c.col), ty = tabY + c.row * overlap;
      const p = ease(clamp01((e - c.t0) / FLY));
      let x = pad + (tx - pad) * p, y = topY + (ty - topY) * p;
      if (c.move >= 0 && e > c.move) {
        const q = ease(clamp01((e - c.move) / LIFT));
        x = tx + (foundX(c.suit) - tx) * q; y = ty + (topY - ty) * q;
        flying.push([x, y, c]);
        continue;
      }
      if (p < 1 || !c.up) back(x, y, cw, ch); else face(x, y, cw, ch, c.rank, c.suit);
    }
    for (const [x, y, c] of flying) face(x, y, cw, ch, c.rank, c.suit);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
