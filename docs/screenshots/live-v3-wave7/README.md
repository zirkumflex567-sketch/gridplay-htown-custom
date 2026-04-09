# Live V3 Wave 7 Evidence Run

- **Test URL:** `https://h-town.duckdns.org/gridplay/v3/`
- **Execution time (UTC):** 2026-04-09T15:15:08.104Z -> 2026-04-09T15:15:16.112Z
- **Primary mode:** BrowserUse availability checked and smoke-open attempted
- **Automation mode used for evidence-grade pass:** Playwright Chromium (`headless: true`, context `recordVideo` enabled)

## Commands Used

```bash
browser-use --json --session wave7 open https://h-town.duckdns.org/gridplay/v3/
browser-use --json --session wave7 close
node docs/screenshots/live-v3-wave7/run-live-v3-wave7.mjs
```

## Environment Notes

- Host workspace: `C:\gridplay-htown-custom`
- Platform: `win32`
- BrowserUse CLI was available at runtime (`browser-use.exe` present).
- Fallback to Playwright was used for deterministic assertions + machine-readable report + recorded session video artifact.

## Result

- **Assertions:** 8
- **Passed:** 8
- **Failed:** 0
- Detailed assertion data and timestamps: `docs/screenshots/live-v3-wave7/test-results.json`

## Artifacts

- `docs/screenshots/live-v3-wave7/01-home.png`
- `docs/screenshots/live-v3-wave7/02-two-tiles.png`
- `docs/screenshots/live-v3-wave7/03-radial-menu-open.png`
- `docs/screenshots/live-v3-wave7/04-import-module-open.png`
- `docs/screenshots/live-v3-wave7/05-fullscreen-state.png`
- `docs/screenshots/live-v3-wave7/session-video.webm`
- `docs/screenshots/live-v3-wave7/test-results.json`
- `docs/screenshots/live-v3-wave7/run-live-v3-wave7.mjs`
