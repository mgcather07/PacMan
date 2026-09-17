/*
 * Achievements, levels and avatars. Pure functions over a player's data, so the profile page, the top bar
 * and the game-over screen all agree:
 *
 *   evaluate({ player, entries, signedIn })  → [{ ...achievement, done, cur, max }]
 *   levelOf(xp) → { level, title, xp, floor, next }
 *
 * player  = players/{uid} (plays, totalPlays, days, bestStreak, dailyFinishes, avatar)
 * entries = the player's leaderboard entries: { board, score, time, won, rank? }. Rank-based
 *           achievements are "held" (they count while you keep the spot) and only use entries with a rank.
 */
const GAMES = ['pacman', 'snake', 'minesweeper', 'frogger', 'breakout', 'asteroids', 'tetris', 'shooter', 'klondike', 'spider', 'freecell'];
const CLASSIC_WINS = [
  ['pacman-classic'], ['snake-classic'], ['frogger-classic'], ['breakout-classic'], ['asteroids-classic'], ['shooter-classic'],
  ['tetris-sprint', 'tetris-marathon150'], ['mines-beginner', 'mines-intermediate', 'mines-expert'],
];
const TIME_BOARD = /^(mines-|tetris-sprint|klondike|spider|freecell|daily-(klondike|spider|freecell)-)/;
const isDaily = (board) => /^daily-/.test(board);
const won = (e) => (TIME_BOARD.test(e.board) ? e.time > 0 : e.won === true);

// [id, icon, name, description, points, (ctx) => [current, goal]]
const DEFS = [
  // getting started
  ['insert-coin', '🪙', 'Insert Coin', 'Play your first game', 10, (c) => [c.plays, 1]],
  ['name-in-lights', '🏷️', 'Name in Lights', 'Post a score to any leaderboard', 10, (c) => [c.entries.length, 1]],
  ['new-look', '🎨', 'New Look', 'Pick an avatar on your profile', 10, (c) => [c.player.avatar ? 1 : 0, 1]],
  ['everywhere', '☁️', 'Everywhere', 'Sign in with Google to sync your devices', 10, (c) => [c.signedIn ? 1 : 0, 1]],
  // playing
  ['regular', '🎮', 'Regular', 'Play 25 games', 20, (c) => [c.plays, 25]],
  ['arcade-rat', '🕹️', 'Arcade Rat', 'Play 100 games', 40, (c) => [c.plays, 100]],
  ['legend', '🌟', 'Living Legend', 'Play 500 games', 100, (c) => [c.plays, 500]],
  ['sampler', '🌈', 'Sampler Platter', 'Play all 11 games', 30, (c) => [GAMES.filter((g) => c.player.plays && c.player.plays[g]).length, 11]],
  ['specialist', '🎯', 'Specialist', 'Play one game 50 times', 30, (c) => [Math.max(0, ...Object.values(c.player.plays || {})), 50]],
  // daily challenges
  ['daily-driver', '📅', 'Daily Driver', 'Finish a daily challenge', 10, (c) => [c.player.dailyFinishes || 0, 1]],
  ['on-fire', '🔥', 'On Fire', 'Reach a 3-day daily streak', 20, (c) => [c.player.bestStreak || 0, 3]],
  ['week-warrior', '🐉', 'Week Warrior', 'Reach a 7-day daily streak', 40, (c) => [c.player.bestStreak || 0, 7]],
  ['unstoppable', '🌋', 'Unstoppable', 'Reach a 30-day daily streak', 100, (c) => [c.player.bestStreak || 0, 30]],
  ['clockwork', '⏰', 'Clockwork', 'Finish 50 daily challenges', 60, (c) => [c.player.dailyFinishes || 0, 50]],
  ['clean-sweep', '🧹', 'Clean Sweep', 'Post a result in all 11 daily challenges on one day', 60, (c) => [c.bestDailyDay, 11]],
  // competition
  ['collector', '📋', 'Board Collector', 'Get on 10 different leaderboards', 30, (c) => [c.entries.filter((e) => !isDaily(e.board)).length, 10]],
  ['podium', '🥉', 'Podium', 'Hold a top-3 spot on any leaderboard', 30, (c) => [c.ranked.some((e) => e.rank <= 3) ? 1 : 0, 1]],
  ['champion', '👑', 'Champion', 'Hold #1 on any leaderboard', 50, (c) => [c.ranked.some((e) => e.rank === 1) ? 1 : 0, 1]],
  ['daily-champ', '🏅', 'Daily Champ', 'Hold #1 on a daily challenge', 50, (c) => [c.ranked.some((e) => e.rank === 1 && isDaily(e.board)) ? 1 : 0, 1]],
  // skill
  ['game-beaten', '🏁', 'Game Beaten', 'Beat any Classic game', 30, (c) => [c.classicWins, 1]],
  ['completionist', '💯', 'Completionist', 'Beat all 8 Classic games', 100, (c) => [c.classicWins, 8]],
  ['bomb-squad', '💣', 'Bomb Squad', 'Clear Minesweeper on Expert', 40, (c) => [c.has('mines-expert') ? 1 : 0, 1]],
  ['sprinter', '⚡', 'Sprinter', 'Clear Tetris Sprint 40 in under 2 minutes', 40, (c) => [c.entries.some((e) => e.board === 'tetris-sprint' && e.time > 0 && e.time < 120) ? 1 : 0, 1]],
  ['card-shark', '🃏', 'Card Shark', 'Win Klondike, Spider and FreeCell', 40, (c) => [['klondike', 'spider', 'freecell'].filter((g) => c.entries.some((e) => !isDaily(e.board) && e.board.startsWith(g) && e.time > 0)).length, 3]],
  ['four-suits', '🕷️', 'Four-Suit Spider', 'Win Spider with 4 suits', 60, (c) => [c.has('spider-4') ? 1 : 0, 1]],
  ['diamond', '💎', 'Diamond Player', 'Unlock 15 other achievements', 100, (c) => [c.unlockedSoFar, 15]],
];

