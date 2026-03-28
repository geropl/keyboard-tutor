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
			"mary": {Practice: &ModeProgress{BestScore: 85, Stars: 2, CompletedAt: "2024-01-01T00:00:00.000Z"}},
		},
	}
	data, _ := json.Marshal(existing)
	os.WriteFile(fp, data, 0o644)

	m, err := NewManager(fp)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	all := m.GetAll()
	if all.Songs["mary"].Practice == nil || all.Songs["mary"].Practice.BestScore != 85 {
		t.Errorf("expected practice bestScore 85, got %+v", all.Songs["mary"])
	}
}

func TestSaveNewSongPractice(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	if err := m.Save("mary", 90, 2, "practice"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	all := m.GetAll()
	if all.Songs["mary"].Practice == nil {
		t.Fatal("expected practice progress")
	}
	if all.Songs["mary"].Practice.BestScore != 90 {
		t.Errorf("expected 90, got %d", all.Songs["mary"].Practice.BestScore)
	}
	if all.Songs["mary"].Performance != nil {
		t.Error("expected no performance progress")
	}
}

func TestSaveNewSongPerformance(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	if err := m.Save("mary", 75, 1, "performance"); err != nil {
		t.Fatalf("Save: %v", err)
	}
	all := m.GetAll()
	if all.Songs["mary"].Performance == nil {
		t.Fatal("expected performance progress")
	}
	if all.Songs["mary"].Performance.BestScore != 75 {
		t.Errorf("expected 75, got %d", all.Songs["mary"].Performance.BestScore)
	}
	if all.Songs["mary"].Practice != nil {
		t.Error("expected no practice progress")
	}
}

func TestSaveBothModes(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 90, 2, "practice")
	m.Save("mary", 70, 1, "performance")

	all := m.GetAll()
	if all.Songs["mary"].Practice.BestScore != 90 {
		t.Errorf("practice: expected 90, got %d", all.Songs["mary"].Practice.BestScore)
	}
	if all.Songs["mary"].Performance.BestScore != 70 {
		t.Errorf("performance: expected 70, got %d", all.Songs["mary"].Performance.BestScore)
	}
}

func TestSaveOnlyImproves(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 90, 2, "practice")
	m.Save("mary", 70, 1, "practice") // worse, should be ignored

	all := m.GetAll()
	if all.Songs["mary"].Practice.BestScore != 90 {
		t.Errorf("expected 90 (unchanged), got %d", all.Songs["mary"].Practice.BestScore)
	}
}

func TestSaveImprovedScore(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 70, 1, "practice")
	m.Save("mary", 95, 3, "practice")

	all := m.GetAll()
	if all.Songs["mary"].Practice.BestScore != 95 {
		t.Errorf("expected 95, got %d", all.Songs["mary"].Practice.BestScore)
	}
}

func TestSavePerformanceDoesNotAffectPractice(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 90, 2, "practice")
	m.Save("mary", 60, 1, "performance")

	all := m.GetAll()
	if all.Songs["mary"].Practice.BestScore != 90 {
		t.Errorf("practice should be unchanged: expected 90, got %d", all.Songs["mary"].Practice.BestScore)
	}
}

func TestSavePersistsToDisk(t *testing.T) {
	fp := tempFile(t)
	m, _ := NewManager(fp)
	m.Save("mary", 80, 2, "practice")

	data, err := os.ReadFile(fp)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	var pd ProgressData
	json.Unmarshal(data, &pd)
	if pd.Songs["mary"].Practice == nil || pd.Songs["mary"].Practice.BestScore != 80 {
		t.Errorf("expected 80 on disk, got %+v", pd.Songs["mary"])
	}
}

func TestGetAllReturnsCopy(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 80, 2, "practice")

	all := m.GetAll()
	all.Songs["mary"].Practice.BestScore = 0

	all2 := m.GetAll()
	if all2.Songs["mary"].Practice.BestScore != 80 {
		t.Error("GetAll did not return a deep copy")
	}
}

func TestMigrateOldFormat(t *testing.T) {
	fp := tempFile(t)
	os.MkdirAll(filepath.Dir(fp), 0o755)

	// Write old format: flat bestScore/stars/completedAt under song ID
	oldData := `{
		"songs": {
			"mary": { "bestScore": 85, "stars": 2, "completedAt": "2024-01-01T00:00:00.000Z" },
			"ode":  { "bestScore": 70, "stars": 1, "completedAt": "2024-02-01T00:00:00.000Z" }
		}
	}`
	os.WriteFile(fp, []byte(oldData), 0o644)

	m, err := NewManager(fp)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	all := m.GetAll()

	// Should be migrated to practice mode
	if all.Songs["mary"].Practice == nil {
		t.Fatal("mary: expected practice progress after migration")
	}
	if all.Songs["mary"].Practice.BestScore != 85 {
		t.Errorf("mary: expected 85, got %d", all.Songs["mary"].Practice.BestScore)
	}
	if all.Songs["mary"].Practice.Stars != 2 {
		t.Errorf("mary: expected 2 stars, got %d", all.Songs["mary"].Practice.Stars)
	}
	if all.Songs["mary"].Performance != nil {
		t.Error("mary: expected no performance progress after migration")
	}

	if all.Songs["ode"].Practice == nil {
		t.Fatal("ode: expected practice progress after migration")
	}
	if all.Songs["ode"].Practice.BestScore != 70 {
		t.Errorf("ode: expected 70, got %d", all.Songs["ode"].Practice.BestScore)
	}

	// Verify migrated format was written to disk
	diskData, _ := os.ReadFile(fp)
	var pd ProgressData
	json.Unmarshal(diskData, &pd)
	if pd.Songs["mary"].Practice == nil || pd.Songs["mary"].Practice.BestScore != 85 {
		t.Error("migration was not persisted to disk")
	}
}

func TestMigrateOldFormatDoesNotAffectNewFormat(t *testing.T) {
	fp := tempFile(t)
	os.MkdirAll(filepath.Dir(fp), 0o755)

	newData := ProgressData{
		Songs: map[string]SongProgress{
			"mary": {
				Practice:    &ModeProgress{BestScore: 90, Stars: 2, CompletedAt: "2024-01-01T00:00:00.000Z"},
				Performance: &ModeProgress{BestScore: 70, Stars: 1, CompletedAt: "2024-02-01T00:00:00.000Z"},
			},
		},
	}
	data, _ := json.Marshal(newData)
	os.WriteFile(fp, data, 0o644)

	m, err := NewManager(fp)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	all := m.GetAll()
	if all.Songs["mary"].Practice.BestScore != 90 {
		t.Errorf("practice: expected 90, got %d", all.Songs["mary"].Practice.BestScore)
	}
	if all.Songs["mary"].Performance.BestScore != 70 {
		t.Errorf("performance: expected 70, got %d", all.Songs["mary"].Performance.BestScore)
	}
}

func TestDefaultModeIsPractice(t *testing.T) {
	m, _ := NewManager(tempFile(t))
	m.Save("mary", 80, 2, "")
	m.Save("ode", 70, 1, "unknown")

	all := m.GetAll()
	if all.Songs["mary"].Practice == nil || all.Songs["mary"].Practice.BestScore != 80 {
		t.Error("empty mode should default to practice")
	}
	if all.Songs["ode"].Practice == nil || all.Songs["ode"].Practice.BestScore != 70 {
		t.Error("unknown mode should default to practice")
	}
}
