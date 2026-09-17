/*
 * The game registry: the single list of every game in the arcade. Everything else reads from it:
 * leaderboards (boards, titles, colors, icons), daily challenges, the Daily page, achievements, the admin
 * dashboard, the service worker and, via `node scripts/sync-games.mjs` (run automatically before a
 * functions deploy), the server's board list and score limits in functions/games.json.
 *
 * Adding a game = its own folder under public/ + one entry here. See docs/ADDING_A_GAME.md.
 *
 * Entry fields
 *   id           short lowercase id, used in board ids and daily boards (daily-<id>-YYYYMMDD)
 *   name, icon, color   display name, emoji icon and accent color
 *   path         the game's page
 *   category     'arcade' | 'puzzle' | 'cards'
 *   added        ISO date the game shipped; the home page flashes NEW for three weeks
 *   type         'score' (higher wins) or 'time' (fastest win) for the daily board
 *   daily        short description of what's shared in the daily challenge ("Same maze")
 *   scoreCap     [base, perSecond, perSecond²]: the most points a run may have after t seconds (server check)
 *   dailyMinTime fastest humanly possible daily win in seconds (time games only)
 *   blurb, blurbClassic, tags, tagsClassic, cta   home-page card copy (Classic versions optional)
 *   assets       extra files the service worker caches for offline play
 *   preview      scripts that draw the home-page card preview, loaded in order; the last one registers
 *                window.ArcadePreviews[id] = (canvas) => stopFn (see docs/ADDING_A_GAME.md)
 *   boards       leaderboards: { id, title, group: 'Infinite' | 'Classic' | 'Solitaire', type, href,
 *                  minTime? (time boards), unit?, resumable? (runs never expire) }
 *   classicWin   boards where posting a win means you beat the game's Classic mode (Completionist)
 *   achievements { id, icon, name, desc, points, kind, ... }
 *                  kind 'score':   goal, boards? (default: all of the game's score boards incl. daily)
 *                  kind 'win':     boards ('*' = any board of the game incl. daily)
 *                  kind 'fastest': boards ('*' allowed), under (seconds)
 */
