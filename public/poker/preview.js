/* Home-page preview: a video poker machine deals, holds, draws and lights up a winning line. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).poker = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const LINES = ['ROYAL FLUSH', 'FOUR OF A KIND', 'FULL HOUSE', 'FLUSH', 'STRAIGHT'];
  const PAYS = ['4000', '125', '45', '30', '20'];
  // each round: the hand that pays, which of its cards were dealt (held) and which are drawn
  const ROUNDS = [
    { line: 0, cards: [[1, 0], [13, 0], [12, 0], [11, 0], [10, 0]], draw: [2, 4] },
    { line: 1, cards: [[9, 1], [9, 3], [9, 0], [9, 2], [4, 1]], draw: [3, 4] },
    { line: 2, cards: [[12, 2], [12, 3], [7, 1], [7, 0], [7, 2]], draw: [1, 3] },
    { line: 3, cards: [[2, 1], [6, 1], [9, 1], [11, 1], [13, 1]], draw: [1, 4] },
    { line: 4, cards: [[5, 3], [6, 0], [7, 2], [8, 1], [9, 3]], draw: [0, 3] },
  ];
  const DEAL = 0.14, HOLD = 1.35, DRAW = 2.0, PAY = 2.75, CYCLE = 5.2;

  let raf = 0, start = 0, round = 0, junk = [];

  const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
  const rnd = (n) => Math.floor(Math.random() * n);

  function reshuffle() {
    const r = ROUNDS[round];
    junk = r.draw.map(() => [1 + rnd(13), rnd(4)]);   // the losers that get thrown away
  }
  reshuffle();

  function shape(x, y, w, h) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(3, w * 0.12)); }

  function back(x, y, w, h) {
    shape(x, y, w, h);
    ctx.fillStyle = '#1f3fa8'; ctx.fill();
    ctx.strokeStyle = '#f2efe2'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function face(x, y, w, h, rank, suit) {
    shape(x, y, w, h);
    ctx.fillStyle = '#fffef9'; ctx.fill();
    ctx.strokeStyle = '#d8d2bf'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = suit === 1 || suit === 2 ? '#c8102e' : '#1b1b2b';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = `bold ${Math.round(h * 0.25)}px Georgia, serif`;
    ctx.fillText(RANKS[rank], x + w * 0.11, y + h * 0.07);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(h * 0.4)}px Georgia, serif`;
    ctx.fillText(SUITS[suit], x + w * 0.56, y + h * 0.64);
  }

  function draw(now) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!start) start = now;
    let t = (now - start) / 1000;
    if (t > CYCLE) { start = now; t = 0; round = (round + 1) % ROUNDS.length; reshuffle(); }
    const r = ROUNDS[round];

    ctx.fillStyle = '#080e1b';
    ctx.fillRect(0, 0, W, H);

    // pay table strip: the paying line lights up once the hand lands
    const lit = t > PAY;
    const rowH = Math.max(8, H * 0.068), top = H * 0.05;
    ctx.font = `${Math.round(rowH * 0.58)}px ui-monospace, monospace`;
    ctx.textBaseline = 'middle';
    LINES.forEach((name, i) => {
      const y = top + i * rowH;
      const on = lit && i === r.line;
      if (on) {
        ctx.fillStyle = '#4ea8de';
        ctx.fillRect(W * 0.06, y - rowH * 0.42, W * 0.88, rowH * 0.86);
      }
      ctx.fillStyle = on ? '#061018' : i === r.line && t > DRAW ? '#7fbfe8' : '#3d537a';
      ctx.textAlign = 'left';
      ctx.fillText(name, W * 0.08, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = on ? '#061018' : '#7a6a2e';
      ctx.fillText(PAYS[i], W * 0.92, y);
    });

    // the hand
    const gap = Math.max(3, W * 0.018);
    const cw = Math.min((W * 0.9 - gap * 4) / 5, H * 0.27);
    const ch = cw * 1.42;
    const x0 = (W - (cw * 5 + gap * 4)) / 2;
    const cy = top + LINES.length * rowH + H * 0.045;

    for (let i = 0; i < 5; i++) {
      const x = x0 + i * (cw + gap);
      const held = !r.draw.includes(i);
      const k = r.draw.indexOf(i);
      const flipAt = held ? DEAL * i : DRAW + 0.12 * k;         // drawn cards turn again at DRAW
      const spin = clamp01((t - flipAt) / 0.22);          // the card turns over as it lands
      const w = cw * (0.18 + 0.82 * spin);
      const px = x + (cw - w) / 2;
      if (t < DEAL * i) back(x, cy, cw, ch);
      else if (!held && t < DRAW + 0.12 * k) face(x, cy, cw, ch, junk[k][0], junk[k][1]);
      else face(px, cy, w, ch, r.cards[i][0], r.cards[i][1]);

      // HOLD tags on the cards that stay
      if (held && t > HOLD) {
        const ty = cy + ch + Math.max(3, H * 0.02);
        ctx.fillStyle = '#4ea8de';
        ctx.fillRect(x, ty, cw, Math.max(7, H * 0.055));
        ctx.fillStyle = '#061018';
        ctx.font = `${Math.round(Math.max(5, H * 0.04))}px ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('HOLD', x + cw / 2, ty + Math.max(7, H * 0.055) / 2 + 0.5);
      }
    }

    // win banner
    if (lit) {
      const a = clamp01((t - PAY) / 0.3);
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffd23f';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `${Math.round(Math.max(8, H * 0.06))}px ui-monospace, monospace`;
      ctx.fillText(`${LINES[r.line]}  +${PAYS[r.line]}`, W / 2, H - Math.max(4, H * 0.03));
      ctx.globalAlpha = 1;
    }

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
