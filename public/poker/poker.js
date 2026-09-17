/*
 * Video Poker — Jacks or Better on the 9/6 pay table. The chips are arcade points: there is
 * nothing to buy, nothing to deposit and nothing to cash out.
 *   Infinite (/poker/)                200 chips, hands forever; the score is the highest total reached
 *   Classic  (/poker/?mode=classic)   a 50-hand session from 100 chips; finish in profit to win
 *   Daily    (/poker/?daily=…)        Infinite rules dealt from one shoe shuffled by Daily.rng('poker'),
 *                                     so everyone sees the same cards in the same order
 * Card faces and the flip come from /solitaire/style.css so the deck matches the other card games.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const suitOf = (id) => Math.floor(id / 13);
  const rankOf = (id) => (id % 13) + 1;              // 1 = ace, 11-13 = J Q K
  const isRed = (id) => suitOf(id) === 1 || suitOf(id) === 2;

  const DAILY = !!(window.Daily && Daily.active);
  const BOARD = (window.Daily && Daily.board('poker')) || (Arcade.classic ? 'poker-classic' : 'poker');
  const Sound = Arcade.Sound;

  const START = Arcade.classic ? 100 : 200;          // chips a session starts with
  const SESSION = 50;                                // hands in a Classic session
  const MAX_BET = 5;
  const HEAT_EVERY = 30, HEAT_FOR = 5;               // Infinite: a line pays double every so often
                                                     // (rare enough that even perfect play still drifts down)
  const HIGH_KEY = Arcade.modeKey('poker.high');

  // 9/6 Jacks or Better, per chip bet. The royal keeps the classic five-chip jackpot: 250 a chip
  // up to four chips, then 4,000 (800 a chip) at max bet.
  const PAYS = [
    { name: 'ROYAL FLUSH', short: 'ROYAL', coins: [250, 500, 750, 1000, 4000] },
    { name: 'STRAIGHT FLUSH', short: 'ST FLUSH', per: 50 },
    { name: 'FOUR OF A KIND', short: '4 OF A KIND', per: 25 },
    { name: 'FULL HOUSE', short: 'FULL HOUSE', per: 9 },
    { name: 'FLUSH', short: 'FLUSH', per: 6 },
    { name: 'STRAIGHT', short: 'STRAIGHT', per: 4 },
    { name: 'THREE OF A KIND', short: '3 OF A KIND', per: 3 },
    { name: 'TWO PAIR', short: 'TWO PAIR', per: 2 },
    { name: 'JACKS OR BETTER', short: 'JACKS+', per: 1 },
  ];
  const basePay = (row, n) => (PAYS[row].coins ? PAYS[row].coins[n - 1] : PAYS[row].per * n);

  // ---------------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------------
  function shuffled(random) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  // → index into PAYS, or -1 for a losing hand
  function evaluate(ids) {
    if (ids.length !== 5) return -1;
    const ranks = ids.map(rankOf).sort((a, b) => a - b);
    const flush = ids.every((id) => suitOf(id) === suitOf(ids[0]));
    const counts = new Map();
    ranks.forEach((r) => counts.set(r, (counts.get(r) || 0) + 1));
    const groups = [...counts.values()].sort((a, b) => b - a);
    const uniq = [...counts.keys()].sort((a, b) => a - b);
    const aceHigh = uniq.length === 5 && uniq[0] === 1 && uniq[1] === 10 && uniq[4] === 13;
    const straight = (uniq.length === 5 && uniq[4] - uniq[0] === 4) || aceHigh;   // A-2-3-4-5 is already a run
    if (straight && flush) return aceHigh ? 0 : 1;
    if (groups[0] === 4) return 2;
    if (groups[0] === 3 && groups[1] === 2) return 3;
    if (flush) return 4;
    if (straight) return 5;
    if (groups[0] === 3) return 6;
    if (groups[0] === 2 && groups[1] === 2) return 7;
    for (const [r, n] of counts) if (n === 2 && (r === 1 || r >= 11)) return 8;
    return -1;
  }

  // ---------------------------------------------------------------------------
  // Run state
  // ---------------------------------------------------------------------------
  let state = 'title';        // 'title' | 'play' | 'over'
  let phase = 'bet';          // 'bet' = ready to deal · 'draw' = holds are live
  let paused = false, busy = false;
  let chips = START, bet = MAX_BET, hands = 0, best = START, bestHand = -1, biggestWin = 0;
  let hand = [], holds = [false, false, false, false, false], deck = [], drawn = 0;
  let heatRow = -1, heatLeft = 0;
  let last = null;            // { row, name, win, hot } for the last settled hand
  let rnd = Math.random, heatRnd = Math.random;
  let runToken = 0;           // pending flips from an old hand are ignored after a restart
  let runStart = 0;

  const score = () => (Arcade.classic ? chips : best);
  const elapsed = () => (runStart ? (performance.now() - runStart) / 1000 : 0);

  // ---------------------------------------------------------------------------
  // DOM: the pay table and five seats that keep their card element
  // ---------------------------------------------------------------------------
  const payCells = [], payRows = [];
  const table = $('paytable');
  PAYS.forEach((p, row) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = p.name;
    tr.appendChild(name);
    const cells = [];
    for (let b = 1; b <= MAX_BET; b++) {
      const td = document.createElement('td');
      td.className = 'pay';
      td.textContent = basePay(row, b).toLocaleString();
      tr.appendChild(td);
      cells.push(td);
    }
    table.appendChild(tr);
    payRows.push(tr);
    payCells.push(cells);
  });

  const seats = [], cardEls = [], holdEls = [];
  for (let i = 0; i < 5; i++) {
    const seat = document.createElement('div');
    seat.className = 'seat';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = '<div class="inner"><div class="face"></div><div class="back"></div></div>';
    const hold = document.createElement('button');
    hold.className = 'hold';
    hold.type = 'button';
    hold.textContent = 'HOLD';
    hold.setAttribute('aria-label', `Hold card ${i + 1}`);
    seat.append(card, hold);
    $('hand').appendChild(seat);
    card.addEventListener('click', () => toggleHold(i));
    hold.addEventListener('click', () => toggleHold(i));
    seats.push(seat);
    cardEls.push(card);
    holdEls.push(hold);
  }

  function setFace(i, id) {
    const r = rankOf(id), s = SUITS[suitOf(id)];
    const face = cardEls[i].querySelector('.face');
    face.className = 'face' + (isRed(id) ? ' red' : '');
    face.innerHTML =
      `<div class="corner tl"><span class="r">${RANKS[r]}</span><span class="s">${s}</span></div>` +
      (r > 10 ? `<div class="pip court">${RANKS[r]}<i>${s}</i></div>` : `<div class="pip">${s}</div>`) +
      `<div class="corner br"><span class="r">${RANKS[r]}</span><span class="s">${s}</span></div>`;
  }

  // Turn a card face down, then flip it up after `delay` ms with a click
  function flip(i, id, delay) {
    const token = runToken;
    cardEls[i].classList.remove('up');
    setFace(i, id);
    setTimeout(() => {
      if (token !== runToken) return;
      cardEls[i].classList.add('up');
      Sound.tone(560 + i * 30, 380, 0.05, 'square', 0.02);
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Display
  // ---------------------------------------------------------------------------
  let shown = START, roll = 0;
  function rollChips() {
    cancelAnimationFrame(roll);
    const step = () => {
      const diff = chips - shown;
      if (Math.abs(diff) < 1) {
        shown = chips;
        $('chips').textContent = chips.toLocaleString();
        return;
      }
      const next = shown + diff * 0.18 + Math.sign(diff);
      shown = diff > 0 ? Math.min(next, chips) : Math.max(next, chips);
      $('chips').textContent = Math.round(shown).toLocaleString();
      roll = requestAnimationFrame(step);
    };
    step();
  }

  function banner(text, win) {
    const el = $('banner');
    el.innerHTML = text;
    el.classList.toggle('paid', !!win);
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  function render() {
    if (chips < bet) bet = Math.max(1, Math.min(MAX_BET, chips));
    rollChips();
    $('bet').textContent = bet;
    $('bet-hud').textContent = 'BET ' + bet;
    $('hands').textContent = Arcade.classic ? `HAND ${hands}/${SESSION}` : `HAND ${hands}`;
    $('besthand').textContent = 'BEST ' + (bestHand < 0 ? '—' : PAYS[bestHand].short);
    $('high').textContent = Arcade.store.get(HIGH_KEY, 0).toLocaleString();
    $('heat').textContent = heatLeft > 0 ? `🔥 ${PAYS[heatRow].short} x2 · ${heatLeft}` : '';
    $('cabinet').classList.toggle('hot', heatLeft > 0);
    $('deal-btn').textContent = phase === 'draw' ? 'DRAW' : 'DEAL';
    $('deal-btn').disabled = state !== 'play' || busy;
    ['bet-up', 'bet-down', 'bet-max'].forEach((id) => { $(id).disabled = state !== 'play' || phase === 'draw' || busy; });
    $('hand').classList.toggle('locked', phase !== 'draw' || busy);
    seats.forEach((s, i) => {
      s.classList.toggle('held', !!holds[i] && phase === 'draw');
      holdEls[i].textContent = holds[i] && phase === 'draw' ? 'HELD' : 'HOLD';
    });
    payRows.forEach((tr, row) => {
      tr.classList.toggle('hot', heatLeft > 0 && row === heatRow);
      payCells[row].forEach((td, b) => td.classList.toggle('on', b === bet - 1));
    });
  }

  // ---------------------------------------------------------------------------
  // Playing a hand
  // ---------------------------------------------------------------------------
  function toggleHold(i) {
    if (state !== 'play' || phase !== 'draw' || busy || paused) return;
    holds[i] = !holds[i];
    Sound.tone(holds[i] ? 880 : 520, holds[i] ? 1180 : 400, 0.05, 'square', 0.03);
    render();
  }

  function setBet(v) {
    if (state !== 'play' || phase === 'draw' || busy) return;
    const next = Math.max(1, Math.min(Math.min(MAX_BET, Math.max(1, chips)), v));
    if (next === bet) return;
    bet = next;
    Sound.tone(420, 620, 0.05, 'square', 0.03);
    render();
  }

  function dealOrDraw() {
    if (state !== 'play' || busy || paused) return;
    if (phase === 'draw') draw(); else deal();
  }

  function deal() {
    if (chips < 1) return;
    // the machine deals before the player acts, so the play is counted on the first hand
    if (hands === 0) {
      runStart = performance.now();
      if (window.Leaderboard) {
        Leaderboard.startRun(BOARD, { play: false });
        Leaderboard.played(BOARD);
      }
    }
    if (chips < bet) bet = chips;
    chips -= bet;
    deck = shuffled(rnd);
    hand = deck.slice(0, 5);
    drawn = 5;
    holds = [false, false, false, false, false];
    last = null;
    phase = 'draw';
    busy = true;
    payRows.forEach((tr) => tr.classList.remove('paid'));
    banner('HOLD WHAT YOU WANT TO KEEP');
    Sound.noise(0.18, 0.035, 0, 1400);
    hand.forEach((id, i) => flip(i, id, 70 + i * 80));
    const token = runToken;
    setTimeout(() => { if (token === runToken) { busy = false; render(); } }, 70 + 5 * 80);
    render();
  }

  function draw() {
    const replaced = [];
    for (let i = 0; i < 5; i++) if (!holds[i]) { hand[i] = deck[drawn++]; replaced.push(i); }
    busy = true;
    render();
    replaced.forEach((i, k) => flip(i, hand[i], 60 + k * 80));
    const token = runToken;
    setTimeout(() => { if (token === runToken) settle(); }, replaced.length ? 60 + replaced.length * 80 + 240 : 200);
  }

  function settle() {
    const row = evaluate(hand);
    const hot = heatLeft > 0 && row === heatRow;
    const win = row < 0 ? 0 : basePay(row, bet) * (hot ? 2 : 1);
    chips += win;
    hands++;
    if (win > 0) {
      if (bestHand < 0 || row < bestHand) bestHand = row;
      if (win > biggestWin) biggestWin = win;
    }
    if (chips > best) best = chips;
    last = { row, name: row < 0 ? 'NO PAY' : PAYS[row].name, win, hot };
    phase = 'bet';
    busy = false;
    if (heatLeft > 0) heatLeft--;
    if (!Arcade.classic && hands % HEAT_EVERY === 0) heatUp();

    if (win > 0) {
      payRows[row].classList.add('paid');
      banner(`${PAYS[row].name}${hot ? ' 🔥 x2' : ''}<b>+${win.toLocaleString()} CHIPS</b>`, true);
      fanfare(row);
    } else {
      banner('NO PAY · DEAL AGAIN');
      Sound.tone(300, 140, 0.26, 'sawtooth', 0.03);
    }
    render();
    checkEnd();
  }

  function fanfare(row) {
    if (row >= 7) Sound.arp([659, 880], 0.08, 'square', 0.04);                               // pair / two pair
    else if (row >= 4) Sound.arp([523, 659, 784, 1046], 0.07, 'square', 0.045);              // trips → flush
    else if (row >= 2) Sound.arp([523, 659, 784, 1046, 1318, 1568], 0.07, 'square', 0.05);   // full house / quads
    else {
      Sound.arp([523, 659, 784, 1046, 1318, 1568, 2093], 0.09, 'square', 0.055);
      Sound.arp([784, 1046, 1318, 1568, 2093], 0.09, 'triangle', 0.04);
    }
  }

  function heatUp() {
    heatRow = 1 + Math.floor(heatRnd() * (PAYS.length - 1));   // any line but the royal jackpot
    heatLeft = HEAT_FOR;
    Arcade.toast(`🔥 ${PAYS[heatRow].name} pays double for ${HEAT_FOR} hands`);
    Sound.arp([392, 523, 659, 880], 0.07, 'triangle', 0.045);
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
    runToken++;
    state = 'play';
    phase = 'bet';
    paused = false;
    busy = false;
    chips = START;
    shown = START;
    bet = MAX_BET;
    hands = 0;
    best = START;
    bestHand = -1;
    biggestWin = 0;
    hand = [];
    deck = [];
    drawn = 0;
    holds = [false, false, false, false, false];
    heatRow = -1;
    heatLeft = 0;
    last = null;
    runStart = 0;
    rnd = DAILY ? Daily.rng('poker') : Math.random;
    heatRnd = DAILY ? Daily.rng('poker-heat') : Math.random;
    cardEls.forEach((el) => el.classList.remove('up'));
    payRows.forEach((tr) => tr.classList.remove('paid'));
    banner(Arcade.classic ? `${SESSION} HANDS · PLACE YOUR BET` : 'PLACE YOUR BET');
    render();
  }

  function endRun(won) {
    if (state === 'over') return;
    state = 'over';
    phase = 'bet';
    busy = false;
    const sc = score();
    $('o-chips').textContent = chips.toLocaleString();
    $('o-best').textContent = bestHand < 0 ? '—' : PAYS[bestHand].short;
    $('o-hands').textContent = hands;
    $('o-win').textContent = biggestWin.toLocaleString();
    if (sc > Arcade.store.get(HIGH_KEY, 0)) {
      Arcade.store.set(HIGH_KEY, sc);
      Arcade.toast('New best: ' + sc.toLocaleString() + ' chips');
    }
    const done = Arcade.classic && hands >= SESSION;
    Arcade.endScreen(won, won
      ? `${SESSION} hands, ${chips.toLocaleString()} chips — ${(chips - START).toLocaleString()} up on the machine.`
      : done ? `${SESSION} hands played and ${chips.toLocaleString()} chips left. You needed more than ${START}.`
        : `The last chip went in after ${hands} hands.`);
    const h = $('over').querySelector('h1');
    if (!won && done) h.textContent = 'SESSION OVER';
    if (!won) Sound.tone(360, 90, 0.6, 'sawtooth', 0.045);
    $('over').hidden = false;
    render();
    if (window.Leaderboard) {
      Leaderboard.offer(BOARD, { score: sc, won, time: elapsed() }, $('over').querySelector('.panel'));
    }
  }

  function checkEnd() {
    if (Arcade.classic && hands >= SESSION) { endRun(chips > START); return; }
    if (chips < 1) endRun(false);
  }

  function pause(on) {
    if (state !== 'play') return;
    paused = on;
    $('paused').hidden = !on;
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  $('play-btn').addEventListener('click', start);
  $('again-btn').addEventListener('click', start);
  $('resume-btn').addEventListener('click', () => pause(false));
  $('deal-btn').addEventListener('click', dealOrDraw);
  $('bet-up').addEventListener('click', () => setBet(bet + 1));
  $('bet-down').addEventListener('click', () => setBet(bet - 1));
  $('bet-max').addEventListener('click', () => setBet(MAX_BET));
  Arcade.soundButton($('sound-btn'));
  if (window.Leaderboard) {
    if (Leaderboard.info(BOARD)) Leaderboard.button(BOARD, $('title').querySelector('.panel'), 'btn alt');
    Leaderboard.nameBar($('title').querySelector('.panel'));
  }

  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    const k = e.key.toLowerCase();
    if (e.key >= '1' && e.key <= '5') { toggleHold(+e.key - 1); return; }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'title') start();
      else if (state === 'over') start();
      else dealOrDraw();
    } else if (e.key === '+' || e.key === '=') setBet(bet + 1);
    else if (e.key === '-' || e.key === '_') setBet(bet - 1);
    else if (k === 'm') $('sound-btn').click();
    else if (k === 'p' || e.key === 'Escape') pause(!paused);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(true); });

  render();

  // ---------------------------------------------------------------------------
  // Test hook (localhost only)
  // ---------------------------------------------------------------------------
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    const label = (id) => RANKS[rankOf(id)] + SUITS[suitOf(id)];
    window.ArcadeTest = {
      game: 'poker',
      start,
      step: () => {},                       // event driven: deal() and hold() drive the game
      peek: () => ({
        state, phase, score: score(), chips, bet, hands, best,
        hand: hand.map(label), cards: hand.slice(), holds: holds.slice(),
        bestHand: bestHand < 0 ? null : PAYS[bestHand].name,
        biggestWin, heat: heatLeft > 0 ? { row: PAYS[heatRow].name, left: heatLeft } : null,
        last: last ? { hand: last.name, win: last.win, doubled: !!last.hot } : null,
        mode: DAILY ? 'daily' : Arcade.classic ? 'classic' : 'infinite',
      }),
      set: (key, value) => {
        if (key === 'chips') { chips = value; if (chips > best) best = chips; }
        else if (key === 'score' || key === 'best') best = value;
        else if (key === 'bet') bet = Math.max(1, Math.min(MAX_BET, value));
        else if (key === 'hands') hands = value;
        else if (key === 'heat') { heatRow = Math.max(1, Math.min(PAYS.length - 1, value)); heatLeft = HEAT_FOR; }
        else return false;
        render();
        return true;
      },
      hold: (i) => {
        if (state !== 'play' || phase !== 'draw' || i < 0 || i > 4) return false;
        holds[i] = !holds[i];
        render();
        return holds[i];
      },
      // deal or draw without waiting for the flip animation
      deal: () => {
        if (state !== 'play' || paused) return false;
        if (phase === 'draw') {
          for (let i = 0; i < 5; i++) if (!holds[i]) { hand[i] = deck[drawn++]; }
          hand.forEach((id, i) => { setFace(i, id); cardEls[i].classList.add('up'); });
          settle();
        } else {
          busy = false;
          deal();
          busy = false;
        }
        return true;
      },
      evaluate: (ids) => { const r = evaluate(ids); return r < 0 ? null : PAYS[r].name; },
      // jump to a winning finish (Classic): a session's worth of hands, well in profit
      win: () => {
        if (state !== 'play') return false;
        if (!Arcade.classic) { chips = Math.max(chips, best) + 5000; best = chips; render(); return true; }
        hands = SESSION;
        chips = START + 500;
        best = Math.max(best, chips);
        if (bestHand < 0) bestHand = 2;
        biggestWin = Math.max(biggestWin, 500);
        render();
        endRun(true);
        return true;
      },
    };
  }
})();
