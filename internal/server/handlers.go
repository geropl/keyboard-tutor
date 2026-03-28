package server

import (
	"encoding/json"
	"errors"
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

// SongList handles GET /api/songs and POST /api/songs
func (h *Handlers) SongList(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.songListGet(w, r)
	case http.MethodPost:
		h.songCreate(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handlers) songListGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Songs.List())
}

func (h *Handlers) songCreate(w http.ResponseWriter, r *http.Request) {
	var song songs.Song
	if err := json.NewDecoder(r.Body).Decode(&song); err != nil {
		jsonError(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	id, err := h.Songs.AddSong(&song)
	if err != nil {
		if errors.Is(err, songs.ErrValidation) {
			jsonError(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonError(w, "Failed to save song", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"id": id})
}

// SongByID handles GET/PUT/DELETE /api/songs/{id}
func (h *Handlers) SongByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/songs/")
	if id == "" {
		jsonError(w, "Song ID required", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		h.songGet(w, id)
	case http.MethodPut:
		h.songUpdate(w, r, id)
	case http.MethodDelete:
		h.songDelete(w, id)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *Handlers) songGet(w http.ResponseWriter, id string) {
	song := h.Songs.Get(id)
	if song == nil {
		jsonError(w, "Song not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(song)
}

func (h *Handlers) songUpdate(w http.ResponseWriter, r *http.Request, id string) {
	var song songs.Song
	if err := json.NewDecoder(r.Body).Decode(&song); err != nil {
		jsonError(w, "Invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}

	err := h.Songs.UpdateSong(id, &song)
	if err != nil {
		if errors.Is(err, songs.ErrNotFound) {
			jsonError(w, "Song not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, songs.ErrBuiltIn) {
			jsonError(w, "Cannot modify built-in song", http.StatusForbidden)
			return
		}
		if errors.Is(err, songs.ErrValidation) {
			jsonError(w, err.Error(), http.StatusBadRequest)
			return
		}
		jsonError(w, "Failed to update song", http.StatusInternalServerError)
		return
	}

	updated := h.Songs.Get(id)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(updated)
}

func (h *Handlers) songDelete(w http.ResponseWriter, id string) {
	err := h.Songs.DeleteSong(id)
	if err != nil {
		if errors.Is(err, songs.ErrNotFound) {
			jsonError(w, "Song not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, songs.ErrBuiltIn) {
			jsonError(w, "Cannot delete built-in song", http.StatusForbidden)
			return
		}
		jsonError(w, "Failed to delete song", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ProgressGet handles GET /api/progress
func (h *Handlers) ProgressGet(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(h.Progress.GetAll())
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
