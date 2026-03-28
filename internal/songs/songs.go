package songs

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

type Note struct {
	Note     int     `json:"note"`
	Start    float64 `json:"start"`
	Duration float64 `json:"duration"`
}

type Track struct {
	Hand  string `json:"hand"`
	Notes []Note `json:"notes"`
}

type Song struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	Composer      string `json:"composer"`
	Difficulty    int    `json:"difficulty"`
	Tempo         int    `json:"tempo"`
	TimeSignature [2]int `json:"timeSignature"`
	Description   string `json:"description"`
	SkillFocus    string `json:"skillFocus"`
	Tracks        []Track `json:"tracks"`
}

// SongSummary is the subset returned by the list endpoint.
type SongSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Composer    string `json:"composer"`
	Difficulty  int    `json:"difficulty"`
	Description string `json:"description"`
	SkillFocus  string `json:"skillFocus"`
}

// Service loads and caches songs from an embedded filesystem.
type Service struct {
	songs []Song
}

// NewService reads all *.json files from the given filesystem and returns
// a Service with songs sorted by difficulty then title.
func NewService(songsFS fs.FS) (*Service, error) {
	var songs []Song

	err := fs.WalkDir(songsFS, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}
		data, err := fs.ReadFile(songsFS, path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		var s Song
		if err := json.Unmarshal(data, &s); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		// Derive ID from filename if not set in JSON
		if s.ID == "" {
			base := filepath.Base(path)
			s.ID = strings.TrimSuffix(base, ".json")
		}
		songs = append(songs, s)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("load songs: %w", err)
	}

	sort.Slice(songs, func(i, j int) bool {
		if songs[i].Difficulty != songs[j].Difficulty {
			return songs[i].Difficulty < songs[j].Difficulty
		}
		return songs[i].Title < songs[j].Title
	})

	return &Service{songs: songs}, nil
}

// List returns summaries of all songs.
func (s *Service) List() []SongSummary {
	out := make([]SongSummary, len(s.songs))
	for i, song := range s.songs {
		out[i] = SongSummary{
			ID:          song.ID,
			Title:       song.Title,
			Composer:    song.Composer,
			Difficulty:  song.Difficulty,
			Description: song.Description,
			SkillFocus:  song.SkillFocus,
		}
	}
	return out
}

// Get returns the full song by ID, or nil if not found.
func (s *Service) Get(id string) *Song {
	for i := range s.songs {
		if s.songs[i].ID == id {
			return &s.songs[i]
		}
	}
	return nil
}
