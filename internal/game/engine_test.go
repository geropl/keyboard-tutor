package game

import "testing"

// --- helpers ---

func makeSong(tracks []Track, tempo int) Song {
	return Song{Tempo: tempo, Title: "Test", Tracks: tracks}
}

func singleTrack(notes []struct{ Note int; Start float64; Duration float64 }, hand string) []Track {
	t := Track{Hand: hand}
	for _, n := range notes {
		t.Notes = append(t.Notes, struct {
			NoteNum  int     `json:"note"`
			Start    float64 `json:"start"`
			Duration float64 `json:"duration"`
		}{NoteNum: n.Note, Start: n.Start, Duration: n.Duration})
	}
	return []Track{t}
}

func twoHandTracks(rightNotes, leftNotes []struct{ Note int; Start float64; Duration float64 }) []Track {
	return append(
		singleTrack(rightNotes, "right"),
		singleTrack(leftNotes, "left")...,
	)
}

type noteSpec struct {
	Note     int
	Start    float64
	Duration float64
}

func ns(note int, start, dur float64) struct{ Note int; Start float64; Duration float64 } {
	return struct{ Note int; Start float64; Duration float64 }{note, start, dur}
}

func startGame(s Song) *Engine {
	e := NewEngine()
	e.LoadSong(s)
	e.Start()
	return e
}

// --- single note slices ---

func TestSingleNote_HitAdvances(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(62, 1, 1),
	}, "right"), 120))

	r := e.NoteOn(60)
	if !r.Hit {
		t.Error("expected hit")
	}
	if e.Hits != 1 {
		t.Errorf("expected 1 hit, got %d", e.Hits)
	}
	if len(e.PendingSlice) != 1 {
		t.Fatalf("expected 1 pending, got %d", len(e.PendingSlice))
	}
	if e.PendingSlice[0].NoteNum != 62 {
		t.Errorf("expected pending note 62, got %d", e.PendingSlice[0].NoteNum)
	}
}

func TestSingleNote_WrongNoteMisses(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1),
	}, "right"), 120))

	r := e.NoteOn(61)
	if r.Hit {
		t.Error("expected miss")
	}
	if e.Misses != 1 {
		t.Errorf("expected 1 miss, got %d", e.Misses)
	}
	if e.Hits != 0 {
		t.Errorf("expected 0 hits, got %d", e.Hits)
	}
	if len(e.PendingSlice) != 1 || e.PendingSlice[0].NoteNum != 60 {
		t.Error("slice should not advance")
	}
}

func TestSingleNote_AllNotesCompletesSong(t *testing.T) {
	var result *CompletionResult
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(62, 1, 1),
	}, "right"), 120))
	e.OnComplete = func(r CompletionResult) { result = &r }

	e.NoteOn(60)
	e.NoteOff(60)
	e.NoteOn(62)

	if !e.Completed {
		t.Error("expected completed")
	}
	if e.Playing {
		t.Error("expected not playing")
	}
	if result == nil {
		t.Fatal("expected completion result")
	}
	if result.Score != 100 {
		t.Errorf("expected score 100, got %d", result.Score)
	}
	if result.Hits != 2 {
		t.Errorf("expected 2 hits, got %d", result.Hits)
	}
	if result.Misses != 0 {
		t.Errorf("expected 0 misses, got %d", result.Misses)
	}
}

func TestSingleNote_CurrentBeatAdvances(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 4, 1), ns(62, 5, 1),
	}, "right"), 120))

	e.NoteOn(60)
	if e.CurrentBeat != 4 {
		t.Errorf("expected currentBeat 4, got %f", e.CurrentBeat)
	}
}

// --- chord slices ---

func TestChord_SingleKeyDoesNotAdvance(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))

	r := e.NoteOn(60)
	if !r.Hit {
		t.Error("first key should register as hit")
	}
	if e.Hits != 0 {
		t.Errorf("no hits counted until chord complete, got %d", e.Hits)
	}
	if len(e.PendingSlice) != 2 {
		t.Errorf("slice still has both notes, got %d", len(e.PendingSlice))
	}
}

func TestChord_BothKeysAdvances(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1), ns(67, 1, 1),
	}, "right"), 120))

	e.NoteOn(60)
	e.NoteOn(64) // chord complete

	if e.Hits != 2 {
		t.Errorf("expected 2 hits, got %d", e.Hits)
	}
	if len(e.PendingSlice) != 1 {
		t.Fatalf("expected 1 pending, got %d", len(e.PendingSlice))
	}
	if e.PendingSlice[0].NoteNum != 67 {
		t.Errorf("expected pending note 67, got %d", e.PendingSlice[0].NoteNum)
	}
}

