import { COLORS, DIFFICULTY_LABELS } from './utils.js';

export class SongListUI {
  constructor(container) {
    this.container = container;
    this.songs = [];
    this.progress = {};
    this.onSelectSong = null;
  }

  async load() {
    const [songsRes, progressRes] = await Promise.all([
      fetch('/api/songs'),
      fetch('/api/progress'),
    ]);
    this.songs = await songsRes.json();
    const progressData = await progressRes.json();
    this.progress = progressData.songs || {};
  }

  render() {
    this.container.innerHTML = '';

    const inner = document.createElement('div');
    inner.className = 'song-list-inner';
    this.container.appendChild(inner);

    // Header
    const header = document.createElement('div');
    header.className = 'song-list-header';
    header.innerHTML = `
      <h1>Piano Tutor</h1>
      <p class="subtitle">Select a song to start learning</p>
    `;
    inner.appendChild(header);

    // Recommended next
    const recommended = this._getRecommended();

    // Group by difficulty
    const grouped = new Map();
    for (const song of this.songs) {
      if (!grouped.has(song.difficulty)) grouped.set(song.difficulty, []);
      grouped.get(song.difficulty).push(song);
    }

    for (const [diff, songs] of grouped) {
      const section = document.createElement('div');
      section.className = 'difficulty-section';

      // Section header with progress
      const completed = songs.filter(s => this.progress[s.id]).length;
      section.innerHTML = `
        <div class="difficulty-header">
          <h2>Level ${diff}: ${DIFFICULTY_LABELS[diff] || ''}</h2>
          <span class="progress-count">${completed}/${songs.length}</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" style="width: ${songs.length > 0 ? (completed / songs.length) * 100 : 0}%"></div>
        </div>
      `;

      const list = document.createElement('div');
      list.className = 'song-cards';

      for (const song of songs) {
        const prog = this.progress[song.id];
        const isRecommended = recommended?.id === song.id;

        const card = document.createElement('div');
        card.className = 'song-card' + (isRecommended ? ' recommended' : '');
        card.innerHTML = `
          ${isRecommended ? '<span class="badge">Recommended</span>' : ''}
          <div class="song-card-main">
            <div class="song-title">${song.title}</div>
            <div class="song-composer">${song.composer}</div>
          </div>
          <div class="song-meta">
            <div class="stars">${this._renderStars(prog?.stars || 0)}</div>
            ${prog ? `<div class="best-score">${prog.bestScore}%</div>` : ''}
          </div>
          <div class="song-skill">${song.skillFocus || ''}</div>
        `;
        card.addEventListener('click', () => {
          if (this.onSelectSong) this.onSelectSong(song.id);
        });
        list.appendChild(card);
      }

      section.appendChild(list);
      inner.appendChild(section);
    }
  }

  _getRecommended() {
    // Find lowest-difficulty song that is uncompleted or has < 2 stars
    for (const song of this.songs) {
      const prog = this.progress[song.id];
      if (!prog || prog.stars < 2) return song;
    }
    return null;
  }

  _renderStars(count) {
    let html = '';
    for (let i = 0; i < 3; i++) {
      html += `<span class="star ${i < count ? 'filled' : ''}">\u2605</span>`;
    }
    return html;
  }
}
