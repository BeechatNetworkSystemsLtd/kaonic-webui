/*
 * Builds real IPv4 packets (TCP, UDP, ICMP, DNS) with correct checksums, for the
 * mock's VPN capture and for the dissector tests.
 */

function checksum(...parts: Uint8Array[]): number {
  let sum = 0;
  for (const part of parts) {
    for (let i = 0; i + 1 < part.length; i += 2) sum += (part[i]! << 8) | part[i + 1]!;
    if (part.length % 2) sum += part[part.length - 1]! << 8;
  }
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

const put16 = (out: Uint8Array, at: number, value: number) => {
  out[at] = (value >> 8) & 0xff;
  out[at + 1] = value & 0xff;
};
const put32 = (out: Uint8Array, at: number, value: number) => {
  put16(out, at, (value >>> 16) & 0xffff);
  put16(out, at + 2, value & 0xffff);
};
export const addr = (text: string) => Uint8Array.from(text.split('.').map(Number));

export interface Ipv4Options {
  src: string;
  dst: string;
  protocol: number;
  payload: Uint8Array;
  ttl?: number;
  id?: number;
  df?: boolean;
  mf?: boolean;
  /** Bytes, a multiple of 8. */
  fragmentOffset?: number;
  /** Override the total length (a fragment's or a broken one). */
  totalLength?: number;
}

export function ipv4(options: Ipv4Options): Uint8Array {
  const out = new Uint8Array(20 + options.payload.length);
  out[0] = 0x45;
  put16(out, 2, options.totalLength ?? out.length);
  put16(out, 4, options.id ?? 0);
  put16(out, 6, ((options.df ? 0x4000 : 0) | (options.mf ? 0x2000 : 0) | ((options.fragmentOffset ?? 0) / 8)) & 0xffff);
  out[8] = options.ttl ?? 64;
  out[9] = options.protocol;
  out.set(addr(options.src), 12);
  out.set(addr(options.dst), 16);
  put16(out, 10, checksum(out.subarray(0, 20)));
  out.set(options.payload, 20);
  return out;
}

function pseudo(src: string, dst: string, protocol: number, length: number): Uint8Array {
  const header = new Uint8Array(12);
  header.set(addr(src), 0);
  header.set(addr(dst), 4);
  header[9] = protocol;
  put16(header, 10, length);
  return header;
}

export const TCP = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10, URG: 0x20 } as const;

export interface TcpOptions {
  src: string;
  dst: string;
  srcPort: number;
  dstPort: number;
  seq: number;
  ack?: number;
  flags: number;
  window?: number;
  /** Raw option bytes; padded to a multiple of 4 with end-of-list bytes. */
  options?: number[];
  payload?: Uint8Array;
  ttl?: number;
  id?: number;
}

/** A TCP segment in an IPv4 packet. */
export function tcp(o: TcpOptions): Uint8Array {
  const options = [...(o.options ?? [])];
  while (options.length % 4) options.push(0);
  const payload = o.payload ?? new Uint8Array(0);
  const segment = new Uint8Array(20 + options.length + payload.length);
  put16(segment, 0, o.srcPort);
  put16(segment, 2, o.dstPort);
  put32(segment, 4, o.seq >>> 0);
  put32(segment, 8, (o.ack ?? 0) >>> 0);
  segment[12] = ((20 + options.length) / 4) << 4;
  segment[13] = o.flags;
  put16(segment, 14, o.window ?? 64240);
  segment.set(options, 20);
  segment.set(payload, 20 + options.length);
  put16(segment, 16, checksum(pseudo(o.src, o.dst, 6, segment.length), segment));
  return ipv4({ src: o.src, dst: o.dst, protocol: 6, payload: segment, ttl: o.ttl, id: o.id, df: true });
}

/** MSS, SACK permitted, timestamps, NOP, window scale: what Linux puts on a SYN. */
export function synOptions(mss: number, tsval: number, tsecr = 0, wscale = 7): number[] {
  return [2, 4, mss >> 8, mss & 0xff, 4, 2, 8, 10, (tsval >>> 24) & 0xff, (tsval >>> 16) & 0xff, (tsval >>> 8) & 0xff, tsval & 0xff, (tsecr >>> 24) & 0xff, (tsecr >>> 16) & 0xff, (tsecr >>> 8) & 0xff, tsecr & 0xff, 1, 3, 3, wscale];
}

export interface UdpOptions {
  src: string;
  dst: string;
  srcPort: number;
  dstPort: number;
  payload: Uint8Array;
  ttl?: number;
  id?: number;
  /** Leave the checksum at zero (allowed for UDP over IPv4). */
  noChecksum?: boolean;
}

export function udp(o: UdpOptions): Uint8Array {
  const datagram = new Uint8Array(8 + o.payload.length);
  put16(datagram, 0, o.srcPort);
  put16(datagram, 2, o.dstPort);
  put16(datagram, 4, datagram.length);
  datagram.set(o.payload, 8);
  if (!o.noChecksum) put16(datagram, 6, checksum(pseudo(o.src, o.dst, 17, datagram.length), datagram) || 0xffff);
  return ipv4({ src: o.src, dst: o.dst, protocol: 17, payload: datagram, ttl: o.ttl, id: o.id });
}

export function icmpEcho(o: { src: string; dst: string; request: boolean; id: number; seq: number; data?: Uint8Array; ttl?: number }): Uint8Array {
  const data = o.data ?? Uint8Array.from({ length: 56 }, (_, i) => (i + 0x10) & 0xff);
  const message = new Uint8Array(8 + data.length);
  message[0] = o.request ? 8 : 0;
  put16(message, 4, o.id);
  put16(message, 6, o.seq);
  message.set(data, 8);
  put16(message, 2, checksum(message));
  return ipv4({ src: o.src, dst: o.dst, protocol: 1, payload: message, ttl: o.ttl, id: o.seq });
}

/* ── DNS ── */

function encodeName(name: string): number[] {
  const out: number[] = [];
  for (const label of name.split('.')) {
    out.push(label.length, ...Array.from(label, (c) => c.charCodeAt(0)));
  }
  out.push(0);
  return out;
}

export interface DnsAnswer {
  type: 'A' | 'CNAME';
  value: string;
  ttl?: number;
}

/** A DNS message: a query for `name` (type A), or the response with `answers`. */
export function dns(o: { id: number; name: string; answers?: DnsAnswer[]; rcode?: number }): Uint8Array {
  const response = o.answers !== undefined;
  const bytes: number[] = [];
  bytes.push(o.id >> 8, o.id & 0xff);
  const flags = response ? 0x8180 | (o.rcode ?? 0) : 0x0100;
  bytes.push(flags >> 8, flags & 0xff);
  bytes.push(0, 1, 0, response ? o.answers!.length : 0, 0, 0, 0, 0);
  bytes.push(...encodeName(o.name), 0, 1, 0, 1);
  for (const answer of o.answers ?? []) {
    bytes.push(0xc0, 12); // the question's name, compressed
    const ttl = answer.ttl ?? 300;
    if (answer.type === 'A') {
      bytes.push(0, 1, 0, 1, (ttl >>> 24) & 0xff, (ttl >>> 16) & 0xff, (ttl >>> 8) & 0xff, ttl & 0xff, 0, 4, ...answer.value.split('.').map(Number));
    } else {
      const target = encodeName(answer.value);
      bytes.push(0, 5, 0, 1, (ttl >>> 24) & 0xff, (ttl >>> 16) & 0xff, (ttl >>> 8) & 0xff, ttl & 0xff, target.length >> 8, target.length & 0xff, ...target);
    }
  }
  return Uint8Array.from(bytes);
}
