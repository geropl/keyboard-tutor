package server

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/geropl/keyboard-tutor/internal/progress"
	"github.com/geropl/keyboard-tutor/internal/songs"
)

func testSongService(t *testing.T) *songs.Service {
	t.Helper()
	fs := fstest.MapFS{
		"mary.json": &fstest.MapFile{
			Data: []byte(`{
				"id": "mary",
				"title": "Mary Had a Little Lamb",
				"composer": "Traditional",
				"difficulty": 1,
				"tempo": 110,
				"timeSignature": [4, 4],
				"description": "A classic",
				"skillFocus": "Right hand",
				"tracks": [{"hand":"right","notes":[{"note":64,"start":0,"duration":1}]}]
			}`),
		},
	}
	svc, err := songs.NewService(fs)
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func testProgress(t *testing.T) *progress.Manager {
	t.Helper()
	fp := filepath.Join(t.TempDir(), "data", "progress.json")
	m, err := progress.NewManager(fp)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return m
}

func TestSongListHandler(t *testing.T) {
	h := &Handlers{Songs: testSongService(t), Progress: testProgress(t)}

	req := httptest.NewRequest("GET", "/api/songs", nil)
	w := httptest.NewRecorder()
	h.SongList(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("expected application/json, got %q", ct)
	}

	var list []songs.SongSummary
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 song, got %d", len(list))
	}
	if list[0].ID != "mary" {
		t.Errorf("expected 'mary', got %q", list[0].ID)
	}
}

func TestSongGetHandler(t *testing.T) {
	h := &Handlers{Songs: testSongService(t), Progress: testProgress(t)}

	req := httptest.NewRequest("GET", "/api/songs/mary", nil)
	w := httptest.NewRecorder()
	h.SongGet(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var song songs.Song
	if err := json.Unmarshal(w.Body.Bytes(), &song); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if song.Tempo != 110 {
		t.Errorf("expected tempo 110, got %d", song.Tempo)
	}
	if len(song.Tracks) != 1 {
		t.Errorf("expected 1 track, got %d", len(song.Tracks))
	}
}

func TestSongGetNotFound(t *testing.T) {
	h := &Handlers{Songs: testSongService(t), Progress: testProgress(t)}

	req := httptest.NewRequest("GET", "/api/songs/nonexistent", nil)
	w := httptest.NewRecorder()
	h.SongGet(w, req)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}

	var body map[string]string
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["error"] != "Song not found" {
		t.Errorf("unexpected error: %q", body["error"])
	}
}

func TestProgressGetHandler(t *testing.T) {
	prog := testProgress(t)
	prog.Save("mary", 85, 2, "practice")

	h := &Handlers{Songs: testSongService(t), Progress: prog}

	req := httptest.NewRequest("GET", "/api/progress", nil)
	w := httptest.NewRecorder()
	h.ProgressGet(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var pd progress.ProgressData
	if err := json.Unmarshal(w.Body.Bytes(), &pd); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if pd.Songs["mary"].Practice == nil || pd.Songs["mary"].Practice.BestScore != 85 {
		t.Errorf("expected practice bestScore 85, got %+v", pd.Songs["mary"])
	}
}

func TestFullServerRouting(t *testing.T) {
	publicFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>test</html>")},
	}

	handler := New(Config{
		PublicFS: publicFS,
		Songs:   testSongService(t),
		Progress: testProgress(t),
	})

	tests := []struct {
		path string
		code int
	}{
		{"/api/songs", 200},
		{"/api/songs/mary", 200},
		{"/api/songs/nope", 404},
		{"/api/progress", 200},
		{"/index.html", 301}, // FileServer redirects /index.html to /
		{"/", 200},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			req := httptest.NewRequest("GET", tt.path, nil)
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tt.code {
				t.Errorf("%s: expected %d, got %d", tt.path, tt.code, w.Code)
			}
		})
	}
}
