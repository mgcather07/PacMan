# Infinite Arcade

A static site of arcade and card games:

- **Infinite Pac-Man** (`/pacman/`): Pac-Man in a maze that is procedurally generated forever in every direction. Hidden playing cards (♠♥♦♣) give an extra life when you collect all four suits.
- **Infinite Snake** (`/snake/`): Snake in an endless world with rocks, gold stars and rival computer snakes that burst into food when they crash into you. Collect all four card suits for a shield.
- **Infinite Minesweeper** (`/minesweeper/`): an endless minefield with three lives. Mines get denser the farther you go, and the field is saved in the browser.
- **Infinite Frogger** (`/frogger/`): endless procedurally generated roads, rivers (logs and diving turtles) and railways, with a creeping camera so you can't stand still.
- **Klondike Solitaire** (`/solitaire/`): draw 1/3, drag and drop, tap to auto-move, undo, hints and auto-complete.
- **Spider Solitaire** (`/spider/`): 1, 2 or 4 suits; completed King-to-Ace runs clear automatically.
- **FreeCell** (`/freecell/`): the original Microsoft numbered deals (`/freecell/?game=617`), supermoves and automatic safe moves to the foundations.

Spider and FreeCell share `public/solitaire/engine.js`, which handles cards, drag and drop, undo, hints, the timer and the win animation; each game file only defines its rules.

The newer canvas games share `public/shared/arcade.css` and `public/shared/arcade.js` (HUD/overlay styles, sound synth, canvas sizing, swipe input, high scores).

No build step. Everything lives in `public/`.

## Run locally

```bash
python3 -m http.server 5173 --directory public
```

## Deploy

```bash
firebase deploy --only hosting
```
