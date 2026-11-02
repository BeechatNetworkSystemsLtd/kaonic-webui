/*
 * Packet dissectors for the VPN capture: what Wireshark shows for an IPv4 packet
 * and the TCP, UDP, ICMP and DNS in it. Pure functions over the captured bytes.
 *
 * Every field carries the byte range it was read from (`start`..`end`,
 * exclusive), so the bytes pane can highlight it. A capture is cut to its
 * snaplen: a field that runs past the captured bytes is marked `truncated`, and
 * the dissection stops there, as Wireshark does with "[Packet size limited
 * during capture]".
 */

export interface Field {
  label: string;
  /** Shown after the label, `label: value`. Absent for headings. */
  value?: string;
  start: number;
  end: number;
  children?: Field[];
  /** The field's bytes are not all in the capture. */
  truncated?: boolean;
  /** Something wrong with it: a bad checksum, an impossible length. */
  warn?: boolean;
}

export interface TcpSummary {
  srcPort: number;
  dstPort: number;
  seq: number;
  ack: number;
  flags: number;
  window: number;
  /** Bytes of payload, from the IP total length (known even when not captured). */
  payloadLen: number;
}

export interface UdpSummary {
  srcPort: number;
  dstPort: number;
  length: number;
}

export interface IcmpSummary {
  type: number;
  code: number;
  id: number | null;
  seq: number | null;
}

export interface DnsSummary {
  id: number;
  response: boolean;
  /** Names asked for. */
  names: string[];
}

/** What the list, the filter and the info column need, without the tree. */
export interface Summary {
  /** Not an IPv4 packet: the rest is empty. */
  ipv4: boolean;
  src: string;
  dst: string;
  protoNumber: number | null;
  ttl: number | null;
  ipId: number | null;
  totalLength: number | null;
  df: boolean;
  mf: boolean;
  fragmentOffset: number;
  /** The protocol column: DNS, TCP, UDP, ICMP, IGMP, IPv4. */
  protocol: string;
  info: string;
  tcp: TcpSummary | null;
  udp: UdpSummary | null;
  icmp: IcmpSummary | null;
  dns: DnsSummary | null;
}

export interface FrameMeta {
  seq: number;
  /** Unix microseconds. */
  tsUs: number;
  /** Original length on the wire. */
  len: number;
  direction: 'rx' | 'tx';
  node: string;
  verdict: string;
  reason: string | null;
}

/** Stream-relative TCP numbers, like Wireshark's "(relative sequence number)". */
export interface Relative {
  seq: number;
  ack: number | null;
}

export interface Dissection {
  summary: Summary;
  tree: Field[];
}

export const TRUNCATED = '[Packet size limited during capture]';

export const IP_PROTOCOLS: Record<number, string> = { 1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 41: 'IPv6', 47: 'GRE', 50: 'ESP', 89: 'OSPF', 132: 'SCTP' };

const TCP_FLAGS: Array<[bit: number, name: string]> = [
  [0x100, 'AE'],
  [0x80, 'CWR'],
  [0x40, 'ECE'],
  [0x20, 'URG'],
  [0x10, 'ACK'],
  [0x08, 'PSH'],
  [0x04, 'RST'],
  [0x02, 'SYN'],
  [0x01, 'FIN'],
];

export const ICMP_TYPES: Record<number, string> = {
  0: 'Echo (ping) reply',
  3: 'Destination unreachable',
  4: 'Source quench',
  5: 'Redirect',
  8: 'Echo (ping) request',
  9: 'Router advertisement',
  10: 'Router solicitation',
  11: 'Time-to-live exceeded',
  12: 'Parameter problem',
  13: 'Timestamp request',
  14: 'Timestamp reply',
};

const UNREACHABLE: Record<number, string> = {
  0: 'Network unreachable',
  1: 'Host unreachable',
  2: 'Protocol unreachable',
  3: 'Port unreachable',
  4: 'Fragmentation needed',
  5: 'Source route failed',
  6: 'Destination network unknown',
  7: 'Destination host unknown',
  9: 'Network administratively prohibited',
  10: 'Host administratively prohibited',
  13: 'Communication administratively filtered',
};

const DNS_TYPES: Record<number, string> = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 41: 'OPT', 65: 'HTTPS', 255: 'ANY' };
const DNS_CLASSES: Record<number, string> = { 1: 'IN', 3: 'CH', 4: 'HS', 255: 'ANY' };
const DNS_RCODES: Record<number, string> = { 0: 'No error', 1: 'Format error', 2: 'Server failure', 3: 'No such name', 4: 'Not implemented', 5: 'Refused' };

/* ── byte helpers ── */

