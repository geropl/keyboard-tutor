import { WebSocketServer } from 'ws';

export function setupWebSocket(server, midiReader, progressManager) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'saveProgress' && progressManager) {
          progressManager.save(msg.songId, msg.score, msg.stars);
        }
      } catch (e) {
        // ignore malformed messages
      }
    });
    ws.on('close', () => clients.delete(ws));
  });

  function broadcast(msg) {
    const json = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(json);
    }
  }

  midiReader.on('noteOn', (e) => broadcast({ type: 'noteOn', ...e }));
  midiReader.on('noteOff', (e) => broadcast({ type: 'noteOff', ...e }));

  return wss;
}
