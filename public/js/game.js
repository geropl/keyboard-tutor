import { starsForScore } from './utils.js';

export class GameEngine {
  constructor() {
    this.song = null;
    this.allNotes = [];       // flattened notes with hand property
    this.currentBeat = -2;    // start 2 beats before first note for visual lead-in
    this.hitNotes = new Set();
    this.totalNotes = 0;
    this.hits = 0;
    this.misses = 0;
    this.waitMode = true;
    this.playing = false;
    this.completed = false;
    this.tempo = 120;
    this.lastFrameTime = null;
    this.pendingSlice = [];   // notes in current time slice waiting to be played
    this.onComplete = null;

    // Track which physical keys are currently down
    this.physicalKeys = new Set();
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
    this._computePendingSlice();
  }

  start() {
    this.playing = true;
    this.lastFrameTime = performance.now();
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

  // Called on each noteOn from MIDI
  noteOn(midiNote) {
    this.physicalKeys.add(midiNote);
    if (!this.playing || this.completed) return { hit: false, note: midiNote };

    // Check if this note matches any pending slice note
    const matchIdx = this.pendingSlice.findIndex(n => n.note === midiNote && !this.hitNotes.has(n));
    if (matchIdx >= 0) {
      const matched = this.pendingSlice[matchIdx];

      // For single-note slices, register hit immediately
      if (this.pendingSlice.length === 1) {
        this.hitNotes.add(matched);
        this.hits++;
        this.pendingSlice.splice(matchIdx, 1);
        this._advancePastSlice(matched.start);
        return { hit: true, note: midiNote, hand: matched.hand };
      }

      // For chords: track matched notes, only confirm when all are held
      if (!this._sliceMatches) this._sliceMatches = new Set();
      this._sliceMatches.add(matchIdx);

      // Check if all slice notes are currently held down
      const allHeld = this.pendingSlice.every(n => this.physicalKeys.has(n.note));
      if (allHeld) {
        const sliceStart = this.pendingSlice[0].start;
        for (const n of this.pendingSlice) {
          this.hitNotes.add(n);
          this.hits++;
        }
        this.pendingSlice = [];
        this._sliceMatches = null;
        this._advancePastSlice(sliceStart);
      }
      return { hit: true, note: midiNote, hand: matched.hand };
    }

    this.misses++;
    return { hit: false, note: midiNote };
  }

  noteOff(midiNote) {
    this.physicalKeys.delete(midiNote);
    // Clear partial chord matches when a key is released
    if (this._sliceMatches) {
      this._sliceMatches = null;
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
    if (this.onComplete) {
      this.onComplete({ score, stars, hits: this.hits, misses: this.misses, total: this.totalNotes });
    }
  }

  // Called each frame in performance mode (non-wait)
  update(now) {
    if (!this.playing || this.completed) return;

    if (!this.waitMode) {
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
      // In wait mode, advance smoothly toward the next slice's beat
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
}
