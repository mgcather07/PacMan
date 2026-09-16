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

No build step. Everything lives in `public/`.

## Run locally

```bash
python3 -m http.server 5173 --directory public
```

## Deploy

```bash
firebase deploy --only hosting
```
