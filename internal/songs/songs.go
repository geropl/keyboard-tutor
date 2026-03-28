package songs

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
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
	ID            string  `json:"id"`
	Title         string  `json:"title"`
	Composer      string  `json:"composer"`
	Difficulty    int     `json:"difficulty"`
	Tempo         int     `json:"tempo"`
	TimeSignature [2]int  `json:"timeSignature"`
	Description   string  `json:"description"`
	SkillFocus    string  `json:"skillFocus"`
	Source        string  `json:"source,omitempty"`
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
	Source      string `json:"source"`
}

var (
	ErrNotFound   = errors.New("song not found")
	ErrBuiltIn    = errors.New("cannot modify built-in song")
	ErrValidation = errors.New("validation error")
)

// Service loads and caches songs from an embedded filesystem and an
// optional on-disk directory for user-imported songs.
type Service struct {
	mu      sync.RWMutex
	songs   []Song
	dataDir string // path to data/songs/ for imported songs; empty = read-only
}

// NewService reads all *.json files from the embedded filesystem and
// optionally from dataDir on disk. Songs are sorted by difficulty then title.
func NewService(songsFS fs.FS, dataDir string) (*Service, error) {
	svc := &Service{dataDir: dataDir}

	// Load built-in songs from embedded FS
	builtIn, err := loadFromFS(songsFS, "builtin")
	if err != nil {
		return nil, fmt.Errorf("load built-in songs: %w", err)
	}

	// Load imported songs from disk
	var imported []Song
	if dataDir != "" {
		if err := os.MkdirAll(dataDir, 0o755); err != nil {
			return nil, fmt.Errorf("create data dir: %w", err)
		}
		imported, err = loadFromDisk(dataDir)
		if err != nil {
			return nil, fmt.Errorf("load imported songs: %w", err)
		}
	}

	svc.songs = append(builtIn, imported...)
	svc.sortSongs()
	return svc, nil
}

func loadFromFS(songsFS fs.FS, source string) ([]Song, error) {
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
		if s.ID == "" {
			base := filepath.Base(path)
			s.ID = strings.TrimSuffix(base, ".json")
		}
		s.Source = source
		songs = append(songs, s)
		return nil
	})
	return songs, err
}

func loadFromDisk(dir string) ([]Song, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var songs []Song
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", e.Name(), err)
		}
		var s Song
		if err := json.Unmarshal(data, &s); err != nil {
			return nil, fmt.Errorf("parse %s: %w", e.Name(), err)
		}
		if s.ID == "" {
			s.ID = strings.TrimSuffix(e.Name(), ".json")
		}
		if s.Source == "" {
			s.Source = "imported"
		}
		songs = append(songs, s)
	}
	return songs, nil
}

func (s *Service) sortSongs() {
	sort.Slice(s.songs, func(i, j int) bool {
		if s.songs[i].Difficulty != s.songs[j].Difficulty {
			return s.songs[i].Difficulty < s.songs[j].Difficulty
		}
		return s.songs[i].Title < s.songs[j].Title
	})
}

// List returns summaries of all songs.
func (s *Service) List() []SongSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]SongSummary, len(s.songs))
	for i, song := range s.songs {
		out[i] = SongSummary{
			ID:          song.ID,
			Title:       song.Title,
			Composer:    song.Composer,
			Difficulty:  song.Difficulty,
			Description: song.Description,
			SkillFocus:  song.SkillFocus,
			Source:      song.Source,
		}
	}
	return out
}

// Get returns the full song by ID, or nil if not found.
func (s *Service) Get(id string) *Song {
	s.mu.RLock()
	defer s.mu.RUnlock()

	for i := range s.songs {
		if s.songs[i].ID == id {
			cp := s.songs[i]
			return &cp
		}
	}
	return nil
}

