// Global session config — held in memory, resets on page refresh.

export const MODE_PRACTICE = 'practice';
export const MODE_PERFORMANCE = 'performance';

export const START_COUNTDOWN = 'countdown';
export const START_FIRST_KEYPRESS = 'first-keypress';

// Input sources for MIDI note events
export const INPUT_BACKEND = 'backend';   // WebSocket relay from server-side MIDI device
export const INPUT_DEBUG = 'debug';       // Click/tap keys on screen
// export const INPUT_WEB_MIDI = 'web-midi'; // Future: Web MIDI API

export class Config {
  constructor() {
    this.mode = MODE_PRACTICE;
    this.tempoPercent = 100;
    this.performanceStart = START_COUNTDOWN;
    this.inputSource = INPUT_BACKEND;
  }
}
