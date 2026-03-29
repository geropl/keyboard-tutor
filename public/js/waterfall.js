import { COLORS, isBlackKey } from './utils.js';

const NOTE_GAP = 10; // pixels between all consecutive notes for visual separation
const NOW_LINE_RATIO = 0.15; // now-line position: 15% up from the bottom
const PAST_BEATS = 1.5; // how many beats of past to show below the now-line

// Hold-bar color: green (perfect) → yellow (50% off) → deep red (100%+ off).
// accuracy is 0..1 where 1 = exact match, 0 = completely wrong.
function _holdBarColor(accuracy) {
  const a = Math.max(0, Math.min(1, accuracy));
  // green [76,175,80] → yellow [255,235,59] → red [183,28,28]
  let r, g, b;
  if (a >= 0.5) {
    const t = (a - 0.5) * 2; // 1 at perfect, 0 at midpoint
    r = Math.round(255 + (76 - 255) * t);
    g = Math.round(235 + (175 - 235) * t);
    b = Math.round(59 + (80 - 59) * t);
  } else {
    const t = a * 2; // 1 at midpoint, 0 at worst
    r = Math.round(183 + (255 - 183) * t);
    g = Math.round(28 + (235 - 28) * t);
    b = Math.round(28 + (59 - 28) * t);
  }
  return `rgb(${r}, ${g}, ${b})`;
}

export class Waterfall {
  constructor(canvas, keyboard) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyboard = keyboard;
    this.beatsVisible = 8; // how many beats of lookahead above the now-line
    this._tempo = 120;
    this._resizeHandler = () => this._resize();
    window.addEventListener('resize', this._resizeHandler);
    this._resize();
  }

  setTempo(tempo) {
    this._tempo = tempo;
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

  draw(currentBeat, songNotes, hitNotes, activeSliceNotes, timingMap) {
    const ctx = this.ctx;
    if (!this.width || !this.height) return; // not yet sized

    ctx.clearRect(0, 0, this.width, this.height);

    // Background
    ctx.fillStyle = COLORS.waterfallBg;
    ctx.fillRect(0, 0, this.width, this.height);

    // The now-line sits at NOW_LINE_RATIO from the bottom.
    // Above it: future notes scrolling down. Below it: recently-played past notes.
    const nowLineY = this.height * (1 - NOW_LINE_RATIO);
    const totalBeats = this.beatsVisible + PAST_BEATS;
    const pixelsPerBeat = this.height / totalBeats;
    const startBeat = currentBeat - PAST_BEATS;
    const endBeat = currentBeat + this.beatsVisible;

    // Dim the past zone
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, nowLineY, this.width, this.height - nowLineY);

    // Draw beat grid lines
    const firstBeat = Math.ceil(startBeat);
    for (let b = firstBeat; b <= endBeat; b++) {
      const y = nowLineY - (b - currentBeat) * pixelsPerBeat;
      ctx.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,0.15)' : COLORS.beatLine;
      ctx.lineWidth = b % 4 === 0 ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }

    // Draw notes
    if (!songNotes) return;

    const gapBeats = NOTE_GAP / pixelsPerBeat;
    const halfGap = gapBeats / 2;

    for (const note of songNotes) {
      const noteEnd = note.start + note.duration;
      // Skip notes not visible
      if (noteEnd < startBeat || note.start > endBeat) continue;

      const x = this.keyboard.getNoteX(note.note);
      if (x === null) continue;
      const w = this.keyboard.getNoteWidth(note.note) - 4;

      // Y position relative to the now-line: positive = above (future), negative = below (past)
      const yBottom = nowLineY - (note.start + halfGap - currentBeat) * pixelsPerBeat;
      const yTop = nowLineY - (noteEnd - halfGap - currentBeat) * pixelsPerBeat;

      const h = yBottom - yTop;
      if (h < 1) continue;

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

      // Glow for active slice notes
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

      // Reset shadow
      if (ctx.shadowBlur > 0) {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      // Duration slider: for hit notes, show actual hold duration as a bar
      // growing from the bottom of the note block upward. The bar can
      // overshoot the note block if the player holds longer than required.
      // Color reflects accuracy: green at 100%, fading to red when far off.
      if (isHit && timingMap) {
        const timing = timingMap.get(note);
        if (timing) {
          if (!this._dbgLogged) this._dbgLogged = 0;
          if (this._dbgLogged < 20) {
            console.log(`[waterfall] bar for note=${note.note} start=${note.start} offBeat=${timing.offBeat}`);
            this._dbgLogged++;
          }
          // For released notes, use the recorded offBeat.
          // For still-held notes, compute hold from wall-clock time so it
          // grows smoothly even in Practice mode (where currentBeat jumps).
          let holdDuration;
          if (timing.offBeat !== null) {
            holdDuration = timing.offBeat - note.start;
          } else {
            const elapsedMs = performance.now() - timing.onTimeMs;
            holdDuration = (elapsedMs / 60000) * (this._tempo || 120);
          }
          holdDuration = Math.max(0, holdDuration);
          const fillRatio = holdDuration / note.duration; // unclamped — can exceed 1.0

          if (fillRatio > 0) {
            // Accuracy: 1.0 = perfect, 0.0 = completely off
            const accuracy = Math.max(0, 1 - Math.abs(fillRatio - 1.0));
            const barColor = _holdBarColor(accuracy);

            // Horizontal slider line that moves from bottom to top of the note
            // (and beyond if held too long)
            const sliderY = yBottom - h * fillRatio;
            const lineH = 3;
            const margin = 2;
            ctx.fillStyle = barColor;
            ctx.beginPath();
            ctx.roundRect(x - w / 2 + margin, sliderY - lineH / 2, w - margin * 2, lineH, 1.5);
            ctx.fill();
          }
        }
      }

      // Note label — scale font with block height
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

    // Now-line
    ctx.strokeStyle = COLORS.hitLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, nowLineY);
    ctx.lineTo(this.width, nowLineY);
    ctx.stroke();
  }
}
