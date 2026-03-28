// Scheduled playback engine for play-mode song preview.
// Advances currentBeat via requestAnimationFrame and fires note-on/off callbacks.

export class Player {
  constructor() {
    this.song = null;
    this.tempo = 120;         // BPM
    this.allNotes = [];       // flattened: { note, hand, start, duration }
    this.currentBeat = -2;
    this.playing = false;

    // Callbacks
    this.onNoteOn = null;     // (note, hand) => void
    this.onNoteOff = null;    // (note) => void
    this.onComplete = null;   // () => void

    this._startTime = null;   // performance.now() when playback began
    this._startBeat = -2;
    this._activeNotes = new Map(); // index -> true (notes currently sounding)
    this._rafId = null;
    this._completionTimeout = null;

    this._tick = this._tick.bind(this);
  }

  load(song, tempo) {
    this.stop();
    this.song = song;
    this.tempo = tempo;
    this.allNotes = [];
    for (const track of song.tracks) {
      for (const note of track.notes) {
        this.allNotes.push({ note: note.note, hand: track.hand, start: note.start, duration: note.duration });
      }
    }
    this.allNotes.sort((a, b) => a.start - b.start || a.note - b.note);
    this.currentBeat = -2;
    this._activeNotes.clear();
  }

  start() {
    if (!this.song) return;
    this.playing = true;
    this._startBeat = this.currentBeat;
    this._startTime = performance.now();
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this.playing = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._completionTimeout) {
      clearTimeout(this._completionTimeout);
      this._completionTimeout = null;
    }
    // Fire note-off for any still-sounding notes
    for (const [idx] of this._activeNotes) {
      const n = this.allNotes[idx];
      if (n && this.onNoteOff) this.onNoteOff(n.note);
    }
    this._activeNotes.clear();
  }

  setTempo(tempo) {
    if (!this.playing) {
      this.tempo = tempo;
      return;
    }
    // Anchor current position so tempo change doesn't jump
    this._startBeat = this.currentBeat;
    this._startTime = performance.now();
    this.tempo = tempo;
  }

  _tick(now) {
    if (!this.playing) return;

    const elapsedMs = now - this._startTime;
    const elapsedBeats = (elapsedMs / 60000) * this.tempo;
    this.currentBeat = this._startBeat + elapsedBeats;

    // Fire note-on for notes whose start has been reached
    for (let i = 0; i < this.allNotes.length; i++) {
      const n = this.allNotes[i];
      if (this._activeNotes.has(i)) continue;
      if (n._played) continue;
      if (n.start <= this.currentBeat) {
        this._activeNotes.set(i, true);
        n._played = true;
        if (this.onNoteOn) this.onNoteOn(n.note, n.hand);
      }
    }

    // Fire note-off for notes whose end has been reached
    for (const [idx] of this._activeNotes) {
      const n = this.allNotes[idx];
      if (n.start + n.duration <= this.currentBeat) {
        this._activeNotes.delete(idx);
        if (this.onNoteOff) this.onNoteOff(n.note);
      }
    }

    // Check completion: all notes played and released
    const lastNote = this.allNotes[this.allNotes.length - 1];
    if (lastNote && this.currentBeat >= lastNote.start + lastNote.duration) {
      this.playing = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      if (this.onComplete) {
        this._completionTimeout = setTimeout(() => this.onComplete(), 1000);
      }
      return;
    }

    this._rafId = requestAnimationFrame(this._tick);
  }
}
