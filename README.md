# Personal Productivity

A GTD-style desktop app built with Electron and React (plain JavaScript).

```bash
npm install
npm start        # bundles the renderer (~0.1s, esbuild) and launches Electron
npm run dev      # optional: rebuild on save, then Ctrl+R in the app to reload
npm run dist     # builds dist/personal-productivity_<version>_amd64.deb
npm run dist:win # builds a Windows installer (.exe); run on Windows, or on Linux with Wine
```

Data is saved as JSON in `data.json` in the app data folder: `~/.config/Personal Productivity/` on Linux,
`%APPDATA%\Personal Productivity\` on Windows.
Ctrl+Shift+I opens devtools.

## Layout

- `electron/` main process (window, saving data, system notifications) and preload bridge
- `renderer/src/store.js` data model and every action that changes it
- `renderer/src/query.js` Task view query engine (fields, operators, grouping, presets)
- `renderer/src/menus.js` right-click menus for tasks, projects and folders
- `renderer/src/views/` one file per screen; `components/` shared pieces
- `renderer/src/budget/` the budget side: `model.js` (pure calculations), `actions.js` (changes), one file per screen

## Budget

Press **Alt** (on its own) anywhere to switch between Productivity and Budget.

- **Month** — one column per line, one row per day, with Total / So far / Remaining at the top and
  the expected balance for every day on the right. Click a cell to record or plan money; click a
  recurring purchase's box to tick it as bought. The Plan panel shows income, then each group and
  what's left after it. ←/→ change month. "Start a new month" ends the current one the day before
  and runs the new one to the end of next month (undoable).
- Line types: **Recurring purchase** (every N days at a unit cost; predictions restart from the last
  purchase), **Scheduled** (bills/income on dates, repeating monthly or one-off, with estimated
  date/amount), **Allowance** (£ per week or month), plus one-off expenses/income.
- **Chart** — stacked burndown of the month by group or by line.
- **Goods & prices** — unit prices, composites built from other goods, receipt names, price history.
- **Receipts** — photos are read locally by Ollama (`qwen3-vl:4b-instruct`, ~12s on a 6GB GPU) and
  matched to saved goods. Needs `ollama serve` running. Photos are stored in
  a `receipts/` folder beside `data.json`.

## Quick capture shortcuts

`#tag`, `!1`–`!3` (priority), `@today`, `@tomorrow`. Press Tab to add a next action.
