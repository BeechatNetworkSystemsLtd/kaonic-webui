import { describe, expect, it } from 'vitest';
import { createRemoteShell } from './remoteShell';

class Socket {
  static OPEN = 1;
  static last: Socket;
  readyState = 0;
  binaryType = '';
  sent: unknown[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    Socket.last = this;
  }
  send(data: unknown) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : new TextDecoder().decode(data as Uint8Array));
  }
  close() {
    this.closed = true;
  }
}

describe('createRemoteShell', () => {
  it('carries keystrokes and output, and ends with the reason the hub gives', async () => {
    const events: string[] = [];
    const opening = createRemoteShell(
      { url: 'wss://kaonic/x', WebSocket: Socket as unknown as typeof WebSocket },
      { onOpen: () => events.push('open'), onOutput: (bytes) => events.push(new TextDecoder().decode(bytes)), onClose: (reason) => events.push(`closed: ${reason}`) },
    );
    const socket = Socket.last;
    expect(socket.binaryType).toBe('arraybuffer');
    socket.readyState = 1;
    socket.onopen!();
    const shell = await opening;
    socket.onmessage!({ data: '{"type":"opened"}' });
    socket.onmessage!({ data: new TextEncoder().encode('root@n3:~# ').buffer });
    shell.write('ls\r');
    shell.resize(100, 30);
    expect(socket.sent).toEqual(['ls\r', { type: 'resize', cols: 100, rows: 30 }]);
    socket.onmessage!({ data: '{"type":"closed","reason":"The shell ended."}' });
    socket.onclose!();
    expect(events).toEqual(['open', 'root@n3:~# ', 'closed: The shell ended.']);
  });

  it('fails when the hub refuses the socket', async () => {
    const opening = createRemoteShell({ url: 'wss://kaonic/x', WebSocket: Socket as unknown as typeof WebSocket }, { onOpen() {}, onOutput() {}, onClose() {} });
    Socket.last.onclose!();
    await expect(opening).rejects.toThrow();
  });
});
