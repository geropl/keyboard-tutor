package songs

import (
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
	svc, err := NewService(testFS())
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
	svc, err := NewService(testFS())
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
	svc, err := NewService(testFS())
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
	svc, err := NewService(testFS())
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
	svc, err := NewService(fs)
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
	svc, err := NewService(fs)
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
