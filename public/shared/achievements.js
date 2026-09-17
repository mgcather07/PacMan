/*
 * Achievements, levels and avatars. Pure functions over a player's data, so the profile page, the top bar
 * and the game-over screen all agree:
 *
 *   evaluate({ player, entries, signedIn })  → [{ ...achievement, done, cur, max }]
 *   levelOf(xp) → { level, title, xp, floor, next }
 *   CATEGORIES  → display order and labels for grouping achievements
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
// which game a board belongs to (mirrors Leaderboard.gameOf)
const gameOf = (board) => {
  const m = /^daily-([a-z]+)-\d{8}$/.exec(board);
  if (m) return m[1];
  const id = board.replace(/-(classic|tower|marathon|marathon150|sprint|beginner|intermediate|expert|1|2|3|4)$/, '');
  return id === 'mines' ? 'minesweeper' : id;
};
const yes = (ok) => [ok ? 1 : 0, 1];

// [id, category, icon, name, description, points, (ctx) => [current, goal]]
// category is 'general' | 'daily' | 'competition' | a game id
const DEFS = [
  // getting started
  ['insert-coin', 'general', '🪙', 'Insert Coin', 'Play your first game', 10, (c) => [c.plays, 1]],
  ['name-in-lights', 'general', '🏷️', 'Name in Lights', 'Post a score to any leaderboard', 10, (c) => [c.entries.length, 1]],
  ['new-look', 'general', '🎨', 'New Look', 'Pick an avatar on your profile', 10, (c) => yes(c.player.avatar)],
  ['everywhere', 'general', '☁️', 'Everywhere', 'Sign in with Google to sync your devices', 10, (c) => yes(c.signedIn)],
  ['regular', 'general', '🎮', 'Regular', 'Play 25 games', 20, (c) => [c.plays, 25]],
  ['arcade-rat', 'general', '🕹️', 'Arcade Rat', 'Play 100 games', 40, (c) => [c.plays, 100]],
  ['legend', 'general', '🌟', 'Living Legend', 'Play 500 games', 100, (c) => [c.plays, 500]],
  ['sampler', 'general', '🌈', 'Sampler Platter', 'Play all 11 games', 30, (c) => [GAMES.filter((g) => c.player.plays && c.player.plays[g]).length, 11]],
  ['specialist', 'general', '🎯', 'Specialist', 'Play one game 50 times', 30, (c) => [Math.max(0, ...Object.values(c.player.plays || {})), 50]],
  ['game-beaten', 'general', '🏁', 'Game Beaten', 'Beat any Classic game', 30, (c) => [c.classicWins, 1]],
  ['completionist', 'general', '💯', 'Completionist', 'Beat all 8 Classic games', 100, (c) => [c.classicWins, 8]],
  ['card-shark', 'general', '🎲', 'Card Shark', 'Win Klondike, Spider and FreeCell', 40, (c) => [['klondike', 'spider', 'freecell'].filter((g) => c.wins(g)).length, 3]],
  ['diamond', 'general', '💎', 'Diamond Player', 'Unlock 30 other achievements', 150, (c) => [c.unlockedSoFar, 30]],
  // daily challenges
  ['daily-driver', 'daily', '📅', 'Daily Driver', 'Finish a daily challenge', 10, (c) => [c.player.dailyFinishes || 0, 1]],
  ['on-fire', 'daily', '🔥', 'On Fire', 'Reach a 3-day daily streak', 20, (c) => [c.player.bestStreak || 0, 3]],
  ['week-warrior', 'daily', '🐉', 'Week Warrior', 'Reach a 7-day daily streak', 40, (c) => [c.player.bestStreak || 0, 7]],
  ['unstoppable', 'daily', '🌋', 'Unstoppable', 'Reach a 30-day daily streak', 100, (c) => [c.player.bestStreak || 0, 30]],
  ['clockwork', 'daily', '⏰', 'Clockwork', 'Finish 50 daily challenges', 60, (c) => [c.player.dailyFinishes || 0, 50]],
  ['clean-sweep', 'daily', '🧹', 'Clean Sweep', 'Post a result in all 11 daily challenges on one day', 60, (c) => [c.bestDailyDay, 11]],
  // competition
  ['collector', 'competition', '📋', 'Board Collector', 'Get on 10 different leaderboards', 30, (c) => [c.entries.filter((e) => !isDaily(e.board)).length, 10]],
  ['podium', 'competition', '🥉', 'Podium', 'Hold a top-3 spot on any leaderboard', 30, (c) => yes(c.ranked.some((e) => e.rank <= 3))],
  ['champion', 'competition', '👑', 'Champion', 'Hold #1 on any leaderboard', 50, (c) => yes(c.ranked.some((e) => e.rank === 1))],
  ['daily-champ', 'competition', '🏅', 'Daily Champ', 'Hold #1 on a daily challenge', 50, (c) => yes(c.ranked.some((e) => e.rank === 1 && isDaily(e.board)))],

  // Pac-Man
  ['pac-10k', 'pacman', '🟡', 'Waka Waka', 'Score 10,000 in Pac-Man', 20, (c) => [c.best('pacman'), 10000]],
  ['pac-50k', 'pacman', '👻', 'Ghost Buster', 'Score 50,000 in Pac-Man', 50, (c) => [c.best('pacman'), 50000]],
  ['pac-classic', 'pacman', '🍒', 'Maze Master', 'Beat Classic Pac-Man', 40, (c) => yes(c.has('pacman-classic'))],
  // Snake
  ['snake-5k', 'snake', '🐍', 'Long Boi', 'Score 5,000 in Snake', 20, (c) => [c.best('snake'), 5000]],
  ['snake-25k', 'snake', '🐲', 'Apex Serpent', 'Score 25,000 in Snake', 50, (c) => [c.best('snake'), 25000]],
  ['snake-classic', 'snake', '🪈', 'Snake Charmer', 'Beat Classic Snake', 40, (c) => yes(c.has('snake-classic'))],
  // Minesweeper
  ['mines-1k', 'minesweeper', '🚩', 'Mine Sniffer', 'Uncover 1,000 tiles in Infinite Minesweeper', 20, (c) => [c.best('minesweeper'), 1000]],
  ['mines-5k', 'minesweeper', '🗺️', 'Deep Explorer', 'Uncover 5,000 tiles in Infinite Minesweeper', 50, (c) => [c.best('minesweeper'), 5000]],
  ['mines-intermediate', 'minesweeper', '⛳', 'Field Cleared', 'Clear Minesweeper on Intermediate', 30, (c) => yes(c.has('mines-intermediate'))],
  ['bomb-squad', 'minesweeper', '💣', 'Bomb Squad', 'Clear Minesweeper on Expert', 50, (c) => yes(c.has('mines-expert'))],
  // Frogger
  ['frog-2500', 'frogger', '🐸', 'Road Hopper', 'Score 2,500 in Frogger', 20, (c) => [c.best('frogger'), 2500]],
  ['frog-10k', 'frogger', '🪷', 'Frog Marathon', 'Score 10,000 in Frogger', 50, (c) => [c.best('frogger'), 10000]],
  ['frog-classic', 'frogger', '🏠', 'Home Free', 'Beat Classic Frogger', 40, (c) => yes(c.has('frogger-classic'))],
  // Breakout
  ['brick-10k', 'breakout', '🧱', 'Wall Crusher', 'Score 10,000 in Breakout', 20, (c) => [c.best('breakout'), 10000]],
  ['brick-50k', 'breakout', '🏗️', 'Demolition Crew', 'Score 50,000 in Breakout', 50, (c) => [c.best('breakout'), 50000]],
  ['brick-classic', 'breakout', '🔮', 'Ball Wizard', 'Beat Classic Breakout', 40, (c) => yes(c.has('breakout-classic'))],
  // Asteroids
  ['rock-10k', 'asteroids', '☄️', 'Rock Breaker', 'Score 10,000 in Asteroids', 20, (c) => [c.best('asteroids'), 10000]],
  ['rock-50k', 'asteroids', '🌌', 'Deep Space', 'Score 50,000 in Asteroids', 50, (c) => [c.best('asteroids'), 50000]],
  ['rock-classic', 'asteroids', '🛸', 'Saucer Slayer', 'Beat Classic Asteroids', 40, (c) => yes(c.has('asteroids-classic'))],
  // Tetris
  ['tetris-10k', 'tetris', '🟪', 'Line Clearer', 'Score 10,000 in Tetris', 20, (c) => [c.best('tetris'), 10000]],
  ['tetris-50k', 'tetris', '🗼', 'Stack Master', 'Score 50,000 in Tetris', 50, (c) => [c.best('tetris'), 50000]],
  ['sprinter', 'tetris', '⚡', 'Sprinter', 'Clear Tetris Sprint 40 in under 2 minutes', 50, (c) => yes(c.entries.some((e) => e.board === 'tetris-sprint' && e.time > 0 && e.time < 120))],
  ['tetris-marathon', 'tetris', '🏃', 'Marathoner', 'Finish Tetris Marathon 150', 40, (c) => yes(c.has('tetris-marathon150'))],
  // Space Shooter
  ['ship-20k', 'shooter', '🚀', 'Ace Pilot', 'Score 20,000 in Space Shooter', 20, (c) => [c.best('shooter'), 20000]],
  ['ship-100k', 'shooter', '💥', 'Boss Rush', 'Score 100,000 in Space Shooter', 50, (c) => [c.best('shooter'), 100000]],
  ['ship-classic', 'shooter', '🌠', 'Galaxy Saved', 'Beat Classic Space Shooter', 40, (c) => yes(c.has('shooter-classic'))],
  // Klondike
  ['klondike-win', 'klondike', '🂡', 'Patience', 'Win a game of Klondike', 20, (c) => yes(c.wins('klondike'))],
  ['klondike-3', 'klondike', '🎴', 'Draw Three', 'Win Klondike with Draw 3', 40, (c) => yes(c.has('klondike-3'))],
  ['klondike-fast', 'klondike', '⏱️', 'Speed Dealer', 'Win Klondike in under 3 minutes', 40, (c) => yes(c.fastest('klondike') < 180)],
  // Spider
  ['spider-win', 'spider', '🕸️', 'Web Spinner', 'Win a game of Spider', 20, (c) => yes(c.wins('spider'))],
  ['spider-2', 'spider', '🎭', 'Two Suits', 'Win Spider with 2 suits', 40, (c) => yes(c.has('spider-2'))],
  ['four-suits', 'spider', '🕷️', 'Four-Suit Spider', 'Win Spider with 4 suits', 60, (c) => yes(c.has('spider-4'))],
  // FreeCell
  ['freecell-win', 'freecell', '🕊️', 'Free Bird', 'Win a game of FreeCell', 20, (c) => yes(c.wins('freecell'))],
  ['freecell-fast', 'freecell', '⏲️', 'Quick Cells', 'Win FreeCell in under 2 minutes', 40, (c) => yes(c.fastest('freecell') < 120)],
];

export const CATEGORIES = [
  ['general', '🕹️', 'Arcade'], ['daily', '📅', 'Daily challenges'], ['competition', '🏆', 'Competition'],
  ['pacman', '🟡', 'Pac-Man'], ['snake', '🐍', 'Snake'], ['minesweeper', '💣', 'Minesweeper'], ['frogger', '🐸', 'Frogger'],
  ['breakout', '🧱', 'Breakout'], ['asteroids', '☄️', 'Asteroids'], ['tetris', '🟪', 'Tetris'], ['shooter', '🚀', 'Space Shooter'],
  ['klondike', '🂡', 'Klondike'], ['spider', '🕷️', 'Spider'], ['freecell', '🃏', 'FreeCell'],
].map(([id, icon, name]) => ({ id, icon, name }));

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
    ranked: entries.filter((e) => typeof e.rank === 'number'),
    bestDailyDay: Math.max(0, ...Object.values(byDay)),
    classicWins: CLASSIC_WINS.filter((boards) => entries.some((e) => boards.includes(e.board) && won(e))).length,
    has: (board) => entries.some((e) => e.board === board && won(e)),
    // best score on any of the game's score boards (Infinite, Classic or Daily)
    best: (game) => Math.max(0, ...ofGame(game).filter((e) => !TIME_BOARD.test(e.board)).map((e) => e.score || 0)),
    // any posted solitaire result is a win (including daily deals)
    wins: (game) => ofGame(game).some((e) => e.time > 0),
    fastest: (game) => Math.min(Infinity, ...ofGame(game).filter((e) => e.time > 0).map((e) => e.time)),
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
