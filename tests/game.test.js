import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from '../public/js/game.js';
import { MODE_PRACTICE, MODE_PERFORMANCE } from '../public/js/config.js';

// --- helpers ---

function makeSong(tracks, tempo = 120) {
  return { id: 'test', title: 'Test', composer: 'Test', tempo, tracks };
}

function singleTrack(notes, hand = 'right') {
  return [{ hand, notes: notes.map(([note, start, duration]) => ({ note, start, duration })) }];
}

function twoTracks(rightNotes, leftNotes) {
  return [
    { hand: 'right', notes: rightNotes.map(([note, start, duration]) => ({ note, start, duration })) },
    { hand: 'left', notes: leftNotes.map(([note, start, duration]) => ({ note, start, duration })) },
  ];
}

// Advance the game engine by simulating frames over a duration.
// Uses real performance.now() offsets so internal timing is consistent.
function advanceFrames(engine, durationMs, steps = 10) {
  const step = durationMs / steps;
  for (let i = 0; i < steps; i++) {
    engine.update(performance.now());
    // Busy-wait a tiny bit so performance.now() actually advances
    const target = performance.now() + step;
    while (performance.now() < target) { /* spin */ }
  }
  engine.update(performance.now());
}

// Build a timing map the same way app.js does
function buildTimingMap(engine) {
  const map = new Map();
  for (const entry of engine.timingLog) {
    if (entry._noteObj) map.set(entry._noteObj, entry);
  }
  return map;
}

// ─── Sequential same-pitch notes: timing entries ─────────────────────

describe('sequential same-pitch notes', () => {
  let engine;
  const C4 = 60;

  beforeEach(() => {
    engine = new GameEngine();
    // Two C4 notes back to back: beat 0 (1 beat long), beat 1 (1 beat long)
    const song = makeSong(singleTrack([[C4, 0, 1], [C4, 1, 1]]));
    engine.mode = MODE_PRACTICE;
    engine.loadSong(song);
    engine.start();
  });

  it('each note gets its own timing entry', () => {
    // Hit first note
    const r1 = engine.noteOn(C4);
    assert.equal(r1.hit, true);
    assert.equal(engine.timingLog.length, 1);

    // Release first note
    engine.noteOff(C4);
    assert.notEqual(engine.timingLog[0].offDeltaMs, null, 'first note should have offDeltaMs after release');

    // Advance to second note's slice
    advanceFrames(engine, 200);

    // Hit second note
    const r2 = engine.noteOn(C4);
    assert.equal(r2.hit, true);
    assert.equal(engine.timingLog.length, 2);

    // Release second note
    engine.noteOff(C4);
    assert.notEqual(engine.timingLog[1].offDeltaMs, null, 'second note should have offDeltaMs after release');
  });

  it('releasing first note does not affect second note timing entry', () => {
    // Hit first note
    engine.noteOn(C4);
    // Release first note
    engine.noteOff(C4);

    // First entry is closed
    const firstEntry = engine.timingLog[0];
    assert.notEqual(firstEntry.offDeltaMs, null);

    // Advance and hit second note
    advanceFrames(engine, 200);
    engine.noteOn(C4);

    // Second entry exists and is still open
    assert.equal(engine.timingLog.length, 2);
    const secondEntry = engine.timingLog[1];
    assert.equal(secondEntry.offDeltaMs, null, 'second note should still be open');

    // First entry unchanged
    assert.equal(engine.timingLog[0].offDeltaMs, firstEntry.offDeltaMs,
      'first note offDeltaMs should not change when second note is pressed');
  });

  it('timing map maps each note object to its own entry', () => {
    engine.noteOn(C4);
    engine.noteOff(C4);
    advanceFrames(engine, 200);
    engine.noteOn(C4);
    engine.noteOff(C4);

    const map = buildTimingMap(engine);
    assert.equal(map.size, 2, 'should have two distinct timing entries');

    // Each note object in allNotes should map to a different entry
    const noteA = engine.allNotes[0];
    const noteB = engine.allNotes[1];
    assert.ok(map.has(noteA), 'first note object should be in timing map');
    assert.ok(map.has(noteB), 'second note object should be in timing map');
    assert.notEqual(map.get(noteA), map.get(noteB), 'entries should be different objects');
  });
});

