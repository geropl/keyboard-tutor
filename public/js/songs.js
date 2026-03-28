import { COLORS, DIFFICULTY_LABELS } from './utils.js';
import { MODE_PRACTICE, MODE_PERFORMANCE, START_COUNTDOWN, START_FIRST_KEYPRESS } from './config.js';

export class SongListUI {
  constructor(container, config) {
    this.container = container;
    this.config = config;
    this.songs = [];
    this.progress = {};
    this.onSelectSong = null;
    this.onPreviewSong = null;
    this.onImportMidi = null;
    this.onDeleteSong = null;
    this.onEditSong = null;
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
      <div class="header-row">
        <h1>Piano Tutor</h1>
        <div class="header-actions">
          <button class="btn btn-small btn-import" id="btn-import" title="Import MIDI file">Import MIDI</button>
          <button class="btn btn-icon btn-settings" id="btn-settings" title="Settings">&#9881;</button>
        </div>
      </div>
      <p class="subtitle">Select a song to start learning</p>
    `;
    inner.appendChild(header);

    header.querySelector('#btn-import').onclick = () => {
      if (this.onImportMidi) this.onImportMidi();
    };

    // Settings panel
    const panel = this._buildSettingsPanel();
    inner.appendChild(panel);

    header.querySelector('#btn-settings').onclick = () => {
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'block';
    };

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

      // Section header with progress — completed if either mode has progress
      const completed = songs.filter(s => {
        const p = this.progress[s.id];
        return p && (p.practice || p.performance);
      }).length;
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

        const prac = prog?.practice;
        const perf = prog?.performance;
        const bestScore = Math.max(prac?.bestScore || 0, perf?.bestScore || 0);

        const isImported = song.source === 'imported';
        const card = document.createElement('div');
        card.className = 'song-card' + (isRecommended ? ' recommended' : '') + (isImported ? ' imported' : '');
        card.innerHTML = `
          ${isRecommended ? '<span class="badge">Recommended</span>' : ''}
          ${isImported ? '<span class="badge badge-imported">Imported</span>' : ''}
          <div class="song-card-main">
            <div class="song-title">${song.title}</div>
            <div class="song-composer">${song.composer}</div>
          </div>
          <div class="song-meta">
            ${prac ? `<div class="mode-stars"><span class="mode-label">P</span>${this._renderStars(prac.stars)}</div>` : ''}
            ${perf ? `<div class="mode-stars"><span class="mode-label">F</span>${this._renderStars(perf.stars)}</div>` : ''}
            ${bestScore > 0 ? `<div class="best-score">${bestScore}%</div>` : ''}
          </div>
          <div class="song-skill">${song.skillFocus || ''}</div>
          <div class="song-card-actions">
            ${isImported ? '<button class="btn-edit" title="Edit song">&#9998;</button>' : ''}
            ${isImported ? '<button class="btn-delete" title="Delete song">&#10005;</button>' : ''}
            <button class="btn-preview" title="Preview song">&#9654;</button>
          </div>
        `;
        card.querySelector('.btn-preview').addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.onPreviewSong) this.onPreviewSong(song.id);
        });
        if (isImported) {
          card.querySelector('.btn-edit').addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onEditSong) this.onEditSong(song.id);
          });
          card.querySelector('.btn-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onDeleteSong) this.onDeleteSong(song.id);
          });
        }
        card.addEventListener('click', () => {
          if (this.onSelectSong) this.onSelectSong(song.id);
        });
        list.appendChild(card);
      }

      section.appendChild(list);
      inner.appendChild(section);
    }
  }

  _buildSettingsPanel() {
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.style.display = 'none';

    const isPractice = this.config.mode === MODE_PRACTICE;
    const isCountdown = this.config.performanceStart === START_COUNTDOWN;

    panel.innerHTML = `
      <div class="settings-group">
        <label class="settings-label">Mode</label>
        <div class="segmented-control" id="mode-control">
          <button class="seg-btn ${isPractice ? 'active' : ''}" data-value="${MODE_PRACTICE}">Practice</button>
          <button class="seg-btn ${!isPractice ? 'active' : ''}" data-value="${MODE_PERFORMANCE}">Performance</button>
        </div>
      </div>
      <div class="settings-group">
        <label class="settings-label">Tempo</label>
        <div class="settings-tempo">
          <input type="range" id="settings-tempo-slider" min="25" max="150" value="${this.config.tempoPercent}" step="5">
          <span id="settings-tempo-value">${this.config.tempoPercent}%</span>
        </div>
      </div>
      <div class="settings-group" id="start-behavior-group" style="display: ${isPractice ? 'none' : ''}">
        <label class="settings-label">Start Behavior</label>
        <div class="segmented-control" id="start-control">
          <button class="seg-btn ${isCountdown ? 'active' : ''}" data-value="${START_COUNTDOWN}">Countdown</button>
          <button class="seg-btn ${!isCountdown ? 'active' : ''}" data-value="${START_FIRST_KEYPRESS}">First Keypress</button>
        </div>
      </div>
    `;

    // Mode toggle
    panel.querySelector('#mode-control').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      this.config.mode = btn.dataset.value;
      panel.querySelectorAll('#mode-control .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      panel.querySelector('#start-behavior-group').style.display =
        this.config.mode === MODE_PRACTICE ? 'none' : '';
    });

    // Tempo slider
    const tempoSlider = panel.querySelector('#settings-tempo-slider');
    const tempoValue = panel.querySelector('#settings-tempo-value');
    tempoSlider.oninput = () => {
      this.config.tempoPercent = parseInt(tempoSlider.value);
      tempoValue.textContent = this.config.tempoPercent + '%';
    };

    // Start behavior toggle
    panel.querySelector('#start-control').addEventListener('click', (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      this.config.performanceStart = btn.dataset.value;
      panel.querySelectorAll('#start-control .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    });

    return panel;
  }

  _getRecommended() {
    // Find lowest-difficulty song where practice < 2 stars,
    // or practice >= 2 but performance < 2 (nudge toward performance).
    for (const song of this.songs) {
      const prog = this.progress[song.id];
      const pracStars = prog?.practice?.stars || 0;
      if (pracStars < 2) return song;
    }
    for (const song of this.songs) {
      const prog = this.progress[song.id];
      const perfStars = prog?.performance?.stars || 0;
      if (perfStars < 2) return song;
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