// AddSong validates the song, generates an ID, writes it to disk, and adds
// it to the in-memory list. Returns the generated ID.
func (s *Service) AddSong(song *Song) (string, error) {
	if s.dataDir == "" {
		return "", errors.New("no data directory configured")
	}
	if err := Validate(song); err != nil {
		return "", err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	id := s.generateID(song.Title)
	song.ID = id
	song.Source = "imported"

	if err := s.writeToDisk(song); err != nil {
		return "", fmt.Errorf("write song: %w", err)
	}

	s.songs = append(s.songs, *song)
	s.sortSongs()
	return id, nil
}

// DeleteSong removes an imported song from disk and memory.
func (s *Service) DeleteSong(id string) error {
	if s.dataDir == "" {
		return errors.New("no data directory configured")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	for i := range s.songs {
		if s.songs[i].ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ErrNotFound
	}
	if s.songs[idx].Source != "imported" {
		return ErrBuiltIn
	}

	path := filepath.Join(s.dataDir, id+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete file: %w", err)
	}

	s.songs = append(s.songs[:idx], s.songs[idx+1:]...)
	return nil
}

// UpdateSong replaces an imported song's data on disk and in memory.
func (s *Service) UpdateSong(id string, song *Song) error {
	if s.dataDir == "" {
		return errors.New("no data directory configured")
	}
	if err := Validate(song); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	idx := -1
	for i := range s.songs {
		if s.songs[i].ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return ErrNotFound
	}
	if s.songs[idx].Source != "imported" {
		return ErrBuiltIn
	}

	song.ID = id
	song.Source = "imported"

	if err := s.writeToDisk(song); err != nil {
		return fmt.Errorf("write song: %w", err)
	}

	s.songs[idx] = *song
	s.sortSongs()
	return nil
}

func (s *Service) writeToDisk(song *Song) error {
	data, err := json.MarshalIndent(song, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(s.dataDir, song.ID+".json")
	return os.WriteFile(path, data, 0o644)
}

var slugRe = regexp.MustCompile(`[^a-z0-9-]+`)

// generateID creates a URL-safe slug from the title, appending a numeric
// suffix if the ID already exists. Must be called with s.mu held.
func (s *Service) generateID(title string) string {
	base := strings.ToLower(strings.TrimSpace(title))
	base = strings.ReplaceAll(base, " ", "-")
	base = slugRe.ReplaceAllString(base, "")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "imported"
	}

	candidate := base
	suffix := 2
	for s.idExists(candidate) {
		candidate = fmt.Sprintf("%s-%d", base, suffix)
		suffix++
	}
	return candidate
}

func (s *Service) idExists(id string) bool {
	for i := range s.songs {
		if s.songs[i].ID == id {
			return true
		}
	}
	return false
}

// Validate checks that a song has all required fields with valid values.
func Validate(song *Song) error {
	if strings.TrimSpace(song.Title) == "" {
		return fmt.Errorf("%w: title is required", ErrValidation)
	}
	if song.Tempo <= 0 {
		return fmt.Errorf("%w: tempo must be positive", ErrValidation)
	}
	if song.TimeSignature[0] <= 0 || song.TimeSignature[1] <= 0 {
		return fmt.Errorf("%w: time signature must have positive values", ErrValidation)
	}
	if song.Difficulty < 1 || song.Difficulty > 5 {
		return fmt.Errorf("%w: difficulty must be between 1 and 5", ErrValidation)
	}
	if len(song.Tracks) == 0 {
		return fmt.Errorf("%w: at least one track is required", ErrValidation)
	}
	for i, track := range song.Tracks {
		if track.Hand != "right" && track.Hand != "left" {
			return fmt.Errorf("%w: track %d hand must be 'right' or 'left'", ErrValidation, i)
		}
		if len(track.Notes) == 0 {
			return fmt.Errorf("%w: track %d has no notes", ErrValidation, i)
		}
		for j, note := range track.Notes {
			if note.Note < 0 || note.Note > 127 {
				return fmt.Errorf("%w: track %d note %d has invalid MIDI number %d", ErrValidation, i, j, note.Note)
			}
			if note.Start < 0 {
				return fmt.Errorf("%w: track %d note %d has negative start", ErrValidation, i, j)
			}
			if note.Duration <= 0 {
				return fmt.Errorf("%w: track %d note %d has non-positive duration", ErrValidation, i, j)
			}
		}
	}
	return nil
}
