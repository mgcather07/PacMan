/*
 * Shared engine for the patience games (Spider, FreeCell).
 * A game supplies its rules; the engine handles cards in the DOM, layout,
 * drag & drop, click-to-move, undo, hints, timer and the win celebration.
 *
 * Game interface:
 *   id, makeCards(opts) -> [{suit, rank}], deal(cards, opts) -> state { piles: [{type, cards: []}], up: [], score, moves }
 *   layout(width) -> { cw, ch, top, tabY, piles: [{ x, y, fan, label, groupEvery }] }
 *   canPick(S, p, i), canDrop(S, from, i, to), autoTarget(S, from, i) -> pile | -1
 *   onMove(S, from, i, to), clickPile?(S, p, api) -> bool, settle?(S), autoStep?(S) -> {from, i, to} | null
 *   hint(S) -> {from, i, to} | {pile} | null, isWon(S)
 */
(function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRedSuit = (s) => s === 1 || s === 2;

  window.CardEngine = function (game) {
    const $ = (id) => document.getElementById(id);
    const board = $('board');
    const header = document.querySelector('.bar');

    let cards = [];
    let cardEls = [];
    let slotEls = [];
    let S = null;
    let opts = {};
    let history = [];
    let L = null;
    let drag = null;
    let busy = false;
    let elapsed = 0, timerOn = false, lastTick = 0;

    const api = {
      cards: () => cards,
      rank: (id) => cards[id].rank,
      suit: (id) => cards[id].suit,
      red: (id) => isRedSuit(cards[id].suit),
      top: (arr) => arr[arr.length - 1],
      toast,
      SUITS,
    };
    game.api = api;

    // -------------------------------------------------------------------------
    // DOM
    // -------------------------------------------------------------------------
    function buildCards() {
      cardEls.forEach((el) => el.remove());
      cardEls = cards.map((c, id) => {
        const s = SUITS[c.suit], r = RANKS[c.rank];
        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.id = id;
        const center = c.rank > 10 ? `<div class="pip court">${r}<i>${s}</i></div>` : `<div class="pip">${s}</div>`;
        el.innerHTML = `<div class="inner">
          <div class="face ${isRedSuit(c.suit) ? 'red' : ''}">
            <div class="corner tl"><span class="r">${r}</span><span class="s">${s}</span></div>
            ${center}
            <div class="corner br"><span class="r">${r}</span><span class="s">${s}</span></div>
          </div>
          <div class="back"></div>
        </div>`;
        board.appendChild(el);
        return el;
      });
    }

    function buildSlots() {
      slotEls.forEach((el) => el.remove());
      slotEls = S.piles.map((p, i) => {
        const d = document.createElement('div');
        d.className = 'slot ' + (p.type || '');
        d.dataset.pile = i;
        board.insertBefore(d, board.firstChild);
        return d;
      });
    }

    // -------------------------------------------------------------------------
    // Game lifecycle
    // -------------------------------------------------------------------------
    function newGame(newOpts) {
      if (newOpts) opts = { ...opts, ...newOpts };
      cards = game.makeCards(opts);
      S = game.deal(cards, opts);
      history = [];
      elapsed = 0;
      timerOn = false;
      busy = false;
      $('win').hidden = true;
      stopCelebration();
      buildCards();
      buildSlots();
      L = computeLayout();
      const origin = game.dealOrigin ? game.dealOrigin(L) : { x: L.piles[0].x, y: L.piles[0].y };
      cardEls.forEach((el) => { el.classList.add('no-anim'); el.style.left = origin.x + 'px'; el.style.top = origin.y + 'px'; });
      void board.offsetWidth;
      cardEls.forEach((el) => el.classList.remove('no-anim'));
      if (game.settle) game.settle(S);
      render();
      if (game.onNewGame) game.onNewGame(S, opts);
      runAuto();
    }

    const snapshot = () => JSON.stringify(S);
    function pushHistory() {
      history.push(snapshot());
      if (history.length > 500) history.shift();
    }
    function undo() {
      if (!history.length || busy) return;
      S = JSON.parse(history.pop());
      S.moves++;
      render();
    }

    function startTimer() {
      if (!timerOn && !game.isWon(S)) { timerOn = true; lastTick = performance.now(); }
    }

    function applyMove(from, i, to) {
      const src = S.piles[from].cards;
      const moved = src.splice(i);
      S.piles[to].cards.push(...moved);
      game.onMove(S, from, i, to, moved.length);
      if (game.settle) game.settle(S);
    }

    function doMove(from, i, to) {
      pushHistory();
      startTimer();
      S.moves++;
      applyMove(from, i, to);
      render();
      runAuto();
    }

    function runAuto() {
      if (!game.autoStep) return checkWin();
      const step = game.autoStep(S);
      if (!step) { busy = false; return checkWin(); }
      busy = true;
      setTimeout(() => {
        applyMove(step.from, step.i, step.to);
        render();
        runAuto();
      }, 110);
    }

    function checkWin() {
      if (game.isWon(S)) {
        timerOn = false;
        busy = true;
        setTimeout(win, 450);
      }
    }

    // -------------------------------------------------------------------------
    // Layout & render
    // -------------------------------------------------------------------------
    function computeLayout() {
      const width = Math.min(window.innerWidth, game.maxWidth || 1100);
      const l = game.layout(width);
      board.style.setProperty('--cw', l.cw + 'px');
      board.style.setProperty('--ch', l.ch + 'px');
      l.availH = window.innerHeight - header.offsetHeight - l.tabY - l.ch - 24;
      return l;
    }

    function fanOffsets(p) {
      const pile = S.piles[p];
      let down = L.ch * 0.1, up = L.ch * 0.25;
      const nDown = pile.cards.filter((id) => !S.up[id]).length;
      const nUp = Math.max(0, pile.cards.length - nDown - 1);
      const need = nDown * down + nUp * up;
      const avail = Math.max(L.ch, L.availH);
      if (need > avail) { const k = Math.max(0.3, avail / need); down *= k; up *= k; }
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
      L = computeLayout();
      let maxBottom = L.tabY + L.ch;
      S.piles.forEach((pile, p) => {
        const pl = L.piles[p];
        const slot = slotEls[p];
        slot.style.left = pl.x + 'px';
        slot.style.top = pl.y + 'px';
        slot.style.width = L.cw + 'px';
        slot.style.height = L.ch + 'px';
        slot.textContent = pl.label || '';
        slot.classList.toggle('clickable', !!pl.clickable);
        slot.style.visibility = pl.hideSlot ? 'hidden' : '';
        if (pl.fan) {
          const { down, up } = fanOffsets(p);
          let y = pl.y;
          pile.cards.forEach((id, k) => {
            place(id, pl.x, Math.round(y), 10 + k, S.up[id], instant);
            y += S.up[id] ? up : down;
          });
          if (pile.cards.length) maxBottom = Math.max(maxBottom, y - (S.up[api.top(pile.cards)] ? up : down) + L.ch);
        } else {
          pile.cards.forEach((id, k) => {
            const gx = pl.groupEvery ? Math.floor(k / pl.groupEvery) * Math.round(L.cw * 0.14) : 0;
            place(id, pl.x - gx, pl.y, 10 + k, S.up[id], instant);
          });
        }
      });
      board.style.height = maxBottom + 40 + 'px';
      $('score').textContent = S.score;
      $('moves').textContent = S.moves;
      $('undo-btn').disabled = !history.length;
      if (game.renderExtra) game.renderExtra(S);
    }

    // -------------------------------------------------------------------------
    // Pointer interaction
    // -------------------------------------------------------------------------
    function locate(id) {
      for (let p = 0; p < S.piles.length; p++) {
        const i = S.piles[p].cards.indexOf(id);
        if (i >= 0) return { p, i };
      }
      return null;
    }

    function shake(id) {
      const el = cardEls[id];
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
    }

    function clickPile(p) {
      if (!game.clickPile) return false;
      pushHistory();
      if (game.clickPile(S, p, api)) {
        startTimer();
        S.moves++;
        if (game.settle) game.settle(S);
        render();
        runAuto();
        return true;
      }
      history.pop();
      return false;
    }

    board.addEventListener('pointerdown', (e) => {
      if (busy || e.button > 0) return;
      clearHints();
      const cardEl = e.target.closest('.card');
      if (!cardEl) {
        const slot = e.target.closest('.slot');
        if (slot) clickPile(+slot.dataset.pile);
        return;
      }
      const loc = locate(+cardEl.dataset.id);
      if (!loc) return;
      if (L.piles[loc.p].clickable) { clickPile(loc.p); return; }
      if (!game.canPick(S, loc.p, loc.i)) { shake(+cardEl.dataset.id); return; }
      const ids = S.piles[loc.p].cards.slice(loc.i);
      drag = {
        ...loc, ids, sx: e.clientX, sy: e.clientY, active: false,
        origin: ids.map((cid) => ({ left: parseFloat(cardEls[cid].style.left), top: parseFloat(cardEls[cid].style.top) })),
      };
      board.setPointerCapture(e.pointerId);
    });

    board.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
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
        cardEls[cid].style.left = drag.origin[k].left + dx + 'px';
        cardEls[cid].style.top = drag.origin[k].top + dy + 'px';
      });
    });

    function endDrag(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      d.ids.forEach((cid) => cardEls[cid].classList.remove('dragging'));
      if (!d.active) {
        if (e.type === 'pointercancel') return;
        const to = game.autoTarget(S, d.p, d.i);
        if (to >= 0) doMove(d.p, d.i, to); else shake(d.ids[0]);
        return;
      }
      const lead = cardEls[d.ids[0]];
      const r = { x: parseFloat(lead.style.left), y: parseFloat(lead.style.top), w: L.cw, h: L.ch };
      let best = -1, bestA = 0;
      S.piles.forEach((pile, p) => {
        if (p === d.p) return;
        const pl = L.piles[p];
        let rect = { x: pl.x, y: pl.y, w: L.cw, h: L.ch };
        if (pl.fan && pile.cards.length) {
          const ty = parseFloat(cardEls[api.top(pile.cards)].style.top);
          rect = { x: pl.x, y: pl.y, w: L.cw, h: ty - pl.y + L.ch };
        }
        const ox = Math.max(0, Math.min(r.x + r.w, rect.x + rect.w) - Math.max(r.x, rect.x));
        const oy = Math.max(0, Math.min(r.y + r.h, rect.y + rect.h) - Math.max(r.y, rect.y));
        const a = ox * oy;
        if (a > bestA && game.canDrop(S, d.p, d.i, p)) { bestA = a; best = p; }
      });
      if (best >= 0) doMove(d.p, d.i, best);
      else render();
    }
    board.addEventListener('pointerup', endDrag);
    board.addEventListener('pointercancel', endDrag);

    // -------------------------------------------------------------------------
    // Hints
    // -------------------------------------------------------------------------
    function clearHints() { document.querySelectorAll('.hint').forEach((el) => el.classList.remove('hint')); }
    function showHint() {
      if (busy) return;
      clearHints();
      const h = game.hint(S);
      if (!h) { toast('No helpful moves found — try Undo or a new game'); return; }
      if (h.pile !== undefined) {
        const pile = S.piles[h.pile].cards;
        (pile.length ? cardEls[api.top(pile)] : slotEls[h.pile]).classList.add('hint');
      } else {
        S.piles[h.from].cards.slice(h.i).forEach((id) => cardEls[id].classList.add('hint'));
        const dest = S.piles[h.to].cards;
        (dest.length ? cardEls[api.top(dest)] : slotEls[h.to]).classList.add('hint');
      }
      setTimeout(clearHints, 1600);
    }

    let toastTimer = null;
    function toast(msg) {
      const el = $('toast');
      el.textContent = msg;
      el.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
    }

    // -------------------------------------------------------------------------
    // Timer & win
    // -------------------------------------------------------------------------
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    setInterval(() => {
      if (timerOn && !document.hidden) {
        const now = performance.now();
        elapsed += (now - lastTick) / 1000;
        lastTick = now;
      } else lastTick = performance.now();
      $('time').textContent = fmt(elapsed);
    }, 250);

    function win() {
      let rec = '';
      try {
        const key = 'sol.best.' + game.id + (game.variantKey ? game.variantKey(opts) : '');
        const best = JSON.parse(localStorage.getItem(key) || 'null');
        const winsKey = 'sol.wins.' + game.id;
        const wins = (+localStorage.getItem(winsKey) || 0) + 1;
        localStorage.setItem(winsKey, String(wins));
        if (!best || elapsed < best.time) {
          localStorage.setItem(key, JSON.stringify({ time: elapsed, score: S.score }));
          rec = `🏆 New best time!  ·  ${game.name} wins: ${wins}`;
        } else rec = `Best time: ${fmt(best.time)}  ·  ${game.name} wins: ${wins}`;
      } catch (e) { /* ignore */ }
      $('win-score').textContent = S.score;
      $('win-time').textContent = fmt(elapsed);
      $('win-moves').textContent = S.moves;
      $('win-record').textContent = rec;
      celebrate(() => { $('win').hidden = false; });
    }

    let celebRaf = 0;
    function celebrate(done) {
      const cv = $('celebrate');
      const cx = cv.getContext('2d');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.hidden = false;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const found = S.piles.map((p, i) => ({ p, i })).filter((o) => o.p.type === 'found');
      const queue = [];
      const depth = Math.max(...found.map((o) => o.p.cards.length));
      for (let r = depth - 1; r >= 0; r--) for (const o of found) if (o.p.cards[r] !== undefined) queue.push({ id: o.p.cards[r], pile: o.i });
      const cw = L.cw, ch = L.ch;
      const rect = board.getBoundingClientRect();
      let cur = null;
      let finished = false;
      const finish = () => { if (finished) return; finished = true; stopCelebration(); done(); };
      function drawCard(id, x, y) {
        const c = cards[id];
        cx.fillStyle = '#fffef9';
        cx.strokeStyle = '#555';
        cx.lineWidth = 1;
        cx.beginPath();
        if (cx.roundRect) cx.roundRect(x, y, cw, ch, cw * 0.08); else cx.rect(x, y, cw, ch);
        cx.fill(); cx.stroke();
        cx.fillStyle = isRedSuit(c.suit) ? '#c8102e' : '#1b1b1b';
        cx.font = `bold ${Math.round(cw * 0.22)}px Georgia, serif`;
        cx.textAlign = 'left'; cx.textBaseline = 'top';
        cx.fillText(RANKS[c.rank], x + cw * 0.07, y + cw * 0.06);
        cx.font = `${Math.round(cw * 0.5)}px Georgia, serif`;
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText(SUITS[c.suit], x + cw / 2, y + ch / 2);
      }
      cardEls.forEach((el) => { el.style.visibility = 'hidden'; });
      let launched = 0;
      const maxCards = Math.min(queue.length, 60);
      function tick() {
        if (!cur) {
          const next = launched < maxCards ? queue.shift() : null;
          if (!next) { finish(); return; }
          launched++;
          const dir = Math.random() < 0.5 ? -1 : 1;
          cur = { ...next, x: rect.left + L.piles[next.pile].x, y: rect.top + L.piles[next.pile].y, vx: dir * (3 + Math.random() * 5), vy: -Math.random() * 6 };
        }
        for (let s = 0; s < 3; s++) {
          cur.vy += 0.5; cur.x += cur.vx; cur.y += cur.vy;
          if (cur.y + ch > innerHeight) { cur.y = innerHeight - ch; cur.vy *= -0.78; }
          drawCard(cur.id, cur.x, cur.y);
          if (cur.x < -cw || cur.x > innerWidth) { cur = null; break; }
        }
        celebRaf = requestAnimationFrame(tick);
      }
      cv.onclick = finish;
      tick();
    }
    function stopCelebration() {
      cancelAnimationFrame(celebRaf);
      const cv = $('celebrate');
      cv.hidden = true;
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      cardEls.forEach((el) => { el.style.visibility = ''; });
    }

    // -------------------------------------------------------------------------
    // Controls
    // -------------------------------------------------------------------------
    $('new-btn').addEventListener('click', () => newGame(game.nextOpts ? game.nextOpts(opts) : null));
    $('win-new').addEventListener('click', () => newGame(game.nextOpts ? game.nextOpts(opts) : null));
    $('undo-btn').addEventListener('click', undo);
    $('hint-btn').addEventListener('click', showHint);
    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input, select')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'h' || e.key === 'H') showHint();
      else if (e.key === 'n' || e.key === 'N') newGame(game.nextOpts ? game.nextOpts(opts) : null);
    });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => S && render(true), 60); });

    return { newGame, move: doMove, get busy() { return busy; }, get state() { return S; }, get opts() { return opts; }, toast, render };
  };
})();
