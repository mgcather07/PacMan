# Infinite Arcade

A static site with two games:

- **Infinite Pac-Man** (`/pacman/`): Pac-Man in a maze that is procedurally generated forever in every direction. Hidden playing cards (♠♥♦♣) give an extra life when you collect all four suits.
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
