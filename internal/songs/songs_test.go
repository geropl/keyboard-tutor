package songs

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"mary.json": &fstest.MapFile{
			Data: []byte(`{
				"id": "mary",
				"title": "Mary Had a Little Lamb",
				"composer": "Traditional",
				"difficulty": 1,
				"tempo": 110,
				"timeSignature": [4, 4],
				"description": "A classic song",
				"skillFocus": "Right hand melody",
				"tracks": [{
					"hand": "right",
					"notes": [
						{"note": 64, "start": 0, "duration": 1},
						{"note": 62, "start": 1, "duration": 1}
					]
				}]
			}`),
		},
		"ode.json": &fstest.MapFile{
			Data: []byte(`{
				"id": "ode",
				"title": "Ode to Joy",
				"composer": "Beethoven",
				"difficulty": 2,
				"tempo": 120,
				"timeSignature": [4, 4],
				"description": "Beethoven classic",
				"skillFocus": "Legato",
				"tracks": [{
					"hand": "right",
					"notes": [
						{"note": 64, "start": 0, "duration": 1}
					]
				}]
			}`),
		},
	}
}

func TestNewService(t *testing.T) {
	svc, err := NewService(testFS(), "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if len(svc.songs) != 2 {
		t.Fatalf("expected 2 songs, got %d", len(svc.songs))
	}
	// Should be sorted by difficulty
	if svc.songs[0].ID != "mary" {
		t.Errorf("expected first song 'mary', got %q", svc.songs[0].ID)
	}
	if svc.songs[1].ID != "ode" {
		t.Errorf("expected second song 'ode', got %q", svc.songs[1].ID)
	}
}

func TestList(t *testing.T) {
	svc, err := NewService(testFS(), "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	list := svc.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 summaries, got %d", len(list))
	}
	// Summaries should not contain tracks
	if list[0].ID != "mary" {
		t.Errorf("expected first summary 'mary', got %q", list[0].ID)
	}
	if list[0].Title != "Mary Had a Little Lamb" {
		t.Errorf("unexpected title: %q", list[0].Title)
	}
}

