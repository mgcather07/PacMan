/* Home-page preview: a FreeCell board — everything face up, a card parked in a free cell, aces going home. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).freecell = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const COLS = 8, DEEP = 4, FLY = 0.5, CYCLE = 7;
  let raf = 0, cards = [], start = 0;

  const ease = (k) => k * k * (3 - 2 * k);
  const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);

  // a board mid-game: one card already in a free cell, and three moves to watch
  function build() {
    cards = [];
    cards.push({ rank: 'A', suit: 1, home: { kind: 'cell', i: 0 }, move: { at: 3.6, kind: 'found', i: 1 } });
    cards.push({ rank: RANKS[6 + ((Math.random() * 6) | 0)], suit: 3, home: { kind: 'cell', i: 3 } });
    for (let j = 0; j < COLS; j++) {
      for (let i = 0; i < DEEP; i++) {
        const last = i === DEEP - 1;
        const c = { rank: RANKS[(Math.random() * 13) | 0], suit: (Math.random() * 4) | 0, home: { kind: 'col', j, i } };
        if (last && j === 1) c.move = { at: 0.8, kind: 'cell', i: 2 };
        if (last && j === 5) { c.rank = 'A'; c.suit = 0; c.move = { at: 2.2, kind: 'found', i: 0 }; }
        cards.push(c);
      }
    }
  }

  function shape(x, y, w, h) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w * 0.12)); }

  function slot(x, y, w, h, glyph) {
    shape(x, y, w, h);
    ctx.fillStyle = '#ffffff10'; ctx.fill();
    ctx.strokeStyle = '#ffffff33'; ctx.lineWidth = 1; ctx.stroke();
    if (!glyph) return;
    ctx.fillStyle = '#ffffff2e';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.5)}px Georgia, serif`;
    ctx.fillText(glyph, x + w / 2, y + h * 0.55);
  }

  function face(x, y, w, h, rank, suit) {
    shape(x, y, w, h);
    ctx.fillStyle = '#fffef9'; ctx.fill();
    ctx.strokeStyle = '#d8d2bf'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = suit === 1 || suit === 2 ? '#c8102e' : '#1b1b2b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.28)}px Georgia, serif`;
    ctx.fillText(rank, x + w * 0.11, y + h * 0.07);
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.font = `${Math.round(h * 0.34)}px Georgia, serif`;
    ctx.fillText(SUITS[suit], x + w * 0.9, y + h * 0.42);
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
    g.addColorStop(0, '#1f6f7a'); g.addColorStop(1, '#04222a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    const pad = Math.max(4, W * 0.018);
    let cw = (W - pad * 9) / COLS;
    const ch = Math.min(cw * 1.4, H * 0.26);
    cw = Math.min(cw, ch / 1.34);
    const step = (W - pad * 2 - cw) / (COLS - 1);
    const topY = pad, tabY = pad + ch + pad * 1.6, lap = ch * 0.3;
    const slotX = (i) => pad + i * step;
    const at = (home) => (home.kind === 'col'
      ? [slotX(home.j), tabY + home.i * lap]
      : [slotX(home.kind === 'cell' ? home.i : 4 + home.i), topY]);

    for (let i = 0; i < 4; i++) slot(slotX(i), topY, cw, ch, '');
    for (let i = 0; i < 4; i++) slot(slotX(4 + i), topY, cw, ch, SUITS[i]);

    const flying = [];
    for (const c of cards) {
      const [hx, hy] = at(c.home);
      if (c.move && e > c.move.at) {
        const [tx, ty] = at(c.move);
        const q = ease(clamp01((e - c.move.at) / FLY));
        flying.push([hx + (tx - hx) * q, hy + (ty - hy) * q, c]);
        continue;
      }
      face(hx, hy, cw, ch, c.rank, c.suit);
    }
    for (const [x, y, c] of flying) face(x, y, cw, ch, c.rank, c.suit);
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
