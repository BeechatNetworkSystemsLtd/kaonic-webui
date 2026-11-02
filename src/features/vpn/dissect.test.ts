import { describe, expect, it } from 'vitest';
import { dns, icmpEcho, ipv4, synOptions, TCP, tcp, udp } from '@/lib/packetBuilder';
import { dissect, fieldAt, internetChecksum, TcpStreams, TRUNCATED, type Field, type FrameMeta } from './dissect';

const meta = (data: Uint8Array, patch: Partial<FrameMeta> = {}): FrameMeta => ({
  seq: 1,
  tsUs: 1_792_000_000_123_456,
  len: data.length,
  direction: 'tx',
  node: 'emunode1',
  verdict: 'sent',
  reason: null,
  ...patch,
});

const hexBytes = (text: string) => Uint8Array.from(text.trim().split(/\s+/).map((byte) => parseInt(byte, 16)));

/** Every field in the tree, depth first. */
function flatten(fields: Field[]): Field[] {
  return fields.flatMap((f) => [f, ...flatten(f.children ?? [])]);
}

const find = (fields: Field[], label: string) => flatten(fields).find((f) => f.label === label || f.label.endsWith(`= ${label}`));

describe('IPv4', () => {
  // The worked example of the IPv4 header checksum on Wikipedia: a UDP packet from 192.168.0.1 to 192.168.0.199.
  const header = hexBytes('45 00 00 73 00 00 40 00 40 11 b8 61 c0 a8 00 01 c0 a8 00 c7');

  it('reads the header and checks its checksum', () => {
    const { summary, tree } = dissect(header, meta(header, { len: 0x73 }));
    expect(summary).toMatchObject({ ipv4: true, src: '192.168.0.1', dst: '192.168.0.199', protoNumber: 17, ttl: 64, df: true, mf: false, totalLength: 115 });
    expect(find(tree, 'Header Checksum')?.value).toBe('0xb861 [correct]');
    expect(find(tree, 'Protocol')?.value).toBe('UDP (17)');
    expect(internetChecksum(header)).toBe(0);
  });

  it('marks a wrong header checksum and a transport cut by the snaplen', () => {
    const broken = header.slice();
    broken[11] = 0x62;
    const { summary, tree } = dissect(broken, meta(broken, { len: 0x73 }));
    const checksum = find(tree, 'Header Checksum')!;
    expect(checksum.value).toBe('0xb862 [incorrect]');
    expect(checksum.warn).toBe(true);
    // Only the IP header was captured: UDP is cut.
    expect(summary.info).toBe(TRUNCATED);
    expect(flatten(tree).some((f) => f.truncated)).toBe(true);
  });

  it('shows fragments like Wireshark', () => {
    const first = ipv4({ src: '10.20.1.1', dst: '10.20.3.4', protocol: 17, payload: new Uint8Array(1480), id: 0x1a2b, mf: true });
    const second = ipv4({ src: '10.20.1.1', dst: '10.20.3.4', protocol: 17, payload: new Uint8Array(520), id: 0x1a2b, fragmentOffset: 1480 });
    expect(dissect(first, meta(first)).summary.info).toContain('[fragment of a larger datagram]');
    const later = dissect(second, meta(second));
    expect(later.summary.protocol).toBe('IPv4');
    expect(later.summary.info).toBe('Fragmented IP protocol (proto=UDP 17, off=1480, ID=1a2b)');
    expect(later.summary.udp).toBeNull();
  });

  it('does not take IPv6 or garbage for IPv4', () => {
    const v6 = new Uint8Array(40);
    v6[0] = 0x60;
    expect(dissect(v6, meta(v6)).summary).toMatchObject({ ipv4: false, protocol: 'IPv6' });
    expect(dissect(new Uint8Array(0), meta(new Uint8Array(0))).summary.ipv4).toBe(false);
    const shortHeader = hexBytes('42 00 00 14');
    expect(dissect(shortHeader, meta(shortHeader)).summary.ipv4).toBe(false);
  });
});

