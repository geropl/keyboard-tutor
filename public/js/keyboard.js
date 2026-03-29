import { isBlackKey, COLORS } from './utils.js';

export class PianoKeyboard {
  constructor(canvas, lowNote = 48, highNote = 84) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lowNote = lowNote;   // C3
    this.highNote = highNote; // C6
    this.pressedKeys = new Map(); // note -> color
    this.flashKeys = new Map();   // note -> { color, expiry }
    this.whiteKeys = [];
    this.blackKeys = [];
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    this._resize();
  }

  destroy() {
    window.removeEventListener('resize', this._resizeHandler);
  }

  resize() {
    this._resize();
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // skip if hidden
    this.canvas.width = rect.width * devicePixelRatio;
    this.canvas.height = rect.height * devicePixelRatio;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this._computeKeyLayout();
  }

  _computeKeyLayout() {
    this.whiteKeys = [];
    this.blackKeys = [];
    // Count white keys
    let whiteCount = 0;
    for (let n = this.lowNote; n <= this.highNote; n++) {
      if (!isBlackKey(n)) whiteCount++;
    }
    const whiteWidth = this.width / whiteCount;
    const blackWidth = whiteWidth * 0.6;
    const blackHeight = this.height * 0.6;

    let whiteIdx = 0;
    for (let n = this.lowNote; n <= this.highNote; n++) {
      if (!isBlackKey(n)) {
        this.whiteKeys.push({
          note: n,
          x: whiteIdx * whiteWidth,
          y: 0,
          w: whiteWidth,
          h: this.height,
        });
        whiteIdx++;
      }
    }

    // Black keys positioned relative to their neighboring white keys
    for (let n = this.lowNote; n <= this.highNote; n++) {
      if (isBlackKey(n)) {
        // Find the white key to the left
        const leftWhite = this.whiteKeys.find(k => k.note === n - 1);
        if (leftWhite) {
          this.blackKeys.push({
            note: n,
            x: leftWhite.x + leftWhite.w - blackWidth / 2,
            y: 0,
            w: blackWidth,
            h: blackHeight,
          });
        }
      }
    }
  }

  pressKey(note, color) {
    this.pressedKeys.set(note, color);
  }

  releaseKey(note) {
    this.pressedKeys.delete(note);
  }

  flash(note, color, durationMs = 300) {
    this.flashKeys.set(note, { color, expiry: performance.now() + durationMs });
  }

  setHints(notes, hand) {
    this._hints = new Map();
    for (const n of notes) {
      this._hints.set(n, hand === 'left' ? COLORS.hintLeft : COLORS.hint);
    }
  }

  clearHints() {
    this._hints = null;
  }



  draw(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Clean expired flashes
    for (const [note, f] of this.flashKeys) {
      if (now > f.expiry) this.flashKeys.delete(note);
    }

    // Draw white keys
    for (const key of this.whiteKeys) {
      const pressed = this.pressedKeys.get(key.note);
      const flash = this.flashKeys.get(key.note);
      const hint = this._hints?.get(key.note);

      if (pressed) {
        ctx.fillStyle = pressed;
      } else if (flash) {
        ctx.fillStyle = flash.color;
      } else if (hint) {
        ctx.fillStyle = hint;
      } else {
        ctx.fillStyle = COLORS.whiteKey;
      }
      ctx.fillRect(key.x, key.y, key.w, key.h);
      ctx.strokeStyle = '#999';
      ctx.lineWidth = 1;
      ctx.strokeRect(key.x, key.y, key.w, key.h);
    }

    // Draw black keys
    for (const key of this.blackKeys) {
      const pressed = this.pressedKeys.get(key.note);
      const flash = this.flashKeys.get(key.note);
      const hint = this._hints?.get(key.note);

      if (pressed) {
        ctx.fillStyle = pressed;
      } else if (flash) {
        ctx.fillStyle = flash.color;
      } else if (hint) {
        // Darker hint for black keys
        ctx.fillStyle = COLORS.blackKey;
        ctx.fillRect(key.x, key.y, key.w, key.h);
        ctx.fillStyle = hint;
        ctx.fillRect(key.x, key.y, key.w, key.h);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(key.x, key.y, key.w, key.h);
        continue;
      } else {
        ctx.fillStyle = COLORS.blackKey;
      }
      ctx.fillRect(key.x, key.y, key.w, key.h);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(key.x, key.y, key.w, key.h);
    }
  }

  // --- Interactive (debug) input ---

  // Enable click/touch input. Calls onNoteOn(note) on press, onNoteOff(note) on release.
  enableInput(onNoteOn, onNoteOff) {
    this.disableInput();
    this._inputNoteOn = onNoteOn;
    this._inputNoteOff = onNoteOff;
    this._activePointers = new Map(); // pointerId -> note

    this._onPointerDown = (e) => {
      e.preventDefault();
      const note = this._noteAtPoint(e.offsetX, e.offsetY);
      if (note === null) return;
      this._activePointers.set(e.pointerId, note);
      this.canvas.setPointerCapture(e.pointerId);
      if (this._inputNoteOn) this._inputNoteOn(note);
    };

    this._onPointerMove = (e) => {
      if (!this._activePointers.has(e.pointerId)) return;
      const prev = this._activePointers.get(e.pointerId);
      const curr = this._noteAtPoint(e.offsetX, e.offsetY);
      if (curr !== prev) {
        // Dragged to a different key — release old, press new
        if (prev !== null && this._inputNoteOff) this._inputNoteOff(prev);
        this._activePointers.set(e.pointerId, curr);
        if (curr !== null && this._inputNoteOn) this._inputNoteOn(curr);
      }
    };

    this._onPointerUp = (e) => {
      const note = this._activePointers.get(e.pointerId);
      this._activePointers.delete(e.pointerId);
      if (note !== null && this._inputNoteOff) this._inputNoteOff(note);
    };

    this.canvas.style.touchAction = 'none'; // prevent scroll on touch
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    this.canvas.addEventListener('pointercancel', this._onPointerUp);
  }

  disableInput() {
    if (this._onPointerDown) {
      this.canvas.removeEventListener('pointerdown', this._onPointerDown);
      this.canvas.removeEventListener('pointermove', this._onPointerMove);
      this.canvas.removeEventListener('pointerup', this._onPointerUp);
      this.canvas.removeEventListener('pointercancel', this._onPointerUp);
      this._onPointerDown = null;
      this._onPointerMove = null;
      this._onPointerUp = null;
    }
    // Release any held notes
    if (this._activePointers) {
      for (const [, note] of this._activePointers) {
        if (note !== null && this._inputNoteOff) this._inputNoteOff(note);
      }
      this._activePointers = null;
    }
    this.canvas.style.touchAction = '';
    this._inputNoteOn = null;
    this._inputNoteOff = null;
  }

  // Returns the MIDI note number at the given canvas-local pixel coordinates,
  // or null if outside the keyboard. Black keys are checked first (they overlap white keys).
  _noteAtPoint(px, py) {
    // Check black keys first (they sit on top)
    for (const key of this.blackKeys) {
      if (px >= key.x && px <= key.x + key.w && py >= key.y && py <= key.y + key.h) {
        return key.note;
      }
    }
    for (const key of this.whiteKeys) {
      if (px >= key.x && px <= key.x + key.w && py >= key.y && py <= key.y + key.h) {
        return key.note;
      }
    }
    return null;
  }

  // Get pixel x-center for a given note (used by waterfall alignment)
  getNoteX(note) {
    if (isBlackKey(note)) {
      const bk = this.blackKeys.find(k => k.note === note);
      return bk ? bk.x + bk.w / 2 : null;
    }
    const wk = this.whiteKeys.find(k => k.note === note);
    return wk ? wk.x + wk.w / 2 : null;
  }

  getNoteWidth(note) {
    if (isBlackKey(note)) {
      const bk = this.blackKeys.find(k => k.note === note);
      return bk ? bk.w : 20;
    }
    const wk = this.whiteKeys.find(k => k.note === note);
    return wk ? wk.w : 30;
  }
}