export const ACHIEVEMENTS = DEFS.map(([id, icon, name, desc, points]) => ({ id, icon, name, desc, points }));

export function evaluate({ player = {}, entries = [], signedIn = false } = {}) {
  const byDay = {};
  entries.filter((e) => isDaily(e.board)).forEach((e) => { const day = e.board.slice(-8); byDay[day] = (byDay[day] || 0) + 1; });
  const ctx = {
    player,
    entries,
    signedIn,
    plays: player.totalPlays || 0,
    ranked: entries.filter((e) => typeof e.rank === 'number'),
    bestDailyDay: Math.max(0, ...Object.values(byDay)),
    classicWins: CLASSIC_WINS.filter((boards) => entries.some((e) => boards.includes(e.board) && won(e))).length,
    has: (board) => entries.some((e) => e.board === board && won(e)),
    unlockedSoFar: 0,
  };
  const out = DEFS.map(([id, icon, name, desc, points, check]) => {
    if (id === 'diamond') return { id, icon, name, desc, points, check };
    const [cur, max] = check(ctx);
    const done = cur >= max;
    if (done) ctx.unlockedSoFar++;
    return { id, icon, name, desc, points, done, cur: Math.min(cur, max), max };
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

const TITLES = [[25, 'Legend'], [17, 'Champion'], [12, 'Ace'], [8, 'Pro'], [5, 'Challenger'], [3, 'Player'], [1, 'Rookie']];
export function levelOf(xp) {
  const level = Math.floor(Math.sqrt(xp / 40)) + 1;
  return { level, title: TITLES.find(([n]) => level >= n)[1], xp, floor: 40 * (level - 1) ** 2, next: 40 * level ** 2 };
}

// Avatars: the first twelve are free, the rest unlock with an achievement
export const AVATARS = [
  ['👾'], ['🕹️'], ['👻'], ['🤖'], ['👽'], ['🐱'], ['🦊'], ['🐸'], ['🐍'], ['🚀'], ['🍒'], ['⭐'],
  ['🪙', 'insert-coin'], ['🔥', 'on-fire'], ['🐉', 'week-warrior'], ['🌋', 'unstoppable'], ['🥉', 'podium'], ['👑', 'champion'],
  ['🏁', 'game-beaten'], ['💣', 'bomb-squad'], ['⚡', 'sprinter'], ['🃏', 'card-shark'], ['🕷️', 'four-suits'], ['🌈', 'sampler'],
  ['🦄', 'completionist'], ['💎', 'diamond'],
].map(([icon, unlock]) => ({ icon, unlock: unlock || null }));
export const COLORS = ['#ff3b5c', '#ffe600', '#3cff8a', '#3fd8ff', '#c77dff', '#ff9f1c', '#ff6bd6', '#7ee2a8'];
