# Infinite Arcade

A static site with four games:

- **Infinite Pac-Man** (`/pacman/`): Pac-Man in a maze that is procedurally generated forever in every direction. Hidden playing cards (♠♥♦♣) give an extra life when you collect all four suits.
- **Infinite Snake** (`/snake/`): Snake in an endless world with rocks, gold stars and rival computer snakes that burst into food when they crash into you. Collect all four card suits for a shield.
- **Infinite Minesweeper** (`/minesweeper/`): an endless minefield with three lives. Mines get denser the farther you go, and the field is saved in the browser.
- **Solitaire** (`/solitaire/`): classic Klondike with draw 1/3, drag and drop, tap to auto-move, undo, hints and auto-complete.

No build step. Everything lives in `public/`.

## Run locally

```bash
python3 -m http.server 5173 --directory public
```

## Deploy

```bash
firebase deploy --only hosting
```
