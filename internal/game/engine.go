package game

import (
	"math"
)

// Mode constants
const (
	ModePractice    = "practice"
	ModePerformance = "performance"
)

// Note is a single note in a song, with hand assignment.
type Note struct {
	NoteNum  int     `json:"note"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
	Hand     string  `json:"hand"`
}

// Track is a hand's part in a song.
type Track struct {
	Hand  string     `json:"hand"`
	Notes []struct {
		NoteNum  int     `json:"note"`
		Start    float64 `json:"start"`
		Duration float64 `json:"duration"`
	} `json:"notes"`
}

// Song is the minimal song structure needed by the engine.
type Song struct {
	Tempo  int     `json:"tempo"`
	Title  string  `json:"title"`
	Tracks []Track `json:"tracks"`
}

// TimingEntry records the timing accuracy for a single note hit.
type TimingEntry struct {
	NoteNum   int
	Hand      string
	OnDeltaMs float64  // ms offset of key press vs expected time (positive = late)
	OffDeltaMs *float64 // ms offset of key release vs expected end (nil until released)
}

// timingAccuracy returns 0–100 for a single delta using exponential decay.
// τ = 150ms: 0ms→100%, 50ms→~72%, 150ms→~37%, 300ms→~14%.
const timingTau = 150.0

func timingAccuracy(deltaMs float64) float64 {
	return 100.0 * math.Exp(-math.Abs(deltaMs)/timingTau)
}

// ComputeAccuracy returns the overall accuracy (0–100) from a timing log.
func ComputeAccuracy(entries []TimingEntry) int {
	if len(entries) == 0 {
		return 0
	}
	var sum float64
	var count int
	for _, e := range entries {
		sum += timingAccuracy(e.OnDeltaMs)
		count++
		if e.OffDeltaMs != nil {
			sum += timingAccuracy(*e.OffDeltaMs)
			count++
		}
	}
	if count == 0 {
		return 0
	}
	return int(math.Round(sum / float64(count)))
}

// CompletionResult is emitted when a song finishes.
type CompletionResult struct {
	Score    int
	Stars    int
	Hits     int
	Misses   int
	Total    int
	Accuracy int
}

// NoteOnResult is returned from NoteOn.
type NoteOnResult struct {
	Hit        bool
	Note       int
	Hand       string
	OnDeltaMs  float64 // timing delta for this press (only meaningful when Hit is true)
}

// StarsForScore returns 0-3 stars based on score percentage.
func StarsForScore(score int) int {
	switch {
	case score >= 95:
		return 3
	case score >= 80:
		return 2
	case score >= 60:
		return 1
	default:
		return 0
	}
}

// Engine is the core game logic, a direct port of public/js/game.js.
type Engine struct {
	AllNotes     []*Note
	CurrentBeat  float64
	HitNotes     map[*Note]bool
	TotalNotes   int
	Hits         int
	Misses       int
	Mode         string
	Playing      bool
	Completed    bool
	Tempo        float64
	LastFrame    *float64 // nil = not set
	PendingSlice []*Note
	OnComplete   func(CompletionResult)

	// Timing tracking
	TimingLog    []TimingEntry
	StartTimeMs  float64        // wall-clock ms when playback started
	noteToTiming map[*Note]int  // maps a hit note to its TimingLog index

	physicalKeys map[int]bool
	sliceMatches map[int]bool // partial chord tracking

	song *Song
}

// NewEngine creates a new game engine with default settings.
func NewEngine() *Engine {
	return &Engine{
		Mode:         ModePractice,
		HitNotes:     make(map[*Note]bool),
		physicalKeys: make(map[int]bool),
	}
}

// LoadSong flattens tracks into AllNotes, sorted by start then note number.
func (e *Engine) LoadSong(s Song) {
	e.song = &s
	e.Tempo = float64(s.Tempo)
	e.AllNotes = nil

	for i := range s.Tracks {
		track := &s.Tracks[i]
		for j := range track.Notes {
			n := &track.Notes[j]
			e.AllNotes = append(e.AllNotes, &Note{
				NoteNum:  n.NoteNum,
				Start:    n.Start,
				Duration: n.Duration,
				Hand:     track.Hand,
			})
		}
	}

	// Sort by start, then by note number
	sortNotes(e.AllNotes)

	e.TotalNotes = len(e.AllNotes)
	e.HitNotes = make(map[*Note]bool)
	e.Hits = 0
	e.Misses = 0
	e.CurrentBeat = -2
	e.Playing = false
	e.Completed = false
	e.LastFrame = nil
	e.TimingLog = nil
	e.noteToTiming = make(map[*Note]int)
	e.StartTimeMs = 0
	e.physicalKeys = make(map[int]bool)
	e.sliceMatches = nil
	e.computePendingSlice()
}

func sortNotes(notes []*Note) {
	// Simple insertion sort — song note counts are small
	for i := 1; i < len(notes); i++ {
		for j := i; j > 0; j-- {
			if less(notes[j], notes[j-1]) {
				notes[j], notes[j-1] = notes[j-1], notes[j]
			} else {
				break
			}
		}
	}
}

func less(a, b *Note) bool {
	if a.Start != b.Start {
		return a.Start < b.Start
	}
	return a.NoteNum < b.NoteNum
}

// Start begins playback. nowMs is the current wall-clock time in ms.
func (e *Engine) Start(nowMs float64) {
	e.Playing = true
	e.StartTimeMs = nowMs
	// LastFrame is set on first Update call
}

// Stop pauses playback.
func (e *Engine) Stop() {
	e.Playing = false
}

// SetTempo changes the current tempo.
func (e *Engine) SetTempo(tempo float64) {
	e.Tempo = tempo
}

func (e *Engine) computePendingSlice() {
	e.PendingSlice = nil
	var sliceStart *float64

	for _, note := range e.AllNotes {
		if e.HitNotes[note] {
			continue
		}
		if sliceStart == nil {
			s := note.Start
			sliceStart = &s
		}
		if math.Abs(note.Start-*sliceStart) < 0.01 {
			e.PendingSlice = append(e.PendingSlice, note)
		} else {
			break
		}
	}
}

// GetActiveSliceNotes returns the set of notes in the current pending slice.
func (e *Engine) GetActiveSliceNotes() map[*Note]bool {
	m := make(map[*Note]bool, len(e.PendingSlice))
	for _, n := range e.PendingSlice {
		m[n] = true
	}
	return m
}

// beatToMs converts a beat position to milliseconds from song start.
func (e *Engine) beatToMs(beat float64) float64 {
	return beat * 60000.0 / e.Tempo
}

// recordNoteOn creates a TimingEntry for a hit note.
func (e *Engine) recordNoteOn(note *Note, nowMs float64) float64 {
	expectedMs := e.beatToMs(note.Start) + e.StartTimeMs
	var onDelta float64
	if e.Mode == ModePractice {
		onDelta = 0 // practice mode waits, so press is always on-time
	} else {
		onDelta = nowMs - expectedMs
	}
	entry := TimingEntry{
		NoteNum:   note.NoteNum,
		Hand:      note.Hand,
		OnDeltaMs: onDelta,
	}
	idx := len(e.TimingLog)
	e.TimingLog = append(e.TimingLog, entry)
	e.noteToTiming[note] = idx
	return onDelta
}

// NoteOn processes a MIDI note-on event. nowMs is the current wall-clock time in ms.
func (e *Engine) NoteOn(midiNote int, nowMs float64) NoteOnResult {
	e.physicalKeys[midiNote] = true

	if !e.Playing || e.Completed {
		return NoteOnResult{Hit: false, Note: midiNote}
	}

	// Find matching note in pending slice
	matchIdx := -1
	for i, n := range e.PendingSlice {
		if n.NoteNum == midiNote && !e.HitNotes[n] {
			matchIdx = i
			break
		}
	}

	if matchIdx >= 0 {
		matched := e.PendingSlice[matchIdx]

		// Single-note slice: register hit immediately
		if len(e.PendingSlice) == 1 {
			onDelta := e.recordNoteOn(matched, nowMs)
			e.HitNotes[matched] = true
			e.Hits++
			e.PendingSlice = append(e.PendingSlice[:matchIdx], e.PendingSlice[matchIdx+1:]...)
			e.advancePastSlice(matched.Start)
			return NoteOnResult{Hit: true, Note: midiNote, Hand: matched.Hand, OnDeltaMs: onDelta}
		}

		// Chord: track partial matches, confirm when all held
		if e.sliceMatches == nil {
			e.sliceMatches = make(map[int]bool)
		}
		e.sliceMatches[matchIdx] = true

		// Check if all slice notes are currently held
		allHeld := true
		for _, n := range e.PendingSlice {
			if !e.physicalKeys[n.NoteNum] {
				allHeld = false
				break
			}
		}

		// Record timing for this note if not already recorded
		var onDelta float64
		if _, alreadyRecorded := e.noteToTiming[matched]; !alreadyRecorded {
			onDelta = e.recordNoteOn(matched, nowMs)
		} else {
			onDelta = e.TimingLog[e.noteToTiming[matched]].OnDeltaMs
		}

		if allHeld {
			sliceStart := e.PendingSlice[0].Start
			for _, n := range e.PendingSlice {
				// Record timing for chord notes not yet recorded
				if _, alreadyRecorded := e.noteToTiming[n]; !alreadyRecorded {
					e.recordNoteOn(n, nowMs)
				}
				e.HitNotes[n] = true
				e.Hits++
			}
			e.PendingSlice = nil
			e.sliceMatches = nil
			e.advancePastSlice(sliceStart)
		}

		return NoteOnResult{Hit: true, Note: midiNote, Hand: matched.Hand, OnDeltaMs: onDelta}
	}

	e.Misses++
	return NoteOnResult{Hit: false, Note: midiNote}
}

// NoteOff processes a MIDI note-off event. nowMs is the current wall-clock time in ms.
func (e *Engine) NoteOff(midiNote int, nowMs float64) {
	delete(e.physicalKeys, midiNote)
	// Clear partial chord matches when a key is released
	if e.sliceMatches != nil {
		e.sliceMatches = nil
	}

	// Record release timing for the most recent hit of this note
	for i := len(e.TimingLog) - 1; i >= 0; i-- {
		entry := &e.TimingLog[i]
		if entry.NoteNum == midiNote && entry.OffDeltaMs == nil {
			// Find the corresponding note to get expected end time
			for note, idx := range e.noteToTiming {
				if idx == i {
					expectedEndMs := e.beatToMs(note.Start+note.Duration) + e.StartTimeMs
					offDelta := nowMs - expectedEndMs
					entry.OffDeltaMs = &offDelta
					break
				}
			}
			break
		}
	}
}

func (e *Engine) advancePastSlice(sliceStart float64) {
	e.CurrentBeat = sliceStart
	e.computePendingSlice()

	if len(e.PendingSlice) == 0 && e.Hits == e.TotalNotes {
		e.completeSong()
	}
}

func (e *Engine) completeSong() {
	e.Completed = true
	e.Playing = false

	score := 0
	if e.TotalNotes > 0 {
		score = int(math.Round(float64(e.Hits) / float64(e.TotalNotes) * 100))
	}
	stars := StarsForScore(score)
	accuracy := ComputeAccuracy(e.TimingLog)

	if e.OnComplete != nil {
		e.OnComplete(CompletionResult{
			Score:    score,
			Stars:    stars,
			Hits:     e.Hits,
			Misses:   e.Misses,
			Total:    e.TotalNotes,
			Accuracy: accuracy,
		})
	}
}

// Update advances the game state for the current frame.
// now is in milliseconds (like performance.now() in JS).
func (e *Engine) Update(now float64) {
	if !e.Playing || e.Completed {
		return
	}

	if e.Mode == ModePerformance {
		// Performance mode
		if e.LastFrame == nil {
			e.LastFrame = &now
			return
		}
		deltaMs := now - *e.LastFrame
		*e.LastFrame = now
		deltaBeats := (deltaMs / 60000) * e.Tempo
		e.CurrentBeat += deltaBeats

		// Check for missed notes
		for _, note := range e.AllNotes {
			if e.HitNotes[note] {
				continue
			}
			if note.Start < e.CurrentBeat-0.5 {
				e.HitNotes[note] = true // mark as passed (missed)
				// Remove from pending slice
				for i, n := range e.PendingSlice {
					if n == note {
						e.PendingSlice = append(e.PendingSlice[:i], e.PendingSlice[i+1:]...)
						break
					}
				}
			}
		}
		e.computePendingSlice()

		// Check completion
		remaining := 0
		for _, n := range e.AllNotes {
			if !e.HitNotes[n] {
				remaining++
			}
		}
		if remaining == 0 {
			e.completeSong()
		}
	} else {
		// Practice mode: advance smoothly toward next slice
		if len(e.PendingSlice) > 0 {
			targetBeat := e.PendingSlice[0].Start
			if e.CurrentBeat < targetBeat {
				if e.LastFrame == nil {
					e.LastFrame = &now
					return
				}
				deltaMs := now - *e.LastFrame
				*e.LastFrame = now
				deltaBeats := (deltaMs / 60000) * e.Tempo
				newBeat := e.CurrentBeat + deltaBeats
				if newBeat > targetBeat {
					newBeat = targetBeat
				}
				e.CurrentBeat = newBeat
			}
		}
	}
}

// GetScore returns the current score as a percentage (0-100).
func (e *Engine) GetScore() int {
	if e.TotalNotes == 0 {
		return 0
	}
	return int(math.Round(float64(e.Hits) / float64(e.TotalNotes) * 100))
}
