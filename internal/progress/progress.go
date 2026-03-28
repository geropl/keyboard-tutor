package progress

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type SongProgress struct {
	BestScore   int    `json:"bestScore"`
	Stars       int    `json:"stars"`
	CompletedAt string `json:"completedAt"`
}

type ProgressData struct {
	Songs map[string]SongProgress `json:"songs"`
}

// Manager handles reading and writing progress to a JSON file.
type Manager struct {
	mu       sync.Mutex
	filePath string
	data     ProgressData
}

// NewManager creates a Manager that persists to the given file path.
// It loads existing data if the file exists.
func NewManager(filePath string) (*Manager, error) {
	m := &Manager{
		filePath: filePath,
		data:     ProgressData{Songs: make(map[string]SongProgress)},
	}
	if err := m.load(); err != nil {
		return nil, err
	}
	return m, nil
}

func (m *Manager) load() error {
	data, err := os.ReadFile(m.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return json.Unmarshal(data, &m.data)
}

// GetAll returns the full progress data.
func (m *Manager) GetAll() ProgressData {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := ProgressData{Songs: make(map[string]SongProgress, len(m.data.Songs))}
	for k, v := range m.data.Songs {
		cp.Songs[k] = v
	}
	return cp
}

// Save updates progress for a song if the new score is higher than the existing best.
func (m *Manager) Save(songID string, score int, stars int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.data.Songs[songID]
	if ok && score <= existing.BestScore {
		return nil
	}

	m.data.Songs[songID] = SongProgress{
		BestScore:   score,
		Stars:       stars,
		CompletedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	return m.write()
}

func (m *Manager) write() error {
	if err := os.MkdirAll(filepath.Dir(m.filePath), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(m.data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.filePath, data, 0o644)
}
