# Spec: MIDI Import

## Problem

The app ships with 12 built-in songs. There is no way for users to add their own. MIDI files are the most common and accessible format for digital sheet music — they're available from many free sources, can be exported from DAWs, and can be generated from audio using tools like Spotify's Basic Pitch. The app needs a way to import MIDI files and convert them into playable songs.

This is Phase 1 of the Song Discovery roadmap item.

## Architecture Decision: Frontend-Only Parsing

MIDI parsing, track selection, hand assignment, and conversion to the app's JSON song format all happen in the browser. The backend's role is limited to persisting and serving the resulting song JSON, and deleting imported songs.

Rationale:
- Eliminates a Go MIDI parsing dependency (`gomidi`).
- Eliminates temporary server-side session management.
- The frontend already has all the UI components needed (Waterfall, PianoKeyboard, Player, Audio).
- The `@tonejs/midi` library handles MIDI parsing in JS and is available as a self-contained UMD bundle.

The library is vendored into `public/js/lib/Midi.js` (committed to the repo). This avoids adding a bundler or CDN dependency, consistent with the project's zero-build-step approach.

## Requirements

### 1. MIDI file upload

An "Import MIDI" button on the song list page opens a file picker (accept `.mid,.midi`). The selected file is read client-side using the FileReader API. The raw bytes are passed to `@tonejs/midi` for parsing. No upload to the backend occurs at this stage.

### 2. MIDI parsing (frontend)

Using `@tonejs/midi`, the frontend parses the file and extracts:

- **Tracks**: each MIDI track becomes a selectable item. For each track, extract:
  - Track name (from MIDI meta event, or "Track N" fallback)
  - Instrument name (from `track.instrument.name`, or "Unknown")
  - Note count
  - Note range (lowest–highest MIDI note number)
  - Channel number
  - Whether it's a percussion track (`track.instrument.percussion`)
- **Notes per track**: MIDI note number, start time (in seconds), duration (in seconds). `@tonejs/midi` provides these directly as `note.midi`, `note.time`, `note.duration`.
- **Tempo**: from `midi.header.tempos[0].bpm`. If multiple tempo changes exist, use the first one (our format supports a single tempo value).
- **Time signature**: from `midi.header.timeSignatures[0]`, default to 4/4.

Time conversion: `@tonejs/midi` gives note times in seconds. Our song format uses beats. Convert using: `beatPosition = timeInSeconds * (tempo / 60)`. Similarly for duration.

Percussion tracks (channel 10) are excluded from selection by default but shown in the track list (greyed out, with a "Percussion" label).

Empty tracks (zero notes) are hidden from the track list.

Error handling:
- File with no parseable notes → show error message, stay on song list.
- Corrupt/invalid MIDI file → catch parse error, show message.

### 3. Import editor page (frontend)

After parsing, the app navigates to a full-screen import editor page (replaces the song list, same pattern as the play screen). This page has four sections:

**Metadata section:**
- Title (text input, pre-filled from `midi.header.name` or filename without extension)
- Composer (text input, pre-filled from MIDI meta if available, otherwise empty)
- Difficulty (1–5 selector, default 3)
- Description (text input, optional)

**Track selection section:**
- List of all non-empty, non-percussion tracks, each showing:
  - Checkbox to include/exclude
  - Track name and instrument label
  - Note count and range display
  - Hand assignment dropdown: "Right Hand" / "Left Hand"
- At least one track must be selected to save.
- First track is selected by default.

**Hand assignment strategy:**
A dropdown at the top of the track section lets the user pick a strategy, which pre-fills the per-track hand assignments:
- **By track** (default): first selected track → right hand, second → left hand, remaining alternate.
- **By pitch (split at middle C)**: notes below MIDI 60 → left hand, notes >= 60 → right hand. Applied within each selected track — a single track's notes may be split across both hands.
- **All right hand**: everything assigned to right hand.
- **All left hand**: everything assigned to left hand.

The user can override individual track hand assignments after applying a strategy. Changing the strategy dropdown resets all per-track assignments.

**Preview section:**
- A waterfall + keyboard preview showing the selected tracks with current hand assignment colors.
- Updates live as the user changes track selection or hand assignments.
- A "Play Preview" button that plays the imported song using the existing Player and PianoAudio systems. Pressing it again stops playback. The preview uses the converted song data (same format the game uses).
- The preview area reuses the existing `Waterfall` and `PianoKeyboard` components.

**Action buttons:**
- "Save" — converts and sends to backend (see §4). Navigates to song list on success.
- "Cancel" — discards everything, returns to song list.

### 4. Song conversion (frontend)

When the user clicks Save, the frontend converts the parsed MIDI data into the app's song JSON format:

