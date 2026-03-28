package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/geropl/keyboard-tutor/internal/midi"
	"github.com/geropl/keyboard-tutor/internal/progress"
)

func wsConnect(t *testing.T, s *httptest.Server) *websocket.Conn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(s.URL, "http") + "/ws"
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

func TestWebSocketConnect(t *testing.T) {
	prog, _ := progress.NewManager(filepath.Join(t.TempDir(), "p.json"))
	hub := NewWSHub(prog, nil, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.HandleUpgrade)
	s := httptest.NewServer(mux)
	defer s.Close()

	conn := wsConnect(t, s)
	defer conn.Close()

	// Give the server goroutine time to register the client
	time.Sleep(50 * time.Millisecond)

	hub.mu.Lock()
	count := len(hub.clients)
	hub.mu.Unlock()
	if count != 1 {
		t.Errorf("expected 1 client, got %d", count)
	}
}

func TestWebSocketSaveProgress(t *testing.T) {
	fp := filepath.Join(t.TempDir(), "p.json")
	prog, _ := progress.NewManager(fp)
	hub := NewWSHub(prog, nil, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.HandleUpgrade)
	s := httptest.NewServer(mux)
	defer s.Close()

	conn := wsConnect(t, s)
	defer conn.Close()

	msg := map[string]interface{}{
		"type":   "saveProgress",
		"songId": "mary",
		"score":  95,
		"stars":  3,
	}
	data, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, data)

	// Give the server a moment to process
	time.Sleep(50 * time.Millisecond)

	all := prog.GetAll()
	if all.Songs["mary"].BestScore != 95 {
		t.Errorf("expected bestScore 95, got %d", all.Songs["mary"].BestScore)
	}
}

func TestWebSocketBroadcastNoteOn(t *testing.T) {
	prog, _ := progress.NewManager(filepath.Join(t.TempDir(), "p.json"))
	noteOn := make(chan midi.NoteEvent, 1)
	hub := NewWSHub(prog, noteOn, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.HandleUpgrade)
	s := httptest.NewServer(mux)
	defer s.Close()

	conn := wsConnect(t, s)
	defer conn.Close()

	// Give the connection time to register
	time.Sleep(20 * time.Millisecond)

	// Send a MIDI event
	noteOn <- midi.NoteEvent{Note: 60, Velocity: 100, Channel: 0, Timestamp: 12345}

	// Read the broadcast
	conn.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var msg map[string]interface{}
	json.Unmarshal(data, &msg)
	if msg["type"] != "noteOn" {
		t.Errorf("expected noteOn, got %v", msg["type"])
	}
	if int(msg["note"].(float64)) != 60 {
		t.Errorf("expected note 60, got %v", msg["note"])
	}
}

func TestWebSocketBroadcastNoteOff(t *testing.T) {
	prog, _ := progress.NewManager(filepath.Join(t.TempDir(), "p.json"))
	noteOff := make(chan midi.NoteEvent, 1)
	hub := NewWSHub(prog, nil, noteOff)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.HandleUpgrade)
	s := httptest.NewServer(mux)
	defer s.Close()

	conn := wsConnect(t, s)
	defer conn.Close()

	time.Sleep(20 * time.Millisecond)

	noteOff <- midi.NoteEvent{Note: 60, Velocity: 64, Channel: 0, Timestamp: 12345}

	conn.SetReadDeadline(time.Now().Add(time.Second))
	_, data, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var msg map[string]interface{}
	json.Unmarshal(data, &msg)
	if msg["type"] != "noteOff" {
		t.Errorf("expected noteOff, got %v", msg["type"])
	}
}

func TestWebSocketClientDisconnect(t *testing.T) {
	prog, _ := progress.NewManager(filepath.Join(t.TempDir(), "p.json"))
	hub := NewWSHub(prog, nil, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.HandleUpgrade)
	s := httptest.NewServer(mux)
	defer s.Close()

	conn := wsConnect(t, s)
	conn.Close()

	// Give the server time to clean up
	time.Sleep(50 * time.Millisecond)

	hub.mu.Lock()
	count := len(hub.clients)
	hub.mu.Unlock()
	if count != 0 {
		t.Errorf("expected 0 clients after disconnect, got %d", count)
	}
}
