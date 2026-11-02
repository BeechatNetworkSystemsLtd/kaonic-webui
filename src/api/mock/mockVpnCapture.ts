import type { VpnCapture, VpnCaptureOptions, VpnCapturedPacket, VpnVerdict } from '../types';
import { ApiError } from '../errors';
import { writePcap } from '@/features/vpn/pcap';
import { dns, icmpEcho, synOptions, TCP, tcp, udp } from '@/lib/packetBuilder';

/*
 * The mock's VPN packet capture: while it runs, the tunnel carries pings, DNS
 * lookups, a web request over TCP, a broadcast now and then, and a few packets
 * the hub drops, so the capture view has something real to dissect.
 */

export interface CapturePeer {
  id: string;
  codename: string;
  ip: string;
}

interface Pending {
  /** Microseconds after the conversation starts. */
  atUs: number;
  data: Uint8Array;
  direction: 'rx' | 'tx';
  peer: CapturePeer | null;
  flood?: boolean;
  verdict?: VpnVerdict;
  reason?: string;
}

const LIMITS = { snaplen: [64, 1500], maxPackets: [100, 20000], maxSecs: [10, 3600] } as const;
const NAMES = ['tile.openstreetmap.org', 'example.com', 'kaonic.local', 'time.cloudflare.com', 'updates.example.net'];

