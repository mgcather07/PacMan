/*
 * Achievements, levels and avatars. Pure functions over a player's data, so the profile page, the top bar
 * and the game-over screen all agree:
 *
 *   evaluate({ player, entries, signedIn })  → [{ ...achievement, done, cur, max }]
 *   levelOf(xp) → { level, title, xp, floor, next }
 *   CATEGORIES  → display order and labels for grouping achievements
 *
 * Needs games.js (the game registry) loaded first.
 *
 * player  = players/{uid} (plays, totalPlays, days, bestStreak, dailyFinishes, avatar)
 * entries = the player's leaderboard entries: { board, score, time, won, rank? }. Rank-based
 *           achievements are "held" (they count while you keep the spot) and only use entries with a rank.
 */
const REGISTRY = globalThis.ArcadeGames; // games.js must be loaded first
const GAMES = REGISTRY.list.map((g) => g.id);
const CLASSIC_WINS = REGISTRY.list.filter((g) => g.classicWin).map((g) => g.classicWin);
const isDaily = (board) => /^daily-/.test(board);
const isTime = (board) => REGISTRY.boardType(board) === 'time';
const won = (e) => (isTime(e.board) ? e.time > 0 : e.won === true);
const gameOf = (board) => REGISTRY.gameOf(board);
const yes = (ok) => [ok ? 1 : 0, 1];

// [id, category, icon, name, description, points, (ctx) => [current, goal]]
// Arcade-wide goals use fixed numbers so adding games never re-locks an achievement.
const GENERAL = [
  ['insert-coin', 'general', '🪙', 'Insert Coin', 'Play your first game', 10, (c) => [c.plays, 1]],
  ['name-in-lights', 'general', '🏷️', 'Name in Lights', 'Post a score to any leaderboard', 10, (c) => [c.entries.length, 1]],
  ['new-look', 'general', '🎨', 'New Look', 'Pick an avatar on your profile', 10, (c) => yes(c.player.avatar)],
  ['everywhere', 'general', '☁️', 'Everywhere', 'Sign in with Google to sync your devices', 10, (c) => yes(c.signedIn)],
  ['regular', 'general', '🎮', 'Regular', 'Play 25 games', 20, (c) => [c.plays, 25]],
  ['arcade-rat', 'general', '🕹️', 'Arcade Rat', 'Play 100 games', 40, (c) => [c.plays, 100]],
  ['legend', 'general', '🌟', 'Living Legend', 'Play 500 games', 100, (c) => [c.plays, 500]],
  ['sampler', 'general', '🌈', 'Sampler Platter', 'Play 10 different games', 30, (c) => [c.gamesPlayed, 10]],
  ['globetrotter', 'general', '🧭', 'Globetrotter', 'Play 20 different games', 60, (c) => [c.gamesPlayed, 20]],
  ['specialist', 'general', '🎯', 'Specialist', 'Play one game 50 times', 30, (c) => [Math.max(0, ...Object.values(c.player.plays || {})), 50]],
  ['game-beaten', 'general', '🏁', 'Game Beaten', 'Beat any Classic game', 30, (c) => [c.classicWins, 1]],
  ['completionist', 'general', '💯', 'Completionist', 'Beat 8 different Classic games', 100, (c) => [c.classicWins, 8]],
  ['card-shark', 'general', '🎲', 'Card Shark', 'Win Klondike, Spider and FreeCell', 40, (c) => [['klondike', 'spider', 'freecell'].filter((g) => c.wins(g)).length, 3]],
  ['diamond', 'general', '💎', 'Diamond Player', 'Unlock 30 other achievements', 150, (c) => [c.unlockedSoFar, 30]],
  // daily challenges
  ['daily-driver', 'daily', '📅', 'Daily Driver', 'Finish a daily challenge', 10, (c) => [c.player.dailyFinishes || 0, 1]],
  ['on-fire', 'daily', '🔥', 'On Fire', 'Reach a 3-day daily streak', 20, (c) => [c.player.bestStreak || 0, 3]],
  ['week-warrior', 'daily', '🐉', 'Week Warrior', 'Reach a 7-day daily streak', 40, (c) => [c.player.bestStreak || 0, 7]],
  ['unstoppable', 'daily', '🌋', 'Unstoppable', 'Reach a 30-day daily streak', 100, (c) => [c.player.bestStreak || 0, 30]],
  ['clockwork', 'daily', '⏰', 'Clockwork', 'Finish 50 daily challenges', 60, (c) => [c.player.dailyFinishes || 0, 50]],
  ['clean-sweep', 'daily', '🧹', 'Clean Sweep', 'Post a result in 11 daily challenges on one day', 60, (c) => [c.bestDailyDay, 11]],
  // competition
  ['collector', 'competition', '📋', 'Board Collector', 'Get on 10 different leaderboards', 30, (c) => [c.entries.filter((e) => !isDaily(e.board)).length, 10]],
  ['podium', 'competition', '🥉', 'Podium', 'Hold a top-3 spot on any leaderboard', 30, (c) => yes(c.ranked.some((e) => e.rank <= 3))],
  ['champion', 'competition', '👑', 'Champion', 'Hold #1 on any leaderboard', 50, (c) => yes(c.ranked.some((e) => e.rank === 1))],
  ['daily-champ', 'competition', '🏅', 'Daily Champ', 'Hold #1 on a daily challenge', 50, (c) => yes(c.ranked.some((e) => e.rank === 1 && isDaily(e.board)))],
];

