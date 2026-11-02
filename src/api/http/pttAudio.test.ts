import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PttAudioMessage } from '../client';
import { createPttAudioSocket, decodePcm, encodePcm } from './pttAudio';

class FakeAudioSocket {
  static made: FakeAudioSocket[] = [];
  binaryType = 'blob';
  readonly sent: Array<string | ArrayBuffer> = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string | ArrayBuffer }) => void) | null = null;
  onclose: ((close: { code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeAudioSocket.made.push(this);
  }
  send(data: string | ArrayBuffer) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.closedWith = code;
  }
  text(message: object) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const last = () => FakeAudioSocket.made.at(-1)!;
const controls = (socket: FakeAudioSocket) => socket.sent.filter((data): data is string => typeof data === 'string').map((data) => JSON.parse(data) as object);

function open(listen = true) {
  const messages: PttAudioMessage[] = [];
  const frames: Int16Array[] = [];
  const socket = createPttAudioSocket(
    { url: 'wss://hub/api/v1/ptt/audio', listen, WebSocket: FakeAudioSocket as unknown as typeof WebSocket, random: () => 1 },
    { onMessage: (message) => messages.push(message), onFrame: (frame) => frames.push(frame) },
  );
  return { socket, messages, frames };
}

describe('PCM framing', () => {
  it('round-trips little-endian samples', () => {
    const frame = new Int16Array([0, 1, -1, 32767, -32768]);
    const bytes = new Uint8Array(encodePcm(frame));
    expect(Array.from(bytes.slice(0, 6))).toEqual([0, 0, 1, 0, 255, 255]);
    expect(Array.from(decodePcm(bytes.buffer)!)).toEqual(Array.from(frame));
  });

  it('refuses half samples and empty messages', () => {
    expect(decodePcm(new ArrayBuffer(3))).toBeNull();
    expect(decodePcm(new ArrayBuffer(0))).toBeNull();
  });
});

describe('push-to-talk audio socket', () => {
  beforeEach(() => {
    FakeAudioSocket.made = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('listens on open, keys, sends frames only while keyed, and plays what arrives', () => {
    const { socket, messages, frames } = open();
    const ws = last();
    expect(ws.binaryType).toBe('arraybuffer');
    ws.onopen?.();
    socket.sendFrame(new Int16Array(320));
    socket.key();
    ws.text({ type: 'keyed' });
    socket.sendFrame(new Int16Array(320));
    socket.unkey();
    socket.sendFrame(new Int16Array(320));
    expect(controls(ws)).toEqual([{ op: 'listen' }, { op: 'key' }, { op: 'unkey' }]);
    expect(ws.sent.filter((data) => data instanceof ArrayBuffer)).toHaveLength(1);
    ws.onmessage?.({ data: encodePcm(new Int16Array([5, 6])) });
    expect(Array.from(frames[0]!)).toEqual([5, 6]);
    expect(messages).toEqual([{ type: 'keyed' }, { type: 'unkeyed', reason: 'released' }]);
  });

  it('starts and stops listening with the op, and keeps the choice across reconnects', () => {
    const { socket } = open(false);
    last().onopen?.();
    socket.listen(true);
    socket.listen(true);
    socket.listen(false);
    expect(controls(last())).toEqual([{ op: 'listen' }, { op: 'listen', on: false }]);
    socket.listen(true);
    last().onclose?.({ code: 1006 });
    vi.advanceTimersByTime(1000);
    last().onopen?.();
    expect(controls(last())).toEqual([{ op: 'listen' }]);
  });

  it('converts the talker from the wire', () => {
    const { messages } = open();
    last().onopen?.();
    last().text({ type: 'talker', talker: { id: 'ab', codename: 'emunode1', is_admin: false, local: false, source: null } });
    expect(messages).toEqual([{ type: 'talker', talker: { id: 'ab', codename: 'emunode1', isAdmin: false, local: false, source: null } }]);
  });

  it('reconnects after a drop, telling a talker it was cut off', () => {
    const { socket, messages } = open();
    last().onopen?.();
    socket.key();
    last().text({ type: 'keyed' });
    last().onclose?.({ code: 1006 });
    expect(messages.at(-1)).toEqual({ type: 'unkeyed', reason: 'timeout' });
    expect(socket.state()).toBe('connecting');
    vi.advanceTimersByTime(1000);
    expect(FakeAudioSocket.made).toHaveLength(2);
    last().onopen?.();
    expect(controls(last())).toEqual([{ op: 'listen' }]);
  });

  it('stops for good when the session ends, and refuses to key while down', () => {
    const { socket, messages } = open(false);
    last().onclose?.({ code: 4401 });
    expect(socket.state()).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(FakeAudioSocket.made).toHaveLength(1);
    socket.key();
    expect(messages).toEqual([{ type: 'unkeyed', reason: 'timeout' }]);
  });
});
