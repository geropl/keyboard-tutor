import { PianoKeyboard } from './keyboard.js';
import { Waterfall } from './waterfall.js';
import { Player } from './player.js';
import { PianoAudio } from './audio.js';
import { COLORS } from './utils.js';
import {
  parseMidiFile,
  convertToSong,
  buildPreviewSong,
  applyHandStrategy,
  HAND_STRATEGIES,
} from './midi-import.js';

/**
 * Full-screen import editor for MIDI files.
 * Handles both new imports (from MIDI file) and re-editing existing imported songs.
 */
export class ImportEditor {
  constructor(container) {
    this.container = container;

    // Parsed MIDI data (null in re-edit mode)
    this.parsedData = null;

    // Re-edit mode state
    this.editingSongId = null;
    this.editMode = false;

    // User choices
    this.title = '';
    this.composer = '';
    this.difficulty = 3;
    this.description = '';
    this.strategy = HAND_STRATEGIES.BY_TRACK;
    this.trackAssignments = []; // [{ trackIndex, hand, selected }]

    // Preview components
    this.keyboard = null;
    this.waterfall = null;
    this.player = null;
    this.audio = new PianoAudio();
    this._audioHandles = new Map();
    this._rafId = null;
    this._previewPlaying = false;

    // Callbacks
    this.onSave = null;   // (songJson) => Promise — called when user saves
    this.onCancel = null;  // () => void
  }

  /**
   * Open the editor with a freshly parsed MIDI file.
   */
  openWithMidi(arrayBuffer, fileName) {
    this.editMode = false;
    this.editingSongId = null;

    try {
      this.parsedData = parseMidiFile(arrayBuffer, fileName);
    } catch (e) {
      alert('Failed to parse MIDI file: ' + e.message);
      if (this.onCancel) this.onCancel();
      return false;
    }

    if (this.parsedData.tracks.length === 0) {
      alert('This MIDI file contains no playable notes.');
      if (this.onCancel) this.onCancel();
      return false;
    }

    // Initialize from parsed data
    this.title = this.parsedData.suggestedTitle;
    this.composer = this.parsedData.suggestedComposer;
    this.difficulty = 3;
    this.description = '';
    this.strategy = HAND_STRATEGIES.BY_TRACK;

    // Select first non-percussion track by default
    this.trackAssignments = this.parsedData.tracks.map((t, i) => ({
      trackIndex: t.index,
      hand: 'right',
      selected: !t.percussion && i === this.parsedData.tracks.findIndex(tr => !tr.percussion),
    }));

    // Apply default strategy
    this._applyStrategy();
    this._render();
    this._startPreviewLoop();
    return true;
  }

  /**
   * Open the editor in re-edit mode with an existing song.
   */
  openForEdit(song) {
    this.editMode = true;
    this.editingSongId = song.id;
    this.parsedData = null;

    this.title = song.title;
    this.composer = song.composer;
    this.difficulty = song.difficulty;
    this.description = song.description || '';
    this.strategy = HAND_STRATEGIES.BY_TRACK;

    // Build pseudo-tracks from existing song tracks
    const pseudoTracks = song.tracks.map((track, i) => {
      const notes = track.notes.map(n => ({
        midi: n.note,
        time: n.start / (song.tempo / 60),
        duration: n.duration / (song.tempo / 60),
        velocity: 0.8,
      }));
      const midiNotes = track.notes.map(n => n.note);
      const noteRange = midiNotes.length > 0
        ? [Math.min(...midiNotes), Math.max(...midiNotes)]
        : [0, 0];
      const MIDI_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const noteName = (m) => MIDI_NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

      return {
        index: i,
        name: track.hand === 'right' ? 'Right Hand' : 'Left Hand',
        instrument: 'Piano',
        percussion: false,
        channel: 0,
        noteCount: notes.length,
        noteRange,
        noteRangeLabel: midiNotes.length > 0
          ? `${noteName(noteRange[0])} – ${noteName(noteRange[1])}`
          : '—',
        notes,
      };
    });

    // Build a pseudo parsedData for the preview system
    this.parsedData = {
      tracks: pseudoTracks,
      tempo: song.tempo,
      timeSignature: song.timeSignature,
      suggestedTitle: song.title,
      suggestedComposer: song.composer,
      duration: 0,
    };

    this.trackAssignments = pseudoTracks.map(t => ({
      trackIndex: t.index,
      hand: t.name === 'Left Hand' ? 'left' : 'right',
      selected: true,
    }));

    this._render();
    this._startPreviewLoop();
  }

