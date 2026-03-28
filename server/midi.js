import { EventEmitter } from 'events';
import fs from 'fs';

const STATE_IDLE = 0;
const STATE_DATA1 = 1;
const STATE_DATA2 = 2;

export class MidiReader extends EventEmitter {
  constructor(devicePath = '/dev/midi1') {
    super();
    this.devicePath = devicePath;
    this.state = STATE_IDLE;
    this.statusByte = 0;
    this.data1 = 0;
    this.stream = null;
  }

  start() {
    this.stream = fs.createReadStream(this.devicePath);
    this.stream.on('data', (buf) => {
      for (let i = 0; i < buf.length; i++) {
        this._processByte(buf[i]);
      }
    });
    this.stream.on('error', (err) => {
      this.emit('error', err);
    });
  }

  _processByte(byte) {
    // Active sensing - ignore
    if (byte === 0xFE) return;

    // System messages (0xF0-0xFF) - ignore and reset
    if (byte >= 0xF0) {
      this.state = STATE_IDLE;
      return;
    }

    // Status byte (0x80-0xEF)
    if (byte >= 0x80) {
      this.statusByte = byte;
      this.state = STATE_DATA1;
      return;
    }

    // Data byte (0x00-0x7F)
    switch (this.state) {
      case STATE_DATA1:
        this.data1 = byte;
        this.state = STATE_DATA2;
        break;
      case STATE_DATA2:
        this._emitMessage(this.statusByte, this.data1, byte);
        // Running status: stay ready for next data pair
        this.state = STATE_DATA1;
        break;
      // STATE_IDLE: orphan data byte, ignore
    }
  }

  _emitMessage(status, data1, data2) {
    const type = status & 0xF0;
    const channel = status & 0x0F;
    const timestamp = Date.now();

    if (type === 0x90 && data2 > 0) {
      this.emit('noteOn', { note: data1, velocity: data2, channel, timestamp });
    } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
      this.emit('noteOff', { note: data1, velocity: data2, channel, timestamp });
    }
  }

  close() {
    if (this.stream) {
      this.stream.destroy();
      this.stream = null;
    }
  }
}
