import { describe, expect, it } from 'vitest';
import type { VpnCapturedPacket } from '@/api';
import { dns, icmpEcho, synOptions, TCP, tcp, udp } from '@/lib/packetBuilder';
import { CaptureBuffer } from './captureBuffer';
import { checkFilter, compileFilter } from './filter';

const packet = (seq: number, data: Uint8Array, patch: Partial<VpnCapturedPacket> = {}): VpnCapturedPacket => ({
  seq,
  tsUs: 1_792_000_000_000_000 + seq * 1000,
  direction: 'tx',
  peerId: 'a'.repeat(32),
  peerCodename: 'emunode1',
  flood: false,
  len: data.length,
  data,
  verdict: 'sent',
  reason: null,
  ...patch,
});

const buffer = new CaptureBuffer();
buffer.append([
  packet(1, tcp({ src: '10.20.1.1', dst: '10.20.3.4', srcPort: 41000, dstPort: 443, seq: 5, flags: TCP.SYN, options: synOptions(752, 1) })),
  packet(2, tcp({ src: '10.20.3.4', dst: '10.20.1.1', srcPort: 443, dstPort: 41000, seq: 9, ack: 6, flags: TCP.SYN | TCP.ACK }), { direction: 'rx' }),
  packet(3, udp({ src: '10.20.1.1', dst: '10.20.5.6', srcPort: 41001, dstPort: 53, payload: dns({ id: 7, name: 'tile.openstreetmap.org' }) }), { peerCodename: 'emunode2' }),
  packet(4, icmpEcho({ src: '10.20.1.1', dst: '10.20.3.4', request: true, id: 1, seq: 1 })),
  packet(5, udp({ src: '10.20.1.1', dst: '10.20.255.255', srcPort: 5400, dstPort: 5400, payload: new Uint8Array(200) }), { flood: true, peerId: null, peerCodename: null }),
  packet(6, icmpEcho({ src: '10.20.99.9', dst: '10.20.1.1', request: true, id: 2, seq: 2 }), { direction: 'rx', verdict: 'dropped', reason: 'source_not_allowed' }),
]);
const records = buffer.all().map((row) => row.record);

/** The frame numbers a filter lets through. */
const run = (expression: string) => records.filter((record) => compileFilter(expression).test(record)).map((record) => record.number);

describe('display filter', () => {
  it('lets everything through when empty', () => {
    expect(run('')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(run('   ')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('matches protocols', () => {
    expect(run('tcp')).toEqual([1, 2]);
    expect(run('udp')).toEqual([3, 5]);
    expect(run('dns')).toEqual([3]);
    expect(run('icmp')).toEqual([4, 6]);
    expect(run('!icmp')).toEqual([1, 2, 3, 5]);
    expect(run('not icmp and not tcp')).toEqual([3, 5]);
  });

  it('matches addresses, prefixes and ports', () => {
    expect(run('ip.addr == 10.20.3.4')).toEqual([1, 2, 4]);
    expect(run('ip.addr==10.20.0.0/16')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(run('ip.src == 10.20.3.4')).toEqual([2]);
    expect(run('ip.dst == 10.20.1.1')).toEqual([2, 6]);
    expect(run('ip.src != 10.20.1.1')).toEqual([2, 6]);
    expect(run('tcp.port == 443')).toEqual([1, 2]);
    expect(run('udp.port eq 53 || icmp')).toEqual([3, 4, 6]);
    expect(run('udp.dstport == 5400 && ip.dst == 10.20.255.255')).toEqual([5]);
  });

  it('matches flags, lengths and names', () => {
    expect(run('tcp.flags.syn == 1 && !tcp.flags.ack')).toEqual([1]);
    expect(run('tcp.flags.syn and tcp.flags.ack')).toEqual([2]);
    expect(run('frame.len > 200')).toEqual([5]);
    expect(run('frame.number >= 5')).toEqual([5, 6]);
    expect(run('dns.qry.name contains openstreetmap')).toEqual([3]);
    expect(run('dns.qry.name == "tile.openstreetmap.org"')).toEqual([3]);
    expect(run('icmp.type == 8 && ip.ttl == 64')).toEqual([4, 6]);
  });

  it('matches the hub\'s own fields', () => {
    expect(run('node == emunode2')).toEqual([3]);
    expect(run('node == all')).toEqual([5]);
    expect(run('verdict == dropped')).toEqual([6]);
    expect(run('reason contains source')).toEqual([6]);
    expect(run('dir == rx')).toEqual([2, 6]);
  });

  it('respects precedence and parentheses', () => {
    expect(run('tcp || udp && dns')).toEqual([1, 2, 3]);
    expect(run('(tcp || udp) && ip.dst == 10.20.5.6')).toEqual([3]);
    expect(run('!(udp.port == 53) && udp')).toEqual([5]);
  });

  it('explains what is wrong', () => {
    const wrong = (expression: string) => {
      const result = checkFilter(expression);
      expect(result.ok).toBe(false);
      return result.ok ? null : result;
    };
    expect(checkFilter('tcp.port == 80').ok).toBe(true);
    expect(wrong('tcp.port ==')?.message).toMatch(/value should follow/);
    expect(wrong('frob == 1')?.message).toMatch(/not a field/);
    expect(wrong('ip.addr == 300.1.1.1')?.message).toMatch(/not an IPv4 address/);
    expect(wrong('ip.addr == 10.0.0.0/40')?.message).toMatch(/not an IPv4 address/);
    expect(wrong('(tcp')?.message).toMatch(/never closed/);
    expect(wrong('tcp.port > abc')?.message).toMatch(/not a number/);
    expect(wrong('tcp tcp')).toMatchObject({ position: 4 });
    expect(wrong('tcp == 1')?.message).toMatch(/is a protocol/);
    expect(wrong('node > 3')?.message).toMatch(/compares numbers/);
    expect(wrong('dns.qry.name == "open')?.message).toMatch(/quote is never closed/);
    expect(wrong('tcp &&')?.message).toMatch(/ends too early/);
  });
});

describe('capture buffer', () => {
  it('numbers TCP from each stream start in the info column, and keeps only the newest', () => {
    const rows = buffer.all();
    expect(rows[0]!.summary.info).toMatch(/^41000 → 443 \[SYN\] Seq=0 /);
    expect(rows[1]!.summary.info).toMatch(/^443 → 41000 \[SYN, ACK\] Seq=0 Ack=1 /);
    const small = new CaptureBuffer(3);
    small.append(buffer.all().map((row) => row.packet));
    expect(small.all().map((row) => row.packet.seq)).toEqual([4, 5, 6]);
    expect(small.append([buffer.all()[0]!.packet])).toBe(0);
    small.clearRows();
    expect(small.all()).toEqual([]);
    expect(small.after()).toBe(6);
  });
});