func TestChord_ReleaseBeforeCompleteDoesNotAdvance(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))

	e.NoteOn(60)
	e.NoteOff(60) // released before second key
	e.NoteOn(64)  // only 64 held

	if e.Hits != 0 {
		t.Errorf("chord should not complete, got %d hits", e.Hits)
	}
	if len(e.PendingSlice) != 2 {
		t.Errorf("expected 2 pending, got %d", len(e.PendingSlice))
	}
}

func TestChord_RepressAfterReleaseCompletes(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))

	e.NoteOn(60)
	e.NoteOff(60)
	e.NoteOn(64)
	if e.Hits != 0 {
		t.Error("should not be complete yet")
	}

	e.NoteOn(60) // now both held
	if e.Hits != 2 {
		t.Errorf("expected 2 hits, got %d", e.Hits)
	}
}

func TestChord_ThreeNotes(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1), ns(67, 0, 1),
	}, "right"), 120))

	e.NoteOn(60)
	if e.Hits != 0 {
		t.Error("not complete after 1")
	}
	e.NoteOn(64)
	if e.Hits != 0 {
		t.Error("not complete after 2")
	}
	e.NoteOn(67) // all three held
	if e.Hits != 3 {
		t.Errorf("expected 3 hits, got %d", e.Hits)
	}
	if len(e.PendingSlice) != 0 {
		t.Errorf("expected empty pending, got %d", len(e.PendingSlice))
	}
}

func TestChord_WrongNoteDuringChord(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))

	e.NoteOn(60)
	e.NoteOn(62) // wrong
	if e.Misses != 1 {
		t.Errorf("expected 1 miss, got %d", e.Misses)
	}
	if e.Hits != 0 {
		t.Errorf("expected 0 hits, got %d", e.Hits)
	}
	if len(e.PendingSlice) != 2 {
		t.Errorf("expected 2 pending, got %d", len(e.PendingSlice))
	}

	// Can still complete
	e.NoteOn(64)
	if e.Hits != 2 {
		t.Errorf("expected 2 hits after completing chord, got %d", e.Hits)
	}
}

// --- two-hand simultaneous notes ---

func TestTwoHands_RequiresBothHeld(t *testing.T) {
	e := startGame(makeSong(twoHandTracks(
		[]struct{ Note int; Start float64; Duration float64 }{ns(64, 0, 1)},
		[]struct{ Note int; Start float64; Duration float64 }{ns(48, 0, 1)},
	), 120))

	r1 := e.NoteOn(64)
	if !r1.Hit {
		t.Error("expected hit")
	}
	if r1.Hand != "right" {
		t.Errorf("expected right hand, got %q", r1.Hand)
	}
	if e.Hits != 0 {
		t.Error("should not advance with only one hand")
	}

	r2 := e.NoteOn(48)
	if !r2.Hit {
		t.Error("expected hit")
	}
	if r2.Hand != "left" {
		t.Errorf("expected left hand, got %q", r2.Hand)
	}
	if e.Hits != 2 {
		t.Errorf("expected 2 hits, got %d", e.Hits)
	}
}

func TestTwoHands_CorrectHandReported(t *testing.T) {
	e := startGame(makeSong(twoHandTracks(
		[]struct{ Note int; Start float64; Duration float64 }{ns(64, 0, 1)},
		[]struct{ Note int; Start float64; Duration float64 }{ns(48, 0, 1)},
	), 120))

	r1 := e.NoteOn(48)
	if r1.Hand != "left" {
		t.Errorf("expected left, got %q", r1.Hand)
	}
	r2 := e.NoteOn(64)
	if r2.Hand != "right" {
		t.Errorf("expected right, got %q", r2.Hand)
	}
}

// --- slice grouping ---

func TestSliceGrouping_SameStartGrouped(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1), ns(67, 1, 1),
	}, "right"), 120))

	if len(e.PendingSlice) != 2 {
		t.Fatalf("expected 2 in slice, got %d", len(e.PendingSlice))
	}
	if e.PendingSlice[0].NoteNum != 60 {
		t.Errorf("expected 60, got %d", e.PendingSlice[0].NoteNum)
	}
	if e.PendingSlice[1].NoteNum != 64 {
		t.Errorf("expected 64, got %d", e.PendingSlice[1].NoteNum)
	}
}

func TestSliceGrouping_SequentialSeparate(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(62, 1, 1), ns(64, 2, 1),
	}, "right"), 120))

	if len(e.PendingSlice) != 1 {
		t.Fatalf("expected 1 in slice, got %d", len(e.PendingSlice))
	}
	e.NoteOn(60)
	if len(e.PendingSlice) != 1 {
		t.Fatalf("expected 1 in next slice, got %d", len(e.PendingSlice))
	}
	if e.PendingSlice[0].NoteNum != 62 {
		t.Errorf("expected 62, got %d", e.PendingSlice[0].NoteNum)
	}
}

