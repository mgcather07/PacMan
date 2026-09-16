(() => {
  'use strict';

  // piles: 0-3 free cells, 4-7 foundations, 8-15 tableau
  const CELLS = [0, 1, 2, 3];
  const FOUNDS = [4, 5, 6, 7];
  const TABS = [8, 9, 10, 11, 12, 13, 14, 15];

  // Microsoft FreeCell deal numbers: card order A♣ A♦ A♥ A♠ 2♣ … with the MS C runtime LCG
  const MS_SUIT = [3, 2, 1, 0]; // clubs, diamonds, hearts, spades -> engine suits ♠♥♦♣
  function msDeal(num) {
    let seed = num >>> 0;
    const rand = () => { seed = (Math.imul(seed, 214013) + 2531011) >>> 0; return (seed >>> 16) & 0x7fff; };
    const deck = [...Array(52).keys()];
    const order = [];
    for (let left = 52; left > 0; left--) {
      const j = rand() % left;
      order.push(deck[j]);
      deck[j] = deck[left - 1];
    }
    return order; // msIndex = rank0 * 4 + msSuit, dealt left-to-right, row by row
  }

  const game = {
    id: 'freecell',
    name: 'FreeCell',
    maxWidth: 1000,

    makeCards() {
      const cards = [];
      for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) cards.push({ suit: MS_SUIT[s], rank: r + 1 });
      return cards;
    },

    deal(cards, { number }) {
      const order = msDeal(number);
      const piles = [];
      for (let i = 0; i < 4; i++) piles.push({ type: 'cell', cards: [] });
      for (let i = 0; i < 4; i++) piles.push({ type: 'found', cards: [] });
      for (let i = 0; i < 8; i++) piles.push({ type: 'tab', cards: [] });
      order.forEach((id, i) => piles[TABS[i % 8]].cards.push(id));
      return { piles, up: Array(52).fill(true), score: 0, moves: 0 };
    },

    leaderboard: () => Daily.board('freecell') || 'freecell',
    // daily challenge: everyone gets the same numbered deal today
    nextOpts: () => ({ number: window.Daily && Daily.active ? 1 + (Daily.seed('freecell') % 1000000) : 1 + Math.floor(Math.random() * 1000000) }),

    layout(width) {
      const gap = Math.max(5, Math.round(width * 0.012));
      const cw = Math.floor(Math.min(104, (width - gap * 9) / 8));
      const ch = Math.round(cw * 1.4);
      const left = Math.round((width - (cw * 8 + gap * 7)) / 2);
      const x = [...Array(8).keys()].map((i) => left + i * (cw + gap));
      const top = gap + 6;
      const tabY = top + ch + gap * 2;
      const piles = [];
      CELLS.forEach((p, i) => piles.push({ x: x[i], y: top, label: '' }));
      FOUNDS.forEach((p, i) => piles.push({ x: x[4 + i], y: top, label: ['♠', '♥', '♦', '♣'][i] }));
      TABS.forEach((p, i) => piles.push({ x: x[i], y: tabY, fan: true }));
      return { cw, ch, top, tabY, piles };
    },

    dealOrigin: (L) => ({ x: L.piles[CELLS[0]].x, y: -L.ch * 1.5 }),

    red(id) { return this.api.red(id); },

    isSequence(S, p, i) {
      const { rank, red } = this.api;
      const c = S.piles[p].cards;
      for (let k = i + 1; k < c.length; k++) {
        if (red(c[k]) === red(c[k - 1]) || rank(c[k]) !== rank(c[k - 1]) - 1) return false;
      }
      return true;
    },

    capacity(S, to) {
      const free = CELLS.filter((p) => !S.piles[p].cards.length).length;
      const empty = TABS.filter((p) => p !== to && !S.piles[p].cards.length).length;
      return (free + 1) * 2 ** empty;
    },

    canPick(S, p, i) {
      const c = S.piles[p].cards;
      if (p < 8) return i === c.length - 1;
      return this.isSequence(S, p, i);
    },

    canDrop(S, from, i, to) {
      const { rank, suit, red, top } = this.api;
      const moving = S.piles[from].cards.slice(i);
      const id = moving[0];
      const dest = S.piles[to].cards;
      if (CELLS.includes(to)) return moving.length === 1 && !dest.length;
      if (FOUNDS.includes(to)) {
        if (moving.length !== 1) return false;
        if (!dest.length) return rank(id) === 1 && this.foundFor(S, suit(id)) === to;
        return suit(top(dest)) === suit(id) && rank(top(dest)) === rank(id) - 1;
      }
      if (moving.length > this.capacity(S, to)) return false;
      if (!dest.length) return true;
      return red(top(dest)) !== red(id) && rank(top(dest)) === rank(id) + 1;
    },

    // foundation pile for a suit: the one already holding it, else the suit's home slot
    foundFor(S, s) {
      const { suit } = this.api;
      const held = FOUNDS.find((p) => S.piles[p].cards.length && suit(S.piles[p].cards[0]) === s);
      if (held !== undefined) return held;
      const home = FOUNDS[s];
      if (!S.piles[home].cards.length) return home;
      return FOUNDS.find((p) => !S.piles[p].cards.length);
    },

    foundRank(S, s) {
      const p = FOUNDS.find((f) => S.piles[f].cards.length && this.api.suit(S.piles[f].cards[0]) === s);
      return p === undefined ? 0 : S.piles[p].cards.length;
    },

    autoTarget(S, from, i) {
      const { suit } = this.api;
      const n = S.piles[from].cards.length - i;
      const id = S.piles[from].cards[i];
      if (n === 1 && !FOUNDS.includes(from)) {
        const f = this.foundFor(S, suit(id));
        if (f !== undefined && this.canDrop(S, from, i, f)) return f;
      }
      const others = TABS.filter((t) => t !== from);
      const onto = others.find((t) => S.piles[t].cards.length && this.canDrop(S, from, i, t));
      if (onto !== undefined) return onto;
      if (!(TABS.includes(from) && i === 0)) {
        const empty = others.find((t) => !S.piles[t].cards.length && this.canDrop(S, from, i, t));
        if (empty !== undefined) return empty;
      }
      if (n === 1 && !CELLS.includes(from)) {
        const cell = CELLS.find((c) => !S.piles[c].cards.length);
        if (cell !== undefined) return cell;
      }
      return -1;
    },

    onMove(S, from, i, to) {
      if (FOUNDS.includes(to) && !FOUNDS.includes(from)) S.score += 10;
      if (FOUNDS.includes(from) && !FOUNDS.includes(to)) S.score = Math.max(0, S.score - 10);
    },

    // Automatically send cards home when no other card could ever need them
    autoStep(S) {
      const { rank, suit, red, top } = this.api;
      for (const p of [...CELLS, ...TABS]) {
        const c = S.piles[p].cards;
        if (!c.length) continue;
        const id = top(c);
        const f = this.foundFor(S, suit(id));
        if (f === undefined || !this.canDrop(S, p, c.length - 1, f)) continue;
        const r = rank(id);
        const oppMin = Math.min(...[0, 1, 2, 3].filter((s) => (s === 1 || s === 2) !== red(id)).map((s) => this.foundRank(S, s)));
        if (r <= 2 || oppMin >= r - 1) return { from: p, i: c.length - 1, to: f };
      }
      return null;
    },

    hint(S) {
      const { rank, top } = this.api;
      const sources = [...TABS, ...CELLS];
      // 1) anything to a foundation
      for (const p of sources) {
        const c = S.piles[p].cards;
        if (!c.length) continue;
        const f = this.foundFor(S, this.api.suit(top(c)));
        if (f !== undefined && this.canDrop(S, p, c.length - 1, f)) return { from: p, i: c.length - 1, to: f };
      }
      // 2) longest sequence onto a non-empty column
      let best = null;
      for (const p of sources) {
        const c = S.piles[p].cards;
        for (let i = 0; i < c.length; i++) {
          if (!this.canPick(S, p, i)) continue;
          for (const t of TABS) {
            if (t === p || !S.piles[t].cards.length) continue;
            if (!this.canDrop(S, p, i, t)) continue;
            const n = c.length - i;
            const clears = TABS.includes(p) && i === 0;
            const score = n + (CELLS.includes(p) ? 3 : 0) + (clears ? 5 : 0);
            // don't suggest shuffling a sequence between two equal parents
            if (TABS.includes(p) && i > 0 && this.api.red(c[i - 1]) !== this.api.red(c[i]) && rank(c[i - 1]) === rank(c[i]) + 1) continue;
            if (!best || score > best.score) best = { from: p, i, to: t, score };
          }
        }
      }
      if (best) return best;
      // 3) free a buried low card using a free cell
      const cell = CELLS.find((c) => !S.piles[c].cards.length);
      if (cell !== undefined) {
        let pick = null;
        for (const t of TABS) {
          const c = S.piles[t].cards;
          if (!c.length) continue;
          const lowest = Math.min(...c.map((id) => rank(id)));
          const depth = c.length - 1 - c.findIndex((id) => rank(id) === lowest);
          if (!pick || depth < pick.depth) pick = { from: t, i: c.length - 1, to: cell, depth };
        }
        if (pick) return pick;
      }
      return null;
    },

    isWon(S) {
      return FOUNDS.every((p) => S.piles[p].cards.length === 13);
    },

    onNewGame(S, { number }) {
      document.getElementById('game-no').textContent = '#' + number;
      try { localStorage.setItem('freecell.last', String(number)); } catch (e) { /* ignore */ }
      if (!(window.Daily && Daily.active)) history.replaceState(null, '', '?game=' + number);
    },

    renderExtra(S) {
      document.getElementById('cells-free').textContent = CELLS.filter((p) => !S.piles[p].cards.length).length;
    },
  };

  const engine = CardEngine(game);
  const fromUrl = parseInt(new URLSearchParams(location.search).get('game'), 10);
  engine.newGame({ number: !(window.Daily && Daily.active) && fromUrl >= 1 && fromUrl <= 1000000 ? fromUrl : game.nextOpts().number });

  document.getElementById('choose-btn').addEventListener('click', () => {
    const v = prompt('Play which game number? (1 – 1,000,000)', engine.opts.number);
    const n = parseInt(v, 10);
    if (n >= 1 && n <= 1000000) engine.newGame({ number: n });
  });
  document.getElementById('restart-btn').addEventListener('click', () => engine.newGame({ number: engine.opts.number }));

})();
