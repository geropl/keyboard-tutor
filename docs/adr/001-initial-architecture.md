# ADR 001: Initial Architecture

**Date:** 2026-03-28
**Status:** Accepted

## Context

We need a piano learning app that reads MIDI input from a Kawai CA63, displays a falling-notes visualization, and teaches songs through a wait-mode interaction. The app runs on a single Linux machine with Node.js 18 available and the piano connected at `/dev/midi1`.

## Decisions

### Raw MIDI over native libraries

We read `/dev/midi1` directly with `fs.createReadStream` and parse the MIDI byte protocol with a hand-written state machine (~60 lines). This avoids native npm addons (which require build toolchains and break across Node versions) and pulls in zero dependencies for the hardware layer. The MIDI protocol subset we need (note on, note off, active sensing filtering) is simple enough that a library adds no value.

### Node.js backend + vanilla JS frontend

The backend serves static files, provides a song/progress REST API, and bridges MIDI events to the browser via WebSocket. The frontend is vanilla JavaScript with ES modules (`<script type="module">`), no framework, no bundler.

**Why no framework:** The UI is dominated by two Canvas elements (waterfall and keyboard) rendered imperatively at 60fps. A reactive framework would sit between us and the canvas with no benefit. The non-canvas UI (song list, completion screen) is simple enough that DOM manipulation is straightforward.

**Why no build step:** ES modules work natively in both Node.js 18 and modern browsers. Eliminating bundler configuration, source maps, and build commands removes an entire category of complexity. The tradeoff is no TypeScript, no JSX, no tree-shaking — none of which we need at this scale.

### Single `ws` dependency

The only npm package is `ws` for the WebSocket server. HTTP static serving, REST API routing, MIDI parsing, and all frontend code use zero external dependencies. This keeps the dependency tree trivial and the project easy to understand and maintain.

### WebSocket for MIDI bridging

MIDI events must reach the browser with minimal latency. WebSocket adds ~1-2ms over the raw device read, which is imperceptible. The same connection also carries progress-save messages from the client back to the server, avoiding a separate HTTP endpoint for writes.

### Canvas for rendering

Both the waterfall (hundreds of falling note rectangles) and the virtual keyboard are rendered on `<canvas>` elements sharing a single `requestAnimationFrame` loop. Canvas is the natural choice for immediate-mode graphics at 60fps. DOM or SVG would cause layout thrashing at this update frequency.

### Beats as the timing unit

Song files express note `start` and `duration` in beats (quarter note = 1), not milliseconds. Tempo conversion happens at render time: `ms = beat * 60000 / tempo`. This makes tempo adjustment a single multiplication — no recalculation of note positions needed.

### Wait mode as default

In wait mode, the song freezes at each note (or chord) until the player hits the correct keys. This is the core learning mechanic: the player is never overwhelmed by tempo and can build muscle memory for correct fingering. Performance mode (fixed tempo) is available as a toggle for users ready to play in real time.

### File-based progress persistence

User progress (best scores, star ratings) is stored in `data/progress.json`, read on startup and written on each song completion. There is no database. For a single-user local app, a JSON file is the simplest thing that works. If multi-user or remote access becomes a requirement, this is the first thing to revisit.

### Hand-authored song library

Songs are JSON files written by hand rather than imported from MIDI files. This gives us precise control over difficulty grading, hand assignments, and pedagogical note selection (e.g., simplified arrangements). The tradeoff is authoring effort, but the initial 12-song library is small enough that this is manageable. A MIDI import tool could be added later.

## Consequences

- Adding songs requires editing JSON by hand (or building an import tool later).
- No TypeScript means no compile-time type checking; bugs surface at runtime.
- The raw MIDI approach ties us to Linux `/dev/midi*` devices; macOS/Windows would need a different device path or a cross-platform MIDI library.
- Single-user only; no authentication, no multi-device sync.
