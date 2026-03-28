import { COLORS, isBlackKey } from './utils.js';

const NOTE_GAP = 6; // pixels between consecutive notes for visual separation

export class Waterfall {
  constructor(canvas, keyboard) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyboard = keyboard;
    this.beatsVisible = 8; // how many beats of lookahead
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    this._resize();
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
  }

  draw(currentBeat, songNotes, hitNotes, activeSliceNotes) {
    const ctx = this.ctx;
    if (!this.width || !this.height) return; // not yet sized

    ctx.clearRect(0, 0, this.width, this.height);

    // Background
    ctx.fillStyle = COLORS.waterfallBg;
    ctx.fillRect(0, 0, this.width, this.height);

    const pixelsPerBeat = this.height / this.beatsVisible;
    const startBeat = currentBeat;
    const endBeat = currentBeat + this.beatsVisible;

    // Draw beat grid lines
    const firstBeat = Math.ceil(startBeat);
    for (let b = firstBeat; b <= endBeat; b++) {
      const y = this.height - (b - startBeat) * pixelsPerBeat;
      ctx.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,0.15)' : COLORS.beatLine;
      ctx.lineWidth = b % 4 === 0 ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Draw notes
    if (!songNotes) return;

    // Build a lookup for quick "is there a following same-pitch note?" check
    const nextSamePitch = new Map();
    for (let i = 0; i < songNotes.length; i++) {
      const n = songNotes[i];
      const end = n.start + n.duration;
      for (let j = i + 1; j < songNotes.length; j++) {
        if (songNotes[j].start > end + 0.01) break;
        if (songNotes[j].note === n.note && Math.abs(songNotes[j].start - end) < 0.01) {
          nextSamePitch.set(n, true);
          break;
        }
      }
    }

    for (const note of songNotes) {
      const noteEnd = note.start + note.duration;
      // Skip notes not visible
      if (noteEnd < startBeat || note.start > endBeat) continue;

      const x = this.keyboard.getNoteX(note.note);
      if (x === null) continue;
      const w = this.keyboard.getNoteWidth(note.note) - 4;

      // Y position: bottom = current beat, top = future
      let yBottom = this.height - (note.start - startBeat) * pixelsPerBeat;
      const yTop = this.height - (noteEnd - startBeat) * pixelsPerBeat;

      // Add visual gap if there's a following note at the same pitch
      if (nextSamePitch.has(note)) {
        yBottom -= NOTE_GAP;
      }

      const h = yBottom - yTop;
      if (h < 1) continue; // too small to draw

      const isHit = hitNotes?.has(note);
      const isActive = activeSliceNotes?.has(note);

      // Color based on hand and state
      let color;
      if (isHit) {
        color = COLORS.correct;
      } else if (note.hand === 'left') {
        color = COLORS.leftHand;
      } else {
        color = COLORS.rightHand;
      }

      // Glow for active slice notes (set shadow before drawing)
      if (isActive && !isHit) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
      }

      // Draw rounded rect
      const radius = Math.min(4, w / 2, h / 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, yTop, w, h, radius);
      ctx.fill();

      // Darker bottom edge to help distinguish stacked notes of different lengths
      if (h > 6) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        const edgeH = Math.min(3, h / 3);
        ctx.fillRect(x - w / 2, yBottom - edgeH, w, edgeH);
      }

      // Reset shadow
      if (ctx.shadowBlur > 0) {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Note label on every note — scale font with block height
      if (h > 12) {
        const label = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note.note % 12];
        const fontSize = Math.min(Math.max(Math.floor(h * 0.45), 13), 28);
        ctx.fillStyle = isHit ? 'rgba(255,255,255,0.5)' : '#fff';
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x, yTop + h / 2);
      }
    }

    // Hit line
    ctx.strokeStyle = COLORS.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, this.height - 1);
    ctx.lineTo(this.width, this.height - 1);
    ctx.stroke();
  }
}