1. Collect notes from all selected tracks.
2. Apply hand assignment:
   - If strategy is "by pitch": split each track's notes by pitch threshold (< 60 → left, >= 60 → right), regardless of per-track dropdown.
   - Otherwise: use the per-track hand dropdown value.
3. Merge all left-hand notes into one track, all right-hand notes into another.
4. Convert note times from seconds to beats: `start = timeInSeconds * (tempo / 60)`, `duration = durationInSeconds * (tempo / 60)`.
5. Sort notes within each track by start time.
6. Build the song JSON object matching the existing format:

```json
{
  "title": "...",
  "composer": "...",
  "difficulty": 3,
  "tempo": 120,
  "timeSignature": [4, 4],
  "description": "...",
  "skillFocus": "",
  "tracks": [
    { "hand": "right", "notes": [{ "note": 60, "start": 0, "duration": 1 }, ...] },
    { "hand": "left", "notes": [{ "note": 48, "start": 0, "duration": 1 }, ...] }
  ]
}
```

7. Send `POST /api/songs` with the JSON body.

If only one hand has notes (e.g., all-right strategy on a single-track file), the song has a single track.

### 5. Backend: save imported song

New endpoint: `POST /api/songs`

Accepts a JSON body with the song data. The backend:

1. **Validates** the song JSON:
   - `title` is non-empty.
   - `tempo` is a positive number.
   - `timeSignature` is a 2-element array of positive integers.
   - `difficulty` is between 1 and 5.
   - `tracks` is a non-empty array; each track has a `hand` field ("right" or "left") and a non-empty `notes` array.
   - Each note has `note` (integer 0–127), `start` (>= 0), `duration` (> 0).
2. Generates an ID from the title (slugified: lowercase, spaces to hyphens, strip non-alphanumeric). If the ID collides with an existing song, append `-2`, `-3`, etc.
3. Sets `"source": "imported"` on the song object.
4. Writes the song as a JSON file to `data/songs/{id}.json`.
5. Adds the song to the in-memory song list.
6. Returns `201 Created` with `{ "id": "the-song-id" }`.

### 6. Backend: serve imported songs alongside built-in songs

Extend `songs.Service` to load from two sources:
- The embedded `songs/` filesystem (built-in, read-only).
- The `data/songs/` directory on disk (user-imported, read-write).

Both sets appear in the song list API response. A `source` field on each song summary indicates `"builtin"` or `"imported"` so the frontend can differentiate.

