# Wordle

A self-contained Wordle clone — pure HTML/CSS/JS, no build step, no dependencies.

## Play

Just open `wordle/index.html` in a browser, or serve the folder:

```bash
python3 -m http.server -d wordle 4319
# then open http://localhost:4319
```

## Features

- Classic 6×5 board with tile flip / shake / bounce animations
- On-screen and physical keyboard, with letter-status coloring
- **Daily puzzle** (same word for everyone each day) plus **New Random Game** from Settings
- **Hard mode** — revealed hints must be reused in later guesses
- Win/lose handling, results **share** (emoji grid to clipboard / native share)
- **Statistics**: played, win %, current & max streak, guess distribution
- Light / dark theme (remembers your choice; follows system preference by default)
- Progress, stats, and preferences persist in `localStorage`

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup, styles, and modals |
| `game.js` | Game logic, rendering, stats, sharing, theming |
| `words.js` | Answer list + accepted-guess dictionary |

Open Settings by right-clicking (or long-pressing) the moon icon in the header.
