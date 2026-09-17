/*
 * Blackjack — six decks, dealer stands on soft 17, blackjack pays 3:2.
 *   Infinite (/blackjack/)              500 chips and no last hand; the score is the highest stack you reach
 *   Classic  (/blackjack/?mode=classic) a 100-hand shoe; finish holding 1,000+ chips to beat the table
 *   Daily    (/blackjack/?daily=…)      Infinite rules, every shuffle from Daily.rng('blackjack')
 *
 * The chips are a score. Nothing is bought, nothing is paid out — this is a game about playing the hand well.
 * Card faces and the toolbar come from /solitaire/style.css so the table matches the other card games.
 */
(() => {
  'use strict';

  const { Sound, toast, store, clamp } = Arcade;
  const $ = (id) => document.getElementById(id);

  const CLASSIC = Arcade.classic;
  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('blackjack')) || (CLASSIC ? 'blackjack-classic' : 'blackjack');
  const CLASSIC_HANDS = 100;
  const CLASSIC_TARGET = 1000;

  // #region rules — pure blackjack, no DOM (a node harness lifts this block out to simulate hands)
  const DECKS = 6;
  const PENETRATION = 0.75;                 // the cut card sits three quarters of the way down the shoe
  const START_CHIPS = 500;
  const MIN_BET = 10;                       // keeps every 3:2 and half-bet payout a whole number
  const MAX_HANDS = 3;                      // split up to three hands

  const suitOf = (c) => Math.floor(c / 13) % 4;
  const rankOf = (c) => (c % 13) + 1;       // 1 = ace … 13 = king
  const isRed = (c) => suitOf(c) === 1 || suitOf(c) === 2;
  const cardValue = (c) => Math.min(rankOf(c), 10);

  // total with aces counted as 1, then promoted to 11 if that still fits
  function handValue(cards) {
    let total = 0, aces = 0;
    for (const c of cards) { total += cardValue(c); if (rankOf(c) === 1) aces++; }
    const soft = aces > 0 && total + 10 <= 21;
    return { total: soft ? total + 10 : total, soft };
  }

  // a natural: the first two cards only, and never a split hand
  const isBlackjack = (hand) => hand.cards.length === 2 && !hand.split && handValue(hand.cards).total === 21;
  const dealerHits = (cards) => handValue(cards).total < 17;      // stands on soft 17

  function settleHand(hand, dealerCards) {
    if (hand.surrendered) return { payout: hand.bet / 2, outcome: 'surrender' };
    const p = handValue(hand.cards);
    if (p.total > 21) return { payout: 0, outcome: 'bust' };
    const d = handValue(dealerCards);
    const dbj = dealerCards.length === 2 && d.total === 21;
    const pbj = isBlackjack(hand);
    if (pbj && dbj) return { payout: hand.bet, outcome: 'push' };
    if (pbj) return { payout: hand.bet * 2.5, outcome: 'blackjack' };
    if (dbj) return { payout: 0, outcome: 'lose' };
    if (d.total > 21 || p.total > d.total) return { payout: hand.bet * 2, outcome: 'win' };
    if (p.total < d.total) return { payout: 0, outcome: 'lose' };
    return { payout: hand.bet, outcome: 'push' };
  }

  // Basic strategy for these rules (6 decks, S17, double any two, double after split, late surrender,
  // no resplitting aces). `up` is the dealer's upcard value, 2–11. Returns H / S / D / P / R.
  function pairSplits(v, up) {
    if (v === 11) return true;                        // aces
    if (v === 10 || v === 5) return false;
    if (v === 9) return up <= 6 || up === 8 || up === 9;
    if (v === 8) return true;
    if (v === 7 || v === 3 || v === 2) return up <= 7;
    if (v === 6) return up <= 6;
    if (v === 4) return up === 5 || up === 6;
    return false;
  }

  function strategy(cards, up, opts) {
    const o = opts || {};
    const v = handValue(cards);
    const pair = cards.length === 2 && rankOf(cards[0]) === rankOf(cards[1]);
    if (o.canSurrender) {
      if (!v.soft && v.total === 16 && !(pair && rankOf(cards[0]) === 8) && up >= 9) return 'R';   // 8,8 is a split
      if (!v.soft && v.total === 15 && up === 10) return 'R';
    }
    if (o.canSplit && pair && pairSplits(rankOf(cards[0]) === 1 ? 11 : cardValue(cards[0]), up)) return 'P';
    if (v.soft) {
      if (v.total >= 19) return 'S';
      if (v.total === 18) {
        if (up >= 3 && up <= 6) return o.canDouble ? 'D' : 'S';
        return up <= 8 ? 'S' : 'H';
      }
      if (v.total === 17) return o.canDouble && up >= 3 && up <= 6 ? 'D' : 'H';
      if (v.total >= 15) return o.canDouble && up >= 4 && up <= 6 ? 'D' : 'H';
      if (v.total >= 13) return o.canDouble && up >= 5 && up <= 6 ? 'D' : 'H';
      return 'H';
    }
    if (v.total >= 17) return 'S';
    if (v.total >= 13) return up <= 6 ? 'S' : 'H';
    if (v.total === 12) return up >= 4 && up <= 6 ? 'S' : 'H';
    if (v.total === 11) return o.canDouble && up <= 10 ? 'D' : 'H';
    if (v.total === 10) return o.canDouble && up <= 9 ? 'D' : 'H';
    if (v.total === 9) return o.canDouble && up >= 3 && up <= 6 ? 'D' : 'H';
    return 'H';
  }

  function buildShoe(random) {
    const shoe = [];
    for (let d = 0; d < DECKS; d++) for (let c = 0; c < 52; c++) shoe.push(c);
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
    return shoe;
  }
  // #endregion rules

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const CHIPS = [1000, 500, 100, 50, 10];   // any whole bet breaks down exactly into these

  let S = null;                  // the whole run: chips, shoe, this round's hands
  let state = 'title';           // 'title' | 'play' | 'over'
  let phase = 'bet';             // 'bet' | 'deal' | 'insurance' | 'act' | 'dealer' | 'settle'
  let paused = false;
  let instant = false;           // ArcadeTest drives the table with no animation delays
  let runStarted = false;
  let rnd = Math.random;
  let timers = [];
  let token = 0;                 // pending timeouts from an abandoned round are dropped
  let high = store.get(Arcade.modeKey('blackjack.high'), 0);
  let hintOn = store.get(Arcade.modeKey('blackjack.hint'), !CLASSIC);

  // sequencing: instant mode collapses every delay so a test can play a hand in one call
  function after(ms, fn) {
    if (instant) { fn(); return; }
    const t = token;
    timers.push(setTimeout(() => { if (t === token) fn(); }, ms));
  }
  function clearTimers() { token++; timers.forEach(clearTimeout); timers = []; }

  // ---------------------------------------------------------------------------
  // Table DOM
  // ---------------------------------------------------------------------------
  const handsEl = $('hands');
  const dealerHolder = { cards: $('dealer-cards'), els: [] };
  let seats = [];

  function makeCard(c) {
    const r = rankOf(c), s = SUITS[suitOf(c)];
    const el = document.createElement('div');
    el.className = 'card';
    const center = r > 10 ? `<div class="pip court">${RANKS[r]}<i>${s}</i></div>` : `<div class="pip">${s}</div>`;
    el.innerHTML = `<div class="inner">
      <div class="face ${isRed(c) ? 'red' : ''}">
        <div class="corner tl"><span class="r">${RANKS[r]}</span><span class="s">${s}</span></div>
        ${center}
        <div class="corner br"><span class="r">${RANKS[r]}</span><span class="s">${s}</span></div>
      </div>
      <div class="back"></div>
    </div>`;
    return el;
  }

  // a new card slides out of the shoe, then flips
  function slide(el) {
    if (instant) return;
    const from = $('shoe').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${Math.round(from.left - r.left)}px, ${Math.round(from.top - r.top)}px) rotate(-7deg)`;
    void el.offsetWidth;
    el.style.transition = '';
    el.style.transform = '';
  }

  // splitting inserts a hand in the middle, so a seat can inherit another hand's cards: the id on the
  // element says whether what is already there still belongs, and the tail is rebuilt when it does not.
  function syncCards(holder, cards, isUp) {
    while (holder.els.length > cards.length) holder.els.pop().remove();
    for (let i = 0; i < cards.length; i++) {
      const have = holder.els[i];
      if (have && +have.dataset.c === cards[i]) { have.classList.toggle('up', isUp(i)); continue; }
      if (have) while (holder.els.length > i) holder.els.pop().remove();
      const el = makeCard(cards[i]);
      el.dataset.c = cards[i];
      holder.cards.appendChild(el);
      holder.els[i] = el;
      slide(el);
      Sound.tone(520, 340, 0.05, 'triangle', 0.022);
      Sound.noise(0.06, 0.018, 0, 2600);
      if (isUp(i)) after(instant ? 0 : 110, () => el.classList.add('up'));
    }
  }

  function makeSeat() {
    const root = document.createElement('div');
    root.className = 'seat';
    root.innerHTML = '<div class="badge">—</div><div class="hand-cards"></div>' +
      '<div class="bet-tag"><span class="stack"></span><span class="amt">0</span></div><div class="outcome"></div>';
    handsEl.appendChild(root);
    return {
      root, badge: root.querySelector('.badge'), cards: root.querySelector('.hand-cards'),
      stack: root.querySelector('.stack'), amt: root.querySelector('.amt'), outcome: root.querySelector('.outcome'), els: [],
    };
  }

  function clearTable() {
    seats.forEach((s) => s.root.remove());
    seats = [];
    dealerHolder.els.forEach((el) => el.remove());
    dealerHolder.els = [];
  }

  // chips for a bet, biggest denomination first, eight at most
  function stackHtml(amount) {
    let left = amount, n = 0, out = '';
    for (const d of CHIPS) {
      while (left >= d && n < 8) { out += `<i class="c${d}"></i>`; left -= d; n++; }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Layout: cards shrink so three split hands still read on a phone
  // ---------------------------------------------------------------------------
  function sizeCards() {
    const n = Math.max(1, S ? S.hands.length : 1);
    const most = Math.max(2, S ? Math.max(S.dealer.length, ...S.hands.map((h) => h.cards.length)) : 2);
    const avail = (Math.min(window.innerWidth, 1000) - 24) / n - 10;
    const byHeight = (Math.max(300, window.innerHeight) - 330) / 2 / 1.4;
    let cw = Math.max(30, Math.floor(Math.min(86, avail / 1.85, byHeight)));
    let sp = 0.55;                                     // fraction of a card the next one leaves showing
    if (cw * (1 + sp * (most - 1)) > avail) sp = clamp((avail / cw - 1) / (most - 1), 0.22, 0.55);
    const root = document.documentElement.style;
    root.setProperty('--cw', cw + 'px');
    root.setProperty('--ch', Math.round(cw * 1.4) + 'px');
    root.setProperty('--sp', sp.toFixed(3));
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function badgeText(cards, hand) {
    const v = handValue(cards);
    if (v.total > 21) return 'BUST';
    if (hand && isBlackjack(hand)) return 'BLACKJACK';
    return v.soft ? `${v.total - 10} / ${v.total}` : String(v.total);
  }

  const OUTCOME = { win: 'WON', blackjack: 'BLACKJACK', push: 'PUSH', lose: 'LOST', bust: 'BUST', surrender: 'SURRENDERED' };

  function render() {
    if (!S) return;
    sizeCards();

    // dealer
    syncCards(dealerHolder, S.dealer, (i) => !(i === 1 && S.down));
    const dBadge = $('dealer-badge');
    if (!S.dealer.length) { dBadge.textContent = '—'; dBadge.className = 'badge hidden-total'; }
    else if (S.down) { dBadge.textContent = badgeText([S.dealer[0]]); dBadge.className = 'badge hidden-total'; }
    else {
      const dv = handValue(S.dealer);
      dBadge.textContent = badgeText(S.dealer, { cards: S.dealer, split: false });
      dBadge.className = 'badge' + (dv.total > 21 ? ' bust' : S.dealer.length === 2 && dv.total === 21 ? ' bj' : dv.soft ? ' soft' : '');
    }

    // player hands
    while (seats.length > S.hands.length) seats.pop().root.remove();
    while (seats.length < S.hands.length) seats.push(makeSeat());
    S.hands.forEach((h, i) => {
      const seat = seats[i];
      syncCards(seat, h.cards, () => true);
      const v = handValue(h.cards);
      seat.badge.textContent = h.cards.length ? badgeText(h.cards, h) : '—';
      seat.badge.className = 'badge' + (v.total > 21 ? ' bust' : isBlackjack(h) ? ' bj' : v.soft ? ' soft' : '');
      seat.stack.innerHTML = stackHtml(h.bet);
      seat.amt.textContent = h.bet.toLocaleString();
      const net = h.payout - h.bet;
      seat.outcome.textContent = !h.outcome ? '' :
        h.outcome === 'push' ? 'PUSH' :
        h.outcome === 'surrender' ? 'SURRENDERED −' + (h.bet / 2).toLocaleString() :
        net > 0 ? `${OUTCOME[h.outcome]} +${net.toLocaleString()}` : `${OUTCOME[h.outcome]} −${h.bet.toLocaleString()}`;
      seat.outcome.className = 'outcome' + (!h.outcome ? '' : h.outcome === 'push' ? ' push' : net > 0 ? ' win' : ' lose');
      seat.root.classList.toggle('active', phase === 'act' && i === S.active && S.hands.length > 1);
    });

    // hud
    $('chips').textContent = S.chips.toLocaleString();
    $('bet').textContent = S.bet.toLocaleString();
    $('hands-played').textContent = S.rounds;
    $('best').textContent = Math.max(high, liveScore()).toLocaleString();
    const pct = S.shoe.length ? Math.min(100, Math.round((S.pos / S.shoe.length) * 100)) : 0;
    $('shoe-pct').textContent = pct + '%';
    $('shoe-used').style.height = pct + '%';
    renderControls();
  }

  function renderControls() {
    const live = state === 'play' && !paused;
    $('bet-row').hidden = !(live && phase === 'bet');
    $('act-row').hidden = !(live && phase === 'act');
    $('ins-row').hidden = !(live && phase === 'insurance');
    if (live && phase === 'bet') {
      const slider = $('bet-slider');
      slider.max = Math.max(MIN_BET, maxBet());
      slider.value = S.bet;
      $('bet-amount').textContent = S.bet.toLocaleString();
      $('bet-stack').innerHTML = stackHtml(S.bet);
      $('bet-down').disabled = S.bet <= MIN_BET;
      $('bet-up').disabled = S.bet >= maxBet();
      $('bet-max').disabled = S.bet >= maxBet();
    }
    if (live && phase === 'act') {
      const hint = hintOn ? suggestion() : null;
      const set = (id, ok) => {
        const b = $(id);
        b.disabled = !ok;
        b.classList.toggle('suggest', ok && hint === id.replace('-btn', ''));
      };
      set('hit-btn', true);
      set('stand-btn', true);
      set('double-btn', canDouble());
      set('split-btn', canSplit());
      set('surrender-btn', canSurrender());
    }
    if (live && phase === 'insurance') {
      $('ins-yes').classList.remove('suggest');
      $('ins-no').classList.toggle('suggest', hintOn);      // basic strategy never insures
    }
    $('hint-btn').classList.toggle('on', hintOn);
  }

  const msg = (t) => { $('msg').innerHTML = t; };

  // ---------------------------------------------------------------------------
  // Bets and the shoe
  // ---------------------------------------------------------------------------
  // the table limit doubles every 25 hands, so the swings grow with the stack
  const tableLimit = () => (CLASSIC ? 250 : Math.min(25000, 100 * Math.pow(2, Math.floor(S.rounds / 25))));
  const maxBet = () => Math.max(MIN_BET, Math.min(tableLimit(), Math.floor(S.chips / MIN_BET) * MIN_BET));
  const betStep = () => { const l = tableLimit(); return l <= 100 ? 10 : l <= 400 ? 50 : l <= 1600 ? 100 : l <= 6400 ? 500 : 2500; };
  const clampBet = (n) => clamp(Math.round(n / MIN_BET) * MIN_BET, MIN_BET, maxBet());
  // the buttons and arrow keys walk a tidy grid of whole chips, not an offset one
  const stepBet = (dir) => { const s = betStep(); setBet(Math.round(S.bet / s) * s + dir * s); };

  function setBet(n) {
    if (phase !== 'bet' || state !== 'play') return;
    const b = clampBet(n);
    if (b === S.bet) { render(); return; }
    S.bet = b;
    Sound.tone(880, 1240, 0.04, 'square', 0.025);
    render();
  }

  function shuffle() {
    S.shoe = buildShoe(rnd);
    S.pos = 0;
    S.cut = Math.floor(S.shoe.length * PENETRATION);
    S.shoeNo++;
    Sound.noise(0.3, 0.05, 0, 900);
    if (S.shoeNo > 1) toast('Cut card reached — fresh shoe');
  }

  function draw() {
    if (S.pos >= S.shoe.length) S.shoe = S.shoe.concat(buildShoe(rnd));
    return S.shoe[S.pos++];
  }

  // ---------------------------------------------------------------------------
  // A hand
  // ---------------------------------------------------------------------------
  const cur = () => S.hands[S.active];
  const upValue = () => (S.dealer.length ? (rankOf(S.dealer[0]) === 1 ? 11 : cardValue(S.dealer[0])) : 0);

  const canDouble = () => { const h = cur(); return !!h && phase === 'act' && h.cards.length === 2 && !h.aceSplit && S.chips >= h.bet; };
  const canSplit = () => {
    const h = cur();
    return !!h && phase === 'act' && h.cards.length === 2 && !h.aceSplit &&
      rankOf(h.cards[0]) === rankOf(h.cards[1]) && S.hands.length < MAX_HANDS && S.chips >= h.bet;
  };
  const canSurrender = () => { const h = cur(); return !!h && phase === 'act' && S.hands.length === 1 && h.cards.length === 2 && !h.split; };

  function suggestion() {
    const h = cur();
    if (!h) return null;
    const a = strategy(h.cards, upValue(), { canDouble: canDouble(), canSplit: canSplit(), canSurrender: canSurrender() });
    return { H: 'hit', S: 'stand', D: 'double', P: 'split', R: 'surrender' }[a];
  }

  function newHand(cards, bet, split) {
    return { cards, bet, split: !!split, doubled: false, aceSplit: false, done: false, surrendered: false, outcome: '', payout: 0 };
  }

  function deal() {
    if (state !== 'play' || phase !== 'bet' || paused) return false;
    const bet = clampBet(S.bet);
    if (bet > S.chips) { endRun(false, 'Out of chips.'); return false; }
    if (!runStarted) {
      runStarted = true;
      if (window.Leaderboard) { Leaderboard.startRun(BOARD, { play: false }); Leaderboard.played(BOARD); }
    }
    clearTimers();
    if (S.pos >= S.cut) shuffle();
    phase = 'deal';
    S.bet = bet;
    S.chipsAtDeal = S.chips;
    S.chips -= bet;
    S.insurance = 0;
    S.dealer = [];
    S.down = true;
    S.active = 0;
    S.hands = [newHand([], bet, false)];
    clearTable();
    Sound.tone(660, 990, 0.06, 'square', 0.03);
    render();
    msg('Dealing…');
    const steps = [
      () => { S.hands[0].cards.push(draw()); render(); },
      () => { S.dealer.push(draw()); render(); },
      () => { S.hands[0].cards.push(draw()); render(); },
      () => { S.dealer.push(draw()); render(); },
      afterDeal,
    ];
    let i = 0;
    const next = () => { steps[i++](); if (i < steps.length) after(230, next); };
    next();
    return true;
  }

  function afterDeal() {
    if (rankOf(S.dealer[0]) === 1 && S.chips >= Math.floor(S.bet / 2)) {
      phase = 'insurance';
      render();
      msg('Dealer shows an ace — <b>insurance?</b>');
      return;
    }
    peek();
  }

  function takeInsurance(yes) {
    if (phase !== 'insurance') return false;
    if (yes) {
      S.insurance = Math.floor(S.bet / 2);
      S.chips -= S.insurance;
      Sound.tone(880, 1240, 0.05, 'square', 0.03);
    }
    render();
    peek();
    return true;
  }

  // the dealer peeks under a ten or an ace before anyone acts
  function peek() {
    const d = handValue(S.dealer);
    if (S.dealer.length === 2 && d.total === 21) {
      S.hands[0].done = true;
      msg(S.insurance ? 'Dealer blackjack — the insurance pays.' : 'Dealer has blackjack.');
      finishRound();
      return;
    }
    if (isBlackjack(S.hands[0])) {
      S.hands[0].done = true;
      Sound.arp([659, 880, 1046, 1318], 0.08, 'square', 0.05);
      msg('<b>Blackjack!</b> Paid three to two.');
      finishRound();
      return;
    }
    phase = 'act';
    render();
    msg(S.hands.length > 1 ? 'Play your hands.' : 'Your move.');
  }

  function act(a) {
    if (state !== 'play' || phase !== 'act' || paused) return false;
    const h = cur();
    if (!h) return false;
    if (a === 'hit') {
      h.cards.push(draw());
      const v = handValue(h.cards);
      if (v.total > 21) {
        h.done = true;
        h.outcome = 'bust';
        Sound.tone(300, 90, 0.36, 'sawtooth', 0.05);
      } else if (v.total === 21) h.done = true;
      if (h.done) phase = 'deal';
      render();
      if (h.done) after(560, advance);
      return true;
    }
    if (a === 'stand') { h.done = true; phase = 'deal'; render(); after(200, advance); return true; }
    if (a === 'double') {
      if (!canDouble()) return false;
      S.chips -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(draw());
      h.done = true;
      if (handValue(h.cards).total > 21) { h.outcome = 'bust'; Sound.tone(300, 90, 0.36, 'sawtooth', 0.05); }
      else Sound.tone(880, 1240, 0.05, 'square', 0.03);
      phase = 'deal';
      render();
      after(620, advance);
      return true;
    }
    if (a === 'split') {
      if (!canSplit()) return false;
      const moved = h.cards.pop();
      S.chips -= h.bet;
      h.split = true;
      const other = newHand([moved], h.bet, true);
      if (rankOf(moved) === 1) { h.aceSplit = true; other.aceSplit = true; }
      S.hands.splice(S.active + 1, 0, other);
      phase = 'deal';
      Sound.tone(700, 1050, 0.08, 'square', 0.035);
      render();
      after(280, () => {
        h.cards.push(draw());
        if (h.aceSplit || handValue(h.cards).total === 21) h.done = true;
        render();
        after(h.done ? 520 : 200, () => { if (h.done) advance(); else { phase = 'act'; render(); } });
      });
      return true;
    }
    if (a === 'surrender') {
      if (!canSurrender()) return false;
      h.surrendered = true;
      h.done = true;
      phase = 'deal';
      Sound.tone(360, 200, 0.2, 'triangle', 0.03);
      render();
      after(400, advance);
      return true;
    }
    return false;
  }

  // next unfinished hand; a fresh split hand gets its second card as it comes up
  function advance() {
    const i = S.hands.findIndex((h) => !h.done);
    if (i < 0) { finishRound(); return; }
    S.active = i;
    const h = S.hands[i];
    if (h.cards.length === 1) {
      phase = 'deal';
      render();
      after(280, () => {
        h.cards.push(draw());
        if (h.aceSplit || handValue(h.cards).total === 21) h.done = true;
        render();
        after(h.done ? 520 : 200, () => { if (h.done) advance(); else { phase = 'act'; render(); msg('Hand ' + (i + 1) + '.'); } });
      });
      return;
    }
    phase = 'act';
    render();
    if (S.hands.length > 1) msg('Hand ' + (i + 1) + '.');
  }

  function finishRound() {
    phase = 'dealer';
    S.down = false;
    render();
    const needsDealer = S.hands.some((h) => !h.surrendered && !isBlackjack(h) && handValue(h.cards).total <= 21);
    if (!needsDealer) { after(600, settle); return; }
    msg('Dealer plays.');
    const step = () => {
      if (dealerHits(S.dealer)) { S.dealer.push(draw()); render(); after(540, step); return; }
      if (handValue(S.dealer).total > 21) Sound.tone(300, 120, 0.3, 'sawtooth', 0.04);
      render();
      after(500, settle);
    };
    after(560, step);
  }

  function settle() {
    phase = 'settle';
    const d = handValue(S.dealer);
    const dbj = S.dealer.length === 2 && d.total === 21;
    for (const h of S.hands) {
      const r = settleHand(h, S.dealer);
      h.outcome = r.outcome;
      h.payout = r.payout;
      S.chips += r.payout;
      if (isBlackjack(h)) S.blackjacks++;
    }
    if (S.insurance && dbj) S.chips += S.insurance * 3;
    S.rounds++;
    const net = S.chips - S.chipsAtDeal;
    if (net > S.biggestPot) S.biggestPot = net;
    if (S.chips > S.peak) S.peak = S.chips;
    if (net > 0) Sound.arp([523, 659, 784, 1046], 0.07, 'square', 0.045);
    else if (net < 0) Sound.tone(320, 170, 0.24, 'sawtooth', 0.035);
    else Sound.tone(460, 460, 0.12, 'triangle', 0.03);
    render();
    msg(net > 0 ? `<b>+${net.toLocaleString()}</b> chips.` : net < 0 ? `<b>−${(-net).toLocaleString()}</b> chips.` : 'Push — bet returned.');
    after(1500, nextRound);
  }

  function nextRound() {
    if (state !== 'play') return;
    if (CLASSIC && S.rounds >= CLASSIC_HANDS) {
      const won = S.chips >= CLASSIC_TARGET;
      endRun(won, won
        ? `${CLASSIC_HANDS} hands, ${S.chips.toLocaleString()} chips on the table.`
        : `${CLASSIC_HANDS} hands played — ${S.chips.toLocaleString()} chips, ${(CLASSIC_TARGET - S.chips).toLocaleString()} short.`);
      return;
    }
    if (S.chips < MIN_BET) { endRun(false, 'The last chip is gone.'); return; }
    const before = tableLimit();
    phase = 'bet';
    S.bet = clampBet(S.bet);
    render();
    if (!CLASSIC && S.rounds % 25 === 0) toast(`Table limit is now ${before.toLocaleString()}`);
    msg(CLASSIC ? `Hand ${S.rounds + 1} of ${CLASSIC_HANDS} — place your bet.` : 'Place your bet.');
  }

  // ---------------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------------
  const liveScore = () => (!S ? 0 : CLASSIC ? S.chips : S.peak);

  function start() {
    clearTimers();
    Sound.init();
    $('title').hidden = true;
    $('over').hidden = true;
    $('over').classList.remove('won');
    $('paused').hidden = true;
    state = 'play';
    phase = 'bet';
    paused = false;
    runStarted = false;
    rnd = DAILY ? Daily.rng('blackjack') : Math.random;
    S = {
      chips: START_CHIPS, peak: START_CHIPS, bet: 10, rounds: 0, blackjacks: 0, biggestPot: 0,
      shoe: [], pos: 0, cut: 0, shoeNo: 0, hands: [], dealer: [], down: true, active: 0,
      insurance: 0, chipsAtDeal: START_CHIPS,
    };
    clearTable();
    shuffle();
    S.bet = clampBet(20);
    render();
    msg(CLASSIC ? `Hand 1 of ${CLASSIC_HANDS} — place your bet.` : 'Place your bet.');
  }

  function endRun(won, message) {
    if (state === 'over') return;
    clearTimers();
    state = 'over';
    phase = 'over';
    const score = liveScore();
    if (score > high) { high = score; store.set(Arcade.modeKey('blackjack.high'), high); }
    render();
    $('o-chips').textContent = S.chips.toLocaleString();
    $('o-peak').textContent = S.peak.toLocaleString();
    $('o-hands').textContent = S.rounds;
    $('o-bj').textContent = S.blackjacks;
    $('o-pot').textContent = S.biggestPot.toLocaleString();
    Arcade.endScreen(won, message);
    if (!won) Sound.tone(400, 110, 0.5, 'sawtooth', 0.045);
    $('over').hidden = false;
    if (window.Leaderboard) Leaderboard.offer(BOARD, { score, won: !!won }, $('over').querySelector('.panel'));
  }

  function pause(on) {
    if (state !== 'play') return;
    paused = on;
    $('paused').hidden = !on;
    render();
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('resume-btn').addEventListener('click', () => pause(false));
  $('new-btn').addEventListener('click', () => {
    if (state === 'play' && S && S.rounds) toast(DAILY ? 'Daily shoe restarted' : 'New run');
    start();
  });
  $('deal-btn').addEventListener('click', deal);
  $('bet-slider').addEventListener('input', (e) => setBet(+e.target.value));
  $('bet-down').addEventListener('click', () => stepBet(-1));
  $('bet-up').addEventListener('click', () => stepBet(1));
  $('bet-max').addEventListener('click', () => setBet(maxBet()));
  $('ins-yes').addEventListener('click', () => takeInsurance(true));
  $('ins-no').addEventListener('click', () => takeInsurance(false));
  document.querySelectorAll('#act-row .act').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  $('hint-btn').addEventListener('click', () => {
    hintOn = !hintOn;
    store.set(Arcade.modeKey('blackjack.hint'), hintOn);
    $('hint-btn').classList.toggle('on', hintOn);
    toast(hintOn ? 'Basic strategy hints on' : 'Basic strategy hints off');
    render();
  });
  Arcade.soundButton($('sound-btn'));
  if (window.Leaderboard) {
    if (Leaderboard.info(BOARD)) Leaderboard.button(BOARD, $('title').querySelector('.panel'), 'btn alt');
    Leaderboard.nameBar($('title').querySelector('.panel'));
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (state === 'title') { if (k === ' ' || e.key === 'Enter') { e.preventDefault(); start(); } return; }
    if (state === 'over') { if (k === ' ' || e.key === 'Enter') { e.preventDefault(); start(); } return; }
    if (e.key === 'Escape') { pause(!paused); return; }
    if (paused) return;
    if (phase === 'insurance') {
      if (k === 'y') takeInsurance(true);
      else if (k === 'n' || k === 's') takeInsurance(false);
      return;
    }
    if (k === 'h') act('hit');
    else if (k === 's') act('stand');
    else if (k === 'd') act('double');
    else if (k === 'p') { if (phase === 'act') act('split'); else pause(true); }
    else if (k === 'r') act('surrender');
    else if (k === 't') $('hint-btn').click();
    else if (k === 'm') $('sound-btn').click();
    else if (k === 'n') $('new-btn').click();
    else if (e.key === ' ') { e.preventDefault(); if (phase === 'bet') deal(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); stepBet(-1); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); stepBet(1); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play' && (phase === 'bet' || phase === 'act')) pause(true);
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => S && render(), 80); });

  $('best').textContent = high.toLocaleString();
  $('hint-btn').classList.toggle('on', hintOn);

  // ---------------------------------------------------------------------------
  // Test hook (localhost only)
  // ---------------------------------------------------------------------------
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const fast = (fn) => (...args) => { instant = true; return fn(...args); };
    window.ArcadeTest = {
      game: 'blackjack',
      start: fast(start),
      step: () => {},                                   // no animation loop: the table is driven by actions
      peek: () => ({
        state, phase, paused,
        score: liveScore(),
        chips: S ? S.chips : 0,
        bet: S ? S.bet : 0,
        limit: S ? tableLimit() : 0,
        handsPlayed: S ? S.rounds : 0,
        blackjacks: S ? S.blackjacks : 0,
        biggestPot: S ? S.biggestPot : 0,
        peak: S ? S.peak : 0,
        insurance: S ? S.insurance : 0,
        active: S ? S.active : 0,
        hands: S ? S.hands.map((h) => ({
          cards: h.cards.slice(), total: handValue(h.cards).total, soft: handValue(h.cards).soft,
          bet: h.bet, doubled: h.doubled, split: h.split, done: h.done, surrendered: h.surrendered,
          outcome: h.outcome, blackjack: isBlackjack(h),
        })) : [],
        dealer: S ? {
          cards: S.dealer.slice(), down: S.down, up: upValue(),
          total: S.down ? handValue(S.dealer.slice(0, 1)).total : handValue(S.dealer).total,
        } : { cards: [], down: true, up: 0, total: 0 },
        shoe: S ? { dealt: S.pos, size: S.shoe.length, cut: S.cut, number: S.shoeNo } : { dealt: 0, size: 0, cut: 0, number: 0 },
        hint: phase === 'act' ? suggestion() : phase === 'insurance' ? 'decline' : null,
        mode: DAILY ? 'daily' : CLASSIC ? 'classic' : 'infinite',
      }),
      set: fast((key, value) => {
        if (!S) return false;
        if (key === 'chips') { S.chips = value; S.peak = Math.max(S.peak, value); }
        else if (key === 'score' || key === 'peak') S.peak = value;
        else if (key === 'bet') S.bet = clampBet(value);
        else if (key === 'hands' || key === 'handsPlayed') S.rounds = value;
        else if (key === 'blackjacks') S.blackjacks = value;
        else return false;
        if (phase === 'bet') S.bet = clampBet(S.bet);
        render();
        return true;
      }),
      // 'deal' | 'hit' | 'stand' | 'double' | 'split' | 'surrender' | 'insure' | 'decline'
      act: fast((a) => {
        if (a === 'deal') return deal();
        if (a === 'insure') return takeInsurance(true);
        if (a === 'decline') return takeInsurance(false);
        return act(a);
      }),
      bet: fast((n) => { setBet(n); return S ? S.bet : 0; }),
      hint: () => (phase === 'act' ? suggestion() : null),
      win: fast(() => {
        if (state !== 'play') return false;
        S.chips = Math.max(S.chips, CLASSIC_TARGET + 200);
        S.peak = Math.max(S.peak, S.chips);
        if (!CLASSIC) { endRun(false, 'Run ended.'); return true; }
        S.rounds = CLASSIC_HANDS;
        endRun(true, `${CLASSIC_HANDS} hands, ${S.chips.toLocaleString()} chips on the table.`);
        return true;
      }),
      rules: { handValue, isBlackjack, dealerHits, settleHand, strategy, buildShoe },
    };
  }
})();