Built-in songs always have `source: "builtin"` (this field is not stored in their JSON; it's added at load time). Imported songs have `"source": "imported"` in their JSON file.

The `data/songs/` directory is created automatically if it doesn't exist.

### 7. Backend: delete imported song

New endpoint: `DELETE /api/songs/{id}`

The backend:
- Verifies the song exists and is user-imported (not built-in). Returns 404 if not found, 403 if built-in.
- Deletes the JSON file from `data/songs/`.
- Removes the song from the in-memory list.
- Returns 204 No Content.

### 8. Backend: update imported song

New endpoint: `PUT /api/songs/{id}`

Accepts a JSON body with updated song data. The backend:
- Verifies the song exists and is user-imported. Returns 404 if not found, 403 if built-in.
- Validates the JSON (same rules as §5).
- Overwrites the JSON file on disk.
- Updates the in-memory song list.
- Returns 200 OK with the updated song.

### 9. Frontend: song card badges, delete, and edit

In the song list:
- Imported songs show an "Imported" badge on their card.
- Imported songs show a delete button (✕ icon). Clicking it shows a confirmation dialog, then calls `DELETE /api/songs/{id}` and reloads the list.
- Imported songs show an edit button (pencil icon). Clicking it opens the import editor in re-edit mode (see §10).
- Built-in songs have no delete or edit buttons.

### 10. Re-edit mode

When editing an existing imported song, the import editor opens pre-populated with the song's current data:
- Metadata fields are filled from the existing song.
- Tracks are shown as they currently exist (right-hand track, left-hand track, or both).
- Since the original MIDI track data is lost after import (we only store our JSON format), re-edit is limited to:
  - Metadata changes (title, composer, difficulty, description).
  - Hand reassignment using the pitch-split strategy (re-split existing notes by pitch threshold).
  - Hand swap (swap all left ↔ right).
- Full track re-selection requires re-importing the original MIDI file.
- Track selection checkboxes are disabled in re-edit mode.
- Save calls `PUT /api/songs/{id}`.

## Acceptance Criteria

- [ ] "Import MIDI" button visible on the song list page.
- [ ] Selecting a `.mid` file parses it client-side and opens the import editor.
- [ ] Import editor shows all non-empty, non-percussion tracks with name, instrument, note count, range.
- [ ] User can select/deselect tracks and assign hands.
- [ ] Four hand assignment strategies work: by track, by pitch, all right, all left.
- [ ] Waterfall + keyboard preview updates live with track/hand changes.
- [ ] Play Preview button plays audio of the current import configuration.
- [ ] Saving sends valid song JSON to the backend and creates a file in `data/songs/`.
- [ ] Backend validates song JSON before saving (rejects malformed data).
- [ ] Imported songs appear in the song list with an "Imported" badge.
- [ ] Imported songs are playable in Practice and Performance modes.
- [ ] Imported songs can be deleted (with confirmation).
- [ ] Imported songs can be re-edited (metadata + hand reassignment).
- [ ] Built-in songs cannot be deleted or edited.
- [ ] Multi-track MIDI files with non-piano instruments are handled (user picks tracks).
- [ ] Single-track MIDI files work (all notes in one track).
- [ ] MIDI files with no notes produce a clear error message.
- [ ] Percussion tracks are excluded by default.
- [ ] Progress tracking works for imported songs (same as built-in).
- [ ] All new backend logic has tests.

## Implementation Plan

### Step 1: Vendor `@tonejs/midi`

Download the UMD bundle of `@tonejs/midi` and place it at `public/js/lib/Midi.js`. Add a `<script>` tag in `index.html` before the app scripts. Verify `window.Midi` (or the appropriate global) is accessible.

### Step 2: Extend `songs.Service` for dual-source loading

- Add a `dataDir` parameter to `NewService` (path to `data/songs/`).
- On startup, load both embedded songs and disk songs.
- Add a `source` field to `Song` and `SongSummary` (`"builtin"` or `"imported"`).
- Add `AddSong(song *Song) error` — validates, generates ID, writes JSON to disk, adds to in-memory list.
- Add `DeleteSong(id string) error` — removes from disk and memory (only if imported).
- Add `UpdateSong(id string, song *Song) error` — validates, overwrites on disk, updates in memory (only if imported).
- Create `data/songs/` directory automatically if missing.
- Write tests for add/delete/update/reload and ID collision handling.

### Step 3: Backend API endpoints

In `internal/server/handlers.go`, add:
- `POST /api/songs` — accepts song JSON, calls `AddSong`, returns 201 with ID.
- `DELETE /api/songs/{id}` — calls `DeleteSong`, returns 204.
- `PUT /api/songs/{id}` — accepts song JSON, calls `UpdateSong`, returns 200.

Add validation logic (required fields, value ranges, track structure).

Wire routes in `server.go`. Write handler tests.

### Step 4: Update `main.go`

Pass `dataDir` to `songs.NewService` so it loads from both embedded and disk sources.

### Step 5: Frontend — MIDI parser module (`public/js/midi-import.js`)

New module that wraps `@tonejs/midi`:
- `parseMidiFile(arrayBuffer)` → returns a structured object with tracks, tempo, time signature, suggested title.
- `convertToSong(parsedData, options)` → converts parsed MIDI data + user choices (selected tracks, hand assignments, strategy, metadata) into the app's song JSON format.
- Handles seconds-to-beats conversion, track merging, pitch-split logic.

### Step 6: Frontend — Import editor UI (`public/js/import-editor.js`)

New module with class `ImportEditor`:
- Full-screen page (same show/hide pattern as play screen).
- Metadata form: title, composer, difficulty, description.
- Track list: checkboxes, hand dropdowns, track info.
- Hand strategy dropdown with the four options.
- Waterfall + keyboard preview area (reuses existing components).
- Play Preview button (uses existing `Player` and `PianoAudio`).
- Save and Cancel buttons.
- Re-edit mode: accepts an existing song, pre-fills fields, disables track selection.

### Step 7: Frontend — Wire into `app.js` and `songs.js`

- Add "Import MIDI" button to song list header.
- Add file picker logic (FileReader → parse → open editor).
- Add navigation flow: song list ↔ import editor.
- Add "Imported" badge, delete button, and edit button to imported song cards.
- Wire delete confirmation → `DELETE /api/songs/{id}` → reload.
- Wire edit button → open import editor in re-edit mode.

### Step 8: Styling

Add CSS for the import editor: metadata form, track list, preview area, action buttons, imported badge, delete/edit buttons on song cards. Match existing app style.

### Step 9: Backend tests

- `songs/songs_test.go`: extended tests for dual-source loading, add/delete/update, ID generation, collision handling, source field.
- `server/handlers_test.go`: tests for POST/PUT/DELETE song endpoints, validation rejection.

### Step 10: Manual integration test

- Import a multi-track MIDI file, configure tracks, save, play in Practice and Performance modes.
- Delete an imported song, verify it's gone.
- Re-edit an imported song, change metadata and hand assignment, verify changes persist.
- Verify built-in songs are unaffected.
