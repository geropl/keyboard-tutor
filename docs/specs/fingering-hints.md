# Fingering Hints

## Problem

The app teaches users which notes to play but not which fingers to use. Proper
fingering is fundamental to piano technique — without it, players develop habits
that block progress on harder pieces. A prototype was built on `main` (commit
`cfb7c74`) but needs to be ported to the `go-translation` branch, which has
diverged significantly (Go backend, new features, restructured frontend).

The user explicitly does **not** want finger numbers displayed on waterfall
blocks — only on the keyboard hint overlay.

## Requirements

### Data layer

1. **Song JSON schema**: Add an optional `finger` field (integer 1–5) to each
   note object in song JSON files. 1 = thumb, 5 = pinky (standard piano
   convention, same numbering for both hands).

2. **Go `Note` struct** (`internal/songs/songs.go`): Add `Finger *int` field
   with `json:"finger,omitempty"`. Use a pointer so notes without fingering
   serialize cleanly (no `"finger": 0`).

3. **Game engine `Note` struct** (`internal/game/engine.go`): Add `Finger *int`
   field with `json:"finger,omitempty"`. The `loadSong` flattening in `game.js`
   spreads all note properties, so the field flows through automatically — but
   the Go struct must match for tests.

4. **Validation** (`songs.go` `Validate`): If `finger` is present, it must be
   1–5. Values outside that range fail validation.

### Song data

5. **Port 9 annotated songs from `main`**: Copy the finger-annotated versions
   of these songs from commit `cfb7c74`:
   - `aura-lee.json`
   - `lightly-row.json`
   - `mary-had-a-little-lamb.json`
   - `minuet-in-g.json`
   - `musette-in-d.json`
   - `ode-to-joy.json`
   - `prelude-in-c.json`
   - `twinkle-twinkle.json`
   - `when-the-saints.json`

6. **Add finger annotations to the 3 remaining songs**:
   - `fur-elise.json` (difficulty 4, 35 RH + 18 LH notes)
   - `gymnopedie-no1.json` (difficulty 4, 20 RH + 98 LH notes)
   - `maple-leaf-rag.json` (difficulty 5, 41 RH + 89 LH notes)

   Use standard pedagogical fingerings. These are more complex pieces, so
   fingering choices matter — follow common published editions.

### Frontend — keyboard overlay (`public/js/keyboard.js`)

7. **`setHints(notes, hand, fingers)`**: Accept an optional third parameter
   `fingers` (a `Map<midiNote, fingerNumber>` or `null`).

8. **Store finger hints**: Add a `_fingerHints` Map, cleared alongside `_hints`
   in `clearHints()`.

9. **Render finger numbers on hinted keys**: After drawing key fills and hint
   overlays, iterate hinted keys that have a finger number. Draw:
   - A filled circle (`rgba(0,0,0,0.7)`) near the bottom of the key
   - White bold text with the finger number centered in the circle
   - Position: bottom of key, offset up (24px for white keys, 14px for black)
   - Radius: `min(keyWidth * 0.3, 14)`

### Frontend — app wiring (`public/js/app.js`)

10. **Extract finger data from pending notes**: In the render loop where
    keyboard hints are set, build a `Map<note, finger>` from pending notes that
    have a non-null `finger` property. Pass it to `setHints()`.

### Frontend — waterfall (`public/js/waterfall.js`)

11. **No changes**. Waterfall blocks continue to show note names only. Do NOT
    port the waterfall finger-number rendering from the `main` commit.

### Backend — no API changes

12. The `finger` field is part of the song JSON and flows through the existing
    `/api/songs/:id` endpoint unchanged. No new endpoints or WebSocket messages
    needed.

## Out of scope

- `data/progress.json` changes from the main commit (runtime state, not feature code)
- Finger numbers on waterfall blocks (explicitly rejected)
- Fingering editor in the import editor UI — imported songs simply won't have
  finger hints. The keyboard still highlights correct keys, just without finger
  numbers. This is acceptable; a fingering editor can be added later as a
  separate feature.
- Any other new UI for editing/viewing fingering — this is display-only

## Acceptance criteria

- [ ] All 12 songs have `finger` annotations on every note
- [ ] Go `Note` struct includes `Finger *int` with `omitempty`
- [ ] Validation rejects `finger` values outside 1–5
- [ ] `go test ./...` passes (existing + new validation test)
- [ ] Keyboard overlay shows finger numbers in dark circles on hinted keys
- [ ] Waterfall blocks show note names only (no finger numbers)
- [ ] Songs without finger data (e.g. future imports) render normally — no
      errors, no empty circles
- [ ] The app builds and runs: `go build -o piano-tutor ./cmd/piano-tutor/ && ./piano-tutor`

## Implementation steps

1. Update Go structs: add `Finger *int` to `songs.Note` and `game.Note`
2. Add finger validation to `songs.Validate` (1–5 range check)
3. Add Go test for finger validation
4. Copy the 9 annotated song files from `main` commit `cfb7c74`
5. Author finger annotations for `fur-elise.json`, `gymnopedie-no1.json`,
   `maple-leaf-rag.json`
6. Update `keyboard.js`: extend `setHints`, add `_fingerHints`, render circles
7. Update `app.js`: extract finger map from pending notes, pass to `setHints`
8. Run `go test ./...` and verify no regressions
9. Build and manually verify in browser