func TestSliceGrouping_MultiTrackSameTime(t *testing.T) {
	e := startGame(makeSong(twoHandTracks(
		[]struct{ Note int; Start float64; Duration float64 }{ns(64, 0, 1), ns(67, 1, 1)},
		[]struct{ Note int; Start float64; Duration float64 }{ns(48, 0, 1)},
	), 120))

	if len(e.PendingSlice) != 2 {
		t.Fatalf("expected 2 in slice, got %d", len(e.PendingSlice))
	}
	notes := map[int]bool{}
	for _, n := range e.PendingSlice {
		notes[n.NoteNum] = true
	}
	if !notes[48] || !notes[64] {
		t.Errorf("expected notes 48 and 64, got %v", notes)
	}
}

// --- score calculation ---

func TestScore_ZeroWithNoPlayed(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1),
	}, "right"), 120))
	if e.GetScore() != 0 {
		t.Errorf("expected 0, got %d", e.GetScore())
	}
}

func TestScore_100WhenAllHit(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1),
	}, "right"), 120))
	e.NoteOn(60)
	if e.GetScore() != 100 {
		t.Errorf("expected 100, got %d", e.GetScore())
	}
}

func TestScore_MissesInCompletionResult(t *testing.T) {
	var result *CompletionResult
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(62, 1, 1),
	}, "right"), 120))
	e.OnComplete = func(r CompletionResult) { result = &r }

	e.NoteOn(61) // miss
	e.NoteOn(60) // hit
	e.NoteOff(60)
	e.NoteOn(62) // hit

	if result == nil {
		t.Fatal("expected completion")
	}
	if result.Hits != 2 {
		t.Errorf("expected 2 hits, got %d", result.Hits)
	}
	if result.Misses != 1 {
		t.Errorf("expected 1 miss, got %d", result.Misses)
	}
	if result.Score != 100 {
		t.Errorf("expected score 100, got %d", result.Score)
	}
}

// --- song completion ---

func TestCompletion_CorrectStars(t *testing.T) {
	var result *CompletionResult
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1),
	}, "right"), 120))
	e.OnComplete = func(r CompletionResult) { result = &r }
	e.NoteOn(60)
	if result == nil {
		t.Fatal("expected completion")
	}
	if result.Stars != 3 {
		t.Errorf("expected 3 stars, got %d", result.Stars)
	}
}

func TestCompletion_ChordTriggers(t *testing.T) {
	var result *CompletionResult
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))
	e.OnComplete = func(r CompletionResult) { result = &r }

	e.NoteOn(60)
	e.NoteOn(64)

	if !e.Completed {
		t.Error("expected completed")
	}
	if result == nil {
		t.Fatal("expected completion result")
	}
	if result.Score != 100 {
		t.Errorf("expected 100, got %d", result.Score)
	}
}

// --- edge cases ---

func TestEdge_NoteOnBeforeStart(t *testing.T) {
	e := NewEngine()
	e.LoadSong(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1),
	}, "right"), 120))
	// Not started
	r := e.NoteOn(60)
	if r.Hit {
		t.Error("expected miss before start")
	}
	if e.Hits != 0 {
		t.Errorf("expected 0 hits, got %d", e.Hits)
	}
}

func TestEdge_NoteOnAfterCompletion(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1),
	}, "right"), 120))
	e.NoteOn(60)
	if !e.Completed {
		t.Fatal("expected completed")
	}

	r := e.NoteOn(62)
	if r.Hit {
		t.Error("expected miss after completion")
	}
}

func TestEdge_DuplicateNoteOnInChord(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))

	e.NoteOn(60)
	e.NoteOn(60) // duplicate
	if e.Misses != 0 {
		t.Errorf("duplicate should not count as miss, got %d misses", e.Misses)
	}
	if e.Hits != 0 {
		t.Errorf("chord still not complete, got %d hits", e.Hits)
	}
}

func TestEdge_GetActiveSliceNotes(t *testing.T) {
	e := startGame(makeSong(singleTrack([]struct{ Note int; Start float64; Duration float64 }{
		ns(60, 0, 1), ns(64, 0, 1),
	}, "right"), 120))

	active := e.GetActiveSliceNotes()
	if len(active) != 2 {
		t.Errorf("expected 2 active, got %d", len(active))
	}
	for _, n := range e.PendingSlice {
		if !active[n] {
			t.Errorf("expected note %d in active set", n.NoteNum)
		}
	}
}

// --- StarsForScore ---

func TestStarsForScore(t *testing.T) {
	tests := []struct {
		score int
		stars int
	}{
		{100, 3}, {95, 3}, {94, 2}, {80, 2}, {79, 1}, {60, 1}, {59, 0}, {0, 0},
	}
	for _, tt := range tests {
		if got := StarsForScore(tt.score); got != tt.stars {
			t.Errorf("StarsForScore(%d) = %d, want %d", tt.score, got, tt.stars)
		}
	}
}
