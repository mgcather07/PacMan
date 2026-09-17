/*
 * Pyramid — pair exposed cards that add to 13 (A=1, J=11, Q=12, K=13 alone) until the pyramid is gone.
 *   Infinite (/pyramid/)              deal after deal, one running score, stock passes tighten 3 → 2 → 1
 *   Classic  (/pyramid/?mode=classic) one solvable deal, three passes, ranked by the fastest clear
 *   Daily    (/pyramid/?daily=…)      the same solvable deal for everyone, from Daily.rng('pyramid')
 * The table, card faces and toolbar come from /solitaire/style.css so it matches the other card games.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const board = $('board');

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const suitOf = (id) => Math.floor(id / 13);
  const rankOf = (id) => (id % 13) + 1;
  const isRed = (id) => suitOf(id) === 1 || suitOf(id) === 2;

  const DAILY = !!(window.Daily && Daily.active);
  const SINGLE = Arcade.classic || DAILY;              // one deal, ranked by fastest win
  const BOARD = (window.Daily && Daily.board('pyramid')) || (Arcade.classic ? 'pyramid-classic' : 'pyramid');
  const Sound = Arcade.Sound;

  // Slot i of the pyramid sits at row ROW[i], column COL[i]; the cards covering it are i+ROW[i]+1 and +2
  const SLOTS = 28;
  const ROW = [], COL = [];
  for (let r = 0, i = 0; r < 7; r++) for (let c = 0; c <= r; c++, i++) { ROW[i] = r; COL[i] = c; }
  const passesFor = (dealNo) => (SINGLE ? 3 : dealNo <= 2 ? 3 : dealNo <= 4 ? 2 : 1);

  let S = null;            // serialisable state: everything undo needs to restore
  let history = [];
  let sel = null;          // { k: 'pyr', i } | { k: 'waste' }
  let L = null;
  let drag = null;
  let state = 'title';     // 'title' | 'play' | 'over'
  let paused = false, busy = false;
  let elapsed = 0, dealStart = 0, timerOn = false, lastTick = 0;
  let playCounted = false;
  let runToken = 0;        // a deal's pending timeouts are dropped if a new deal has started
  let rnd = Math.random;

  // ---------------------------------------------------------------------------
  // DOM: 52 persistent card elements + the three piles below the pyramid
  // ---------------------------------------------------------------------------
  const cardEls = [];
  for (let id = 0; id < 52; id++) {
    const r = rankOf(id), s = SUITS[suitOf(id)];
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    const center = r > 10 ? `<div class="pip court">${RANKS[r]}<i>${s}</i></div>` : `<div class="pip">${s}</div>`;
    el.innerHTML = `<div class="inner">
      <div class="face ${isRed(id) ? 'red' : ''}">
        <div class="corner tl"><span class="r">${RANKS[r]}</span><span class="s">${s}</span></div>
        ${center}
        <div class="corner br"><span class="r">${RANKS[r]}</span><span class="s">${s}</span></div>
      </div>
      <div class="back"></div>
    </div>`;
    board.appendChild(el);
    cardEls.push(el);
  }
  const mkSlot = (cls) => {
    const d = document.createElement('div');
    d.className = 'slot ' + cls;
    board.insertBefore(d, board.firstChild);
    return d;
  };
  const stockSlot = mkSlot('stock');
  const wasteSlot = mkSlot('waste');
  const discardSlot = mkSlot('discard');

  // ---------------------------------------------------------------------------
  // Deals
  // ---------------------------------------------------------------------------
  function shuffled(random) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // Depth-first search with a node budget: deterministic, so seeded deals stay identical everywhere.
  function isSolvable(pyr0, cycle0, maxPasses, budget = 40000) {
    let nodes = 0;
    const seen = new Set();
    function rec(pyr, cycle, p, passes) {
      let mask = 0;
      for (let i = 0; i < SLOTS; i++) if (pyr[i] >= 0) mask |= 1 << i;
      if (!mask) return true;
      if (++nodes > budget) return false;
      const key = mask + '|' + cycle.join(',') + '|' + p + '|' + passes;
      if (seen.has(key)) return false;
      seen.add(key);
      const ex = [];
      for (let i = 0; i < SLOTS; i++) {
        if (pyr[i] < 0) continue;
        if (ROW[i] === 6 || (pyr[i + ROW[i] + 1] < 0 && pyr[i + ROW[i] + 2] < 0)) ex.push(i);
      }
      const wasteId = p > 0 ? cycle[p - 1] : -1;
      // kings only ever come off alone, so taking one is never a mistake
      for (const i of ex) if (rankOf(pyr[i]) === 13) { const n = pyr.slice(); n[i] = -1; return rec(n, cycle, p, passes); }
      if (wasteId >= 0 && rankOf(wasteId) === 13) { const c = cycle.slice(); c.splice(p - 1, 1); return rec(pyr, c, p - 1, passes); }
      for (let a = 0; a < ex.length; a++) {
        for (let b = a + 1; b < ex.length; b++) {
          if (rankOf(pyr[ex[a]]) + rankOf(pyr[ex[b]]) !== 13) continue;
          const n = pyr.slice(); n[ex[a]] = -1; n[ex[b]] = -1;
          if (rec(n, cycle, p, passes)) return true;
        }
      }
      if (wasteId >= 0) {
        for (const i of ex) {
          if (rankOf(pyr[i]) + rankOf(wasteId) !== 13) continue;
          const n = pyr.slice(); n[i] = -1;
          const c = cycle.slice(); c.splice(p - 1, 1);
          if (rec(n, c, p - 1, passes)) return true;
        }
      }
      if (p < cycle.length && rec(pyr, cycle, p + 1, passes)) return true;
      if (p >= cycle.length && passes > 1 && cycle.length && rec(pyr, cycle, 0, passes - 1)) return true;
      return false;
    }
    return rec(pyr0.slice(), cycle0.slice(), 0, maxPasses);
  }

  function makeDeal(dealNo) {
    const passes = passesFor(dealNo);
    let deck = shuffled(rnd);
    // Classic and the Daily must be winnable; so are Infinite's opening deals — once the stock
    // tightens to two passes the deals are honest random ones, and that is what ends a run.
    if (SINGLE || passes >= 3) {
      for (let t = 0; t < 30; t++) {
        if (isSolvable(deck.slice(0, SLOTS), deck.slice(SLOTS), passes)) break;
        deck = shuffled(rnd);
      }
    }
    return { pyr: deck.slice(0, SLOTS), cycle: deck.slice(SLOTS), p: 0, passes, removed: [], dealNo, moves: 0 };
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  const covered = (i) => ROW[i] < 6 && (S.pyr[i + ROW[i] + 1] >= 0 || S.pyr[i + ROW[i] + 2] >= 0);
  const exposed = (i) => S.pyr[i] >= 0 && !covered(i);
  const wasteTop = () => (S.p > 0 ? S.cycle[S.p - 1] : -1);
  const cardsLeft = () => S.pyr.reduce((n, v) => n + (v >= 0 ? 1 : 0), 0);
  const canRecycle = () => S.p >= S.cycle.length && S.passes > 1 && S.cycle.length > 0;

  function playable() {
    const list = [];
    for (let i = 0; i < SLOTS; i++) if (exposed(i)) list.push({ k: 'pyr', i, id: S.pyr[i] });
    if (S.p > 0) list.push({ k: 'waste', id: wasteTop() });
    return list;
  }

  const idOf = (ref) => (ref.k === 'pyr' ? S.pyr[ref.i] : wasteTop());
  const sameRef = (a, b) => !!a && !!b && a.k === b.k && (a.k !== 'pyr' || a.i === b.i);
  const isPlayable = (ref) => (ref.k === 'pyr' ? exposed(ref.i) : ref.k === 'waste' && S.p > 0);

  // The move a hint points at: pyramid pairs first (they unlock the most), then the waste, then kings.
  function findMove() {
    const P = playable();
    const pairs = [];
    for (let a = 0; a < P.length; a++) {
      for (let b = a + 1; b < P.length; b++) {
        if (rankOf(P[a].id) + rankOf(P[b].id) === 13) pairs.push({ a: P[a], b: P[b] });
      }
    }
    const both = pairs.find((m) => m.a.k === 'pyr' && m.b.k === 'pyr');
    if (both) return both;
    const king = P.find((c) => rankOf(c.id) === 13 && c.k === 'pyr');
    if (king) return { a: king };
    if (pairs.length) return pairs[0];
    const wasteKing = P.find((c) => rankOf(c.id) === 13);
    if (wasteKing) return { a: wasteKing };
    return null;
  }
  const anyMove = () => !!findMove() || S.p < S.cycle.length || canRecycle();

  // ---------------------------------------------------------------------------
  // Moves
  // ---------------------------------------------------------------------------
  const snapshot = () => JSON.stringify(S);
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 400) history.shift();
  }
  function undo() {
    if (!history.length || busy || paused || state !== 'play') return;
    S = JSON.parse(history.pop());
    sel = null;
    S.moves++;
    render();
  }

  function startTimer() {
    if (!timerOn && state === 'play' && !paused) { timerOn = true; lastTick = performance.now(); }
    // the first move is what counts as playing this deal
    if (!playCounted && window.Leaderboard) { playCounted = true; Leaderboard.played(BOARD); }
  }

  function take(refs) {
    pushHistory();
    startTimer();
    for (const r of refs) {
      if (r.k === 'pyr') { S.removed.push(S.pyr[r.i]); S.pyr[r.i] = -1; }
      else { S.removed.push(S.cycle[S.p - 1]); S.cycle.splice(S.p - 1, 1); S.p--; }
    }
    S.score += 100;
    S.pairs = (S.pairs || 0) + 1;
    S.moves++;
    sel = null;
    if (refs.length === 1) Sound.arp([523, 784, 1046], 0.07, 'square', 0.04);
    else Sound.tone(660, 990, 0.12, 'square', 0.035);
    render();
    afterMove();
  }

  function tryPair(a, b) {
    if (state !== 'play' || busy || paused) return false;
    if (!isPlayable(a)) return false;
    if (!b) {
      if (rankOf(idOf(a)) !== 13) return false;
      take([a]);
      return true;
    }
    if (!isPlayable(b) || sameRef(a, b)) return false;
    if (rankOf(idOf(a)) + rankOf(idOf(b)) !== 13) return false;
    take([a, b]);
    return true;
  }

  function drawStock() {
    if (state !== 'play' || busy || paused) return;
    if (S.p < S.cycle.length) {
      pushHistory();
      startTimer();
      S.p++;
      S.moves++;
      sel = null;
      Sound.tone(420, 300, 0.06, 'triangle', 0.03);
      render();
      afterMove();
    } else if (canRecycle()) {
      pushHistory();
      startTimer();
      S.p = 0;
      S.passes--;
      S.moves++;
      sel = null;
      Sound.tone(300, 520, 0.16, 'triangle', 0.03);
      Arcade.toast(S.passes > 1 ? `${S.passes} passes left` : 'Last pass through the stock');
      render();
      afterMove();
    } else {
      Sound.tone(180, 120, 0.12, 'sawtooth', 0.03);
      Arcade.toast('No passes left — the stock is closed');
    }
  }

  function afterMove() {
    if (!cardsLeft()) { clearDeal(); return; }
    if (!anyMove()) {
      busy = true;
      const tok = runToken;
      setTimeout(() => {
        if (tok !== runToken) return;
        busy = false;
        if (state === 'play' && !anyMove()) endRun(false, SINGLE ? 'No moves left — the pyramid held.' : '');
      }, 550);
    }
  }

  function clearDeal() {
    const secs = Math.max(0, elapsed - dealStart);
    const bonus = Math.max(0, Math.round(400 - secs * 4));
    S.score += 500 + bonus;
    S.deals++;
    Sound.arp([523, 659, 784, 1046], 0.09, 'square', 0.05);
    render();
    if (SINGLE) { endRun(true, `Cleared in ${fmt(elapsed)}`); return; }
    Arcade.toast(`Pyramid cleared!  +${500 + bonus}`);
    busy = true;
    const tok = runToken;
    setTimeout(() => { if (tok !== runToken) return; busy = false; nextDeal(); }, 900);
  }

  function nextDeal() {
    runToken++;
    const carry = { score: S.score, pairs: S.pairs, deals: S.deals };
    S = Object.assign(makeDeal(S.dealNo + 1), carry);
    history = [];
    sel = null;
    dealStart = elapsed;
    dealAnimation();
    Arcade.toast(S.passes > 1 ? `Deal ${S.dealNo} · ${S.passes} stock passes` : `Deal ${S.dealNo} · one stock pass only`);
  }

  // ---------------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------------
  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    $('over').classList.remove('won');
    $('paused').hidden = true;
    state = 'play';
    paused = false;
    busy = false;
    elapsed = 0;
    dealStart = 0;
    timerOn = false;
    playCounted = false;
    history = [];
    sel = null;
    runToken++;
    rnd = DAILY ? Daily.rng('pyramid') : Math.random;
    S = Object.assign(makeDeal(1), { score: 0, pairs: 0, deals: 0 });
    dealAnimation();
    // the deal happens before the player acts, so the play is counted on the first move
    if (window.Leaderboard) Leaderboard.startRun(BOARD, { play: false });
  }

  function dealAnimation() {
    L = layout();
    cardEls.forEach((el) => {
      el.classList.add('no-anim');
      el.classList.remove('sel');
      el.style.left = L.stock.x + 'px';
      el.style.top = L.stock.y + 'px';
    });
    void board.offsetWidth;
    cardEls.forEach((el) => el.classList.remove('no-anim'));
    Sound.noise(0.22, 0.04, 0, 900);
    render();
  }

  function endRun(won, message) {
    if (state === 'over') return;
    state = 'over';
    timerOn = false;
    sel = null;
    render();
    $('o-score').textContent = S.score.toLocaleString();
    $('o-deals').textContent = S.deals;
    $('o-pairs').textContent = S.pairs || 0;
    $('o-time').textContent = fmt(elapsed);
    Arcade.endScreen(won, message);
    if (!won) Sound.tone(400, 110, 0.5, 'sawtooth', 0.045);
    $('over').hidden = false;
    if (window.Leaderboard) {
      Leaderboard.offer(BOARD, { score: S.score, time: elapsed, won: !!won }, $('over').querySelector('.panel'));
    }
  }

  function pause(on) {
    if (state !== 'play') return;
    paused = on;
    $('paused').hidden = !on;
    if (on) timerOn = false;
    else if (S.moves) { timerOn = true; lastTick = performance.now(); }
  }

  // ---------------------------------------------------------------------------
  // Layout & render
  // ---------------------------------------------------------------------------
  function layout() {
    const W = Math.min(window.innerWidth, 1000);
    const pad = Math.max(6, Math.round(W * 0.012));
    const gap = Math.max(2, Math.round(W * 0.006));
    const barH = document.querySelector('.bar').offsetHeight;
    const availH = Math.max(340, window.innerHeight - barH - 16);
    const byWidth = (W - pad * 2 - gap * 6) / 7;
    const byHeight = (availH - gap * 5 - 24) / 7.2;      // six half-rows + two full cards
    const cw = Math.max(34, Math.floor(Math.min(96, byWidth, byHeight)));
    const ch = Math.round(cw * 1.4);
    const stepX = cw + gap;
    const rowStep = Math.round(ch * 0.52);
    const left = Math.round((W - (cw * 7 + gap * 6)) / 2);
    const topY = gap + 6;
    const pyr = [];
    for (let i = 0; i < SLOTS; i++) {
      pyr.push({ x: Math.round(left + (COL[i] + (6 - ROW[i]) / 2) * stepX), y: topY + ROW[i] * rowStep });
    }
    const pyrBottom = topY + 6 * rowStep + ch;
    const y = pyrBottom + gap * 3;
    const sx = Math.round(cw * 0.4);
    const x0 = Math.round((W - (cw * 3 + sx * 2)) / 2);
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
    return {
      cw, ch, pyr,
      stock: { x: x0, y },
      waste: { x: x0 + cw + sx, y },
      discard: { x: x0 + (cw + sx) * 2, y },
      height: y + ch + 24,
    };
  }

  function place(id, x, y, z, faceUp, instant) {
    const el = cardEls[id];
    const moved = el.style.left !== x + 'px' || el.style.top !== y + 'px';
    if (instant) el.classList.add('no-anim');
    el.classList.toggle('up', faceUp);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el._z = z;
    if (moved && !instant) {
      el.style.zIndex = 1000 + z;
      clearTimeout(el._zt);
      el._zt = setTimeout(() => { el._zt = null; el.style.zIndex = el._z; }, 240);
    } else if (!el._zt) {
      el.style.zIndex = z;
    }
    if (instant) { void el.offsetWidth; el.classList.remove('no-anim'); }
  }

  function render(instant = false) {
    if (!S) return;
    L = layout();
    const setSlot = (el, p) => { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; el.style.width = L.cw + 'px'; el.style.height = L.ch + 'px'; };
    setSlot(stockSlot, L.stock);
    setSlot(wasteSlot, L.waste);
    setSlot(discardSlot, L.discard);
    stockSlot.classList.toggle('empty-final', S.p >= S.cycle.length && !canRecycle());

    for (let i = 0; i < SLOTS; i++) if (S.pyr[i] >= 0) place(S.pyr[i], L.pyr[i].x, L.pyr[i].y, 10 + i, true, instant);
    for (let k = S.cycle.length - 1; k >= S.p; k--) place(S.cycle[k], L.stock.x, L.stock.y, 100 + (S.cycle.length - k), false, instant);
    for (let k = 0; k < S.p; k++) place(S.cycle[k], L.waste.x - Math.min(S.p - 1 - k, 4), L.waste.y, 200 + k, true, instant);
    S.removed.forEach((id, k) => place(id, L.discard.x, L.discard.y, 300 + k, true, instant));

    cardEls.forEach((el, id) => {
      const on = !!sel && idOf(sel) === id;
      el.classList.toggle('sel', on);
    });

    board.style.height = L.height + 'px';
    $('score').textContent = S.score.toLocaleString();
    $('deals').textContent = S.deals;
    const passes = $('passes');
    passes.textContent = S.p >= S.cycle.length && !canRecycle() ? 0 : S.passes;
    passes.classList.toggle('low', S.passes <= 1);
    $('undo-btn').disabled = !history.length;
  }

  // ---------------------------------------------------------------------------
  // Pointer interaction: tap a card then its partner, or drag one onto the other
  // ---------------------------------------------------------------------------
  function refOfCard(id) {
    const i = S.pyr.indexOf(id);
    if (i >= 0) return { k: 'pyr', i };
    const c = S.cycle.indexOf(id);
    if (c >= 0) return c < S.p ? { k: 'waste' } : { k: 'stock' };
    return null;
  }

  function shake(id) {
    const el = cardEls[id];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function tap(ref) {
    const id = idOf(ref);
    if (rankOf(id) === 13) { tryPair(ref); return; }
    if (sameRef(sel, ref)) { sel = null; render(); return; }
    if (sel && tryPair(sel, ref)) return;
    if (sel && isPlayable(sel)) {
      Sound.tone(180, 120, 0.1, 'sawtooth', 0.025);
      shake(id);
    }
    sel = ref;
    render();
  }

  board.addEventListener('pointerdown', (e) => {
    if (state !== 'play' || busy || paused || e.button > 0) return;
    Sound.init();
    clearHints();
    const cardEl = e.target.closest('.card');
    if (!cardEl) {
      if (e.target === stockSlot) drawStock();
      return;
    }
    const id = +cardEl.dataset.id;
    const ref = refOfCard(id);
    if (!ref) return;                                   // already on the discard pile
    if (ref.k === 'stock') { drawStock(); return; }
    if (!isPlayable(ref)) { shake(id); return; }
    drag = {
      ref, id, sx: e.clientX, sy: e.clientY, active: false,
      origin: { left: parseFloat(cardEls[id].style.left), top: parseFloat(cardEls[id].style.top) },
    };
    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.active && Math.hypot(dx, dy) < 6) return;
    if (!drag.active) {
      drag.active = true;
      const el = cardEls[drag.id];
      clearTimeout(el._zt); el._zt = null;
      el.classList.add('dragging');
      el.style.zIndex = 5000;
    }
    cardEls[drag.id].style.left = drag.origin.left + dx + 'px';
    cardEls[drag.id].style.top = drag.origin.top + dy + 'px';
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    cardEls[d.id].classList.remove('dragging');
    if (!d.active) {
      if (e.type !== 'pointercancel') tap(d.ref);
      return;
    }
    const r = { x: parseFloat(cardEls[d.id].style.left), y: parseFloat(cardEls[d.id].style.top), w: L.cw, h: L.ch };
    const targets = playable().filter((t) => !sameRef(t, d.ref)).map((t) => ({
      ref: t, rect: t.k === 'pyr' ? { ...L.pyr[t.i], w: L.cw, h: L.ch } : { ...L.waste, w: L.cw, h: L.ch },
    }));
    if (rankOf(d.id) === 13) targets.push({ ref: null, rect: { ...L.discard, w: L.cw, h: L.ch } });
    let best = null, bestA = 0;
    for (const t of targets) {
      const ox = Math.max(0, Math.min(r.x + r.w, t.rect.x + t.rect.w) - Math.max(r.x, t.rect.x));
      const oy = Math.max(0, Math.min(r.y + r.h, t.rect.y + t.rect.h) - Math.max(r.y, t.rect.y));
      const a = ox * oy;
      const ok = t.ref ? rankOf(d.id) + rankOf(t.ref.id) === 13 : rankOf(d.id) === 13;
      if (a > bestA && ok) { bestA = a; best = t; }
    }
    if (best && tryPair(d.ref, best.ref)) return;      // best.ref null = dropped on the discard: a king
    if (!best && rankOf(d.id) === 13 && tryPair(d.ref)) return;
    Sound.tone(180, 120, 0.1, 'sawtooth', 0.025);
    render();
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------------------
  // Hints
  // ---------------------------------------------------------------------------
  function clearHints() { document.querySelectorAll('.hint').forEach((el) => el.classList.remove('hint')); }
  function showHint() {
    if (state !== 'play' || busy || paused) return;
    clearHints();
    const m = findMove();
    if (!m) {
      if (S.p < S.cycle.length || canRecycle()) { stockSlot.classList.add('hint'); setTimeout(clearHints, 1600); return; }
      Arcade.toast('No moves left');
      return;
    }
    [m.a, m.b].forEach((c) => {
      if (!c) return;
      (c.k === 'pyr' ? cardEls[S.pyr[c.i]] : cardEls[wasteTop()]).classList.add('hint');
    });
    setTimeout(clearHints, 1600);
  }

  // ---------------------------------------------------------------------------
  // Timer & controls
  // ---------------------------------------------------------------------------
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  setInterval(() => {
    if (timerOn && !document.hidden && !paused) {
      const now = performance.now();
      elapsed += (now - lastTick) / 1000;
      lastTick = now;
    } else lastTick = performance.now();
    $('time').textContent = fmt(elapsed);
  }, 250);

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('resume-btn').addEventListener('click', () => pause(false));
  $('new-btn').addEventListener('click', () => {
    if (state === 'title') { start(); return; }
    start();
    Arcade.toast(DAILY ? 'Daily deal restarted' : SINGLE ? 'Fresh deal' : 'New run');
  });
  $('undo-btn').addEventListener('click', undo);
  $('hint-btn').addEventListener('click', showHint);
  Arcade.soundButton($('sound-btn'));
  if (window.Leaderboard) {
    if (Leaderboard.info(BOARD)) Leaderboard.button(BOARD, $('title').querySelector('.panel'), 'btn alt');
    Leaderboard.nameBar($('title').querySelector('.panel'));
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); }
    else if (k === 'h') showHint();
    else if (k === 'n') { start(); }
    else if (k === 'm') $('sound-btn').click();
    else if (k === 'p' || e.key === 'Escape') pause(!paused);
    else if (e.key === ' ' && state === 'play' && !e.repeat) { e.preventDefault(); drawStock(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(true); });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => S && render(true), 60); });

  // ---------------------------------------------------------------------------
  // Test hook (localhost only)
  // ---------------------------------------------------------------------------
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    // pair(a, b): card ids 0-51 ('waste' for the waste's top card); one argument removes a king
    const refFor = (x) => {
      if (x === 'waste' || x === 'w') return S.p > 0 ? { k: 'waste' } : null;
      const i = S.pyr.indexOf(x);
      if (i >= 0) return { k: 'pyr', i };
      if (S.p > 0 && wasteTop() === x) return { k: 'waste' };
      return null;
    };
    window.ArcadeTest = {
      game: 'pyramid',
      start,
      step: () => {},                                   // no animation loop: moves drive this game
      peek: () => ({
        state, score: S ? S.score : 0, time: Math.round(elapsed * 10) / 10,
        cards: S ? cardsLeft() : 0, passes: S ? S.passes : 0, deals: S ? S.deals : 0,
        pairs: S ? S.pairs || 0 : 0, moves: S ? S.moves : 0,
        stock: S ? S.cycle.length - S.p : 0, waste: S ? S.p : 0, wasteTop: S ? wasteTop() : -1,
        exposed: S ? playable().map((c) => c.id) : [], hasMove: S ? anyMove() : false,
        deal: S ? S.dealNo : 0, mode: SINGLE ? (DAILY ? 'daily' : 'classic') : 'infinite',
      }),
      set: (key, value) => {
        if (!S) return false;
        if (key === 'score') S.score = value;
        else if (key === 'passes') S.passes = value;
        else if (key === 'deals') S.deals = value;
        else if (key === 'time') { elapsed = value; dealStart = 0; }
        else return false;
        render();
        return true;
      },
      pair: (a, b) => {
        const ra = refFor(a);
        const rb = b === undefined ? null : refFor(b);
        if (!ra || (b !== undefined && !rb)) return false;
        return tryPair(ra, rb);
      },
      draw: () => { drawStock(); return true; },
      hint: () => findMove(),
      // jump to a winning finish: sweep the pyramid away and settle the deal
      win: () => {
        if (state !== 'play') return false;
        pushHistory();
        startTimer();
        for (let i = SLOTS - 1; i >= 0; i--) {
          if (S.pyr[i] < 0) continue;
          S.removed.push(S.pyr[i]);
          S.pyr[i] = -1;
          S.score += 50;
          S.pairs = (S.pairs || 0) + 1;
        }
        render();
        clearDeal();
        return true;
      },
    };
  }
})();
