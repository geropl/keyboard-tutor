# Piano Tutor

A Flowkey-style piano learning app that connects to a MIDI keyboard and teaches you to play through a curated progression of increasingly harder songs.

## Quick Start

```bash
npm install
node server.js
```

Open `http://localhost:3000` in your browser. Connect your MIDI keyboard (tested with Kawai CA63 via USB).

## Features

- **Falling-notes waterfall display** with color-coded hands (blue = right, orange = left)
- **Wait mode** — song pauses until you play the correct notes, so you learn at your own pace
- **Performance mode** — fixed-tempo playback for when you're ready to play in real time
- **12 songs** across 5 difficulty levels, from "Mary Had a Little Lamb" to "Maple Leaf Rag"
- **Scoring and progression** — star ratings, per-level progress bars, recommended next song
- **Tempo adjustment** — slow songs down to 25% or speed up to 150%

## Requirements

- Node.js 18+
- A MIDI keyboard connected at `/dev/midi1` (Linux raw MIDI device)

## Project Structure

```
server.js              Entry point (HTTP + WebSocket + MIDI)
server/
  midi.js              MIDI reader and parser
  websocket.js         WebSocket bridge for note events
  songs.js             Song loading and API
  progress.js          Progress persistence
public/                Browser frontend (vanilla JS, no build step)
songs/                 Song library (JSON files)
data/                  User progress (created at runtime)
```

## Song Format

Songs are JSON files in `songs/` with timing in beats (not milliseconds), making tempo adjustment trivial. See any song file for the schema.

## Tech Stack

Node.js backend, vanilla JavaScript frontend, single npm dependency (`ws`). No framework, no bundler, no build step.
