# Spec: Progression Tracking per Mode

## Problem

Progress is stored as a single best score and star count per song. A player who completes a song in Practice mode (where the game waits for correct input) gets the same progress entry as one who completes it in Performance mode (real-time playback). This makes the star display misleading — 3 stars in Practice is a very different achievement than 3 stars in Performance.

There's no way to see whether you've mastered a song in both modes, and no incentive to replay a song in the harder mode once you've completed it in Practice.

## Requirements

### 1. Per-mode progress storage

Each song stores separate progress for Practice and Performance:

```json
{
  "songs": {
    "ode-to-joy": {
      "practice":    { "bestScore": 100, "stars": 3, "completedAt": "..." },
      "performance": { "bestScore": 82,  "stars": 2, "completedAt": "..." }
    }
  }
}
```

The `Save` method accepts a `mode` parameter (`"practice"` or `"performance"`) and updates only that mode's entry.

### 2. Backward compatibility

Existing progress files use the old flat format (`{ bestScore, stars, completedAt }` directly under the song ID). On load, migrate old entries to `practice` mode automatically — the old format was effectively practice-only since performance mode was added later.

### 3. Frontend display

The song card shows stars for both modes when available:

- Two small star rows, labeled **P** (Practice) and **F** (Performance), replacing the single star row.
- If only one mode has progress, only that row appears.
- The best score shown is the higher of the two modes.
- The section progress bar counts a song as "completed" if it has progress in *either* mode.

### 4. Recommendation logic

The recommended song is the first song (by difficulty) where:
- Practice stars < 2, OR
- Practice has ≥ 2 stars but Performance has < 2 stars (nudge toward Performance).

This encourages players to first learn in Practice, then prove it in Performance.

### 5. Save message includes mode

The frontend sends the current mode with the `saveProgress` WebSocket message:

```json
{ "type": "saveProgress", "songId": "ode-to-joy", "score": 95, "stars": 3, "mode": "practice" }
```

The backend WebSocket handler passes `mode` through to `progress.Save()`.

## Acceptance Criteria

- [ ] `progress.Save()` accepts a mode parameter and stores progress per mode.
- [ ] Old progress files are migrated to per-mode format on load.
- [ ] Song cards show separate star rows for Practice (P) and Performance (F).
- [ ] Best score displayed is the max across modes.
- [ ] Section progress bar counts songs completed in either mode.
- [ ] Recommendation logic considers both modes.
- [ ] Frontend sends mode with saveProgress message.
- [ ] All existing backend tests updated and passing.
- [ ] New tests cover migration, per-mode save, and per-mode retrieval.

## Implementation Plan

### Step 1: Update progress data model

Change `SongProgress` to hold per-mode entries:

```go
type ModeProgress struct {
    BestScore   int    `json:"bestScore"`
    Stars       int    `json:"stars"`
    CompletedAt string `json:"completedAt"`
}

type SongProgress struct {
    Practice    *ModeProgress `json:"practice,omitempty"`
    Performance *ModeProgress `json:"performance,omitempty"`
}
```

Update `Save(songID, score, stars, mode)` to write to the correct mode slot.

### Step 2: Backward-compatible loading

In `load()`, detect old format entries (they have `bestScore` at the top level) and migrate them into `{ practice: { bestScore, stars, completedAt } }`. Write the migrated data back to disk.

### Step 3: Update `GetAll` and API response

`GetAll()` returns the new structure. The `/api/progress` endpoint response shape changes — the frontend must handle the new nested format.

### Step 4: Update WebSocket handler

Add `Mode` field to the incoming message struct. Pass it to `progress.Save()`.

### Step 5: Update frontend save call

In `app.js` `_onSongComplete()`, include `mode: this.config.mode` in the saveProgress message.

### Step 6: Update song list display

In `songs.js`, read `progress[songId].practice` and `progress[songId].performance` instead of the flat `progress[songId]`. Render two star rows when both exist. Update the best-score display and section progress counting.

### Step 7: Update recommendation logic

Check practice stars first, then performance stars, as described in requirement 4.

### Step 8: Update tests

- Backend: test migration from old format, per-mode save, per-mode retrieval, save-only-improves per mode.
- Verify existing handler tests still pass with the new Save signature.

### Step 9: Update roadmap
