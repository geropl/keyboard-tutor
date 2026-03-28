export class Connection {
  constructor() {
    this.ws = null;
    this.listeners = { noteOn: [], noteOff: [], open: [], close: [] };
    this._connect();
  }

  _connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}`);
    this.ws.onopen = () => this._emit('open');
    this.ws.onclose = () => {
      this._emit('close');
      setTimeout(() => this._connect(), 1000);
    };
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'noteOn' || msg.type === 'noteOff') {
          this._emit(msg.type, msg);
        }
      } catch (err) { /* ignore */ }
    };
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  off(event, fn) {
    const arr = this.listeners[event];
    if (arr) this.listeners[event] = arr.filter(f => f !== fn);
  }

  _emit(event, data) {
    for (const fn of this.listeners[event] || []) fn(data);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
