import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../public/js/game.js';

// Helper: build a minimal song object
function makeSong(tracks, tempo = 120) {
  return { tempo, title: 'Test', composer: 'Test', tracks };
}

function singleTrack(notes, hand = 'right') {
  return [{ hand, notes }];
}

function twoHandTracks(rightNotes, leftNotes) {
  return [
    { hand: 'right', notes: rightNotes },
    { hand: 'left', notes: leftNotes },
  ];
}

// Helper: set up a playing game
function startGame(song) {
  const game = new GameEngine();
  game.loadSong(song);
  game.start();
  return game;
}

// ─── Single note slices ──────────────────────────────────────

describe('single note slices', () => {
  it('hitting the correct note advances to the next slice', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 62, start: 1, duration: 1 },
    ])));

    const result = game.noteOn(60);
    assert.equal(result.hit, true);
    assert.equal(game.hits, 1);
    // Pending slice should now be the second note
    assert.equal(game.pendingSlice.length, 1);
    assert.equal(game.pendingSlice[0].note, 62);
  });

  it('hitting the wrong note counts as a miss', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
    ])));

    const result = game.noteOn(61);
    assert.equal(result.hit, false);
    assert.equal(game.misses, 1);
    assert.equal(game.hits, 0);
    // Slice should not advance
    assert.equal(game.pendingSlice.length, 1);
    assert.equal(game.pendingSlice[0].note, 60);
  });

  it('playing all notes completes the song', () => {
    let completionResult = null;
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 62, start: 1, duration: 1 },
    ])));
    game.onComplete = (r) => { completionResult = r; };

    game.noteOn(60);
    game.noteOff(60);
    game.noteOn(62);

    assert.equal(game.completed, true);
    assert.equal(game.playing, false);
    assert.notEqual(completionResult, null);
    assert.equal(completionResult.score, 100);
    assert.equal(completionResult.hits, 2);
    assert.equal(completionResult.misses, 0);
  });

  it('currentBeat advances to the hit note start', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 4, duration: 1 },
      { note: 62, start: 5, duration: 1 },
    ])));

    game.noteOn(60);
    assert.equal(game.currentBeat, 4);
  });
});

// ─── Chord slices (simultaneous notes) ──────────────────────

describe('chord slices — require all keys held simultaneously', () => {
  it('pressing only one note of a chord does not advance', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));

    const result = game.noteOn(60);
    assert.equal(result.hit, true, 'first key should register as hit');
    // But the slice should NOT be completed
    assert.equal(game.hits, 0, 'no hits counted until chord is complete');
    assert.equal(game.pendingSlice.length, 2, 'slice still has both notes');
  });

  it('holding both notes of a chord simultaneously advances', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
      { note: 67, start: 1, duration: 1 },
    ])));

    game.noteOn(60);  // first key held
    game.noteOn(64);  // second key held — chord complete

    assert.equal(game.hits, 2);
    assert.equal(game.pendingSlice.length, 1);
    assert.equal(game.pendingSlice[0].note, 67);
  });

  it('pressing and releasing before completing chord does not advance', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));

    game.noteOn(60);
    game.noteOff(60);  // released before second key pressed
    game.noteOn(64);   // only 64 is held now, not 60

    assert.equal(game.hits, 0, 'chord should not complete when first key was released');
    assert.equal(game.pendingSlice.length, 2);
  });

  it('re-pressing after release completes the chord', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));

    // First attempt: press and release
    game.noteOn(60);
    game.noteOff(60);
    game.noteOn(64);
    assert.equal(game.hits, 0);

    // Second attempt: hold both
    game.noteOn(60);  // now both 60 and 64 are held
    assert.equal(game.hits, 2);
  });

  it('three-note chord requires all three held', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
      { note: 67, start: 0, duration: 1 },
    ])));

    game.noteOn(60);
    assert.equal(game.hits, 0);

    game.noteOn(64);
    assert.equal(game.hits, 0);

    game.noteOn(67);  // all three held
    assert.equal(game.hits, 3);
    assert.equal(game.pendingSlice.length, 0);
  });

  it('wrong note during chord counts as miss without affecting chord progress', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));

    game.noteOn(60);
    game.noteOn(62);  // wrong note
    assert.equal(game.misses, 1);
    assert.equal(game.hits, 0);
    assert.equal(game.pendingSlice.length, 2);

    // Can still complete the chord
    game.noteOn(64);
    assert.equal(game.hits, 2);
  });
});

// ─── Two-hand slices ────────────────────────────────────────