// ─── Completion fires on noteOff, not noteOn ─────────────────────────

describe('completion triggers on key release', () => {
  it('does not complete on noteOn of last note', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[60, 0, 1]]));
    engine.mode = MODE_PRACTICE;
    engine.loadSong(song);
    engine.start();

    let completed = false;
    engine.onComplete = () => { completed = true; };

    engine.noteOn(60);
    assert.equal(completed, false, 'should not complete on noteOn');
  });

  it('completes on noteOff of last note', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[60, 0, 1]]));
    engine.mode = MODE_PRACTICE;
    engine.loadSong(song);
    engine.start();

    let completed = false;
    engine.onComplete = () => { completed = true; };

    engine.noteOn(60);
    engine.noteOff(60);
    assert.equal(completed, true, 'should complete after noteOff');
  });

  it('waits for all notes in a chord to be released', () => {
    const engine = new GameEngine();
    // Chord: C4 + E4 at beat 0
    const song = makeSong(singleTrack([[60, 0, 1], [64, 0, 1]]));
    engine.mode = MODE_PRACTICE;
    engine.loadSong(song);
    engine.start();

    let completed = false;
    engine.onComplete = () => { completed = true; };

    // Press both keys (chord)
    engine.noteOn(60);
    engine.noteOn(64);
    assert.equal(completed, false, 'should not complete while keys held');

    // Release first key
    engine.noteOff(60);
    assert.equal(completed, false, 'should not complete with one key still held');

    // Release second key
    engine.noteOff(64);
    assert.equal(completed, true, 'should complete after all keys released');
  });

  it('completes after last note released in multi-note song', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[60, 0, 1], [62, 1, 1]]));
    engine.mode = MODE_PRACTICE;
    engine.loadSong(song);
    engine.start();

    let completedCount = 0;
    engine.onComplete = () => { completedCount++; };

    // First note
    engine.noteOn(60);
    engine.noteOff(60);
    assert.equal(completedCount, 0, 'should not complete after first note');

    // Advance to second note
    advanceFrames(engine, 200);

    // Second note
    engine.noteOn(62);
    assert.equal(completedCount, 0, 'should not complete on noteOn of last note');
    engine.noteOff(62);
    assert.equal(completedCount, 1, 'should complete exactly once after last noteOff');
  });
});

// ─── Performance mode: no currentBeat snap on hit ────────────────────

describe('performance mode: currentBeat continuity', () => {
  it('does not snap currentBeat when a note is hit', () => {
    const engine = new GameEngine();
    // Note at beat 2 — reachable from the -2 lead-in in ~2s at 120 BPM
    const song = makeSong(singleTrack([[60, 2, 1]]), 120);
    engine.mode = MODE_PERFORMANCE;
    engine.loadSong(song);
    engine.start();

    // Advance time so currentBeat is near 2 (starts at -2, needs ~4 beats = 2s)
    advanceFrames(engine, 2100);
    const beatBefore = engine.currentBeat;
    assert.ok(beatBefore > 1.5, `currentBeat should be near 2, got ${beatBefore}`);

    // Hit the note
    engine.noteOn(60);
    const beatAfter = engine.currentBeat;

    // currentBeat should not have jumped — it should be very close to beatBefore
    // (only a tiny frame-time difference at most)
    assert.ok(Math.abs(beatAfter - beatBefore) < 0.1,
      `currentBeat should not snap on hit. Before: ${beatBefore}, After: ${beatAfter}`);
  });

  it('currentBeat keeps advancing smoothly after a hit', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[60, 2, 1], [62, 4, 1]]), 120);
    engine.mode = MODE_PERFORMANCE;
    engine.loadSong(song);
    engine.start();

    // Advance to beat ~2
    advanceFrames(engine, 2100);
    engine.noteOn(60);
    const beatAtHit = engine.currentBeat;

    // Advance more
    advanceFrames(engine, 500); // ~1 more beat
    const beatLater = engine.currentBeat;

    assert.ok(beatLater > beatAtHit + 0.5,
      `currentBeat should keep advancing. At hit: ${beatAtHit}, Later: ${beatLater}`);
  });
});

