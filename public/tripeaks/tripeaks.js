/*
 * TriPeaks — three overlapping peaks of 28 cards over a stock and a waste.
 * Take any uncovered card one rank above or below the waste card (aces wrap to kings and twos);
 * every card taken without flipping raises the streak, and the streak is where the points are.
 *
 * Infinite: board after board, each with a smaller stock and a bigger streak bonus.
 * Classic / Daily: one solvable deal, ranked by the fastest win.
 *
 * The card look comes from /solitaire/style.css; the rules are too far from the patience engine
 * (one run, many boards, a streak and an arcade title screen) to share /solitaire/engine.js.
 */
(() => {
  'use strict';

  const { Sound, toast, soundButton } = Arcade;
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const bar = document.querySelector('.bar');

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRed = (s) => s === 1 || s === 2;

  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const ONE_DEAL = CLASSIC || DAILY;                    // a single solvable deal, ranked by fastest win
  const BOARD = (window.Daily && Daily.board('tripeaks')) || (CLASSIC ? 'tripeaks-classic' : 'tripeaks');

  // ---------------------------------------------------------------------------
  // The three peaks: each row's x positions, measured in columns of half a card.
  // A card is covered by the two cards half a column to either side of it in the row above.
  // ---------------------------------------------------------------------------
  const ROWS = [
    [1.5, 4.5, 7.5],
    [1, 2, 4, 5, 7, 8],
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  ];
  const SLOTS = [];
  ROWS.forEach((xs, row) => xs.forEach((col) => SLOTS.push({ row, col })));
  const COVERS = SLOTS.map((s, i) =>
    SLOTS.reduce((acc, o, j) => (o.row === s.row - 1 && Math.abs(o.col - s.col) === 0.5 ? acc.concat(j) : acc), []));
  const PEAKS = SLOTS.length;                           // 28
  const RS = 0.5;                                       // row step, as a fraction of card height

  const matches = (a, b) => { const d = Math.abs(a - b); return d === 1 || d === 12; };
  const NEIGHBOURS = (r) => [r === 1 ? 13 : r - 1, r === 13 ? 1 : r + 1];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------------------------------------------------------------------------
  // Dealing. Every deal is built backwards from a legal sequence of moves, so it can always be
  // cleared: pick an order the peaks could be taken in, then hand each card a rank one step from
  // the card before it. When the ranks run out, a "bridge" card goes on top of the stock instead.
  // ---------------------------------------------------------------------------
  function removalOrder(rnd) {
    const gone = new Array(PEAKS).fill(false);
    const order = [];
    for (let n = 0; n < PEAKS; n++) {
      const open = [];
      for (let i = 0; i < PEAKS; i++) if (!gone[i] && COVERS[i].every((c) => gone[c])) open.push(i);
      const pick = open[(rnd() * open.length) | 0];
      gone[pick] = true;
      order.push(pick);
    }
    return order;
  }

  function makeDeal(rnd, size) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const pool = [[]];
      for (let r = 1; r <= 13; r++) pool.push([0, 1, 2, 3]);
      const take = (r) => ({ rank: r, suit: pool[r].splice((rnd() * pool[r].length) | 0, 1)[0] });
      const order = removalOrder(rnd);
      const peak = new Array(PEAKS);
      const bridges = [];
      let cur = 1 + ((rnd() * 13) | 0);
      const first = take(cur);
      let ok = true;
      for (const slot of order) {
        let opts = NEIGHBOURS(cur).filter((r) => pool[r].length);
        if (!opts.length) {
          const cand = [];
          for (let r = 1; r <= 13; r++) if (pool[r].length && NEIGHBOURS(r).some((n) => pool[n].length)) cand.push(r);
          if (!cand.length) { ok = false; break; }
          cur = cand[(rnd() * cand.length) | 0];
          bridges.push(take(cur));
          opts = NEIGHBOURS(cur).filter((r) => pool[r].length);
        }
        cur = opts[(rnd() * opts.length) | 0];
        peak[slot] = take(cur);
      }
      if (!ok || bridges.length + 1 > size) continue;   // the bridges have to fit in the stock
      const rest = [];
      for (let r = 1; r <= 13; r++) for (const suit of pool[r]) rest.push({ rank: r, suit });
      for (let i = rest.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [rest[i], rest[j]] = [rest[j], rest[i]]; }
      return { peak, stock: [first, ...bridges, ...rest].slice(0, size) };
    }
    return null;
  }

  function plainDeal(rnd, size) {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ suit: s, rank: r });
    for (let i = deck.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return { peak: deck.slice(0, PEAKS), stock: deck.slice(PEAKS, PEAKS + size) };
  }

  // ---------------------------------------------------------------------------
  // State. Cards 0..27 are the peaks (card i lives in slot i); 28.. are the stock, flipped in order.
  // ---------------------------------------------------------------------------
  let cards = [], cardEls = [], slots = null, L = null;
  let taken = new Array(PEAKS).fill(false);
  let stockSize = 24, stockPos = 0, waste = [];
  let score = 0, streak = 0, bestStreak = 0, boards = 0, moves = 0;
  let elapsed = 0, timerOn = false, lastTick = performance.now();
  let history = [];
  let state = 'title', paused = false, playCounted = false;
  let rnd = Math.random;

  const exposed = (i) => !taken[i] && COVERS[i].every((c) => taken[c]);
  const wasteRank = () => (waste.length ? cards[waste[waste.length - 1]].rank : 0);
  const canTake = (i) => !taken[i] && exposed(i) && matches(cards[i].rank, wasteRank());
  const cardsLeft = () => taken.reduce((n, t) => n + (t ? 0 : 1), 0);
  const stockLeft = () => Math.max(0, stockSize - stockPos);
  const playable = () => { const p = []; for (let i = 0; i < PEAKS; i++) if (canTake(i)) p.push(i); return p; };
  const anyMove = () => { for (let i = 0; i < PEAKS; i++) if (canTake(i)) return true; return false; };
  // every board cleared makes the streak worth more, up to double (the server's score cap is linear
  // in time, so this has to level off — see scoreCap in the registry)
  const boardMult = () => (ONE_DEAL ? 1 : Math.min(2, 1 + 0.2 * boards));
  const showMult = (m) => m.toFixed(1).replace(/\.0$/, '');

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------
  const combo = document.createElement('div');
  combo.id = 'combo';
  board.appendChild(combo);

  function buildCards() {
    cardEls.forEach((el) => el.remove());
    cardEls = cards.map((c, id) => {
      const s = SUITS[c.suit], r = RANKS[c.rank];
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.id = id;
      const centre = c.rank > 10 ? `<div class="pip court">${r}<i>${s}</i></div>` : `<div class="pip">${s}</div>`;
      const index = `<span class="r">${r}</span><span class="s">${s}</span>`;
      el.innerHTML = `<div class="inner">
        <div class="face ${isRed(c.suit) ? 'red' : ''}">
          <div class="corner tl">${index}</div>
          ${centre}
          <div class="corner bl">${index}</div>
          <div class="corner br">${index}</div>
        </div>
        <div class="back"></div>
      </div>`;
      board.appendChild(el);
      return el;
    });
  }

  function buildSlots() {
    if (slots) return;
    const make = (cls, pile) => {
      const d = document.createElement('div');
      d.className = 'slot ' + cls;
      d.dataset.pile = pile;
      board.insertBefore(d, board.firstChild);
      return d;
    };
    slots = { stock: make('stock', 'stock'), waste: make('waste', 'waste') };
  }

  function metrics() {
    const W = Math.min(window.innerWidth, 1000);
    const avail = W - 16;
    let k = 1;                                          // column spacing, in card widths
    let cw = Math.min(104, avail / 10);
    if (cw < 58) { k = Math.max(0.6, (avail / 58 - 1) / 9); cw = Math.min(104, avail / (9 * k + 1)); }
    const availH = Math.max(160, window.innerHeight - bar.offsetHeight - 20);
    cw = Math.max(30, Math.round(Math.min(cw, (availH - 26) / 5.21)));   // peaks + a gap + the stock row
    const ch = Math.round(cw * 1.4);
    const left = Math.round((W - (9 * k * cw + cw)) / 2);
    const rowY = (r) => Math.round(10 + r * RS * ch);
    const baseY = rowY(3) + ch + Math.round(ch * 0.22);
    return {
      cw, ch, W, rowY, baseY,
      colX: (c) => Math.round(left + c * k * cw),
      stockX: Math.round(W / 2 - cw * 1.44),
      wasteX: Math.round(W / 2 - cw * 0.04),
      fan: Math.round(cw * 0.16),
    };
  }

  function applyMetrics(m) {
    board.style.setProperty('--cw', m.cw + 'px');
    board.style.setProperty('--ch', m.ch + 'px');
    board.style.height = m.baseY + m.ch + 16 + 'px';
  }

  function place(el, x, y, z, faceUp, instant) {
    const moved = el.style.left !== x + 'px' || el.style.top !== y + 'px';
    if (instant) el.classList.add('no-anim');
    el.classList.toggle('up', faceUp);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el._z = z;
    if (moved && !instant) {
      el.style.zIndex = 4000 + z;
      clearTimeout(el._zt);
      el._zt = setTimeout(() => { el._zt = null; el.style.zIndex = el._z; }, 260);
    } else if (!el._zt) {
      el.style.zIndex = z;
    }
    if (instant) { void el.offsetWidth; el.classList.remove('no-anim'); }
  }

  function render(instant) {
    L = metrics();
    applyMetrics(L);
    for (const key of ['stock', 'waste']) {
      const el = slots[key];
      el.style.left = (key === 'stock' ? L.stockX : L.wasteX) + 'px';
      el.style.top = L.baseY + 'px';
      el.style.width = L.cw + 'px';
      el.style.height = L.ch + 'px';
    }
    slots.stock.classList.toggle('empty-final', stockLeft() === 0);

    for (let i = 0; i < PEAKS; i++) {
      const el = cardEls[i];
      if (taken[i]) continue;
      const s = SLOTS[i];
      place(el, L.colX(s.col), L.rowY(s.row), (3 - s.row) * 100 + s.col * 2, true, instant);
      const open = exposed(i);
      el.style.visibility = '';
      el.classList.toggle('buried', !open);
      el.classList.toggle('playable', open && matches(cards[i].rank, wasteRank()));
    }
    for (let n = stockPos; n < stockSize; n++) {
      const el = cardEls[PEAKS + n];
      const d = Math.min(5, stockSize - 1 - n) * 1.6;
      place(el, Math.round(L.stockX - d), Math.round(L.baseY - d), 500 + (stockSize - n), false, instant);
      el.style.visibility = '';
      el.classList.remove('playable', 'buried');
    }
    waste.forEach((id, n) => {
      const el = cardEls[id];
      const back = waste.length - 1 - n;
      el.style.visibility = back > 3 ? 'hidden' : '';
      place(el, L.wasteX + Math.max(0, 3 - back) * L.fan, L.baseY, 600 + n, true, instant);
      el.classList.remove('playable', 'buried');
    });
  }

  function updateHud() {
    $('score').textContent = score.toLocaleString();
    const st = $('streak');
    st.textContent = '×' + streak;
    st.classList.toggle('hot', streak >= 3);
    $('boards').textContent = String(boards);
    $('stock').textContent = String(stockLeft());
    $('left').textContent = String(cardsLeft());
    $('undo-btn').disabled = !history.length || state !== 'play';
  }

  // ---------------------------------------------------------------------------
  // Feedback: the streak is the fun, so it climbs in pitch and pops over the waste
  // ---------------------------------------------------------------------------
  function chime(n) {
    const f = 262 * Math.pow(2, Math.min(n - 1, 19) / 12);
    Sound.tone(f, f * 1.5, 0.13, 'triangle', 0.05);
    if (n % 5 === 0) Sound.arp([f, f * 1.26, f * 1.5], 0.06, 'square', 0.035);
  }

  function popCombo(n, pts) {
    combo.innerHTML = `×${n}<b>+${pts.toLocaleString()}</b>`;
    combo.style.left = L.wasteX + L.cw * 0.5 + L.fan * 3 + 'px';
    combo.style.top = L.baseY - L.ch * 0.1 + 'px';
    combo.style.fontSize = Math.min(46, 20 + n * 2.2) + 'px';
    combo.classList.remove('pop');
    void combo.offsetWidth;
    combo.classList.add('pop');
  }

  function shake(i) {
    const el = cardEls[i];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function clearHints() { board.querySelectorAll('.hint').forEach((el) => el.classList.remove('hint')); }

  // ---------------------------------------------------------------------------
  // Moves
  // ---------------------------------------------------------------------------
  function pushHistory() {
    history.push({ taken: taken.slice(), stockPos, waste: waste.slice(), score, streak, bestStreak });
    if (history.length > 400) history.shift();
  }

  function startClock() {
    if (!timerOn) { timerOn = true; lastTick = performance.now(); }
    // the first move is what counts as playing this deal
    if (!playCounted && window.Leaderboard) { playCounted = true; Leaderboard.played(BOARD); }
  }

  function takeCard(i) {
    if (state !== 'play' || paused || taken[i]) return false;
    clearHints();
    if (!canTake(i)) { shake(i); Sound.tone(170, 120, 0.09, 'square', 0.03); return false; }
    pushHistory();
    startClock();
    taken[i] = true;
    waste.push(i);
    streak++;
    bestStreak = Math.max(bestStreak, streak);
    const pts = Math.round(10 * streak * boardMult());
    score += pts;
    moves++;
    render();
    chime(streak);
    popCombo(streak, pts);
    settle();
    return true;
  }

  function flip() {
    if (state !== 'play' || paused) return false;
    clearHints();
    if (!stockLeft()) { toast('The stock is empty — nothing left to turn'); Sound.tone(150, 110, 0.12, 'square', 0.03); return false; }
    pushHistory();
    startClock();
    if (streak >= 3) Sound.tone(300, 140, 0.18, 'sawtooth', 0.03);
    waste.push(PEAKS + stockPos);
    stockPos++;
    streak = 0;
    moves++;
    Sound.noise(0.09, 0.05, 0, 2800);
    Sound.tone(430, 300, 0.09, 'triangle', 0.03);
    render();
    settle();
    return true;
  }

  function undo() {
    if (state !== 'play' || paused || !history.length) return;
    const s = history.pop();
    taken = s.taken.slice();
    stockPos = s.stockPos;
    waste = s.waste.slice();
    score = s.score;
    streak = s.streak;
    bestStreak = s.bestStreak;
    moves++;
    Sound.tone(360, 260, 0.08, 'triangle', 0.03);
    render();
    updateHud();
  }

  function hint() {
    if (state !== 'play' || paused) return;
    clearHints();
    const opts = [];
    for (let i = 0; i < PEAKS; i++) if (canTake(i)) opts.push(i);
    if (opts.length) {
      opts.sort((a, b) => SLOTS[a].row - SLOTS[b].row);   // the card nearest a summit opens the most
      cardEls[opts[0]].classList.add('hint');
    } else if (stockLeft()) {
      slots.stock.classList.add('hint');
      toast('Nothing matches — turn a card from the stock');
    } else {
      toast('No moves and no stock left. Undo, or deal again.');
    }
    setTimeout(clearHints, 1600);
  }

  // ---------------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------------
  function settle() {
    updateHud();
    if (cardsLeft() === 0) { boardCleared(); return; }
    if (!stockLeft() && !anyMove()) endRun(false);
  }

  function boardCleared() {
    const bonus = 500 + stockLeft() * 50;                // 500 a board, plus what's left of the stock
    score += bonus;
    boards++;
    Sound.arp([523, 659, 784, 1046, 1318], 0.085, 'triangle', 0.05);
    updateHud();
    if (ONE_DEAL) { endRun(true); return; }
    toast(`PEAKS CLEARED  ·  +${bonus.toLocaleString()}  ·  board ${boards + 1}: ${stockSizeFor(boards)} in the stock, streaks pay ×${showMult(boardMult())}`);
    state = 'deal';
    setTimeout(() => {
      if (state !== 'deal') return;
      dealBoard();
      state = 'play';
      render();
      updateHud();
    }, 850);
  }

  function endRun(won) {
    if (state === 'over') return;
    state = 'over';
    timerOn = false;
    clearHints();
    $('o-score').textContent = score.toLocaleString();
    $('o-boards').textContent = String(boards);
    $('o-streak').textContent = '×' + bestStreak;
    $('o-time').textContent = fmt(elapsed);
    $('o-left').textContent = String(cardsLeft());
    const msg = won
      ? `All three peaks cleared in ${fmt(elapsed)} — best streak ×${bestStreak}.`
      : ONE_DEAL
        ? 'No moves left and the stock is empty.'
        : `${boards} board${boards === 1 ? '' : 's'} cleared before the peaks won.`;
    Arcade.endScreen(won, msg);
    $('over').hidden = false;
    updateHud();
    if (!won) Sound.noise(0.9, 0.16, 0, 520);
    if (window.Leaderboard) {
      // Classic and the daily rank the fastest win; Infinite ranks the score
      Leaderboard.offer(BOARD, ONE_DEAL ? { score, time: elapsed, won } : { score, won: false },
        document.querySelector('#over .panel'));
    }
  }

  const stockSizeFor = (n) => (ONE_DEAL ? 24 : Math.max(8, 24 - n * 2));

  function dealBoard() {
    stockSize = stockSizeFor(boards);
    const deal = makeDeal(rnd, stockSize) || plainDeal(rnd, stockSize);
    cards = [...deal.peak, ...deal.stock];
    taken = new Array(PEAKS).fill(false);
    stockPos = 0;
    waste = [];
    history = [];
    buildCards();
    buildSlots();
    // park every card on the stock so the board deals itself out
    const m = metrics();
    applyMetrics(m);
    cardEls.forEach((el, i) => {
      el.classList.add('no-anim');
      el.style.left = m.stockX + 'px';
      el.style.top = m.baseY + 'px';
      el.style.zIndex = cardEls.length - i;
      if (i < PEAKS) el.style.transitionDelay = el.firstElementChild.style.transitionDelay = i * 11 + 'ms';
    });
    void board.offsetWidth;
    cardEls.forEach((el) => el.classList.remove('no-anim'));
    setTimeout(() => cardEls.forEach((el) => { el.style.transitionDelay = el.firstElementChild.style.transitionDelay = ''; }), 700);
    waste.push(PEAKS);                                   // turn the first stock card
    stockPos = 1;
  }

  function start() {
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    setPaused(false);
    score = 0; streak = 0; bestStreak = 0; boards = 0; moves = 0; elapsed = 0;
    timerOn = false; playCounted = false;
    rnd = DAILY ? Daily.rng('tripeaks') : Math.random;
    dealBoard();
    state = 'play';
    render();
    updateHud();
    // the deal is made before the player acts, so the play is counted on the first move
    if (window.Leaderboard) Leaderboard.startRun(BOARD, { play: false });
  }

  function setPaused(on) {
    paused = !!on && state === 'play';
    $('pause').hidden = !paused;
    document.body.classList.toggle('paused', paused);
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  board.addEventListener('pointerdown', (e) => {
    if (state !== 'play' || paused) return;
    const slotEl = e.target.closest('.slot');
    if (slotEl) { if (slotEl.dataset.pile === 'stock') flip(); return; }
    const cardEl = e.target.closest('.card');
    if (!cardEl) return;
    const id = +cardEl.dataset.id;
    if (id >= PEAKS) { if (id - PEAKS >= stockPos) flip(); return; }   // a face-down stock card
    if (!taken[id]) takeCard(id);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (state === 'title' || state === 'over') start();
      else if (paused) setPaused(false);
      else flip();
    } else if (k === 'h') hint();
    else if (k === 'n') newDeal();
    else if (k === 'p' || k === 'escape') setPaused(!paused);
    else if (k === 'm') $('sound-btn').click();
  });

  function newDeal() {
    if (state === 'title') return;
    start();
    toast(ONE_DEAL ? 'A fresh deal' : 'A fresh run');
  }

  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('resume-btn').addEventListener('click', () => setPaused(false));
  $('new-btn').addEventListener('click', newDeal);
  $('undo-btn').addEventListener('click', undo);
  $('hint-btn').addEventListener('click', hint);
  soundButton($('sound-btn'));
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') setPaused(true); });

  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (cards.length) render(true); }, 60); });

  setInterval(() => {
    const now = performance.now();
    if (timerOn && !paused && !document.hidden && state !== 'over') elapsed += (now - lastTick) / 1000;
    lastTick = now;
    $('time').textContent = fmt(elapsed);
  }, 250);

  if (window.Leaderboard) {
    Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
    Leaderboard.nameBar(document.querySelector('#title .panel'));
  }

  // a quiet deal sits behind the title screen (start() re-seeds, so the daily deal is the same one)
  rnd = DAILY ? Daily.rng('tripeaks') : Math.random;
  dealBoard();
  render(true);
  updateHud();

  // local development helper (see docs/ADDING_A_GAME.md): lets a test script drive the game without
  // animation frames (which stop when the tab is hidden)
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.ArcadeTest = {
      game: 'tripeaks',
      start,
      // nothing here is frame-driven, but the clock still has to be able to move
      step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') elapsed += dt; },
      peek: () => ({
        state, paused, score, streak, best: bestStreak, boards, moves,
        cards: cardsLeft(), stock: stockLeft(), time: Math.round(elapsed * 100) / 100,
        mult: boardMult(), waste: waste.length ? RANKS[wasteRank()] + SUITS[cards[waste[waste.length - 1]].suit] : null,
        playable: playable(),
      }),
      // the peaks as "A♠" strings, null where a card has already gone
      peaks: () => cards.slice(0, PEAKS).map((c, i) => (taken[i] ? null : RANKS[c.rank] + SUITS[c.suit])),
      playable,
      play: (i) => takeCard(i),                          // play one peak slot (0..27)
      playAny: () => { const p = playable(); return p.length ? takeCard(p[0]) : false; },
      flip,
      undo,
      set: (k, v) => {
        if (k === 'score') score = v;
        else if (k === 'streak') { streak = v; bestStreak = Math.max(bestStreak, v); }
        else if (k === 'boards') boards = v;
        else if (k === 'time') elapsed = v;
        else if (k === 'stock') stockPos = Math.max(1, stockSize - v);
        render(true);
        updateHud();
      },
      win: () => {
        for (let i = 0; i < PEAKS; i++) if (!taken[i]) { taken[i] = true; waste.push(i); }
        render(true);
        boardCleared();
      },
    };
  }
})();
