import { COLORS, starsForScore } from './utils.js';

export class CompletionScreen {
  constructor(container) {
    this.container = container;
    this.onRetry = null;
    this.onNext = null;
    this.onBack = null;
  }

  show(result, songTitle) {
    this.container.innerHTML = '';
    this.container.style.display = 'flex';

    const panel = document.createElement('div');
    panel.className = 'completion-panel';

    const starsHtml = [0, 1, 2].map(i =>
      `<span class="completion-star ${i < result.stars ? 'filled' : ''}">\u2605</span>`
    ).join('');

    panel.innerHTML = `
      <h2>Song Complete!</h2>
      <div class="completion-title">${songTitle}</div>
      <div class="completion-stars">${starsHtml}</div>
      <div class="completion-score">${result.score}%</div>
      <div class="completion-details">
        ${result.hits} / ${result.total} notes hit
        ${result.misses > 0 ? `<br>${result.misses} wrong notes` : ''}
      </div>
      <div class="completion-buttons">
        <button class="btn btn-secondary" id="btn-retry">Retry</button>
        <button class="btn btn-secondary" id="btn-back">Song List</button>
        <button class="btn btn-primary" id="btn-next">Next Song</button>
      </div>
    `;

    this.container.appendChild(panel);

    panel.querySelector('#btn-retry').onclick = () => {
      this.hide();
      if (this.onRetry) this.onRetry();
    };
    panel.querySelector('#btn-back').onclick = () => {
      this.hide();
      if (this.onBack) this.onBack();
    };
    panel.querySelector('#btn-next').onclick = () => {
      this.hide();
      if (this.onNext) this.onNext();
    };
  }

  hide() {
    this.container.style.display = 'none';
    this.container.innerHTML = '';
  }
}