  /**
   * Clean up resources.
   */
  destroy() {
    this._stopPreviewPlayback();
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.keyboard) {
      this.keyboard.destroy();
      this.keyboard = null;
    }
    this.container.innerHTML = '';
  }

  // --- Private ---

  _render() {
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'import-editor';
    this.container.appendChild(wrapper);

    // Top bar
    const topBar = document.createElement('div');
    topBar.className = 'import-top-bar';
    topBar.innerHTML = `
      <button class="btn btn-icon import-btn-cancel" title="Cancel">&larr;</button>
      <span class="import-title-label">${this.editMode ? 'Edit Imported Song' : 'Import MIDI'}</span>
      <div class="import-top-actions">
        <button class="btn btn-small import-btn-save">Save</button>
      </div>
    `;
    wrapper.appendChild(topBar);

    topBar.querySelector('.import-btn-cancel').onclick = () => this._cancel();
    topBar.querySelector('.import-btn-save').onclick = () => this._save();

    // Main content: left panel (form) + right panel (preview)
    const main = document.createElement('div');
    main.className = 'import-main';
    wrapper.appendChild(main);

    // Left panel
    const leftPanel = document.createElement('div');
    leftPanel.className = 'import-panel-left';
    main.appendChild(leftPanel);

    this._renderMetadataForm(leftPanel);
    this._renderTrackList(leftPanel);

    // Right panel (preview)
    const rightPanel = document.createElement('div');
    rightPanel.className = 'import-panel-right';
    rightPanel.innerHTML = `
      <div class="import-preview-controls">
        <button class="btn btn-small import-btn-play-preview">&#9654; Preview</button>
      </div>
      <div class="import-waterfall-container">
        <canvas class="import-waterfall-canvas"></canvas>
      </div>
      <div class="import-keyboard-container">
        <canvas class="import-keyboard-canvas"></canvas>
      </div>
    `;
    main.appendChild(rightPanel);

    rightPanel.querySelector('.import-btn-play-preview').onclick = (e) => {
      this._togglePreviewPlayback(e.currentTarget);
    };

    // Initialize preview components
    this._initPreview(rightPanel);
  }

  _renderMetadataForm(parent) {
    const form = document.createElement('div');
    form.className = 'import-metadata';
    form.innerHTML = `
      <div class="import-field">
        <label>Title</label>
        <input type="text" class="import-input" id="import-title" value="${this._escAttr(this.title)}" />
      </div>
      <div class="import-field">
        <label>Composer</label>
        <input type="text" class="import-input" id="import-composer" value="${this._escAttr(this.composer)}" />
      </div>
      <div class="import-field-row">
        <div class="import-field">
          <label>Difficulty</label>
          <select class="import-select" id="import-difficulty">
            ${[1,2,3,4,5].map(d => `<option value="${d}" ${d === this.difficulty ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="import-field">
        <label>Description</label>
        <input type="text" class="import-input" id="import-description" value="${this._escAttr(this.description)}" placeholder="Optional" />
      </div>
    `;
    parent.appendChild(form);

    // Bind inputs
    form.querySelector('#import-title').oninput = (e) => { this.title = e.target.value; };
    form.querySelector('#import-composer').oninput = (e) => { this.composer = e.target.value; };
    form.querySelector('#import-difficulty').onchange = (e) => { this.difficulty = parseInt(e.target.value); };
    form.querySelector('#import-description').oninput = (e) => { this.description = e.target.value; };
  }

  _renderTrackList(parent) {
    const section = document.createElement('div');
    section.className = 'import-tracks-section';

    // Hand strategy selector
    const strategyRow = document.createElement('div');
    strategyRow.className = 'import-strategy-row';

    if (!this.editMode) {
      strategyRow.innerHTML = `
        <label>Hand Assignment</label>
        <select class="import-select" id="import-strategy">
          <option value="${HAND_STRATEGIES.BY_TRACK}" ${this.strategy === HAND_STRATEGIES.BY_TRACK ? 'selected' : ''}>By Track</option>
          <option value="${HAND_STRATEGIES.BY_PITCH}" ${this.strategy === HAND_STRATEGIES.BY_PITCH ? 'selected' : ''}>By Pitch (split at C4)</option>
          <option value="${HAND_STRATEGIES.ALL_RIGHT}" ${this.strategy === HAND_STRATEGIES.ALL_RIGHT ? 'selected' : ''}>All Right Hand</option>
          <option value="${HAND_STRATEGIES.ALL_LEFT}" ${this.strategy === HAND_STRATEGIES.ALL_LEFT ? 'selected' : ''}>All Left Hand</option>
        </select>
      `;
    } else {
      // Re-edit mode: limited strategies
      strategyRow.innerHTML = `
        <label>Hand Assignment</label>
        <select class="import-select" id="import-strategy">
          <option value="${HAND_STRATEGIES.BY_TRACK}" ${this.strategy === HAND_STRATEGIES.BY_TRACK ? 'selected' : ''}>As-is</option>
          <option value="${HAND_STRATEGIES.BY_PITCH}" ${this.strategy === HAND_STRATEGIES.BY_PITCH ? 'selected' : ''}>Re-split by Pitch (C4)</option>
          <option value="swap">Swap Hands</option>
        </select>
      `;
    }
    section.appendChild(strategyRow);

    const strategySelect = strategyRow.querySelector('#import-strategy');
    if (strategySelect) {
      strategySelect.onchange = (e) => {
        const val = e.target.value;
        if (val === 'swap') {
          this._swapHands();
          // Reset dropdown to by-track after swap
          e.target.value = HAND_STRATEGIES.BY_TRACK;
          this.strategy = HAND_STRATEGIES.BY_TRACK;
        } else {
          this.strategy = val;
          this._applyStrategy();
        }
        this._renderTrackItems(section);
        this._updatePreview();
      };
    }

    // Track items
    this._renderTrackItems(section);
    parent.appendChild(section);
  }

  _renderTrackItems(section) {
    // Remove old track items
    section.querySelectorAll('.import-track-item').forEach(el => el.remove());

    if (!this.parsedData) return;

    for (const track of this.parsedData.tracks) {
      const assignment = this.trackAssignments.find(a => a.trackIndex === track.index);
      if (!assignment) continue;

      const item = document.createElement('div');
      item.className = 'import-track-item' + (track.percussion ? ' percussion' : '');

      const isDisabled = this.editMode || track.percussion;

      item.innerHTML = `
        <label class="import-track-checkbox">
          <input type="checkbox" ${assignment.selected ? 'checked' : ''} ${isDisabled ? 'disabled' : ''} data-track="${track.index}" />
          <span class="import-track-name">${track.name}</span>
        </label>
        <span class="import-track-instrument">${track.percussion ? 'Percussion' : track.instrument}</span>
        <span class="import-track-notes">${track.noteCount} notes</span>
        <span class="import-track-range">${track.noteRangeLabel}</span>
        <select class="import-hand-select" data-track="${track.index}" ${track.percussion ? 'disabled' : ''}>
          <option value="right" ${assignment.hand === 'right' ? 'selected' : ''}>Right</option>
          <option value="left" ${assignment.hand === 'left' ? 'selected' : ''}>Left</option>
        </select>
      `;

      // Checkbox handler
      const checkbox = item.querySelector('input[type="checkbox"]');
      checkbox.onchange = () => {
        assignment.selected = checkbox.checked;
        this._updatePreview();
      };

      // Hand select handler
      const handSelect = item.querySelector('.import-hand-select');
      handSelect.onchange = () => {
        assignment.hand = handSelect.value;
        this._updatePreview();
      };

      section.appendChild(item);
    }
  }

  _applyStrategy() {
    const selectedIndices = this.trackAssignments
      .filter(a => a.selected)
      .map(a => a.trackIndex);

    const assignments = applyHandStrategy(this.strategy, selectedIndices);

    for (const a of assignments) {
      const existing = this.trackAssignments.find(ta => ta.trackIndex === a.trackIndex);
      if (existing) {
        existing.hand = a.hand;
      }
    }
  }

  _swapHands() {
    for (const a of this.trackAssignments) {
      a.hand = a.hand === 'right' ? 'left' : 'right';
    }
  }

  _initPreview(panel) {
    const waterfallCanvas = panel.querySelector('.import-waterfall-canvas');
    const keyboardCanvas = panel.querySelector('.import-keyboard-canvas');

    // Determine note range from all tracks
    const song = this._buildPreviewSong();
    const noteNums = song.tracks.flatMap(t => t.notes.map(n => n.note));
    const minNote = noteNums.length > 0 ? Math.min(...noteNums) : 48;
    const maxNote = noteNums.length > 0 ? Math.max(...noteNums) : 84;
    const low = Math.max(21, Math.floor((minNote - 5) / 12) * 12);
    const high = Math.min(108, Math.ceil((maxNote + 5) / 12) * 12);

    this.keyboard = new PianoKeyboard(keyboardCanvas, low, high);
    this.waterfall = new Waterfall(waterfallCanvas, this.keyboard);

    // Force layout after DOM insertion
    requestAnimationFrame(() => {
      this.keyboard.resize();
      this.waterfall.resize();
    });
  }

  _buildPreviewSong() {
    const selected = this.trackAssignments.filter(a => a.selected);
    if (selected.length === 0) {
      return { title: 'Preview', tempo: 120, timeSignature: [4, 4], tracks: [] };
    }
    return buildPreviewSong(this.parsedData, this.strategy, selected);
  }

  _updatePreview() {
    // Stop any playing preview
    this._stopPreviewPlayback();

    const song = this._buildPreviewSong();

    // Recalculate keyboard range
    const noteNums = song.tracks.flatMap(t => t.notes.map(n => n.note));
    if (noteNums.length > 0) {
      const minNote = Math.min(...noteNums);
      const maxNote = Math.max(...noteNums);
      const low = Math.max(21, Math.floor((minNote - 5) / 12) * 12);
      const high = Math.min(108, Math.ceil((maxNote + 5) / 12) * 12);

      if (this.keyboard) {
        this.keyboard.destroy();
      }
      const keyboardCanvas = this.container.querySelector('.import-keyboard-canvas');
      const waterfallCanvas = this.container.querySelector('.import-waterfall-canvas');
      if (keyboardCanvas && waterfallCanvas) {
        this.keyboard = new PianoKeyboard(keyboardCanvas, low, high);
        this.waterfall = new Waterfall(waterfallCanvas, this.keyboard);
        requestAnimationFrame(() => {
          this.keyboard.resize();
          this.waterfall.resize();
        });
      }
    }
  }

  _startPreviewLoop() {
    const loop = (now) => {
      if (!this.keyboard || !this.waterfall) {
        this._rafId = requestAnimationFrame(loop);
        return;
      }

      const song = this._buildPreviewSong();
      const allNotes = song.tracks.flatMap(t =>
        t.notes.map(n => ({ note: n.note, hand: t.hand, start: n.start, duration: n.duration }))
      );
      allNotes.sort((a, b) => a.start - b.start);

      if (this._previewPlaying && this.player) {
        this.waterfall.setTempo(this.player.song?.tempo || song.tempo);
        this.waterfall.draw(
          this.player.currentBeat,
          allNotes,
          new Set(),
          new Set(),
          null,
        );
      } else {
        // Static preview: show from beat 0
        this.waterfall.setTempo(song.tempo);
        this.waterfall.draw(
          -1,
          allNotes,
          new Set(),
          new Set(),
          null,
        );
      }

      this.keyboard.draw(now);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _togglePreviewPlayback(button) {
    if (this._previewPlaying) {
      this._stopPreviewPlayback();
      button.innerHTML = '&#9654; Preview';
      return;
    }

    const song = this._buildPreviewSong();
    if (song.tracks.length === 0) return;

    this.player = new Player();
    this.player.load(song, song.tempo);

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
      this._previewPlaying = false;
      button.innerHTML = '&#9654; Preview';
    };

    this._previewPlaying = true;
    button.innerHTML = '&#9632; Stop';
    this.player.start();
  }

  _stopPreviewPlayback() {
    if (this.player) {
      this.player.stop();
      this.player = null;
    }
    this.audio.stopAll();
    this._audioHandles.clear();
    this._previewPlaying = false;
    if (this.keyboard) {
      this.keyboard.clearHints();
    }

    // Reset button text if it exists
    const btn = this.container.querySelector('.import-btn-play-preview');
    if (btn) btn.innerHTML = '&#9654; Preview';
  }

  async _save() {
    // Validate
    if (!this.title.trim()) {
      alert('Please enter a title.');
      return;
    }

    const selected = this.trackAssignments.filter(a => a.selected);
    if (selected.length === 0) {
      alert('Please select at least one track.');
      return;
    }

    const songJson = convertToSong(this.parsedData, {
      title: this.title.trim(),
      composer: this.composer.trim(),
      difficulty: this.difficulty,
      description: this.description.trim(),
      strategy: this.strategy,
      trackAssignments: selected,
    });

    if (songJson.tracks.length === 0) {
      alert('No notes in the selected tracks.');
      return;
    }

    this._stopPreviewPlayback();

    if (this.onSave) {
      await this.onSave(songJson, this.editingSongId);
    }
  }

  _cancel() {
    this.destroy();
    if (this.onCancel) this.onCancel();
  }

  _escAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
