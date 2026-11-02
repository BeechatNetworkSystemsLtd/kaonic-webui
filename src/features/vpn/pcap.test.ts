import { describe, expect, it } from 'vitest';
import { icmpEcho } from '@/lib/packetBuilder';
import { LINKTYPE_IPV4, readPcap, writePcap } from './pcap';

describe('pcap', () => {
  it('writes the header Wireshark expects and reads back what it wrote', () => {
    const ping = icmpEcho({ src: '10.20.1.1', dst: '10.20.3.4', request: true, id: 1, seq: 1 });
    const bytes = writePcap(
      [
        { tsUs: 1_792_000_000_123_456, len: ping.length, data: ping },
        { tsUs: 1_792_000_001_000_001, len: ping.length, data: ping.slice(0, 64) },
      ],
      128,
    );
    // Magic a1b2c3d4 written little-endian, version 2.4, LINKTYPE_IPV4.
    expect(Array.from(bytes.slice(0, 8))).toEqual([0xd4, 0xc3, 0xb2, 0xa1, 2, 0, 4, 0]);
    expect(bytes.length).toBe(24 + 16 + ping.length + 16 + 64);
    const file = readPcap(bytes);
    expect(file.linkType).toBe(LINKTYPE_IPV4);
    expect(file.snaplen).toBe(128);
    expect(file.records).toHaveLength(2);
    expect(file.records[0]).toEqual({ tsUs: 1_792_000_000_123_456, len: ping.length, data: ping });
    expect(file.records[1]!.data).toHaveLength(64);
    expect(file.records[1]!.len).toBe(ping.length);
  });

  it('refuses what is not a pcap', () => {
    expect(() => readPcap(new Uint8Array(24))).toThrow(/not a little-endian/);
  });
});
