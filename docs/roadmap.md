# Roadmap

Ideas and planned features, roughly ordered by scope.

## Play Mode

- [x] Play ▶ button on each song card for non-interactive preview
- [x] Waterfall scrolls, keyboard lights up, audio plays via Web Audio API
- [x] Simplified controls bar (no scoring, no mode toggle)
- [x] Auto-returns to song list after playback finishes

## Improve Modes

- [x] Countdown or wait-for-first-keypress before playback starts (performance mode)
- [x] Restart should preserve speed config
- [x] Define naming: renamed to "Practice" / "Performance"
- [x] Mode + config (speed, start behavior) stored globally per session

## Progression Tracking

- [x] Separate best score and stars per mode (Practice / Performance)
- [x] Backward-compatible migration from old flat format
- [x] Song cards show per-mode star rows (P / F)
- [x] Recommendation logic considers both modes

## Review Metrics

Better feedback on how well the player performed.

- [x] Timing accuracy — measure how precisely the player hits note start/end times
- [x] Visualize timing on keys (accuracy-based color: green/yellow/orange-red)
- [x] Waterfall timing markers showing press/release offset
- [x] Accuracy % on completion screen
- [x] Persist best accuracy per mode in progress

## Web MIDI API Support

The app currently requires the backend to have direct access to the MIDI device.
Adding Web MIDI API support lets the browser read the local MIDI device directly,
so the app can be served from any remote host.

- [ ] Add Web MIDI API input source (`navigator.requestMIDIAccess()`)
- [ ] Device picker UI: list available MIDI inputs, let user select
- [ ] Connection status indicator distinguishes Web MIDI vs WebSocket
- [ ] Keep existing WebSocket/backend MIDI path as fallback (local server, Firefox)
- [ ] Auto-detect: prefer Web MIDI when available, fall back to WebSocket

## Song Discovery

The core idea: any song, from any source, playable in the app. Users can find
MIDI files online, generate them from audio (via tools like Spotify Basic Pitch),
or export from a DAW — then import into the app and play.

### Phase 1 — MIDI Import

- [ ] Upload a `.mid` file from the song list
- [ ] Backend parses MIDI: extracts tracks, notes, tempo, time signature
- [ ] Full-screen import editor: pick tracks, assign hands, set metadata
- [ ] Four hand-assignment strategies: by track, by pitch split, all right, all left
- [ ] Live waterfall preview during import editing
- [ ] Save imported songs to `data/songs/` as standard JSON
- [ ] Imported songs appear in song list with "Imported" badge
- [ ] Delete and re-edit imported songs

### Phase 2 — Audio-to-MIDI (future)

- [ ] Integrate `@spotify/basic-pitch` (TypeScript, runs in browser)
- [ ] "Import from Audio" button: drop MP3/WAV, transcribe to MIDI in-browser
- [ ] Feeds into the same import editor pipeline from Phase 1
- [ ] Explore YouTube URL support (download + transcribe)
