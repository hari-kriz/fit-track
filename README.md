# FitTrack

A simple, beautiful weight & habit progress dashboard.

- **Goal:** 104 kg → 73 kg over 10 months (started Jun 22, 2026)
- **Daily inputs:** weight, morning/evening steps (combined 10,000/day goal), protein, gym, breakfast (goal = skipped), lunch, dinner, sleep
- **Home page:** progress ring, days left, current/best streak, average completion, weight trend chart, recent-days table, CSV export

## Run

It's a static site — just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

## Data storage

Daily entries are saved in the browser via `localStorage` (per device/browser). Use **Export CSV** to back up your data.

## Tech

Plain HTML, CSS, and vanilla JavaScript. No build step, no dependencies.