(function (root) {
  'use strict';

  const GAMES = [
    {
      id: 'pacman', name: 'Pac-Man', icon: '🟡', color: '#ffe600', path: '/pacman/', category: 'arcade', type: 'score', daily: 'Same maze',
      scoreCap: [5000, 800, 0.5], assets: ['/pacman/game.js'], preview: ['/pacman/preview.js'],
      blurb: 'A maze that generates forever in every direction. No walls at the edge of the world — just more dots, more ghosts, and more speed the farther you go.',
      blurbClassic: 'Four randomly built mazes with walls all around. Clear every dot to advance, and beat level four to win.',
      tags: ['Endless', 'Procedural', 'Keyboard + swipe'],
      tagsClassic: ['4 levels', 'Clear the maze', 'Card suits'],
      cta: 'PLAY ▶',
      boards: [
        { id: 'pacman', title: 'Infinite Pac-Man', group: 'Infinite', type: 'score', href: '/pacman/' },
        { id: 'pacman-classic', title: 'Classic Pac-Man', group: 'Classic', type: 'score', href: '/pacman/?mode=classic' },
      ],
      classicWin: ['pacman-classic'],
      achievements: [
        { id: 'pac-10k', icon: '🟡', name: 'Waka Waka', desc: 'Score 10,000 in Pac-Man', points: 20, kind: 'score', goal: 10000 },
        { id: 'pac-50k', icon: '👻', name: 'Ghost Buster', desc: 'Score 50,000 in Pac-Man', points: 50, kind: 'score', goal: 50000 },
        { id: 'pac-classic', icon: '🍒', name: 'Maze Master', desc: 'Beat Classic Pac-Man', points: 40, kind: 'win', boards: ['pacman-classic'] },
      ],
    },
    {
      id: 'snake', name: 'Snake', icon: '🐍', color: '#3cff8a', path: '/snake/', category: 'arcade', type: 'score', daily: 'Same world',
      scoreCap: [5000, 600, 0.5], assets: ['/snake/snake.js'], preview: ['/snake/preview.js'],
      blurb: 'Slither through a world with no edges. Eat, grow, dodge rocks, and trick rival snakes into crashing into you so they burst into food.',
      blurbClassic: 'Three walled arenas with rival snakes. Eat enough food to clear each stage, then conquer the final arena to win.',
      tags: ['Endless', 'Rival snakes', 'Shields'],
      tagsClassic: ['3 stages', 'Rival snakes', 'Shields'],
      cta: 'SLITHER ▶',
      boards: [
        { id: 'snake', title: 'Infinite Snake', group: 'Infinite', type: 'score', href: '/snake/' },
        { id: 'snake-classic', title: 'Classic Snake', group: 'Classic', type: 'score', href: '/snake/?mode=classic' },
      ],
      classicWin: ['snake-classic'],
      achievements: [
        { id: 'snake-5k', icon: '🐍', name: 'Long Boi', desc: 'Score 5,000 in Snake', points: 20, kind: 'score', goal: 5000 },
        { id: 'snake-25k', icon: '🐲', name: 'Apex Serpent', desc: 'Score 25,000 in Snake', points: 50, kind: 'score', goal: 25000 },
        { id: 'snake-classic', icon: '🪈', name: 'Snake Charmer', desc: 'Beat Classic Snake', points: 40, kind: 'win', boards: ['snake-classic'] },
      ],
    },
    {
      id: 'minesweeper', name: 'Minesweeper', icon: '💣', color: '#c5ec7a', path: '/minesweeper/', category: 'puzzle', type: 'score', daily: 'Same minefield',
      scoreCap: [5000, 500, 0], assets: ['/minesweeper/mines.js'], preview: ['/minesweeper/preview.js'],
      blurb: 'A minefield that never ends. Three lives, mines that get denser the farther you roam, and your field is saved so you can keep exploring later.',
      blurbClassic: 'The classic boards: Beginner, Intermediate and Expert. One life, a timer, and your best times are saved.',
      tags: ['Endless', 'Saves progress', 'Touch friendly'],
      tagsClassic: ['3 difficulties', 'Best times', 'Touch friendly'],
      cta: 'DIG ▶',
      boards: [
        { id: 'minesweeper', title: 'Infinite Minesweeper', group: 'Infinite', type: 'score', href: '/minesweeper/', unit: 'tiles', resumable: true },
        { id: 'mines-beginner', title: 'Minesweeper · Beginner', group: 'Classic', type: 'time', href: '/minesweeper/?mode=classic', minTime: 1 },
        { id: 'mines-intermediate', title: 'Minesweeper · Intermediate', group: 'Classic', type: 'time', href: '/minesweeper/?mode=classic', minTime: 5 },
        { id: 'mines-expert', title: 'Minesweeper · Expert', group: 'Classic', type: 'time', href: '/minesweeper/?mode=classic', minTime: 20 },
      ],
      classicWin: ['mines-beginner', 'mines-intermediate', 'mines-expert'],
      achievements: [
        { id: 'mines-1k', icon: '🚩', name: 'Mine Sniffer', desc: 'Uncover 1,000 tiles in Infinite Minesweeper', points: 20, kind: 'score', goal: 1000 },
        { id: 'mines-5k', icon: '🗺️', name: 'Deep Explorer', desc: 'Uncover 5,000 tiles in Infinite Minesweeper', points: 50, kind: 'score', goal: 5000 },
        { id: 'mines-intermediate', icon: '⛳', name: 'Field Cleared', desc: 'Clear Minesweeper on Intermediate', points: 30, kind: 'win', boards: ['mines-intermediate'] },
        { id: 'bomb-squad', icon: '💣', name: 'Bomb Squad', desc: 'Clear Minesweeper on Expert', points: 50, kind: 'win', boards: ['mines-expert'] },
      ],
    },
    {
      id: 'frogger', name: 'Frogger', icon: '🐸', color: '#7dff6a', path: '/frogger/', category: 'arcade', type: 'score', daily: 'Same roads',
      scoreCap: [5000, 500, 0.2], assets: ['/frogger/frogger.js'], preview: ['/frogger/preview.js'],
      blurb: 'Hop forever across endless roads, rivers and railways. Ride logs and diving turtles, dodge trains, and keep ahead of the eagle.',
      blurbClassic: 'Three courses with a finish line at the end of each. Cross roads, rivers and railways and reach the final finish to win.',
      tags: ['Endless', 'Tap + swipe', 'Card suits'],
      tagsClassic: ['3 courses', 'Finish lines', 'Card suits'],
      cta: 'HOP ▶',
      boards: [
        { id: 'frogger', title: 'Infinite Frogger', group: 'Infinite', type: 'score', href: '/frogger/' },
        { id: 'frogger-classic', title: 'Classic Frogger', group: 'Classic', type: 'score', href: '/frogger/?mode=classic' },
      ],
      classicWin: ['frogger-classic'],
      achievements: [
        { id: 'frog-2500', icon: '🐸', name: 'Road Hopper', desc: 'Score 2,500 in Frogger', points: 20, kind: 'score', goal: 2500 },
        { id: 'frog-10k', icon: '🪷', name: 'Frog Marathon', desc: 'Score 10,000 in Frogger', points: 50, kind: 'score', goal: 10000 },
        { id: 'frog-classic', icon: '🏠', name: 'Home Free', desc: 'Beat Classic Frogger', points: 40, kind: 'win', boards: ['frogger-classic'] },
      ],
    },
    {
      id: 'breakout', name: 'Breakout', icon: '🧱', color: '#3fd8ff', path: '/breakout/', category: 'arcade', type: 'score', daily: 'Same bricks',
      scoreCap: [10000, 1500, 2], assets: ['/breakout/breakout.js'], preview: ['/breakout/preview.js'],
      blurb: 'The wall never ends: it keeps sliding down, tougher and faster. Grab multiball, lasers and fireballs and smash it before it reaches your paddle.',
      blurbClassic: 'Five hand-built levels that stay put. Clear every breakable brick to advance, and finish level five to win.',
      tags: ['Endless', 'Power-ups', 'Mouse + touch'],
      tagsClassic: ['5 levels', 'Power-ups', 'Mouse + touch'],
      cta: 'SMASH ▶',
      boards: [
        { id: 'breakout', title: 'Infinite Breakout', group: 'Infinite', type: 'score', href: '/breakout/' },
        { id: 'breakout-classic', title: 'Classic Breakout', group: 'Classic', type: 'score', href: '/breakout/?mode=classic' },
      ],
      classicWin: ['breakout-classic'],
      achievements: [
        { id: 'brick-10k', icon: '🧱', name: 'Wall Crusher', desc: 'Score 10,000 in Breakout', points: 20, kind: 'score', goal: 10000 },
        { id: 'brick-50k', icon: '🏗️', name: 'Demolition Crew', desc: 'Score 50,000 in Breakout', points: 50, kind: 'score', goal: 50000 },
        { id: 'brick-classic', icon: '🔮', name: 'Ball Wizard', desc: 'Beat Classic Breakout', points: 40, kind: 'win', boards: ['breakout-classic'] },
      ],
    },
    {
      id: 'asteroids', name: 'Asteroids', icon: '☄️', color: '#ffb347', path: '/asteroids/', category: 'arcade', type: 'score', daily: 'Same rocks',
      scoreCap: [10000, 1000, 2], assets: ['/asteroids/asteroids.js'], preview: ['/asteroids/preview.js'],
      blurb: 'Fly forever through an endless asteroid field. Blast rocks apart, outgun flying saucers, grab shields and triple shot, and see how far from home you get.',
      blurbClassic: 'The classic wrap-around screen. Clear eight waves of rocks and saucers to win.',
      tags: ['Endless space', 'Saucers', 'Radar'],
      tagsClassic: ['8 waves', 'Wrap-around', 'Saucers'],
      cta: 'LAUNCH ▶',
      boards: [
        { id: 'asteroids', title: 'Infinite Asteroids', group: 'Infinite', type: 'score', href: '/asteroids/' },
        { id: 'asteroids-classic', title: 'Classic Asteroids', group: 'Classic', type: 'score', href: '/asteroids/?mode=classic' },
      ],
      classicWin: ['asteroids-classic'],
      achievements: [
        { id: 'rock-10k', icon: '☄️', name: 'Rock Breaker', desc: 'Score 10,000 in Asteroids', points: 20, kind: 'score', goal: 10000 },
        { id: 'rock-50k', icon: '🌌', name: 'Deep Space', desc: 'Score 50,000 in Asteroids', points: 50, kind: 'score', goal: 50000 },
        { id: 'rock-classic', icon: '🛸', name: 'Saucer Slayer', desc: 'Beat Classic Asteroids', points: 40, kind: 'win', boards: ['asteroids-classic'] },
      ],
    },
    {
      id: 'tetris', name: 'Tetris', icon: '🟪', color: '#c77dff', path: '/tetris/', category: 'puzzle', type: 'score', daily: 'Same pieces',
      scoreCap: [10000, 2000, 5], assets: ['/tetris/tetris.js'], preview: ['/tetris/preview.js'],
      blurb: 'Tower mode has no ceiling: climb forever while a tide rises beneath you, sealing rows before they leak. Or play Marathon, the classic that never ends.',
      blurbClassic: 'Sprint: clear 40 lines as fast as you can. Marathon: survive to 150 lines. Hit the goal and you win.',
      tags: ['Tower + Marathon', 'Hold & ghost', 'SRS rotation'],
      tagsClassic: ['Sprint 40', 'Marathon 150', 'Best times'],
      cta: 'STACK ▶',
      boards: [
        { id: 'tetris-tower', title: 'Infinite Tetris · Tower', group: 'Infinite', type: 'score', href: '/tetris/' },
        { id: 'tetris-marathon', title: 'Infinite Tetris · Marathon', group: 'Infinite', type: 'score', href: '/tetris/' },
        { id: 'tetris-sprint', title: 'Tetris · Sprint 40', group: 'Classic', type: 'time', href: '/tetris/?mode=classic', minTime: 12 },
        { id: 'tetris-marathon150', title: 'Tetris · Marathon 150', group: 'Classic', type: 'score', href: '/tetris/?mode=classic' },
      ],
      classicWin: ['tetris-sprint', 'tetris-marathon150'],
      achievements: [
        { id: 'tetris-10k', icon: '🟪', name: 'Line Clearer', desc: 'Score 10,000 in Tetris', points: 20, kind: 'score', goal: 10000 },
        { id: 'tetris-50k', icon: '🗼', name: 'Stack Master', desc: 'Score 50,000 in Tetris', points: 50, kind: 'score', goal: 50000 },
        { id: 'sprinter', icon: '⚡', name: 'Sprinter', desc: 'Clear Tetris Sprint 40 in under 2 minutes', points: 50, kind: 'fastest', boards: ['tetris-sprint'], under: 120 },
        { id: 'tetris-marathon', icon: '🏃', name: 'Marathoner', desc: 'Finish Tetris Marathon 150', points: 40, kind: 'win', boards: ['tetris-marathon150'] },
      ],
    },
    {
      id: 'shooter', name: 'Space Shooter', icon: '🚀', color: '#ff6b8a', path: '/shooter/', category: 'arcade', type: 'score', daily: 'Same waves',
      scoreCap: [50000, 5000, 10], assets: ['/shooter/shooter.js'], preview: ['/shooter/preview.js'],
      blurb: 'Wave after wave forever, with a boss every fifth wave. Power your guns up to a five-way spread with homing missiles, and save bombs for the bullet storms.',
      blurbClassic: 'Fifteen waves and three bosses. Destroy the final boss on wave fifteen to win.',
      tags: ['Endless waves', 'Bosses', 'Auto-fire'],
      tagsClassic: ['15 waves', '3 bosses', 'Auto-fire'],
      cta: 'LAUNCH ▶',
      boards: [
        { id: 'shooter', title: 'Infinite Space Shooter', group: 'Infinite', type: 'score', href: '/shooter/' },
        { id: 'shooter-classic', title: 'Classic Space Shooter', group: 'Classic', type: 'score', href: '/shooter/?mode=classic' },
      ],
      classicWin: ['shooter-classic'],
      achievements: [
        { id: 'ship-20k', icon: '🚀', name: 'Ace Pilot', desc: 'Score 20,000 in Space Shooter', points: 20, kind: 'score', goal: 20000 },
        { id: 'ship-100k', icon: '💥', name: 'Boss Rush', desc: 'Score 100,000 in Space Shooter', points: 50, kind: 'score', goal: 100000 },
        { id: 'ship-classic', icon: '🌠', name: 'Galaxy Saved', desc: 'Beat Classic Space Shooter', points: 40, kind: 'win', boards: ['shooter-classic'] },
      ],
    },
    {
      id: 'invaders', name: 'Space Invaders', icon: '👾', color: '#39ff14', path: '/invaders/', category: 'arcade', type: 'score', daily: 'Same formations', added: '2026-09-17',
      scoreCap: [10000, 600, 1], assets: ['/invaders/sprites.js', '/invaders/invaders.js', '/invaders/preview.js'], preview: ['/invaders/sprites.js', '/invaders/preview.js'],
      blurb: 'They never stop coming. Every wave brings a new formation, armored and diving invaders join the fight, and a mothership guards every fifth wave.',
      blurbClassic: 'Ten waves, each starting a little lower. Stop every invader before they land to save the Earth.',
      tags: ['Endless waves', 'Bunkers', 'Power-ups'],
      tagsClassic: ['10 waves', 'Bunkers', 'Mystery UFO'],
      cta: 'DEFEND ▶',
      boards: [
        { id: 'invaders', title: 'Infinite Space Invaders', group: 'Infinite', type: 'score', href: '/invaders/' },
        { id: 'invaders-classic', title: 'Classic Space Invaders', group: 'Classic', type: 'score', href: '/invaders/?mode=classic' },
      ],
      classicWin: ['invaders-classic'],
      achievements: [
        { id: 'inv-10k', icon: '👾', name: 'Earth Defender', desc: 'Score 10,000 in Space Invaders', points: 20, kind: 'score', goal: 10000 },
        { id: 'inv-50k', icon: '🛡️', name: 'Invasion Repelled', desc: 'Score 50,000 in Space Invaders', points: 50, kind: 'score', goal: 50000 },
        { id: 'inv-classic', icon: '🌍', name: 'Planet Saver', desc: 'Beat Classic Space Invaders', points: 40, kind: 'win', boards: ['invaders-classic'] },
      ],
    },
    {
      id: 'pong', name: 'Pong', icon: '🏓', color: '#e6eeff', path: '/pong/', category: 'arcade', type: 'score', daily: 'Same rally', added: '2026-09-17',
      scoreCap: [3000, 500, 0.5], assets: ['/pong/pong.js', '/pong/preview.js'], preview: ['/pong/preview.js'],
      blurb: 'One rally that never ends. The ball speeds up with every hit and takes spin off your paddle, while the AI gets faster, sharper and better at reading you.',
      blurbClassic: 'First to eleven. No power-ups, no lives, no tricks — just you, the AI and the ball.',
      tags: ['Endless rally', 'Spin & angles', 'Power-ups'],
      tagsClassic: ['First to 11', 'Pure Pong', 'Mouse + touch'],
      cta: 'RALLY ▶',
      boards: [
        { id: 'pong', title: 'Infinite Pong', group: 'Infinite', type: 'score', href: '/pong/' },
        { id: 'pong-classic', title: 'Classic Pong', group: 'Classic', type: 'score', href: '/pong/?mode=classic' },
      ],
      classicWin: ['pong-classic'],
      achievements: [
        { id: 'pong-2k', icon: '🏓', name: 'Rally Master', desc: 'Score 2,000 in Pong', points: 20, kind: 'score', goal: 2000 },
        { id: 'pong-10k', icon: '⚡', name: 'Untouchable', desc: 'Score 10,000 in Pong', points: 50, kind: 'score', goal: 10000 },
        { id: 'pong-classic', icon: '🏆', name: 'Match Point', desc: 'Beat Classic Pong 11–x', points: 40, kind: 'win', boards: ['pong-classic'] },
      ],
    },
    {
      id: 'missile', name: 'Missile Command', icon: '🎯', color: '#ff5c7a', path: '/missile/', category: 'arcade', type: 'score', daily: 'Same attack', added: '2026-09-17',
      scoreCap: [10000, 800, 1.5], assets: ['/missile/missile.js', '/missile/preview.js'], preview: ['/missile/preview.js'],
      blurb: 'Six cities, three batteries, and a sky that never stops falling. MIRVs split, bombers and satellites circle overhead, and smart bombs dodge your blasts — chain your explosions, because ammo runs out long before the missiles do.',
      blurbClassic: 'Twelve waves of attack, faster and thicker every time. Keep one city standing through wave twelve and you win.',
      tags: ['Endless waves', 'Chain blasts', 'Click or tap'],
      tagsClassic: ['12 waves', 'Six cities', 'Bonus rounds'],
      cta: 'DEFEND ▶',
      boards: [
        { id: 'missile', title: 'Infinite Missile Command', group: 'Infinite', type: 'score', href: '/missile/' },
        { id: 'missile-classic', title: 'Classic Missile Command', group: 'Classic', type: 'score', href: '/missile/?mode=classic' },
      ],
      classicWin: ['missile-classic'],
      achievements: [
        { id: 'missile-25k', icon: '🎯', name: 'City Defender', desc: 'Score 25,000 in Missile Command', points: 20, kind: 'score', goal: 25000 },
        { id: 'missile-100k', icon: '🛰️', name: 'Guardian', desc: 'Score 100,000 in Missile Command', points: 50, kind: 'score', goal: 100000 },
        { id: 'missile-classic', icon: '🌆', name: 'All Cities Standing', desc: 'Beat Classic Missile Command', points: 40, kind: 'win', boards: ['missile-classic'] },
      ],
    },
    {
      id: '2048', name: '2048', icon: '🔢', color: '#f2b179', path: '/2048/', category: 'puzzle', type: 'score', daily: 'Same tiles', added: '2026-09-17',
      scoreCap: [5000, 300, 0.3], assets: ['/2048/2048.js', '/2048/preview.js'], preview: ['/2048/preview.js'],
      blurb: 'Slide, merge, repeat — on a 5×5 board that refuses to end. Jam it solid and the four smallest tiles are vaporised, so a great run just keeps going.',
      blurbClassic: 'The 4×4 original. Build the 2048 tile to win, then keep going and see how far past it you can push.',
      tags: ['Endless 5×5', 'Meltdowns', 'Swipe or arrows'],
      tagsClassic: ['Classic 4×4', 'Make 2048', 'One undo'],
      cta: 'MERGE ▶',
      boards: [
        { id: '2048', title: 'Infinite 2048', group: 'Infinite', type: 'score', href: '/2048/' },
        { id: '2048-classic', title: 'Classic 2048', group: 'Classic', type: 'score', href: '/2048/?mode=classic' },
      ],
      classicWin: ['2048-classic'],
      achievements: [
        { id: '2048-10k', icon: '🔢', name: 'Tile Stacker', desc: 'Score 10,000 in 2048', points: 20, kind: 'score', goal: 10000 },
        { id: '2048-50k', icon: '💠', name: 'Grandmaster Merge', desc: 'Score 50,000 in 2048', points: 50, kind: 'score', goal: 50000 },
        { id: '2048-classic', icon: '🏅', name: '2048!', desc: 'Make the 2048 tile', points: 40, kind: 'win', boards: ['2048-classic'] },
      ],
    },
    {
      id: 'flyer', name: 'Sky Flyer', icon: '🐤', color: '#ffa62b', path: '/flyer/', category: 'arcade', type: 'score', daily: 'Same course', added: '2026-09-17',
      scoreCap: [3000, 400, 0.2], assets: ['/flyer/flyer.js', '/flyer/preview.js'], preview: ['/flyer/preview.js'],
      blurb: 'One button, one bird, no finish line. Flap through the gates and sweep up the coins as the sky turns from dawn to storm, night, caves and sunset — faster every time.',
      blurbClassic: 'A fifty-gate course through the dawn, a storm and the night. Fly clean, grab the coins and pass the fiftieth gate to beat it.',
      tags: ['Endless', 'One button', 'Five skies'],
      tagsClassic: ['50 gates', 'One button', 'Three skies'],
      cta: 'FLY ▶',
      boards: [
        { id: 'flyer', title: 'Infinite Sky Flyer', group: 'Infinite', type: 'score', href: '/flyer/' },
        { id: 'flyer-classic', title: 'Classic Sky Flyer', group: 'Classic', type: 'score', href: '/flyer/?mode=classic' },
      ],
      classicWin: ['flyer-classic'],
      achievements: [
        { id: 'flyer-1k', icon: '🐤', name: 'Featherweight', desc: 'Score 1,000 in Sky Flyer', points: 20, kind: 'score', goal: 1000 },
        { id: 'flyer-5k', icon: '🪶', name: 'Sky Master', desc: 'Score 5,000 in Sky Flyer', points: 50, kind: 'score', goal: 5000 },
        { id: 'flyer-classic', icon: '🌤️', name: 'Course Cleared', desc: 'Beat Classic Sky Flyer', points: 40, kind: 'win', boards: ['flyer-classic'] },
      ],
    },
    {
      id: 'bubble', name: 'Bubble Shooter', icon: '🫧', color: '#ff6bd6', path: '/bubble/', category: 'puzzle', type: 'score', daily: 'Same wall', added: '2026-09-17',
      scoreCap: [10000, 700, 1], assets: ['/bubble/bubble.js', '/bubble/preview.js'], preview: ['/bubble/preview.js'],
      blurb: 'The ceiling never stops. Match three of a colour to pop the wall, cut whole clusters loose so they rain down, and bank shots off the side walls before the wall reaches your launcher.',
      blurbClassic: 'Twenty hand-built walls, from simple shapes to seven-colour tangles. Clear every bubble on level twenty to win.',
      tags: ['Endless wall', 'Bank shots', 'Combos'],
      tagsClassic: ['20 levels', 'Hand-built shapes', 'Bank shots'],
      cta: 'POP ▶',
      boards: [
        { id: 'bubble', title: 'Infinite Bubble Shooter', group: 'Infinite', type: 'score', href: '/bubble/' },
        { id: 'bubble-classic', title: 'Classic Bubble Shooter', group: 'Classic', type: 'score', href: '/bubble/?mode=classic' },
      ],
      classicWin: ['bubble-classic'],
      achievements: [
        { id: 'bubble-10k', icon: '🫧', name: 'Pop Star', desc: 'Score 10,000 in Bubble Shooter', points: 20, kind: 'score', goal: 10000 },
        { id: 'bubble-50k', icon: '🌈', name: 'Chain Reaction', desc: 'Score 50,000 in Bubble Shooter', points: 50, kind: 'score', goal: 50000 },
        { id: 'bubble-classic', icon: '🏅', name: 'Wall Cleared', desc: 'Beat Classic Bubble Shooter', points: 40, kind: 'win', boards: ['bubble-classic'] },
      ],
    },
    {
      id: 'klondike', name: 'Klondike', icon: '🂡', color: '#7ee2a8', path: '/solitaire/', category: 'cards', type: 'time', daily: 'Draw 1 deal',
      scoreCap: [50000, 100, 0], dailyMinTime: 30, assets: ['/solitaire/style.css', '/solitaire/engine.js', '/solitaire/solitaire.js'], preview: ['/solitaire/preview.js'],
      blurb: 'The patience everyone knows, with Draw 1 or Draw 3, drag and drop, tap-to-move, unlimited undo and hints.',
      tags: ['Draw 1 or 3', 'Undo & hints', 'Drag or tap'],
      cta: 'DEAL ▶',
      boards: [
        { id: 'klondike-1', title: 'Klondike · Draw 1', group: 'Solitaire', type: 'time', href: '/solitaire/', minTime: 30 },
        { id: 'klondike-3', title: 'Klondike · Draw 3', group: 'Solitaire', type: 'time', href: '/solitaire/', minTime: 30 },
      ],
      classicWin: null,
      achievements: [
        { id: 'klondike-win', icon: '🂡', name: 'Patience', desc: 'Win a game of Klondike', points: 20, kind: 'win', boards: '*' },
        { id: 'klondike-3', icon: '🎴', name: 'Draw Three', desc: 'Win Klondike with Draw 3', points: 40, kind: 'win', boards: ['klondike-3'] },
        { id: 'klondike-fast', icon: '⏱️', name: 'Speed Dealer', desc: 'Win Klondike in under 3 minutes', points: 40, kind: 'fastest', boards: '*', under: 180 },
      ],
    },
    {
      id: 'spider', name: 'Spider', icon: '🕷️', color: '#5fd4e0', path: '/spider/', category: 'cards', type: 'time', daily: '1-suit deal',
      scoreCap: [50000, 100, 0], dailyMinTime: 45, assets: ['/solitaire/spider.js'], preview: ['/spider/preview.js'],
      blurb: 'Build runs from king to ace and clear all eight suits. Choose 1, 2 or 4 suits — from a gentle warm-up to a proper challenge.',
      tags: ['1, 2 or 4 suits', 'Undo & hints', 'Drag or tap'],
      cta: 'DEAL ▶',
      boards: [
        { id: 'spider-1', title: 'Spider · 1 suit', group: 'Solitaire', type: 'time', href: '/spider/', minTime: 45 },
        { id: 'spider-2', title: 'Spider · 2 suits', group: 'Solitaire', type: 'time', href: '/spider/', minTime: 60 },
        { id: 'spider-4', title: 'Spider · 4 suits', group: 'Solitaire', type: 'time', href: '/spider/', minTime: 90 },
      ],
      classicWin: null,
      achievements: [
        { id: 'spider-win', icon: '🕸️', name: 'Web Spinner', desc: 'Win a game of Spider', points: 20, kind: 'win', boards: '*' },
        { id: 'spider-2', icon: '🎭', name: 'Two Suits', desc: 'Win Spider with 2 suits', points: 40, kind: 'win', boards: ['spider-2'] },
        { id: 'four-suits', icon: '🕷️', name: 'Four-Suit Spider', desc: 'Win Spider with 4 suits', points: 60, kind: 'win', boards: ['spider-4'] },
      ],
    },
    {
      id: 'freecell', name: 'FreeCell', icon: '🃏', color: '#b8e986', path: '/freecell/', category: 'cards', type: 'time', daily: 'Same deal',
      scoreCap: [50000, 100, 0], dailyMinTime: 20, assets: ['/solitaire/freecell.js'], preview: ['/freecell/preview.js'],
      blurb: 'Every deal can be won with the right plan. Four free cells, numbered deals and unlimited undo.',
      tags: ['Numbered deals', 'Nearly all winnable', 'Undo & hints'],
      cta: 'DEAL ▶',
      boards: [
        { id: 'freecell', title: 'FreeCell', group: 'Solitaire', type: 'time', href: '/freecell/', minTime: 20 },
      ],
      classicWin: null,
      achievements: [
        { id: 'freecell-win', icon: '🕊️', name: 'Free Bird', desc: 'Win a game of FreeCell', points: 20, kind: 'win', boards: '*' },
        { id: 'freecell-fast', icon: '⏲️', name: 'Quick Cells', desc: 'Win FreeCell in under 2 minutes', points: 40, kind: 'fastest', boards: '*', under: 120 },
      ],
    },
  ];

  const byId = Object.fromEntries(GAMES.map((g) => [g.id, g]));
  const boardGame = {};
  GAMES.forEach((g) => g.boards.forEach((b) => { boardGame[b.id] = g.id; }));

  // which game a leaderboard belongs to ('daily-snake-20260917' → 'snake')
  function gameOf(board) {
    const m = /^daily-([a-z0-9]+)-\d{8}$/.exec(board || '');
    return m ? m[1] : boardGame[board] || null;
  }
  // board type ('score' | 'time'), including daily boards
  function boardType(board) {
    const m = /^daily-([a-z0-9]+)-\d{8}$/.exec(board || '');
    if (m) return byId[m[1]] ? byId[m[1]].type : null;
    const g = byId[boardGame[board]];
    const b = g && g.boards.find((x) => x.id === board);
    return b ? b.type : null;
  }

  root.ArcadeGames = { list: GAMES, byId, gameOf, boardType, get: (id) => byId[id] || null };
})(typeof self !== 'undefined' ? self : globalThis);
