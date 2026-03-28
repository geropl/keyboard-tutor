// MIDI Import — parses MIDI files and converts to the app's song JSON format.
// Depends on @tonejs/midi loaded as a global (window.Midi).

const MIDI_NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function noteName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return MIDI_NOTE_NAMES[midi % 12] + octave;
}

/**
 * Parse a MIDI file from an ArrayBuffer.
 * Returns a structured object with tracks, tempo, time signature, and suggested metadata.
 */
export function parseMidiFile(arrayBuffer, fileName) {
  const midi = new Midi(arrayBuffer);

  const tempo = midi.header.tempos.length > 0 ? Math.round(midi.header.tempos[0].bpm) : 120;

  let timeSignature = [4, 4];
  if (midi.header.timeSignatures.length > 0) {
    const ts = midi.header.timeSignatures[0].timeSignature;
    timeSignature = [ts[0], ts[1]];
  }

  const tracks = midi.tracks
    .map((track, index) => {
      const notes = track.notes.map(n => ({
        midi: n.midi,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      }));

      const noteRange = notes.length > 0
        ? [Math.min(...notes.map(n => n.midi)), Math.max(...notes.map(n => n.midi))]
        : [0, 0];

      return {
        index,
        name: track.name || `Track ${index + 1}`,
        instrument: track.instrument.name || 'Unknown',
        percussion: track.instrument.percussion,
        channel: track.channel,
        noteCount: notes.length,
        noteRange,
        noteRangeLabel: notes.length > 0
          ? `${noteName(noteRange[0])} – ${noteName(noteRange[1])}`
          : '—',
        notes,
      };
    })
    .filter(t => t.noteCount > 0); // Hide empty tracks

  // Suggested title from MIDI header or filename
  let suggestedTitle = midi.name || '';
  if (!suggestedTitle && fileName) {
    suggestedTitle = fileName.replace(/\.(mid|midi)$/i, '');
  }

  // Suggested composer from MIDI copyright or empty
  const suggestedComposer = '';

  return {
    tracks,
    tempo,
    timeSignature,
    suggestedTitle,
    suggestedComposer,
    duration: midi.duration,
  };
}

/**
 * Hand assignment strategies.
 */
export const HAND_STRATEGIES = {
  BY_TRACK: 'by-track',
  BY_PITCH: 'by-pitch',
  ALL_RIGHT: 'all-right',
  ALL_LEFT: 'all-left',
};

/**
 * Apply a hand assignment strategy to the selected tracks.
 * Returns an array of { trackIndex, hand } assignments.
 */
export function applyHandStrategy(strategy, selectedTrackIndices) {
  switch (strategy) {
    case HAND_STRATEGIES.BY_TRACK:
      return selectedTrackIndices.map((idx, i) => ({
        trackIndex: idx,
        hand: i % 2 === 0 ? 'right' : 'left',
      }));
    case HAND_STRATEGIES.BY_PITCH:
      // Per-track assignment doesn't matter for by-pitch; notes are split later.
      // Assign all to 'right' as a placeholder — convertToSong handles the split.
      return selectedTrackIndices.map(idx => ({
        trackIndex: idx,
        hand: 'right',
      }));
    case HAND_STRATEGIES.ALL_RIGHT:
      return selectedTrackIndices.map(idx => ({
        trackIndex: idx,
        hand: 'right',
      }));
    case HAND_STRATEGIES.ALL_LEFT:
      return selectedTrackIndices.map(idx => ({
        trackIndex: idx,
        hand: 'left',
      }));
    default:
      return selectedTrackIndices.map(idx => ({
        trackIndex: idx,
        hand: 'right',
      }));
  }
}

/**
 * Convert parsed MIDI data + user choices into the app's song JSON format.
 *
 * @param {object} parsed - Output of parseMidiFile()
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.composer
 * @param {number} options.difficulty
 * @param {string} options.description
 * @param {string} options.strategy - One of HAND_STRATEGIES
 * @param {Array<{trackIndex: number, hand: string}>} options.trackAssignments
 * @returns {object} Song JSON ready to POST to the backend
 */
export function convertToSong(parsed, options) {
  const { title, composer, difficulty, description, strategy, trackAssignments } = options;
  const tempo = parsed.tempo;

  const rightNotes = [];
  const leftNotes = [];

  for (const assignment of trackAssignments) {
    const track = parsed.tracks.find(t => t.index === assignment.trackIndex);
    if (!track) continue;

    for (const note of track.notes) {
      const start = note.time * (tempo / 60);
      const duration = note.duration * (tempo / 60);
      const songNote = {
        note: note.midi,
        start: Math.round(start * 1000) / 1000, // 3 decimal places
        duration: Math.round(duration * 1000) / 1000,
      };

      if (strategy === HAND_STRATEGIES.BY_PITCH) {
        if (note.midi < 60) {
          leftNotes.push(songNote);
        } else {
          rightNotes.push(songNote);
        }
      } else {
        if (assignment.hand === 'left') {
          leftNotes.push(songNote);
        } else {
          rightNotes.push(songNote);
        }
      }
    }
  }

  // Sort by start time
  rightNotes.sort((a, b) => a.start - b.start);
  leftNotes.sort((a, b) => a.start - b.start);

  const tracks = [];
  if (rightNotes.length > 0) {
    tracks.push({ hand: 'right', notes: rightNotes });
  }
  if (leftNotes.length > 0) {
    tracks.push({ hand: 'left', notes: leftNotes });
  }

  return {
    title: title || 'Untitled',
    composer: composer || '',
    difficulty: difficulty || 3,
    tempo,
    timeSignature: parsed.timeSignature,
    description: description || '',
    skillFocus: '',
    tracks,
  };
}

/**
 * Build a temporary song object for preview purposes (same format as convertToSong
 * but without sending to backend). Used by the import editor for live preview.
 */
export function buildPreviewSong(parsed, strategy, trackAssignments) {
  return convertToSong(parsed, {
    title: 'Preview',
    composer: '',
    difficulty: 3,
    description: '',
    strategy,
    trackAssignments,
  });
}
