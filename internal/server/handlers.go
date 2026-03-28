package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/geropl/keyboard-tutor/internal/progress"
	"github.com/geropl/keyboard-tutor/internal/songs"
)

// Handlers holds the dependencies for HTTP API handlers.
type Handlers struct {
	Songs    *songs.Service
	Progress *progress.Manager
}

// SongList handles GET /api/songs
func (h *Handlers) SongList(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Songs.List())
}

// SongGet handles GET /api/songs/{id}
func (h *Handlers) SongGet(w http.ResponseWriter, r *http.Request) {
	// Extract song ID from path: /api/songs/{id}
	id := strings.TrimPrefix(r.URL.Path, "/api/songs/")
	if id == "" {
		http.Error(w, `{"error":"Song ID required"}`, http.StatusBadRequest)
		return
	}

	song := h.Songs.Get(id)
	if song == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "Song not found"})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(song)
}

// ProgressGet handles GET /api/progress
func (h *Handlers) ProgressGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Progress.GetAll())
}