describe('two-hand simultaneous notes', () => {
  it('requires both hands to play their notes simultaneously', () => {
    const game = startGame(makeSong(twoHandTracks(
      [{ note: 64, start: 0, duration: 1 }],  // right hand
      [{ note: 48, start: 0, duration: 1 }],   // left hand
    )));

    const r1 = game.noteOn(64);
    assert.equal(r1.hit, true);
    assert.equal(r1.hand, 'right');
    assert.equal(game.hits, 0, 'should not advance with only one hand');

    const r2 = game.noteOn(48);
    assert.equal(r2.hit, true);
    assert.equal(r2.hand, 'left');
    assert.equal(game.hits, 2, 'both notes counted after both held');
  });

  it('reports correct hand for each note', () => {
    const game = startGame(makeSong(twoHandTracks(
      [{ note: 64, start: 0, duration: 1 }],
      [{ note: 48, start: 0, duration: 1 }],
    )));

    const r1 = game.noteOn(48);
    assert.equal(r1.hand, 'left');

    const r2 = game.noteOn(64);
    assert.equal(r2.hand, 'right');
  });
});

// ─── Slice grouping ─────────────────────────────────────────

describe('slice grouping', () => {
  it('groups notes with the same start time into one slice', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
      { note: 67, start: 1, duration: 1 },
    ])));

    assert.equal(game.pendingSlice.length, 2);
    assert.equal(game.pendingSlice[0].note, 60);
    assert.equal(game.pendingSlice[1].note, 64);
  });

  it('sequential single notes form separate slices', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 62, start: 1, duration: 1 },
      { note: 64, start: 2, duration: 1 },
    ])));

    assert.equal(game.pendingSlice.length, 1);
    game.noteOn(60);
    assert.equal(game.pendingSlice.length, 1);
    assert.equal(game.pendingSlice[0].note, 62);
  });

  it('multi-track notes at same time are grouped into one slice', () => {
    const game = startGame(makeSong(twoHandTracks(
      [{ note: 64, start: 0, duration: 1 }, { note: 67, start: 1, duration: 1 }],
      [{ note: 48, start: 0, duration: 1 }],
    )));

    // First slice has both tracks' beat-0 notes
    assert.equal(game.pendingSlice.length, 2);
    const notes = game.pendingSlice.map(n => n.note).sort();
    assert.deepEqual(notes, [48, 64]);
  });
});

// ─── Score calculation ──────────────────────────────────────

describe('score calculation', () => {
  it('returns 0 with no notes played', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
    ])));
    assert.equal(game.getScore(), 0);
  });

  it('returns 100 when all notes hit perfectly', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
    ])));
    game.noteOn(60);
    assert.equal(game.getScore(), 100);
  });

  it('accounts for misses in completion result', () => {
    let result = null;
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 62, start: 1, duration: 1 },
    ])));
    game.onComplete = (r) => { result = r; };

    game.noteOn(61);  // miss
    game.noteOn(60);  // hit
    game.noteOff(60);
    game.noteOn(62);  // hit

    assert.equal(result.hits, 2);
    assert.equal(result.misses, 1);
    assert.equal(result.score, 100);
  });
});

// ─── Song completion ────────────────────────────────────────

describe('song completion', () => {
  it('fires onComplete with correct star counts', () => {
    // 3 stars: >= 95%
    let result = null;
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
    ])));
    game.onComplete = (r) => { result = r; };
    game.noteOn(60);
    assert.equal(result.stars, 3);
  });

  it('chord completion triggers song completion', () => {
    let result = null;
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));
    game.onComplete = (r) => { result = r; };

    game.noteOn(60);
    game.noteOn(64);

    assert.equal(game.completed, true);
    assert.notEqual(result, null);
    assert.equal(result.score, 100);
  });
});

// ─── Edge cases ─────────────────────────────────────────────

describe('edge cases', () => {
  it('noteOn before start returns miss without crashing', () => {
    const game = new GameEngine();
    game.loadSong(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
    ])));
    // Not started yet
    const result = game.noteOn(60);
    assert.equal(result.hit, false);
    assert.equal(game.hits, 0);
  });

  it('noteOn after completion returns miss', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
    ])));
    game.noteOn(60);
    assert.equal(game.completed, true);

    const result = game.noteOn(62);
    assert.equal(result.hit, false);
  });

  it('duplicate noteOn for same pitch in chord is ignored', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));

    game.noteOn(60);
    game.noteOn(60);  // duplicate — physicalKeys already has 60
    assert.equal(game.misses, 0, 'duplicate of a chord note should not count as miss');
    assert.equal(game.hits, 0, 'chord still not complete');
  });

  it('getActiveSliceNotes returns a set of pending notes', () => {
    const game = startGame(makeSong(singleTrack([
      { note: 60, start: 0, duration: 1 },
      { note: 64, start: 0, duration: 1 },
    ])));

    const active = game.getActiveSliceNotes();
    assert.equal(active.size, 2);
    assert.equal(active.has(game.pendingSlice[0]), true);
    assert.equal(active.has(game.pendingSlice[1]), true);
  });
});
