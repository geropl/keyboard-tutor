# Spec: Review Metrics

## Problem

The only feedback a player receives after completing a song is a hit/miss count and a score percentage based on whether the correct keys were pressed. There is no information about *when* keys were pressed or released relative to the expected timing. A player who hits every note but consistently releases too early or presses too late has no way to know.

Timing accuracy is a core piano skill. Without measuring it, the app can't distinguish a rhythmically precise performance from a sloppy one that happens to hit the right keys.

## Requirements

### 1. Timing measurement

Track two timing deltas per note:

- **Note-on delta**: the difference (in ms) between when the player presses the key and when the note's beat position occurs. Positive = late, negative = early.
- **Note-off delta**: the difference (in ms) between when the player releases the key and when the note's expected end time occurs (start + duration, converted to ms via tempo). Positive = released late, negative = released early.

Mode-specific behavior:
- **Performance mode**: both note-on and note-off deltas are measured.
- **Practice mode**: note-on delta is always 0 (the game waits for input, so the press is definitionally on-time). Note-off delta is measured normally — the player is still responsible for holding the note for the correct duration.

For chords (multiple notes at the same beat), each note in the chord gets its own timing entry.

### 2. Accuracy calculation

Convert per-note timing deltas into a single **accuracy percentage (0–100%)**.

Each timing measurement (note-on or note-off) produces a per-event accuracy using an exponential decay function:

```
eventAccuracy = 100 * e^(-|deltaMs| / τ)
```

Where `τ` (tau) is a decay constant that controls how forgiving the window is. A value of **150ms** means:
- 0ms offset → 100%
- 50ms offset → ~72%
- 100ms offset → ~51%
- 150ms offset → ~37%
- 300ms offset → ~14%

The overall accuracy is the **average of all event accuracies** across all measured note-on and note-off events, weighted equally.

In Practice mode, note-on events contribute 100% each (delta is 0), so accuracy reflects only release precision.

### 3. Real-time visual feedback on keyboard keys

When a note is hit, the key color reflects timing quality instead of the current uniform hit color:

| Accuracy | Color |
|---|---|
| ≥ 90% | Green (`#4CAF50`, same as current `correct`) |
| ≥ 60% | Yellow/amber (`#FFC107`) |
| < 60% | Orange-red (`#FF5722`) |

The color applies to the key's pressed state and fades on release as it does today.

On note-off, the same logic applies: the key briefly flashes the release-accuracy color (using the existing `flash()` mechanism, ~300ms).

### 4. Real-time visual feedback on waterfall

After a note is hit, its waterfall block gets a small **timing marker** — a thin horizontal line drawn at the vertical position corresponding to the actual press time relative to the note's expected start:

- If the press was perfectly on time, the marker sits at the bottom edge of the block (the hit line).
- If early, the marker is slightly below the block's bottom edge.
- If late, the marker is slightly above the block's bottom edge.

The marker color matches the accuracy color from the keyboard (green/yellow/orange-red).

On note-off, a second marker appears at the top region of the block showing release timing accuracy using the same offset logic relative to the note's expected end time.

Markers are only drawn on notes that have been hit (not on missed notes in Performance mode).

### 5. Completion screen

The completion screen adds a single **Accuracy** line below the existing score:

```
Song Complete!
Ode to Joy
★★★
100%
42 / 42 notes hit
Accuracy: 87%
```

The accuracy value is the overall accuracy percentage from requirement 2.

No per-note breakdown, charts, or additional UI — just the single number.

### 6. Persist accuracy in progress

Accuracy is saved alongside score and stars in the progress file, per mode:

```json
{
  "songs": {
    "ode-to-joy": {
      "practice": { "bestScore": 100, "stars": 3, "accuracy": 92, "completedAt": "..." },
      "performance": { "bestScore": 95, "stars": 3, "accuracy": 78, "completedAt": "..." }
    }
  }
}
```

- `accuracy` is an integer (0–100), stored only when the song is completed.
- Like `bestScore`, only the best (highest) accuracy value is kept per mode.
- The song card on the song list does **not** display accuracy — it remains score/stars only. Accuracy is shown only on the completion screen.

### 7. Backend changes

- `CompletionResult` gains an `Accuracy` field (int, 0–100).
- `progress.ModeProgress` gains an `Accuracy` field.
- `progress.Save()` accepts accuracy and stores the best value.
- The `saveProgress` WebSocket message includes an `accuracy` field.
- The `/api/progress` response includes accuracy in each mode's progress entry.

## Acceptance Criteria

- [ ] In Performance mode, note-on and note-off timing deltas are measured for every note.
- [ ] In Practice mode, note-on delta is 0; note-off delta is measured.
- [ ] Per-note accuracy uses exponential decay with τ=150ms.
- [ ] Overall accuracy is the average of all event accuracies.
- [ ] Keyboard keys flash green/yellow/orange-red based on note-on accuracy.
- [ ] Keyboard keys flash release-accuracy color on note-off.
- [ ] Waterfall blocks show timing markers for press and release.
- [ ] Completion screen shows a single "Accuracy: N%" line.
- [ ] Accuracy is persisted per mode, best-value-only, in the progress file.
- [ ] `saveProgress` message includes accuracy; backend stores it.
- [ ] Backward-compatible: old progress files without accuracy load without error.
- [ ] Existing score/stars logic is unaffected.
- [ ] All new backend logic has tests.

