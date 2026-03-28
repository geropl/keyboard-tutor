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
    this.startTimeMs = 0;
    this._computePendingSlice();
  }

  start() {
    this.playing = true;
    const now = performance.now();
    this.lastFrameTime = now;
    this.startTimeMs = now;
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
    const entry = {
      note: noteObj.note,
      hand: noteObj.hand,
      onDeltaMs: onDelta,
      offDeltaMs: null,
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

    // Performance mode: first keypress starts time
    if (this.waitingForFirstKey) {
      this.waitingForFirstKey = false;
      this.lastFrameTime = nowMs;
      this.startTimeMs = nowMs;
    }

    // Check if this note matches any pending slice note
    const matchIdx = this.pendingSlice.findIndex(n => n.note === midiNote && !this.hitNotes.has(n));
    if (matchIdx >= 0) {
      const matched = this.pendingSlice[matchIdx];

      // For single-note slices, register hit immediately
      if (this.pendingSlice.length === 1) {
        const onDelta = this._recordNoteOn(matched, nowMs);
        this.hitNotes.add(matched);
        this.hits++;
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

    // Record release timing for the most recent hit of this note
    for (let i = this.timingLog.length - 1; i >= 0; i--) {
      const entry = this.timingLog[i];
      if (entry.note === midiNote && entry.offDeltaMs === null) {
        const noteObj = entry._noteObj;
        const expectedEndMs = this._beatToMs(noteObj.start + noteObj.duration) + this.startTimeMs;
        entry.offDeltaMs = nowMs - expectedEndMs;
        break;
      }
    }
  }

  _advancePastSlice(sliceStart) {
    // Move currentBeat to this slice's start so waterfall aligns
    this.currentBeat = sliceStart;
    this._computePendingSlice();

    // Check if song is complete
    if (this.pendingSlice.length === 0 && this.hits === this.totalNotes) {
      this._completeSong();
    }
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
      // In practice mode, advance smoothly toward the next slice's beat
      if (this.pendingSlice.length > 0) {
        const targetBeat = this.pendingSlice[0].start;
        if (this.currentBeat < targetBeat) {
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
  }

  getScore() {
    if (this.totalNotes === 0) return 0;
    return Math.round((this.hits / this.totalNotes) * 100);
  }

  getAccuracy() {
    return computeAccuracy(this.timingLog);
  }
}
