/*
 * Online leaderboards backed by Cloud Firestore (boards/{board}/scores/{entry}).
 * Firebase is only downloaded the first time a leaderboard is opened or a score is submitted.
 *
 *   Leaderboard.offer(boardId, { score, time, won }, containerEl)  → submit form + top 10 inside a game-over panel
 *   Leaderboard.open(boardId)                                      → modal with the top 10
 *   Leaderboard.button(boardIdOrFn, parentEl)                      → "🏆 Leaderboard" button that opens the modal
 */
(function () {
  'use strict';

  const FIREBASE_VERSION = '10.12.2';
  const CONFIG = {
    apiKey: 'AIzaSyAXwWoC_s2DCQ9TuUmOLM6PFx-zCHcSSaY',
    authDomain: 'pacman-d28dc.firebaseapp.com',
    projectId: 'pacman-d28dc',
    storageBucket: 'pacman-d28dc.firebasestorage.app',
    messagingSenderId: '725739379550',
    appId: '1:725739379550:web:406602b02db3de61188dcf',
  };

  // type: 'score' = higher is better, 'time' = faster is better (must be a win)
  const BOARDS = {
    'pacman': { title: 'Infinite Pac-Man', group: 'Infinite', type: 'score', href: '/pacman/' },
    'snake': { title: 'Infinite Snake', group: 'Infinite', type: 'score', href: '/snake/' },
    'minesweeper': { title: 'Infinite Minesweeper', group: 'Infinite', type: 'score', href: '/minesweeper/', unit: 'tiles' },
    'frogger': { title: 'Infinite Frogger', group: 'Infinite', type: 'score', href: '/frogger/' },
    'breakout': { title: 'Infinite Breakout', group: 'Infinite', type: 'score', href: '/breakout/' },
    'asteroids': { title: 'Infinite Asteroids', group: 'Infinite', type: 'score', href: '/asteroids/' },
    'tetris-tower': { title: 'Infinite Tetris · Tower', group: 'Infinite', type: 'score', href: '/tetris/' },
    'tetris-marathon': { title: 'Infinite Tetris · Marathon', group: 'Infinite', type: 'score', href: '/tetris/' },
    'shooter': { title: 'Infinite Space Shooter', group: 'Infinite', type: 'score', href: '/shooter/' },

    'pacman-classic': { title: 'Classic Pac-Man', group: 'Classic', type: 'score', href: '/pacman/?mode=classic' },
    'snake-classic': { title: 'Classic Snake', group: 'Classic', type: 'score', href: '/snake/?mode=classic' },
    'mines-beginner': { title: 'Minesweeper · Beginner', group: 'Classic', type: 'time', href: '/minesweeper/?mode=classic' },
    'mines-intermediate': { title: 'Minesweeper · Intermediate', group: 'Classic', type: 'time', href: '/minesweeper/?mode=classic' },
    'mines-expert': { title: 'Minesweeper · Expert', group: 'Classic', type: 'time', href: '/minesweeper/?mode=classic' },
    'frogger-classic': { title: 'Classic Frogger', group: 'Classic', type: 'score', href: '/frogger/?mode=classic' },
    'breakout-classic': { title: 'Classic Breakout', group: 'Classic', type: 'score', href: '/breakout/?mode=classic' },
    'asteroids-classic': { title: 'Classic Asteroids', group: 'Classic', type: 'score', href: '/asteroids/?mode=classic' },
    'tetris-sprint': { title: 'Tetris · Sprint 40', group: 'Classic', type: 'time', href: '/tetris/?mode=classic' },
    'tetris-marathon150': { title: 'Tetris · Marathon 150', group: 'Classic', type: 'score', href: '/tetris/?mode=classic' },
    'shooter-classic': { title: 'Classic Space Shooter', group: 'Classic', type: 'score', href: '/shooter/?mode=classic' },

    'klondike-1': { title: 'Klondike · Draw 1', group: 'Solitaire', type: 'time', href: '/solitaire/' },
    'klondike-3': { title: 'Klondike · Draw 3', group: 'Solitaire', type: 'time', href: '/solitaire/' },
    'spider-1': { title: 'Spider · 1 suit', group: 'Solitaire', type: 'time', href: '/spider/' },
    'spider-2': { title: 'Spider · 2 suits', group: 'Solitaire', type: 'time', href: '/spider/' },
    'spider-4': { title: 'Spider · 4 suits', group: 'Solitaire', type: 'time', href: '/spider/' },
    'freecell': { title: 'FreeCell', group: 'Solitaire', type: 'time', href: '/freecell/' },
  };

  // ---------------------------------------------------------------------------
  // Firebase (lazy)
  // ---------------------------------------------------------------------------
  let fbPromise = null;
  function firebase() {
    if (!fbPromise) {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
      fbPromise = Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-firestore-lite.js`)])
        .then(([app, fs]) => ({ fs, db: fs.getFirestore(app.initializeApp(CONFIG, 'arcade-leaderboards')) }))
        .catch((e) => { fbPromise = null; throw e; });
    }
    return fbPromise;
  }

  async function top(board, n = 10) {
    const { fs, db } = await firebase();
    const col = fs.collection(db, 'boards', board, 'scores');
    const order = BOARDS[board].type === 'time' ? fs.orderBy('time', 'asc') : fs.orderBy('score', 'desc');
    const snap = await fs.getDocs(fs.query(col, order, fs.limit(n)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function submit(board, entry) {
    const { fs, db } = await firebase();
    const col = fs.collection(db, 'boards', board, 'scores');
    // rank with exactly the values that are stored, so rounding can't count our own entry as "ahead"
    const score = Math.max(0, Math.min(100000000, Math.round(entry.score || 0)));
    const time = Math.max(0, Math.min(86400, Math.round((entry.time || 0) * 100) / 100));
    const ref = await fs.addDoc(col, { name: entry.name, score, time, won: !!entry.won, createdAt: fs.serverTimestamp() });
    const ahead = BOARDS[board].type === 'time'
      ? fs.query(col, fs.where('time', '<', time))
      : fs.query(col, fs.where('score', '>', score));
    const count = await fs.getCount(ahead);
    return { id: ref.id, rank: count.data().count + 1 };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'whore', 'slut', 'dick', 'cock', 'pussy'];
  function cleanName(raw) {
    const name = String(raw || '').replace(/[^A-Za-z0-9 _.!?-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    const flat = name.toLowerCase().replace(/[^a-z]/g, '');
    if (!name || BLOCKED.some((w) => flat.includes(w))) return '';
    return name;
  }
  const savedName = () => { try { return localStorage.getItem('arcade.name') || ''; } catch (e) { return ''; } };
  const saveName = (n) => { try { localStorage.setItem('arcade.name', n); } catch (e) { /* ignore */ } };
  const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const fmtEntry = (board, e) => (BOARDS[board].type === 'time' ? fmtTime(e.time) : e.score.toLocaleString());
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qualifies = (board, r) => (BOARDS[board].type === 'time' ? r.won && r.time > 0 : r.score > 0);

  function injectCss() {
    if (document.getElementById('lb-css')) return;
    const st = document.createElement('style');
    st.id = 'lb-css';
    st.textContent = `
      .lb { margin: 14px auto 6px; max-width: 420px; text-align: left; font-family: Inter, system-ui, -apple-system, sans-serif; color: #eee; }
      .lb h3 { margin: 0 0 10px; font: 12px "Press Start 2P", ui-monospace, monospace; color: #ffe600; text-align: center; letter-spacing: 1px; }
      .lb-form { display: flex; gap: 6px; margin-bottom: 10px; }
      .lb-form input { flex: 1; min-width: 0; font: 600 15px Inter, system-ui, sans-serif; padding: 10px 12px; border-radius: 10px; border: 1px solid #ffffff40; background: #0008; color: #fff; }
      .lb-form input:focus { outline: 2px solid #ffe600; border-color: transparent; }
      .lb-form button, .lb-btn { font: 700 14px Inter, system-ui, sans-serif; padding: 10px 14px; border-radius: 10px; border: 0; background: #ffe600; color: #1b1400; cursor: pointer; white-space: nowrap; }
      .lb-form button:disabled { opacity: .5; cursor: default; }
      .lb-note { font-size: 13px; color: #bbb; text-align: center; min-height: 18px; margin: 4px 0 8px; }
      .lb-note.ok { color: #7dff6a; }
      .lb-note.err { color: #ff8a8a; }
      .lb ol { list-style: none; margin: 0; padding: 0; border-radius: 12px; overflow: hidden; border: 1px solid #ffffff1f; background: #0007; }
      .lb li { display: grid; grid-template-columns: 34px 1fr auto; gap: 8px; align-items: center; padding: 8px 12px; font-size: 14px; border-top: 1px solid #ffffff12; }
      .lb li:first-child { border-top: 0; }
      .lb li .rk { font-weight: 800; color: #999; }
      .lb li:nth-child(1) .rk { color: #ffd700; } .lb li:nth-child(2) .rk { color: #d0d8e8; } .lb li:nth-child(3) .rk { color: #e0a060; }
      .lb li .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lb li .sc { font-variant-numeric: tabular-nums; font-weight: 700; }
      .lb li.me { background: #ffe60026; }
      .lb li.empty { display: block; text-align: center; color: #999; }
      .lb-btn.ghost { background: #ffffff18; color: #fff; border: 1px solid #ffffff30; }
      .lb-modal { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: #000b; padding: 16px; }
      .lb-modal[hidden] { display: none !important; }
      .lb-card { width: 100%; max-width: 460px; max-height: calc(100vh - 32px); overflow: auto; background: #10102a; border: 1px solid #ffffff26; border-radius: 18px; padding: 18px; box-shadow: 0 20px 60px #000a; }
      .lb-card select { width: 100%; margin-bottom: 10px; font: 600 14px Inter, system-ui, sans-serif; padding: 9px 10px; border-radius: 10px; background: #0008; color: #fff; border: 1px solid #ffffff30; }
      .lb-card select option { color: #000; }
      .lb-card .lb { margin: 0; }
      .lb-close { display: block; width: 100%; margin-top: 12px; }
      .overlay:has(.lb), .win:has(.lb) { overflow-y: auto; align-items: start; }
      .overlay:has(.lb) > .panel, .win:has(.lb) > .win-panel { margin: 24px auto; }
      .lb-open { font: 600 14px Inter, system-ui, sans-serif; color: #fff; background: #ffffff22; border: 1px solid #ffffff40; border-radius: 10px; padding: 8px 11px; cursor: pointer; }
      .lb-open:hover { background: #ffffff35; }
      @media (max-width: 560px) { .lb-open { font-size: 0; padding: 8px 9px; } .lb-open::before { content: '🏆'; font-size: 15px; } }
    `;
    document.head.appendChild(st);
  }

  function renderList(listEl, board, entries, highlightId) {
    if (!entries.length) {
      listEl.innerHTML = `<li class="empty">No scores yet — be the first!</li>`;
      return;
    }
    listEl.innerHTML = entries.map((e, i) => `
      <li class="${e.id === highlightId ? 'me' : ''}">
        <span class="rk">#${i + 1}</span>
        <span class="nm">${esc(e.name)}${e.won && BOARDS[board].type === 'score' && BOARDS[board].group === 'Classic' ? ' 🏆' : ''}</span>
        <span class="sc">${fmtEntry(board, e)}</span>
      </li>`).join('');
  }

  async function loadInto(listEl, noteEl, board, highlightId) {
    listEl.innerHTML = '<li class="empty">Loading…</li>';
    try {
      renderList(listEl, board, await top(board, 10), highlightId);
    } catch (e) {
      listEl.innerHTML = '<li class="empty">Leaderboard unavailable right now</li>';
      if (noteEl && !noteEl.textContent) { noteEl.textContent = 'Check your connection and try again.'; noteEl.className = 'lb-note err'; }
    }
  }

  // ---------------------------------------------------------------------------
  // Game-over panel
  // ---------------------------------------------------------------------------
  function offer(board, result, container) {
    if (!BOARDS[board] || !container) return;
    injectCss();
    const old = container.querySelector('.lb');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'lb';
    const canSubmit = qualifies(board, result);
    const shown = BOARDS[board].type === 'time' ? fmtTime(result.time || 0) : (result.score || 0).toLocaleString();
    wrap.innerHTML = `
      <h3>🏆 ${esc(BOARDS[board].title.toUpperCase())}</h3>
      ${canSubmit ? `<form class="lb-form" autocomplete="off">
        <input name="name" maxlength="16" placeholder="Your name" aria-label="Your name" value="${esc(savedName())}">
        <button type="submit">Submit ${esc(shown)}</button>
      </form>` : ''}
      <div class="lb-note">${canSubmit ? '' : BOARDS[board].type === 'time' ? 'Win to post a time.' : ''}</div>
      <ol></ol>`;
    const anchor = container.querySelector('.stats, .win-stats, .grid3');
    if (anchor) anchor.after(wrap); else container.appendChild(wrap);
    const list = wrap.querySelector('ol');
    const note = wrap.querySelector('.lb-note');
    loadInto(list, note, board);

    const form = wrap.querySelector('form');
    if (!form) return;
    // keep game keyboard shortcuts from firing while typing a name
    form.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('keyup', (e) => e.stopPropagation());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.elements.name;
      const btn = form.querySelector('button');
      const name = cleanName(input.value);
      if (!name) { note.textContent = 'Pick a name (letters, numbers, spaces).'; note.className = 'lb-note err'; input.focus(); return; }
      saveName(name);
      btn.disabled = true;
      input.disabled = true;
      note.textContent = 'Submitting…';
      note.className = 'lb-note';
      try {
        const res = await submit(board, { name, score: result.score || 0, time: result.time || 0, won: !!result.won });
        note.textContent = `Posted! You're #${res.rank.toLocaleString()} on the ${BOARDS[board].title} board.`;
        note.className = 'lb-note ok';
        form.remove();
        loadInto(list, note, board, res.id);
      } catch (err) {
        note.textContent = 'Could not post your score — try again.';
        note.className = 'lb-note err';
        btn.disabled = false;
        input.disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  let modal = null;
  function open(board) {
    injectCss();
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'lb-modal';
      modal.innerHTML = `<div class="lb-card" role="dialog" aria-label="Leaderboard">
        <select aria-label="Choose leaderboard"></select>
        <div class="lb"><div class="lb-note"></div><ol></ol></div>
        <button class="lb-btn ghost lb-close" type="button">Close</button>
      </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
      modal.querySelector('.lb-close').addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') modal.hidden = true; });
      const sel = modal.querySelector('select');
      sel.addEventListener('change', () => loadInto(modal.querySelector('ol'), modal.querySelector('.lb-note'), sel.value));
    }
    const sel = modal.querySelector('select');
    // offer the other boards from the same game family in the dropdown
    const family = BOARDS[board].href.split('?')[0];
    const ids = Object.keys(BOARDS).filter((id) => BOARDS[id].href.split('?')[0] === family);
    sel.innerHTML = ids.map((id) => `<option value="${id}" ${id === board ? 'selected' : ''}>${esc(BOARDS[id].title)}</option>`).join('');
    sel.hidden = ids.length < 2;
    modal.querySelector('.lb-note').textContent = '';
    modal.hidden = false;
    loadInto(modal.querySelector('ol'), modal.querySelector('.lb-note'), board);
    sel.focus();
  }

  function button(boardOrFn, parent, className = 'lb-btn ghost') {
    if (!parent) return null;
    injectCss();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = '🏆 Leaderboard';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(typeof boardOrFn === 'function' ? boardOrFn() : boardOrFn);
    });
    parent.appendChild(b);
    return b;
  }

  window.Leaderboard = { BOARDS, top, submit, offer, open, button, fmtTime };
})();
