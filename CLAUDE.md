# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SynapseLog — a client-side web app that visualizes Notion pages and Markdown files as a force-directed "neural" graph on an HTML canvas, with Google Gemini AI features (summarize / suggest links / refine / import / chat + RAG). No framework, no bundler, no build step: plain HTML/CSS/JS served statically, plus two Vercel serverless functions used as proxies.

## Running & deploying

- **No build, no tests, no linter.** There is no `package.json`. Do not look for `npm run` scripts.
- The client calls the serverless functions at relative paths `/api/notion` and `/api/extract`, so the API only works when static files and `api/` are served from the **same origin**.
  - Full local run (Notion + web/YouTube import work): `vercel dev` (serves `index.html` and the `api/*` functions together).
  - UI-only local run: any static server (e.g. `python -m http.server`) renders the app, but every `/api/*` call 404s — Notion loading and `/Import` will fail.
- Deployment target is **Vercel** (`vercel.json` configures `api/notion.js`). `.nojekyll` exists for GitHub Pages, but Pages cannot run the `/api` functions.
- **Cache-busting:** `index.html` loads each script/style with a `?v=YYYYMMDD…` query. When you change a JS/CSS file that ships, bump the `?v=` token so clients don't serve stale assets.

## Architecture

### Global-scope "module" pattern (important)

`js/*.js` files use **no ES imports/exports**. `index.html` loads them with `defer` in a **fixed order** (utils → icons → sample → graph → notion-client → export → ui-core → ui-legend → ui-ai → ui-embed → ui-rail → ui-panel → ui-events). All top-level `let`/`const`/`function` declarations live in one shared global scope, so any file can reference another's globals directly (`nodes`, `edges`, `nodeMap`, `CONFIG`, `_stack`, `_savedToken`, `_useLocalStorage`, …). Consequences:

- Adding a file means adding a `<script>` tag in the correct position in `index.html`.
- Code frequently guards cross-file calls with `typeof fn === 'function'` because load order / availability isn't guaranteed at call-definition time.
- There is no dependency graph beyond this ordering — grep for a symbol to find its owner.

### Data flow: source → graph

1. A Notion page (via `/api/notion`) or a `.md` file is turned into **Markdown text** (`window._NOTION_MARKDOWN` / `_NOTION_TITLE`).
2. `parseMarkdown(text, rootTitle)` in `js/graph.js` converts Markdown into `nodes`/`edges`/`nodeMap` — the page/heading hierarchy becomes the graph tree; `[text](url)` wiki-links become extra edges.
3. `buildGraph()` (first/replace) or `mergeGraph()` (add a page to the existing graph) assembles the live arrays. Incremental Notion re-sync goes through `syncPageIncremental()`.

### Render loop & physics

`js/graph.js` owns the canvas and simulation. `loop()` (in `js/ui-events.js`) runs `simulate()` + `draw()` every `requestAnimationFrame`. `simulate()` is a force-directed layout (repulsion / gravity-to-center / link tension) driven by the `CONFIG` object (adjustable from the graph-settings rail). `fitGraph()` animates pan/zoom to frame the graph.

### Node identity — never persist by `node.id`

`node.id` is regenerated on every reload/sync, so it is **not stable across sessions**. Anything persisted or matched across reloads must use a stable key: `_stableNodeKey(n)` = `` `${sourcePageId}::${label}` `` (see dismissed-pairs, node-view counts, embeddings, bookmarks). Using raw ids for persistence is a bug.

### Notion access

`js/notion-client.js` never talks to Notion directly (browser CORS + secret handling). It POSTs `{ token, pageId, action }` to `/api/notion` (`api/notion.js`), which calls the Notion REST API server-side. `api/notion.js` also converts Markdown ↔ Notion `rich_text` for writes (bold/italic/strike/code/links). After any write, **invalidate caches via `invalidateNodeCache(node)`** rather than editing cache structures by hand.

### AI

`js/ui-ai.js` (+ `js/ui-embed.js` for embedding/RAG) call Google Gemini **directly from the browser** using the user-supplied key (`_savedAiKey`). Models: `gemini-2.5-flash` (generation), `gemini-embedding-001` (semantic title search). Only the user's selection/search scope is sent — keep AI payloads minimal. Common shared helpers: `_aiRun` (progress→work→retry-on-error shell), `requireAiKey`, `openAiChat`, `geminiGenerate`.

`api/extract.js` scrapes a web page's main text or a YouTube video's captions and returns Markdown — used by the `/Import` AI command to create temporary nodes.

### Storage

`js/ui-core.js` provides `snGet/snSet/snRemove(key, scope)`. `getStorage(scope)` routes to `localStorage` only when the user enabled "로컬 저장" **and** that scope is on (`_storageScopes`, e.g. `pages`/`slider`/`connect`/`search`); otherwise `sessionStorage`. Tokens/keys are obfuscated with `_encKey`/`_decKey` in `js/utils.js` — this is XOR obfuscation to hide plaintext from casual `F12`, **not** real encryption.

### UI layer

- `js/ui-rail.js` — left activity rail and its fly-out sections (pages, search, bookmarks/insights, graph settings, AI chat). Insights (hubs / link suggestions) are pure graph/keyword computation, no AI tokens.
- `js/ui-panel.js` — right detail panel: a stack of up to 2 node panes (`_stack`, FIFO). Owns pane rendering, top/bottom split ratio drag (`_paneRatio`), swap popup, collapse/reopen.
- `js/ui-events.js` — search, keyboard/pointer input, panel resize handles, and the main `loop()`.
- `js/ui-legend.js`, `js/ui-embed.js` — legend overlay (+ the node right-click toolbar) and embedding-based RAG search.
- `js/icons.js` — every shared SVG/canvas icon (`addChildIcon`, `focusModeIcon`, `logoIcon`, `icSlot`, sync icons). Icons used in two places live here so the copies can't drift apart.
- `js/export.js` — graph → PNG export. Redraws on an offscreen canvas with the **same formulas as `draw()`** (e.g. `hubGlowSpec`); if a rule changes in one place only, the exported image silently differs.
- `js/sample.js` — `_SAMPLE_MD`, the "샘플로 둘러보기" notebook that doubles as the in-app usage guide.

## Conventions

- **Design tokens:** colors/glass/spacing are CSS variables in `style.css` `:root` (`--accent`, `--accent-rgb`, `--glass-bg`, `--glass-blur`, `--icon`, `--icon-dim`, `--text-*`). Reuse tokens; avoid hard-coded literal colors. Icon colors should be opaque (use `--icon*`), not alpha, to avoid strokes showing through overlaps.
- **In-app UI text (Korean):** concise noun-form — not 반말, not 해요체 (e.g. "전체 초기화", "검색 & 대화 기록 삭제").
- **Icons:** monochrome line/fill SVG only — no emoji, no multicolor. Match `stroke-width` across icons in the same cluster.
- Comments in the codebase are in Korean and explain *why*; match that style when editing.
