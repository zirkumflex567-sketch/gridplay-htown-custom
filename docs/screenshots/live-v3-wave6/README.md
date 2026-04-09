# Live v3 Smoke Screenshot Run (wave6)

- timestamp_start: 2026-04-09T14:53:11.950Z
- timestamp_end: 2026-04-09T14:53:19.151Z
- commands_used: npm init -y && npm i -D playwright; node docs/screenshots/live-v3-wave6/capture-live-v3-wave6.mjs
- mode: headful
- mode_note: headful launch succeeded
- test_urls: https://h-town.duckdns.org/gridplay/v3/

## Screenshot Step Notes
- 01-home.png: PASS - Loaded target URL and captured screenshot.
- 02-import-module.png: PASS - clicked Import/Extract via candidate
- 03-global-playlist-module.png: PASS - clicked Global Playlist module via candidate
- 04-tile-menu-open.png: PASS - filled #urlInput with direct mp4 URL; clicked Add button (addFromInputSmart); opened tile radial menu via .tile-menu-main click

## Output Files
- 01-home.png
- 02-import-module.png
- 03-global-playlist-module.png
- 04-tile-menu-open.png
