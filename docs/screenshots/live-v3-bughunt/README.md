# Live V3 Adversarial Bughunt Evidence

- Target URL: `https://h-town.duckdns.org/gridplay/v3/`
- Run mode: Playwright Chromium (`headless: true`)
- Script: `docs/live-v3-bughunt.mjs`

## Confirmed Defects

1. **Global mute does not mute iframe-based tiles**
   - Repro: Add one YouTube tile and one direct HTML5 tile, then toggle `Global Mute` ON.
   - Observed: HTML5 tiles mute, but iframe tile source does not receive mute parameter behavior.
   - Expected: Global mute should apply to all playable tiles (or clearly communicate HTML5-only scope).
   - Screenshot: `./2026-04-09T15-34-52-432Z-global-mute-mixed-tiles.png`

2. **Playlist Editor context handling breaks in edge cases**
   - Repro: Open Playlist Editor with no slot selected, then open for a selected slot, remove that slot, and edit queue; also clear queue while global playlist is active.
   - Observed: Context and warning behavior becomes inconsistent across no-selection, removed-slot, and global-clear transitions.
   - Expected: Warnings and editor context should remain valid through all state transitions.
   - Screenshot: `./2026-04-09T15-35-02-001Z-playlist-editor-edge-cases.png`

3. **Dead media retry/skip handling is unstable**
   - Repro: Select a tile, queue a dead direct media URL followed by a valid URL, and observe retry behavior for about 40 seconds.
   - Observed: Progression to the valid item is unreliable and notification volume may spike.
   - Expected: Player should reliably skip failed media and advance without notification spam.
   - Screenshot: `./2026-04-09T15-35-46-420Z-dead-media-retry-path.png`
