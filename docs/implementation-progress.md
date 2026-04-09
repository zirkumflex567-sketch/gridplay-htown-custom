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

## Wave 5 (V2 radial tile menu MVP)

- **Timestamp:** 2026-04-09T15:50:51+02:00
- **Scope:** Add a per-tile central draggable radial action menu (HTML5 + iframe tiles) with quality/reload/next/favorite/remember actions while preserving existing remove/audio/retry/global flows.
- **Files changed:**
  - `v2/index.html`
  - `docs/implementation-progress.md`

## Verification Steps (manual)

- Add mixed tile types (direct HTML5, iframe/embed, PMVHaven resolved/error) and confirm each tile renders a center round menu button with tooltip text for Shift+Left Click move, Left Click open menu, and Right Click audio switch.
- Left-click each tile menu button to open/close radial actions and confirm outside-click closes open menu.
- Hold Shift and drag the menu button to multiple positions and confirm the button stays within tile bounds and keeps position after tile updates/resizes.
- Right-click the menu button (and tile background) to confirm browser context menu is suppressed and audio focus advances to the next HTML5 tile.
- Click quality action repeatedly to cycle low/medium/high; verify glow intensity changes, HLS tiles apply closest level selection, and non-HLS tiles show unobtrusive "saved for future HLS" hint.
- Click reload action and confirm tile source reloads through existing load/retry pipeline.
- Click next action with and without queue/global playlist to confirm queued/global advance behavior and "no queued next item" feedback.
- Click favorite and remember actions to confirm per-source toggle state reflects active/inactive and persists via localStorage across reload.

## Known Limitations

- Favorite/remember persistence is localStorage-only and keyed by current tile source URL; there is no dedupe beyond URL exact-match normalization in this MVP.
- Quality control applies directly only when `video.hls` levels are available; non-HLS media stores preference state but cannot force browser-level quality selection.
- Validation for `v2/index.html` remains manual (plus inline script syntax check) with no browser automation added in this wave.

## Wave 6 (V2 playlist editor integration)

- **Timestamp:** 2026-04-09T16:00:42+02:00
- **Scope:** Integrate the existing Playlist Editor assets into `v2/index.html`, add a topbar entry point, and wire editor queue changes back into runtime global/slot queues without rewriting playback core logic.
- **Files changed:**
  - `v2/index.html`
  - `docs/implementation-progress.md`

## Verification Steps (manual)

- Open `v2/index.html` and confirm topbar shows `Playlist Editor` next to existing controls.
- Activate `Global Playlist`, open `Playlist Editor`, reorder/add/remove links, and confirm changes update runtime global queue (new items become part of upcoming global rotation).
- With global mode OFF, select a tile that has playback/queue, open `Playlist Editor`, and confirm list includes current item first plus queued upcoming entries.
- In slot mode, reorder/add/remove and confirm first list item is applied as current tile playback and remaining entries persist as that slot queue.
- With global mode OFF and no selected tile, click `Playlist Editor` and confirm warning notification appears with no state changes.
- Run static sanity check: `node -e "const fs=require('fs'); const html=fs.readFileSync('v2/index.html','utf8'); const blocks=[...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)]; blocks.forEach(m=>new Function(m[1]));"`.

## Known Limitations

- The Playlist Editor queue callback currently applies URL-only runtime queue entries (`durationSeconds` metadata is not preserved through editor round-trips).
- Global editor view reflects the runtime global rotation queue order from `globalPlaylistIndex`; currently playing tiles are not individually represented because global mode is multi-slot.

## Frontend Track Note

- **Timestamp:** 2026-04-09T16:06:22+02:00
- Active frontend iteration is now isolated in `v3/` (copied from post-wave `v2/index.html` plus editor assets) while `v2/index.html` is restored to baseline from `f07b932b85e7526742111bcc944e4453bf57f313` to keep the live v2 link stable.

## Live Smoke Evidence (V3 Wave 6)

- **Timestamp:** 2026-04-09T16:54:39+02:00
- Ran live V3 smoke walkthrough covering home load, import module flow, global playlist module view, and radial tile menu open state.
- Screenshot artifacts:
  - `docs/screenshots/live-v3-wave6/01-home.png`
  - `docs/screenshots/live-v3-wave6/02-import-module.png`
  - `docs/screenshots/live-v3-wave6/03-global-playlist-module.png`
  - `docs/screenshots/live-v3-wave6/04-tile-menu-open.png`
  - `docs/screenshots/live-v3-wave6/README.md`

## Backend Admin Log Wave (video error inspection)

- **Timestamp:** 2026-04-09T16:56:39+02:00
- **Scope:** Added backend video error log inspection endpoints by exposing JSON list retrieval (`GET /video-errors`) and an admin HTML table view (`GET /admin/logs`) backed by the same JSONL telemetry file used by `POST /video-errors`.
- **Notes:** Missing log files now return empty results, malformed JSONL lines are skipped safely, and list retrieval supports clamped `limit` query handling for recent-entry inspection.
