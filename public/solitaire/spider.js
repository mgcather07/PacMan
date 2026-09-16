(() => {
  'use strict';

  // piles: 0-9 tableau, 10-17 completed runs, 18 stock
  const TAB = 10, FOUND = 8;
  const STOCK = TAB + FOUND;
  const tabs = [...Array(TAB).keys()];
  const founds = [...Array(FOUND).keys()].map((i) => TAB + i);

  const game = {
    id: 'spider',
    name: 'Spider',
    maxWidth: 1150,

    makeCards({ suits }) {
      const suitSet = suits === 1 ? [0] : suits === 2 ? [0, 1] : [0, 1, 2, 3];
      const cards = [];
      for (let d = 0; d < 8 / suitSet.length; d++) for (const s of suitSet) for (let r = 1; r <= 13; r++) cards.push({ suit: s, rank: r });
      return cards;
    },

    variantKey: ({ suits }) => '.' + suits,
    leaderboard: ({ suits }) => Daily.board('spider') || `spider-${suits}`,

    deal(cards) {
      const deck = cards.map((_, i) => i);
      const shuffleRandom = window.Daily && Daily.active ? Daily.rng('spider') : Math.random;
      for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(shuffleRandom() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const piles = [];
      for (let c = 0; c < TAB; c++) piles.push({ type: 'tab', cards: deck.splice(0, c < 4 ? 6 : 5) });
      for (let f = 0; f < FOUND; f++) piles.push({ type: 'found', cards: [] });
      piles.push({ type: 'stock', cards: deck });
      const up = Array(cards.length).fill(false);
      return { piles, up, score: 500, moves: 0 };
    },

    layout(width) {
      const gap = Math.max(4, Math.round(width * 0.009));
      const cw = Math.floor(Math.min(100, (width - gap * (TAB + 1)) / TAB));
      const ch = Math.round(cw * 1.4);
      const left = Math.round((width - (cw * TAB + gap * (TAB - 1))) / 2);
      const x = tabs.map((i) => left + i * (cw + gap));
      const top = gap + 6;
      const tabY = top + ch + gap * 2;
      const piles = [];
      tabs.forEach((i) => piles.push({ x: x[i], y: tabY, fan: true }));
      founds.forEach((p, i) => piles.push({ x: x[0] + i * Math.round(cw * 0.3), y: top, label: i === 0 ? '♠' : '', hideSlot: i > 0 }));
      piles.push({ x: x[TAB - 1], y: top, clickable: true, groupEvery: 10 });
      return { cw, ch, top, tabY, piles };
    },

    dealOrigin: (L) => ({ x: L.piles[STOCK].x, y: L.piles[STOCK].y }),

    // a run of face-up cards, same suit, descending
    isRun(S, p, i) {
      const { rank, suit } = this.api;
      const c = S.piles[p].cards;
      if (!S.up[c[i]]) return false;
      for (let k = i + 1; k < c.length; k++) {
        if (suit(c[k]) !== suit(c[i]) || rank(c[k]) !== rank(c[k - 1]) - 1) return false;
      }
      return true;
    },

    canPick(S, p, i) {
      return p < TAB && this.isRun(S, p, i);
    },

    canDrop(S, from, i, to) {
      if (to >= TAB) return false;
      const dest = S.piles[to].cards;
      if (!dest.length) return true;
      const { rank, top } = this.api;
      return rank(top(dest)) === rank(S.piles[from].cards[i]) + 1;
    },

    autoTarget(S, from, i) {
      const { rank, suit, top } = this.api;
      const id = S.piles[from].cards[i];
      const order = tabs.filter((t) => t !== from);
      const sameSuit = order.find((t) => { const d = S.piles[t].cards; return d.length && rank(top(d)) === rank(id) + 1 && suit(top(d)) === suit(id); });
      if (sameSuit !== undefined) return sameSuit;
      const any = order.find((t) => { const d = S.piles[t].cards; return d.length && rank(top(d)) === rank(id) + 1; });
      if (any !== undefined) return any;
      if (i > 0) { const empty = order.find((t) => !S.piles[t].cards.length); if (empty !== undefined) return empty; }
      return -1;
    },

    onMove(S, from, i, to) {
      if (to < TAB) S.score = Math.max(0, S.score - 1);
    },

    clickPile(S, p, api) {
      if (p !== STOCK || !S.piles[STOCK].cards.length) return false;
      if (tabs.some((t) => !S.piles[t].cards.length)) {
        api.toast('Fill every column before dealing more cards');
        return false;
      }
      for (const t of tabs) {
        const id = S.piles[STOCK].cards.pop();
        S.up[id] = true;
        S.piles[t].cards.push(id);
      }
      S.score = Math.max(0, S.score - 1);
      return true;
    },

    settle(S) {
      for (const t of tabs) {
        const c = S.piles[t].cards;
        if (c.length && !S.up[c[c.length - 1]]) S.up[c[c.length - 1]] = true;
      }
    },

    autoStep(S) {
      const { rank } = this.api;
      for (const t of tabs) {
        const c = S.piles[t].cards;
        if (c.length < 13) continue;
        const i = c.length - 13;
        if (rank(c[i]) === 13 && this.isRun(S, t, i)) {
          const f = founds.find((p) => !S.piles[p].cards.length);
          S.score += 100;
          return { from: t, i, to: f };
        }
      }
      return null;
    },

    hint(S) {
      const { rank, suit, top } = this.api;
      let fallback = null;
      for (const t of tabs) {
        const c = S.piles[t].cards;
        if (!c.length) continue;
        let i = c.length - 1;
        while (i > 0 && this.isRun(S, t, i - 1)) i--;
        const id = c[i];
        for (const d of tabs) {
          if (d === t) continue;
          const dest = S.piles[d].cards;
          if (!dest.length) continue;
          if (rank(top(dest)) !== rank(id) + 1) continue;
          const onSuit = suit(top(dest)) === suit(id);
          const reveals = i > 0 && !S.up[c[i - 1]];
          const breaksRun = i > 0 && S.up[c[i - 1]] && rank(c[i - 1]) === rank(id) + 1 && suit(c[i - 1]) === suit(id);
          if (breaksRun) continue;
          if (onSuit || reveals || i === 0) return { from: t, i, to: d };
          if (!fallback && !(i > 0 && S.up[c[i - 1]] && rank(c[i - 1]) === rank(id) + 1)) fallback = { from: t, i, to: d };
        }
      }
      if (fallback) return fallback;
      const empty = tabs.find((t) => !S.piles[t].cards.length);
      if (empty !== undefined) {
        const src = tabs.find((t) => S.piles[t].cards.length > 1);
        if (src !== undefined) {
          const c = S.piles[src].cards;
          let i = c.length - 1;
          while (i > 0 && this.isRun(S, src, i - 1)) i--;
          if (i > 0) return { from: src, i, to: empty };
        }
      }
      if (S.piles[STOCK].cards.length) return { pile: STOCK };
      return null;
    },

    isWon(S) {
      return founds.every((p) => S.piles[p].cards.length === 13);
    },

    renderExtra(S) {
      const left = S.piles[STOCK].cards.length / 10;
      document.getElementById('deals').textContent = left;
    },
  };

  const engine = CardEngine(game);
  const sel = document.getElementById('variant');
  let suits = 1;
  try { suits = +localStorage.getItem('spider.suits') || 1; } catch (e) { /* ignore */ }
  if (window.Daily && Daily.active) suits = 1; // daily deal is always 1 suit
  sel.value = String(suits);
  sel.addEventListener('change', () => {
    suits = +sel.value;
    try { localStorage.setItem('spider.suits', String(suits)); } catch (e) { /* ignore */ }
    sel.blur();
    engine.newGame({ suits });
  });
  engine.newGame({ suits });
})();
