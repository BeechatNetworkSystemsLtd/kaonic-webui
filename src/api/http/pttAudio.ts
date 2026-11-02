import type { ConnectionState, PttAudioHandlers, PttAudioSocket } from '../client';
import { toPttAudioMessage } from './convert';
import { SESSION_ENDED } from './events';
import type { WirePttAudioMessage } from './wire';

/*
 * The push-to-talk audio socket (`/api/v1/ptt/audio`, see the API spec).
 *
 * Audio is binary: PCM signed 16-bit little-endian, mono, 16 kHz, one 20 ms
 * frame (320 samples) per message, both ways. Control is JSON text. The socket
 * reconnects with backoff when it drops, asking to listen again if it was. It does not
 * key again on its own: a press that was cut off is over, and the talker is
 * told (`unkeyed`, `timeout`). The hub closes it with 4401 when the session
 * ends, and it then stays closed.
 */

/** Samples in one 20 ms frame at 16 kHz. */
export const FRAME_SAMPLES = 320;

/** A frame as the hub wants it: little-endian whatever this machine is. */
export function encodePcm(frame: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(frame.length * 2);
  const view = new DataView(buffer);
  frame.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return buffer;
}

/** A frame from the hub; null for anything that is not whole 16-bit samples. */
export function decodePcm(data: ArrayBuffer): Int16Array | null {
  if (data.byteLength === 0 || data.byteLength % 2 !== 0) return null;
  const view = new DataView(data);
  const frame = new Int16Array(data.byteLength / 2);
  for (let index = 0; index < frame.length; index += 1) frame[index] = view.getInt16(index * 2, true);
  return frame;
}

export interface PttAudioOptions {
  url: string;
  listen: boolean;
  WebSocket?: typeof WebSocket;
  /** Reconnect delay: doubles from `minDelayMs` up to `maxDelayMs`, with jitter. */
  minDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

export function createPttAudioSocket(options: PttAudioOptions, handlers: PttAudioHandlers): PttAudioSocket {
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const minDelay = options.minDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 15_000;
  const random = options.random ?? Math.random;

  let socket: WebSocket | null = null;
  let open = false;
  let keyed = false;
  let state: ConnectionState = 'connecting';
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let listening = options.listen;

  function setState(next: ConnectionState) {
    if (next === state) return;
    state = next;
    handlers.onState?.(next);
  }

  function control(message: object) {
    if (socket && open) socket.send(JSON.stringify(message));
  }

  /** The floor is gone; tell the talker once. */
  function dropKey(reason: 'released' | 'preempted' | 'timeout') {
    if (!keyed) return;
    keyed = false;
    handlers.onMessage?.({ type: 'unkeyed', reason });
  }

  function connect() {
    retry = null;
    setState('connecting');
    const ws = new Socket(options.url);
    ws.binaryType = 'arraybuffer';
    socket = ws;
    open = false;

    ws.onopen = () => {
      if (socket !== ws) return;
      open = true;
      attempts = 0;
      setState('open');
      if (listening) control({ op: 'listen' });
    };
    ws.onmessage = (message: MessageEvent) => {
      if (socket !== ws) return;
      if (typeof message.data === 'string') {
        let wire: WirePttAudioMessage;
        try {
          wire = JSON.parse(message.data) as WirePttAudioMessage;
        } catch {
          return;
        }
        const parsed = toPttAudioMessage(wire);
        if (parsed.type === 'keyed') keyed = true;
        if (parsed.type === 'unkeyed' || parsed.type === 'busy') keyed = false;
        handlers.onMessage?.(parsed);
        return;
      }
      if (message.data instanceof ArrayBuffer) {
        const frame = decodePcm(message.data);
        if (frame) handlers.onFrame?.(frame);
      }
    };
    ws.onclose = (close: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      open = false;
      dropKey('timeout');
      if (close.code === SESSION_ENDED || stopped) {
        stopped = true;
        setState('closed');
        return;
      }
      const delay = Math.min(maxDelay, minDelay * 2 ** attempts) * (0.5 + random() / 2);
      attempts += 1;
      setState('connecting');
      retry = setTimeout(connect, delay);
    };
  }

  connect();

  return {
    state: () => state,
    listen(on) {
      if (on === listening) return;
      listening = on;
      control(on ? { op: 'listen' } : { op: 'listen', on: false });
    },
    key() {
      if (!open) {
        // Pressed while the socket is down: there is no floor to ask for.
        handlers.onMessage?.({ type: 'unkeyed', reason: 'timeout' });
        return;
      }
      control({ op: 'key' });
    },
    unkey() {
      control({ op: 'unkey' });
      dropKey('released');
    },
    sendFrame(frame) {
      if (socket && open && keyed) socket.send(encodePcm(frame));
    },
    close() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const ws = socket;
      socket = null;
      open = false;
      keyed = false;
      ws?.close(1000);
      setState('closed');
    },
  };
}