## Implementation Plan

### Step 1: Timing data structures (backend + frontend)

**Backend** (`internal/game/engine.go`):
- Add a `TimingEntry` struct: `{ NoteNum int, Hand string, OnDeltaMs float64, OffDeltaMs *float64 }`.
- Add a `TimingLog []TimingEntry` field to `Engine`.
- Add an `Accuracy` field (int) to `CompletionResult`.
- Add a helper `computeAccuracy(entries []TimingEntry) int` implementing the exponential decay formula.

**Frontend** (`public/js/game.js`):
- Mirror the same structure: `timingLog` array on `GameEngine`, each entry `{ note, hand, onDeltaMs, offDeltaMs }`.
- Add `getAccuracy()` method.

### Step 2: Record note-on timing

**Backend** (`internal/game/engine.go`):
- In `NoteOn()`, when a match is found, compute `onDeltaMs` = difference between current time and the note's expected beat time (converted to ms via tempo). In Practice mode, set `onDeltaMs = 0`.
- Append a `TimingEntry` with `OffDeltaMs = nil` (not yet released).
- The engine needs to know the current wall-clock time during `NoteOn`. Add a `nowMs float64` parameter to `NoteOn()`, or track it via `Update()`.

**Frontend** (`public/js/game.js`):
- Same logic. `noteOn()` already receives the MIDI event; use `performance.now()` and the note's expected time (beat → ms conversion) to compute `onDeltaMs`.

### Step 3: Record note-off timing

**Backend**:
- Add a `NoteOffTiming(midiNote int, nowMs float64)` method (or extend `NoteOff`).
- Find the most recent `TimingEntry` for this note where `OffDeltaMs` is nil.
- Compute `offDeltaMs` = current time minus the note's expected end time (start + duration, in ms).
- Store it.

**Frontend**:
- Same logic in `noteOff()`. Look up the timing entry, compute release delta.

### Step 4: Accuracy calculation

- Implement `computeAccuracy()` in both backend and frontend:
  - For each timing entry, compute `onAccuracy = 100 * exp(-|onDeltaMs| / 150)`.
  - For each timing entry with a recorded off delta, compute `offAccuracy = 100 * exp(-|offDeltaMs| / 150)`.
  - Average all event accuracies.
- In `completeSong()`, compute accuracy and include it in `CompletionResult`.

### Step 5: Keyboard visual feedback

In `app.js` `_onNoteOn()`:
- After calling `game.noteOn()`, retrieve the timing entry for this note.
- Compute per-event accuracy from `onDeltaMs`.
- Choose color: ≥90% → green, ≥60% → yellow, <60% → orange-red.
- Pass this color to `keyboard.pressKey()` instead of the current uniform `COLORS.correct`.

In `_onNoteOff()`:
- Retrieve the timing entry, compute release accuracy.
- Call `keyboard.flash(note, releaseColor, 300)`.

Add the two new colors to `COLORS` in `utils.js`: `timingGood: '#FFC107'`, `timingPoor: '#FF5722'`.

### Step 6: Waterfall timing markers

In `waterfall.js` `draw()`:
- Accept a `timingLog` parameter (or read it from the game engine reference).
- For each hit note that has a timing entry, draw a thin horizontal line at the y-position corresponding to the actual press time offset from the note's start beat.
- Use the accuracy-based color (green/yellow/orange-red).
- For notes with a recorded off delta, draw a second marker near the top of the block.
- Markers are 2px tall, full note-block width, drawn on top of the note block.

### Step 7: Completion screen update

In `progress.js` `CompletionScreen.show()`:
- Add an "Accuracy: N%" line in the `completion-details` div, below the existing hit/miss text.
- Read `result.accuracy`.

### Step 8: Persist accuracy in progress

**Backend** (`internal/progress/progress.go`):
- Add `Accuracy int` field to `ModeProgress`.
- In `Save()`, accept an `accuracy` parameter. Store `max(existing, new)`.
- Old files without `accuracy` deserialize with zero value — no migration needed.

**WebSocket** (`internal/server/websocket.go`):
- Add `Accuracy int` to the incoming message struct.
- Pass it to `progress.Save()`.

**Frontend** (`app.js`):
- In `_onSongComplete()`, include `accuracy: result.accuracy` in the saveProgress message.

### Step 9: Backend tests

- `engine_test.go`: test that `TimingLog` is populated on note-on and note-off, test accuracy computation with known deltas.
- `progress_test.go`: test that accuracy is saved, best-value logic works, old format without accuracy loads cleanly.
- `handlers_test.go` / `websocket_test.go`: test that accuracy flows through the save message.

### Step 10: Frontend wiring and render loop

- Pass `game.timingLog` to `waterfall.draw()` in the render loop.
- Ensure timing markers don't render during preview (play) mode.

### Step 11: Update roadmap

Mark the "Review Metrics" items as completed in `docs/roadmap.md`.
