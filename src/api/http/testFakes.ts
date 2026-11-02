/*
 * Stand-ins for `fetch` and `WebSocket`, for the transport's tests. Not part of
 * the app.
 */

export interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply = { status?: number; body?: unknown; text?: string };
type Route = Reply | ((call: Call) => Reply);

/**
 * A hub that answers from a table of `"METHOD /path"` → reply. A route given a
 * list answers with each reply in turn and then repeats the last one. Every
 * request is recorded in `calls`.
 */
export function fakeHub(routes: Record<string, Route | Route[]>) {
  const calls: Call[] = [];
  const served = new Map<string, number>();

  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const path = url.startsWith('/api/v1') ? url.slice('/api/v1'.length) : url;
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      path,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);

    const key = `${method} ${path}`;
    const entry = routes[key];
    if (entry === undefined) return new Response(JSON.stringify({ code: 'not_found', message: `No route for ${key}` }), { status: 404 });
    let route: Route;
    if (Array.isArray(entry)) {
      const index = served.get(key) ?? 0;
      served.set(key, index + 1);
      route = entry[Math.min(index, entry.length - 1)]!;
    } else {
      route = entry;
    }
    const reply = typeof route === 'function' ? route(call) : route;
    const text = reply.text ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
    return new Response(text === '' ? null : text, { status: reply.status ?? 200 });
  };

  return { fetch: fetch as typeof globalThis.fetch, calls };
}

/** A WebSocket the test drives by hand. Every socket made is in `FakeSocket.made`. */
export class FakeSocket {
  static made: FakeSocket[] = [];
  static reset() {
    FakeSocket.made = [];
  }
  static last(): FakeSocket {
    const socket = FakeSocket.made.at(-1);
    if (!socket) throw new Error('No socket was opened');
    return socket;
  }

  readonly url: string;
  readonly sent: unknown[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onclose: ((close: { code: number }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.made.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000) {
    this.closedWith = code;
  }

  /* What the hub does. */

  open() {
    this.onopen?.();
  }

  event(topic: string, type: string, data?: unknown) {
    this.onmessage?.({ data: JSON.stringify({ topic, type, ts_ms: Date.now(), data }) });
  }

  drop(code = 1006) {
    this.onclose?.({ code });
  }
}

export const FakeWebSocket = FakeSocket as unknown as typeof WebSocket;

/** Lets pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
