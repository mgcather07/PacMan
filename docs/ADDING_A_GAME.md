# Adding a game to the Infinite Arcade

Every game in the arcade works the same way, so players get the same things everywhere: an Infinite
mode, a Classic mode you can beat, a shared Daily Challenge, leaderboards with server-checked scores,
achievements, music, phone controls and offline play.

**Reference game: `public/invaders/`** (`index.html`, `invaders.js`, `sprites.js`, `preview.js`).
Copy its structure. `public/shooter/` is a second example.

A new game is:

1. `public/<id>/index.html` — the page (title screen, HUD, game-over screen)
2. `public/<id>/<id>.js` — the game itself
3. `public/<id>/preview.js` — the animation on its home-page card
4. one entry in `public/shared/games.js` — the registry, which wires up everything else

Nothing else needs editing: leaderboards, the Daily page, the profile, achievements, the admin
dashboard, the service worker and the server's score checks all read the registry.

---

## 1. The page (`index.html`)

Start from `public/invaders/index.html` and keep this structure:

- The same `<head>`: viewport with `maximum-scale=1`, manifest, apple meta tags, Open Graph tags
  (change the URL/title/description), the Press Start 2P font, and `/shared/arcade.css`.
- `<style>` sets `--accent`, `--accent-dark` and `--bg` (the accent must match the registry `color`)
  plus any game-specific styles.
- `<canvas id="game" class="game">`, a `.hud` block, `.hud-buttons` with the sound button and the
  `⌂` home link, `#toast`, and two overlays: `#title` and `#over` (hidden).
- Title and game-over copy: `.only-infinite` / `.only-classic` spans so one page describes both modes.
- Touch controls go in an element with `class="touch"` (shown only on touch devices).
- Scripts, in this order:

```html
<script src="/shared/games.js"></script>
<script src="/shared/daily.js"></script>
<script src="/shared/arcade.js"></script>
<script src="/shared/leaderboard.js"></script>
<script src="<id>.js"></script>
<script src="/shared/music.js"></script><script>ArcadeMusic.mount({ screen: 'title' });</script>
```

## 2. The game (`<id>.js`)

Use the helpers in `/shared/arcade.js` (`Arcade.setupCanvas`, `Sound`, `toast`, `store`,
`bindPadButtons`, `swipe`, `soundButton`, `rand`, `clamp`, `classic`, `modeKey`, `endScreen`).

**Fixed play field.** Pick a field size (e.g. `600 × 840`) and scale it to the window in
`setupCanvas`, so the game looks the same on every screen. Convert pointer coordinates back with
`(clientX - offX) / scale`.

**Three modes, one game.**

| | how it starts | rules |
|---|---|---|
| Infinite | `/<id>/` | never ends, gets harder forever, ends when the player loses |
| Classic | `/<id>/?mode=classic` (`Arcade.classic`) | a fixed number of levels/waves that can be **won** — call `Arcade.endScreen(true, 'message')` |
| Daily | `/<id>/?daily=YYYYMMDD` (`Daily.active`) | the Infinite rules, but every random choice about the world comes from `Daily.rng('<id>')` |

**Daily challenges must be identical for everyone.** Put every world decision (level layouts, spawn
timing, item types, deals) through one seeded generator:

```js
let wrand = Math.random;                       // in newGame():
wrand = DAILY ? Daily.rng('<id>') : Math.random;
const wr = (a, b) => a + wrand() * (b - a);
```

Use plain `Math.random()` only for cosmetics (particles, screen shake). Two loads of the same daily
must produce the same game — this is tested.

**Leaderboards.** One board id per mode; the daily board id comes from `Daily.board('<id>')`:

```js
const BOARD = Daily.board('<id>') || (Arcade.classic ? '<id>-classic' : '<id>');
// when a round starts (this also counts a play and starts the server's clock):
Leaderboard.startRun(BOARD);
// when it ends:
Leaderboard.offer(BOARD, { score, won, time }, document.querySelector('#over .panel'));
// on the title screen:
Leaderboard.button(BOARD, document.querySelector('#title .panel'), 'btn alt');
Leaderboard.nameBar(document.querySelector('#title .panel'));
```

