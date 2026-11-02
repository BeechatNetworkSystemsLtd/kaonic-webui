import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventStream } from './events';
import { FakeSocket, FakeWebSocket } from './testFakes';

const stream = () =>
  createEventStream({ url: (topics) => `wss://kaonic/events?topics=${topics.join(',')}`, WebSocket: FakeWebSocket, minDelayMs: 1000, maxDelayMs: 8000, random: () => 1 });

beforeEach(() => FakeSocket.reset());
afterEach(() => vi.useRealTimers());

describe('event stream', () => {
  it('opens one socket for the first topic and tells the hub about later ones', () => {
    const events = stream();
    expect(FakeSocket.made).toHaveLength(0);

    const stopPeers = events.subscribe('peers', () => undefined);
    const socket = FakeSocket.last();
    expect(socket.url).toBe('wss://kaonic/events?topics=peers');

    // Before the socket is open, a new topic waits; it is sent once it opens.
    events.subscribe('jobs', () => undefined);
    socket.open();
    expect(socket.sent).toEqual([{ op: 'subscribe', topics: ['jobs'] }]);

    // A second handler for a topic changes nothing on the wire.
    const stopSecond = events.subscribe('peers', () => undefined);
    stopPeers();
    expect(socket.sent).toHaveLength(1);
    stopSecond();
    expect(socket.sent.at(-1)).toEqual({ op: 'unsubscribe', topics: ['peers'] });
    expect(FakeSocket.made).toHaveLength(1);
  });

  it('delivers events by topic and ignores what it cannot read', () => {
    const events = stream();
    const got: string[] = [];
    events.subscribe('jobs', (event) => got.push(event.type));
    const socket = FakeSocket.last();
    socket.open();
    socket.event('jobs', 'job.updated', {});
    socket.event('peers', 'peer.updated', {});
    socket.onmessage?.({ data: 'not json' });
    expect(got).toEqual(['job.updated']);
  });

  it('asks for a re-read on every (re)connect and when the hub says resync', () => {
    vi.useFakeTimers();
    const events = stream();
    let resyncs = 0;
    events.onResync(() => (resyncs += 1));
    events.subscribe('peers', () => undefined);

    FakeSocket.last().open();
    expect(resyncs).toBe(1);
    FakeSocket.last().event('system', 'resync');
    expect(resyncs).toBe(2);
    FakeSocket.last().drop();
    vi.advanceTimersByTime(1000);
    FakeSocket.last().open();
    expect(resyncs).toBe(3);
  });

  it('backs off between attempts, up to the limit, and starts over once connected', () => {
    vi.useFakeTimers();
    const events = stream();
    events.subscribe('peers', () => undefined);

    const delays: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = FakeSocket.made.length;
      FakeSocket.last().drop();
      let waited = 0;
      while (FakeSocket.made.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000]);

    FakeSocket.last().open();
    FakeSocket.last().drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.made).toHaveLength(7);
    expect(events.state()).toBe('connecting');
  });

  it('stays closed after a sign-out until it is resumed', () => {
    vi.useFakeTimers();
    const events = stream();
    events.subscribe('peers', () => undefined);
    const socket = FakeSocket.last();
    socket.open();

    events.stop();
    expect(socket.closedWith).toBe(1000);
    expect(events.state()).toBe('closed');
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.made).toHaveLength(1);

    events.resume();
    expect(FakeSocket.made).toHaveLength(2);
    expect(events.state()).toBe('connecting');
  });
});
