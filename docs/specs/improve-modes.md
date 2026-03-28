# Spec: Improve Modes

## Problem

The current mode system has several UX issues:

1. **Restart resets tempo.** When a user clicks Restart (or Retry from the completion screen), `_playSong()` resets the tempo slider to 100%. Users who slowed a song down to practice lose their setting.

2. **Performance mode starts immediately.** Toggling wait mode off starts the song scrolling with no warning. The player has no time to prepare, and the first notes are missed.

3. **Naming is unclear.** "Wait Mode: ON/OFF" doesn't communicate what the modes actually do. "Practice" (waits for correct input) and "Performance" (real-time playback) are clearer.

4. **Settings are per-interaction, not global.** Mode and tempo reset every time a song is loaded. Users who prefer Performance mode at 75% tempo must reconfigure on every song.

## Requirements

### 1. Rename modes: Practice / Performance

- Replace "Wait Mode: ON" → "Practice" and "Wait Mode: OFF" → "Performance" everywhere in the UI.
- The toggle button in the controls bar reflects the current mode name.
- Rename internal variables from `waitMode: boolean` to `mode: "practice" | "performance"` across the full stack:
  - Frontend: `game.js` (`GameEngine.waitMode` → `GameEngine.mode`), `app.js` (toggle logic)
  - Backend: `internal/game/engine.go` (`WaitMode bool` → `Mode string`), plus tests
- All conditionals change from `if (waitMode)` / `if !e.WaitMode` to `if (mode === 'practice')` / `if e.Mode == "performance"` etc.

### 2. Restart preserves speed config

- When the user clicks **Restart** or **Retry** (completion screen), the current tempo percentage is preserved.
- The tempo slider and label reflect the preserved value (not reset to 100%).
- Loading a *different* song uses the global tempo setting (see requirement 4).

### 3. Performance mode start behavior

Two options, selectable in global settings:

- **Countdown** (default): A full-screen overlay displays "3… 2… 1… Go!" over the waterfall, one number per second. Playback begins after "Go!" fades. The overlay is semi-transparent so the player can see the upcoming notes behind it.
- **First keypress**: The waterfall is visible and scrolled to the start, but time is frozen. Playback begins on the first MIDI note-on event.

In Practice mode, start behavior is unchanged (the waterfall scrolls to the first note and waits for input).

### 4. Global session config

A settings object held in memory (not persisted to backend) stores:

```
{
  mode: "practice" | "performance",
  tempoPercent: 25–150 (default 100),
  performanceStart: "countdown" | "first-keypress" (default "countdown")
}
```

- When a song is loaded, these values are applied instead of hardcoded defaults.
- Changing mode or tempo during play updates the global config immediately.
- Refreshing the page resets to defaults (Practice, 100%, countdown).

### 5. Settings UI on song list page

- A **gear icon** (⚙) in the top-right of the song list header.
- Clicking it opens a **settings panel** (inline or overlay) with:
  - **Mode**: toggle or segmented control — Practice / Performance
  - **Tempo**: slider 25%–150%, showing current value
  - **Performance start**: radio or segmented — Countdown / First keypress (only visible when mode is Performance)
- Changes take effect immediately (no save button needed).
- The panel can be dismissed by clicking the gear icon again or clicking outside.

## Acceptance Criteria

- [ ] Controls bar shows "Practice" or "Performance" instead of "Wait Mode: ON/OFF".
- [ ] Clicking Restart or Retry keeps the current tempo slider position.
- [ ] In Performance mode with countdown: a "3… 2… 1… Go!" overlay appears before playback starts.
- [ ] In Performance mode with first-keypress: playback is frozen until the first MIDI note-on.
- [ ] Song list page has a gear icon that opens a settings panel.
- [ ] Settings panel allows changing mode, tempo, and performance start behavior.
- [ ] Loading any song applies the global config (mode, tempo, start behavior).
- [ ] Changing mode/tempo during play updates the global config for subsequent songs.
- [ ] Page refresh resets all settings to defaults.
- [ ] Existing game logic (note matching, scoring, completion) is unaffected.

## Implementation Plan

### Step 1: Global config object

Create `public/js/config.js` exporting a `Config` class that holds `mode`, `tempoPercent`, and `performanceStart` with defaults. Import it in `app.js` and pass it through to where settings are read.

### Step 2: Rename modes everywhere

- Rename `GameEngine.waitMode` (bool) → `GameEngine.mode` (string: `"practice"` / `"performance"`) in `public/js/game.js`. Update all conditionals.
- Rename `Engine.WaitMode` (bool) → `Engine.Mode` (string) in `internal/game/engine.go`. Update all conditionals and tests in `engine_test.go`.
- Change the toggle button text in `index.html` and `app.js` from "Wait Mode: ON/OFF" to "Practice"/"Performance".
- Wire `config.mode` directly to `game.mode`.

### Step 3: Restart preserves tempo

- In `_playSong()`, remove the lines that reset `tempoSlider.value = 100` and the label to "100%".
- Instead, read `config.tempoPercent` and apply it to the slider and game tempo.
- When the tempo slider changes, update `config.tempoPercent`.

### Step 4: Performance mode start behavior — first keypress

- Add a `waitingForFirstKey` state to the game engine (or app-level).
- When mode is Performance and start behavior is "first-keypress": after `game.start()`, set `waitingForFirstKey = true`. The `update()` loop skips time advancement while this flag is set.
- On the first `noteOn` event, clear the flag and set `lastFrameTime = now` so time starts from that moment.

### Step 5: Performance mode start behavior — countdown

- Create a countdown overlay element (reuse the `#completion-overlay` pattern).
- When mode is Performance and start behavior is "countdown": show the overlay with "3", wait 1s, "2", wait 1s, "1", wait 1s, "Go!", wait 0.5s, hide overlay, then call `game.start()`.
- Style: large centered text, semi-transparent dark background (like completion overlay).

### Step 6: Settings panel on song list page

- Add a gear icon button to the song list header in `songs.js` (or `app.js`).
- Create a settings panel component (can be a simple DOM-built panel, matching existing patterns).
- Wire the panel controls to `config` — mode toggle, tempo slider, start behavior selector.
- Show/hide the performance-start option based on current mode.
- Add CSS for the settings panel and gear icon.

### Step 7: Wire global config to song loading

- In `_playSong()`, read `config.mode` and `config.tempoPercent` to set `game.waitMode` and tempo.
- Update the controls bar UI (mode button, tempo slider) to reflect config values.
- When mode or tempo is changed via the controls bar during play, write back to `config`.

### Step 8: Update roadmap

- Check off completed items in `docs/roadmap.md`.