// ─── First-keypress alignment ────────────────────────────────────────

describe('performance mode: first-keypress start', () => {
  it('aligns currentBeat to first note on first keypress', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[60, 0, 1]]), 120);
    engine.mode = MODE_PERFORMANCE;
    engine.loadSong(song);
    engine.start();
    engine.waitingForFirstKey = true;

    // Before first keypress, currentBeat is at the lead-in position
    assert.equal(engine.currentBeat, -2);

    // First keypress
    engine.noteOn(60);

    // currentBeat should now be at the first note's beat, not -2
    assert.ok(Math.abs(engine.currentBeat - 0) < 0.01,
      `currentBeat should align to first note (0), got ${engine.currentBeat}`);
  });

  it('sets startTimeMs so timing deltas are near zero for first note', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[60, 0, 1]]), 120);
    engine.mode = MODE_PERFORMANCE;
    engine.loadSong(song);
    engine.start();
    engine.waitingForFirstKey = true;

    engine.noteOn(60);

    // The first note's onDeltaMs should be near 0 (pressed right "on time")
    assert.equal(engine.timingLog.length, 1);
    assert.ok(Math.abs(engine.timingLog[0].onDeltaMs) < 50,
      `onDeltaMs should be near 0, got ${engine.timingLog[0].onDeltaMs}`);
  });

  it('aligns to first note even when notes start at non-zero beat', () => {
    const engine = new GameEngine();
    // Song where first note is at beat 2
    const song = makeSong(singleTrack([[60, 2, 1]]), 120);
    engine.mode = MODE_PERFORMANCE;
    engine.loadSong(song);
    engine.start();
    engine.waitingForFirstKey = true;

    engine.noteOn(60);

    assert.ok(Math.abs(engine.currentBeat - 2) < 0.01,
      `currentBeat should align to first note (2), got ${engine.currentBeat}`);
    assert.ok(Math.abs(engine.timingLog[0].onDeltaMs) < 50,
      `onDeltaMs should be near 0, got ${engine.timingLog[0].onDeltaMs}`);
  });
});

// ─── Double noteOn guard (regression for destroy() listener leak) ────

describe('double noteOn for same key must not hit two notes', () => {
  it('second noteOn without noteOff does not match the next note', () => {
    const engine = new GameEngine();
    // Two E4 notes back to back (Ode to Joy opening)
    const song = makeSong(singleTrack([[64, 0, 1], [64, 1, 1]]), 120);
    engine.mode = MODE_PERFORMANCE;
    engine.loadSong(song);
    engine.start();
    engine.waitingForFirstKey = true;

    // First noteOn — matches note A at beat 0
    const r1 = engine.noteOn(64);
    assert.equal(r1.hit, true);
    assert.equal(engine.hits, 1);
    assert.equal(engine.timingLog.length, 1);

    // Second noteOn WITHOUT a noteOff in between (simulates the
    // duplicate listener bug). Should NOT match note B.
    const r2 = engine.noteOn(64);
    assert.equal(r2.hit, false, 'duplicate noteOn should not hit the next note');
    assert.equal(engine.hits, 1, 'hit count should still be 1');
    assert.equal(engine.timingLog.length, 1, 'should still have only one timing entry');

    // Note B should not be in hitNotes
    const noteB = engine.allNotes[1];
    assert.equal(engine.hitNotes.has(noteB), false, 'second note should not be hit');
  });

  it('works correctly with proper noteOff between presses', () => {
    const engine = new GameEngine();
    const song = makeSong(singleTrack([[64, 0, 1], [64, 1, 1]]), 120);
    engine.mode = MODE_PRACTICE;
    engine.loadSong(song);
    engine.start();

    // Hit first note, release it
    engine.noteOn(64);
    engine.noteOff(64);
    assert.equal(engine.hits, 1);

    // Advance to second note
    advanceFrames(engine, 200);

    // Hit second note properly
    const r2 = engine.noteOn(64);
    assert.equal(r2.hit, true, 'second note should be hit after proper noteOff');
    assert.equal(engine.hits, 2);
    assert.equal(engine.timingLog.length, 2);
  });
});
