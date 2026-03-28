import fs from 'fs';
import path from 'path';

const songsDir = path.join(process.cwd(), 'songs');
let songsCache = null;

function loadSongs() {
  if (songsCache) return songsCache;
  const files = fs.readdirSync(songsDir).filter(f => f.endsWith('.json'));
  songsCache = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(songsDir, f), 'utf-8'));
    return data;
  });
  songsCache.sort((a, b) => a.difficulty - b.difficulty || a.title.localeCompare(b.title));
  return songsCache;
}

export function getSongList() {
  return loadSongs().map(s => ({
    id: s.id,
    title: s.title,
    composer: s.composer,
    difficulty: s.difficulty,
    description: s.description,
    skillFocus: s.skillFocus,
  }));
}

export function getSong(id) {
  return loadSongs().find(s => s.id === id) || null;
}

export function reloadSongs() {
  songsCache = null;
}
