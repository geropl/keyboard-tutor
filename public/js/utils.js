// Note names
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

export function isBlackKey(midi) {
  const n = midi % 12;
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10;
}

// Colors
export const COLORS = {
  rightHand: '#4A90D9',
  leftHand: '#E8943A',
  correct: '#4CAF50',
  wrong: '#E53935',
  hint: 'rgba(74, 144, 217, 0.25)',
  hintLeft: 'rgba(232, 148, 58, 0.25)',
  whiteKey: '#FFFFFF',
  whiteKeyPressed: '#E0E0E0',
  blackKey: '#1A1A1A',
  blackKeyPressed: '#444444',
  background: '#1a1a2e',
  waterfallBg: '#0f0f23',
  hitLine: '#FFD700',
  beatLine: 'rgba(255, 255, 255, 0.08)',
  text: '#EEEEEE',
  textDim: '#888888',
  surface: '#16213e',
  surfaceHover: '#1a2a4a',
  accent: '#FFD700',
  starEmpty: '#444444',
  starFilled: '#FFD700',
};

// Difficulty labels
export const DIFFICULTY_LABELS = ['', 'First Steps', 'Getting Comfortable', 'Both Hands', 'Building Fluency', 'Confident Player'];

export function starsForScore(score) {
  if (score >= 95) return 3;
  if (score >= 80) return 2;
  if (score >= 60) return 1;
  return 0;
}

export function beatToMs(beat, tempo) {
  return beat * 60000 / tempo;
}
