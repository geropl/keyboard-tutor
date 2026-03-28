# Spec: Translate Piano Tutor Backend to Go

## Problem Statement

The Piano Tutor app currently runs on a Node.js backend (~283 lines across 5 files) with a single `ws` dependency. The goal is to rewrite the backend in Go while keeping the vanilla JS frontend unchanged. The Go binary should embed all static frontend assets via `go:embed`, producing a single self-contained executable. The repo structure should be reorganized around Go conventions.

## Scope

**In scope:**
- Rewrite all server-side code (HTTP server, REST API, WebSocket bridge, MIDI reader, progress persistence) in Go
- Embed frontend assets (`public/`, `songs/`) into the Go binary using `embed.FS`
- Reorganize the repo into idiomatic Go layout (`cmd/`, `internal/`)
- Use `gorilla/websocket` for WebSocket support
- Design MIDI input as a pluggable interface (with a raw `/dev/midi*` implementation)
- Port existing `GameEngine` logic tests to Go table-driven tests
- Write new tests for Go server components (HTTP handlers, WebSocket, MIDI parser, progress)

**Out of scope:**
- Changes to frontend JavaScript, CSS, or HTML
- Changes to the song JSON format
- Cross-platform MIDI backends (only the raw Linux reader is implemented; the interface allows future backends)

## Current Architecture (Node.js)

| File | Lines | Responsibility |
|---|---|---|
| `server.js` | 93 | Entry point: HTTP server, static files, API routing |
| `server/midi.js` | 80 | Raw `/dev/midi1` byte stream reader, state machine parser |
| `server/websocket.js` | 33 | WebSocket server, MIDI event broadcast, progress save handler |
| `server/songs.js` | 35 | Load/cache song JSON files, serve song list and individual songs |
| `server/progress.js` | 42 | Read/write `data/progress.json` |

Frontend (unchanged): 8 JS files (1028 lines), 1 CSS file (408 lines), 1 HTML file.

## Target Architecture (Go)

### Repository Layout

```
keyboard-tutor/
├── cmd/
│   └── piano-tutor/
│       └── main.go              # Entry point, wiring
├── internal/
│   ├── midi/
│   │   ├── midi.go              # MidiReader interface + NoteEvent types
│   │   ├── raw.go               # Raw /dev/midi* implementation (Linux)
│   │   └── raw_test.go          # State machine parser tests
│   ├── server/
│   │   ├── server.go            # HTTP server setup, static file serving, API routes
│   │   ├── websocket.go         # WebSocket upgrade, MIDI broadcast, progress save
│   │   ├── websocket_test.go    # WebSocket integration tests
│   │   ├── handlers.go          # REST API handlers (/api/songs, /api/progress)
│   │   └── handlers_test.go     # HTTP handler tests
│   ├── songs/
│   │   ├── songs.go             # Song loading, caching, types
│   │   └── songs_test.go        # Song loading tests
│   ├── progress/
│   │   ├── progress.go          # Progress persistence (JSON file)
│   │   └── progress_test.go     # Progress read/write tests
│   └── game/
│       ├── engine.go            # GameEngine logic (ported from public/js/game.js)
│       └── engine_test.go       # Table-driven tests (ported from tests/game.test.js)
├── public/                      # Frontend assets (embedded, unchanged)
│   ├── index.html
│   ├── css/style.css
│   └── js/*.js
├── songs/                       # Song JSON files (embedded)
│   └── *.json
├── data/                        # Runtime progress file (NOT embedded)
│   └── progress.json
├── go.mod
├── go.sum
├── spec.md
├── docs/
│   └── adr/
│       └── 001-initial-architecture.md
└── README.md
```

### Component Design

#### 1. MIDI Reader (`internal/midi/`)

**Interface:**
```go
type NoteEvent struct {
    Note      uint8
    Velocity  uint8
    Channel   uint8
    Timestamp int64  // Unix millis
}

type MidiReader interface {
    // Start begins reading MIDI input. Events are sent to the returned channels.
    // The caller should select on both channels plus the context for cancellation.
    Start(ctx context.Context) (noteOn <-chan NoteEvent, noteOff <-chan NoteEvent, err error)
    Close() error
}
```

**Raw implementation:** Direct port of the existing state machine — `os.Open(devicePath)`, read bytes in a goroutine, parse status/data bytes, send events on channels. Same filtering (ignore active sensing `0xFE`, ignore system messages `0xF0-0xFF`, support running status).

#### 2. Song Service (`internal/songs/`)

- On init, read all `*.json` files from the embedded `songs/` FS
- Parse into `Song` structs, sort by difficulty then title
- Expose `List() []SongSummary` and `Get(id string) (*Song, error)`
- Song types mirror the JSON schema:

```go
type Song struct {
    ID            string    `json:"id"`
    Title         string    `json:"title"`
    Composer      string    `json:"composer"`
    Difficulty    int       `json:"difficulty"`
    Tempo         int       `json:"tempo"`
    TimeSignature [2]int    `json:"timeSignature"`
    Description   string    `json:"description"`
    SkillFocus    string    `json:"skillFocus"`
    Tracks        []Track   `json:"tracks"`
}

type Track struct {
    Hand  string `json:"hand"`
    Notes []Note `json:"notes"`
}

type Note struct {
    Note     int     `json:"note"`
    Start    float64 `json:"start"`
    Duration float64 `json:"duration"`
}
```

#### 3. Progress Manager (`internal/progress/`)