export function createMockCapture(us: string, network: string, peers: () => CapturePeer[]) {
  const broadcast = network.replace(/\.\d+\.\d+\/16$/, '.255.255');
  let state: VpnCapture = {
    running: false,
    startedTs: null,
    stoppedTs: null,
    snaplen: 128,
    maxPackets: 5000,
    maxSecs: 600,
    ring: true,
    packets: 0,
    dropped: 0,
    bytes: 0,
    firstSeq: null,
    lastSeq: null,
  };
  let held: VpnCapturedPacket[] = [];
  let seq = 0;
  let generatedUntilUs = 0;
  let conversation = 0;
  let pending: Array<Pending & { tsUs: number }> = [];
  let ephemeral = 41000;
  let isn = 1_000_000;
  let pingSeq = 0;
  let dnsId = 0x1a2b;

  function script(startUs: number): Array<Pending & { tsUs: number }> {
    const peerList = peers();
    if (peerList.length === 0) return [];
    const peer = peerList[conversation % peerList.length]!;
    const kind = conversation % 7;
    conversation += 1;
    const out: Pending[] = [];
    if (kind === 0 || kind === 4) {
      // A ping and its reply.
      pingSeq += 1;
      out.push({ atUs: 0, direction: 'tx', peer, data: icmpEcho({ src: us, dst: peer.ip, request: true, id: 0x4b1d, seq: pingSeq }) });
      out.push({ atUs: 27_000, direction: 'rx', peer, data: icmpEcho({ src: peer.ip, dst: us, request: false, id: 0x4b1d, seq: pingSeq, ttl: 63 }) });
    } else if (kind === 1 || kind === 5) {
      // A DNS lookup through the node at the other end.
      const name = NAMES[conversation % NAMES.length]!;
      const id = (dnsId = (dnsId + 0x1111) & 0xffff);
      const port = (ephemeral = ephemeral >= 60999 ? 41000 : ephemeral + 1);
      const answers = name === 'tile.openstreetmap.org' ? [{ type: 'CNAME' as const, value: 'dualstack.k.sni.global.fastly.net' }, { type: 'A' as const, value: '151.101.2.217' }] : [{ type: 'A' as const, value: `93.184.${conversation % 200}.${(conversation * 7) % 250}` }];
      out.push({ atUs: 0, direction: 'tx', peer, data: udp({ src: us, dst: peer.ip, srcPort: port, dstPort: 53, payload: dns({ id, name }) }) });
      out.push({ atUs: 31_000, direction: 'rx', peer, data: udp({ src: peer.ip, dst: us, srcPort: 53, dstPort: port, payload: dns({ id, name, answers }) }) });
    } else if (kind === 2) {
      // A short HTTP exchange: handshake, request, response, close.
      const port = (ephemeral = ephemeral >= 60999 ? 41000 : ephemeral + 1);
      const c = (isn = (isn + 7_654_321) >>> 0);
      const s = (c ^ 0x5a5a5a5a) >>> 0;
      const base = { src: us, dst: peer.ip, srcPort: port, dstPort: 80 };
      const back = { src: peer.ip, dst: us, srcPort: 80, dstPort: port, ttl: 63 };
      const request = new TextEncoder().encode(`GET /status HTTP/1.1\r\nHost: ${peer.ip}\r\nUser-Agent: kaonic-mock\r\nAccept: */*\r\n\r\n`);
      const response = new TextEncoder().encode(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 400\r\n\r\n{"node":"${peer.codename}","ok":true,${'"pad":"' + 'x'.repeat(340) + '"'}}`);
      out.push({ atUs: 0, direction: 'tx', peer, data: tcp({ ...base, seq: c, flags: TCP.SYN, options: synOptions(752, 3_000_000 + conversation) }) });
      out.push({ atUs: 29_000, direction: 'rx', peer, data: tcp({ ...back, seq: s, ack: c + 1, flags: TCP.SYN | TCP.ACK, window: 65160, options: synOptions(752, 9_000_000 + conversation, 3_000_000 + conversation) }) });
      out.push({ atUs: 29_400, direction: 'tx', peer, data: tcp({ ...base, seq: c + 1, ack: s + 1, flags: TCP.ACK, window: 502 }) });
      out.push({ atUs: 29_900, direction: 'tx', peer, data: tcp({ ...base, seq: c + 1, ack: s + 1, flags: TCP.PSH | TCP.ACK, window: 502, payload: request }) });
      out.push({ atUs: 61_000, direction: 'rx', peer, data: tcp({ ...back, seq: s + 1, ack: c + 1 + request.length, flags: TCP.PSH | TCP.ACK, window: 509, payload: response }) });
      out.push({ atUs: 61_500, direction: 'tx', peer, data: tcp({ ...base, seq: c + 1 + request.length, ack: s + 1 + response.length, flags: TCP.FIN | TCP.ACK, window: 501 }) });
      out.push({ atUs: 90_000, direction: 'rx', peer, data: tcp({ ...back, seq: s + 1 + response.length, ack: c + 2 + request.length, flags: TCP.FIN | TCP.ACK, window: 509 }) });
      out.push({ atUs: 90_300, direction: 'tx', peer, data: tcp({ ...base, seq: c + 2 + request.length, ack: s + 2 + response.length, flags: TCP.ACK, window: 501 }) });
    } else if (kind === 3) {
      // A broadcast to every node, and one the rate limit stopped.
      const payload = new TextEncoder().encode(`hello from emuhub at ${conversation}`);
      out.push({ atUs: 0, direction: 'tx', peer: null, flood: true, data: udp({ src: us, dst: broadcast, srcPort: 5400, dstPort: 5400, payload }) });
      out.push({ atUs: 4_000, direction: 'tx', peer: null, flood: true, verdict: 'dropped', reason: 'rate_limited', data: udp({ src: us, dst: '224.0.0.251', srcPort: 5353, dstPort: 5353, payload: dns({ id: 0, name: 'kaonic.local' }) }) });
    } else {
      // Packets the hub refuses: a spoofed source from a peer, and a destination with no route.
      out.push({ atUs: 0, direction: 'rx', peer, verdict: 'dropped', reason: 'source_not_allowed', data: icmpEcho({ src: '10.20.99.9', dst: us, request: true, id: 0x0bad, seq: conversation }) });
      out.push({ atUs: 9_000, direction: 'tx', peer: null, verdict: 'dropped', reason: 'no_route', data: udp({ src: us, dst: '172.16.4.4', srcPort: 51515, dstPort: 123, payload: new Uint8Array(48) }) });
    }
    return out.map((packet) => ({ ...packet, tsUs: startUs + packet.atUs }));
  }

  /** Plays the scripts forward to now. */
  function advance(nowUs: number) {
    if (!state.running) return;
    if (state.startedTs !== null && nowUs / 1000 - state.startedTs >= state.maxSecs * 1000) {
      generate(nowUs);
      stop(nowUs / 1000);
      return;
    }
    generate(nowUs);
  }

  function generate(nowUs: number) {
    // A new conversation every ~350 ms.
    while (generatedUntilUs + 350_000 <= nowUs) {
      generatedUntilUs += 350_000;
      pending.push(...script(generatedUntilUs));
    }
    pending.sort((a, b) => a.tsUs - b.tsUs);
    const due = pending.filter((packet) => packet.tsUs <= nowUs);
    pending = pending.filter((packet) => packet.tsUs > nowUs);
    for (const packet of due) {
      if (!state.running) break;
      if (held.length >= state.maxPackets) {
        if (!state.ring) {
          state.dropped += 1;
          stop(packet.tsUs / 1000);
          break;
        }
        const old = held.shift()!;
        state.bytes -= old.len;
        state.dropped += 1;
      }
      seq += 1;
      held.push({
        seq,
        tsUs: Math.round(packet.tsUs),
        direction: packet.direction,
        peerId: packet.peer?.id ?? null,
        peerCodename: packet.peer?.codename ?? null,
        flood: packet.flood ?? false,
        len: packet.data.length,
        data: packet.data.slice(0, state.snaplen),
        verdict: packet.verdict ?? (packet.direction === 'tx' ? 'sent' : 'delivered'),
        reason: packet.reason ?? null,
      });
      state.bytes += packet.data.length;
    }
    state.packets = held.length;
    state.firstSeq = held[0]?.seq ?? null;
    state.lastSeq = held[held.length - 1]?.seq ?? null;
  }

  function stop(nowMs: number) {
    if (!state.running) return;
    state = { ...state, running: false, stoppedTs: Math.round(nowMs) };
  }

  const nowUs = () => Date.now() * 1000;
  const copy = (): VpnCapture => ({ ...state });

  return {
    state(): VpnCapture {
      advance(nowUs());
      return copy();
    },
    start(options: VpnCaptureOptions = {}): VpnCapture {
      const fields: Record<string, string> = {};
      const check = (name: keyof typeof LIMITS, value: number | undefined, wire: string) => {
        const [min, max] = LIMITS[name];
        if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) fields[wire] = `Use ${min} to ${max}.`;
      };
      check('snaplen', options.snaplen, 'snaplen');
      check('maxPackets', options.maxPackets, 'maxPackets');
      check('maxSecs', options.maxSecs, 'maxSecs');
      if (Object.keys(fields).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', fields);
      const now = nowUs();
      held = [];
      seq = 0;
      pending = [];
      generatedUntilUs = now - 300_000;
      state = {
        running: true,
        startedTs: Math.round(now / 1000),
        stoppedTs: null,
        snaplen: options.snaplen ?? 128,
        maxPackets: options.maxPackets ?? 5000,
        maxSecs: options.maxSecs ?? 600,
        ring: options.ring ?? true,
        packets: 0,
        dropped: 0,
        bytes: 0,
        firstSeq: null,
        lastSeq: null,
      };
      return copy();
    },
    stop(): VpnCapture {
      advance(nowUs());
      stop(Date.now());
      return copy();
    },
    packets(after: number, limit = 500): VpnCapturedPacket[] {
      advance(nowUs());
      const bounded = Math.min(1000, Math.max(1, limit));
      return held.filter((packet) => packet.seq > after).slice(0, bounded);
    },
    pcap(): Blob {
      advance(nowUs());
      const bytes = writePcap(held.map((packet) => ({ tsUs: packet.tsUs, len: packet.len, data: packet.data })), state.snaplen);
      return new Blob([bytes], { type: 'application/vnd.tcpdump.pcap' });
    },
  };
}