describe('TCP', () => {
  const syn = tcp({ src: '10.20.1.1', dst: '10.20.3.4', srcPort: 41000, dstPort: 80, seq: 1_000_000, flags: TCP.SYN, options: synOptions(752, 3_000_001) });
  const synAck = tcp({ src: '10.20.3.4', dst: '10.20.1.1', srcPort: 80, dstPort: 41000, seq: 777, ack: 1_000_001, flags: TCP.SYN | TCP.ACK, window: 65160, options: synOptions(752, 9_000_000, 3_000_001) });
  const data = tcp({ src: '10.20.1.1', dst: '10.20.3.4', srcPort: 41000, dstPort: 80, seq: 1_000_001, ack: 778, flags: TCP.PSH | TCP.ACK, window: 502, payload: new TextEncoder().encode('GET / HTTP/1.1\r\n\r\n') });

  it('reads a SYN with its options, numbered from the stream start', () => {
    const streams = new TcpStreams();
    const first = dissect(syn, meta(syn));
    const relative = streams.relative(first.summary);
    const { summary, tree } = dissect(syn, meta(syn), relative);
    expect(summary.protocol).toBe('TCP');
    expect(summary.info).toBe('41000 → 80 [SYN] Seq=0 Win=64240 Len=0 MSS=752 SACK_PERM TSval=3000001 TSecr=0 WS=128');
    expect(find(tree, 'TCP Option - Maximum segment size')?.value).toBe('752 bytes');
    expect(find(tree, 'TCP Option - Window scale')?.value).toBe('7 (multiply by 128)');
    expect(find(tree, 'Checksum')?.value).toMatch(/\[correct\]$/);
    expect(find(tree, 'Sequence Number')?.value).toBe('0    (relative sequence number)');

    const answer = dissect(synAck, meta(synAck));
    expect(dissect(synAck, meta(synAck), streams.relative(answer.summary)).summary.info).toMatch(/^80 → 41000 \[SYN, ACK\] Seq=0 Ack=1 Win=65160 Len=0 MSS=752/);
    const request = dissect(data, meta(data));
    expect(dissect(data, meta(data), streams.relative(request.summary)).summary.info).toBe('41000 → 80 [PSH, ACK] Seq=1 Ack=1 Win=502 Len=18');
  });

  it('finds a corrupted segment by its checksum', () => {
    const corrupt = data.slice();
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 0xff;
    const checksum = find(dissect(corrupt, meta(corrupt)).tree, 'Checksum')!;
    expect(checksum.value).toMatch(/\[incorrect\]$/);
    expect(checksum.warn).toBe(true);
  });

  it('dissects what was captured of a cut segment and says the rest is missing', () => {
    const cut = syn.slice(0, 30);
    const { summary, tree } = dissect(cut, meta(syn, { len: syn.length }));
    expect(summary.info).toBe(`41000 → 80 ${TRUNCATED}`);
    expect(find(tree, 'Source Port')?.value).toBe('41000');
    expect(flatten(tree).some((f) => f.truncated)).toBe(true);
    // Options cut midway: they are listed as far as they go, the checksum is not verified.
    const partial = dissect(syn.slice(0, 46), meta(syn, { len: syn.length }));
    expect(find(partial.tree, 'Checksum')?.value).toMatch(/\[unverified\]$/);
    expect(find(partial.tree, 'Options')?.truncated).toBe(true);
  });
});

