import { Connection } from './connection.js';
import { PianoKeyboard } from './keyboard.js';
import { Waterfall } from './waterfall.js';
import { GameEngine } from './game.js';
import { Player } from './player.js';
import { PianoAudio } from './audio.js';
import { SongListUI } from './songs.js';
import { CompletionScreen } from './progress.js';
import { COLORS, starsForScore, timingAccuracyFromDelta, colorForAccuracy } from './utils.js';
import { Config, MODE_PRACTICE, MODE_PERFORMANCE, START_COUNTDOWN, START_FIRST_KEYPRESS } from './config.js';

class App {
  constructor() {
    this.config = new Config();
    this.connection = new Connection();
    this.game = new GameEngine();
    this.player = new Player();
    this.audio = new PianoAudio();
    this.currentSongId = null;
    this.songList = null;
    this.allSongs = [];
    this.previewMode = false;
    this._audioHandles = new Map(); // midiNote -> audio handle

    // Screens
    this.songListScreen = document.getElementById('song-list-screen');
    this.playScreen = document.getElementById('play-screen');
    this.completionOverlay = document.getElementById('completion-overlay');

    // Playing view elements
    this.keyboard = new PianoKeyboard(document.getElementById('keyboard-canvas'));
    this.waterfall = new Waterfall(document.getElementById('waterfall-canvas'), this.keyboard);

    // Song list
    this.songListUI = new SongListUI(this.songListScreen, this.config);
    this.songListUI.onSelectSong = (id) => this._playSong(id);
    this.songListUI.onPreviewSong = (id) => this._previewSong(id);

    // Completion screen
    this.completionScreen = new CompletionScreen(this.completionOverlay);
    this.completionScreen.onRetry = () => this._playSong(this.currentSongId);
    this.completionScreen.onBack = () => this._showSongList();
    this.completionScreen.onNext = () => this._playNext();

    // Controls
    document.getElementById('btn-back-to-list').onclick = () => this._showSongList();
    document.getElementById('btn-restart').onclick = () => this._playSong(this.currentSongId);

    const modeToggle = document.getElementById('btn-mode');
    modeToggle.onclick = () => {
      const next = this.game.mode === MODE_PRACTICE ? MODE_PERFORMANCE : MODE_PRACTICE;
      this.game.mode = next;
      this.config.mode = next;
      modeToggle.textContent = next === MODE_PRACTICE ? 'Practice' : 'Performance';
      modeToggle.classList.toggle('active', next === MODE_PRACTICE);
    };

    const tempoSlider = document.getElementById('tempo-slider');
    const tempoLabel = document.getElementById('tempo-value');
    tempoSlider.oninput = () => {
      const pct = parseInt(tempoSlider.value);
      tempoLabel.textContent = pct + '%';
      this.config.tempoPercent = pct;
      if (this.previewMode && this.player.song) {
        this.player.setTempo(this.player.song.tempo * pct / 100);
      } else if (this.game.song) {
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
    this.player.stop();
    this.audio.stopAll();
    this._audioHandles.clear();
    this.previewMode = false;
    this._setControlsMode('game');
    this.playScreen.style.display = 'none';
    this.songListScreen.style.display = 'block';
    await this.songListUI.load();
    this.allSongs = this.songListUI.songs;
    this.songListUI.render();
  }

  async _playSong(songId) {
    // Clean up any active preview
    this.player.stop();
    this.audio.stopAll();
    this._audioHandles.clear();
    this.previewMode = false;
    this._setControlsMode('game');

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

    // Apply global config tempo (preserved across restart/retry)
    const tempoSlider = document.getElementById('tempo-slider');
    tempoSlider.value = this.config.tempoPercent;
    document.getElementById('tempo-value').textContent = this.config.tempoPercent + '%';

    // Apply global config mode
    this.game.mode = this.config.mode;
    const modeToggle = document.getElementById('btn-mode');
    modeToggle.textContent = this.config.mode === MODE_PRACTICE ? 'Practice' : 'Performance';
    modeToggle.classList.toggle('active', this.config.mode === MODE_PRACTICE);

    // Load and start
    this.game.loadSong(song);
    this.game.setTempo(song.tempo * this.config.tempoPercent / 100);

    if (this.config.mode === MODE_PERFORMANCE && this.config.performanceStart === START_COUNTDOWN) {
      await this._showCountdown();
      this.game.start();
    } else if (this.config.mode === MODE_PERFORMANCE && this.config.performanceStart === START_FIRST_KEYPRESS) {
      this.game.waitingForFirstKey = true;
      this.game.start();
    } else {
      this.game.start();
    }
  }

  async _previewSong(songId) {
    // Stop any active game/player
    this.game.stop();
    this.player.stop();
    this.audio.stopAll();
    this._audioHandles.clear();

    this.currentSongId = songId;
    this.previewMode = true;
    this.songListScreen.style.display = 'none';
    this.playScreen.style.display = 'flex';
    this.completionScreen.hide();

    // Fetch full song
    const res = await fetch(`/api/songs/${songId}`);
    const song = await res.json();

    // Update title bar
    document.getElementById('song-title').textContent = `${song.title} - ${song.composer}`;

    // Destroy old keyboard to remove stale resize listeners
    this.keyboard.destroy();

    // Adjust keyboard range to song
    const noteNums = song.tracks.flatMap(t => t.notes.map(n => n.note));
    const minNote = noteNums.length > 0 ? Math.min(...noteNums) : 48;
    const maxNote = noteNums.length > 0 ? Math.max(...noteNums) : 84;
    const low = Math.max(21, Math.floor((minNote - 5) / 12) * 12);
    const high = Math.min(108, Math.ceil((maxNote + 5) / 12) * 12);
    this.keyboard = new PianoKeyboard(document.getElementById('keyboard-canvas'), low, high);
    this.waterfall.keyboard = this.keyboard;

    await new Promise(r => requestAnimationFrame(r));
    this.keyboard.resize();
    this.waterfall.resize();

    // Apply global config tempo
    const tempoSlider = document.getElementById('tempo-slider');
    tempoSlider.value = this.config.tempoPercent;
    document.getElementById('tempo-value').textContent = this.config.tempoPercent + '%';

    // Adapt controls for preview mode
    this._setControlsMode('preview');

    // Load player
    const tempo = song.tempo * this.config.tempoPercent / 100;
    this.player.load(song, tempo);

    // Wire player callbacks
    this.player.onNoteOn = (note, hand) => {
      const color = hand === 'left' ? COLORS.leftHand : COLORS.rightHand;
      this.keyboard.pressKey(note, color);
      const handle = this.audio.noteOn(note);
      this._audioHandles.set(note, handle);
    };
    this.player.onNoteOff = (note) => {
      this.keyboard.releaseKey(note);
      const handle = this._audioHandles.get(note);
      if (handle !== undefined) {
        this.audio.noteOff(handle);
        this._audioHandles.delete(note);
      }
    };
    this.player.onComplete = () => {
      this._showSongList();
    };

    this.player.start();
  }

  _setControlsMode(mode) {
    const modeToggle = document.getElementById('btn-mode');
    const scoreDisplay = document.getElementById('score-display');
    const restartBtn = document.getElementById('btn-restart');

    if (mode === 'preview') {
      modeToggle.style.display = 'none';
      scoreDisplay.style.display = 'none';
      restartBtn.textContent = 'Restart';
      restartBtn.onclick = () => this._previewSong(this.currentSongId);
    } else {
      modeToggle.style.display = '';
      scoreDisplay.style.display = '';
      restartBtn.textContent = 'Restart';
      restartBtn.onclick = () => this._playSong(this.currentSongId);
    }
  }

  _showCountdown() {
    const overlay = document.getElementById('countdown-overlay');
    const text = document.getElementById('countdown-text');
    overlay.style.display = 'flex';

    const steps = ['3', '2', '1', 'Go!'];
    let i = 0;

    return new Promise(resolve => {
      const tick = () => {
        if (i < steps.length) {
          text.textContent = steps[i];
          // Re-trigger animation by removing and re-adding the element
          text.style.animation = 'none';
          text.offsetHeight; // force reflow
          text.style.animation = '';
          i++;
          setTimeout(tick, i === steps.length ? 500 : 1000);
        } else {
          overlay.style.display = 'none';
          text.textContent = '';
          resolve();
        }
      };
      tick();
    });
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
    // Ignore MIDI input during preview playback
    if (this.previewMode) return;

    if (!this.game.playing) {
      // Free play - just show on keyboard
      this.keyboard.pressKey(e.note, COLORS.rightHand);
      return;
    }

    const result = this.game.noteOn(e.note);
    if (result.hit) {
      // Use accuracy-based color instead of uniform hit color
      const accuracy = timingAccuracyFromDelta(result.onDeltaMs);
      const color = colorForAccuracy(accuracy);
      this.keyboard.pressKey(e.note, color);
    } else {
      this.keyboard.flash(e.note, COLORS.wrong, 300);
      this.keyboard.pressKey(e.note, COLORS.wrong);
    }

    // Update score display
    document.getElementById('score-display').textContent = this.game.getScore() + '%';
  }

  _onNoteOff(e) {
    if (this.previewMode) return;

    // Capture the release timing entry before calling noteOff
    this.game.noteOff(e.note);
    this.keyboard.releaseKey(e.note);

    // Flash release-accuracy color if we have a timing entry for this note
    for (let i = this.game.timingLog.length - 1; i >= 0; i--) {
      const entry = this.game.timingLog[i];
      if (entry.note === e.note && entry.offDeltaMs !== null) {
        const releaseAccuracy = timingAccuracyFromDelta(entry.offDeltaMs);
        const releaseColor = colorForAccuracy(releaseAccuracy);
        this.keyboard.flash(e.note, releaseColor, 300);
        break;
      }
    }
  }

  _onSongComplete(result) {
    // Save progress with current mode
    this.connection.send({
      type: 'saveProgress',
      songId: this.currentSongId,
      score: result.score,
      stars: result.stars,
      mode: this.config.mode,
      accuracy: result.accuracy,
    });

    // Show completion
    const title = this.game.song?.title || this.currentSongId;
    this.completionScreen.show(result, title);
  }

  _buildTimingMap() {
    // Build a Map from note object → timing entry for the waterfall
    const map = new Map();
    for (const entry of this.game.timingLog) {
      if (entry._noteObj) {
        map.set(entry._noteObj, entry);
      }
    }
    return map;
  }

  _renderLoop(now) {
    if (this.previewMode) {
      // Preview mode: player drives the waterfall, no hints
      this.keyboard.clearHints();
      this.waterfall.draw(
        this.player.currentBeat,
        this.player.allNotes,
        new Set(),  // no hit tracking in preview
        new Set(),  // no active slice
        null,       // no timing markers in preview
      );
    } else {
      // Game mode
      this.game.update(now);

      if (this.game.playing && this.game.pendingSlice.length > 0) {
        const hintNotes = this.game.pendingSlice
          .filter(n => !this.game.hitNotes.has(n))
          .map(n => n.note);
        const hand = this.game.pendingSlice[0]?.hand || 'right';
        this.keyboard.setHints(hintNotes, hand);
      } else {
        this.keyboard.clearHints();
      }

      this.waterfall.setTempo(this.game.tempo);
      this.waterfall.draw(
        this.game.currentBeat,
        this.game.allNotes,
        this.game.hitNotes,
        this.game.getActiveSliceNotes(),
        this._buildTimingMap(),
      );
    }

    this.keyboard.draw(now);
    requestAnimationFrame(this._renderLoop);
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => new App());
