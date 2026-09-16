/*
 * Online leaderboards backed by Cloud Firestore.
 *
 * Players sign in anonymously (one hidden ID per device) and own one entry per board at
 * boards/{board}/scores/{uid}; it only changes when they beat their own best. Their display name
 * lives in players/{uid} and can be changed at any time, which renames all of their entries.
 * App Check (reCAPTCHA Enterprise) proves requests come from this site.
 * Firebase is only downloaded the first time a leaderboard is used.
 *
 *   Leaderboard.offer(boardId, { score, time, won }, containerEl)  → posts the result and shows the top 10
 *   Leaderboard.open(boardId)                                      → modal with the top 10
 *   Leaderboard.button(boardIdOrFn, parentEl)                      → "🏆 Leaderboard" button
 *   Leaderboard.nameBar(parentEl)                                  → "Playing as …" control to set/change your name
 */
(function () {
  'use strict';

  const FIREBASE_VERSION = '10.12.2';
  const RECAPTCHA_SITE_KEY = '6LcCJb8tAAAAAPHRbjst_r22hHsVpodTajC2y-ae';
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
  // Firebase (lazy): App Check + anonymous Auth + Firestore Lite
  // ---------------------------------------------------------------------------
  // Never let a stalled network request leave the UI waiting forever
  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  let fbPromise = null;
  function firebase() {
    if (!fbPromise) {
      fbPromise = (async () => {
        const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
        if (['localhost', '127.0.0.1'].includes(location.hostname)) {
          // local development: use a registered App Check debug token (or print a new one to the console)
          let token = null;
          try { token = localStorage.getItem('appcheck.debug'); } catch (e) { /* ignore */ }
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = token || true;
        }
        const [appMod, checkMod, authMod, fs] = await withTimeout(Promise.all([
          import(`${base}/firebase-app.js`),
          import(`${base}/firebase-app-check.js`),
          import(`${base}/firebase-auth.js`),
          import(`${base}/firebase-firestore-lite.js`),
        ]), 20000, 'loading Firebase');
        const app = appMod.initializeApp(CONFIG, 'arcade-leaderboards');
        checkMod.initializeAppCheck(app, { provider: new checkMod.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
        const auth = authMod.getAuth(app);
        return { fs, db: fs.getFirestore(app), auth, authMod };
      })().catch((e) => { fbPromise = null; throw e; });
    }
    return fbPromise;
  }

  let userPromise = null;
  function user() {
    if (!userPromise) {
      userPromise = (async () => {
        const { auth, authMod } = await firebase();
        await withTimeout(auth.authStateReady(), 15000, 'restoring sign-in');
        return auth.currentUser || (await withTimeout(authMod.signInAnonymously(auth), 20000, 'anonymous sign-in')).user;
      })().catch((e) => { userPromise = null; throw e; });
    }
    return userPromise;
  }

  // Daily challenge boards: daily-<game>-<YYYYMMDD>
  const DAILY_GAMES = {
    pacman: ['Pac-Man', 'score', '/pacman/'], snake: ['Snake', 'score', '/snake/'], minesweeper: ['Minesweeper', 'score', '/minesweeper/'],
    frogger: ['Frogger', 'score', '/frogger/'], breakout: ['Breakout', 'score', '/breakout/'], asteroids: ['Asteroids', 'score', '/asteroids/'],
    tetris: ['Tetris', 'score', '/tetris/'], shooter: ['Space Shooter', 'score', '/shooter/'],
    klondike: ['Klondike', 'time', '/solitaire/'], spider: ['Spider', 'time', '/spider/'], freecell: ['FreeCell', 'time', '/freecell/'],
  };
  function dayLabel(key) {
    const d = new Date(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function info(board) {
    if (BOARDS[board]) return BOARDS[board];
    const m = /^daily-([a-z]+)-(\d{8})$/.exec(board || '');
    if (!m || !DAILY_GAMES[m[1]]) return null;
    const [name, type, path] = DAILY_GAMES[m[1]];
    return { title: `Daily ${name} · ${dayLabel(+m[2])}`, group: 'Daily', type, href: `${path}?daily=${m[2]}`, game: m[1], day: +m[2] };
  }
  const dailyBoards = (key) => Object.keys(DAILY_GAMES).map((g) => `daily-${g}-${key}`);

  const isTime = (board) => info(board).type === 'time';

  async function top(board, n = 10) {
    const { fs, db } = await firebase();
    const col = fs.collection(db, 'boards', board, 'scores');
    const order = isTime(board) ? fs.orderBy('time', 'asc') : fs.orderBy('score', 'desc');
    const snap = await withTimeout(fs.getDocs(fs.query(col, order, fs.limit(n))), 15000, `reading ${board}`);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function rankOf(board, entry) {
    const { fs, db } = await firebase();
    const col = fs.collection(db, 'boards', board, 'scores');
    const ahead = isTime(board) ? fs.query(col, fs.where('time', '<', entry.time)) : fs.query(col, fs.where('score', '>', entry.score));
    return (await withTimeout(fs.getCount(ahead), 15000, `ranking ${board}`)).data().count + 1;
  }

  // ---------------------------------------------------------------------------
  // Names
  // ---------------------------------------------------------------------------
  const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'whore', 'slut', 'dick', 'cock', 'pussy'];
  function cleanName(raw) {
    const name = String(raw || '').replace(/[^A-Za-z0-9 _.!?-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    const flat = name.toLowerCase().replace(/[^a-z]/g, '');
    if (!name || BLOCKED.some((w) => flat.includes(w))) return '';
    return name;
  }
  const cachedName = () => { try { return localStorage.getItem('arcade.name') || ''; } catch (e) { return ''; } };
  const cacheName = (n) => { try { localStorage.setItem('arcade.name', n); } catch (e) { /* ignore */ } };
  const nameListeners = new Set();

  async function getName() {
    const { fs, db } = await firebase();
    const u = await user();
    try {
      const snap = await withTimeout(fs.getDoc(fs.doc(db, 'players', u.uid)), 12000, 'reading profile');
      if (snap.exists()) { cacheName(snap.data().name); return snap.data().name; }
    } catch (e) { /* fall back to the cached name */ }
    return cachedName();
  }

  // Saves the name, then renames this player's existing entries in the background
  async function setName(raw) {
    const name = cleanName(raw);
    if (!name) throw new Error('bad-name');
    const { fs, db } = await firebase();
    const u = await user();
    await withTimeout(fs.setDoc(fs.doc(db, 'players', u.uid), { name, updatedAt: fs.serverTimestamp() }), 20000, 'saving name');
    cacheName(name);
    nameListeners.forEach((fn) => { try { fn(name); } catch (e) { console.error('[leaderboard] name listener', e); } });
    renameEntries(name).catch((e) => console.warn('[leaderboard] could not rename existing entries yet:', e));
    return name;
  }

  async function renameEntries(name) {
    const { fs, db } = await firebase();
    const u = await user();
    let docs;
    try {
      const mine = await withTimeout(fs.getDocs(fs.query(fs.collectionGroup(db, 'scores'), fs.where('uid', '==', u.uid))), 20000, 'finding your entries');
      docs = mine.docs;
    } catch (e) {
      // index unavailable (e.g. still building): check each board, a few at a time
      console.warn('[leaderboard] entry query unavailable, checking boards individually:', e && e.code);
      docs = [];
      const ids = Object.keys(BOARDS);
      for (let i = 0; i < ids.length; i += 4) {
        const snaps = await Promise.all(ids.slice(i, i + 4).map((b) => withTimeout(fs.getDoc(fs.doc(db, 'boards', b, 'scores', u.uid)), 12000, `checking ${b}`).catch(() => null)));
        snaps.forEach((snap) => { if (snap && snap.exists()) docs.push(snap); });
      }
    }
    let changed = 0;
    for (const d of docs) {
      const data = d.data();
      if (data.name === name) continue;
      await withTimeout(fs.setDoc(d.ref, { uid: u.uid, name, score: data.score, time: data.time, won: data.won, updatedAt: fs.serverTimestamp() }), 15000, 'renaming entry');
      changed++;
    }
    if (changed) nameListeners.forEach((fn) => { try { fn(name); } catch (e) { /* ignore */ } });
    return changed;
  }

  // ---------------------------------------------------------------------------
  // Posting results (one entry per player per board, kept at their best)
  // ---------------------------------------------------------------------------
  async function submit(board, result) {
    const { fs, db } = await firebase();
    const u = await user();
    const name = cachedName() || (await getName());
    if (!name) throw new Error('no-name');
    const score = Math.max(0, Math.min(100000000, Math.round(result.score || 0)));
    const time = Math.max(0, Math.min(86400, Math.round((result.time || 0) * 100) / 100));
    const ref = fs.doc(db, 'boards', board, 'scores', u.uid);
    const snap = await withTimeout(fs.getDoc(ref), 15000, 'reading your best');
    const prev = snap.exists() ? snap.data() : null;
    const improved = !prev || (isTime(board) ? time < prev.time : score > prev.score);
    if (improved) await withTimeout(fs.setDoc(ref, { uid: u.uid, name, score, time, won: !!result.won, updatedAt: fs.serverTimestamp() }), 20000, 'posting score');
    const best = improved ? { score, time } : prev;
    return { improved, first: !prev, best, rank: await rankOf(board, best), uid: u.uid, name };
  }

  // This player's entry on a board (with rank), or null if they haven't posted there
  async function myEntry(board) {
    const { fs, db } = await firebase();
    const u = await user();
    const snap = await withTimeout(fs.getDoc(fs.doc(db, 'boards', board, 'scores', u.uid)), 12000, `reading your ${board} entry`);
    if (!snap.exists()) return null;
    const entry = snap.data();
    return { ...entry, rank: await rankOf(board, entry) };
  }

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------
  const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
  const fmtEntry = (board, e) => (isTime(board) ? fmtTime(e.time) : e.score.toLocaleString());
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qualifies = (board, r) => (isTime(board) ? r.won && r.time > 0 : r.score > 0);
  const setNote = (el, text, kind = '') => { el.textContent = text; el.className = 'lb-note' + (kind ? ' ' + kind : ''); };
  // typing a name must not trigger game shortcuts
  const shieldKeys = (el) => { ['keydown', 'keyup', 'keypress'].forEach((t) => el.addEventListener(t, (e) => e.stopPropagation())); };

  function injectCss() {
    if (document.getElementById('lb-css')) return;
    const st = document.createElement('style');
    st.id = 'lb-css';
    st.textContent = `
      .lb { margin: 14px auto 6px; max-width: 420px; text-align: left; font-family: Inter, system-ui, -apple-system, sans-serif; color: #eee; }
      .lb h3 { margin: 0 0 10px; font: 12px "Press Start 2P", ui-monospace, monospace; color: #ffe600; text-align: center; letter-spacing: 1px; line-height: 1.5; }
      .lb-form { display: flex; gap: 6px; margin-bottom: 8px; }
      .lb-form input { flex: 1; min-width: 0; font: 600 15px Inter, system-ui, sans-serif; padding: 10px 12px; border-radius: 10px; border: 1px solid #ffffff40; background: #0008; color: #fff; }
      .lb-form input:focus { outline: 2px solid #ffe600; border-color: transparent; }
      .lb-form button, .lb-btn { font: 700 14px Inter, system-ui, sans-serif; padding: 10px 14px; border-radius: 10px; border: 0; background: #ffe600; color: #1b1400; cursor: pointer; white-space: nowrap; }
      .lb-form button:disabled { opacity: .5; cursor: default; }
      .lb-form .cancel { background: #ffffff18; color: #fff; }
      .lb-label { font-size: 13px; color: #ccc; text-align: center; margin: 0 0 6px; }
      .lb-you { display: flex; justify-content: center; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 14px; margin-bottom: 8px; color: #ccc; }
      .lb-you b { color: #fff; }
      .lb-textbtn { font: 600 13px Inter, system-ui, sans-serif; color: #ffe600; background: none; border: 0; padding: 2px 4px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
      .lb-namebar { display: flex; justify-content: center; }
      .panel > .lb-namebar { margin: 16px 0 4px; }
      .lb-namebar .lb-form, .lb-namebar .lb-label, .lb-namebar .lb-note { width: 100%; }
      .lb-namebar > div:not(.lb-chip) { width: 100%; max-width: 420px; }
      .lb-chip { display: inline-flex; align-items: center; gap: 10px; max-width: 100%; padding: 6px 6px 6px 8px; border-radius: 999px; background: #ffffff0d; border: 1px solid #ffffff1f; font: 14px Inter, system-ui, -apple-system, sans-serif; color: #b8b8d0; line-height: 1; }
      .lb-avatar { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #ffe600, #ff9f3d); color: #1b1400; font: 800 13px Inter, system-ui, sans-serif; }
      .lb-chip .lb-who { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .lb-chip .lb-who b { color: #fff; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lb-chip .lb-edit { flex: none; font: 600 13px Inter, system-ui, sans-serif; color: #ffe600; background: #ffe60014; border: 1px solid #ffe60040; border-radius: 999px; padding: 7px 12px; cursor: pointer; line-height: 1; }
      .lb-chip .lb-edit:hover { background: #ffe60026; }
      .lb-chip.empty { padding-left: 14px; }
      .lb-chip .lb-pre { white-space: nowrap; }
      @media (max-width: 480px) {
        .lb-chip .lb-pre { display: none; }
        .lb-chip.empty .lb-who { white-space: normal; line-height: 1.3; }
      }
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
      .lb li.me .nm::after { content: ' (you)'; color: #ffe600; font-size: 12px; }
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

  function renderList(listEl, board, entries, myId) {
    if (!entries.length) {
      listEl.innerHTML = '<li class="empty">No scores yet — be the first!</li>';
      return;
    }
    listEl.innerHTML = entries.map((e, i) => `
      <li class="${e.id === myId ? 'me' : ''}">
        <span class="rk">#${i + 1}</span>
        <span class="nm">${esc(e.name)}${e.won && !isTime(board) && info(board).group === 'Classic' ? ' 🏆' : ''}</span>
        <span class="sc">${fmtEntry(board, e)}</span>
      </li>`).join('');
  }

  async function loadInto(listEl, noteEl, board) {
    listEl.innerHTML = '<li class="empty">Loading…</li>';
    try {
      const [entries, u] = await Promise.all([top(board, 10), user().catch(() => null)]);
      renderList(listEl, board, entries, u && u.uid);
    } catch (e) {
      console.error('[leaderboard] loading board failed:', e);
      listEl.innerHTML = '<li class="empty">Leaderboard unavailable right now</li>';
      if (noteEl && !noteEl.textContent) setNote(noteEl, 'Check your connection and try again.', 'err');
    }
  }

  // A small form for entering or changing the player's name. Resolves when saved (or cancelled).
  function nameForm(parent, { label, button, cancel } = {}) {
    injectCss();
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `${label ? `<p class="lb-label">${esc(label)}</p>` : ''}
        <form class="lb-form" autocomplete="off">
          <input name="name" maxlength="16" placeholder="Your name" aria-label="Your name" value="${esc(cachedName())}">
          <button type="submit">${esc(button || 'Save')}</button>
          ${cancel ? '<button type="button" class="cancel">Cancel</button>' : ''}
        </form>
        <div class="lb-note"></div>`;
      parent.appendChild(wrap);
      const form = wrap.querySelector('form');
      const input = form.elements.name;
      const note = wrap.querySelector('.lb-note');
      shieldKeys(wrap);
      form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === input) { e.preventDefault(); form.requestSubmit(); } });
      const cancelBtn = form.querySelector('.cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => { wrap.remove(); resolve(null); });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!cleanName(input.value)) { setNote(note, 'Use 1–16 letters, numbers or spaces (keep it friendly).', 'err'); input.focus(); return; }
        form.querySelectorAll('input, button').forEach((el) => { el.disabled = true; });
        setNote(note, 'Saving…');
        try {
          const saved = await setName(input.value);
          wrap.remove();
          resolve(saved);
        } catch (err) {
          console.error('[leaderboard] saving name failed:', err);
          setNote(note, /timeout/.test(err && err.message) ? 'The connection timed out — tap Save to try again.' : 'Could not save your name — tap Save to try again.', 'err');
          form.querySelectorAll('input, button').forEach((el) => { el.disabled = false; });
        }
      });
      setTimeout(() => { if (!input.value) input.focus(); }, 50);
    });
  }

  // "Playing as NAME · Change name" (or a prompt to set one)
  function nameBar(parent) {
    if (!parent) return null;
    injectCss();
    const bar = document.createElement('div');
    bar.className = 'lb-namebar';
    parent.appendChild(bar);
    const render = (name) => {
      bar.innerHTML = name
        ? `<div class="lb-chip"><span class="lb-avatar" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span><span class="lb-who"><span class="lb-pre">Playing as</span> <b>${esc(name)}</b></span><button type="button" class="lb-edit">Change name</button></div>`
        : `<div class="lb-chip empty"><span class="lb-who">Want your name on the leaderboards?</span><button type="button" class="lb-edit">Add your name</button></div>`;
      bar.querySelector('.lb-edit').addEventListener('click', async () => {
        bar.innerHTML = '';
        const saved = await nameForm(bar, { label: 'Your name appears on every leaderboard you’re on.', button: 'Save name', cancel: true });
        render(saved || cachedName());
      });
    };
    render(cachedName());
    nameListeners.add(render);
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Game-over panel
  // ---------------------------------------------------------------------------
  function offer(board, result, container) {
    if (!info(board) || !container) return;
    injectCss();
    const old = container.querySelector('.lb');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'lb';
    wrap.innerHTML = `<h3>${info(board).group === 'Daily' ? '📅' : '🏆'} ${esc(info(board).title.toUpperCase())}</h3><div class="lb-slot"></div><div class="lb-note"></div><ol></ol>`;
    const anchor = container.querySelector('.stats, .win-stats, .grid3');
    if (anchor) anchor.after(wrap); else container.appendChild(wrap);
    const slot = wrap.querySelector('.lb-slot');
    const note = wrap.querySelector('.lb-note');
    const list = wrap.querySelector('ol');
    shieldKeys(wrap);

    if (!qualifies(board, result)) {
      if (isTime(board)) setNote(note, 'Win to post a time.');
      loadInto(list, note, board);
      return;
    }

    const shown = isTime(board) ? fmtTime(result.time || 0) : (result.score || 0).toLocaleString();
    const post = async () => {
      setNote(note, 'Posting your score…');
      try {
        const res = await submit(board, result);
        if (!wrap.isConnected) return;
        const change = '<button type="button" class="lb-textbtn">Change name</button>';
        slot.innerHTML = `<div class="lb-you">Posted as <b>${esc(res.name)}</b> ${change}</div>`;
        slot.querySelector('.lb-textbtn').addEventListener('click', async () => {
          slot.innerHTML = '';
          const saved = await nameForm(slot, { button: 'Save name', cancel: true });
          slot.innerHTML = `<div class="lb-you">Posted as <b>${esc(saved || cachedName())}</b></div>`;
          if (saved) { setNote(note, 'Name updated on all your scores.', 'ok'); loadInto(list, note, board); }
        });
        if (res.improved) setNote(note, `${res.first ? 'On the board' : 'New personal best'}! You're #${res.rank.toLocaleString()}.`, 'ok');
        else setNote(note, `Your best is still ${fmtEntry(board, res.best)} (#${res.rank.toLocaleString()}). Beat it to climb!`);
        loadInto(list, note, board);
      } catch (e) {
        console.error('[leaderboard] posting score failed:', e);
        setNote(note, 'Could not post your score — check your connection.', 'err');
        loadInto(list, note, board);
      }
    };

    loadInto(list, note, board);
    if (cachedName()) { post(); return; }
    // no name cached on this device: check the profile, otherwise ask for one
    setNote(note, '');
    getName().then((existing) => {
      if (!wrap.isConnected) return;
      if (existing) { post(); return; }
      nameForm(slot, { label: 'Put your name on the leaderboard', button: `Post ${shown}` }).then((saved) => { if (saved) post(); });
    }).catch(() => {
      nameForm(slot, { label: 'Put your name on the leaderboard', button: `Post ${shown}` }).then((saved) => { if (saved) post(); });
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
        <div class="lb"><div class="lb-names"></div><div class="lb-note"></div><ol></ol></div>
        <button class="lb-btn ghost lb-close" type="button">Close</button>
      </div>`;
      document.body.appendChild(modal);
      shieldKeys(modal);
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
      modal.querySelector('.lb-close').addEventListener('click', () => { modal.hidden = true; });
      modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
      const sel = modal.querySelector('select');
      sel.addEventListener('change', () => loadInto(modal.querySelector('ol'), modal.querySelector('.lb-note'), sel.value));
      nameBar(modal.querySelector('.lb-names'));
      nameListeners.add(() => { if (!modal.hidden) loadInto(modal.querySelector('ol'), modal.querySelector('.lb-note'), sel.value); });
    }
    const sel = modal.querySelector('select');
    const family = info(board).href.split('?')[0];
    const ids = info(board).group === 'Daily' ? [board] : Object.keys(BOARDS).filter((id) => BOARDS[id].href.split('?')[0] === family);
    sel.innerHTML = ids.map((id) => `<option value="${id}" ${id === board ? 'selected' : ''}>${esc(info(id).title)}</option>`).join('');
    sel.hidden = ids.length < 2;
    modal.querySelector('.lb-note').textContent = '';
    modal.hidden = false;
    loadInto(modal.querySelector('ol'), modal.querySelector('.lb-note'), board);
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

  window.Leaderboard = { BOARDS, info, dailyBoards, DAILY_GAMES, myEntry, top, submit, offer, open, button, nameBar, getName, setName, user, fmtTime, onName: (fn) => nameListeners.add(fn) };
})();
