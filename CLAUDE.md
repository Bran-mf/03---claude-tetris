# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Zero-dependency browser Tetris — vanilla HTML/CSS/JavaScript (ES6+), no build step, no package manager. Three files contain the entire game: `index.html`, `style.css`, `game.js`.

## Running the game

Open `index.html` in a browser, or serve with any static server:

```
python3 -m http.server 8000
# or
npx serve .
```

Direct `file://` access may hit canvas security restrictions; prefer a local server.

## Critical gotcha: canvas dimensions must match JS constants

`game.js` defines three constants that control board geometry:

| Constant | Default | Meaning |
|---|---|---|
| `COLS` | 10 | Board columns |
| `ROWS` | 20 | Board rows |
| `BLOCK` | 30 | Cell size in px |

If you change any of these, you **must** also update the `<canvas width>` and `<canvas height>` attributes in `index.html`. The canvas is sized `COLS * BLOCK` × `ROWS * BLOCK` (main board: 300×600; next-piece preview: 120×120).

## Code style

- `'use strict'` at top of JS files
- `const`/`let` only — no `var`
- Arrow functions for callbacks
- Template literals for string interpolation
- 2-space indentation
- No external dependencies — keep it that way

## Other tunable parameters in game.js

- `COLORS[1-7]` — hex colors per piece type
- `LINE_SCORES` — points for 1/2/3/4-line clears `[0, 100, 300, 500, 800]`
- `dropInterval` — initial fall speed in ms (default 1000)
- Level speed formula: `max(100, 1000 - (level - 1) * 90)`

## No tests or linting

There is no test suite or lint config. Verify changes by running the game in a browser.