func TestGet(t *testing.T) {
	svc, err := NewService(testFS(), "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	song := svc.Get("mary")
	if song == nil {
		t.Fatal("expected to find 'mary'")
	}
	if song.Tempo != 110 {
		t.Errorf("expected tempo 110, got %d", song.Tempo)
	}
	if len(song.Tracks) != 1 {
		t.Fatalf("expected 1 track, got %d", len(song.Tracks))
	}
	if len(song.Tracks[0].Notes) != 2 {
		t.Errorf("expected 2 notes, got %d", len(song.Tracks[0].Notes))
	}
}

func TestGetNotFound(t *testing.T) {
	svc, err := NewService(testFS(), "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if svc.Get("nonexistent") != nil {
		t.Error("expected nil for nonexistent song")
	}
}

func TestIDFromFilename(t *testing.T) {
	fs := fstest.MapFS{
		"test-song.json": &fstest.MapFile{
			Data: []byte(`{
				"title": "Test",
				"composer": "Test",
				"difficulty": 1,
				"tempo": 120,
				"timeSignature": [4, 4],
				"tracks": []
			}`),
		},
	}
	svc, err := NewService(fs, "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	if svc.songs[0].ID != "test-song" {
		t.Errorf("expected ID 'test-song', got %q", svc.songs[0].ID)
	}
}

func TestSortByDifficultyThenTitle(t *testing.T) {
	fs := fstest.MapFS{
		"b.json": &fstest.MapFile{
			Data: []byte(`{"id":"b","title":"Bravo","difficulty":2,"tempo":120,"timeSignature":[4,4],"tracks":[]}`),
		},
		"a.json": &fstest.MapFile{
			Data: []byte(`{"id":"a","title":"Alpha","difficulty":2,"tempo":120,"timeSignature":[4,4],"tracks":[]}`),
		},
		"c.json": &fstest.MapFile{
			Data: []byte(`{"id":"c","title":"Charlie","difficulty":1,"tempo":120,"timeSignature":[4,4],"tracks":[]}`),
		},
	}
	svc, err := NewService(fs, "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	ids := []string{svc.songs[0].ID, svc.songs[1].ID, svc.songs[2].ID}
	expected := []string{"c", "a", "b"}
	for i, id := range ids {
		if id != expected[i] {
			t.Errorf("position %d: expected %q, got %q", i, expected[i], id)
		}
	}
}

func TestSourceField(t *testing.T) {
	svc, err := NewService(testFS(), "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	for _, s := range svc.List() {
		if s.Source != "builtin" {
			t.Errorf("song %q: expected source 'builtin', got %q", s.ID, s.Source)
		}
	}
}

func validSong() *Song {
	return &Song{
		Title:         "Test Import",
		Composer:      "Test",
		Difficulty:    3,
		Tempo:         120,
		TimeSignature: [2]int{4, 4},
		Tracks: []Track{{
			Hand: "right",
			Notes: []Note{
				{Note: 60, Start: 0, Duration: 1},
				{Note: 62, Start: 1, Duration: 1},
			},
		}},
	}
}

func testServiceWithDataDir(t *testing.T) (*Service, string) {
	t.Helper()
	dataDir := filepath.Join(t.TempDir(), "songs")
	svc, err := NewService(testFS(), dataDir)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, dataDir
}

func TestAddSong(t *testing.T) {
	svc, dataDir := testServiceWithDataDir(t)

	song := validSong()
	id, err := svc.AddSong(song)
	if err != nil {
		t.Fatalf("AddSong: %v", err)
	}
	if id != "test-import" {
		t.Errorf("expected ID 'test-import', got %q", id)
	}

	// Verify in memory
	got := svc.Get(id)
	if got == nil {
		t.Fatal("song not found after add")
	}
	if got.Source != "imported" {
		t.Errorf("expected source 'imported', got %q", got.Source)
	}
	if got.Title != "Test Import" {
		t.Errorf("expected title 'Test Import', got %q", got.Title)
	}

	// Verify on disk
	path := filepath.Join(dataDir, id+".json")
	if _, err := os.Stat(path); err != nil {
		t.Errorf("expected file at %s: %v", path, err)
	}

	// Verify in list with source field
	for _, s := range svc.List() {
		if s.ID == id && s.Source != "imported" {
			t.Errorf("list source: expected 'imported', got %q", s.Source)
		}
	}
}

func TestAddSongIDCollision(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	// "mary" already exists as a built-in
	song := validSong()
	song.Title = "Mary"
	id, err := svc.AddSong(song)
	if err != nil {
		t.Fatalf("AddSong: %v", err)
	}
	if id != "mary-2" {
		t.Errorf("expected 'mary-2', got %q", id)
	}

	// Add another "Mary" — should get mary-3
	song2 := validSong()
	song2.Title = "Mary"
	id2, err := svc.AddSong(song2)
	if err != nil {
		t.Fatalf("AddSong: %v", err)
	}
	if id2 != "mary-3" {
		t.Errorf("expected 'mary-3', got %q", id2)
	}
}

func TestAddSongValidation(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	tests := []struct {
		name string
		mod  func(*Song)
	}{
		{"empty title", func(s *Song) { s.Title = "" }},
		{"zero tempo", func(s *Song) { s.Tempo = 0 }},
		{"bad difficulty", func(s *Song) { s.Difficulty = 6 }},
		{"no tracks", func(s *Song) { s.Tracks = nil }},
		{"bad hand", func(s *Song) { s.Tracks[0].Hand = "both" }},
		{"empty notes", func(s *Song) { s.Tracks[0].Notes = nil }},
		{"bad note number", func(s *Song) { s.Tracks[0].Notes[0].Note = 200 }},
		{"negative start", func(s *Song) { s.Tracks[0].Notes[0].Start = -1 }},
		{"zero duration", func(s *Song) { s.Tracks[0].Notes[0].Duration = 0 }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			song := validSong()
			tt.mod(song)
			_, err := svc.AddSong(song)
			if !errors.Is(err, ErrValidation) {
				t.Errorf("expected ErrValidation, got %v", err)
			}
		})
	}
}

func TestDeleteSong(t *testing.T) {
	svc, dataDir := testServiceWithDataDir(t)

	song := validSong()
	id, _ := svc.AddSong(song)

	err := svc.DeleteSong(id)
	if err != nil {
		t.Fatalf("DeleteSong: %v", err)
	}

	// Verify removed from memory
	if svc.Get(id) != nil {
		t.Error("song still found after delete")
	}

	// Verify removed from disk
	path := filepath.Join(dataDir, id+".json")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("file still exists at %s", path)
	}
}

