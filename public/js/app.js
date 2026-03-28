import { Connection } from './connection.js';
import { PianoKeyboard } from './keyboard.js';
import { Waterfall } from './waterfall.js';
import { GameEngine } from './game.js';
import { SongListUI } from './songs.js';
import { CompletionScreen } from './progress.js';
import { COLORS, starsForScore } from './utils.js';

class App {
  constructor() {
    this.connection = new Connection();
    this.game = new GameEngine();
    this.currentSongId = null;
    this.songList = null;
    this.allSongs = [];

    // Screens
    this.songListScreen = document.getElementById('song-list-screen');
    this.playScreen = document.getElementById('play-screen');
    this.completionOverlay = document.getElementById('completion-overlay');

    // Playing view elements
    this.keyboard = new PianoKeyboard(document.getElementById('keyboard-canvas'));
    this.waterfall = new Waterfall(document.getElementById('waterfall-canvas'), this.keyboard);

    // Song list
    this.songListUI = new SongListUI(this.songListScreen);
    this.songListUI.onSelectSong = (id) => this._playSong(id);

    // Completion screen
    this.completionScreen = new CompletionScreen(this.completionOverlay);
    this.completionScreen.onRetry = () => this._playSong(this.currentSongId);
    this.completionScreen.onBack = () => this._showSongList();
    this.completionScreen.onNext = () => this._playNext();

    // Controls
    document.getElementById('btn-back-to-list').onclick = () => this._showSongList();
    document.getElementById('btn-restart').onclick = () => this._playSong(this.currentSongId);

    const waitToggle = document.getElementById('btn-wait-mode');
    waitToggle.onclick = () => {
      this.game.waitMode = !this.game.waitMode;
      waitToggle.textContent = this.game.waitMode ? 'Wait Mode: ON' : 'Wait Mode: OFF';
      waitToggle.classList.toggle('active', this.game.waitMode);
    };

    const tempoSlider = document.getElementById('tempo-slider');
    const tempoLabel = document.getElementById('tempo-value');
    tempoSlider.oninput = () => {
      const pct = parseInt(tempoSlider.value);
      tempoLabel.textContent = pct + '%';
      if (this.game.song) {
        this.game.setTempo(this.game.song.tempo * pct / 100);
      }
    };

    // MIDI connection
    this.connection.on('noteOn', (e) => this._onNoteOn(e));
    this.connection.on('noteOff', (e) => this._onNoteOff(e));

    // Connection status
    const statusEl = document.getElementById('connection-status');
    const setConnected = () => {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status connected';
    };
    this.connection.on('open', setConnected);
    this.connection.on('close', () => {
      statusEl.textContent = 'Reconnecting...';
      statusEl.className = 'status disconnected';
    });
    // If WebSocket already connected before listeners were registered
    if (this.connection.ws?.readyState === WebSocket.OPEN) {
      setConnected();
    }

    // Game completion
    this.game.onComplete = (result) => this._onSongComplete(result);

    // Start render loop
    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);

    // Initialize
    this._showSongList();
  }

  async _showSongList() {
    this.game.stop();
    this.playScreen.style.display = 'none';
    this.songListScreen.style.display = 'block';
    await this.songListUI.load();
    this.allSongs = this.songListUI.songs;
    this.songListUI.render();
  }

  async _playSong(songId) {
    this.currentSongId = songId;
    this.songListScreen.style.display = 'none';
    this.playScreen.style.display = 'flex';
    this.completionScreen.hide();

    // Fetch full song
    const res = await fetch(`/api/songs/${songId}`);
    const song = await res.json();

    // Update title bar
    document.getElementById('song-title').textContent = `${song.title} - ${song.composer}`;
    document.getElementById('score-display').textContent = '0%';

    // Destroy old keyboard to remove stale resize listeners
    this.keyboard.destroy();

    // Adjust keyboard range to song
    const noteNums = song.tracks.flatMap(t => t.notes.map(n => n.note));
    const minNote = noteNums.length > 0 ? Math.min(...noteNums) : 48;
    const maxNote = noteNums.length > 0 ? Math.max(...noteNums) : 84;
    // Expand range to include some padding and align to C
    const low = Math.max(21, Math.floor((minNote - 5) / 12) * 12);
    const high = Math.min(108, Math.ceil((maxNote + 5) / 12) * 12);
    this.keyboard = new PianoKeyboard(document.getElementById('keyboard-canvas'), low, high);
    this.waterfall.keyboard = this.keyboard;

    // Force resize now that the play screen is visible and layout has settled
    // Use rAF to ensure the browser has computed layout
    await new Promise(r => requestAnimationFrame(r));
    this.keyboard.resize();
    this.waterfall.resize();

    // Reset tempo slider
    const tempoSlider = document.getElementById('tempo-slider');
    tempoSlider.value = 100;
    document.getElementById('tempo-value').textContent = '100%';

    // Load and start
    this.game.loadSong(song);
    this.game.start();
  }

  _playNext() {
    if (!this.allSongs.length) {
      this._showSongList();
      return;
    }
    const idx = this.allSongs.findIndex(s => s.id === this.currentSongId);
    const nextIdx = (idx + 1) % this.allSongs.length;
    this._playSong(this.allSongs[nextIdx].id);
  }

  _onNoteOn(e) {
    if (!this.game.playing) {
      // Free play - just show on keyboard
      this.keyboard.pressKey(e.note, COLORS.rightHand);
      return;
    }

    const result = this.game.noteOn(e.note);
    if (result.hit) {
      const color = result.hand === 'left' ? COLORS.leftHand : COLORS.correct;
      this.keyboard.pressKey(e.note, color);
    } else {
      this.keyboard.flash(e.note, COLORS.wrong, 300);
      this.keyboard.pressKey(e.note, COLORS.wrong);
    }

    // Update score display
    document.getElementById('score-display').textContent = this.game.getScore() + '%';
  }

  _onNoteOff(e) {
    this.game.noteOff(e.note);
    this.keyboard.releaseKey(e.note);
  }

  _onSongComplete(result) {
    // Save progress
    this.connection.send({
      type: 'saveProgress',
      songId: this.currentSongId,
      score: result.score,
      stars: result.stars,
    });

    // Show completion
    const title = this.game.song?.title || this.currentSongId;
    this.completionScreen.show(result, title);
  }

  _renderLoop(now) {
    // Update game state
    this.game.update(now);

    // Update keyboard hints for pending notes
    if (this.game.playing && this.game.pendingSlice.length > 0) {
      const hintNotes = this.game.pendingSlice
        .filter(n => !this.game.hitNotes.has(n))
        .map(n => n.note);
      const hand = this.game.pendingSlice[0]?.hand || 'right';
      this.keyboard.setHints(hintNotes, hand);
    } else {
      this.keyboard.clearHints();
    }

    // Draw waterfall
    this.waterfall.draw(
      this.game.currentBeat,
      this.game.allNotes,
      this.game.hitNotes,
      this.game.getActiveSliceNotes(),
    );

    // Draw keyboard
    this.keyboard.draw(now);

    requestAnimationFrame(this._renderLoop);
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => new App());
