import type { VpnCapturedPacket } from '@/api';
import { dissect, TcpStreams, type Summary } from './dissect';
import type { FilterRecord } from './filter';

/*
 * The packets of one capture on the page: appended as they are fetched, at most
 * `max` (the oldest go first), each summarised once on arrival so the list, the
 * info column and the display filter never re-parse 20000 packets.
 */

export interface CapturedRow {
  packet: VpnCapturedPacket;
  summary: Summary;
  /** For the filter. */
  record: FilterRecord;
  relative: { seq: number; ack: number | null } | null;
}

export const nodeName = (packet: VpnCapturedPacket) => (packet.flood ? 'all' : (packet.peerCodename ?? packet.peerId?.slice(0, 8) ?? '–'));

export class CaptureBuffer {
  private rows: CapturedRow[] = [];
  private streams = new TcpStreams();
  private lastSeq = 0;

  constructor(private readonly max = 20000) {}

  /** Adds packets newer than the last one held; returns how many were added. */
  append(packets: readonly VpnCapturedPacket[]): number {
    let added = 0;
    for (const packet of packets) {
      if (packet.seq <= this.lastSeq) continue;
      this.lastSeq = packet.seq;
      const meta = { seq: packet.seq, tsUs: packet.tsUs, len: packet.len, direction: packet.direction, node: nodeName(packet), verdict: packet.verdict, reason: packet.reason };
      let { summary } = dissect(packet.data, meta);
      const relative = this.streams.relative(summary);
      // TCP's info column shows stream-relative numbers, like Wireshark's.
      if (relative) summary = dissect(packet.data, meta, relative).summary;
      this.rows.push({
        packet,
        summary,
        relative,
        record: {
          summary,
          number: packet.seq,
          len: packet.len,
          capturedLen: packet.data.length,
          node: meta.node,
          direction: packet.direction,
          verdict: packet.verdict,
          reason: packet.reason,
        },
      });
      added += 1;
    }
    if (this.rows.length > this.max) this.rows.splice(0, this.rows.length - this.max);
    return added;
  }

  /** Forgets everything: a new capture numbers its packets from 1 again. */
  clear() {
    this.rows = [];
    this.streams = new TcpStreams();
    this.lastSeq = 0;
  }

  /** Empties the view but keeps reading after the last packet seen ("Clear view"). */
  clearRows() {
    this.rows = [];
    this.streams = new TcpStreams();
  }

  /** The highest seq held (0 when empty): ask the hub for packets after it. */
  after(): number {
    return this.lastSeq;
  }

  all(): readonly CapturedRow[] {
    return this.rows;
  }
}