const hex = (value: number, digits: number) => `0x${value.toString(16).padStart(digits, '0')}`;
const u16 = (data: Uint8Array, at: number) => (data[at]! << 8) | data[at + 1]!;
const u32 = (data: Uint8Array, at: number) => ((data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!) >>> 0;
const ip4 = (data: Uint8Array, at: number) => `${data[at]}.${data[at + 1]}.${data[at + 2]}.${data[at + 3]}`;
const has = (data: Uint8Array, start: number, length: number) => start + length <= data.length;

/** Internet checksum (RFC 1071) over `parts`, each read as 16-bit words. */
export function internetChecksum(...parts: Uint8Array[]): number {
  let sum = 0;
  for (const part of parts) {
    for (let i = 0; i + 1 < part.length; i += 2) sum += (part[i]! << 8) | part[i + 1]!;
    if (part.length % 2) sum += part[part.length - 1]! << 8;
  }
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}

/** A field read from `length` bytes at `start`: truncated when they are not all captured. */
function field(data: Uint8Array, label: string, start: number, length: number, value: (() => string) | string): Field {
  if (!has(data, start, length)) return { label, value: TRUNCATED, start, end: Math.min(start + length, data.length), truncated: true };
  return { label, value: typeof value === 'function' ? value() : value, start, end: start + length };
}

/** A bit within a flags byte, written like Wireshark: `.1.. .... = Don't fragment: Set`. */
function bitLine(byte: number, mask: number, bits: number, name: string, set = 'Set', clear = 'Not set'): string {
  let line = '';
  for (let i = bits - 1; i >= 0; i -= 1) {
    const bit = 1 << i;
    line += mask & bit ? (byte & bit ? '1' : '0') : '.';
    if (i % 4 === 0 && i > 0) line += ' ';
  }
  return `${line} = ${name}: ${byte & mask ? set : clear}`;
}

/* ── IPv4 ── */

interface Ipv4 {
  headerLength: number;
  totalLength: number;
  protocol: number;
  src: string;
  dst: string;
  srcBytes: Uint8Array;
  dstBytes: Uint8Array;
  mf: boolean;
  df: boolean;
  fragmentOffset: number;
  ttl: number;
  id: number;
}

function dissectIpv4(data: Uint8Array): { field: Field; ip: Ipv4 | null } {
  const heading: Field = { label: 'Internet Protocol Version 4', start: 0, end: 0, children: [] };
  const children = heading.children!;
  if (data.length < 1) return { field: { ...heading, value: TRUNCATED, truncated: true }, ip: null };
  const version = data[0]! >> 4;
  const headerLength = (data[0]! & 0x0f) * 4;
  children.push({ label: `${(version << 4).toString(2).padStart(8, '0').slice(0, 4)} .... = Version`, value: String(version), start: 0, end: 1 });
  children.push({ label: `.... ${(data[0]! & 0x0f).toString(2).padStart(4, '0')} = Header Length`, value: `${headerLength} bytes (${data[0]! & 0x0f})`, start: 0, end: 1, warn: headerLength < 20 });
  if (version !== 4 || headerLength < 20) {
    heading.end = Math.min(data.length, Math.max(1, headerLength));
    heading.warn = true;
    heading.value = version !== 4 ? `not IPv4 (version ${version})` : `bad header length ${headerLength}`;
    return { field: heading, ip: null };
  }
  heading.end = Math.min(headerLength, data.length);
  if (!has(data, 0, 20)) {
    children.push({ label: TRUNCATED, start: 1, end: data.length, truncated: true });
    heading.truncated = true;
    return { field: heading, ip: null };
  }
  const tos = data[1]!;
  const dscp = tos >> 2;
  const ecn = tos & 3;
  children.push({
    label: 'Differentiated Services Field',
    value: `${hex(tos, 2)} (DSCP: ${dscp === 0 ? 'CS0' : dscp}, ECN: ${['Not-ECT', 'ECT(1)', 'ECT(0)', 'CE'][ecn]})`,
    start: 1,
    end: 2,
  });
  const totalLength = u16(data, 2);
  children.push({ label: 'Total Length', value: String(totalLength), start: 2, end: 4, warn: totalLength < headerLength });
  const id = u16(data, 4);
  children.push({ label: 'Identification', value: `${hex(id, 4)} (${id})`, start: 4, end: 6 });
  const flagsByte = data[6]!;
  const df = (flagsByte & 0x40) !== 0;
  const mf = (flagsByte & 0x20) !== 0;
  const flagNames = [flagsByte & 0x80 ? 'Reserved' : '', df ? "Don't fragment" : '', mf ? 'More fragments' : ''].filter(Boolean);
  children.push({
    label: `${(flagsByte >> 5).toString(2).padStart(3, '0')}. .... = Flags`,
    value: `${hex(flagsByte >> 5 << 5, 2)}${flagNames.length ? `, ${flagNames.join(', ')}` : ''}`,
    start: 6,
    end: 7,
    children: [
      { label: bitLine(flagsByte, 0x80, 8, 'Reserved bit'), start: 6, end: 7, warn: (flagsByte & 0x80) !== 0 },
      { label: bitLine(flagsByte, 0x40, 8, "Don't fragment"), start: 6, end: 7 },
      { label: bitLine(flagsByte, 0x20, 8, 'More fragments'), start: 6, end: 7 },
    ],
  });
  const fragmentOffset = (u16(data, 6) & 0x1fff) * 8;
  children.push({ label: 'Fragment Offset', value: String(fragmentOffset), start: 6, end: 8 });
  const ttl = data[8]!;
  children.push({ label: 'Time to Live', value: String(ttl), start: 8, end: 9 });
  const protocol = data[9]!;
  children.push({ label: 'Protocol', value: `${IP_PROTOCOLS[protocol] ?? 'Unknown'} (${protocol})`, start: 9, end: 10 });
  const checksum = u16(data, 10);
  if (has(data, 0, headerLength)) {
    const computed = internetChecksum(data.subarray(0, headerLength));
    const good = computed === 0;
    children.push({ label: 'Header Checksum', value: `${hex(checksum, 4)} [${good ? 'correct' : 'incorrect'}]`, start: 10, end: 12, warn: !good });
  } else {
    children.push({ label: 'Header Checksum', value: `${hex(checksum, 4)} [unverified]`, start: 10, end: 12 });
  }
  const src = ip4(data, 12);
  const dst = ip4(data, 16);
  children.push({ label: 'Source Address', value: src, start: 12, end: 16 });
  children.push({ label: 'Destination Address', value: dst, start: 16, end: 20 });
  if (headerLength > 20) {
    children.push(field(data, 'Options', 20, headerLength - 20, () => `(${headerLength - 20} bytes)`));
  }
  heading.value = `Src: ${src}, Dst: ${dst}`;
  return {
    field: heading,
    ip: { headerLength, totalLength, protocol, src, dst, srcBytes: data.slice(12, 16), dstBytes: data.slice(16, 20), mf, df, fragmentOffset, ttl, id },
  };
}

/** The TCP/UDP pseudo-header for checksums. */
function pseudoHeader(ip: Ipv4, length: number): Uint8Array {
  const header = new Uint8Array(12);
  header.set(ip.srcBytes, 0);
  header.set(ip.dstBytes, 4);
  header[9] = ip.protocol;
  header[10] = length >> 8;
  header[11] = length & 0xff;
  return header;
}

function checksumField(data: Uint8Array, at: number, verify: (() => boolean) | null, optional = false): Field {
  const result = field(data, 'Checksum', at, 2, '');
  if (result.truncated) return result;
  const value = u16(data, at);
  if (optional && value === 0) return { ...result, value: `${hex(value, 4)} [zero-value ignored]` };
  if (verify === null) return { ...result, value: `${hex(value, 4)} [unverified]` };
  const good = verify();
  return { ...result, value: `${hex(value, 4)} [${good ? 'correct' : 'incorrect'}]`, warn: !good };
}

/* ── TCP ── */

/** Set flags in Wireshark's info-column order: FIN, SYN, RST, PSH, ACK, URG, ECE, CWR, AE. */
export function tcpFlagNames(flags: number): string[] {
  return TCP_FLAGS.filter(([bit]) => flags & bit)
    .map(([, name]) => name)
    .reverse();
}

interface TcpOptionSummary {
  mss?: number;
  ws?: number;
  sackPerm?: boolean;
  tsval?: number;
  tsecr?: number;
  sack?: Array<[number, number]>;
}

function tcpOptions(data: Uint8Array, start: number, end: number): { fields: Field[]; summary: TcpOptionSummary } {
  const fields: Field[] = [];
  const summary: TcpOptionSummary = {};
  let at = start;
  while (at < end) {
    if (at >= data.length) {
      fields.push({ label: TRUNCATED, start: at, end: data.length, truncated: true });
      break;
    }
    const kind = data[at]!;
    if (kind === 0) {
      fields.push({ label: 'TCP Option - End of Option List (EOL)', start: at, end: at + 1 });
      break;
    }
    if (kind === 1) {
      fields.push({ label: 'TCP Option - No-Operation (NOP)', start: at, end: at + 1 });
      at += 1;
      continue;
    }
    if (!has(data, at, 2)) {
      fields.push({ label: TRUNCATED, start: at, end: data.length, truncated: true });
      break;
    }
    const length = data[at + 1]!;
    if (length < 2 || at + length > end) {
      fields.push({ label: `TCP Option - kind ${kind}`, value: `bad length ${length}`, start: at, end: Math.min(end, data.length), warn: true });
      break;
    }
    if (!has(data, at, length)) {
      fields.push({ label: `TCP Option - kind ${kind}`, value: TRUNCATED, start: at, end: data.length, truncated: true });
      break;
    }
    const opt = { start: at, end: at + length };
    if (kind === 2 && length === 4) {
      summary.mss = u16(data, at + 2);
      fields.push({ label: 'TCP Option - Maximum segment size', value: `${summary.mss} bytes`, ...opt });
    } else if (kind === 3 && length === 3) {
      summary.ws = data[at + 2]!;
      fields.push({ label: 'TCP Option - Window scale', value: `${summary.ws} (multiply by ${2 ** summary.ws})`, ...opt });
    } else if (kind === 4 && length === 2) {
      summary.sackPerm = true;
      fields.push({ label: 'TCP Option - SACK permitted', ...opt });
    } else if (kind === 5 && (length - 2) % 8 === 0) {
      const blocks: Array<[number, number]> = [];
      for (let b = at + 2; b < at + length; b += 8) blocks.push([u32(data, b), u32(data, b + 4)]);
      summary.sack = blocks;
      fields.push({ label: 'TCP Option - SACK', value: blocks.map(([l, r]) => `${l}-${r}`).join(' '), ...opt });
    } else if (kind === 8 && length === 10) {
      summary.tsval = u32(data, at + 2);
      summary.tsecr = u32(data, at + 6);
      fields.push({ label: 'TCP Option - Timestamps', value: `TSval ${summary.tsval}, TSecr ${summary.tsecr}`, ...opt });
    } else {
      fields.push({ label: `TCP Option - kind ${kind}`, value: `${length} bytes`, ...opt });
    }
    at += length;
  }
  return { fields, summary };
}

function dissectTcp(data: Uint8Array, base: number, ip: Ipv4, relative: Relative | null): { field: Field; tcp: TcpSummary | null; info: string } {
  const heading: Field = { label: 'Transmission Control Protocol', start: base, end: base, children: [] };
  const children = heading.children!;
  const segmentLength = Math.max(0, ip.totalLength - ip.headerLength);
  if (!has(data, base, 20)) {
    const ports = has(data, base, 4) ? `${u16(data, base)} → ${u16(data, base + 2)}` : '';
    if (ports) {
      children.push({ label: 'Source Port', value: String(u16(data, base)), start: base, end: base + 2 });
      children.push({ label: 'Destination Port', value: String(u16(data, base + 2)), start: base + 2, end: base + 4 });
    }
    children.push({ label: TRUNCATED, start: Math.min(base + (ports ? 4 : 0), data.length), end: data.length, truncated: true });
    heading.end = data.length;
    heading.truncated = true;
    return { field: heading, tcp: null, info: ports ? `${ports} ${TRUNCATED}` : TRUNCATED };
  }
  const srcPort = u16(data, base);
  const dstPort = u16(data, base + 2);
  const seq = u32(data, base + 4);
  const ack = u32(data, base + 8);
  const dataOffset = (data[base + 12]! >> 4) * 4;
  const flags = ((data[base + 12]! & 0x01) << 8) | data[base + 13]!;
  const window = u16(data, base + 14);
  const payloadLen = Math.max(0, segmentLength - dataOffset);
  const ackSet = (flags & 0x10) !== 0;
  children.push({ label: 'Source Port', value: String(srcPort), start: base, end: base + 2 });
  children.push({ label: 'Destination Port', value: String(dstPort), start: base + 2, end: base + 4 });
  children.push({ label: '[TCP Segment Len', value: `${payloadLen}]`, start: base, end: base });
  children.push({
    label: 'Sequence Number',
    value: relative ? `${relative.seq}    (relative sequence number)` : String(seq),
    start: base + 4,
    end: base + 8,
  });
  children.push({ label: 'Sequence Number (raw)', value: String(seq), start: base + 4, end: base + 8 });
  children.push({
    label: 'Acknowledgment Number',
    value: ackSet ? (relative && relative.ack !== null ? `${relative.ack}    (relative ack number)` : String(ack)) : '0',
    start: base + 8,
    end: base + 12,
  });
  children.push({ label: 'Acknowledgment number (raw)', value: String(ack), start: base + 8, end: base + 12 });
  children.push({
    label: `${(dataOffset / 4).toString(2).padStart(4, '0')} .... = Header Length`,
    value: `${dataOffset} bytes (${dataOffset / 4})`,
    start: base + 12,
    end: base + 13,
    warn: dataOffset < 20,
  });
  const names = tcpFlagNames(flags);
  children.push({
    label: 'Flags',
    value: `${hex(flags, 3)} (${names.join(', ') || 'none'})`,
    start: base + 12,
    end: base + 14,
    children: [
      { label: bitLine(flags >> 8, 0x01, 4, 'Accurate ECN'), start: base + 12, end: base + 13 },
      ...TCP_FLAGS.slice(1).map(([bit, name]) => ({
        label: bitLine(flags & 0xff, bit, 8, {
          CWR: 'Congestion Window Reduced',
          ECE: 'ECN-Echo',
          URG: 'Urgent',
          ACK: 'Acknowledgment',
          PSH: 'Push',
          RST: 'Reset',
          SYN: 'Syn',
          FIN: 'Fin',
        }[name]!),
        start: base + 13,
        end: base + 14,
      })),
    ],
  });
  children.push({ label: 'Window', value: String(window), start: base + 14, end: base + 16 });
  const segmentCaptured = has(data, base, segmentLength) && segmentLength >= dataOffset;
  children.push(
    checksumField(data, base + 16, segmentCaptured ? () => internetChecksum(pseudoHeader(ip, segmentLength), data.subarray(base, base + segmentLength)) === 0 : null),
  );
  children.push({ label: 'Urgent Pointer', value: String(u16(data, base + 18)), start: base + 18, end: base + 20 });
  let options: TcpOptionSummary = {};
  if (dataOffset > 20) {
    const parsed = tcpOptions(data, base + 20, base + dataOffset);
    options = parsed.summary;
    children.push({
      label: 'Options',
      value: `(${dataOffset - 20} bytes)${parsed.fields.some((f) => f.truncated) ? ` ${TRUNCATED}` : ''}`,
      start: base + 20,
      end: Math.min(base + dataOffset, data.length),
      truncated: parsed.fields.some((f) => f.truncated),
      children: parsed.fields,
    });
  }
  if (payloadLen > 0) {
    const start = base + dataOffset;
    const captured = Math.max(0, Math.min(payloadLen, data.length - start));
    children.push({
      label: 'TCP payload',
      value: `(${payloadLen} bytes)${captured < payloadLen ? ` ${TRUNCATED}` : ''}`,
      start: Math.min(start, data.length),
      end: Math.min(start + payloadLen, data.length),
      truncated: captured < payloadLen,
    });
  }
  heading.end = Math.min(base + Math.max(dataOffset, 20), data.length);
  heading.value = `Src Port: ${srcPort}, Dst Port: ${dstPort}, Seq: ${relative ? relative.seq : seq}${ackSet ? `, Ack: ${relative && relative.ack !== null ? relative.ack : ack}` : ''}, Len: ${payloadLen}`;

  const shownSeq = relative ? relative.seq : seq;
  const infoParts = [`${srcPort} → ${dstPort} [${names.join(', ')}]`, `Seq=${shownSeq}`];
  if (ackSet) infoParts.push(`Ack=${relative && relative.ack !== null ? relative.ack : ack}`);
  infoParts.push(`Win=${window}`, `Len=${payloadLen}`);
  if (options.mss !== undefined) infoParts.push(`MSS=${options.mss}`);
  if (options.sackPerm) infoParts.push('SACK_PERM');
  if (options.tsval !== undefined) infoParts.push(`TSval=${options.tsval}`, `TSecr=${options.tsecr}`);
  if (options.ws !== undefined) infoParts.push(`WS=${2 ** options.ws}`);
  if (options.sack?.length) infoParts.push(...options.sack.map(([l, r]) => `SLE=${l} SRE=${r}`));
  return { field: heading, tcp: { srcPort, dstPort, seq, ack, flags, window, payloadLen }, info: infoParts.join(' ') };
}

/* ── UDP ── */

function dissectUdp(data: Uint8Array, base: number, ip: Ipv4): { field: Field; udp: UdpSummary | null; info: string } {
  const heading: Field = { label: 'User Datagram Protocol', start: base, end: Math.min(base + 8, data.length), children: [] };
  const children = heading.children!;
  if (!has(data, base, 8)) {
    children.push({ label: TRUNCATED, start: base, end: data.length, truncated: true });
    heading.truncated = true;
    return { field: heading, udp: null, info: TRUNCATED };
  }
  const srcPort = u16(data, base);
  const dstPort = u16(data, base + 2);
  const length = u16(data, base + 4);
  children.push({ label: 'Source Port', value: String(srcPort), start: base, end: base + 2 });
  children.push({ label: 'Destination Port', value: String(dstPort), start: base + 2, end: base + 4 });
  children.push({ label: 'Length', value: String(length), start: base + 4, end: base + 6, warn: length < 8 });
  const datagramCaptured = has(data, base, length) && length >= 8;
  children.push(checksumField(data, base + 6, datagramCaptured ? () => internetChecksum(pseudoHeader(ip, length), data.subarray(base, base + length)) === 0 : null, true));
  const payloadLen = Math.max(0, length - 8);
  if (payloadLen > 0) {
    const captured = Math.max(0, Math.min(payloadLen, data.length - base - 8));
    children.push({
      label: 'UDP payload',
      value: `(${payloadLen} bytes)${captured < payloadLen ? ` ${TRUNCATED}` : ''}`,
      start: Math.min(base + 8, data.length),
      end: Math.min(base + 8 + payloadLen, data.length),
      truncated: captured < payloadLen,
    });
  }
  heading.value = `Src Port: ${srcPort}, Dst Port: ${dstPort}`;
  return { field: heading, udp: { srcPort, dstPort, length }, info: `${srcPort} → ${dstPort} Len=${payloadLen}` };
}

/* ── ICMP ── */

function icmpTypeName(type: number, code: number): string {
  if (type === 3) return `${ICMP_TYPES[3]} (${UNREACHABLE[code] ?? `code ${code}`})`;
  if (type === 11) return `${ICMP_TYPES[11]} (${code === 0 ? 'Time to live exceeded in transit' : 'Fragment reassembly time exceeded'})`;
  return ICMP_TYPES[type] ?? `Type ${type}`;
}

function dissectIcmp(data: Uint8Array, base: number, ip: Ipv4): { field: Field; icmp: IcmpSummary | null; info: string } {
  const heading: Field = { label: 'Internet Control Message Protocol', start: base, end: base, children: [] };
  const children = heading.children!;
  if (!has(data, base, 4)) {
    children.push({ label: TRUNCATED, start: base, end: data.length, truncated: true });
    heading.end = data.length;
    heading.truncated = true;
    return { field: heading, icmp: null, info: TRUNCATED };
  }
  const type = data[base]!;
  const code = data[base + 1]!;
  const length = Math.max(0, ip.totalLength - ip.headerLength);
  children.push({ label: 'Type', value: `${type} (${ICMP_TYPES[type] ?? 'Unknown'})`, start: base, end: base + 1 });
  children.push({ label: 'Code', value: type === 3 ? `${code} (${UNREACHABLE[code] ?? 'Unknown'})` : String(code), start: base + 1, end: base + 2 });
  children.push(checksumField(data, base + 2, has(data, base, length) && length >= 4 ? () => internetChecksum(data.subarray(base, base + length)) === 0 : null));
  let id: number | null = null;
  let seq: number | null = null;
  const echo = type === 0 || type === 8;
  if (echo && has(data, base, 8)) {
    id = u16(data, base + 4);
    seq = u16(data, base + 6);
    const le = ((seq & 0xff) << 8) | (seq >> 8);
    children.push({ label: 'Identifier (BE)', value: `${id} (${hex(id, 4)})`, start: base + 4, end: base + 6 });
    children.push({ label: 'Sequence Number (BE)', value: `${seq} (${hex(seq, 4)})`, start: base + 6, end: base + 8 });
    children.push({ label: 'Sequence Number (LE)', value: `${le} (${hex(le, 4)})`, start: base + 6, end: base + 8 });
    if (length > 8) {
      const captured = Math.max(0, Math.min(length - 8, data.length - base - 8));
      children.push({
        label: 'Data',
        value: `(${length - 8} bytes)${captured < length - 8 ? ` ${TRUNCATED}` : ''}`,
        start: Math.min(base + 8, data.length),
        end: Math.min(base + length, data.length),
        truncated: captured < length - 8,
      });
    }
  } else if (echo) {
    children.push({ label: TRUNCATED, start: base + 4, end: data.length, truncated: true });
  }
  heading.end = Math.min(base + Math.max(8, 4), data.length);
  let info = icmpTypeName(type, code);
  if (id !== null && seq !== null) {
    info += `  id=${hex(id, 4)}, seq=${seq}/${((seq & 0xff) << 8) | (seq >> 8)}, ttl=${ip.ttl}`;
  }
  return { field: heading, icmp: { type, code, id, seq }, info };
}

/* ── DNS ── */

/** A name at `at`, following compression pointers (offsets from the message's `origin`); the end of the name in place. */
function dnsName(data: Uint8Array, at: number, limit: number, origin: number): { name: string; end: number } | null {
  const labels: string[] = [];
  let position = at;
  let end = -1;
  for (let jumps = 0; jumps < 20; ) {
    if (position >= limit) return null;
    const length = data[position]!;
    if (length === 0) {
      if (end < 0) end = position + 1;
      return { name: labels.length ? labels.join('.') : '<Root>', end };
    }
    if ((length & 0xc0) === 0xc0) {
      if (position + 1 >= limit) return null;
      if (end < 0) end = position + 2;
      position = origin + (((length & 0x3f) << 8) | data[position + 1]!);
      jumps += 1;
      continue;
    }
    if (length > 63 || position + 1 + length > limit) return null;
    let label = '';
    for (let i = 1; i <= length; i += 1) {
      const c = data[position + i]!;
      label += c >= 0x21 && c <= 0x7e ? String.fromCharCode(c) : `\\${c.toString(8).padStart(3, '0')}`;
    }
    labels.push(label);
    position += 1 + length;
  }
  return null;
}

function dnsRdata(data: Uint8Array, type: number, start: number, length: number, limit: number, origin: number): string {
  if (type === 1 && length === 4) return ip4(data, start);
  if (type === 28 && length === 16) {
    const groups: string[] = [];
    for (let i = 0; i < 16; i += 2) groups.push(u16(data, start + i).toString(16));
    return groups.join(':').replace(/(^|:)0(:0)+(:|$)/, '::');
  }
  if (type === 5 || type === 2 || type === 12) return dnsName(data, start, limit, origin)?.name ?? '<bad name>';
  if (type === 15 && length >= 3) return `${u16(data, start)} ${dnsName(data, start + 2, limit, origin)?.name ?? '<bad name>'}`;
  if (type === 16) {
    let text = '';
    let at = start;
    while (at < start + length) {
      const n = data[at]!;
      text += `"${String.fromCharCode(...data.subarray(at + 1, at + 1 + n))}" `;
      at += 1 + n;
    }
    return text.trim();
  }
  return `(${length} bytes)`;
}

function dissectDns(data: Uint8Array, base: number, payloadLen: number): { field: Field; dns: DnsSummary | null; info: string } {
  const limit = Math.min(data.length, base + payloadLen);
  const heading: Field = { label: 'Domain Name System', start: base, end: limit, children: [] };
  const children = heading.children!;
  if (limit - base < 12) {
    children.push({ label: TRUNCATED, start: base, end: limit, truncated: true });
    heading.truncated = true;
    return { field: heading, dns: null, info: TRUNCATED };
  }
  const id = u16(data, base);
  const flags = u16(data, base + 2);
  const response = (flags & 0x8000) !== 0;
  const opcode = (flags >> 11) & 0xf;
  const rcode = flags & 0xf;
  const counts = [u16(data, base + 4), u16(data, base + 6), u16(data, base + 8), u16(data, base + 10)] as const;
  children.push({ label: 'Transaction ID', value: hex(id, 4), start: base, end: base + 2 });
  children.push({
    label: 'Flags',
    value: `${hex(flags, 4)} ${response ? 'Standard query response' : 'Standard query'}${response && rcode ? `, ${DNS_RCODES[rcode] ?? `rcode ${rcode}`}` : response ? ', No error' : ''}`,
    start: base + 2,
    end: base + 4,
    children: [
      { label: `${response ? '1' : '0'}... .... .... .... = Response`, value: response ? 'Message is a response' : 'Message is a query', start: base + 2, end: base + 3 },
      { label: 'Opcode', value: opcode === 0 ? 'Standard query (0)' : String(opcode), start: base + 2, end: base + 3 },
      ...(response ? [{ label: 'Authoritative', value: flags & 0x400 ? 'yes' : 'no', start: base + 2, end: base + 3 }] : []),
      { label: 'Truncated', value: flags & 0x200 ? 'yes' : 'no', start: base + 2, end: base + 3 },
      { label: 'Recursion desired', value: flags & 0x100 ? 'yes' : 'no', start: base + 2, end: base + 3 },
      ...(response
        ? [
            { label: 'Recursion available', value: flags & 0x80 ? 'yes' : 'no', start: base + 3, end: base + 4 },
            { label: 'Reply code', value: `${DNS_RCODES[rcode] ?? 'Unknown'} (${rcode})`, start: base + 3, end: base + 4, warn: rcode !== 0 },
          ]
        : []),
    ],
  });
  children.push({ label: 'Questions', value: String(counts[0]), start: base + 4, end: base + 6 });
  children.push({ label: 'Answer RRs', value: String(counts[1]), start: base + 6, end: base + 8 });
  children.push({ label: 'Authority RRs', value: String(counts[2]), start: base + 8, end: base + 10 });
  children.push({ label: 'Additional RRs', value: String(counts[3]), start: base + 10, end: base + 12 });

  const names: string[] = [];
  const infoQuestions: string[] = [];
  const infoAnswers: string[] = [];
  let at = base + 12;
  let cut = false;

  const queries: Field = { label: 'Queries', start: at, end: at, children: [] };
  for (let i = 0; i < counts[0] && !cut; i += 1) {
    const name = dnsName(data, at, limit, base);
    if (!name || name.end + 4 > limit) {
      cut = true;
      break;
    }
    const type = u16(data, name.end);
    const cls = u16(data, name.end + 2);
    const typeName = DNS_TYPES[type] ?? `Unknown (${type})`;
    names.push(name.name);
    infoQuestions.push(`${typeName} ${name.name}`);
    queries.children!.push({
      label: name.name,
      value: `type ${typeName}, class ${DNS_CLASSES[cls] ?? cls}`,
      start: at,
      end: name.end + 4,
      children: [
        { label: 'Name', value: name.name, start: at, end: name.end },
        { label: 'Type', value: `${typeName} (${type})`, start: name.end, end: name.end + 2 },
        { label: 'Class', value: `${DNS_CLASSES[cls] ?? 'Unknown'} (${hex(cls, 4)})`, start: name.end + 2, end: name.end + 4 },
      ],
    });
    at = name.end + 4;
  }
  queries.end = at;
  if (queries.children!.length) children.push(queries);

  const sections: Array<[string, number]> = [
    ['Answers', counts[1]],
    ['Authoritative nameservers', counts[2]],
    ['Additional records', counts[3]],
  ];
  for (const [title, count] of sections) {
    if (count === 0 || cut) continue;
    const section: Field = { label: title, start: at, end: at, children: [] };
    for (let i = 0; i < count; i += 1) {
      const name = dnsName(data, at, limit, base);
      if (!name || name.end + 10 > limit) {
        cut = true;
        break;
      }
      const type = u16(data, name.end);
      const cls = u16(data, name.end + 2);
      const ttl = u32(data, name.end + 4);
      const rdLength = u16(data, name.end + 8);
      const rdStart = name.end + 10;
      if (rdStart + rdLength > limit) {
        cut = true;
        break;
      }
      const typeName = DNS_TYPES[type] ?? `Unknown (${type})`;
      const rdata = type === 41 ? `(EDNS, ${rdLength} bytes)` : dnsRdata(data, type, rdStart, rdLength, limit, base);
      if (title === 'Answers') infoAnswers.push(`${typeName} ${rdata}`);
      section.children!.push({
        label: name.name,
        value: `type ${typeName}, class ${DNS_CLASSES[cls] ?? cls}, ${rdata}`,
        start: at,
        end: rdStart + rdLength,
        children: [
          { label: 'Name', value: name.name, start: at, end: name.end },
          { label: 'Type', value: `${typeName} (${type})`, start: name.end, end: name.end + 2 },
          { label: 'Class', value: type === 41 ? `UDP payload size ${cls}` : `${DNS_CLASSES[cls] ?? 'Unknown'} (${hex(cls, 4)})`, start: name.end + 2, end: name.end + 4 },
          { label: 'Time to live', value: type === 41 ? hex(ttl, 8) : `${ttl} s`, start: name.end + 4, end: name.end + 8 },
          { label: 'Data length', value: String(rdLength), start: name.end + 8, end: name.end + 10 },
          { label: typeName === 'A' || typeName === 'AAAA' ? 'Address' : 'Data', value: rdata, start: rdStart, end: rdStart + rdLength },
        ],
      });
      at = rdStart + rdLength;
    }
    section.end = at;
    if (section.children!.length) children.push(section);
  }
  if (cut) {
    const truncated = limit < base + payloadLen;
    children.push({ label: truncated ? TRUNCATED : '[Malformed DNS message]', start: Math.min(at, limit), end: limit, truncated, warn: !truncated });
    heading.truncated = truncated;
  }
  heading.value = response ? 'response' : 'query';
  const head = response ? `Standard query response ${hex(id, 4)}${rcode ? ` ${DNS_RCODES[rcode] ?? ''}` : ''}` : `Standard query ${hex(id, 4)}`;
  const info = [head, ...infoQuestions, ...infoAnswers].join(' ').trim();
  return { field: heading, dns: { id, response, names }, info };
}

/* ── the whole packet ── */

function formatArrival(tsUs: number): string {
  const date = new Date(Math.floor(tsUs / 1000));
  const micro = String(tsUs % 1_000_000).padStart(6, '0');
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}.${micro} UTC`;
}

/** Dissects one captured IPv4 packet. `relative` gives stream-relative TCP numbers, when known. */
export function dissect(data: Uint8Array, meta: FrameMeta, relative: Relative | null = null): Dissection {
  const frame: Field = {
    label: `Frame ${meta.seq}`,
    value: `${meta.len} bytes on wire, ${data.length} bytes captured`,
    start: 0,
    end: data.length,
    children: [
      { label: 'Arrival Time', value: formatArrival(meta.tsUs), start: 0, end: 0 },
      { label: 'Epoch Arrival Time', value: `${Math.floor(meta.tsUs / 1e6)}.${String(meta.tsUs % 1e6).padStart(6, '0')}`, start: 0, end: 0 },
      { label: 'Frame Number', value: String(meta.seq), start: 0, end: 0 },
      { label: 'Frame Length', value: `${meta.len} bytes`, start: 0, end: 0 },
      { label: 'Capture Length', value: `${data.length} bytes`, start: 0, end: 0 },
      { label: 'Direction', value: meta.direction === 'tx' ? 'Into the tunnel (sent)' : 'From the tunnel (received)', start: 0, end: 0 },
      { label: 'Node', value: meta.node, start: 0, end: 0 },
      { label: 'Verdict', value: meta.reason ? `${meta.verdict} (${meta.reason})` : meta.verdict, start: 0, end: 0, warn: meta.verdict === 'dropped' },
      { label: '[Protocols in frame', value: '', start: 0, end: 0 },
    ],
  };
  const tree: Field[] = [frame];
  const summary: Summary = {
    ipv4: false,
    src: '',
    dst: '',
    protoNumber: null,
    ttl: null,
    ipId: null,
    totalLength: null,
    df: false,
    mf: false,
    fragmentOffset: 0,
    protocol: 'IPv4',
    info: '',
    tcp: null,
    udp: null,
    icmp: null,
    dns: null,
  };

  const { field: ipField, ip } = dissectIpv4(data);
  tree.push(ipField);
  const protocols = ['raw', 'ip'];
  if (!ip) {
    summary.protocol = data.length && data[0]! >> 4 === 6 ? 'IPv6' : 'IPv4';
    summary.info = ipField.value ?? TRUNCATED;
    frame.children![8]!.value = `${protocols.join(':')}]`;
    return { summary, tree };
  }
  Object.assign(summary, {
    ipv4: true,
    src: ip.src,
    dst: ip.dst,
    protoNumber: ip.protocol,
    ttl: ip.ttl,
    ipId: ip.id,
    totalLength: ip.totalLength,
    df: ip.df,
    mf: ip.mf,
    fragmentOffset: ip.fragmentOffset,
    protocol: IP_PROTOCOLS[ip.protocol] ?? 'IPv4',
  });

  const base = ip.headerLength;
  if (ip.fragmentOffset > 0) {
    // Only the first fragment carries the transport header.
    const payload = Math.max(0, ip.totalLength - ip.headerLength);
    tree.push({ label: 'Data', value: `(${payload} bytes)`, start: Math.min(base, data.length), end: Math.min(base + payload, data.length) });
    summary.protocol = 'IPv4';
    summary.info = `Fragmented IP protocol (proto=${IP_PROTOCOLS[ip.protocol] ?? ''} ${ip.protocol}, off=${ip.fragmentOffset}, ID=${ip.id.toString(16).padStart(4, '0')})`;
    protocols.push('data');
    frame.children![8]!.value = `${protocols.join(':')}]`;
    return { summary, tree };
  }

  let info: string;
  if (ip.protocol === 6) {
    const tcp = dissectTcp(data, base, ip, relative);
    tree.push(tcp.field);
    summary.tcp = tcp.tcp;
    info = tcp.info;
    protocols.push('tcp');
  } else if (ip.protocol === 17) {
    const udp = dissectUdp(data, base, ip);
    tree.push(udp.field);
    summary.udp = udp.udp;
    info = udp.info;
    protocols.push('udp');
    if (udp.udp && (udp.udp.srcPort === 53 || udp.udp.dstPort === 53) && udp.udp.length > 8) {
      const dns = dissectDns(data, base + 8, udp.udp.length - 8);
      tree.push(dns.field);
      summary.dns = dns.dns;
      summary.protocol = 'DNS';
      info = dns.info;
      protocols.push('dns');
    }
  } else if (ip.protocol === 1) {
    const icmp = dissectIcmp(data, base, ip);
    tree.push(icmp.field);
    summary.icmp = icmp.icmp;
    info = icmp.info;
    protocols.push('icmp');
  } else {
    const payload = Math.max(0, ip.totalLength - ip.headerLength);
    tree.push({ label: 'Data', value: `(${payload} bytes)`, start: Math.min(base, data.length), end: Math.min(base + payload, data.length) });
    info = `${IP_PROTOCOLS[ip.protocol] ?? `Protocol ${ip.protocol}`}, ${payload} bytes`;
    protocols.push('data');
  }
  if (ip.mf) info = `${info} [fragment of a larger datagram]`;
  summary.info = info;
  frame.children![8]!.value = `${protocols.join(':')}]`;
  return { summary, tree };
}

/** The deepest field covering byte `offset`: what a click in the bytes pane selects. */
export function fieldAt(tree: Field[], offset: number): Field | null {
  let best: Field | null = null;
  const walk = (fields: Field[]) => {
    for (const f of fields) {
      if (f.end > f.start && offset >= f.start && offset < f.end) {
        if (!best || f.end - f.start <= best.end - best.start) best = f;
        if (f.children) walk(f.children);
      }
    }
  };
  walk(tree);
  return best;
}

/* ── TCP streams: relative sequence numbers ── */

/**
 * Remembers each TCP stream's initial sequence numbers, so packets can show
 * numbers relative to them. Feed packets in capture order.
 */
export class TcpStreams {
  private initial = new Map<string, number>();

  /** The relative numbers for a TCP packet, learning the stream's start from it. */
  relative(summary: Summary): Relative | null {
    const tcp = summary.tcp;
    if (!tcp) return null;
    const forward = `${summary.src}:${tcp.srcPort}>${summary.dst}:${tcp.dstPort}`;
    const backward = `${summary.dst}:${tcp.dstPort}>${summary.src}:${tcp.srcPort}`;
    if (!this.initial.has(forward)) this.initial.set(forward, tcp.flags & 0x02 ? tcp.seq : tcp.seq - 1);
    const isn = this.initial.get(forward)!;
    const peerIsn = this.initial.get(backward);
    const seq = (tcp.seq - isn) >>> 0;
    const ack = tcp.flags & 0x10 && peerIsn !== undefined ? (tcp.ack - peerIsn) >>> 0 : null;
    return { seq: seq > 0xf0000000 ? tcp.seq : seq, ack };
  }
}
