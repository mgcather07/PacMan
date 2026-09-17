/*
 * Infinite Arcade backend (Cloud Functions, 2nd gen).
 *
 * Leaderboard entries, player profiles and play statistics are written only from here; the Firestore
 * rules deny all client writes. Every callable requires Firebase Auth (anonymous is fine) and App Check.
 *
 *   startRun({ board, play })          → { runId }   the server clock starts for one game
 *   logPlay({ board })                 → {}          counts a play (games that deal before the first move)
 *   submitScore({ runId, score, time, won }) → posts the run's result if it is plausible for its length
 *   setName({ name })                  → saves the display name and renames all of the player's entries
 *   setAvatar({ icon, color })         → saves the player's avatar and puts it on all of their entries
 *   mergeAccount({ fromToken })        → folds a guest (anonymous) player into the signed-in account
 *   adminStats()                       → dashboard data, for accounts listed in config/admins
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions';
import { onCall, HttpsError } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: 'us-central1', maxInstances: 20, memory: '256MiB', timeoutSeconds: 30 });
const callable = (handler) => onCall({ enforceAppCheck: true }, handler);

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------
const GAMES = ['pacman', 'snake', 'minesweeper', 'frogger', 'breakout', 'asteroids', 'tetris', 'shooter', 'klondike', 'spider', 'freecell'];

// board → [game, mode, type]; type 'time' boards rank the fastest win
const BOARDS = {
  'pacman': ['pacman', 'infinite', 'score'], 'snake': ['snake', 'infinite', 'score'], 'minesweeper': ['minesweeper', 'infinite', 'score'],
  'frogger': ['frogger', 'infinite', 'score'], 'breakout': ['breakout', 'infinite', 'score'], 'asteroids': ['asteroids', 'infinite', 'score'],
  'tetris-tower': ['tetris', 'infinite', 'score'], 'tetris-marathon': ['tetris', 'infinite', 'score'], 'shooter': ['shooter', 'infinite', 'score'],
  'pacman-classic': ['pacman', 'classic', 'score'], 'snake-classic': ['snake', 'classic', 'score'], 'frogger-classic': ['frogger', 'classic', 'score'],
  'breakout-classic': ['breakout', 'classic', 'score'], 'asteroids-classic': ['asteroids', 'classic', 'score'], 'shooter-classic': ['shooter', 'classic', 'score'],
  'tetris-sprint': ['tetris', 'classic', 'time'], 'tetris-marathon150': ['tetris', 'classic', 'score'],
  'mines-beginner': ['minesweeper', 'classic', 'time'], 'mines-intermediate': ['minesweeper', 'classic', 'time'], 'mines-expert': ['minesweeper', 'classic', 'time'],
  'klondike-1': ['klondike', 'solitaire', 'time'], 'klondike-3': ['klondike', 'solitaire', 'time'],
  'spider-1': ['spider', 'solitaire', 'time'], 'spider-2': ['spider', 'solitaire', 'time'], 'spider-4': ['spider', 'solitaire', 'time'],
  'freecell': ['freecell', 'solitaire', 'time'],
};
const TIME_GAMES = ['klondike', 'spider', 'freecell'];

function boardInfo(board) {
  if (typeof board !== 'string') return null;
  if (BOARDS[board]) { const [game, mode, type] = BOARDS[board]; return { board, game, mode, type }; }
  const m = /^daily-([a-z]+)-(\d{8})$/.exec(board);
  if (!m || !GAMES.includes(m[1])) return null;
  return { board, game: m[1], mode: 'daily', type: TIME_GAMES.includes(m[1]) ? 'time' : 'score', day: +m[2] };
}

// ---------------------------------------------------------------------------
// Plausibility limits. A score may not exceed base + perSec·t + perSec²·t² for a run that has lasted
// t seconds on the server clock (several times what a very strong player manages), and a winning time
// may not beat the fastest humanly possible clear or exceed how long the run actually lasted.
// ---------------------------------------------------------------------------
const SCORE_CAP = {
  pacman: [5000, 800, 0.5], snake: [5000, 600, 0.5], minesweeper: [5000, 500, 0], frogger: [5000, 500, 0.2],
  breakout: [10000, 1500, 2], asteroids: [10000, 1000, 2], tetris: [10000, 2000, 5], shooter: [50000, 5000, 10],
  klondike: [50000, 100, 0], spider: [50000, 100, 0], freecell: [50000, 100, 0],
};
const MIN_TIME = {
  'mines-beginner': 1, 'mines-intermediate': 5, 'mines-expert': 20, 'tetris-sprint': 12,
  'klondike-1': 30, 'klondike-3': 30, 'spider-1': 45, 'spider-2': 60, 'spider-4': 90, 'freecell': 20,
  klondike: 30, spider: 45, freecell: 20, // daily solitaire (Draw 1, Spider 1 suit)
};
const TIME_SLACK = 5; // seconds of clock drift / network latency allowed
const RUN_TTL_MS = 3 * 24 * 3600 * 1000; // an infinite Minesweeper field can be resumed indefinitely

const scoreCap = (game, t) => { const [a, b, c] = SCORE_CAP[game]; return a + b * t + c * t * t; };

// ---------------------------------------------------------------------------
// Dates: daily boards use the player's local date, so allow yesterday..tomorrow in UTC
// ---------------------------------------------------------------------------
const keyOfDate = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const dateOfKey = (k) => Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100);
const shiftKey = (k, days) => keyOfDate(new Date(dateOfKey(k) + days * 86400000));
const utcToday = () => keyOfDate(new Date());
const currentDaily = (day) => { const t = utcToday(); return day >= shiftKey(t, -1) && day <= shiftKey(t, 1); };

// longest run of consecutive days ending at the most recent one
function streakOf(days) {
  const sorted = [...new Set(days)].sort((a, b) => b - a);
  let n = sorted.length ? 1 : 0;
  for (let i = 1; i < sorted.length && sorted[i] === shiftKey(sorted[i - 1], -1); i++) n++;
  return n;
}
function bestStreakOf(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let best = 0, run = 0;
  sorted.forEach((d, i) => { run = i && d === shiftKey(sorted[i - 1], 1) ? run + 1 : 1; best = Math.max(best, run); });
  return best;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function requireUser(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
}
function requireBoard(board) {
  const info = boardInfo(board);
  if (!info) throw new HttpsError('invalid-argument', 'Unknown leaderboard.');
  if (info.mode === 'daily' && !currentDaily(info.day)) throw new HttpsError('failed-precondition', 'That daily challenge is closed.');
  return info;
}
const inc = (n = 1) => FieldValue.increment(n);

// puts the player's current name / avatar on all of their leaderboard entries
async function updateEntries(uid, fields) {
  const mine = await db.collectionGroup('scores').where('uid', '==', uid).get();
  const stale = mine.docs.filter((d) => Object.entries(fields).some(([k, v]) => d.data()[k] !== v));
  for (let i = 0; i < stale.length; i += 400) {
    const batch = db.batch();
    stale.slice(i, i + 400).forEach((d) => batch.update(d.ref, fields));
    await batch.commit();
  }
  return stale.length;
}
const renameEntries = (uid, name) => updateEntries(uid, { name });

// ---------------------------------------------------------------------------
// Avatars (some are unlocked by achievements on the client; any listed one is accepted here)
// ---------------------------------------------------------------------------
const AVATAR_ICONS = ['👾', '🕹️', '👻', '🤖', '👽', '🐱', '🦊', '🐸', '🐍', '🚀', '🍒', '⭐', '🪙', '🔥', '🐉', '🌋', '👑', '🥉', '💣', '⚡', '🃏', '🕷️', '🌈', '💎', '🦄', '🏁'];
const AVATAR_COLORS = ['#ff3b5c', '#ffe600', '#3cff8a', '#3fd8ff', '#c77dff', '#ff9f1c', '#ff6bd6', '#7ee2a8'];
const avatarOf = (p) => (p && AVATAR_ICONS.includes(p.avatar) ? { avatar: p.avatar, color: AVATAR_COLORS.includes(p.color) ? p.color : AVATAR_COLORS[0] } : {});

async function recordPlay(uid, info) {
  const day = utcToday();
  const playerRef = db.doc(`players/${uid}`);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(playerRef)).data() || {};
    const now = FieldValue.serverTimestamp();
    const firstOfGame = !(p.plays && p.plays[info.game]);
    const newPlayer = !p.firstSeenAt;
    const activeToday = p.lastActiveDay === day;
    tx.set(playerRef, {
      plays: { [info.game]: inc() }, totalPlays: inc(), lastGame: info.game, lastPlayedAt: now, lastActiveDay: day,
      ...(newPlayer ? { firstSeenAt: now } : {}),
    }, { merge: true });
    tx.set(db.doc('stats/global'), {
      totalPlays: inc(), plays: { [info.game]: inc() }, modes: { [info.mode]: inc() }, updatedAt: now,
      ...(firstOfGame ? { players: { [info.game]: inc() } } : {}),
      ...(newPlayer ? { totalPlayers: inc() } : {}),
    }, { merge: true });
    tx.set(db.doc(`stats/global/days/${day}`), {
      day, totalPlays: inc(), plays: { [info.game]: inc() }, modes: { [info.mode]: inc() },
      ...(activeToday ? {} : { activePlayers: inc() }),
      ...(newPlayer ? { newPlayers: inc() } : {}),
    }, { merge: true });
  });
}

async function rankOn(board, type, best) {
  const col = db.collection(`boards/${board}/scores`);
  const ahead = type === 'time' ? col.where('time', '<', best.time) : col.where('score', '>', best.score);
  const [a, total] = await Promise.all([ahead.count().get(), col.count().get()]);
  return { rank: a.data().count + 1, total: total.data().count };
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------
export const startRun = callable(async (req) => {
  const uid = requireUser(req);
  const info = requireBoard(req.data && req.data.board);
  const ref = db.collection('runs').doc();
  // runs are deleted automatically by a TTL policy on expireAt
  const keepDays = info.board === 'minesweeper' ? 365 : 30;
  await ref.set({ uid, board: info.board, game: info.game, startedAt: Timestamp.now(), used: false, expireAt: Timestamp.fromMillis(Date.now() + keepDays * 86400000) });
  if (req.data.play) {
    try { await recordPlay(uid, info); } catch (e) { logger.error('recordPlay failed', e); }
  }
  return { runId: ref.id };
});

export const logPlay = callable(async (req) => {
  const uid = requireUser(req);
  const info = requireBoard(req.data && req.data.board);
  await recordPlay(uid, info);
  return {};
});

export const submitScore = callable(async (req) => {
  const uid = requireUser(req);
  const { runId } = req.data || {};
  if (typeof runId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(runId)) throw new HttpsError('invalid-argument', 'Missing run.');
  const runRef = db.doc(`runs/${runId}`);
  const playerRef = db.doc(`players/${uid}`);

  const outcome = await db.runTransaction(async (tx) => {
    const [runSnap, playerSnap] = await Promise.all([tx.get(runRef), tx.get(playerRef)]);
    const run = runSnap.data();
    if (!run || run.uid !== uid) throw new HttpsError('not-found', 'Run not found.');
    if (run.rejected) throw new HttpsError('failed-precondition', 'This result could not be verified.');
    const info = boardInfo(run.board);
    const player = playerSnap.data() || {};
    // (transactions must finish reading before they write)
    const entryRef = db.doc(`boards/${run.board}/scores/${uid}`);
    const prevSnap = await tx.get(entryRef);
    const now = Date.now();
    const elapsed = (now - run.startedAt.toMillis()) / 1000;

    // the first submission fixes the run's result; later calls (e.g. after choosing a name) reuse it
    let result = run.result;
    if (!result) {
      if (info.game !== 'minesweeper' && now - run.startedAt.toMillis() > RUN_TTL_MS) throw new HttpsError('deadline-exceeded', 'This run has expired.');
      const d = req.data;
      const score = Math.round(Number(d.score) || 0);
      const time = Math.round((Number(d.time) || 0) * 100) / 100;
      const won = d.won === true;
      const problems = [];
      if (!(score >= 0 && score <= 100000000)) problems.push('score range');
      if (!(time >= 0 && time <= 86400)) problems.push('time range');
      if (score > scoreCap(info.game, elapsed)) problems.push(`score ${score} > cap ${Math.round(scoreCap(info.game, elapsed))} after ${elapsed.toFixed(1)}s`);
      if (info.type === 'time' && won) {
        const min = MIN_TIME[info.board] || MIN_TIME[info.game] || 1;
        if (time < min) problems.push(`time ${time} < minimum ${min}`);
        if (time > elapsed + TIME_SLACK) problems.push(`time ${time} > run length ${elapsed.toFixed(1)}`);
      }
      if (problems.length) {
        logger.warn('rejected result', { uid, board: run.board, runId, score, time, won, elapsed, problems });
        tx.update(runRef, { rejected: problems, used: true, submittedAt: Timestamp.now() });
        return { rejected: true };
      }
      result = { score, time, won };
    }
    const qualifies = info.type === 'time' ? result.won && result.time > 0 : result.score > 0;

    // daily streak: any finished daily challenge counts for its day
    let days = Array.isArray(player.days) ? player.days : [];
    const playerUpdate = {};
    if (info.mode === 'daily' && !run.result) {
      if (!days.includes(info.day)) days = [...days, info.day].sort((a, b) => a - b).slice(-400);
      playerUpdate.days = days;
      playerUpdate.bestStreak = Math.max(player.bestStreak || 0, bestStreakOf(days));
      playerUpdate.dailyFinishes = inc();
    }
    if (!run.result) {
      tx.set(db.doc(`stats/global/days/${utcToday()}`), { finishes: { [info.game]: inc() } }, { merge: true });
    }

    const name = player.name;
    const base = { board: run.board, type: info.type, mode: info.mode, day: info.day || null, qualifies, result, days: days.slice(-60), bestStreak: playerUpdate.bestStreak || player.bestStreak || 0 };
    if (Object.keys(playerUpdate).length) tx.set(playerRef, playerUpdate, { merge: true });

    if (!qualifies) {
      tx.update(runRef, { result, used: true, posted: false, submittedAt: Timestamp.now() });
      return { ...base, posted: false };
    }
    if (!name) {
      tx.update(runRef, { result, submittedAt: Timestamp.now() });
      return { ...base, posted: false, needName: true };
    }
    if (run.posted) return { ...base, posted: true, name, already: true };

    const prev = prevSnap.exists ? prevSnap.data() : null;
    const improved = !prev || (info.type === 'time' ? result.time < prev.time : result.score > prev.score);
    if (improved) tx.set(entryRef, { uid, name, ...avatarOf(player), score: result.score, time: result.time, won: result.won, updatedAt: FieldValue.serverTimestamp() });
    tx.update(runRef, { result, used: true, posted: true, submittedAt: Timestamp.now() });
    return { ...base, posted: true, name, improved, first: !prev, best: improved ? { score: result.score, time: result.time } : { score: prev.score, time: prev.time } };
  });

  if (outcome.rejected) throw new HttpsError('failed-precondition', 'This result could not be verified.');
  if (outcome.posted) {
    if (outcome.already) {
      const snap = await db.doc(`boards/${outcome.board}/scores/${uid}`).get();
      const e = snap.data();
      outcome.best = { score: e.score, time: e.time };
      outcome.improved = false;
    }
    Object.assign(outcome, await rankOn(outcome.board, outcome.type, outcome.best));
  }
  outcome.streak = streakOf(outcome.days);
  return outcome;
});

export const setName = callable(async (req) => {
  const uid = requireUser(req);
  const name = cleanName(req.data && req.data.name);
  if (!name) throw new HttpsError('invalid-argument', 'Use 1–16 letters, numbers or spaces.');
  await db.doc(`players/${uid}`).set({ name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { name, renamed: await renameEntries(uid, name) };
});

export const setAvatar = callable(async (req) => {
  const uid = requireUser(req);
  const { icon, color } = req.data || {};
  if (!AVATAR_ICONS.includes(icon) || !AVATAR_COLORS.includes(color)) throw new HttpsError('invalid-argument', 'Unknown avatar.');
  await db.doc(`players/${uid}`).set({ avatar: icon, color, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { icon, color, updated: await updateEntries(uid, { avatar: icon, color }) };
});

// ---------------------------------------------------------------------------
// Accounts: a player who signs in with Google on a second device already has a guest (anonymous)
// player there. The client proves it owns that guest by sending its ID token, then signs in to the
// Google account and calls mergeAccount, which moves everything onto the Google account:
// the better entry on each board, the union of daily-challenge days, summed play counts and any runs
// still in progress. The guest player and its sign-in are deleted afterwards.
// ---------------------------------------------------------------------------
const better = (type, a, b) => (type === 'time' ? a.time < b.time : a.score > b.score);

export const mergeAccount = callable(async (req) => {
  const uid = requireUser(req);
  const fromToken = req.data && req.data.fromToken;
  if (typeof fromToken !== 'string' || fromToken.length > 4096) throw new HttpsError('invalid-argument', 'Missing guest token.');
  let from;
  try { from = await getAuth().verifyIdToken(fromToken, true); } catch (e) { throw new HttpsError('permission-denied', 'The guest sign-in could not be verified.'); }
  if (from.firebase.sign_in_provider !== 'anonymous') throw new HttpsError('permission-denied', 'Only guest players can be merged.');
  const fromUid = from.uid;
  if (fromUid === uid) return { merged: false };

  const fromRef = db.doc(`players/${fromUid}`);
  const toRef = db.doc(`players/${uid}`);
  const [fromSnap, toSnap, entries, runs] = await Promise.all([
    fromRef.get(), toRef.get(),
    db.collectionGroup('scores').where('uid', '==', fromUid).get(),
    db.collection('runs').where('uid', '==', fromUid).get(),
  ]);
  const a = fromSnap.data() || {};
  const b = toSnap.data() || {};
  const name = b.name || a.name || null;
  const look = b.avatar ? avatarOf(b) : avatarOf(a);

  // player profile
  const days = [...new Set([...(a.days || []), ...(b.days || [])])].sort((x, y) => x - y).slice(-400);
  const plays = { ...(b.plays || {}) };
  Object.entries(a.plays || {}).forEach(([g, n]) => { plays[g] = (plays[g] || 0) + n; });
  const ms = (t) => (t ? t.toMillis() : null);
  const newer = (ms(a.lastPlayedAt) || 0) > (ms(b.lastPlayedAt) || 0) ? a : b;
  const earliest = [a.firstSeenAt, b.firstSeenAt].filter(Boolean).sort((x, y) => x.toMillis() - y.toMillis())[0];
  const merged = {
    ...(name ? { name } : {}),
    ...look,
    days,
    bestStreak: Math.max(a.bestStreak || 0, b.bestStreak || 0, bestStreakOf(days)),
    dailyFinishes: (a.dailyFinishes || 0) + (b.dailyFinishes || 0),
    plays,
    totalPlays: (a.totalPlays || 0) + (b.totalPlays || 0),
    ...(newer.lastPlayedAt ? { lastPlayedAt: newer.lastPlayedAt, lastGame: newer.lastGame || null } : {}),
    ...(a.lastActiveDay || b.lastActiveDay ? { lastActiveDay: Math.max(a.lastActiveDay || 0, b.lastActiveDay || 0) } : {}),
    ...(earliest ? { firstSeenAt: earliest } : {}),
    mergedFrom: FieldValue.arrayUnion(fromUid),
    updatedAt: FieldValue.serverTimestamp(),
  };

  // leaderboard entries: keep the better of the two on each board
  const writes = [];
  const targets = await Promise.all(entries.docs.map((d) => db.doc(`boards/${d.ref.parent.parent.id}/scores/${uid}`).get()));
  entries.docs.forEach((d, i) => {
    const board = d.ref.parent.parent.id;
    const info = boardInfo(board);
    const mine = d.data();
    const theirs = targets[i].exists ? targets[i].data() : null;
    if (info && (!theirs || better(info.type, mine, theirs))) {
      writes.push((batch) => batch.set(targets[i].ref, { uid, name: name || mine.name, ...look, score: mine.score, time: mine.time, won: mine.won, updatedAt: mine.updatedAt || FieldValue.serverTimestamp() }));
    }
    writes.push((batch) => batch.delete(d.ref));
  });
  // runs in progress (e.g. a saved infinite Minesweeper field) keep working on this device
  runs.docs.forEach((d) => writes.push((batch) => batch.update(d.ref, { uid })));

  // the two devices were counted as two players
  if (a.firstSeenAt && b.firstSeenAt) {
    const perGame = {};
    Object.keys(a.plays || {}).forEach((g) => { if ((b.plays || {})[g]) perGame[g] = inc(-1); });
    writes.push((batch) => batch.set(db.doc('stats/global'), { totalPlayers: inc(-1), ...(Object.keys(perGame).length ? { players: perGame } : {}) }, { merge: true }));
  }
  writes.push((batch) => batch.set(toRef, merged, { merge: true }));
  writes.push((batch) => batch.delete(fromRef));

  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => w(batch));
    await batch.commit();
  }
  if (name) await updateEntries(uid, { name, ...look });
  try { await getAuth().deleteUser(fromUid); } catch (e) { logger.warn('could not delete merged guest', { fromUid, e: e.message }); }
  logger.info('merged guest player', { from: fromUid, to: uid, entries: entries.size, runs: runs.size });
  return { merged: true, name, days: days.slice(-60), bestStreak: merged.bestStreak, entries: entries.size };
});

export const adminStats = callable(async (req) => {
  const uid = requireUser(req);
  const cfg = (await db.doc('config/admins').get()).data() || {};
  const email = req.auth.token.email_verified ? String(req.auth.token.email || '').toLowerCase() : '';
  const allowed = (email && (cfg.emails || []).map((e) => String(e).toLowerCase()).includes(email)) || (cfg.uids || []).includes(uid);
  if (!allowed) throw new HttpsError('permission-denied', 'This account is not an admin.');

  const today = utcToday();
  const dayIds = Array.from({ length: 30 }, (_, i) => String(shiftKey(today, -i)));
  const [global, daySnaps, topSnap, streakSnap, recentSnap, playerCount] = await Promise.all([
    db.doc('stats/global').get(),
    db.getAll(...dayIds.map((d) => db.doc(`stats/global/days/${d}`))),
    db.collection('players').orderBy('totalPlays', 'desc').limit(50).get(),
    db.collection('players').orderBy('bestStreak', 'desc').limit(10).get(),
    db.collection('players').orderBy('lastPlayedAt', 'desc').limit(25).get(),
    db.collection('players').count().get(),
  ]);
  // today's daily challenge entries per game (local dates vary, so check yesterday..tomorrow)
  const dailyCounts = {};
  await Promise.all(GAMES.flatMap((g) => [-1, 0, 1].map(async (s) => {
    const k = shiftKey(today, s);
    const c = await db.collection(`boards/daily-${g}-${k}/scores`).count().get();
    dailyCounts[k] = dailyCounts[k] || {};
    dailyCounts[k][g] = c.data().count;
  })));
  const player = (d) => {
    const p = d.data();
    const plays = p.plays || {};
    const favorite = Object.keys(plays).sort((a, b) => plays[b] - plays[a])[0] || null;
    const days = Array.isArray(p.days) ? p.days : [];
    return {
      id: d.id.slice(0, 6), name: p.name || null, totalPlays: p.totalPlays || 0, plays, favorite,
      streak: days.length && days[days.length - 1] >= shiftKey(today, -2) ? streakOf(days) : 0,
      bestStreak: p.bestStreak || 0, dailyFinishes: p.dailyFinishes || 0,
      lastPlayedAt: p.lastPlayedAt ? p.lastPlayedAt.toMillis() : null, firstSeenAt: p.firstSeenAt ? p.firstSeenAt.toMillis() : null,
      lastGame: p.lastGame || null,
    };
  };
  return {
    generatedAt: Date.now(),
    today,
    global: global.exists ? global.data() : {},
    days: daySnaps.map((s, i) => ({ day: +dayIds[i], ...(s.exists ? s.data() : {}) })).reverse(),
    players: playerCount.data().count,
    topPlayers: topSnap.docs.map(player),
    streakLeaders: streakSnap.docs.map(player).filter((p) => p.bestStreak > 0),
    recentPlayers: recentSnap.docs.map(player),
    dailyCounts,
  };
});
