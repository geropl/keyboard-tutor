// Simple Web Audio piano synthesizer for play-mode preview.

const MASTER_GAIN = 0.15;
const ATTACK_MS = 10;
const RELEASE_MS = 50;

function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export class PianoAudio {
  constructor() {
    this.ctx = null;       // AudioContext, created lazily
    this.masterGain = null;
    this.active = new Map(); // handle -> { osc, gain }
    this._nextHandle = 0;
  }

  _ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = MASTER_GAIN;
    this.masterGain.connect(this.ctx.destination);
  }

  // Start a note. Returns a numeric handle for noteOff.
  noteOn(midiNote) {
    this._ensureContext();

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midiNote);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + ATTACK_MS / 1000);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();

    const handle = this._nextHandle++;
    this.active.set(handle, { osc, gain });
    return handle;
  }

  // Release a note by handle.
  noteOff(handle) {
    const entry = this.active.get(handle);
    if (!entry) return;
    this.active.delete(handle);

    const { osc, gain } = entry;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + RELEASE_MS / 1000);
    osc.stop(now + RELEASE_MS / 1000 + 0.05);
  }

  // Kill all active notes immediately.
  stopAll() {
    for (const [handle, { osc, gain }] of this.active) {
      try {
        gain.gain.cancelScheduledValues(0);
        gain.gain.value = 0;
        osc.stop();
      } catch (_) { /* already stopped */ }
    }
    this.active.clear();
  }
}
