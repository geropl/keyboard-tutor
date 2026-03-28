// Global session config — held in memory, resets on page refresh.

export const MODE_PRACTICE = 'practice';
export const MODE_PERFORMANCE = 'performance';

export const START_COUNTDOWN = 'countdown';
export const START_FIRST_KEYPRESS = 'first-keypress';

export class Config {
  constructor() {
    this.mode = MODE_PRACTICE;
    this.tempoPercent = 100;
    this.performanceStart = START_COUNTDOWN;
  }
}
