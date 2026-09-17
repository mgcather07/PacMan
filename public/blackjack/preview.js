/* Home-page preview: a hand dealt onto the felt, the hole card flipping over, chips on the line. See docs/ADDING_A_GAME.md. */
(window.ArcadePreviews = window.ArcadePreviews || {}).blackjack = function (canvas) {
  const ctx = canvas.getContext('2d');
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  // a small loop of dealt hands, so the card faces are stable between frames
  const DEALS = [
    { dealer: [10, 17], player: [12, 38] },
    { dealer: [4, 48], player: [0, 22] },
    { dealer: [30, 9], player: [8, 21] },
  ];
  let raf = 0, last = performance.now(), t = 0, round = 0;

  const rankOf = (c) => (c % 13) + 1;
  const suitOf = (c) => Math.floor(c / 13) % 4;

  function card(x, y, w, h, c, flip) {
    const r = Math.max(3, w * 0.09);
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    const s = flip === undefined ? 1 : Math.abs(Math.cos(Math.min(1, flip) * Math.PI));
    ctx.scale(Math.max(0.02, s), 1);
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    const back = flip !== undefined && flip < 0.5;
    if (back) {
      ctx.fillStyle = '#1a2a8f';
      ctx.fill();
      ctx.strokeStyle = '#fbf7ea';
      ctx.lineWidth = Math.max(2, w * 0.09);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe600';
      ctx.fill();
    } else {
      ctx.fillStyle = '#fffef9';
      ctx.fill();
      ctx.strokeStyle = '#d8d2bf';
      ctx.lineWidth = 1;
      ctx.stroke();
      const suit = suitOf(c);
      ctx.fillStyle = suit === 1 || suit === 2 ? '#c8102e' : '#1b1b1b';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.round(w * 0.3)}px Georgia, serif`;
      ctx.fillText(RANKS[rankOf(c)], -w / 2 + w * 0.1, -h / 2 + h * 0.06);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(w * 0.46)}px Georgia, serif`;
      ctx.fillText(SUITS[suit], 0, h * 0.06);
    }
    ctx.restore();
  }

  function chip(x, y, r, fill) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.setLineDash([r * 0.5, r * 0.45]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    if (t > 4.6) { t = 0; round = (round + 1) % DEALS.length; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const felt = ctx.createRadialGradient(W / 2, H * 0.2, 10, W / 2, H * 0.2, Math.max(W, H));
    felt.addColorStop(0, '#1c8a56');
    felt.addColorStop(1, '#0a4029');
    ctx.fillStyle = felt;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffffff22';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(W / 2, -H * 0.25, W * 0.62, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();

    const cw = Math.min(W * 0.17, H * 0.2), ch = cw * 1.4, gap = cw * 0.55;
    const deal = DEALS[round];

    // dealer: two cards, the second face down until the reveal
    const dy = H * 0.12;
    const dx = W / 2 - (cw + gap) / 2;
    if (t > 0.15) card(dx, dy, cw, ch, deal.dealer[0]);
    if (t > 0.45) card(dx + gap, dy, cw, ch, deal.dealer[1], Math.max(0, (t - 3.1) / 0.55));

    // player: two cards, then the chips ride on the outcome
    const py = H * 0.55;
    const px = W / 2 - (cw + gap) / 2;
    if (t > 0.3) card(px, py, cw, ch, deal.player[0]);
    if (t > 0.6) card(px + gap, py, cw, ch, deal.player[1]);

    const cr = Math.max(4, cw * 0.19);
    const chips = ['#d7263d', '#2e8b57', '#1b1b1b'];
    const rise = t > 3.6 ? Math.min(1, (t - 3.6) / 0.6) : 0;
    for (let i = 0; i < chips.length; i++) {
      if (t < 0.9 + i * 0.16) continue;
      chip(W * 0.18, py + ch * 0.62 - i * cr * 0.7 - rise * cr * 1.6, cr, chips[i]);
    }

    // the hand total, shown once both cards have landed
    if (t > 0.8) {
      let total = deal.player.reduce((n, c) => n + Math.min(rankOf(c), 10), 0);
      if (deal.player.some((c) => rankOf(c) === 1) && total + 10 <= 21) total += 10;
      ctx.font = `800 ${Math.round(cw * 0.36)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#00000066';
      const bw = cw * 0.9, bh = cw * 0.5;
      ctx.beginPath();
      ctx.roundRect(W / 2 - bw / 2, py - bh - cw * 0.12, bw, bh, bh / 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(total), W / 2, py - bh / 2 - cw * 0.12);
    }

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
};
