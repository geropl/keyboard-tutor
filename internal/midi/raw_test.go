package midi

import "testing"

func feedBytes(p *Parser, bytes ...byte) []*ParseResult {
	var results []*ParseResult
	for _, b := range bytes {
		if r := p.Feed(b); r != nil {
			results = append(results, r)
		}
	}
	return results
}

func TestNoteOn(t *testing.T) {
	p := &Parser{}
	results := feedBytes(p, 0x90, 60, 100) // Note on, channel 0, note 60, velocity 100
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	r := results[0]
	if r.Type != "noteOn" {
		t.Errorf("expected noteOn, got %q", r.Type)
	}
	if r.Note != 60 {
		t.Errorf("expected note 60, got %d", r.Note)
	}
	if r.Vel != 100 {
		t.Errorf("expected velocity 100, got %d", r.Vel)
	}
	if r.Ch != 0 {
		t.Errorf("expected channel 0, got %d", r.Ch)
	}
}

func TestNoteOff(t *testing.T) {
	p := &Parser{}
	results := feedBytes(p, 0x80, 60, 64) // Note off, channel 0
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Type != "noteOff" {
		t.Errorf("expected noteOff, got %q", results[0].Type)
	}
}

func TestNoteOnZeroVelocityIsNoteOff(t *testing.T) {
	p := &Parser{}
	results := feedBytes(p, 0x90, 60, 0) // Note on with velocity 0 = note off
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Type != "noteOff" {
		t.Errorf("expected noteOff, got %q", results[0].Type)
	}
}

func TestChannel(t *testing.T) {
	p := &Parser{}
	results := feedBytes(p, 0x93, 60, 100) // Channel 3
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Ch != 3 {
		t.Errorf("expected channel 3, got %d", results[0].Ch)
	}
}

func TestRunningStatus(t *testing.T) {
	p := &Parser{}
	// Status byte once, then two data pairs (running status)
	results := feedBytes(p, 0x90, 60, 100, 62, 90)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Note != 60 {
		t.Errorf("first note: expected 60, got %d", results[0].Note)
	}
	if results[1].Note != 62 {
		t.Errorf("second note: expected 62, got %d", results[1].Note)
	}
}

func TestActiveSensingIgnored(t *testing.T) {
	p := &Parser{}
	// Active sensing (0xFE) should be ignored, not disrupt parsing
	results := feedBytes(p, 0x90, 0xFE, 60, 100)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Note != 60 {
		t.Errorf("expected note 60, got %d", results[0].Note)
	}
}

func TestSystemMessageResetsState(t *testing.T) {
	p := &Parser{}
	// Start a note on, then system reset (0xFF) should abort it
	results := feedBytes(p, 0x90, 60, 0xFF, 100)
	// The 100 after reset is an orphan data byte — no event
	if len(results) != 0 {
		t.Errorf("expected 0 results after system reset, got %d", len(results))
	}
}

func TestOrphanDataByteIgnored(t *testing.T) {
	p := &Parser{}
	// Data bytes without a preceding status byte
	results := feedBytes(p, 60, 100)
	if len(results) != 0 {
		t.Errorf("expected 0 results for orphan data, got %d", len(results))
	}
}

func TestNonNoteMessagesIgnored(t *testing.T) {
	p := &Parser{}
	// Control change (0xB0) — should parse but not produce a note event
	results := feedBytes(p, 0xB0, 64, 127)
	if len(results) != 0 {
		t.Errorf("expected 0 results for control change, got %d", len(results))
	}
}

func TestMultipleMessages(t *testing.T) {
	p := &Parser{}
	results := feedBytes(p,
		0x90, 60, 100, // note on C4
		0x90, 64, 80,  // note on E4
		0x80, 60, 64,  // note off C4
	)
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	if results[0].Type != "noteOn" || results[0].Note != 60 {
		t.Errorf("result 0: %+v", results[0])
	}
	if results[1].Type != "noteOn" || results[1].Note != 64 {
		t.Errorf("result 1: %+v", results[1])
	}
	if results[2].Type != "noteOff" || results[2].Note != 60 {
		t.Errorf("result 2: %+v", results[2])
	}
}

func TestSystemF0Resets(t *testing.T) {
	p := &Parser{}
	// SysEx start (0xF0) should reset state
	results := feedBytes(p, 0x90, 60, 0xF0, 0x90, 62, 100)
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Note != 62 {
		t.Errorf("expected note 62, got %d", results[0].Note)
	}
}
