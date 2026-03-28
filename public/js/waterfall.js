import { COLORS, isBlackKey } from './utils.js';

export class Waterfall {
  constructor(canvas, keyboard) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyboard = keyboard;
    this.beatsVisible = 8; // how many beats of lookahead
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
  }

  draw(currentBeat, songNotes, hitNotes, activeSliceNotes) {
    const ctx = this.ctx;
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

    for (const note of songNotes) {
      const noteEnd = note.start + note.duration;
      // Skip notes not visible
      if (noteEnd < startBeat || note.start > endBeat) continue;

      const x = this.keyboard.getNoteX(note.note);
      if (x === null) continue;
      const w = this.keyboard.getNoteWidth(note.note) - 4;

      // Y position: bottom = current beat, top = future
      const yBottom = this.height - (note.start - startBeat) * pixelsPerBeat;
      const yTop = this.height - (noteEnd - startBeat) * pixelsPerBeat;
      const h = yBottom - yTop;

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

      // Draw rounded rect
      const radius = Math.min(4, w / 2, Math.abs(h) / 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, yTop, w, h, radius);
      ctx.fill();

      // Glow for active slice notes
      if (isActive && !isHit) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, yTop, w, h, radius);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Note label for active notes near hit line
      if (isActive && !isHit && h > 14) {
        ctx.fillStyle = '#fff';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note.note % 12];
        ctx.fillText(label, x, yTop + Math.min(h / 2, 12));
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
