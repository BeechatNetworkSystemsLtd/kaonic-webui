/*
 * The classic pcap file format (what Wireshark opens): a 24-byte global header,
 * then per packet a 16-byte record header and the captured bytes. Little-endian,
 * microsecond timestamps, link type LINKTYPE_IPV4 (228): records start at the
 * IPv4 header, as the VPN capture does.
 */

export const PCAP_MAGIC = 0xa1b2c3d4;
export const LINKTYPE_IPV4 = 228;

export interface PcapRecord {
  /** Unix microseconds. */
  tsUs: number;
  /** Original length on the wire. */
  len: number;
  data: Uint8Array;
}

export function writePcap(records: readonly PcapRecord[], snaplen = 65535): Uint8Array<ArrayBuffer> {
  const size = 24 + records.reduce((sum, record) => sum + 16 + record.data.length, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, PCAP_MAGIC, true);
  view.setUint16(4, 2, true);
  view.setUint16(6, 4, true);
  view.setInt32(8, 0, true);
  view.setUint32(12, 0, true);
  view.setUint32(16, snaplen, true);
  view.setUint32(20, LINKTYPE_IPV4, true);
  let at = 24;
  for (const record of records) {
    view.setUint32(at, Math.floor(record.tsUs / 1e6), true);
    view.setUint32(at + 4, record.tsUs % 1e6, true);
    view.setUint32(at + 8, record.data.length, true);
    view.setUint32(at + 12, record.len, true);
    out.set(record.data, at + 16);
    at += 16 + record.data.length;
  }
  return out;
}

/** Reads a pcap written by `writePcap` (or the hub): for tests and checks. */
export function readPcap(bytes: Uint8Array): { linkType: number; snaplen: number; records: PcapRecord[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || view.getUint32(0, true) !== PCAP_MAGIC) throw new Error('not a little-endian microsecond pcap file');
  const records: PcapRecord[] = [];
  let at = 24;
  while (at + 16 <= bytes.length) {
    const seconds = view.getUint32(at, true);
    const micros = view.getUint32(at + 4, true);
    const captured = view.getUint32(at + 8, true);
    const len = view.getUint32(at + 12, true);
    if (at + 16 + captured > bytes.length) throw new Error('a record runs past the end of the file');
    records.push({ tsUs: seconds * 1e6 + micros, len, data: bytes.slice(at + 16, at + 16 + captured) });
    at += 16 + captured;
  }
  return { linkType: view.getUint32(20, true), snaplen: view.getUint32(16, true), records };
}
