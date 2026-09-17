# Infinite Arcade

A static site of arcade, puzzle and card games. Every game has an Infinite mode that never ends, a
Classic mode with an ending you can beat, a shared daily challenge, online leaderboards, achievements
and offline play.

<!-- games:start -->
**28 games.** Every one has an endless Infinite mode, most have a Classic mode with an ending you can beat, and all of them have a daily challenge everyone plays from the same seed.

| | Game | Kind | Infinite | Classic | Daily challenge |
|---|---|---|---|---|---|
| 🟡 | [Pac-Man](public/pacman/) | Arcade | Endless | 4 levels | Same maze |
| 🐍 | [Snake](public/snake/) | Arcade | Endless | 3 stages | Same world |
| 💣 | [Minesweeper](public/minesweeper/) | Puzzle | Endless | 3 difficulties | Same minefield |
| 🐸 | [Frogger](public/frogger/) | Arcade | Endless | 3 courses | Same roads |
| 🧱 | [Breakout](public/breakout/) | Arcade | Endless | 5 levels | Same bricks |
| ☄️ | [Asteroids](public/asteroids/) | Arcade | Endless space | 8 waves | Same rocks |
| 🟪 | [Tetris](public/tetris/) | Puzzle | Tower + Marathon | Sprint 40 | Same pieces |
| 🚀 | [Space Shooter](public/shooter/) | Arcade | Endless waves | 15 waves | Same waves |
| 👾 | [Space Invaders](public/invaders/) | Arcade | Endless waves | 10 waves | Same formations |
| 🏓 | [Pong](public/pong/) | Arcade | Endless rally | First to 11 | Same rally |
| 🎯 | [Missile Command](public/missile/) | Arcade | Endless waves | 12 waves | Same attack |
| 🔢 | [2048](public/2048/) | Puzzle | Endless 5×5 | Classic 4×4 | Same tiles |
| 🐤 | [Sky Flyer](public/flyer/) | Arcade | Endless | 50 gates | Same course |
| 🫧 | [Bubble Shooter](public/bubble/) | Puzzle | Endless wall | 20 levels | Same wall |
| 🚁 | [Defender](public/defender/) | Arcade | Wrapping world | 10 waves | Same raid |
| 🌀 | [Tempest](public/tempest/) | Arcade | Endless tubes | 16 levels | Same tubes |
| 🐛 | [Centipede](public/centipede/) | Arcade | Endless waves | 12 waves | Same swarm |
| 🪖 | [Tank Battle](public/tanks/) | Arcade | Endless stages | 15 stages | Same battlefield |
| 🔺 | [Pyramid](public/pyramid/) | Cards | Endless deals | — | Same deal |
| 💎 | [Gem Match](public/match3/) | Puzzle | Clock tops up | 20 levels | Same board |
| ⛰️ | [TriPeaks](public/tripeaks/) | Cards | Endless boards | — | Same deal |
| 🀄 | [Mahjong](public/mahjong/) | Cards | Endless layouts | — | Same layout |
| ⛏️ | [Digger](public/digger/) | Arcade | Endless caves | 12 caves | Same caves |
| 📦 | [Sokoban](public/sokoban/) | Puzzle | Endless rooms | 30 rooms | Same puzzle |
| 🏎️ | [Micro Racer](public/racer/) | Arcade | Endless road | 5 circuits | Same track |
| 🂡 | [Klondike](public/solitaire/) | Cards | Draw 1 or 3 | — | Draw 1 deal |
| 🕷️ | [Spider](public/spider/) | Cards | 1, 2 or 4 suits | — | 1-suit deal |
| 🃏 | [FreeCell](public/freecell/) | Cards | Numbered deals | — | Same deal |
<!-- games:end -->

Spider and FreeCell share `public/solitaire/engine.js`, which handles cards, drag and drop, undo, hints, the timer and the win animation; each game file only defines its rules.

The newer canvas games share `public/shared/arcade.css` and `public/shared/arcade.js` (HUD/overlay styles, sound synth, canvas sizing, swipe input, high scores).

## Two versions: Infinite and Classic

The home page has two tabs. **Infinite** runs every game endlessly. **Classic** links to the same games
with `?mode=classic`, where each one has an ending you can beat (see the Classic column above).

Mode detection and the shared win screen live in `public/shared/arcade.js` (`Arcade.classic`, `Arcade.endScreen`); elements with `only-classic` / `only-infinite` classes switch automatically. Classic high scores are stored separately from infinite ones.

## The game registry

`public/shared/games.js` is the single list of every game: id, name, icon, accent color, category, the
daily twist, the home-page card copy, its leaderboards, its achievements, the files to cache offline and
the server's score limits. The home page, Daily page, Leaderboards page, profile, achievements, admin
dashboard and service worker all read it, and `node scripts/sync-games.mjs` (run automatically before a
functions deploy) writes the server's copy to `functions/games.json`.

**Adding a game** is a folder under `public/` plus one registry entry — see
[docs/ADDING_A_GAME.md](docs/ADDING_A_GAME.md), with `public/invaders/` as the reference game.

## Leaderboards

