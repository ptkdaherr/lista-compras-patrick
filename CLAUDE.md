# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A shopping-list web app (in Brazilian Portuguese) shared among friends, deployed on Vercel at `https://lista-compras-deploy.vercel.app`. It is a **single static `index.html` file** — no framework, no build step, no package.json. All HTML, CSS, and JavaScript live inline in that one file. A few static assets sit alongside it: `logo.svg` / `logo-*.png` (favicon, apple-touch-icon, PWA icons), `manifest.json` (web app manifest).

## Commands

There is no build, lint, or test tooling — this is intentional given the single-file static nature of the project.

- **Preview locally**: serve the folder with any static file server and open `index.html`, e.g. `python -m http.server 8000`.
- **Check JS syntax** (the closest thing to a "test" this project has): the inline `<script>` block can't be checked by just running `node index.html`. Extract it first:
  ```js
  const fs = require('fs');
  const html = fs.readFileSync('index.html','utf8');
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const main = matches.reduce((a,b)=> a[1].length>b[1].length?a:b); // the head also has a tiny inline theme script
  fs.writeFileSync('_chk.js', main[1]);
  ```
  then `node --check _chk.js` (delete `_chk.js` afterward).
- **UI verification**: no test suite exists; verification has been done ad hoc with Playwright (`npm install playwright --no-save` followed by a throwaway script), since the browsers are already cached locally. Clean up `node_modules`/`package.json`/the script afterward — none of that is meant to be committed.
- **Deploy**: pushing to `master` on GitHub (`ptkdaherr/lista-compras-patrick`) auto-deploys to Vercel production via its Git integration. `vercel ls` / `vercel project inspect lista-compras-deploy` (CLI already authenticated) can be used to check deployment status directly.

## Architecture

### Single-file layout
`index.html` is organized as `<style>` (all CSS, using CSS variables under `:root` for theming) → body markup (sidebar nav, header, one `<div id="view-*">` per tab, several `<div class="bottom-sheet">` modals) → one big inline `<script>` at the end. The script itself is internally divided by `/* ── SECTION ── */` comments (MINHAS LISTAS, LER QR DA NOTA FISCAL, SIDEBAR, SAVE MODAL, COMPARTILHAR, TEMA, LISTA, CATÁLOGO, HISTÓRICO, MÉTRICAS, INIT). There's also a tiny separate `<script>` at the very top of `<head>` that applies the saved theme before first paint (avoids a flash of the wrong theme).

### Persistence — everything is `localStorage`, no backend
There is no server and no database. State lives entirely in the browser under these keys:
- `patrick-lista-lists-v1` (`LISTS_KEY`) — array of `{id, name, items}`, one entry per user-created list ("Minha lista", "Churrasco", etc).
- `patrick-lista-active-v1` (`ACTIVE_LIST_KEY`) — id of the currently active list.
- `patrick-lista-hist-v1` (`HISTORY_KEY`) — array of past "sessões" (finished purchases), each `{id, name, date, items, total}`.
- `patrick-catalog-overrides-v1` (`CATALOG_OVERRIDES_KEY`) — user edits (renames/price changes) to static catalog entries, merged onto `CATALOG` at load via `loadCatalogOverrides()`.
- `patrick-lista-v5` (`STORAGE_KEY`) — legacy single-list key from before multi-list support; `loadLists()` migrates it into `LISTS_KEY` once on first load for returning users, then it's unused.
- `theme-pref` — `"light"` or `"dark"`.

### The `items` / `lists` duality (read this before touching list data)
`items` is a **global array that mirrors only the active list's items** — it's what the "Lista de Compras" tab (`render()`, `toggleItem`, `changeQty`, `removeItem`, etc.) reads and writes, and `save()` copies it back onto `lists.find(l => l.id===activeListId).items`. The "Minhas Listas" tab, however, can add/remove/adjust items on **any** list, including ones that aren't active (e.g. searching the catalog and adding to "Churrasco" while "Minha lista" is active). Those code paths (`addItemToList`, `changeQtyInList`, `removeItemFromList`, `importItemsToActive`) mutate `lists` directly and only resync the global `items` mirror when `listId === activeListId`. If you add a new way to mutate a list's items, follow this same pattern — don't assume `items` is the source of truth for all lists, only for the active one.

