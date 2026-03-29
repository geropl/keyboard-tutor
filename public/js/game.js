import { starsForScore } from './utils.js';
import { MODE_PRACTICE, MODE_PERFORMANCE } from './config.js';

// Timing accuracy: exponential decay with τ=150ms
const TIMING_TAU = 150;

function timingAccuracy(deltaMs) {
  return 100 * Math.exp(-Math.abs(deltaMs) / TIMING_TAU);
}

export function computeAccuracy(timingLog) {
  if (timingLog.length === 0) return 0;
  let sum = 0;
  let count = 0;
  for (const entry of timingLog) {
    sum += timingAccuracy(entry.onDeltaMs);
    count++;
    if (entry.offDeltaMs !== null) {
      sum += timingAccuracy(entry.offDeltaMs);
      count++;
    }
  }
  return count > 0 ? Math.round(sum / count) : 0;
}

export class GameEngine {
  constructor() {
    this.song = null;
    this.allNotes = [];       // flattened notes with hand property
    this.currentBeat = -2;    // start 2 beats before first note for visual lead-in
    this.hitNotes = new Set();
    this.totalNotes = 0;
    this.hits = 0;
    this.misses = 0;
    this.mode = MODE_PRACTICE;
    this.playing = false;
    this.completed = false;
    this.tempo = 120;
    this.lastFrameTime = null;
    this.pendingSlice = [];   // notes in current time slice waiting to be played
    this.waitingForFirstKey = false; // performance mode: freeze until first keypress
    this.onComplete = null;

    // Timing tracking
    this.timingLog = [];        // array of { note, hand, onDeltaMs, offDeltaMs }
    this.startTimeMs = 0;       // wall-clock ms when playback started
    this._noteToTimingIdx = new Map(); // note object → timingLog index

    // Track which physical keys are currently down
    this.physicalKeys = new Set();
    // Map MIDI note number → note object for the active press, so noteOff
    // closes the correct timing entry when consecutive notes share a pitch.
    this._activeNoteObj = new Map();
  }

  _beatToMs(beat) {
    return beat * 60000 / this.tempo;
  }

  loadSong(song) {
    this.song = song;
    this.tempo = song.tempo;
    this.allNotes = [];
    for (const track of song.tracks) {
      for (const note of track.notes) {
        this.allNotes.push({ ...note, hand: track.hand });
      }
    }
    this.allNotes.sort((a, b) => a.start - b.start || a.note - b.note);
    this.totalNotes = this.allNotes.length;
    this.hitNotes = new Set();
    this.hits = 0;
    this.misses = 0;
    this.currentBeat = -2;
    this.playing = false;
    this.completed = false;
    this.lastFrameTime = null;
    this.waitingForFirstKey = false;
    this.timingLog = [];
    this._noteToTimingIdx = new Map();
    this._activeNoteObj = new Map();
    this.startTimeMs = 0;
    this._practiceScrollTarget = 0;
    this._computePendingSlice();
  }

  start() {
    this.playing = true;
    const now = performance.now();
    this.lastFrameTime = now;
    // startTimeMs is the wall-clock epoch for beat 0.
    // currentBeat starts at -2 (visual lead-in), so offset accordingly.
    this.startTimeMs = now - this._beatToMs(this.currentBeat);
  }

  stop() {
    this.playing = false;
  }

  setTempo(tempo) {
    this.tempo = tempo;
  }

  _computePendingSlice() {
    // Find all unhit notes at the earliest unhit start time
    this.pendingSlice = [];
    let sliceStart = null;
    for (const note of this.allNotes) {
      if (this.hitNotes.has(note)) continue;
      if (sliceStart === null) {
        sliceStart = note.start;
      }
      // Group notes within a small tolerance (0.01 beats) as same slice
      if (Math.abs(note.start - sliceStart) < 0.01) {
        this.pendingSlice.push(note);
      } else {
        break;
      }
    }
  }

  // Returns set of notes in active slice (for visual highlighting)
  getActiveSliceNotes() {
    return new Set(this.pendingSlice);
  }

