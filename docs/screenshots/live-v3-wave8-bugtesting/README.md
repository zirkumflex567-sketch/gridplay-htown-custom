# Live V3 Wave 8 Bugtesting (Post-Fix)

- **Target URL:** `https://h-town.duckdns.org/gridplay/v3/`
- **Run timestamp (UTC):** `2026-04-09T18:22:49Z` to `2026-04-09T18:23:22Z`
- **Environment:** Windows (`C:\gridplay-htown-custom`), Node + Playwright Chromium
- **Deterministic result:** **6/6 assertions passed**

## Commands Run

1. BrowserUse availability + open/close smoke

```bash
browser-use --help
browser-use --session wave8-bugtest open "https://h-town.duckdns.org/gridplay/v3/" && browser-use --session wave8-bugtest close
```

- Result: CLI available, URL opened (`url: https://h-town.duckdns.org/gridplay/v3/`), session closed (`Browser closed`).

2. Deterministic Playwright bugtesting

```bash
node "docs/screenshots/live-v3-wave8-bugtesting/run-live-v3-wave8-bugtesting.mjs"
```

- Result: `wave8-live-bugtesting totals: 6/6 passed, 0 failed`

## Assertions Covered

- A) Core UI load + expected controls: **PASS**
- B) Mixed tiles global mute path (YouTube iframe + HTML5 MP4): **PASS**
  - iframe mute/unmute path observed via page hook on `sendIframeProviderCommand` (YouTube mute/unMute calls recorded)
  - `Global Mute: ON/OFF` labels and HTML5 `muted` state transitions validated
- C) Playlist editor stale slot context handling: **PASS**
  - slot removal clears editor context
  - queue-change stale write prevented
- D) Dead URL retry/advance behavior: **PASS**
  - dead-first global queue advanced to playable next URL within bounded window
- E) Fullscreen + module overlay sanity: **PASS**

## Artifacts

- `docs/screenshots/live-v3-wave8-bugtesting/01-core-ui.png`
- `docs/screenshots/live-v3-wave8-bugtesting/02-mixed-tiles-added.png`
- `docs/screenshots/live-v3-wave8-bugtesting/03-global-mute-on.png`
- `docs/screenshots/live-v3-wave8-bugtesting/04-global-mute-off.png`
- `docs/screenshots/live-v3-wave8-bugtesting/05-editor-stale-context.png`
- `docs/screenshots/live-v3-wave8-bugtesting/06-dead-url-advanced.png`
- `docs/screenshots/live-v3-wave8-bugtesting/07-module-overlay-open.png`
- `docs/screenshots/live-v3-wave8-bugtesting/08-fullscreen-active.png`
- `docs/screenshots/live-v3-wave8-bugtesting/session-video.webm`
- `docs/screenshots/live-v3-wave8-bugtesting/test-results.json`
- `docs/screenshots/live-v3-wave8-bugtesting/run-live-v3-wave8-bugtesting.mjs`
