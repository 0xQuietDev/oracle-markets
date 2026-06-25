# ORACLE — pitch deck

A self-contained reveal.js 5.x deck. No build step, no install.

## Present
- Open `pitch/index.html` directly in a browser (works over `file://`).
- `F` — fullscreen · `S` — speaker notes (separate window) · `Esc` — slide overview.
- `→ / ←` (or `Space`) move between slides · `B` blacks the screen.
- All assets are local (`assets/`); reveal.js + fonts load from CDN, so be online the first time.

## Export to PDF
- In the browser, append `?print-pdf` to the URL (e.g. `index.html?print-pdf`), then Print → Save as PDF (Background graphics ON, margins None).
- Or headless: `npx decktape reveal pitch/index.html oracle-pitch.pdf`.

14 slides · ~3-minute pitch · brand: dark trading terminal (indigo `#818cf8`, YES `#34d399`, NO `#f87171`).