  _recordNoteOn(noteObj, nowMs) {
    const expectedMs = this._beatToMs(noteObj.start) + this.startTimeMs;
    const onDelta = this.mode === MODE_PRACTICE ? 0 : (nowMs - expectedMs);
    // Convert actual press time to beat position for waterfall rendering
    const onBeat = this.mode === MODE_PRACTICE
      ? noteObj.start
      : noteObj.start + (onDelta / 60000) * this.tempo;
    const entry = {
      note: noteObj.note,
      hand: noteObj.hand,
      onDeltaMs: onDelta,
      offDeltaMs: null,
      onBeat,       // actual beat when key was pressed
      offBeat: null, // actual beat when key was released (set in noteOff)
      onTimeMs: nowMs, // wall-clock time of press (for real-time hold calculation)
      // Store reference to the note object for release lookup
      _noteObj: noteObj,
    };
    const idx = this.timingLog.length;
    this.timingLog.push(entry);
    this._noteToTimingIdx.set(noteObj, idx);
    return onDelta;
  }

  // Called on each noteOn from MIDI
  noteOn(midiNote) {
    const nowMs = performance.now();
    this.physicalKeys.add(midiNote);
    if (!this.playing || this.completed) return { hit: false, note: midiNote };

    // Performance mode: first keypress starts the clock.
    // Align currentBeat to the first pending note so the waterfall doesn't
    // jump and startTimeMs maps beat 0 to "now".
    if (this.waitingForFirstKey) {
      this.waitingForFirstKey = false;
      const firstBeat = this.pendingSlice.length > 0 ? this.pendingSlice[0].start : 0;
      this.currentBeat = firstBeat;
      this.startTimeMs = nowMs - this._beatToMs(firstBeat);
      this.lastFrameTime = nowMs;
    }

    // Ignore duplicate noteOn if this key is already active (no noteOff received yet)
    if (this._activeNoteObj.has(midiNote)) return { hit: false, note: midiNote };

    // Check if this note matches any pending slice note
    const matchIdx = this.pendingSlice.findIndex(n => n.note === midiNote && !this.hitNotes.has(n));
    if (matchIdx >= 0) {
      const matched = this.pendingSlice[matchIdx];

      // For single-note slices, register hit immediately
      if (this.pendingSlice.length === 1) {
        const onDelta = this._recordNoteOn(matched, nowMs);
        this.hitNotes.add(matched);
        this.hits++;
        this._activeNoteObj.set(midiNote, matched);
        this.pendingSlice.splice(matchIdx, 1);
        this._advancePastSlice(matched.start);
        return { hit: true, note: midiNote, hand: matched.hand, onDeltaMs: onDelta };
      }

      // For chords: track matched notes, only confirm when all are held
      if (!this._sliceMatches) this._sliceMatches = new Set();
      this._sliceMatches.add(matchIdx);

      // Record timing for this note if not already recorded
      let onDelta;
      if (!this._noteToTimingIdx.has(matched)) {
        onDelta = this._recordNoteOn(matched, nowMs);
      } else {
        onDelta = this.timingLog[this._noteToTimingIdx.get(matched)].onDeltaMs;
      }

      // Check if all slice notes are currently held down
      const allHeld = this.pendingSlice.every(n => this.physicalKeys.has(n.note));
      if (allHeld) {
        const sliceStart = this.pendingSlice[0].start;
        for (const n of this.pendingSlice) {
          // Record timing for chord notes not yet recorded
          if (!this._noteToTimingIdx.has(n)) {
            this._recordNoteOn(n, nowMs);
          }
          this.hitNotes.add(n);
          this.hits++;
          this._activeNoteObj.set(n.note, n);
        }
        this.pendingSlice = [];
        this._sliceMatches = null;
        this._advancePastSlice(sliceStart);
      }
      return { hit: true, note: midiNote, hand: matched.hand, onDeltaMs: onDelta };
    }

    this.misses++;
    return { hit: false, note: midiNote };
  }

