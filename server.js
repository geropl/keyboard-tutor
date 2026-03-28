import http from 'http';
import fs from 'fs';
import path from 'path';
import { MidiReader } from './server/midi.js';
import { setupWebSocket } from './server/websocket.js';
import { getSongList, getSong } from './server/songs.js';
import { ProgressManager } from './server/progress.js';

const PORT = 3000;
const PUBLIC_DIR = path.join(process.cwd(), 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res) {
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

function handleAPI(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/songs') {
    res.end(JSON.stringify(getSongList()));
    return true;
  }

  const songMatch = req.url.match(/^\/api\/songs\/(.+)$/);
  if (songMatch) {
    const song = getSong(decodeURIComponent(songMatch[1]));
    if (song) {
      res.end(JSON.stringify(song));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Song not found' }));
    }
    return true;
  }

  if (req.url === '/api/progress') {
    res.end(JSON.stringify(progress.getAll()));
    return true;
  }

  return false;
}

// Start MIDI reader
const midi = new MidiReader('/dev/midi1');
midi.on('error', (err) => {
  console.error('MIDI error:', err.message);
});
midi.start();
console.log('MIDI reader started on /dev/midi1');

// Progress manager
const progress = new ProgressManager();

// HTTP server
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    if (!handleAPI(req, res)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } else {
    serveStatic(req, res);
  }
});

// WebSocket
setupWebSocket(server, midi, progress);

server.listen(PORT, () => {
  console.log(`Piano Tutor running at http://localhost:${PORT}`);
});
