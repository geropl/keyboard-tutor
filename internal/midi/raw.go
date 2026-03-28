package midi

import (
	"context"
	"io"
	"os"
	"time"
)

const (
	stateIdle  = 0
	stateData1 = 1
	stateData2 = 2
)

// Parser is a stateful MIDI byte stream parser.
// It extracts note on/off events from raw MIDI bytes.
type Parser struct {
	state      int
	statusByte byte
	data1      byte
}

// ParseResult holds the output of parsing a complete MIDI message.
type ParseResult struct {
	Type string // "noteOn" or "noteOff", empty if not a note event
	Note uint8
	Vel  uint8
	Ch   uint8
}

// Feed processes a single byte and returns a result if a complete note event was parsed.
// Returns nil if no event was produced (incomplete message, system message, etc.).
func (p *Parser) Feed(b byte) *ParseResult {
	// Active sensing — ignore
	if b == 0xFE {
		return nil
	}

	// System messages (0xF0-0xFF) — ignore and reset
	if b >= 0xF0 {
		p.state = stateIdle
		return nil
	}

	// Status byte (0x80-0xEF)
	if b >= 0x80 {
		p.statusByte = b
		p.state = stateData1
		return nil
	}

	// Data byte (0x00-0x7F)
	switch p.state {
	case stateData1:
		p.data1 = b
		p.state = stateData2
		return nil
	case stateData2:
		result := p.emitMessage(p.statusByte, p.data1, b)
		// Running status: ready for next data pair
		p.state = stateData1
		return result
	}
	// stateIdle: orphan data byte, ignore
	return nil
}

func (p *Parser) emitMessage(status, d1, d2 byte) *ParseResult {
	msgType := status & 0xF0
	ch := status & 0x0F

	switch {
	case msgType == 0x90 && d2 > 0:
		return &ParseResult{Type: "noteOn", Note: d1, Vel: d2, Ch: ch}
	case msgType == 0x80, msgType == 0x90 && d2 == 0:
		return &ParseResult{Type: "noteOff", Note: d1, Vel: d2, Ch: ch}
	}
	return nil
}

// RawReader reads raw MIDI bytes from a Linux device file (e.g. /dev/midi1).
type RawReader struct {
	devicePath string
	file       *os.File
}

// NewRawReader creates a reader for the given device path.
func NewRawReader(devicePath string) *RawReader {
	return &RawReader{devicePath: devicePath}
}

// Start opens the device and begins reading bytes in a goroutine.
func (r *RawReader) Start(ctx context.Context) (<-chan NoteEvent, <-chan NoteEvent, <-chan error) {
	noteOn := make(chan NoteEvent, 64)
	noteOff := make(chan NoteEvent, 64)
	errc := make(chan error, 1)

	f, err := os.Open(r.devicePath)
	if err != nil {
		errc <- err
		close(noteOn)
		close(noteOff)
		close(errc)
		return noteOn, noteOff, errc
	}
	r.file = f

	go r.readLoop(ctx, f, noteOn, noteOff, errc)
	return noteOn, noteOff, errc
}

func (r *RawReader) readLoop(ctx context.Context, f *os.File, noteOn, noteOff chan<- NoteEvent, errc chan<- error) {
	defer close(noteOn)
	defer close(noteOff)
	defer close(errc)

	buf := make([]byte, 256)
	parser := &Parser{}

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, err := f.Read(buf)
		if err != nil {
			if err != io.EOF && ctx.Err() == nil {
				errc <- err
			}
			return
		}

		for i := 0; i < n; i++ {
			result := parser.Feed(buf[i])
			if result == nil {
				continue
			}
			evt := NoteEvent{
				Note:      result.Note,
				Velocity:  result.Vel,
				Channel:   result.Ch,
				Timestamp: time.Now().UnixMilli(),
			}
			switch result.Type {
			case "noteOn":
				noteOn <- evt
			case "noteOff":
				noteOff <- evt
			}
		}
	}
}

// Close closes the underlying device file.
func (r *RawReader) Close() error {
	if r.file != nil {
		return r.file.Close()
	}
	return nil
}
