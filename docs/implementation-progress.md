# Implementation Progress

## Wave 1 (V2 playback hardening + video error telemetry)

- **Timestamp:** 2026-04-09T15:35:31+02:00
- **Scope:** Harden playback retry behavior and add API support for client video error logging with payload sanitization and validation.
- **Files changed:**
  - `gridplay-api-v2/server.js`
  - `gridplay-api/server.js`
  - `gridplay-api/video-errors.integration.test.js`
  - `v2/index.html`

## Test Evidence

- `node --test *.integration.test.js` (run in `gridplay-api`) -> **PASS**
  - `pawg mix endpoint returns playable items with source metadata`
  - `playlist endpoint returns many items and direct stream links`
  - `video-errors endpoint accepts and persists sanitized payload`
  - `video-errors endpoint rejects malformed JSON body`
- `node --check C:\gridplay-htown-custom\gridplay-api\server.js` -> **PASS**
- `node --check C:\gridplay-htown-custom\gridplay-api-v2\server.js` -> **PASS**

## Known Limitations

- `v2/index.html` client logic is covered by integration behavior indirectly; there is no dedicated browser-level automation in this wave.
- Error telemetry persists server-side via current logging approach; no external observability pipeline is wired in this wave.

## Next Wave Target

- Add browser-level regression coverage for V2 playback retry/error paths and complete telemetry forwarding/aggregation for video error events.

## Wave 2 (V2 audio policy only)

- **Timestamp:** 2026-04-09T15:38:30+02:00
- **Scope:** Enforce single-audio behavior for HTML5 tile videos, add a topbar global mute toggle, and add interim right-click audio switching without introducing radial menu interactions.
- **Files changed:**
  - `v2/index.html`
  - `docs/implementation-progress.md`

## Verification Steps (manual)

- Open `v2/index.html`, add at least three direct-play HTML5 tiles, and confirm only one tile remains unmuted while others are muted.
- Toggle `Global Mute: OFF/ON` and confirm all HTML5 tiles mute when ON, then return to single-audio mode when OFF.
- Right-click any tile and confirm browser context menu is suppressed and audio focus advances to the next available HTML5 tile.
- Replace/remove tiles (including active-audio tile) and confirm policy recovers to at most one unmuted HTML5 tile without duplicate unmuted states.
- Trigger playlist-driven slot replacement (per-tile queue or global playlist) and confirm audio policy remains enforced across updates.

## Known Limitations

- Right-click audio switching is an interim Wave 2 interaction; radial menu UX is intentionally not included in this wave.
- There is still no browser automation harness for `v2/index.html`; validation remains manual for this wave.

## Wave 3 (V2 fullscreen controls + smart add action)

- **Timestamp:** 2026-04-09T15:43:16+02:00
- **Scope:** Repurpose the top-right toggle as a fullscreen control, add fullscreen-only topbar auto-hide/reveal behavior, and merge Add Video/Add Playlist into one smart Add action while preserving existing add functions.
- **Files changed:**
  - `v2/index.html`
  - `docs/implementation-progress.md`

## Verification Steps (manual)

- Click top-right fullscreen button to enter/exit fullscreen and confirm button icon/title switch between enter/exit states.
- In fullscreen, confirm top controls auto-hide after a short delay and slide back when moving pointer to the top edge or hovering the reveal strip.
- In fullscreen, confirm controls hide again when leaving top edge/controls area.
- Outside fullscreen, confirm controls remain visible and no auto-hide behavior occurs.
- Paste one valid URL and click `Add` to confirm a single tile is added.
- Paste multiple valid URLs and click `Add` to confirm playlist queue behavior still targets selected/new tile as before.

## Known Limitations

- Fullscreen behavior depends on browser Fullscreen API support and may require user gesture on some mobile browsers.
- Validation for `v2/index.html` remains manual aside from static syntax check of extracted inline script.

## Wave 4 (V2 import flow unification)

- **Timestamp:** 2026-04-09T15:47:29+02:00
- **Scope:** Consolidate topbar import actions into one entry point and merge PMVHaven playlist extraction into the existing bulk import workflow while preserving legacy playlist module code as fallback.
- **Files changed:**
  - `v2/index.html`
  - `docs/implementation-progress.md`

## Verification Steps (manual)

- Open `v2/index.html`, click `Import / Extract`, paste one PMVHaven playlist-like URL, click `Process Input`, and confirm links are extracted via the playlist path and shown in results.
- In `Import / Extract`, paste multiple direct/page URLs (newline/space/comma separated), click `Process Input`, and confirm current identify/import behavior remains (links echoed into results).
- Click `Add All to Grid` after each path and confirm global playlist add-all behavior still starts with the configured slot limit.
- Click `Copy All Links` and confirm clipboard output matches the current results text.

## Known Limitations

- Playlist extraction in the unified flow intentionally triggers only when exactly one URL is pasted and it is PMVHaven playlist-like; mixed/multi-input batches stay on the existing identify/import path.
- Legacy `playlistModule` UI remains in code for low-risk fallback but is no longer exposed via a dedicated topbar action.
