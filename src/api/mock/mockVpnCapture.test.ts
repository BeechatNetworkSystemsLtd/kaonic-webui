import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dissect } from '@/features/vpn/dissect';
import { readPcap } from '@/features/vpn/pcap';
import { createMockCapture } from './mockVpnCapture';

const peers = () => [
  { id: 'a'.repeat(32), codename: 'emunode1', ip: '10.20.3.4' },
  { id: 'b'.repeat(32), codename: 'emunode2', ip: '10.20.5.6' },
];

describe('mock VPN capture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('captures nothing until started, then real packets cut to the snaplen', () => {
    const capture = createMockCapture('10.20.1.1', '10.20.0.0/16', peers);
    expect(capture.state().running).toBe(false);
    expect(capture.packets(0)).toEqual([]);
    capture.start({ snaplen: 64 });
    vi.advanceTimersByTime(5000);
    const packets = capture.packets(0);
    expect(packets.length).toBeGreaterThan(10);
    expect(packets.map((p) => p.seq)).toEqual(packets.map((_, i) => i + 1));
    for (const p of packets) {
      expect(p.data.length).toBeLessThanOrEqual(64);
      expect(p.len).toBeGreaterThanOrEqual(p.data.length);
      expect(dissect(p.data, { seq: p.seq, tsUs: p.tsUs, len: p.len, direction: p.direction, node: '', verdict: p.verdict, reason: p.reason }).summary.ipv4).toBe(true);
    }
    expect(packets.some((p) => p.verdict === 'dropped' && p.reason)).toBe(true);
    expect(packets.some((p) => p.flood && p.peerId === null)).toBe(true);
    expect(capture.packets(packets[3]!.seq)[0]!.seq).toBe(packets[4]!.seq);
  });

  it('keeps the newest in a ring, or stops when full', () => {
    const ring = createMockCapture('10.20.1.1', '10.20.0.0/16', peers);
    ring.start({ maxPackets: 100 });
    vi.advanceTimersByTime(60_000);
    const state = ring.state();
    expect(state.running).toBe(true);
    expect(state.packets).toBe(100);
    expect(state.dropped).toBeGreaterThan(0);

    const once = createMockCapture('10.20.1.1', '10.20.0.0/16', peers);
    once.start({ maxPackets: 100, ring: false });
    vi.advanceTimersByTime(60_000);
    expect(once.state()).toMatchObject({ running: false, packets: 100 });
  });

  it('stops after max_secs and on request, and checks its limits', () => {
    const capture = createMockCapture('10.20.1.1', '10.20.0.0/16', peers);
    capture.start({ maxSecs: 10 });
    vi.advanceTimersByTime(12_000);
    expect(capture.state().running).toBe(false);
    capture.start();
    expect(capture.stop().running).toBe(false);
    expect(() => capture.start({ snaplen: 20 })).toThrow(/Check the highlighted fields/);
  });

  it('downloads a pcap of what it holds', async () => {
    const capture = createMockCapture('10.20.1.1', '10.20.0.0/16', peers);
    capture.start({ snaplen: 96 });
    vi.advanceTimersByTime(3000);
    const held = capture.packets(0, 1000);
    const blob = capture.pcap();
    const file = readPcap(new Uint8Array(await blob.arrayBuffer()));
    expect(file.records.length).toBeGreaterThanOrEqual(held.length);
    expect(file.snaplen).toBe(96);
    expect(file.records[0]!.data).toEqual(held[0]!.data);
  });
});
