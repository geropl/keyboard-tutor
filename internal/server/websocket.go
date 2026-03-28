package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/geropl/keyboard-tutor/internal/midi"
	"github.com/geropl/keyboard-tutor/internal/progress"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// WSHub manages WebSocket connections, broadcasts MIDI events,
// and handles incoming saveProgress messages.
type WSHub struct {
	mu       sync.Mutex
	clients  map[*websocket.Conn]struct{}
	progress *progress.Manager
	noteOn   <-chan midi.NoteEvent
	noteOff  <-chan midi.NoteEvent
}

// NewWSHub creates a hub and starts broadcasting MIDI events if channels are provided.
func NewWSHub(prog *progress.Manager, noteOn, noteOff <-chan midi.NoteEvent) *WSHub {
	h := &WSHub{
		clients:  make(map[*websocket.Conn]struct{}),
		progress: prog,
		noteOn:   noteOn,
		noteOff:  noteOff,
	}
	if noteOn != nil {
		go h.broadcastLoop(noteOn, "noteOn")
	}
	if noteOff != nil {
		go h.broadcastLoop(noteOff, "noteOff")
	}
	return h
}

// HandleUpgrade upgrades an HTTP request to a WebSocket connection.
func (h *WSHub) HandleUpgrade(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade: %v", err)
		return
	}

	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()

	go h.readPump(conn)
}

func (h *WSHub) readPump(conn *websocket.Conn) {
	defer func() {
		h.mu.Lock()
		delete(h.clients, conn)
		h.mu.Unlock()
		conn.Close()
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var msg struct {
			Type   string `json:"type"`
			SongID string `json:"songId"`
			Score  int    `json:"score"`
			Stars  int    `json:"stars"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		if msg.Type == "saveProgress" && h.progress != nil {
			if err := h.progress.Save(msg.SongID, msg.Score, msg.Stars); err != nil {
				log.Printf("save progress: %v", err)
			}
		}
	}
}

func (h *WSHub) broadcastLoop(ch <-chan midi.NoteEvent, eventType string) {
	for evt := range ch {
		msg := map[string]interface{}{
			"type":      eventType,
			"note":      evt.Note,
			"velocity":  evt.Velocity,
			"channel":   evt.Channel,
			"timestamp": evt.Timestamp,
		}
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		h.broadcast(data)
	}
}

func (h *WSHub) broadcast(data []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for conn := range h.clients {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			conn.Close()
			delete(h.clients, conn)
		}
	}
}
