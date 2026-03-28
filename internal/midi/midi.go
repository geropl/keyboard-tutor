package midi

import "context"

// NoteEvent represents a MIDI note on or note off event.
type NoteEvent struct {
	Note      uint8 `json:"note"`
	Velocity  uint8 `json:"velocity"`
	Channel   uint8 `json:"channel"`
	Timestamp int64 `json:"timestamp"`
}

// Reader is the interface for MIDI input sources.
// Implementations read from a device and deliver parsed note events on channels.
type Reader interface {
	// Start begins reading MIDI input. Returns channels for note on/off events.
	// Channels are closed when the context is cancelled or the reader encounters
	// an unrecoverable error. The error channel receives at most one error.
	Start(ctx context.Context) (noteOn <-chan NoteEvent, noteOff <-chan NoteEvent, errc <-chan error)

	// Close releases the underlying device.
	Close() error
}
