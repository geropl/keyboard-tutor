import { isBlackKey, COLORS } from './utils.js';

export class PianoKeyboard {
  constructor(canvas, lowNote = 48, highNote = 84) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.lowNote = lowNote;   // C3
    this.highNote = highNote; // C6
    this.pressedKeys = new Map(); // note -> color
    this.flashKeys = new Map();   // note -> { color, expiry }
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
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