Online top-10 boards for every game live in Cloud Firestore, with a page at `/leaderboards/`. All writes go through Cloud Functions (`functions/index.js`); clients can only read.

- **Players:** every visitor starts as a guest via Firebase **Anonymous Auth** (one hidden ID per browser). Their display name is stored in `players/{uid}` and can be changed any time from the home page, the Leaderboards page, the 🏆 pop-up or a game-over screen; the `setName` function renames all of their entries.
- **Same player on every device:** the ☁️ Sync button on the name chip (and "☁️ Sync devices" after posting a score) signs in with Google. On the first device the guest is simply linked to the Google account (`linkWithPopup`), keeping its uid and everything on it. On another device the Google account already belongs to a player, so the client sends the guest's ID token, signs in to the Google account and calls `mergeAccount`, which verifies the token is an anonymous user's, moves the better entry on each board, unions the daily-challenge days (so streaks are right), sums play counts, moves runs in progress, fixes the player counts in `stats/global` and deletes the guest. If the merge call fails, the token is kept for up to an hour and the merge is retried on the next visit. Signing out makes the device a fresh guest.
- **Verified runs:** when a round starts, the game calls `Leaderboard.startRun(board)`, which asks the `startRun` function to start a clock on the server (`runs/{id}`). At game over, `submitScore` checks the result against how long the run actually lasted: a score may not exceed a generous per-game cap (`SCORE_CAP`, base + points/second), a winning time may not beat a humanly possible minimum (`MIN_TIME`) or be longer than the run, each run can only be posted once, and daily boards only accept yesterday/today/tomorrow. Rejected results are logged (`firebase functions:log`). Old runs are removed by a Firestore TTL policy on `expireAt`.
- **Scores:** one entry per player per board at `boards/{board}/scores/{uid}`, kept at their best. Score boards rank highest first; time boards (Tetris Sprint, classic Minesweeper, solitaire) rank the fastest win first.
- **App Check** (reCAPTCHA Enterprise key `6LcCJb8t…`) is **enforced** on Firestore, Authentication and every callable function, so requests must come from the real site.
- **`firestore.rules`:** leaderboards are publicly readable, `players/{uid}` is readable only by its owner, and everything else (`runs`, `stats`, `config`) is server-only. No client writes at all.
- `public/shared/leaderboard.js` loads Firebase (App, App Check, Auth, Firestore Lite, Functions) from gstatic the first time a game starts or a leaderboard is opened.

**Local testing:** App Check blocks localhost unless you register a debug token (Firebase console → App Check → Apps → Manage debug tokens) and run `localStorage.setItem('appcheck.debug', '<token>')` in the browser on `http://localhost:5173`. Local test games write to the real database, so delete the test data and the token when you're done.

To remove an entry, use the Firebase console or `firebase firestore:delete boards/<board>/scores/<uid>`.

## Profile, levels and achievements