// each game's own achievements, from the registry
const inBoards = (game, boards) => (e) => gameOf(e.board) === game && (boards === '*' || boards.includes(e.board));
function gameCheck(game, a) {
  if (a.kind === 'score') {
    return (c) => [Math.max(0, ...c.entries.filter((e) => gameOf(e.board) === game && !isTime(e.board) && (!a.boards || a.boards.includes(e.board))).map((e) => e.score || 0)), a.goal];
  }
  if (a.kind === 'win') return (c) => yes(c.entries.some((e) => inBoards(game, a.boards)(e) && won(e)));
  if (a.kind === 'fastest') return (c) => yes(c.entries.some((e) => inBoards(game, a.boards)(e) && e.time > 0 && e.time < a.under));
  throw new Error(`unknown achievement kind ${a.kind}`);
}
const DEFS = [
  ...GENERAL,
  ...REGISTRY.list.flatMap((g) => (g.achievements || []).map((a) => [a.id, g.id, a.icon, a.name, a.desc, a.points, gameCheck(g.id, a)])),
];

export const CATEGORIES = [
  { id: 'general', icon: '🕹️', name: 'Arcade' }, { id: 'daily', icon: '📅', name: 'Daily challenges' }, { id: 'competition', icon: '🏆', name: 'Competition' },
  ...REGISTRY.list.map((g) => ({ id: g.id, icon: g.icon, name: g.name })),
];

export const ACHIEVEMENTS = DEFS.map(([id, cat, icon, name, desc, points]) => ({ id, cat, icon, name, desc, points }));

export function evaluate({ player = {}, entries = [], signedIn = false } = {}) {
  const byDay = {};
  entries.filter((e) => isDaily(e.board)).forEach((e) => { const day = e.board.slice(-8); byDay[day] = (byDay[day] || 0) + 1; });
  const ofGame = (game) => entries.filter((e) => gameOf(e.board) === game);
  const ctx = {
    player,
    entries,
    signedIn,
    plays: player.totalPlays || 0,
    gamesPlayed: GAMES.filter((g) => player.plays && player.plays[g]).length,
    ranked: entries.filter((e) => typeof e.rank === 'number'),
    bestDailyDay: Math.max(0, ...Object.values(byDay)),
    classicWins: CLASSIC_WINS.filter((boards) => entries.some((e) => boards.includes(e.board) && won(e))).length,
    // any posted result on a time board is a win (solitaire, including daily deals)
    wins: (game) => ofGame(game).some((e) => isTime(e.board) && e.time > 0),
    unlockedSoFar: 0,
  };
  const out = DEFS.map(([id, cat, icon, name, desc, points, check]) => {
    const base = { id, cat, icon, name, desc, points };
    if (id === 'diamond') return { ...base, check };
    const [cur, max] = check(ctx);
    const done = cur >= max;
    if (done) ctx.unlockedSoFar++;
    return { ...base, done, cur: Math.min(cur, max), max };
  });
  const diamond = out.find((a) => a.id === 'diamond');
  const [cur, max] = diamond.check(ctx);
  delete diamond.check;
  Object.assign(diamond, { done: cur >= max, cur: Math.min(cur, max), max });
  return out;
}

// XP: plays, daily finishes and achievement points
export const xpOf = (player = {}, achievements = []) =>
  (player.totalPlays || 0) * 5 + (player.dailyFinishes || 0) * 20 + achievements.filter((a) => a.done).reduce((n, a) => n + a.points, 0);

// Level L starts at 15·(L−1)² + 60·(L−1) XP: quick early levels, Legend (25) at about 10,000 XP
const TITLES = [[40, 'Mythic'], [25, 'Legend'], [17, 'Champion'], [12, 'Ace'], [8, 'Pro'], [5, 'Challenger'], [3, 'Player'], [1, 'Rookie']];
export const xpForLevel = (level) => 15 * (level - 1) ** 2 + 60 * (level - 1);
export function levelOf(xp) {
  let level = Math.floor((-60 + Math.sqrt(3600 + 60 * Math.max(0, xp))) / 30) + 1;
  if (xpForLevel(level + 1) <= xp) level++; // guard against rounding at exact thresholds
  return { level, title: TITLES.find(([n]) => level >= n)[1], xp, floor: xpForLevel(level), next: xpForLevel(level + 1) };
}

// Avatars: the first twelve are free, the rest unlock with an achievement
export const AVATARS = [
  ['👾'], ['🕹️'], ['👻'], ['🤖'], ['👽'], ['🐱'], ['🦊'], ['🐸'], ['🐍'], ['🚀'], ['🍒'], ['⭐'],
  ['🪙', 'insert-coin'], ['🔥', 'on-fire'], ['🐉', 'week-warrior'], ['🌋', 'unstoppable'], ['🥉', 'podium'], ['👑', 'champion'],
  ['🏁', 'game-beaten'], ['💣', 'bomb-squad'], ['⚡', 'sprinter'], ['🃏', 'card-shark'], ['🕷️', 'four-suits'], ['🌈', 'sampler'],
  ['🦄', 'completionist'], ['💎', 'diamond'],
].map(([icon, unlock]) => ({ icon, unlock: unlock || null }));
export const COLORS = ['#ff3b5c', '#ffe600', '#3cff8a', '#3fd8ff', '#c77dff', '#ff9f1c', '#ff6bd6', '#7ee2a8'];
