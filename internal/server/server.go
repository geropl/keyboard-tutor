package server

import (
	"io/fs"
	"net/http"

	"github.com/geropl/keyboard-tutor/internal/midi"
	"github.com/geropl/keyboard-tutor/internal/progress"
	"github.com/geropl/keyboard-tutor/internal/songs"
)

// Config holds the dependencies needed to build the HTTP server.
type Config struct {
	PublicFS fs.FS
	Songs    *songs.Service
	Progress *progress.Manager
	NoteOn   <-chan midi.NoteEvent // nil if no MIDI device
	NoteOff  <-chan midi.NoteEvent // nil if no MIDI device
}

// New creates an http.Handler with all routes wired up.
func New(cfg Config) http.Handler {
	mux := http.NewServeMux()

	h := &Handlers{
		Songs:    cfg.Songs,
		Progress: cfg.Progress,
	}

	// API routes
	mux.HandleFunc("/api/songs/", h.SongByID)
	mux.HandleFunc("/api/songs", h.SongList)
	mux.HandleFunc("/api/progress", h.ProgressGet)

	// WebSocket — upgrades any request to /ws
	ws := NewWSHub(cfg.Progress, cfg.NoteOn, cfg.NoteOff)
	mux.HandleFunc("/ws", ws.HandleUpgrade)

	// Static files — serve embedded public/ as the root
	fileServer := http.FileServer(http.FS(cfg.PublicFS))
	mux.Handle("/", fileServer)

	return mux
}
