import fs from 'fs';
import path from 'path';

const progressFile = path.join(process.cwd(), 'data', 'progress.json');

export class ProgressManager {
  constructor() {
    this.data = { songs: {} };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(progressFile)) {
        this.data = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      }
    } catch (e) {
      this.data = { songs: {} };
    }
  }

  getAll() {
    return this.data;
  }

  save(songId, score, stars) {
    const existing = this.data.songs[songId];
    if (!existing || score > existing.bestScore) {
      this.data.songs[songId] = {
        bestScore: score,
        stars,
        completedAt: new Date().toISOString(),
      };
      this._write();
    }
  }

  _write() {
    fs.mkdirSync(path.dirname(progressFile), { recursive: true });
    fs.writeFileSync(progressFile, JSON.stringify(this.data, null, 2));
  }
}
