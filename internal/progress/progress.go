package progress

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// ModeProgress holds the best score for a single mode.
type ModeProgress struct {
	BestScore   int    `json:"bestScore"`
	Stars       int    `json:"stars"`
	Accuracy    int    `json:"accuracy,omitempty"`
	CompletedAt string `json:"completedAt"`
}

// SongProgress holds per-mode progress for a song.
type SongProgress struct {
	Practice    *ModeProgress `json:"practice,omitempty"`
	Performance *ModeProgress `json:"performance,omitempty"`
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
// It loads existing data if the file exists, migrating old format if needed.
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

	// Try new format first
	if err := json.Unmarshal(data, &m.data); err != nil {
		return err
	}
	if m.data.Songs == nil {
		m.data.Songs = make(map[string]SongProgress)
	}

	// Detect and migrate old format entries.
	// Old format: { "songs": { "id": { "bestScore": N, "stars": N, "completedAt": "..." } } }
	// New format: { "songs": { "id": { "practice": {...}, "performance": {...} } } }
	// Re-parse songs as raw JSON to detect old-style entries.
	var raw struct {
		Songs map[string]json.RawMessage `json:"songs"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}

	migrated := false
	for id, rawEntry := range raw.Songs {
		var oldEntry struct {
			BestScore   int    `json:"bestScore"`
			Stars       int    `json:"stars"`
			CompletedAt string `json:"completedAt"`
		}
		if err := json.Unmarshal(rawEntry, &oldEntry); err != nil {
			continue
		}
		// Old format has bestScore > 0 and no practice/performance keys
		var probe struct {
			Practice    *json.RawMessage `json:"practice"`
			Performance *json.RawMessage `json:"performance"`
		}
		json.Unmarshal(rawEntry, &probe)

		if oldEntry.BestScore > 0 && probe.Practice == nil && probe.Performance == nil {
			m.data.Songs[id] = SongProgress{
				Practice: &ModeProgress{
					BestScore:   oldEntry.BestScore,
					Stars:       oldEntry.Stars,
					CompletedAt: oldEntry.CompletedAt,
				},
			}
			migrated = true
		}
	}

	if migrated {
		return m.write()
	}
	return nil
}

// GetAll returns the full progress data (deep copy).
func (m *Manager) GetAll() ProgressData {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := ProgressData{Songs: make(map[string]SongProgress, len(m.data.Songs))}
	for k, v := range m.data.Songs {
		sp := SongProgress{}
		if v.Practice != nil {
			p := *v.Practice
			sp.Practice = &p
		}
		if v.Performance != nil {
			p := *v.Performance
			sp.Performance = &p
		}
		cp.Songs[k] = sp
	}
	return cp
}

// Save updates progress for a song in the given mode if the new score is higher.
// Accuracy is stored independently as best-value (highest accuracy is kept even
// if the score doesn't improve).
func (m *Manager) Save(songID string, score int, stars int, mode string, accuracy int) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	sp := m.data.Songs[songID]

	var existing *ModeProgress
	switch mode {
	case "performance":
		existing = sp.Performance
	default:
		existing = sp.Practice
	}

	if existing != nil && score <= existing.BestScore {
		// Score didn't improve, but accuracy might have
		if accuracy > existing.Accuracy {
			existing.Accuracy = accuracy
			m.data.Songs[songID] = sp
			return m.write()
		}
		return nil
	}

	mp := &ModeProgress{
		BestScore:   score,
		Stars:       stars,
		Accuracy:    accuracy,
		CompletedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	// Preserve best accuracy from previous entry if it was higher
	if existing != nil && existing.Accuracy > accuracy {
		mp.Accuracy = existing.Accuracy
	}

	switch mode {
	case "performance":
		sp.Performance = mp
	default:
		sp.Practice = mp
	}

	m.data.Songs[songID] = sp
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