  noteOff(midiNote) {
    const nowMs = performance.now();
    this.physicalKeys.delete(midiNote);
    // Clear partial chord matches when a key is released
    if (this._sliceMatches) {
      this._sliceMatches = null;
    }

    // Close the timing entry for the specific note object this key was playing.
    const noteObj = this._activeNoteObj.get(midiNote);
    if (noteObj) {
      this._activeNoteObj.delete(midiNote);
      const idx = this._noteToTimingIdx.get(noteObj);
      if (idx !== undefined) {
        const entry = this.timingLog[idx];
        if (entry.offDeltaMs === null) {
          if (this.mode === MODE_PRACTICE) {
            // In practice mode, wall-clock time doesn't map to beats (the
            // song waits for input). Compute offBeat from actual hold
            // duration relative to the press time.
            const holdMs = nowMs - entry.onTimeMs;
            const holdBeats = (holdMs / 60000) * this.tempo;
            entry.offBeat = noteObj.start + holdBeats;
            entry.offDeltaMs = holdMs - this._beatToMs(noteObj.duration);
          } else {
            const expectedEndMs = this._beatToMs(noteObj.start + noteObj.duration) + this.startTimeMs;
            entry.offDeltaMs = nowMs - expectedEndMs;
            const expectedEndBeat = noteObj.start + noteObj.duration;
            entry.offBeat = expectedEndBeat + (entry.offDeltaMs / 60000) * this.tempo;
          }
        }
      }
    }

    // Complete song after the last note is released
    if (this.pendingSlice.length === 0 && this.hits === this.totalNotes && !this.completed) {
      const allReleased = this.timingLog.every(e => e.offDeltaMs !== null);
      if (allReleased) {
        this._completeSong();
      }
    }
  }

  _advancePastSlice(sliceStart) {
    // In practice mode, snap currentBeat to the slice and set up smooth
    // scroll-through of the note duration. In performance mode, currentBeat
    // is driven by wall-clock time — never overwrite it on a hit.
    if (this.mode === MODE_PRACTICE) {
      this.currentBeat = sliceStart;

      let maxEnd = sliceStart;
      for (const note of this.allNotes) {
        if (Math.abs(note.start - sliceStart) < 0.001 && this.hitNotes.has(note)) {
          maxEnd = Math.max(maxEnd, note.start + note.duration);
        }
      }
      this._practiceScrollTarget = maxEnd;
      this.lastFrameTime = null; // reset so smooth advance starts fresh
    }

    this._computePendingSlice();
  }

  _completeSong() {
    this.completed = true;
    this.playing = false;
    const score = this.totalNotes > 0 ? Math.round((this.hits / this.totalNotes) * 100) : 0;
    const stars = starsForScore(score);
    const accuracy = computeAccuracy(this.timingLog);
    if (this.onComplete) {
      this.onComplete({ score, stars, hits: this.hits, misses: this.misses, total: this.totalNotes, accuracy });
    }
  }

  // Called each frame
  update(now) {
    if (!this.playing || this.completed) return;
    if (this.waitingForFirstKey) return; // freeze until first keypress

    if (this.mode === MODE_PERFORMANCE) {
      if (this.lastFrameTime === null) {
        this.lastFrameTime = now;
        return;
      }
      const deltaMs = now - this.lastFrameTime;
      this.lastFrameTime = now;
      const deltaBeats = (deltaMs / 60000) * this.tempo;
      this.currentBeat += deltaBeats;

      // In performance mode, check for missed notes
      for (const note of this.allNotes) {
        if (this.hitNotes.has(note)) continue;
        if (note.start < this.currentBeat - 0.5) {
          // Missed
          this.hitNotes.add(note); // mark as passed
          this.pendingSlice = this.pendingSlice.filter(n => n !== note);
        }
      }
      this._computePendingSlice();

      // Check completion
      const remaining = this.allNotes.filter(n => !this.hitNotes.has(n));
      if (remaining.length === 0) {
        this._completeSong();
      }
    } else {
      // In practice mode, advance smoothly:
      // 1. Through the current note's duration (scroll target from _advancePastSlice)
      // 2. Then toward the next pending slice's start beat
      // 3. Stop at the next slice and wait for input
      const scrollTarget = this._practiceScrollTarget || 0;
      let targetBeat;
      if (this.currentBeat < scrollTarget) {
        // Still scrolling through the held note's duration
        targetBeat = scrollTarget;
      } else if (this.pendingSlice.length > 0) {
        // Advance toward the next slice
        targetBeat = this.pendingSlice[0].start;
      } else {
        targetBeat = null;
      }

      if (targetBeat !== null && this.currentBeat < targetBeat) {
        if (this.lastFrameTime === null) {
          this.lastFrameTime = now;
          return;
        }
        const deltaMs = now - this.lastFrameTime;
        this.lastFrameTime = now;
        const deltaBeats = (deltaMs / 60000) * this.tempo;
        this.currentBeat = Math.min(this.currentBeat + deltaBeats, targetBeat);
      }
    }
  }

  getScore() {
    if (this.totalNotes === 0) return 0;
    return Math.round((this.hits / this.totalNotes) * 100);
  }

  getAccuracy() {
    return computeAccuracy(this.timingLog);
  }
}
