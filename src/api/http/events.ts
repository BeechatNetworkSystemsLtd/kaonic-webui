import type { ConnectionState } from '../client';
import type { WireEvent } from './wire';
import { noteEventTime } from '@/lib/hubClock';

/*
 * The hub's events WebSocket (`/api/v1/events`, see the API README).
 *
 * One socket carries every topic. It opens with the first subscription, tells
 * the hub when topics come and go, and reconnects with backoff when it drops.
 * After every (re)connect, and when the hub says `system.resync`, `onResync`
 * handlers run: events are deltas, so whatever was missed must be re-read.
 *
 * The hub closes the socket with 4401 when the session ends. The stream then
 * stops (state `closed`) until `resume()` is called after a new sign-in.
 */

/** Close code the hub uses when the session behind the socket has ended. */
export const SESSION_ENDED = 4401;

export interface EventStream {
  subscribe(topic: string, handler: (event: WireEvent) => void): () => void;
  onResync(handler: () => void): () => void;
  state(): ConnectionState;
  onStateChange(handler: (state: ConnectionState) => void): () => void;
  /** After a sign-in: connect again now if the stream stopped or is waiting to retry. */
  resume(): void;
  /** After a sign-out: close the socket and stay closed until `resume()`. */
  stop(): void;
}

export interface EventStreamOptions {
  /** Where to connect, given the topics to start with. */
  url: (topics: string[]) => string;
  WebSocket?: typeof WebSocket;
  /** Reconnect delay: doubles from `minMs` up to `maxMs`, with jitter. */
  minDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

export function createEventStream(options: EventStreamOptions): EventStream {
  const Socket = options.WebSocket ?? globalThis.WebSocket;
  const minDelay = options.minDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 30_000;
  const random = options.random ?? Math.random;

  const topics = new Map<string, Set<(event: WireEvent) => void>>();
  const resyncHandlers = new Set<() => void>();
  const stateHandlers = new Set<(state: ConnectionState) => void>();

  let socket: WebSocket | null = null;
  let open = false;
  /** The topics the hub knows this socket wants. */
  let sent = new Set<string>();
  let state: ConnectionState = 'connecting';
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  function setState(next: ConnectionState) {
    if (next === state) return;
    state = next;
    stateHandlers.forEach((handler) => handler(next));
  }

  function send(op: 'subscribe' | 'unsubscribe', names: string[]) {
    if (!socket || !open || names.length === 0) return;
    socket.send(JSON.stringify({ op, topics: names }));
    names.forEach((name) => (op === 'subscribe' ? sent.add(name) : sent.delete(name)));
  }

  /** Brings the hub's idea of our topics in line with ours. */
  function sync() {
    send('subscribe', [...topics.keys()].filter((name) => !sent.has(name)));
    send('unsubscribe', [...sent].filter((name) => !topics.has(name)));
  }

  function resync() {
    resyncHandlers.forEach((handler) => handler());
  }

  function connect() {
    retry = null;
    setState('connecting');
    const names = [...topics.keys()];
    const ws = new Socket(options.url(names));
    socket = ws;
    open = false;
    sent = new Set(names);

    ws.onopen = () => {
      if (socket !== ws) return;
      open = true;
      attempts = 0;
      setState('open');
      sync();
      resync();
    };
    ws.onmessage = (message: MessageEvent) => {
      if (socket !== ws || typeof message.data !== 'string') return;
      let event: WireEvent;
      try {
        event = JSON.parse(message.data) as WireEvent;
      } catch {
        return;
      }
      if (typeof event.ts_ms === 'number') noteEventTime(event.ts_ms);
      if (event.topic === 'system' && event.type === 'resync') resync();
      topics.get(event.topic)?.forEach((handler) => handler(event));
    };
    ws.onclose = (close: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      open = false;
      if (close.code === SESSION_ENDED) {
        stopped = true;
        setState('closed');
        return;
      }
      if (stopped) return;
      const delay = Math.min(maxDelay, minDelay * 2 ** attempts) * (0.5 + random() / 2);
      attempts += 1;
      setState('connecting');
      retry = setTimeout(connect, delay);
    };
  }

  function ensureConnected() {
    if (!stopped && !socket && !retry && topics.size > 0) connect();
  }

  return {
    subscribe(topic, handler) {
      let handlers = topics.get(topic);
      if (!handlers) {
        handlers = new Set();
        topics.set(topic, handlers);
      }
      handlers.add(handler);
      sync();
      ensureConnected();
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0 && topics.get(topic) === handlers) topics.delete(topic);
        sync();
      };
    },
    onResync(handler) {
      resyncHandlers.add(handler);
      return () => void resyncHandlers.delete(handler);
    },
    state: () => state,
    onStateChange(handler) {
      stateHandlers.add(handler);
      return () => void stateHandlers.delete(handler);
    },
    resume() {
      stopped = false;
      attempts = 0;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      ensureConnected();
    },
    stop() {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const ws = socket;
      socket = null;
      open = false;
      ws?.close(1000);
      setState('closed');
    },
  };
}