For games where the board ranks the fastest win (`type: 'time'`), pass `time` in seconds and
`won: true` only on a real win. If the game deals/builds a board before the player acts, call
`Leaderboard.startRun(BOARD, { play: false })` and `Leaderboard.played(BOARD)` on the first move.

**Scores must be plausible.** The server rejects a score above `base + perSec·t + perSec²·t²` for a
run that has lasted `t` seconds (registry `scoreCap`). Play the game, see what a good run scores per
minute, and set a cap several times higher than a very strong player. Never post a score the player
did not earn on the clock.

**Sound and music.** Use `Arcade.Sound` for effects and wire the sound button with
`Arcade.soundButton`. Menu music is handled by `ArcadeMusic.mount({ screen: 'title' })`.

**Phones.** Everything must be playable on a 375 × 812 screen: big touch targets, drag or tap
controls (no keyboard-only actions), nothing important under the HUD, and `env(safe-area-inset-*)`
padding for fixed controls. Test at that size.

**Pause** on `P` / `Escape` and on `visibilitychange`.

**The test hook.** Animation frames stop when a tab is hidden, so automated tests drive the game
directly. Every game must expose this on localhost only:

```js
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.ArcadeTest = {
    game: '<id>',
    start,                                    // start a fresh round
    step: (frames = 1, dt = 1 / 60) => { for (let i = 0; i < frames; i++) if (state === 'play') update(dt); },
    peek: () => ({ state, score, lives, level, ... }),   // state is 'title' | 'play' | 'over'
    set: (key, value) => { ... },             // at least 'score', 'lives' and the level/wave
    win: () => { ... },                       // jump to a winning finish (Classic mode)
  };
}
```

`peek()` must include `state` and `score`; add whatever else the game has (lives, wave, level,
moves, time). `set('wave', n)` style shortcuts make testing later stages possible.

## 3. The card preview (`preview.js`)

A small looping animation for the game's home-page card. No element ids, no globals:

```js
(window.ArcadePreviews = window.ArcadePreviews || {}).<id> = function (canvas) {
  const ctx = canvas.getContext('2d');
  let raf = 0;
  function frame(now) { /* size from canvas.clientWidth/Height × devicePixelRatio (max 2) */ raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);   // the home page stops previews it can't see
};
```

Keep it cheap (it shares the page with other previews) and make it read at 300 × 220 and at phone
width.

## 4. The registry entry (`public/shared/games.js`)

One object per game; the file's header comment documents every field. Checklist:

- `id` (lowercase letters/digits, matches the folder), `name`, `icon` (emoji), `color` (hex accent,
  distinct from the other games), `path`, `category` (`arcade` | `puzzle` | `cards`)
- `type`: `'score'` or `'time'` for the daily board, `daily`: what's shared ("Same maze")
- `scoreCap`, and `dailyMinTime` for time games
- `blurb` / `blurbClassic`, `tags` / `tagsClassic` (three short tags), `cta` for the home card
- `assets` (every file the game needs offline) and `preview` (scripts that draw the card preview)
- `boards`: one per mode with `id`, `title`, `group` (`Infinite` | `Classic` | `Solitaire`), `type`,
  `href`, plus `minTime` on time boards
- `classicWin`: the boards that mean "you beat this game" (counts towards Completionist)
- `achievements`: three or four — two score goals (`kind: 'score'`), beating Classic (`kind: 'win'`),
  and optionally a speed goal (`kind: 'fastest'`). Ids must be unique across the whole arcade; keep
  points in line with other games (20 / 40–50 for the harder ones).

Then regenerate the server's copy and the README table:

```bash
node scripts/sync-games.mjs
node scripts/update-readme-games.mjs
```

## 5. Testing before it ships

Local pages can't reach the live Firebase project, so run the emulators and open pages with
`?emulators` (remembered for that tab):

```bash
firebase emulators:start --only auth,firestore,functions --project demo-arcade
python3 -m http.server 5173 --directory public
```

Check all of this:

1. **Plays** — title screen starts, the game runs, the game-over screen shows, "play again" works.
2. **Classic** — `?mode=classic` can be won and shows "YOU WIN!".
3. **Daily** — `?daily=today` twice in a row produces exactly the same game.
4. **Leaderboard** — a finished round posts a score (and the name form appears for a new player).
5. **Phone** — playable and readable at 375 × 812.
6. **Console** — no errors, and `node --check` passes on every script.
