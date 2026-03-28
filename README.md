# Piano Tutor

A Flowkey-style piano learning app that connects to a MIDI keyboard and teaches you to play through a curated progression of increasingly harder songs.

## Quick Start

```bash
go build -o piano-tutor ./cmd/piano-tutor/
./piano-tutor
```

Open `http://localhost:3000` in your browser. Connect your MIDI keyboard (tested with Kawai CA63 via USB).

The binary embeds all frontend assets and song data — no additional files needed to run.

### Options

```
-port 3000        HTTP server port
-midi /dev/midi1  MIDI device path
-data ./data      Directory for progress data
```

The server starts without a MIDI device if one isn't available.

## Features

- **Falling-notes waterfall display** with color-coded hands (blue = right, orange = left)
- **Wait mode** — song pauses until you play the correct notes, so you learn at your own pace
- **Performance mode** — fixed-tempo playback for when you're ready to play in real time
- **12 songs** across 5 difficulty levels, from "Mary Had a Little Lamb" to "Maple Leaf Rag"
- **Scoring and progression** — star ratings, per-level progress bars, recommended next song
- **Tempo adjustment** — slow songs down to 25% or speed up to 150%

## Requirements

- Go 1.22+
- A MIDI keyboard connected at `/dev/midi1` (Linux raw MIDI device) — optional

## Project Structure

```
cmd/piano-tutor/       Entry point, flag parsing, wiring
internal/
  midi/                MIDI reader interface + raw /dev/midi* implementation
  server/              HTTP server, REST handlers, WebSocket bridge
  songs/               Song loading from embedded FS
  progress/            Progress persistence (JSON file)
  game/                Game engine (ported from JS for testing)
embed.go               go:embed directives for public/ and songs/
public/                Browser frontend (vanilla JS, no build step)
songs/                 Song library (JSON files)
data/                  User progress (created at runtime)
```

## Testing

```bash
go test ./...
```

Tests cover: game engine logic (ported from JS test suite), MIDI byte parser, song loading, progress persistence, HTTP handlers, and WebSocket message flow.

## Song Format

Songs are JSON files in `songs/` with timing in beats (not milliseconds), making tempo adjustment trivial. See any song file for the schema.

## Tech Stack

Go backend with embedded static assets, vanilla JavaScript frontend. Single dependency: `gorilla/websocket`. No framework, no bundler, no frontend build step.

