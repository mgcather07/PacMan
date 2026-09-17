/*
 * Online leaderboards, daily streaks and sharing, backed by Cloud Firestore + Cloud Functions.
 *
 * Players start as guests (anonymous sign-in, one hidden ID per device) and can sign in with Google to use
 * the same player on every device; the guest's progress is merged into the Google account. Games call startRun() when a round begins,
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
 *   Leaderboard.account() / onAccount(fn)                          → { signedIn, email } for the Google sign-in
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

  // type: 'score' = higher is better, 'time' = faster is better (must be a win). Built from the registry in games.js.
  const REGISTRY = window.ArcadeGames;
  const BOARDS = {};
  REGISTRY.list.forEach((g) => g.boards.forEach((b) => {
    BOARDS[b.id] = { title: b.title, group: b.group, type: b.type, href: b.href, ...(b.unit ? { unit: b.unit } : {}) };
  }));

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
        const local = ['localhost', '127.0.0.1'].includes(location.hostname);
        // local development against the Firebase emulators: open any page with ?emulators (remembered for the tab)
        let emulators = false;
        if (local) {
          try {
            if (new URLSearchParams(location.search).has('emulators')) sessionStorage.setItem('arcade.emulators', '1');
            emulators = sessionStorage.getItem('arcade.emulators') === '1';
          } catch (e) { /* ignore */ }
        }
        if (local && !emulators) {
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
        const app = appMod.initializeApp(emulators ? { ...CONFIG, projectId: 'demo-arcade' } : CONFIG, 'arcade-leaderboards');
        const provider = emulators
          // the emulators don't verify App Check tokens, so an unsigned one will do
          ? new checkMod.CustomProvider({ getToken: async () => ({ token: `e30.${btoa(JSON.stringify({ sub: CONFIG.appId, aud: ['projects/demo-arcade'], exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '')}.x`, expireTimeMillis: Date.now() + 3600000 }) })
          : new checkMod.ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY);
        checkMod.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
        const auth = authMod.getAuth(app);
        const functions = fnMod.getFunctions(app, 'us-central1');
        if (emulators) {
          authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
          fnMod.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
        }
        const call = async (name, data) => (await fnMod.httpsCallable(functions, name, { timeout: 30000 })(data)).data;
        authMod.onAuthStateChanged(auth, authChanged);
        const db = fs.getFirestore(app);
        if (emulators) fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
        return (fbLoaded = { fs, db, auth, authMod, call });
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
        const u = auth.currentUser || (await withTimeout(authMod.signInAnonymously(auth), 20000, 'anonymous sign-in')).user;
        // a merge interrupted by a lost connection finishes on the next visit
        if (!u.isAnonymous && readJson(MERGE_KEY)) setTimeout(() => finishMerge().then((r) => r && reloadPlayer()).catch(() => {}), 0);
        return u;
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

  // per-game accent colors and icons, shared by the site pages
  const COLORS = Object.fromEntries(REGISTRY.list.map((g) => [g.id, g.color]));
  const ICONS = Object.fromEntries(REGISTRY.list.map((g) => [g.id, g.icon]));
  const gameOf = (board) => REGISTRY.gameOf(board);
  const modeOf = (board) => (info(board) ? info(board).group.toLowerCase() : 'unknown');

  // Daily challenge boards: daily-<game>-<YYYYMMDD>
  // game → [name, daily board type, page]
  const DAILY_GAMES = Object.fromEntries(REGISTRY.list.map((g) => [g.id, [g.name, g.type, g.path]]));
  function dayLabel(key) {
    const d = new Date(Math.floor(key / 10000), Math.floor(key / 100) % 100 - 1, key % 100);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function info(board) {
    if (Object.hasOwn(BOARDS, board)) return BOARDS[board];
    const m = /^daily-([a-z0-9]+)-(\d{8})$/.exec(board || '');
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

  // how many players are on a board
  async function count(board) {
    const { fs, db } = await firebase();
    return (await withTimeout(fs.getCount(fs.collection(db, 'boards', board, 'scores')), 15000, `counting ${board}`)).data().count;
  }

  // Daily challenges finished on this device (any result, posted or not): { YYYYMMDD: [game, …] }
  const DONE_KEY = 'arcade.dailyDone';
  const readDone = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch (e) { return {}; } };
  function markDailyDone(board) {
    const meta = info(board);
    if (!meta || meta.group !== 'Daily') return;
    const done = readDone();
    const list = new Set(done[meta.day] || []);
    list.add(meta.game);
    done[meta.day] = [...list];
    // keep the last few days only
    Object.keys(done).map(Number).sort((a, b) => b - a).slice(4).forEach((k) => { delete done[k]; });
    try { localStorage.setItem(DONE_KEY, JSON.stringify(done)); } catch (e) { /* ignore */ }
  }
  const dailyDone = (key) => new Set(readDone()[key] || []);
  // the next daily challenge (in menu order) this device hasn't finished, or null when all are done
  function nextDaily(key, except) {
    const done = dailyDone(key);
    const order = Object.keys(DAILY_GAMES);
    const start = Math.max(0, order.indexOf(except) + 1);
    const game = [...order.slice(start), ...order.slice(0, start)].find((g) => g !== except && !done.has(g));
    return game ? { game, name: DAILY_GAMES[game][0], icon: ICONS[game], href: `${DAILY_GAMES[game][2]}?daily=${key}` } : null;
  }
  const playedDays = () => cachedDays().days || [];

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
  const cachedAvatar = () => { try { return JSON.parse(localStorage.getItem('arcade.avatar') || 'null'); } catch (e) { return null; } };
  const cacheAvatar = (p) => { try { if (p && p.avatar) localStorage.setItem('arcade.avatar', JSON.stringify({ icon: p.avatar, color: p.color || '#ff3b5c' })); else localStorage.removeItem('arcade.avatar'); } catch (e) { /* ignore */ } };
  // avatar tile: the chosen icon on its color, or the name's first letter
  function avatarHtml(name, look, cls = 'lb-avatar') {
    if (look && look.icon) return `<span class="${cls} has-icon" style="--av:${esc(look.color || '#ff3b5c')}" aria-hidden="true">${esc(look.icon)}</span>`;
    return `<span class="${cls}" aria-hidden="true">${esc((name || '?').charAt(0).toUpperCase())}</span>`;
  }
  const nameListeners = new Set();
  const notifyName = (name) => nameListeners.forEach((fn) => { try { fn(name); } catch (e) { console.error('[leaderboard] name listener', e); } });

  // ---------------------------------------------------------------------------
  // Profile: name + daily streak (players/{uid}, readable only by its owner)
  // ---------------------------------------------------------------------------
  const cachedDays = () => { try { return JSON.parse(localStorage.getItem('arcade.days') || '{}'); } catch (e) { return {}; } };
  const streakListeners = new Set();
  function cacheDays(days, bestStreak, replace = false) {
    const prev = replace ? {} : cachedDays();
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
        if (snap.exists()) cacheAvatar(data);
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
    notifyName(name);
    if (window.Analytics) Analytics.event('name_set');
    return name;
  }

  async function setAvatar(icon, color) {
    const res = await call('setAvatar', { icon, color });
    cacheAvatar({ avatar: res.icon, color: res.color });
    notifyName(cachedName());
    if (window.Analytics) Analytics.event('avatar_set', { avatar: icon });
    return res;
  }

  // ---------------------------------------------------------------------------
  // Player summary: stats, personal bests, achievements and level (see achievements.js)
  // ---------------------------------------------------------------------------
  let achievementsModule = null;
  const loadAchievements = () => (achievementsModule = achievementsModule || import('/shared/achievements.js').catch((e) => { achievementsModule = null; throw e; }));
  const summaryListeners = new Set();
  const cachedLevel = () => readJson('arcade.level');

  // every leaderboard entry this player has, optionally with rank and player count
  async function myEntries({ ranks = false } = {}) {
    const { fs, db } = await firebase();
    const u = await user();
    const snap = await withTimeout(fs.getDocs(fs.query(fs.collectionGroup(db, 'scores'), fs.where('uid', '==', u.uid))), 15000, 'reading your scores');
    const entries = snap.docs.map((d) => ({ board: d.ref.parent.parent.id, ...d.data() })).filter((e) => info(e.board));
    if (ranks) {
      await Promise.all(entries.map(async (e) => {
        try { [e.rank, e.total] = await Promise.all([rankOf(e.board, e), count(e.board)]); } catch (err) { /* leave unranked */ }
      }));
    }
    return entries;
  }

  async function summary({ ranks = false } = {}) {
    const { fs, db } = await firebase();
    const u = await user();
    const [mod, snap, entries] = await Promise.all([
      loadAchievements(),
      withTimeout(fs.getDoc(fs.doc(db, 'players', u.uid)), 12000, 'reading profile'),
      myEntries({ ranks }),
    ]);
    const player = snap.exists() ? snap.data() : {};
    if (player.name) cacheName(player.name);
    if (snap.exists()) cacheAvatar(player);
    cacheDays(player.days || [], player.bestStreak || 0);
    const achievements = mod.evaluate({ player, entries, signedIn: !u.isAnonymous });
    const xp = mod.xpOf(player, achievements);
    const level = mod.levelOf(xp);
    writeJson('arcade.level', { level: level.level, title: level.title });
    const result = { uid: u.uid, player, entries, achievements, xp, level, signedIn: !u.isAnonymous, email: account().email };
    summaryListeners.forEach((fn) => { try { fn(result); } catch (e) { console.error('[leaderboard] summary listener', e); } });
    return result;
  }

  // achievements unlocked by the game that just ended (each one is announced once per device)
  const SEEN_KEY = 'arcade.achSeen';
  async function newAchievements(board, res) {
    const s = await summary();
    if (res && res.rank) s.entries.filter((e) => e.board === board).forEach((e) => { e.rank = res.rank; });
    const mod = await loadAchievements();
    const done = mod.evaluate({ player: s.player, entries: s.entries, signedIn: s.signedIn }).filter((a) => a.done);
    const seenList = readJson(SEEN_KEY);
    // players from before achievements existed: remember what they already have without announcing it
    const seen = new Set(seenList || ((s.player.totalPlays || 0) > 3 ? done.map((a) => a.id) : []));
    const fresh = done.filter((a) => !seen.has(a.id));
    fresh.forEach((a) => seen.add(a.id));
    writeJson(SEEN_KEY, [...seen]);
    return fresh;
  }
  const markAchievementsSeen = (list) => {
    const seen = new Set(readJson(SEEN_KEY) || []);
    list.filter((a) => a.done).forEach((a) => seen.add(a.id));
    writeJson(SEEN_KEY, [...seen]);
  };

  // ---------------------------------------------------------------------------
  // Accounts: everyone starts as a guest; signing in with Google makes the same player (name, scores,
  // streak) available on every device. On a device whose guest has already played, the Google account
  // may already belong to a player from another device: the guest's progress is merged into it.
  // ---------------------------------------------------------------------------
  const ACCOUNT_KEY = 'arcade.account';
  const MERGE_KEY = 'arcade.pendingMerge';
  const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const writeJson = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const accountListeners = new Set();
  let fbLoaded = null; // set once Firebase has loaded, so a tap can open the Google window right away
  let authUid = null;
  let switching = false;

  function account() {
    const a = readJson(ACCOUNT_KEY);
    return a && a.email ? { signedIn: true, email: a.email } : { signedIn: false, email: '' };
  }
  function setAccount(u) {
    const next = u && !u.isAnonymous ? { email: u.email || ((u.providerData || []).find((p) => p.email) || {}).email || 'your Google account' } : null;
    if (JSON.stringify(readJson(ACCOUNT_KEY)) === JSON.stringify(next)) return;
    writeJson(ACCOUNT_KEY, next);
    const a = account();
    accountListeners.forEach((fn) => { try { fn(a); } catch (e) { console.error('[leaderboard] account listener', e); } });
  }
  // sign-in changes, including ones made in another tab
  function authChanged(u) {
    if (switching) return;
    if (u) {
      setAccount(u);
      if (authUid && u.uid !== authUid) { userPromise = Promise.resolve(u); reloadPlayer().catch(() => {}); }
      authUid = u.uid;
    } else if (authUid) {
      userPromise = null;
      profilePromise = null;
    }
  }

  // re-read the player after switching accounts
  async function reloadPlayer() {
    const { fs, db } = await firebase();
    const u = await user();
    const snap = await withTimeout(fs.getDoc(fs.doc(db, 'players', u.uid)), 12000, 'reading profile');
    const data = snap.exists() ? snap.data() : {};
    cacheName(data.name || '');
    cacheAvatar(data);
    cacheDays(data.days || [], data.bestStreak || 0, true);
    profilePromise = Promise.resolve({ name: data.name || '', streak: streak() });
    notifyName(data.name || '');
    return data;
  }

  async function finishMerge() {
    const pending = readJson(MERGE_KEY);
    if (!pending) return null;
    if (Date.now() - pending.at > 55 * 60000) { writeJson(MERGE_KEY, null); return null; } // the guest token has expired
    try {
      const res = await call('mergeAccount', { fromToken: pending.token });
      writeJson(MERGE_KEY, null);
      return res;
    } catch (e) {
      if (/permission-denied|invalid-argument/.test((e && e.code) || '')) writeJson(MERGE_KEY, null);
      throw e;
    }
  }

  // Loads Firebase and the guest player so the sign-in button can open Google's window straight from a tap
  const prepareSignIn = () => user().then(() => fbLoaded);

  // Must be called directly from a click/tap (browsers only allow pop-ups from one).
  // Resolves to { merged } once this device is playing as the Google account's player.
  function signInWithGoogle() {
    const fb = fbLoaded;
    const guest = fb && fb.auth.currentUser;
    if (!guest) return Promise.reject(Object.assign(new Error('not-ready'), { code: 'not-ready' }));
    if (!guest.isAnonymous) return Promise.resolve({ merged: false });
    const { auth, authMod } = fb;
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return authMod.linkWithPopup(guest, provider).then(
      (cred) => { setAccount(cred.user); return { merged: false }; },
      async (e) => {
        if (!e || e.code !== 'auth/credential-already-in-use') throw e;
        // this Google account already has a player (from another device): switch to it and bring this guest along
        const credential = authMod.GoogleAuthProvider.credentialFromError(e);
        if (!credential) throw e;
        writeJson(MERGE_KEY, { token: await guest.getIdToken(), at: Date.now() });
        switching = true;
        try {
          const { user: u } = await authMod.signInWithCredential(auth, credential);
          userPromise = Promise.resolve(u);
          authUid = u.uid;
          setAccount(u);
        } finally { switching = false; }
        try {
          await finishMerge();
        } catch (err) {
          console.error('[leaderboard] merging the guest player failed:', err);
          throw Object.assign(new Error('merge-failed'), { code: 'merge-failed' });
        }
        return { merged: true };
      },
    ).then(async (res) => {
      await reloadPlayer().catch(() => {});
      if (window.Analytics) Analytics.event('login', { method: 'Google', merged: res.merged });
      return res;
    });
  }

  async function signOut() {
    const { auth, authMod } = await firebase();
    if (window.Analytics) Analytics.event('logout');
    await authMod.signOut(auth);
    ['arcade.name', 'arcade.days', DONE_KEY, ACCOUNT_KEY, MERGE_KEY].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    location.reload();
  }

  // ---------------------------------------------------------------------------
  // Runs: the server times every game so results can be checked
  // ---------------------------------------------------------------------------
  const runs = new Map(); // board → { promise: Promise<runId|null>, startedAt }

  function track(name, board, extra = {}) {
    if (window.Analytics && info(board)) Analytics.event(name, { game: gameOf(board), mode: modeOf(board), board, ...extra });
  }

  // the last few games this player opened, for the home page's "Jump back in" row
  function remember(board) {
    const game = gameOf(board);
    if (!game) return;
    try {
      const ids = [game, ...(readJson('arcade.recent') || []).filter((g) => g !== game)].slice(0, 5);
      writeJson('arcade.recent', ids);
    } catch (e) { /* ignore */ }
  }

  // Call when a round begins. play: false for games dealt before the player does anything (call played() later).
  function startRun(board, { play = true } = {}) {
    if (!info(board)) return Promise.resolve(null);
    remember(board);
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
      markDailyDone(board);
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
      .lb-avatar.has-icon, .lb-av.has-icon { background: color-mix(in srgb, var(--av) 26%, #0b0b16); box-shadow: inset 0 0 0 1.5px var(--av); font-size: 15px; line-height: 1; }
      .lb-av { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 5px; background: #ffffff14; color: #ddd; font: 800 11px Inter, system-ui, sans-serif; vertical-align: middle; }
      .lb-av.has-icon { font-size: 12px; border-radius: 5px; }
      .lb li .nm { display: flex; align-items: center; gap: 7px; min-width: 0; }
      .lb li .nm .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lb-ach { margin: 4px 0 12px; padding: 12px 14px; border-radius: 6px; text-align: center; background: linear-gradient(180deg, #ffd70024, #ffd70008); border: 1px solid #ffd70088; box-shadow: 3px 3px 0 #5a4500; animation: lb-pop .5s cubic-bezier(.2, 1.6, .4, 1); }
      .lb-ach h4 { margin: 0 0 8px; font: 9px/1.5 "Press Start 2P", monospace; color: #ffd700; text-shadow: 0 0 10px #ffd70088; }
      .lb-ach .row { display: flex; align-items: center; justify-content: center; gap: 10px; margin: 6px 0; font: 700 14px Inter, system-ui, sans-serif; color: #fff; text-align: left; }
      .lb-ach .row .ic { font-size: 24px; }
      .lb-ach .row small { display: block; font-weight: 400; color: #d8cfa0; font-size: 12px; }
      .lb-ach .row .xp { font: 8px "Press Start 2P", monospace; color: #ffd700; margin-left: 4px; white-space: nowrap; }
      .lb-ach a { display: inline-block; margin-top: 6px; font: 8px "Press Start 2P", monospace; color: #ffd700; text-decoration: none; }
      @keyframes lb-pop { from { transform: scale(.7); opacity: 0; } }
      .lb-chip .lb-who { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .lb-chip .lb-who b { color: #fff; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .lb-chip .lb-edit { flex: none; font: 600 13px Inter, system-ui, sans-serif; color: #ffe600; background: #ffe60014; border: 1px solid #ffe60040; border-radius: 999px; padding: 7px 12px; cursor: pointer; line-height: 1; }
      .lb-chip .lb-edit:hover { background: #ffe60026; }
      .lb-chip.empty { padding-left: 14px; }
      .lb-chip .lb-pre { white-space: nowrap; }
      .lb-streak { flex: none; display: inline-flex; align-items: center; gap: 3px; padding: 5px 8px; border-radius: 999px; background: #dc143c26; border: 1px solid #dc143c66; color: #ff8fa3; font: 800 12px Inter, system-ui, sans-serif; line-height: 1; }
      .lb-streak.dim { background: #ffffff0d; border-color: #ffffff26; color: #b8b8d0; }
      .lb-share-row { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin: 2px 0 10px; }
      .lb-btn.lb-share { font: 10px/1.4 "Press Start 2P", monospace; text-transform: uppercase; background: #dc143c; color: #fff; border: 1px solid #ff5c7a; border-radius: 4px; padding: 11px 14px; box-shadow: 3px 3px 0 #5a0717; }
      .lb-btn.lb-share:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 #5a0717; }
      .lb-btn.lb-share:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 #5a0717; }
      .lb-next-slot { display: flex; justify-content: center; margin: 2px 0 12px; }
      .lb-next { display: inline-flex; align-items: center; gap: 8px; font: 10px/1.4 "Press Start 2P", monospace; text-transform: uppercase; color: #fff; text-decoration: none;
        padding: 11px 14px; border-radius: 4px; background: linear-gradient(#dc143c33, #dc143c33), #12080d; border: 1px solid #dc143c99; box-shadow: 3px 3px 0 #5a0717; }
      .lb-next:hover { background: linear-gradient(#dc143c55, #dc143c55), #12080d; transform: translate(-1px, -1px); box-shadow: 4px 4px 0 #5a0717; }
      .lb-chip .lb-sm { display: none; }
      .lb-sync { flex: none; position: relative; text-decoration: none; font: 600 13px Inter, system-ui, sans-serif; color: #9fe9ff; background: #3fd8ff14; border: 1px solid #3fd8ff47; border-radius: 999px; padding: 7px 11px; cursor: pointer; line-height: 1; white-space: nowrap; }
      .lb-sync:hover { background: #3fd8ff29; }
      .lb-sync.on { color: #7dff9a; background: #3cff8a12; border-color: #3cff8a47; }
      .lb-sync.on::after { content: ''; position: absolute; top: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: #3cff8a; box-shadow: 0 0 6px #3cff8a; }
      .lb-acct { margin: 0 auto; padding: 16px; border-radius: 14px; background: #0c0c20f2; border: 1px solid #3fd8ff47; box-shadow: 4px 4px 0 #0a3a48; text-align: center; font: 14px/1.5 Inter, system-ui, sans-serif; color: #c8c8dc; box-sizing: border-box; }
      .lb-acct h4 { margin: 0 0 8px; font: 11px/1.6 "Press Start 2P", monospace; color: #3fd8ff; letter-spacing: .5px; }
      .lb-acct.on h4 { color: #3cff8a; }
      .lb-acct p { margin: 0 0 12px; }
      .lb-acct b { color: #fff; word-break: break-all; }
      .lb-acct-row { display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
      .lb-acct-row button { font: 600 14px Inter, system-ui, sans-serif; padding: 10px 16px; border-radius: 10px; cursor: pointer; border: 1px solid #ffffff30; background: #ffffff14; color: #fff; }
      .lb-acct-row button:disabled { opacity: .55; cursor: default; }
      .lb-acct-row .lb-google { display: inline-flex; align-items: center; gap: 10px; background: #fff; color: #1f1f1f; border-color: #dadce0; font-family: Roboto, Inter, system-ui, sans-serif; font-weight: 500; }
      .lb-acct-row .lb-google svg { width: 18px; height: 18px; flex: none; }
      .lb-acct-row .lb-out.armed { background: #dc143c; border-color: #ff5c7a; }
      .lb-acct .lb-note { margin: 10px 0 0; }
      .lb-acct .lb-fine { margin: 10px 0 0; font-size: 12px; color: #8a8aa6; }
      .lb-acct ul { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 4px; font-size: 13px; }
      .lb-streak-note { text-align: center; font: 700 14px Inter, system-ui, sans-serif; color: #ff8fa3; margin: 0 0 8px; }
      @media (max-width: 480px) {
        .lb-chip .lb-pre, .lb-chip .lb-lg { display: none; }
        .lb-chip .lb-sm { display: inline; }
        .lb-chip { gap: 7px; }
        .lb-chip .lb-edit, .lb-sync { padding: 7px 9px; }
        .lb-sync span { display: none; }
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
      .lb li.me .nm .txt::after { content: ' (you)'; color: #ffe600; font-size: 12px; }
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
      @media (max-width: 560px) { .lb-open span { display: none; } }
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
        <span class="nm">${avatarHtml(e.name, e.avatar ? { icon: e.avatar, color: e.color } : null, 'lb-av')}<span class="txt">${esc(e.name)}${e.won && !isTime(board) && info(board).group === 'Classic' ? ' 🏆' : ''}</span></span>
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

  const GOOGLE_G = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  function signInError(e) {
    const code = (e && e.code) || '';
    if (/popup-closed-by-user|cancelled-popup-request|user-cancelled/.test(code)) return '';
    if (code === 'not-ready') return 'Still connecting — tap Sign in again.';
    if (code === 'merge-failed') return 'You’re signed in, but this device’s scores haven’t moved over yet. They’ll finish syncing next time you visit.';
    if (/popup-blocked/.test(code)) return 'The Google window was blocked. Allow pop-ups for this site, then try again.';
    if (/network-request-failed|timeout/.test(code + ((e && e.message) || ''))) return 'Couldn’t reach Google — check your connection and try again.';
    if (/operation-not-supported|web-storage-unsupported|unauthorized-domain/.test(code)) return 'Google sign-in doesn’t work in this browser. Open the arcade in Safari or Chrome and try there.';
    if (/operation-not-allowed/.test(code)) return 'Google sign-in isn’t switched on for the arcade yet.';
    return 'Sign-in didn’t work — please try again.';
  }

  // Sign in with Google / signed-in details. Resolves when the panel is closed.
  function accountPanel(parent, { inline = false } = {}) {
    injectCss();
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'lb-acct';
      parent.appendChild(wrap);
      shieldKeys(wrap);
      const close = () => { wrap.remove(); resolve(account()); };
      const render = (message = '', kind = 'ok') => {
        const a = account();
        wrap.classList.toggle('on', a.signedIn);
        if (a.signedIn) {
          wrap.innerHTML = `<h4>☁️ SYNCED ACROSS DEVICES</h4>
            <p>Signed in as <b>${esc(a.email)}</b></p>
            <p>Sign in with this Google account on your other devices to play as the same player everywhere.</p>
            <div class="lb-acct-row"><button type="button" class="lb-done">Done</button><button type="button" class="lb-out">Sign out</button></div>
            <div class="lb-note"></div>`;
          const note = wrap.querySelector('.lb-note');
          if (message) setNote(note, message, kind);
          const out = wrap.querySelector('.lb-out');
          out.addEventListener('click', () => {
            if (!out.classList.contains('armed')) {
              out.classList.add('armed');
              out.textContent = 'Tap again to sign out';
              setNote(note, 'This device will start over as a new guest until you sign in again. Your scores stay safe in your Google account.');
              return;
            }
            out.disabled = true;
            setNote(note, 'Signing out…');
            signOut().catch(() => { out.disabled = false; setNote(note, 'Couldn’t sign out — check your connection.', 'err'); });
          });
        } else {
          wrap.innerHTML = `<h4>☁️ PLAY ON EVERY DEVICE</h4>
            <p>Sign in with Google on your computer, phone and tablet to keep one name, one set of scores and one daily streak everywhere.</p>
            <ul><li>✓ What you’ve played on this device comes with you</li><li>✓ Your email is never shown to other players</li></ul>
            <div class="lb-acct-row"><button type="button" class="lb-google" disabled>${GOOGLE_G}<span>Sign in with Google</span></button><button type="button" class="lb-done">Not now</button></div>
            <div class="lb-note"></div>`;
          const note = wrap.querySelector('.lb-note');
          const google = wrap.querySelector('.lb-google');
          const ready = () => { google.disabled = false; };
          if (fbLoaded && fbLoaded.auth.currentUser) ready();
          else {
            setNote(note, 'Connecting…');
            prepareSignIn().then(() => { setNote(note, message, message ? kind : ''); ready(); })
              .catch(() => setNote(note, 'Couldn’t connect — check your connection and reopen this.', 'err'));
          }
          if (message) setNote(note, message, kind);
          google.addEventListener('click', () => {
            google.disabled = true;
            setNote(note, 'Finish signing in with Google…');
            signInWithGoogle()
              .then((res) => render(res.merged ? 'Synced! This device’s scores and streak were added to your account.' : 'Synced! Now sign in with Google on your other devices.'))
              .catch((e) => {
                console.warn('[leaderboard] Google sign-in:', e);
                if (account().signedIn) { render(signInError(e), 'err'); return; }
                setNote(note, signInError(e), 'err');
                google.disabled = false;
              });
          });
        }
        const done = wrap.querySelector('.lb-done');
        if (inline) done.remove(); else done.addEventListener('click', close);
      };
      render();
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
    const profileLink = () => {
      if (location.pathname.startsWith('/profile')) return '';
      const a = account();
      return `<a class="lb-sync${a.signedIn ? ' on' : ''}" href="/profile/" title="${esc(a.signedIn ? `Your profile · synced with Google (${a.email})` : 'Your profile, achievements and settings')}">👤<span> Profile</span></a>`;
    };
    const render = (name) => {
      if (editing) return;
      bar.innerHTML = name
        ? `<div class="lb-chip">${avatarHtml(name, cachedAvatar())}<span class="lb-who"><span class="lb-pre">Playing as</span> <b>${esc(name)}</b></span>${badge()}<button type="button" class="lb-edit"><span class="lb-lg">Change name</span><span class="lb-sm">Rename</span></button>${profileLink()}</div>`
        : `<div class="lb-chip empty"><span class="lb-who">Want your name on the leaderboards?</span>${badge()}<button type="button" class="lb-edit">Add your name</button>${profileLink()}</div>`;
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
    accountListeners.add(() => render(cachedName()));
    // returning players: refresh the streak (and sign-in state) from the server in the background
    if (cachedName() || (cachedDays().days || []).length || account().signedIn) setTimeout(() => profile().catch(() => {}), 800);
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
    wrap.innerHTML = `<h3>${daily ? '📅' : '🏆'} ${esc(meta.title.toUpperCase())}</h3><div class="lb-slot"></div><div class="lb-note"></div><div class="lb-extra"></div><div class="lb-next-slot"></div><ol></ol>`;
    const anchor = container.querySelector('.stats, .win-stats, .grid3');
    if (anchor) anchor.after(wrap); else container.appendChild(wrap);
    const slot = wrap.querySelector('.lb-slot');
    const note = wrap.querySelector('.lb-note');
    const extra = wrap.querySelector('.lb-extra');
    const nextSlot = wrap.querySelector('.lb-next-slot');
    // daily challenges: point to the next one you haven't finished today
    const showNext = () => {
      if (!daily) return;
      const next = nextDaily(meta.day, meta.game);
      nextSlot.innerHTML = next
        ? `<a class="lb-next" href="${esc(next.href)}">NEXT: ${next.icon} ${esc(next.name)} ▶</a>`
        : '<a class="lb-next" href="/daily/">🏆 ALL CHALLENGES DONE ▶</a>';
    };
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

    const showAchievements = (res) => {
      newAchievements(board, res).then((fresh) => {
        if (!fresh.length || !wrap.isConnected) return;
        const box = document.createElement('div');
        box.className = 'lb-ach';
        box.innerHTML = `<h4>🏆 ACHIEVEMENT${fresh.length > 1 ? 'S' : ''} UNLOCKED!</h4>${fresh.map((a) => `<div class="row"><span class="ic">${a.icon}</span><span>${esc(a.name)}<small>${esc(a.desc)}</small></span><span class="xp">+${a.points} XP</span></div>`).join('')}<a href="/profile/#achievements">VIEW ACHIEVEMENTS ▶</a>`;
        extra.prepend(box);
        if (window.Analytics) fresh.forEach((a) => Analytics.event('unlock_achievement', { achievement_id: a.id }));
      }).catch((e) => console.warn('[leaderboard] achievements check failed:', e));
    };

    const post = async () => {
      setNote(note, canRank ? 'Posting your score…' : 'Saving today’s challenge…');
      try {
        const res = await submit(board, result);
        if (!wrap.isConnected) return;
        extra.innerHTML = '';
        showNext();
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
          showAchievements(res);
          return;
        }
        const posted = (name) => {
          slot.innerHTML = `<div class="lb-you">Posted as <b>${esc(name)}</b> <button type="button" class="lb-textbtn lb-rename">Change name</button>${account().signedIn ? '' : '<button type="button" class="lb-textbtn lb-sync-link">☁️ Sync devices</button>'}</div>`;
          slot.querySelector('.lb-rename').addEventListener('click', async () => {
            slot.innerHTML = '';
            const saved = await nameForm(slot, { button: 'Save name', cancel: true });
            posted(saved || cachedName());
            if (saved) { setNote(note, 'Name updated on all your scores.', 'ok'); loadInto(list, note, board); }
          });
          const sync = slot.querySelector('.lb-sync-link');
          if (sync) sync.addEventListener('click', async () => {
            slot.innerHTML = '';
            const a = await accountPanel(slot);
            posted(cachedName() || name);
            if (a.signedIn) loadInto(list, note, board);
          });
        };
        posted(res.name);
        if (res.improved) setNote(note, `${res.first ? 'On the board' : 'New personal best'}! You're #${res.rank.toLocaleString()} of ${res.total.toLocaleString()}.`, 'ok');
        else setNote(note, `Your best is still ${fmtEntry(board, res.best)} (#${res.rank.toLocaleString()}). Beat it to climb!`);
        showStreak(res);
        showShare(res);
        showAchievements(res);
        loadInto(list, note, board);
      } catch (e) {
        console.error('[leaderboard] posting score failed:', e);
        showNext();
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
    b.innerHTML = '🏆<span> Leaderboard</span>'; // toolbars hide the label on small screens
    b.title = 'Leaderboard';
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(typeof boardOrFn === 'function' ? boardOrFn() : boardOrFn);
    });
    parent.appendChild(b);
    return b;
  }

  window.Leaderboard = {
    BOARDS, GAMES: REGISTRY, info, dailyBoards, DAILY_GAMES, ICONS, gameOf, myEntry, top, submit, offer, open, button, nameBar, getName, setName, user, fmtTime,
    startRun, played, resumeRun, runId, profile, streak, share, shareText, shareButton, count, dailyDone, nextDaily, playedDays,
    account, accountPanel, signInWithGoogle, signOut, injectCss, COLORS, avatarHtml, cachedAvatar, setAvatar, summary, myEntries, cachedLevel, markAchievementsSeen,
    cachedName: () => cachedName(), onSummary: (fn) => summaryListeners.add(fn),
    onName: (fn) => nameListeners.add(fn), onStreak: (fn) => streakListeners.add(fn), onAccount: (fn) => accountListeners.add(fn),
  };
})();