- **Top bar** (`public/shared/nav.js`): the home, Daily, Leaderboards and Profile pages share a sticky bar with section links (a red dot on Daily until today's challenge is done) and the player badge: avatar, name, level, streak and ☁️ when synced. It opens `/profile/`.
- **Profile page** (`public/profile/`): the player card (avatar, name, level title and XP bar), then tabs for an overview (stats, closest achievements, most-played games, best ranks), achievements, personal bests on every board with rank, and settings (Google sync/sign-out, menu music, sound effects).
- **Avatars:** 26 emoji avatars on 8 colors, saved with the `setAvatar` function and copied onto the player's leaderboard entries (like names), so they show next to names on every leaderboard. The first 12 are free; the rest unlock with achievements (checked on the client).
- **Achievements and XP** (`public/shared/achievements.js`): 57 achievements in 14 groups: arcade-wide (plays, Classic clears, solitaire wins), daily challenges (streaks, finishes, Clean Sweep), competition (holding top-3 or #1 spots) and 3–4 per game (two score goals, beating Classic, and for solitaire harder variants and fast wins). They are computed from the player doc and their entries. XP = 5 per play + 20 per daily finish + achievement points (2,280 in total). Level L starts at 15·(L−1)² + 60·(L−1) XP, so early levels come quickly and Legend (level 25) takes about 10,000 XP; titles run Rookie → Player → Challenger → Pro → Ace → Champion → Legend → Mythic (40). After posting a result the game-over screen announces newly unlocked achievements (each once per device, tracked in `localStorage`).

## Daily Challenge page

`/daily/` is the hub for the day: a live countdown, a **streak panel** (flame, current/best streak, last 7 days), a **progress panel** (one lit tile per finished game, **▶ Next** to the first unplayed challenge, **Share today**), Today/Yesterday tabs, **All / To play / Done** filters, and an arcade-style card per game in its own color (your best + rank, 🥇🥈🥉 or ✓ DONE stamp, top 5, player count, Play / Beat your best). Yesterday shows final results with the winner crowned.

"Done" means you posted a result or finished that challenge on this device (`Leaderboard.dailyDone(day)`, stored in `localStorage['arcade.dailyDone']`). After every daily game, the game-over panel links straight to the next challenge you haven't finished.

## Streaks and sharing

- **Daily streaks:** finishing any daily challenge records that day in `players/{uid}.days` (server-side, in `submitScore`). The current streak counts back from today (or from yesterday, until today's challenge is done). It shows as 🔥 N on the name chip, as a banner on `/daily/`, and after each daily game.
- **Share:** after posting a score, **📤 Share** opens the phone's share sheet (or copies to the clipboard on desktop), e.g. `📅 Infinite Arcade Daily · Wed, Sep 16 / 🐸 Frogger: 1,240 pts (#3 of 12) / 🔥 5-day streak / link`. **Share today** on `/daily/` copies a summary of every challenge you've posted that day.

## Analytics

- **Google Analytics 4** (`public/shared/analytics.js`, the property linked to Firebase, `G-28C6FMQP9X`) records page views plus `game_start` and `game_end` (params `game`, `mode`, `board`, plus `score`, `won` and `duration` on `game_end`), `share` and `name_set`. See Firebase console → Analytics, or analytics.google.com. Nothing is sent from localhost. To break reports down by game, register `game`, `mode` and `board` as event-scoped custom dimensions (GA → Admin → Custom definitions).
- **Player stats in Firestore:** `startRun` / `logPlay` count plays in `players/{uid}.plays`, `stats/global` (all-time plays and unique players per game, per mode) and `stats/global/days/{YYYYMMDD}` (UTC; plays, active and new players, finishes). Arcade games count a play when a round starts; solitaire and Minesweeper count it on the first move.
- **Dashboard:** `/admin/` (not linked, `noindex`) shows most-played games, plays per day, top players with their favorite games, streak leaders, recent players and daily-challenge entries. Sign in with Google; the `adminStats` function only answers accounts whose email is in the Firestore doc `config/admins` (`emails` array, or `uids` for anonymous test accounts). Google must be enabled under Authentication → Sign-in method.

## Daily Challenges

`/daily/` lists today's challenge for every game, a countdown to midnight (local time), your best result on each and the top 5. Opening a game with `?daily=YYYYMMDD` (or `?daily=today`) makes its world come from a seed shared by everyone that day — `public/shared/daily.js` provides `Daily.seed(game)` / `Daily.rng(game)`:

| Game | What's the same for everyone |
|------|------------------------------|
| Pac-Man, Snake, Minesweeper | the whole procedurally generated world |
| Frogger, Breakout, Space Shooter | lane / brick-row / wave generation |
| Asteroids | rock spawn sizes and speeds |
| Tetris | the piece order (Marathon rules) |
| Klondike (Draw 1), Spider (1 suit), FreeCell | the deal |

Daily games use the Infinite rules and post to `boards/daily-<game>-<YYYYMMDD>`. The rules only accept new results on yesterday's, today's or tomorrow's board (UTC) so every time zone can play its own date, and older boards stay readable.

## Install as an app

The site is a Progressive Web App: `public/manifest.webmanifest` (name, icons incl. a maskable one, shortcuts to Daily / Pac-Man / Solitaire / Leaderboards) and `public/sw.js`.

- **Install:** the home page shows **📲 Install app** when the browser can install it (Chrome, Edge, Android use the native prompt; iPhone/iPad Safari shows "Share → Add to Home Screen" steps). Handled by `public/shared/pwa.js`, which also registers the service worker on every page.
- **Offline:** all pages, scripts and styles are pre-cached. Requests are network-first (new deploys show up immediately) with a 3.5s fallback to the cache, so games load and play without a connection. Google Fonts are cached; Firebase, leaderboards and analytics always use the network, and a game started offline just can't post its score. Bump `CACHE` in `sw.js` only if you need to force-clear old caches.

## Phones

Title screens let their text flow on narrow screens, HUDs stay on one line, overlays scroll when they're taller than the screen, the music toggle shrinks to a round ♫ button, and touch controls don't overlap the sound/home buttons (Asteroids moves them above the pads; Tetris moves them to the top).

## Menu music

The home page, `/daily/`, `/leaderboards/` and the arcade games' title screens play an original chiptune loop (`public/shared/music.js`): 16 bars at 124 BPM with a square-wave lead, triangle bass, arpeggios and synthesized drums, all generated live with Web Audio (no audio files). Browsers block sound until a user gesture, so it starts on the first click, tap or key press; the ♫ button in the bottom-left turns it off and the choice is remembered (`localStorage['arcade.music']`). It pauses while the tab is hidden. On a game page it only plays while the title screen is showing (`ArcadeMusic.mount({ screen: 'title' })`) and fades out when a round starts; if the first click is PLAY, it stays quiet. The games keep their own sound effects.

No build step. Everything lives in `public/`.

## Run locally

```bash
python3 -m http.server 5173 --directory public
```

Local pages can't reach the live Firebase project (App Check only trusts the real domains). To test leaderboards, profiles and sign-in locally, start the emulators (needs Java 21+) and open any page with `?emulators`, which points that tab at them:

```bash
firebase emulators:start --only auth,firestore,functions --project demo-arcade
```

## Deploy

```bash
firebase deploy --only hosting,firestore,functions
```