### Categories are a closed enum
`CATEGORIES` (near the top of the script) is the fixed list of valid category strings (each prefixed with an emoji, e.g. `"🥩 Carnes / Aves"`). Every item's `cat` field must match one of these **exactly** — `render()` and `renderCatalogo()` both iterate `CATEGORIES` and filter items by strict equality, so an item with any other `cat` value (typos, a stale value, `null`) silently never renders anywhere in the Lista/Catálogo views. When creating items programmatically, default to `CATEGORIES[0]` rather than leaving `cat` unset. (`manualListItems`, used only by the "Adicionar lista anterior" históricos flow, deliberately uses a non-matching `cat:"🛒 Outros"` — that's fine there because histórico entries are rendered as a flat list, not grouped by category.)

### `CATALOG` vs `DEFAULTS`
`CATALOG` (~370+ entries, grouped by category in source order) backs the "Catálogo" browse/quick-add tab and the search inside "Minhas Listas". `DEFAULTS` is **dead code** — it was an earlier seed list for first-time users and is no longer referenced anywhere; new lists simply start empty (`loadLists()` creates `{id, name:"Minha lista", items: oldItems}` from any pre-existing single-list data, otherwise empty).

### View switching
`switchView(view)` toggles the `.active` class between the `<div id="view-lista|listas|catalogo|historico|metricas">` elements and the matching sidebar `.nav-item`, updates the header title/subtitle, shows/hides the lista-only chrome (search bar, filter pills, save/share buttons), and calls that view's render function on demand (`render`, `renderListasView`, `renderCatalogo`, `renderHistorico`, `renderMetricas` — each is idempotent and safe to call repeatedly). Forms/dialogs that aren't full tabs use the `.bottom-sheet` modal pattern (`.open` class toggles visibility) instead of a view.

### Search-while-typing pattern
Where a search input needs to filter results without losing focus/cursor position on every keystroke (catalog search inside "Minhas Listas", the main item search), the `oninput` handler updates a narrower results container (e.g. `#lc-results`) rather than re-rendering the whole view. Full re-renders (e.g. after creating/renaming/deleting a list) are fine on discrete actions (clicks, blur) but would steal focus if triggered from an `oninput` handler.

### Inline event handlers and string embedding
Almost all interactivity is wired via inline `onclick`/`oninput` attributes generated inside template literals (no event delegation, no framework). When an item's *id* needs to reach a handler, prefer embedding the bare numeric id unquoted (e.g. `removeItem(${item.id})`) or, for anything containing arbitrary text (product names, list names), pass an **array index** instead of interpolating the string into the attribute (see `addCatalogMatchToList(idx)` + the module-level `lcLastMatches` array) — interpolating `JSON.stringify()`'d text directly into a double-quoted `onclick="..."` attribute breaks as soon as the text itself contains a `"`.

### Theming
Dark mode is a second set of CSS custom properties under `[data-theme="dark"]` (same variable names as `:root`), toggled by setting `data-theme` on `<html>` and persisted to `theme-pref`. The early head script reads that value before the rest of the page loads to avoid a flash of the light theme.

### Nota fiscal (NFC-e) QR reading
The "Histórico" tab can scan a grocery receipt's QR code (camera + `jsQR`, loaded from a CDN on first use, never bundled) and open the decoded Sefaz link directly in a new tab. There is **no server-side parsing of the receipt**, and this is a deliberate, tested decision: Rio de Janeiro's Sefaz (`consultadfe.fazenda.rj.gov.br`) blocks requests from datacenter/cloud IP ranges as anti-fraud policy, which was confirmed to also block Vercel's own serverless functions when this was actually tried (see git history for `api/nfce-rj.js`, since removed). Don't re-attempt a serverless proxy/parser for this without a different network path — it's a known dead end, not an unexplored idea.
