package progress

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func tempFile(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "data", "progress.json")
}

func TestNewManagerNoFile(t *testing.T) {
	m, err := NewManager(tempFile(t))
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	data := m.GetAll()
	if len(data.Songs) != 0 {
		t.Errorf("expected empty songs, got %d", len(data.Songs))
	}
}

func TestNewManagerExistingFile(t *testing.T) {
	fp := tempFile(t)
	os.MkdirAll(filepath.Dir(fp), 0o755)
	existing := ProgressData{
		Songs: map[string]SongProgress{
			"mary": {BestScore: 85, Stars: 2, CompletedAt: "2024-01-01T00:00:00.000Z"},
		},
	}
	data, _ := json.Marshal(existing)
	os.WriteFile(fp, data, 0o644)

	m, err := NewManager(fp)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	all := m.GetAll()
	if all.Songs["mary"].BestScore != 85 {
		t.Errorf("expected bestScore 85, got %d", all.Songs["mary"].BestScore)
	}
}

func TestSaveNewSong(t *testing.T) {
	m, err := NewManager(tempFile(t))
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	if err := m.Save("mary", 90, 2); err != nil {
		t.Fatalf("Save: %v", err)
	}
	all := m.GetAll()
	if all.Songs["mary"].BestScore != 90 {
		t.Errorf("expected 90, got %d", all.Songs["mary"].BestScore)
	}
	if all.Songs["mary"].Stars != 2 {
		t.Errorf("expected 2 stars, got %d", all.Songs["mary"].Stars)
	}
}

func TestSaveOnlyImproves(t *testing.T) {
	m, err := NewManager(tempFile(t))
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	m.Save("mary", 90, 2)
	m.Save("mary", 70, 1) // worse score, should be ignored

	all := m.GetAll()
	if all.Songs["mary"].BestScore != 90 {
		t.Errorf("expected 90 (unchanged), got %d", all.Songs["mary"].BestScore)
	}
	if all.Songs["mary"].Stars != 2 {
		t.Errorf("expected 2 stars (unchanged), got %d", all.Songs["mary"].Stars)
	}
}

func TestSaveImprovedScore(t *testing.T) {
	m, err := NewManager(tempFile(t))
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	m.Save("mary", 70, 1)
	m.Save("mary", 95, 3)

	all := m.GetAll()
	if all.Songs["mary"].BestScore != 95 {
		t.Errorf("expected 95, got %d", all.Songs["mary"].BestScore)
	}
}

func TestSavePersistsToDisk(t *testing.T) {
	fp := tempFile(t)
	m, _ := NewManager(fp)
	m.Save("mary", 80, 2)

	// Read file directly
	data, err := os.ReadFile(fp)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var pd ProgressData
	json.Unmarshal(data, &pd)
	if pd.Songs["mary"].BestScore != 80 {
		t.Errorf("expected 80 on disk, got %d", pd.Songs["mary"].BestScore)
	}
}

func TestGetAllReturnsCopy(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 80, 2)

	all := m.GetAll()
	all.Songs["mary"] = SongProgress{BestScore: 0}

	// Original should be unchanged
	all2 := m.GetAll()
	if all2.Songs["mary"].BestScore != 80 {
		t.Error("GetAll did not return a copy")
	}
}
