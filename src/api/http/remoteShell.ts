import type { RemoteShell, RemoteShellHandlers } from '../types';

/*
 * The admin's shell on another node (`/api/v1/peers/{id}/remote/shell`, see the API spec).
 *
 * Binary messages are terminal bytes both ways. Text messages are JSON: to the hub
 * `{"type":"resize","cols":80,"rows":24}`, from it `{"type":"opened"}` and
 * `{"type":"closed","reason":"…"}`. It does not reconnect: a shell that ended is over.
 */

export interface RemoteShellOptions {
  url: string;
  WebSocket?: typeof WebSocket;
}

export function createRemoteShell(options: RemoteShellOptions, handlers: RemoteShellHandlers): Promise<RemoteShell> {
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const socket = new Socket(options.url);
  socket.binaryType = 'arraybuffer';
  const encoder = new TextEncoder();
  let closed = false;
  const finish = (reason: string) => {
    if (closed) return;
    closed = true;
    handlers.onClose(reason);
  };

  const shell: RemoteShell = {
    write(data) {
      if (socket.readyState === Socket.OPEN && data.length > 0) socket.send(encoder.encode(data));
    },
    resize(cols, rows) {
      if (socket.readyState === Socket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    },
    close() {
      socket.close(1000);
      finish('Closed.');
    },
  };

  return new Promise((resolve, reject) => {
    let opened = false;
    socket.onopen = () => {
      opened = true;
      resolve(shell);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        handlers.onOutput(new Uint8Array(event.data));
        return;
      }
      let message: { type?: string; reason?: string };
      try {
        message = JSON.parse(String(event.data)) as typeof message;
      } catch {
        return;
      }
      if (message.type === 'opened') handlers.onOpen();
      else if (message.type === 'closed') finish(message.reason ?? 'The shell ended.');
    };
    socket.onclose = () => {
      if (!opened) reject(new Error('The device refused to open the shell.'));
      finish('The connection to this device dropped.');
    };
  });
}