- Read/write `data/progress.json` on the real filesystem (not embedded — runtime mutable state)
- Same logic: only update if new score > existing best score
- Thread-safe with `sync.Mutex`
- Expose `GetAll() ProgressData` and `Save(songID string, score int, stars int)`

#### 4. HTTP Server (`internal/server/`)

**Static files:** Serve embedded `public/` FS at `/`. Use `http.FileServer` with `embed.FS`.

**REST API:**
- `GET /api/songs` → JSON array of song summaries
- `GET /api/songs/{id}` → Full song JSON (404 if not found)
- `GET /api/progress` → Progress JSON

**WebSocket:** Upgrade at `/ws` (or root path, matching current behavior where the `ws` library upgrades on the same port). On connection:
- Subscribe to MIDI events, broadcast as JSON `{"type":"noteOn", "note":..., "velocity":..., "channel":..., "timestamp":...}`
- Listen for incoming `{"type":"saveProgress", "songId":..., "score":..., "stars":...}` messages, delegate to progress manager
- Track connected clients, remove on disconnect

Note: The current Node.js app upgrades WebSocket on the same HTTP server (any path). The Go version should match this — upgrade requests that have the `Upgrade: websocket` header get handled by the WebSocket handler, all other requests go through normal HTTP routing.

#### 5. Game Engine (`internal/game/`)

Port of `public/js/game.js` — the core game logic. This exists in Go for two reasons:
1. To have the logic testable in Go (porting the existing 204-line test suite)
2. To potentially enable server-side validation in the future

The frontend `game.js` remains the authoritative runtime — the Go port is a parallel implementation for testing and future use.

**Key behaviors to preserve:**
- Slice grouping: notes within 0.01 beats are grouped into one slice
- Single-note slices: hit immediately on correct noteOn
- Chord slices: all notes must be physically held simultaneously
- Wait mode: song pauses at each slice until correct keys pressed
- Performance mode: time-based advancement, missed notes marked as passed after 0.5 beats
- Scoring: `hits / totalNotes * 100`, stars at 60/80/95 thresholds

#### 6. Entry Point (`cmd/piano-tutor/main.go`)

- Parse flags: `-port` (default 3000), `-midi` (default `/dev/midi1`), `-data` (default `./data`)
- Initialize MIDI reader (log warning and continue if device not found — allows running without hardware)
- Initialize song service from embedded FS
- Initialize progress manager with data directory path
- Start HTTP server with all routes wired up
- Graceful shutdown on SIGINT/SIGTERM

### Embedding Strategy

```go
//go:embed public/*
var publicFS embed.FS

//go:embed songs/*
var songsFS embed.FS
```

- `public/` is served via `http.FileServer`
- `songs/` is read at startup to populate the song cache
- `data/` is NOT embedded — it's runtime mutable state on the real filesystem

### Dependencies

| Package | Purpose |
|---|---|
| `github.com/gorilla/websocket` | WebSocket server |
| Standard library only for everything else | `net/http`, `encoding/json`, `os`, `embed`, `sync`, `context`, `flag` |

## Acceptance Criteria

1. **`go build ./cmd/piano-tutor`** produces a single binary that serves the full app
2. **Static assets** are embedded — the binary works without the `public/` or `songs/` directories present
3. **REST API** returns identical JSON responses as the Node.js version for `/api/songs`, `/api/songs/{id}`, and `/api/progress`
4. **WebSocket** connects from the existing frontend `connection.js` without modification and delivers MIDI events in the same JSON format
5. **MIDI reader** correctly parses note on/off from raw device bytes (same state machine logic)
6. **MIDI interface** allows swapping implementations without changing server code
7. **Progress** persists to `data/progress.json` with the same format, only updating on score improvement
8. **Game engine tests** pass — all existing test cases from `tests/game.test.js` ported to Go table-driven tests
9. **Server tests** cover HTTP handlers (correct responses, 404s), WebSocket message flow, MIDI parser byte sequences, and progress read/write
10. **Graceful startup without MIDI** — if `/dev/midi1` is unavailable, the server starts and serves the app (WebSocket connects but no MIDI events flow)
11. **Flag configuration** — port, MIDI device path, and data directory are configurable via CLI flags
12. **`go test ./...`** passes with all tests green

## Implementation Plan

Ordered steps, each producing a testable increment:

1. **Initialize Go module and repo structure** — `go mod init`, create directory layout, move/keep `public/` and `songs/` in place, update `.devcontainer/Dockerfile` to install Go
2. **Implement song service** (`internal/songs/`) — types, embedded FS loading, `List()` and `Get()` methods, tests
3. **Implement progress manager** (`internal/progress/`) — read/write JSON, thread-safe, tests
4. **Implement MIDI interface and raw reader** (`internal/midi/`) — interface definition, raw `/dev/midi*` state machine, parser unit tests with byte sequences
5. **Implement HTTP server and handlers** (`internal/server/`) — static file serving from embedded FS, REST API handlers, handler tests
6. **Implement WebSocket bridge** (`internal/server/websocket.go`) — upgrade handler, MIDI event broadcast, saveProgress handling, integration tests
7. **Port game engine** (`internal/game/`) — translate `game.js` logic to Go, port all test cases from `tests/game.test.js` as table-driven tests
8. **Wire up entry point** (`cmd/piano-tutor/main.go`) — flag parsing, component initialization, graceful shutdown
9. **End-to-end verification** — build binary, run it, verify frontend loads, API responses match, WebSocket connects
10. **Update README and devcontainer** — document Go build/run instructions, update Dockerfile for Go toolchain
