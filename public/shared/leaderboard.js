/*
 * Online leaderboards, daily streaks and sharing, backed by Cloud Firestore + Cloud Functions.
 *
 * Players sign in anonymously (one hidden ID per device). Games call startRun() when a round begins,
 * which starts a clock on the server; when the round ends, offer() sends the result to the
 * submitScore function, which rejects anything implausible for how long the run lasted and keeps one
 * best entry per player at boards/{board}/scores/{uid}. The display name and daily-challenge days live
 * in players/{uid}. App Check (reCAPTCHA Enterprise) proves requests come from this site.
 *
 *   Leaderboard.startRun(boardId)                                  → call when a game starts (counts a play)
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
        const [appMod, checkMod, authMod, fs, fnMod] = await withTimeout(Promise.all([
          import(`${base}/firebase-app.js`),
          import(`${base}/firebase-app-check.js`),
          import(`${base}/firebase-auth.js`),
          import(`${base}/firebase-firestore-lite.js`),
          import(`${base}/firebase-functions.js`),
        ]), 20000, 'loading Firebase');
        const app = appMod.initializeApp(CONFIG, 'arcade-leaderboards');
        checkMod.initializeAppCheck(app, { provider: new checkMod.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
        const auth = authMod.getAuth(app);
        const functions = fnMod.getFunctions(app, 'us-central1');
        const call = async (name, data) => (await fnMod.httpsCallable(functions, name, { timeout: 30000 })(data)).data;
        return { fs, db: fs.getFirestore(app), auth, authMod, call };
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

  // Call a Cloud Function as the signed-in player
  async function call(name, data) {
    const fb = await firebase();
    await user();
    return withTimeout(fb.call(name, data), 35000, name);
  }

  const ICONS = { pacman: '🟡', snake: '🐍', minesweeper: '💣', frogger: '🐸', breakout: '🧱', asteroids: '☄️', tetris: '🟪', shooter: '🚀', klondike: '🂡', spider: '🕷️', freecell: '🃏' };
  const gameOf = (board) => {
    const m = /^daily-([a-z]+)-\d{8}$/.exec(board || '');
    if (m) return m[1];
    const id = String(board || '').replace(/-(classic|tower|marathon|marathon150|sprint|beginner|intermediate|expert|1|2|3|4)$/, '');
    return id === 'mines' ? 'minesweeper' : id;
  };
  const modeOf = (board) => (info(board) ? info(board).group.toLowerCase() : 'unknown');

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

  // ---------------------------------------------------------------------------
  // Profile: name + daily streak (players/{uid}, readable only by its owner)
  // ---------------------------------------------------------------------------
  const cachedDays = () => { try { return JSON.parse(localStorage.getItem('arcade.days') || '{}'); } catch (e) { return {}; } };
  const streakListeners = new Set();
  function cacheDays(days, bestStreak) {
    const prev = cachedDays();
    const next = { days: Array.isArray(days) ? days.slice(-60) : (prev.days || []), best: Math.max(bestStreak || 0, prev.best || 0) };
    try { localStorage.setItem('arcade.days', JSON.stringify(next)); } catch (e) { /* ignore */ }
    const s = streak();
    streakListeners.forEach((fn) => { try { fn(s); } catch (e) { /* ignore */ } });
  }

  // current streak counts back from today, or from yesterday if today's challenge isn't done yet
  function streak() {
    const { days = [], best = 0 } = cachedDays();
    const set = new Set(days);
    const today = window.Daily ? Daily.todayKey() : 0;
    const shift = (k, n) => (window.Daily ? Daily.shiftKey(k, n) : k);
    const playedToday = set.has(today);
    let k = playedToday ? today : shift(today, -1);
    let current = 0;
    while (set.has(k)) { current++; k = shift(k, -1); }
    return { current, best: Math.max(best, current), playedToday, atRisk: !playedToday && current > 0 };
  }

  let profilePromise = null;
  function profile(refresh = false) {
    if (!profilePromise || refresh) {
      profilePromise = (async () => {
        const { fs, db } = await firebase();
        const u = await user();
        const snap = await withTimeout(fs.getDoc(fs.doc(db, 'players', u.uid)), 12000, 'reading profile');
        const data = snap.exists() ? snap.data() : {};
        if (data.name) cacheName(data.name);
        cacheDays(data.days || [], data.bestStreak || 0);
        return { name: data.name || '', streak: streak() };
      })().catch((e) => { profilePromise = null; throw e; });
    }
    return profilePromise;
  }

  async function getName() {
    try { return (await profile()).name || cachedName(); } catch (e) { return cachedName(); }
  }

  // Saves the name; the server renames all of this player's existing entries
  async function setName(raw) {
    const clean = cleanName(raw);
    if (!clean) throw new Error('bad-name');
    const { name } = await call('setName', { name: clean });
    cacheName(name);
    nameListeners.forEach((fn) => { try { fn(name); } catch (e) { console.error('[leaderboard] name listener', e); } });
    if (window.Analytics) Analytics.event('name_set');
    return name;
  }

  // ---------------------------------------------------------------------------
  // Runs: the server times every game so results can be checked
  // ---------------------------------------------------------------------------
  const runs = new Map(); // board → { promise: Promise<runId|null>, startedAt }

  function track(name, board, extra = {}) {
    if (window.Analytics && info(board)) Analytics.event(name, { game: gameOf(board), mode: modeOf(board), board, ...extra });
  }

  // Call when a round begins. play: false for games dealt before the player does anything (call played() later).
  function startRun(board, { play = true } = {}) {
    if (!info(board)) return Promise.resolve(null);
    const promise = call('startRun', { board, play })
      .then((r) => r.runId)
      .catch((e) => { console.warn('[leaderboard] could not start a verified run:', e); return null; });
    runs.set(board, { promise, startedAt: Date.now() });
    if (play) track('game_start', board);
    return promise;
  }
  // Counts a play for a run started with { play: false }
  function played(board) {
    if (!info(board)) return;
    track('game_start', board);
    call('logPlay', { board }).catch((e) => console.warn('[leaderboard] logPlay failed:', e));
  }
  // Continue a saved game's run (infinite Minesweeper)
  function resumeRun(board, runId) {
    if (runId) runs.set(board, { promise: Promise.resolve(runId), startedAt: Date.now() });
  }
  const runId = (board) => (runs.get(board) ? runs.get(board).promise : Promise.resolve(null));

  // Posting results (one entry per player per board, kept at their best)
  async function submit(board, result) {
    const run = runs.get(board);
    const id = run && (await run.promise);
    if (!id) throw Object.assign(new Error('no-run'), { code: 'no-run' });
    try {
      const res = await call('submitScore', { runId: id, score: result.score || 0, time: result.time || 0, won: !!result.won });
      if (!res.needName) runs.delete(board);
      if (res.days) cacheDays(res.days, res.bestStreak);
      if (res.name) cacheName(res.name);
      return res;
    } catch (e) {
      if (e && /failed-precondition|not-found|deadline-exceeded/.test(e.code || '')) runs.delete(board);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Sharing
  // ---------------------------------------------------------------------------
  const SITE = 'https://pacman-d28dc.web.app';
  function shareText(board, res) {
    const meta = info(board);
    const game = gameOf(board);
    const shown = meta.type === 'time' ? fmtTime(res.best.time) : `${res.best.score.toLocaleString()} pts`;
    const place = res.rank ? ` (#${res.rank.toLocaleString()}${res.total ? ` of ${res.total.toLocaleString()}` : ''})` : '';
    const s = streak();
    if (meta.group === 'Daily') {
      const name = DAILY_GAMES[game][0];
      return [
        `📅 Infinite Arcade Daily · ${window.Daily ? Daily.label(meta.day) : dayLabel(meta.day)}`,
        `${ICONS[game] || '🎮'} ${name}: ${shown}${place}`,
        ...(s.current > 1 ? [`🔥 ${s.current}-day streak`] : []),
        `${SITE}${meta.href}`,
      ].join('\n');
    }
    return [`${ICONS[game] || '🎮'} ${meta.title}: ${shown}${place}`, `Can you beat it? ${SITE}${meta.href}`].join('\n');
  }

  // Native share sheet on phones, clipboard elsewhere. Resolves to 'shared', 'copied' or 'cancelled'.
  async function share(text, { board, kind = 'score' } = {}) {
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    let method = 'clipboard';
    try {
      if (touch && navigator.share) {
        method = 'share_sheet';
        await navigator.share({ text });
      } else {
        let copied = false;
        if (navigator.clipboard && window.isSecureContext) {
          try { await navigator.clipboard.writeText(text); copied = true; } catch (e) { /* fall back below */ }
        }
        if (!copied) {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
          document.body.appendChild(ta);
          ta.select();
          copied = document.execCommand('copy');
          ta.remove();
          if (!copied) throw new Error('copy failed');
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      throw e;
    }
    if (window.Analytics) Analytics.event('share', { method, content_type: kind, item_id: board || 'daily-summary', game: board ? gameOf(board) : 'all' });
    return method === 'share_sheet' ? 'shared' : 'copied';
  }

  // "📤 Share" button that flips to "✓ Copied!" for a moment
  function shareButton(getText, opts, className = 'lb-btn lb-share') {
    injectCss();
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    const label = '📤 Share';
    b.textContent = label;
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const how = await share(typeof getText === 'function' ? getText() : getText, opts);
        if (how === 'copied') { b.textContent = '✓ Copied — paste it anywhere'; setTimeout(() => { b.textContent = label; }, 2200); }
      } catch (err) {
        console.error('[leaderboard] share failed:', err);
        b.textContent = 'Couldn’t copy'; setTimeout(() => { b.textContent = label; }, 2200);
      }
    });
    return b;
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
      .lb-avatar { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: linear-gradient(135deg, #ff3b5c, #a50d2b); color: #fff; font: 800 13px Inter, system-ui, sans-serif; }
      .lb-chip .lb-who { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .lb-chip .lb-who b { color: #fff; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lb-chip .lb-edit { flex: none; font: 600 13px Inter, system-ui, sans-serif; color: #ffe600; background: #ffe60014; border: 1px solid #ffe60040; border-radius: 999px; padding: 7px 12px; cursor: pointer; line-height: 1; }
      .lb-chip .lb-edit:hover { background: #ffe60026; }
      .lb-chip.empty { padding-left: 14px; }
      .lb-chip .lb-pre { white-space: nowrap; }
      .lb-streak { flex: none; display: inline-flex; align-items: center; gap: 3px; padding: 5px 8px; border-radius: 999px; background: #dc143c26; border: 1px solid #dc143c66; color: #ff8fa3; font: 800 12px Inter, system-ui, sans-serif; line-height: 1; }
      .lb-streak.dim { background: #ffffff0d; border-color: #ffffff26; color: #b8b8d0; }
      .lb-share-row { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin: 2px 0 10px; }
      .lb-btn.lb-share { background: #dc143c; color: #fff; box-shadow: 0 3px 0 #6e0a1c; }
      .lb-btn.lb-share:active { transform: translateY(2px); box-shadow: 0 1px 0 #6e0a1c; }
      .lb-streak-note { text-align: center; font: 700 14px Inter, system-ui, sans-serif; color: #ff8fa3; margin: 0 0 8px; }
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
    let editing = false;
    const badge = () => {
      const s = streak();
      if (!s.current) return '';
      const title = s.playedToday ? `${s.current}-day daily challenge streak` : `${s.current}-day streak — play today's challenge to keep it`;
      return `<span class="lb-streak${s.playedToday ? '' : ' dim'}" title="${esc(title)}">🔥 ${s.current}</span>`;
    };
    const render = (name) => {
      if (editing) return;
      bar.innerHTML = name
        ? `<div class="lb-chip"><span class="lb-avatar" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span><span class="lb-who"><span class="lb-pre">Playing as</span> <b>${esc(name)}</b></span>${badge()}<button type="button" class="lb-edit">Change name</button></div>`
        : `<div class="lb-chip empty"><span class="lb-who">Want your name on the leaderboards?</span>${badge()}<button type="button" class="lb-edit">Add your name</button></div>`;
      bar.querySelector('.lb-edit').addEventListener('click', async () => {
        editing = true;
        bar.innerHTML = '';
        const saved = await nameForm(bar, { label: 'Your name appears on every leaderboard you’re on.', button: 'Save name', cancel: true });
        editing = false;
        render(saved || cachedName());
      });
    };
    render(cachedName());
    nameListeners.add(render);
    streakListeners.add(() => render(cachedName()));
    // returning players: refresh the streak from the server in the background
    if (cachedName() || (cachedDays().days || []).length) setTimeout(() => profile().catch(() => {}), 800);
    return bar;
  }

  // ---------------------------------------------------------------------------
  // Game-over panel
  // ---------------------------------------------------------------------------
  function offer(board, result, container) {
    if (!info(board) || !container) return;
    injectCss();
    const meta = info(board);
    const daily = meta.group === 'Daily';
    const run = runs.get(board);
    track('game_end', board, {
      score: Math.round(result.score || 0), won: !!result.won,
      duration: Math.round(isTime(board) && result.time ? result.time : run ? (Date.now() - run.startedAt) / 1000 : 0),
    });
    const old = container.querySelector('.lb');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.className = 'lb';
    wrap.innerHTML = `<h3>${daily ? '📅' : '🏆'} ${esc(meta.title.toUpperCase())}</h3><div class="lb-slot"></div><div class="lb-note"></div><div class="lb-extra"></div><ol></ol>`;
    const anchor = container.querySelector('.stats, .win-stats, .grid3');
    if (anchor) anchor.after(wrap); else container.appendChild(wrap);
    const slot = wrap.querySelector('.lb-slot');
    const note = wrap.querySelector('.lb-note');
    const extra = wrap.querySelector('.lb-extra');
    const list = wrap.querySelector('ol');
    shieldKeys(wrap);
    loadInto(list, note, board);

    const canRank = qualifies(board, result);
    // non-daily results that can't rank don't need the server; daily ones still count for the streak
    if (!canRank && !daily) {
      runs.delete(board);
      if (isTime(board)) setNote(note, 'Win to post a time.');
      return;
    }

    const shown = isTime(board) ? fmtTime(result.time || 0) : (result.score || 0).toLocaleString();
    const showStreak = (res) => {
      if (!daily) return;
      const s = streak();
      if (!s.current) return;
      const p = document.createElement('p');
      p.className = 'lb-streak-note';
      p.textContent = s.current === 1 ? '🔥 Daily streak started — come back tomorrow!' : `🔥 ${s.current}-day streak!${s.current >= s.best && s.current > 1 ? ' Your best yet.' : ''}`;
      extra.appendChild(p);
    };
    const showShare = (res) => {
      const row = document.createElement('div');
      row.className = 'lb-share-row';
      row.appendChild(shareButton(() => shareText(board, res), { board, kind: daily ? 'daily' : 'score' }));
      extra.appendChild(row);
    };

    const post = async () => {
      setNote(note, canRank ? 'Posting your score…' : 'Saving today’s challenge…');
      try {
        const res = await submit(board, result);
        if (!wrap.isConnected) return;
        extra.innerHTML = '';
        if (res.needName) {
          setNote(note, '');
          showStreak(res);
          const saved = await nameForm(slot, { label: 'Put your name on the leaderboard', button: `Post ${shown}` });
          if (saved) post();
          return;
        }
        if (!res.posted) {
          setNote(note, isTime(board) ? 'Win to post a time.' : '');
          showStreak(res);
          return;
        }
        const change = '<button type="button" class="lb-textbtn">Change name</button>';
        slot.innerHTML = `<div class="lb-you">Posted as <b>${esc(res.name)}</b> ${change}</div>`;
        slot.querySelector('.lb-textbtn').addEventListener('click', async () => {
          slot.innerHTML = '';
          const saved = await nameForm(slot, { button: 'Save name', cancel: true });
          slot.innerHTML = `<div class="lb-you">Posted as <b>${esc(saved || cachedName())}</b></div>`;
          if (saved) { setNote(note, 'Name updated on all your scores.', 'ok'); loadInto(list, note, board); }
        });
        if (res.improved) setNote(note, `${res.first ? 'On the board' : 'New personal best'}! You're #${res.rank.toLocaleString()} of ${res.total.toLocaleString()}.`, 'ok');
        else setNote(note, `Your best is still ${fmtEntry(board, res.best)} (#${res.rank.toLocaleString()}). Beat it to climb!`);
        showStreak(res);
        showShare(res);
        loadInto(list, note, board);
      } catch (e) {
        console.error('[leaderboard] posting score failed:', e);
        const code = (e && e.code) || '';
        if (code === 'no-run') setNote(note, 'The leaderboard was unreachable when this game started, so this result can’t be posted.', 'err');
        else if (/failed-precondition/.test(code)) setNote(note, 'This result couldn’t be verified, so it wasn’t posted.', 'err');
        else if (/deadline-exceeded/.test(code)) setNote(note, 'This game ran too long ago to post.', 'err');
        else {
          setNote(note, 'Could not post your score — check your connection.', 'err');
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'lb-textbtn';
          retry.textContent = 'Try again';
          retry.addEventListener('click', () => { retry.remove(); post(); });
          note.appendChild(document.createTextNode(' '));
          note.appendChild(retry);
        }
      }
    };
    post();
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

  window.Leaderboard = {
    BOARDS, info, dailyBoards, DAILY_GAMES, ICONS, gameOf, myEntry, top, submit, offer, open, button, nameBar, getName, setName, user, fmtTime,
    startRun, played, resumeRun, runId, profile, streak, share, shareText, shareButton,
    onName: (fn) => nameListeners.add(fn), onStreak: (fn) => streakListeners.add(fn),
  };
})();
