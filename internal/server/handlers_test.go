package server

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/geropl/keyboard-tutor/internal/progress"
	"github.com/geropl/keyboard-tutor/internal/songs"
)

var testSongFS = fstest.MapFS{
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

func testSongService(t *testing.T) *songs.Service {
	t.Helper()
	svc, err := songs.NewService(testSongFS, "")
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func testSongServiceWithDataDir(t *testing.T) *songs.Service {
	t.Helper()
	dataDir := filepath.Join(t.TempDir(), "songs")
	svc, err := songs.NewService(testSongFS, dataDir)
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
	h.SongByID(w, req)

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
	h.SongByID(w, req)

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
	prog.Save("mary", 85, 2, "practice", 0)

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

const validSongJSON = `{
	"title": "Test Song",
	"composer": "Tester",
	"difficulty": 3,
	"tempo": 120,
	"timeSignature": [4, 4],
	"tracks": [{"hand":"right","notes":[{"note":60,"start":0,"duration":1}]}]
}`

func TestSongCreateHandler(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	req := httptest.NewRequest("POST", "/api/songs", strings.NewReader(validSongJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.SongList(w, req)

	if w.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var body map[string]string
	json.Unmarshal(w.Body.Bytes(), &body)
	if body["id"] != "test-song" {
		t.Errorf("expected id 'test-song', got %q", body["id"])
	}

	// Verify it's retrievable
	song := h.Songs.Get("test-song")
	if song == nil {
		t.Fatal("song not found after create")
	}
}

func TestSongCreateValidationError(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	badJSON := `{"title":"","tempo":0,"timeSignature":[4,4],"difficulty":3,"tracks":[]}`
	req := httptest.NewRequest("POST", "/api/songs", strings.NewReader(badJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.SongList(w, req)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSongDeleteHandler(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	// First create a song
	req := httptest.NewRequest("POST", "/api/songs", strings.NewReader(validSongJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.SongList(w, req)
	if w.Code != 201 {
		t.Fatalf("create: expected 201, got %d", w.Code)
	}

	// Delete it
	req = httptest.NewRequest("DELETE", "/api/songs/test-song", nil)
	w = httptest.NewRecorder()
	h.SongByID(w, req)

	if w.Code != 204 {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify gone
	if h.Songs.Get("test-song") != nil {
		t.Error("song still exists after delete")
	}
}

func TestSongDeleteBuiltIn(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	req := httptest.NewRequest("DELETE", "/api/songs/mary", nil)
	w := httptest.NewRecorder()
	h.SongByID(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSongUpdateHandler(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	// Create
	req := httptest.NewRequest("POST", "/api/songs", strings.NewReader(validSongJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.SongList(w, req)
	if w.Code != 201 {
		t.Fatalf("create: expected 201, got %d", w.Code)
	}

	// Update
	updatedJSON := `{
		"title": "Updated Song",
		"composer": "Updater",
		"difficulty": 5,
		"tempo": 140,
		"timeSignature": [3, 4],
		"tracks": [{"hand":"left","notes":[{"note":48,"start":0,"duration":2}]}]
	}`
	req = httptest.NewRequest("PUT", "/api/songs/test-song", strings.NewReader(updatedJSON))
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	h.SongByID(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var song songs.Song
	json.Unmarshal(w.Body.Bytes(), &song)
	if song.Title != "Updated Song" {
		t.Errorf("expected 'Updated Song', got %q", song.Title)
	}
	if song.Difficulty != 5 {
		t.Errorf("expected difficulty 5, got %d", song.Difficulty)
	}
}

func TestSongUpdateBuiltIn(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	req := httptest.NewRequest("PUT", "/api/songs/mary", strings.NewReader(validSongJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.SongByID(w, req)

	if w.Code != 403 {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSongListIncludesSource(t *testing.T) {
	h := &Handlers{Songs: testSongServiceWithDataDir(t), Progress: testProgress(t)}

	// Create an imported song
	req := httptest.NewRequest("POST", "/api/songs", strings.NewReader(validSongJSON))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.SongList(w, req)

	// Now list
	req = httptest.NewRequest("GET", "/api/songs", nil)
	w = httptest.NewRecorder()
	h.SongList(w, req)

	var list []songs.SongSummary
	json.Unmarshal(w.Body.Bytes(), &list)

	sources := map[string]string{}
	for _, s := range list {
		sources[s.ID] = s.Source
	}
	if sources["mary"] != "builtin" {
		t.Errorf("mary source: expected 'builtin', got %q", sources["mary"])
	}
	if sources["test-song"] != "imported" {
		t.Errorf("test-song source: expected 'imported', got %q", sources["test-song"])
	}
}
