(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const board = $('board');

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const suitOf = (id) => Math.floor(id / 13);
  const rankOf = (id) => (id % 13) + 1;
  const isRed = (id) => suitOf(id) === 1 || suitOf(id) === 2;

  let S; // game state (serialisable for undo)
  let history = [];
  let elapsed = 0, timerOn = false, lastTick = 0;
  let L = {}; // layout
  let drag = null;
  let autoRunning = false;
  let drawMode = 1;
  try { drawMode = +localStorage.getItem('sol.draw') || 1; } catch (e) { /* ignore */ }
  const DAILY = !!(window.Daily && Daily.active);
  if (DAILY) drawMode = 1; // daily deal is always Draw 1
  $('draw-mode').value = String(drawMode);

  // ---------------------------------------------------------------------------
  // DOM: 52 persistent card elements + slots
  // ---------------------------------------------------------------------------
  const cardEls = [];
  for (let id = 0; id < 52; id++) {
    const r = rankOf(id), s = SUITS[suitOf(id)];
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = id;
    const center = r > 10 ? `<div class="pip court">${RANKS[r]}<i>${s}</i></div>` : `<div class="pip">${r === 1 ? s : s}</div>`;
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
  const mkSlot = (cls, label = '') => {
    const d = document.createElement('div');
    d.className = 'slot ' + cls;
    d.textContent = label;
    board.insertBefore(d, board.firstChild);
    return d;
  };
  const stockSlot = mkSlot('stock');
  const wasteSlot = mkSlot('waste');
  const foundSlots = SUITS.map((s) => mkSlot('found', s));
  const tabSlots = Array.from({ length: 7 }, () => mkSlot('tab'));

  // ---------------------------------------------------------------------------
  // Game setup
  // ---------------------------------------------------------------------------
  function newGame() {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const shuffleRandom = DAILY ? Daily.rng('klondike') : Math.random;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(shuffleRandom() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    S = { stock: [], waste: [], found: [[], [], [], []], tab: [[], [], [], [], [], [], []], up: Array(52).fill(false), score: 0, moves: 0 };
    for (let c = 0; c < 7; c++) {
      for (let k = 0; k <= c; k++) S.tab[c].push(deck.pop());
      S.up[S.tab[c][c]] = true;
    }
    S.stock = deck;
    history = [];
    elapsed = 0;
    timerOn = false;
    autoRunning = false;
    $('win').hidden = true;
    stopCelebration();
    // start every card at the stock position so the deal animates
    layout();
    cardEls.forEach((el) => { el.classList.add('no-anim'); el.classList.remove('up'); el.style.left = L.x[0] + 'px'; el.style.top = L.topY + 'px'; });
    void board.offsetWidth;
    cardEls.forEach((el) => el.classList.remove('no-anim'));
    render(true);
  }

  const snapshot = () => JSON.stringify(S);
  function pushHistory() {
    history.push(snapshot());
    if (history.length > 300) history.shift();
  }
  function undo() {
    if (!history.length || autoRunning) return;
    S = JSON.parse(history.pop());
    S.moves++;
    render();
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  function locate(id) {
    if (S.stock.includes(id)) return { type: 'stock', i: 0, idx: S.stock.indexOf(id) };
    if (S.waste.includes(id)) return { type: 'waste', i: 0, idx: S.waste.indexOf(id) };
    for (let i = 0; i < 4; i++) { const k = S.found[i].indexOf(id); if (k >= 0) return { type: 'found', i, idx: k }; }
    for (let i = 0; i < 7; i++) { const k = S.tab[i].indexOf(id); if (k >= 0) return { type: 'tab', i, idx: k }; }
    return null;
  }
  const pileArr = (loc) => (loc.type === 'stock' ? S.stock : loc.type === 'waste' ? S.waste : loc.type === 'found' ? S.found[loc.i] : S.tab[loc.i]);
  const top = (arr) => arr[arr.length - 1];

  function canTab(id, col) {
    const p = S.tab[col];
    if (!p.length) return rankOf(id) === 13;
    const t = top(p);
    return S.up[t] && isRed(t) !== isRed(id) && rankOf(t) === rankOf(id) + 1;
  }
  function canFound(id, f) {
    const p = S.found[f];
    if (!p.length) return rankOf(id) === 1;
    const t = top(p);
    return suitOf(t) === suitOf(id) && rankOf(t) + 1 === rankOf(id);
  }
  function foundationFor(id) {
    const pref = S.found.findIndex((p) => p.length && suitOf(p[0]) === suitOf(id));
    if (pref >= 0) return canFound(id, pref) ? pref : -1;
    if (rankOf(id) !== 1) return -1;
    return S.found.findIndex((p) => !p.length);
  }

  function movable(loc) {
    if (!loc) return false;
    const arr = pileArr(loc);
    if (loc.type === 'waste' || loc.type === 'found') return loc.idx === arr.length - 1;
    if (loc.type === 'tab') return S.up[arr[loc.idx]];
    return false;
  }

  function legalTarget(loc, target) {
    const arr = pileArr(loc);
    const id = arr[loc.idx];
    const count = arr.length - loc.idx;
    if (target.type === 'found') return count === 1 && canFound(id, target.i) && !(loc.type === 'found' && loc.i === target.i);
    if (target.type === 'tab') return !(loc.type === 'tab' && loc.i === target.i) && canTab(id, target.i);
    return false;
  }

  function doMove(loc, target) {
    pushHistory();
    startTimer();
    const arr = pileArr(loc);
    const cards = arr.splice(loc.idx);
    const dest = target.type === 'found' ? S.found[target.i] : S.tab[target.i];
    dest.push(...cards);
    if (target.type === 'found') S.score += loc.type === 'found' ? 0 : 10;
    if (target.type === 'tab') {
      if (loc.type === 'waste') S.score += 5;
      if (loc.type === 'found') S.score = Math.max(0, S.score - 15);
    }
    if (loc.type === 'tab' && arr.length && !S.up[top(arr)]) {
      S.up[top(arr)] = true;
      S.score += 5;
    }
    S.moves++;
    render();
    checkWin();
  }

  function drawStock() {
    if (autoRunning) return;
    if (!S.stock.length && !S.waste.length) return;
    pushHistory();
    startTimer();
    if (S.stock.length) {
      const n = Math.min(drawMode, S.stock.length);
      for (let k = 0; k < n; k++) {
        const id = S.stock.pop();
        S.up[id] = true;
        S.waste.push(id);
      }
    } else {
      while (S.waste.length) {
        const id = S.waste.pop();
        S.up[id] = false;
        S.stock.push(id);
      }
      S.score = Math.max(0, S.score - (drawMode === 1 ? 100 : 20));
    }
    S.moves++;
    render();
  }

  function autoMove(loc) {
    const arr = pileArr(loc);
    const id = arr[loc.idx];
    if (loc.idx === arr.length - 1 && loc.type !== 'found') {
      const f = foundationFor(id);
      if (f >= 0) return doMove(loc, { type: 'found', i: f });
    }
    // prefer non-empty columns, then empty ones (skip pointless king shuffles)
    const order = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => (S.tab[b].length > 0) - (S.tab[a].length > 0));
    for (const c of order) {
      if (loc.type === 'tab' && loc.idx === 0 && !S.tab[c].length) continue;
      if (legalTarget(loc, { type: 'tab', i: c })) return doMove(loc, { type: 'tab', i: c });
    }
    const el = cardEls[id];
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function checkWin() {
    if (S.found.every((p) => p.length === 13)) {
      timerOn = false;
      setTimeout(win, 400);
      return;
    }
    const canAuto = !S.stock.length && !S.waste.length && S.tab.every((p) => p.every((id) => S.up[id]));
    $('auto-btn').hidden = !canAuto || autoRunning;
  }

  function autoComplete() {
    if (autoRunning) return;
    autoRunning = true;
    $('auto-btn').hidden = true;
    const step = () => {
      if (!autoRunning) return;
      let best = null;
      for (let c = 0; c < 7; c++) {
        const p = S.tab[c];
        if (!p.length) continue;
        const id = top(p);
        const f = foundationFor(id);
        if (f >= 0 && (!best || rankOf(id) < rankOf(best.id))) best = { id, c, f };
      }
      if (!best) { autoRunning = false; checkWin(); return; }
      autoRunning = false;
      doMove({ type: 'tab', i: best.c, idx: S.tab[best.c].length - 1 }, { type: 'found', i: best.f });
      if (S.found.every((p) => p.length === 13)) return;
      autoRunning = true;
      setTimeout(step, 90);
    };
    step();
  }

  // ---------------------------------------------------------------------------
  // Hints
  // ---------------------------------------------------------------------------
  function findHint() {
    const cands = [];
    for (let c = 0; c < 7; c++) {
      const p = S.tab[c];
      if (!p.length) continue;
      const f = foundationFor(top(p));
      if (f >= 0) return { src: top(p), target: { type: 'found', i: f } };
    }
    if (S.waste.length) {
      const f = foundationFor(top(S.waste));
      if (f >= 0) return { src: top(S.waste), target: { type: 'found', i: f } };
    }
    for (let c = 0; c < 7; c++) {
      const p = S.tab[c];
      const first = p.findIndex((id) => S.up[id]);
      if (first < 0) continue;
      for (let d = 0; d < 7; d++) {
        if (d === c) continue;
        const loc = { type: 'tab', i: c, idx: first };
        if (!legalTarget(loc, { type: 'tab', i: d })) continue;
        if (first === 0 && !S.tab[d].length) continue; // king to empty from empty base: pointless
        cands.push({ src: p[first], target: { type: 'tab', i: d }, good: first > 0 });
      }
    }
    const good = cands.find((m) => m.good);
    if (good) return good;
    if (S.waste.length) {
      const loc = { type: 'waste', i: 0, idx: S.waste.length - 1 };
      for (let d = 0; d < 7; d++) if (legalTarget(loc, { type: 'tab', i: d })) return { src: top(S.waste), target: { type: 'tab', i: d } };
    }
    if (cands.length) return cands[0];
    if (S.stock.length || S.waste.length) return { stock: true };
    return null;
  }

  function showHint() {
    clearHints();
    const h = findHint();
    if (!h) { flashMsg('No moves left — try Undo or New game'); return; }
    if (h.stock) { stockSlot.classList.add('hint'); if (S.stock.length) cardEls[top(S.stock)].classList.add('hint'); }
    else {
      cardEls[h.src].classList.add('hint');
      const arr = h.target.type === 'found' ? S.found[h.target.i] : S.tab[h.target.i];
      if (arr.length) cardEls[top(arr)].classList.add('hint');
      else (h.target.type === 'found' ? foundSlots : tabSlots)[h.target.i].classList.add('hint');
    }
    setTimeout(clearHints, 1500);
  }
  function clearHints() { document.querySelectorAll('.hint').forEach((e) => e.classList.remove('hint')); }
  function flashMsg(msg) {
    const b = $('auto-btn');
    const was = b.hidden;
    const txt = b.textContent;
    b.textContent = msg; b.hidden = false; b.disabled = true;
    setTimeout(() => { b.textContent = txt; b.disabled = false; b.hidden = was; checkWin(); }, 1800);
  }

  // ---------------------------------------------------------------------------
  // Layout & render
  // ---------------------------------------------------------------------------
  function layout() {
    const bw = Math.min(window.innerWidth, 1000);
    const gap = Math.max(5, Math.round(bw * 0.014));
    const cw = Math.floor(Math.min(112, (bw - gap * 8) / 7));
    const ch = Math.round(cw * 1.4);
    const total = cw * 7 + gap * 6;
    const left = (bw - total) / 2;
    const x = Array.from({ length: 7 }, (_, i) => Math.round(left + i * (cw + gap)));
    const topY = gap + 6;
    const tabY = topY + ch + gap * 2;
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
    const header = document.querySelector('.bar').offsetHeight;
    const availH = window.innerHeight - header - tabY - ch - 24;
    L = { cw, ch, gap, x, topY, tabY, availH };
  }

  function tabOffsets(col) {
    const p = S.tab[col];
    let down = L.ch * 0.1, up = L.ch * 0.26;
    const nDown = p.filter((id) => !S.up[id]).length;
    const nUp = Math.max(0, p.length - nDown - 1);
    const need = nDown * down + nUp * up;
    if (need > L.availH && need > 0) {
      const k = Math.max(0.35, L.availH / need);
      down *= k; up *= k;
    }
    return { down, up };
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
    layout();
    const { cw, ch, x, topY, tabY } = L;
    const setSlot = (el, sx, sy) => { el.style.left = sx + 'px'; el.style.top = sy + 'px'; el.style.width = cw + 'px'; el.style.height = ch + 'px'; };
    setSlot(stockSlot, x[0], topY);
    setSlot(wasteSlot, x[1], topY);
    wasteSlot.style.visibility = 'hidden';
    foundSlots.forEach((el, i) => setSlot(el, x[3 + i], topY));
    tabSlots.forEach((el, i) => setSlot(el, x[i], tabY));
    stockSlot.classList.toggle('empty-final', !S.stock.length && !S.waste.length);

    S.stock.forEach((id, k) => place(id, x[0], topY, 10 + k, false, instant));

    const fanN = drawMode === 3 ? 3 : 1;
    const wl = S.waste.length;
    S.waste.forEach((id, k) => {
      const fromTop = wl - 1 - k;
      const slotIdx = fromTop < fanN ? Math.min(fanN, wl) - 1 - fromTop : 0;
      place(id, x[1] + slotIdx * Math.round(cw * 0.24), topY, 100 + k, true, instant);
    });

    S.found.forEach((p, i) => p.forEach((id, k) => place(id, x[3 + i], topY, 200 + k, true, instant)));

    let maxBottom = tabY + ch;
    S.tab.forEach((p, c) => {
      const { down, up } = tabOffsets(c);
      let y = tabY;
      p.forEach((id, k) => {
        place(id, x[c], Math.round(y), 300 + k, S.up[id], instant);
        y += S.up[id] ? up : down;
      });
      if (p.length) maxBottom = Math.max(maxBottom, y - (S.up[top(p)] ? up : down) + ch);
    });
    board.style.height = maxBottom + 40 + 'px';

    $('score').textContent = S.score;
    $('moves').textContent = S.moves;
    $('undo-btn').disabled = !history.length;
    checkWin();
  }

  // ---------------------------------------------------------------------------
  // Pointer interaction (drag & click)
  // ---------------------------------------------------------------------------
  board.addEventListener('pointerdown', (e) => {
    if (autoRunning || e.button > 0) return;
    clearHints();
    const cardEl = e.target.closest('.card');
    if (!cardEl) {
      if (e.target === stockSlot) drawStock();
      return;
    }
    const id = +cardEl.dataset.id;
    const loc = locate(id);
    if (loc.type === 'stock') { drawStock(); return; }
    if (!movable(loc)) return;
    const arr = pileArr(loc);
    const ids = arr.slice(loc.idx);
    drag = {
      loc, ids, startX: e.clientX, startY: e.clientY, active: false,
      origin: ids.map((cid) => ({ left: parseFloat(cardEls[cid].style.left), top: parseFloat(cardEls[cid].style.top) })),
    };
    board.setPointerCapture(e.pointerId);
  });

  board.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) < 6) return;
    if (!drag.active) {
      drag.active = true;
      drag.ids.forEach((cid, k) => {
        const el = cardEls[cid];
        clearTimeout(el._zt); el._zt = null;
        el.classList.add('dragging');
        el.style.zIndex = 5000 + k;
      });
    }
    drag.ids.forEach((cid, k) => {
      const el = cardEls[cid];
      el.style.left = drag.origin[k].left + dx + 'px';
      el.style.top = drag.origin[k].top + dy + 'px';
    });
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.ids.forEach((cid) => cardEls[cid].classList.remove('dragging'));
    if (!d.active) { autoMove(d.loc); return; }
    const lead = cardEls[d.ids[0]];
    const r = { x: parseFloat(lead.style.left), y: parseFloat(lead.style.top), w: L.cw, h: L.ch };
    const targets = [];
    for (let i = 0; i < 4; i++) targets.push({ type: 'found', i, rect: { x: L.x[3 + i], y: L.topY, w: L.cw, h: L.ch } });
    for (let i = 0; i < 7; i++) {
      const p = S.tab[i];
      let rect = { x: L.x[i], y: L.tabY, w: L.cw, h: L.ch };
      if (p.length && !(d.loc.type === 'tab' && d.loc.i === i)) {
        const tEl = cardEls[top(p)];
        const ty = parseFloat(tEl.style.top);
        rect = { x: L.x[i], y: L.tabY, w: L.cw, h: ty - L.tabY + L.ch };
      }
      targets.push({ type: 'tab', i, rect });
    }
    let best = null, bestA = 0;
    for (const t of targets) {
      const ox = Math.max(0, Math.min(r.x + r.w, t.rect.x + t.rect.w) - Math.max(r.x, t.rect.x));
      const oy = Math.max(0, Math.min(r.y + r.h, t.rect.y + t.rect.h) - Math.max(r.y, t.rect.y));
      const a = ox * oy;
      if (a > bestA && legalTarget(d.loc, t)) { bestA = a; best = t; }
    }
    if (best) doMove(d.loc, best);
    else render();
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------------------
  // Timer, win, controls
  // ---------------------------------------------------------------------------
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function startTimer() { if (!timerOn && !S.found.every((p) => p.length === 13)) { timerOn = true; lastTick = performance.now(); } }
  setInterval(() => {
    if (timerOn && !document.hidden) {
      const now = performance.now();
      elapsed += (now - lastTick) / 1000;
      lastTick = now;
    } else lastTick = performance.now();
    $('time').textContent = fmt(elapsed);
  }, 250);

  function win() {
    $('auto-btn').hidden = true;
    let rec = '';
    try {
      const key = 'sol.best' + drawMode;
      const best = JSON.parse(localStorage.getItem(key) || 'null');
      const wins = (+localStorage.getItem('sol.wins') || 0) + 1;
      localStorage.setItem('sol.wins', String(wins));
      if (!best || elapsed < best.time) {
        localStorage.setItem(key, JSON.stringify({ time: elapsed, score: S.score }));
        rec = `🏆 New best time for Draw ${drawMode}!  ·  Games won: ${wins}`;
      } else rec = `Best Draw ${drawMode} time: ${fmt(best.time)}  ·  Games won: ${wins}`;
    } catch (e) { /* ignore */ }
    $('win-score').textContent = S.score;
    $('win-time').textContent = fmt(elapsed);
    $('win-moves').textContent = S.moves;
    $('win-record').textContent = rec;
    celebrate(() => {
      $('win').hidden = false;
      if (window.Leaderboard) Leaderboard.offer(Daily.board('klondike') || `klondike-${drawMode}`, { score: S.score, time: elapsed, won: true }, document.querySelector('#win .win-panel'));
    });
  }

  // Classic bouncing-card cascade
  let celebRaf = 0, celebDone = null;
  function celebrate(done) {
    const cv = $('celebrate');
    const cx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    cv.hidden = false;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const header = document.querySelector('.bar').offsetHeight;
    const queue = [];
    for (let r = 12; r >= 0; r--) for (let f = 0; f < 4; f++) queue.push({ id: S.found[f][r], f });
    let cur = null;
    const cw = L.cw, ch = L.ch;
    const boardLeft = board.getBoundingClientRect().left;
    celebDone = done;
    function drawCardAt(id, x, y) {
      cx.fillStyle = '#fffef9';
      cx.strokeStyle = '#555';
      cx.lineWidth = 1;
      cx.beginPath();
      if (cx.roundRect) cx.roundRect(x, y, cw, ch, cw * 0.08); else cx.rect(x, y, cw, ch);
      cx.fill(); cx.stroke();
      cx.fillStyle = isRed(id) ? '#c8102e' : '#1b1b1b';
      cx.font = `bold ${Math.round(cw * 0.22)}px Georgia, serif`;
      cx.textAlign = 'left'; cx.textBaseline = 'top';
      cx.fillText(RANKS[rankOf(id)], x + cw * 0.07, y + cw * 0.06);
      cx.font = `${Math.round(cw * 0.5)}px Georgia, serif`;
      cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText(SUITS[suitOf(id)], x + cw / 2, y + ch / 2);
    }
    cardEls.forEach((el) => { el.style.visibility = 'hidden'; });
    function tick() {
      if (!cur) {
        const next = queue.shift();
        if (!next) { stopCelebration(); done(); return; }
        const dir = Math.random() < 0.5 ? -1 : 1;
        cur = { ...next, x: boardLeft + L.x[3 + next.f], y: header + L.topY, vx: dir * (2 + Math.random() * 5), vy: -Math.random() * 6 };
      }
      for (let s = 0; s < 2; s++) {
        cur.vy += 0.5;
        cur.x += cur.vx;
        cur.y += cur.vy;
        if (cur.y + ch > innerHeight) { cur.y = innerHeight - ch; cur.vy *= -0.78; }
        drawCardAt(cur.id, cur.x, cur.y);
        if (cur.x < -cw || cur.x > innerWidth) { cur = null; break; }
      }
      celebRaf = requestAnimationFrame(tick);
    }
    cv.onclick = () => { stopCelebration(); if (celebDone) { const d = celebDone; celebDone = null; d(); } };
    tick();
  }
  function stopCelebration() {
    cancelAnimationFrame(celebRaf);
    const cv = $('celebrate');
    cv.hidden = true;
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    cardEls.forEach((el) => { el.style.visibility = ''; });
  }

  $('new-btn').addEventListener('click', newGame);
  if (window.Leaderboard) Leaderboard.button(() => Daily.board('klondike') || `klondike-${drawMode}`, document.querySelector('.actions'), 'lb-open');
  $('win-new').addEventListener('click', newGame);
  $('undo-btn').addEventListener('click', undo);
  $('hint-btn').addEventListener('click', showHint);
  $('auto-btn').addEventListener('click', autoComplete);
  $('draw-mode').addEventListener('change', (e) => {
    drawMode = +e.target.value;
    try { localStorage.setItem('sol.draw', String(drawMode)); } catch (err) { /* ignore */ }
    e.target.blur();
    newGame();
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'h' || e.key === 'H') showHint();
    else if (e.key === 'n' || e.key === 'N') newGame();
    else if (e.key === ' ' && !e.repeat) { e.preventDefault(); drawStock(); }
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => render(true), 60); });

  newGame();
})();
