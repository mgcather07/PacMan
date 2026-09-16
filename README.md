# Infinite Arcade

A static site of arcade and card games:

- **Infinite Pac-Man** (`/pacman/`): Pac-Man in a maze that is procedurally generated forever in every direction. Hidden playing cards (♠♥♦♣) give an extra life when you collect all four suits.
- **Infinite Snake** (`/snake/`): Snake in an endless world with rocks, gold stars and rival computer snakes that burst into food when they crash into you. Collect all four card suits for a shield.
- **Infinite Minesweeper** (`/minesweeper/`): an endless minefield with three lives. Mines get denser the farther you go, and the field is saved in the browser.
- **Infinite Frogger** (`/frogger/`): endless procedurally generated roads, rivers (logs and diving turtles) and railways, with a creeping camera so you can't stand still.
- **Infinite Breakout** (`/breakout/`): an endless brick wall that slides down and gets tougher; multiball, wide paddle, lasers, slow ball, fireball and card-suit capsules.
- **Infinite Asteroids** (`/asteroids/`): open space with a following camera, parallax stars, splitting rocks, flying saucers, radar, pickups (shield, triple shot, rapid fire, card suits) and hyperspace.
- **Infinite Tetris** (`/tetris/`): Tower mode (no ceiling; a rising tide makes every unfinished row it reaches leak, five leaks ends the run) and classic Marathon. SRS rotation with wall kicks, 7-bag, hold, ghost, T-spins, combos and back-to-back.
- **Infinite Space Shooter** (`/shooter/`): endless procedurally built waves (drones, swoopers, gunships, kamikazes), a boss every fifth wave with spiral/fan/ring patterns, weapon levels 1–5, shields, bombs and kill chains.
- **Klondike Solitaire** (`/solitaire/`): draw 1/3, drag and drop, tap to auto-move, undo, hints and auto-complete.
- **Spider Solitaire** (`/spider/`): 1, 2 or 4 suits; completed King-to-Ace runs clear automatically.
- **FreeCell** (`/freecell/`): the original Microsoft numbered deals (`/freecell/?game=617`), supermoves and automatic safe moves to the foundations.

Spider and FreeCell share `public/solitaire/engine.js`, which handles cards, drag and drop, undo, hints, the timer and the win animation; each game file only defines its rules.

The newer canvas games share `public/shared/arcade.css` and `public/shared/arcade.js` (HUD/overlay styles, sound synth, canvas sizing, swipe input, high scores).

## Two versions: Infinite and Classic

The home page has two tabs. **Infinite** runs every arcade game endlessly. **Classic** links to the same games with `?mode=classic`, where each one has an ending you can beat:

| Game | Classic goal |
|------|--------------|
| Pac-Man | Clear every dot in 4 walled mazes (each maze is checked to be fully connected) |
| Snake | Eat enough food to clear 3 walled arenas with more rival snakes each stage |
| Minesweeper | Beginner 9×9/10, Intermediate 16×16/40, Expert 30×16/99, one life, best times saved |
| Frogger | Cross the finish line on 3 courses (45, 65 and 90 rows) |
| Breakout | Clear 5 hand-built levels (armored bricks optional) |
| Asteroids | Clear 8 waves on a wrap-around screen |
| Tetris | Sprint 40 lines (timed) or Marathon to 150 lines |
| Space Shooter | Survive 15 waves and beat the final boss |

Mode detection and the shared win screen live in `public/shared/arcade.js` (`Arcade.classic`, `Arcade.endScreen`); elements with `only-classic` / `only-infinite` classes switch automatically. Classic high scores are stored separately from infinite ones.

## Leaderboards

Online top-10 boards for every game live in Cloud Firestore, with a page at `/leaderboards/`. All writes go through Cloud Functions (`functions/index.js`); clients can only read.

- **Players:** every visitor signs in with Firebase **Anonymous Auth** (one hidden ID per browser). Their display name is stored in `players/{uid}` and can be changed any time from the home page, the Leaderboards page, the 🏆 pop-up or a game-over screen; the `setName` function renames all of their entries.
- **Verified runs:** when a round starts, the game calls `Leaderboard.startRun(board)`, which asks the `startRun` function to start a clock on the server (`runs/{id}`). At game over, `submitScore` checks the result against how long the run actually lasted: a score may not exceed a generous per-game cap (`SCORE_CAP`, base + points/second), a winning time may not beat a humanly possible minimum (`MIN_TIME`) or be longer than the run, each run can only be posted once, and daily boards only accept yesterday/today/tomorrow. Rejected results are logged (`firebase functions:log`). Old runs are removed by a Firestore TTL policy on `expireAt`.
- **Scores:** one entry per player per board at `boards/{board}/scores/{uid}`, kept at their best. Score boards rank highest first; time boards (Tetris Sprint, classic Minesweeper, solitaire) rank the fastest win first.
- **App Check** (reCAPTCHA Enterprise key `6LcCJb8t…`) is **enforced** on Firestore, Authentication and every callable function, so requests must come from the real site.
- **`firestore.rules`:** leaderboards are publicly readable, `players/{uid}` is readable only by its owner, and everything else (`runs`, `stats`, `config`) is server-only. No client writes at all.
- `public/shared/leaderboard.js` loads Firebase (App, App Check, Auth, Firestore Lite, Functions) from gstatic the first time a game starts or a leaderboard is opened.

**Local testing:** App Check blocks localhost unless you register a debug token (Firebase console → App Check → Apps → Manage debug tokens) and run `localStorage.setItem('appcheck.debug', '<token>')` in the browser on `http://localhost:5173`. Local test games write to the real database, so delete the test data and the token when you're done.

To remove an entry, use the Firebase console or `firebase firestore:delete boards/<board>/scores/<uid>`.

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

## Menu music

The home page, `/daily/`, `/leaderboards/` and the arcade games' title screens play an original chiptune loop (`public/shared/music.js`): 16 bars at 124 BPM with a square-wave lead, triangle bass, arpeggios and synthesized drums, all generated live with Web Audio (no audio files). Browsers block sound until a user gesture, so it starts on the first click, tap or key press; the ♫ button in the bottom-left turns it off and the choice is remembered (`localStorage['arcade.music']`). It pauses while the tab is hidden. On a game page it only plays while the title screen is showing (`ArcadeMusic.mount({ screen: 'title' })`) and fades out when a round starts; if the first click is PLAY, it stays quiet. The games keep their own sound effects.

No build step. Everything lives in `public/`.

## Run locally

```bash
python3 -m http.server 5173 --directory public
```

## Deploy

```bash
firebase deploy --only hosting,firestore,functions
```