describe('UDP and DNS', () => {
  const query = udp({ src: '10.20.1.1', dst: '10.20.3.4', srcPort: 41001, dstPort: 53, payload: dns({ id: 0x1a2b, name: 'example.com' }) });
  const response = udp({
    src: '10.20.3.4',
    dst: '10.20.1.1',
    srcPort: 53,
    dstPort: 41001,
    payload: dns({ id: 0x1a2b, name: 'tile.openstreetmap.org', answers: [{ type: 'CNAME', value: 'dualstack.k.sni.global.fastly.net' }, { type: 'A', value: '151.101.2.217', ttl: 60 }] }),
  });

  it('names the query and the answers', () => {
    const asked = dissect(query, meta(query));
    expect(asked.summary).toMatchObject({ protocol: 'DNS', dns: { id: 0x1a2b, response: false, names: ['example.com'] } });
    expect(asked.summary.info).toBe('Standard query 0x1a2b A example.com');
    const answered = dissect(response, meta(response));
    expect(answered.summary.info).toBe('Standard query response 0x1a2b A tile.openstreetmap.org CNAME dualstack.k.sni.global.fastly.net A 151.101.2.217');
    expect(find(answered.tree, 'Address')?.value).toBe('151.101.2.217');
    expect(find(answered.tree, 'Checksum')?.value).toMatch(/\[correct\]$/);
  });

  it('reads plain UDP and a zero checksum', () => {
    const plain = udp({ src: '10.20.1.1', dst: '10.20.255.255', srcPort: 5400, dstPort: 5400, payload: new Uint8Array(32), noChecksum: true });
    const { summary, tree } = dissect(plain, meta(plain));
    expect(summary).toMatchObject({ protocol: 'UDP', info: '5400 → 5400 Len=32' });
    expect(find(tree, 'Checksum')?.value).toBe('0x0000 [zero-value ignored]');
  });

  it('stops a DNS message cut by the snaplen without guessing', () => {
    // 80 bytes: the question is whole, the answers are cut.
    const cut = response.slice(0, 80);
    const { summary, tree } = dissect(cut, meta(response, { len: response.length }));
    expect(summary.protocol).toBe('DNS');
    expect(summary.dns?.names).toEqual(['tile.openstreetmap.org']);
    expect(flatten(tree).some((f) => f.label === TRUNCATED)).toBe(true);
  });
});

describe('ICMP', () => {
  it('reads an echo request and reply', () => {
    const request = icmpEcho({ src: '10.20.1.1', dst: '10.20.3.4', request: true, id: 0x4b1d, seq: 3 });
    const { summary, tree } = dissect(request, meta(request));
    expect(summary.info).toBe('Echo (ping) request  id=0x4b1d, seq=3/768, ttl=64');
    expect(summary.icmp).toEqual({ type: 8, code: 0, id: 0x4b1d, seq: 3 });
    expect(find(tree, 'Checksum')?.value).toMatch(/\[correct\]$/);
    const reply = icmpEcho({ src: '10.20.3.4', dst: '10.20.1.1', request: false, id: 0x4b1d, seq: 3, ttl: 63 });
    expect(dissect(reply, meta(reply)).summary.info).toBe('Echo (ping) reply  id=0x4b1d, seq=3/768, ttl=63');
  });
});

describe('fields and bytes', () => {
  it('finds the field a byte belongs to', () => {
    const packet = icmpEcho({ src: '10.20.1.1', dst: '10.20.3.4', request: true, id: 1, seq: 1 });
    const { tree } = dissect(packet, meta(packet));
    expect(fieldAt(tree, 13)?.label).toBe('Source Address');
    expect(fieldAt(tree, 9)?.label).toBe('Protocol');
    expect(fieldAt(tree, 20)?.label).toBe('Type');
    expect(fieldAt(tree, 10_000)).toBeNull();
  });

  it('describes the frame', () => {
    const packet = icmpEcho({ src: '10.20.1.1', dst: '10.20.3.4', request: true, id: 1, seq: 1 });
    const { tree } = dissect(packet.slice(0, 64), meta(packet, { seq: 42, verdict: 'dropped', reason: 'no_route' }));
    expect(tree[0]!.label).toBe('Frame 42');
    expect(tree[0]!.value).toBe(`${packet.length} bytes on wire, 64 bytes captured`);
    expect(find(tree, 'Verdict')).toMatchObject({ value: 'dropped (no_route)', warn: true });
    expect(find(tree, '[Protocols in frame')?.value).toBe('raw:ip:icmp]');
  });
});
