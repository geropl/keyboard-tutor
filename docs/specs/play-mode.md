# Spec: Play Mode

## Problem

There is no way to hear or preview a song before attempting it. The app is entirely visual — the waterfall shows notes and the keyboard highlights them, but no sound is produced. A new player looking at an unfamiliar piece has no idea what it should sound like, what the rhythm is, or how fast it moves.

A "Play" button that plays the song automatically — scrolling the waterfall, pressing keys on the virtual keyboard, and producing audio — would let users preview songs before practicing and build familiarity with the melody.

## Requirements

### 1. Play button on the song list

Each song card gets a **Play ▶** button alongside the existing click-to-practice behavior.

- Clicking the song card still opens it in the current mode (practice/performance).
- The Play button starts playback of that song in play mode.

### 2. Play mode behavior

Play mode is a non-interactive, listen-only mode:

- The waterfall scrolls at the song's tempo (adjusted by the global tempo setting).
- Notes light up on the virtual keyboard as they are reached, using the existing hand colors (blue for right, orange for left).
- Keys are held for the note's full duration, then released.
- A simple synthesized piano tone plays for each note via the Web Audio API.
- No scoring, no hit/miss tracking, no completion screen.
- MIDI input is ignored during playback (no accidental misses counted).

### 3. Controls during play mode

The play screen shows a simplified controls bar:

- **Back** (←): returns to the song list, stopping playback.
- **Restart**: restarts playback from the beginning.
- **Tempo slider**: adjusts playback speed (reads from and writes to global config).
- The **mode toggle** and **score display** are hidden — they don't apply.
- A **Stop** button replaces Restart once playback is in progress, allowing the user to stop and return to the song list.

### 4. Audio synthesis

Use the Web Audio API to produce sound:

- Create an `AudioContext` on first user interaction (browser autoplay policy).
- Each note-on creates an `OscillatorNode` with a triangle wave at the correct frequency for the MIDI note number.
- Apply a simple ADSR-like envelope via `GainNode`: quick attack (~10ms), sustain at reduced volume, release on note-off (~50ms fade).
- Polyphonic: multiple notes can sound simultaneously (chords).
- Volume should be moderate — not startling. A master gain of ~0.15 is a reasonable default.

Frequency from MIDI note: `440 * 2^((note - 69) / 12)`

### 5. Playback engine

The existing `GameEngine` should not be overloaded with play-mode logic. Instead, a lightweight `Player` class handles scheduled playback:

- Takes a loaded song and tempo.
- On `start()`, schedules all note-on and note-off events as time offsets from the start.
- Uses `requestAnimationFrame` to advance `currentBeat` (same as performance mode) so the waterfall scrolls.
- Fires callbacks for `noteOn(note, hand)` and `noteOff(note)` at the correct times.
- Fires `onComplete()` when the last note ends.
- Supports `stop()` to cancel all pending events and `setTempo()` to adjust speed mid-playback.

Use `setTimeout` for audio scheduling (acceptable for preview quality) rather than the more complex Web Audio scheduling clock. The visual and audio don't need sample-accurate sync — perceptually close is fine.

### 6. Integration with app flow

- `App._playSong(songId)` remains the entry point for practice/performance.
- A new `App._previewSong(songId)` handles play mode.
- `SongListUI` emits a second callback: `onPreviewSong(id)`.
- When play mode completes (last note finishes), automatically return to the song list after a short delay (~1s).

## Acceptance Criteria

- [ ] Each song card on the song list has a Play ▶ button.
- [ ] Clicking Play opens the song in play mode with the waterfall scrolling automatically.
- [ ] Notes light up on the virtual keyboard with correct hand colors and durations.
- [ ] Audio plays for each note (triangle wave, correct pitch, polyphonic).
- [ ] No scoring or completion overlay appears.
- [ ] MIDI input does not interfere with playback.
- [ ] Tempo slider works during play mode and respects global config.
- [ ] Back button stops playback and returns to song list.
- [ ] Restart button restarts playback from the beginning.
- [ ] After the last note ends, the app returns to the song list.
- [ ] Existing practice and performance modes are unaffected.

## Implementation Plan

### Step 1: Audio module (`public/js/audio.js`)

Create a `PianoAudio` class:
- Lazily creates an `AudioContext` on first `play()` call.
- `noteOn(midiNote)` → creates oscillator + gain, applies attack envelope, returns a handle.
- `noteOff(handle)` → applies release envelope, then disconnects.
- `stopAll()` → kills all active oscillators.
- Triangle wave, master gain ~0.15.

### Step 2: Player class (`public/js/player.js`)

Create a `Player` class:
- `constructor()` — initializes state.
- `load(song, tempo)` — flattens tracks into a timeline of `{ note, hand, startMs, endMs }` events.
- `start()` — records start time, begins scheduling via `requestAnimationFrame`.
- `stop()` — cancels playback, clears all pending timeouts.
- `setTempo(tempo)` — adjusts speed (reschedules remaining events).
- Callbacks: `onNoteOn(note, hand)`, `onNoteOff(note)`, `onBeatUpdate(currentBeat)`, `onComplete()`.

Each frame: compute elapsed time → current beat → fire any note-on/note-off events whose time has passed → call `onBeatUpdate`.

### Step 3: Play button on song cards

In `SongListUI._renderSongCard()`:
- Add a small ▶ button to each card.
- `onclick` calls `this.onPreviewSong(songId)` (new callback).
- Stop event propagation so the card's own click (practice mode) isn't triggered.

Style the button to sit in the card's right side, subtle until hovered.

### Step 4: Preview flow in App

Add `App._previewSong(songId)`:
- Fetches the song, switches to play screen.
- Hides score display and mode toggle.
- Creates a `Player` instance, wires callbacks:
  - `onNoteOn` → `keyboard.pressKey(note, handColor)` + `audio.noteOn(note)`
  - `onNoteOff` → `keyboard.releaseKey(note)` + `audio.noteOff(handle)`
  - `onBeatUpdate` → updates `currentBeat` for waterfall rendering
  - `onComplete` → waits 1s, then `_showSongList()`
- Starts the player.

Wire `songListUI.onPreviewSong` in the constructor.

### Step 5: Controls bar adaptation

When entering play mode:
- Hide `#btn-mode` and `#score-display`.
- Change Restart button to restart the player.
- Back button calls `player.stop()` + `audio.stopAll()` + `_showSongList()`.
- Tempo slider adjusts `player.setTempo()`.

When leaving play mode, restore the controls bar to its normal state.

### Step 6: Waterfall rendering during play mode

The render loop already draws the waterfall based on `currentBeat`, `allNotes`, `hitNotes`, and `activeSliceNotes`. During play mode:
- `currentBeat` is updated by the Player's `onBeatUpdate` callback.
- `allNotes` comes from the loaded song.
- `hitNotes` tracks notes that have already been played (for correct coloring as they scroll past).
- `activeSliceNotes` is empty (no pending input).

Store these on the App so the existing `_renderLoop` can read them regardless of mode.

### Step 7: Update roadmap

Mark the Play Mode item as completed in `docs/roadmap.md`.