func TestDeleteBuiltInSong(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	err := svc.DeleteSong("mary")
	if !errors.Is(err, ErrBuiltIn) {
		t.Errorf("expected ErrBuiltIn, got %v", err)
	}
}

func TestDeleteNotFound(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	err := svc.DeleteSong("nonexistent")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestUpdateSong(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	song := validSong()
	id, _ := svc.AddSong(song)

	updated := validSong()
	updated.Title = "Updated Title"
	updated.Difficulty = 5

	err := svc.UpdateSong(id, updated)
	if err != nil {
		t.Fatalf("UpdateSong: %v", err)
	}

	got := svc.Get(id)
	if got.Title != "Updated Title" {
		t.Errorf("expected 'Updated Title', got %q", got.Title)
	}
	if got.Difficulty != 5 {
		t.Errorf("expected difficulty 5, got %d", got.Difficulty)
	}
	if got.Source != "imported" {
		t.Errorf("expected source 'imported', got %q", got.Source)
	}
}

func TestUpdateBuiltInSong(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	song := validSong()
	err := svc.UpdateSong("mary", song)
	if !errors.Is(err, ErrBuiltIn) {
		t.Errorf("expected ErrBuiltIn, got %v", err)
	}
}

func TestDualSourceLoading(t *testing.T) {
	dataDir := filepath.Join(t.TempDir(), "songs")
	os.MkdirAll(dataDir, 0o755)

	// Write an imported song to disk before creating the service
	data := []byte(`{
		"id": "imported-song",
		"title": "Imported Song",
		"composer": "Importer",
		"difficulty": 2,
		"tempo": 100,
		"timeSignature": [3, 4],
		"source": "imported",
		"tracks": [{"hand": "right", "notes": [{"note": 60, "start": 0, "duration": 1}]}]
	}`)
	os.WriteFile(filepath.Join(dataDir, "imported-song.json"), data, 0o644)

	svc, err := NewService(testFS(), dataDir)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	// Should have built-in + imported
	list := svc.List()
	if len(list) != 3 {
		t.Fatalf("expected 3 songs, got %d", len(list))
	}

	// Check sources
	sources := map[string]string{}
	for _, s := range list {
		sources[s.ID] = s.Source
	}
	if sources["mary"] != "builtin" {
		t.Errorf("mary: expected 'builtin', got %q", sources["mary"])
	}
	if sources["imported-song"] != "imported" {
		t.Errorf("imported-song: expected 'imported', got %q", sources["imported-song"])
	}
}

func TestGenerateIDSlugification(t *testing.T) {
	svc, _ := testServiceWithDataDir(t)

	tests := []struct {
		title    string
		expected string
	}{
		{"Hello World", "hello-world"},
		{"  Spaces  ", "spaces"},
		{"Special!@#Chars", "specialchars"},
		{"", "imported"},
		{"UPPER case", "upper-case"},
	}

	for _, tt := range tests {
		t.Run(tt.title, func(t *testing.T) {
			got := svc.generateID(tt.title)
			if got != tt.expected {
				t.Errorf("generateID(%q) = %q, want %q", tt.title, got, tt.expected)
			}
		})
	}
}
