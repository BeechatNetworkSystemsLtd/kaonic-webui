import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Peer } from '../types';
import { createHttpApi } from './httpApi';
import { fakeHub, FakeSocket, FakeWebSocket, settle } from './testFakes';
import type { WireJob, WireNetworkState, WirePeer, WirePttSettings, WirePttState, WireRadioBand, WireRadioBandStats, WireRadioFrame, WireVpnState } from './wire';

const AUTH = { setup_required: false, authenticated: true, role: 'admin', csrf_token: 'token-1' } as const;

const wirePeer = (id: string, extra: Partial<WirePeer> = {}): WirePeer => ({
  id,
  codename: `kaon${id.slice(0, 4)}`,
  tag: '',
  version: '1.0.0',
  online: true,
  first_seen_ts: 100,
  last_seen_ts: 200,
  hops: 1,
  via_id: null,
  rssi: -70,
  list: 'none',
  trust: { network: 'unprovisioned', is_admin: false, provisioning: null },
  link: { state: 'none', rtt_ms: null, detail: null },
  tunnel_ip: null,
  ...extra,
});

const NETWORK: WireNetworkState = {
  active_source: 'wifi_client',
  sources: [{ id: 'wifi_client', enabled: true, status: 'active', detail: '"Office" at -58 dBm' }],
  consumers: [{ id: 'hotspot', enabled: true, status: 'active', detail: 'Kaonic', clients: 2 }],
  lan: { address: '192.168.10.1', subnet: '192.168.10.0/24' },
};

const BAND: WireRadioBand = {
  id: 'b_24',
  module: 1,
  range: '2g4',
  min_hz: 2_400_000_000,
  max_hz: 2_483_500_000,
  config: { frequency_hz: 2_462_000_000, channel_spacing_hz: 1_200_000, channel: 11, modulation: { kind: 'qpsk', chip_rate_khz: 1000, rate_mode: 2 }, tx_power: 18 },
  used_by: ['mesh'],
  last_rssi: -83,
};

const WIFI = {
  client: { state: 'connected', ssid: 'Café/2', signal_dbm: -52, address: '192.168.1.23/24', pinned: 'Café/2', attempt: null, scanned_ts: 1000, fault: null },
  saved: [
    { ssid: 'Café/2', secured: true, auto_connect: true, in_range: true, signal_dbm: -52, last_connected_ts: 900, problem: null, retry_ts: null },
    { ssid: 'Depot', secured: true, auto_connect: false, in_range: false, signal_dbm: null, last_connected_ts: null, problem: 'wrong_password', retry_ts: null },
  ],
  hotspot: { enabled: true, ssid: 'K', password: null, open: false },
  antenna: 'internal',
  antenna_supported: false,
} as const;

const job = (id: string, extra: Partial<WireJob> = {}): WireJob => ({
  id,
  kind: 'wifi_scan',
  state: 'queued',
  node_id: null,
  progress: null,
  detail: null,
  created_ts: 1000,
  updated_ts: 1000,
  ...extra,
});

function makeApi(routes: Parameters<typeof fakeHub>[0]) {
  const hub = fakeHub(routes);
  const api = createHttpApi({ fetch: hub.fetch, WebSocket: FakeWebSocket, eventsUrl: (topics) => `wss://kaonic/events?topics=${topics.join(',')}`, scanPollMs: 1 });
  return { api, calls: hub.calls };
}

beforeEach(() => FakeSocket.reset());

describe('requests', () => {
  it('keeps the CSRF token in memory and sends it with writes only', async () => {
    const { api, calls } = makeApi({ 'GET /auth/state': { body: AUTH }, 'GET /network': { body: NETWORK }, 'PATCH /network': { body: NETWORK } });

    expect(await api.auth.state()).toEqual({ setupRequired: false, authenticated: true, role: 'admin' });
    await api.network.get();
    const state = await api.network.setSource('wifi_client', true);

    expect(calls.find((call) => call.method === 'GET' && call.path === '/network')!.headers['X-Kaonic-CSRF']).toBeUndefined();
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.headers['X-Kaonic-CSRF']).toBe('token-1');
    expect(patch.body).toEqual({ sources: { wifi_client: true } });
    expect(state.activeSource).toBe('wifi_client');
    expect(state.consumers[0]).toEqual({ id: 'hotspot', enabled: true, status: 'active', detail: 'Kaonic', clients: 2 });
  });

  it('fetches the token before the first write, and retries once when the hub says it is stale', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': [{ body: AUTH }, { body: { ...AUTH, csrf_token: 'token-2' } }],
      'PUT /peers/aa/list': [
        { status: 403, body: { code: 'csrf_failed', message: 'Stale token.' } },
        { body: wirePeer('aa', { list: 'blacklist' }) },
      ],
    });

    const peer = await api.peers.setList('aa', 'blacklist');

    expect(peer.list).toBe('blacklist');
    expect(calls.map((call) => `${call.method} ${call.path} ${call.headers['X-Kaonic-CSRF'] ?? '-'}`)).toEqual([
      'GET /auth/state -',
      'PUT /peers/aa/list token-1',
      'GET /auth/state -',
      'PUT /peers/aa/list token-2',
    ]);
  });

  it('turns hub errors into ApiErrors the UI understands', async () => {
    const { api } = makeApi({
      'GET /auth/state': { body: AUTH },
      'PUT /radio/bands/a_sub': {
        status: 422,
        body: { code: 'validation_failed', message: 'Check the fields.', details: { fields: { 'config.frequency_hz': 'Out of range.' } } },
      },
      'PUT /peers/bb/list': { status: 409, body: { code: 'foreign_node', message: 'Belongs to another admin.' } },
      'PUT /peers/cc/list': { status: 409, body: { code: 'something_new', message: 'A code from a newer hub.' } },
      'GET /device': { status: 502, text: '<html>Bad gateway</html>' },
    });
    const config = { frequencyHz: 1, channelSpacingHz: 1, channel: 0, modulation: { kind: 'off' as const }, txPower: 0 };

    await expect(api.radio.updateBand('a_sub', config)).rejects.toMatchObject({ code: 'validation_failed', fields: { frequencyHz: 'Out of range.' } });
    await expect(api.peers.setList('bb', 'whitelist')).rejects.toMatchObject({ code: 'conflict', reason: 'foreign_node', message: 'Belongs to another admin.' });
    await expect(api.peers.setList('cc', 'whitelist')).rejects.toMatchObject({ code: 'conflict', reason: 'something_new' });
    await expect(api.device.get()).rejects.toMatchObject({ code: 'internal', reason: null });
  });

  it('reports a device it cannot reach as a network error', async () => {
    const api = createHttpApi({ fetch: () => Promise.reject(new TypeError('Failed to fetch')), WebSocket: FakeWebSocket, eventsUrl: () => 'wss://x' });
    await expect(api.device.get()).rejects.toMatchObject({ code: 'network' });
  });

  it('encodes path parameters', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /network/wifi/networks/Caf%C3%A9%2F2/connect': { body: WIFI },
    });
    const wifi = await api.wifi.connect('Café/2');
    expect(calls.at(-1)!.path).toBe('/network/wifi/networks/Caf%C3%A9%2F2/connect');
    expect(wifi.client).toEqual({ state: 'connected', ssid: 'Café/2', signalDbm: -52, address: '192.168.1.23/24', pinned: 'Café/2', attempt: null, scannedTs: 1000, fault: null });
    expect(wifi.saved[1]).toEqual({ ssid: 'Depot', secured: true, autoConnect: false, inRange: false, signalDbm: null, lastConnectedTs: null, problem: 'wrong_password', retryTs: null });
    // A viewer is not told the hotspot password.
    expect(wifi.hotspot).toEqual({ enabled: true, ssid: 'K', password: null, open: false });
  });

  it('changes saved networks in the hub’s words', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'PATCH /network/wifi/networks/Depot': { body: WIFI },
      'PUT /network/wifi/order': { body: WIFI },
      'DELETE /network/wifi/pin': { body: WIFI },
      'POST /network/wifi/networks': { body: WIFI },
    });
    await api.wifi.update('Depot', { password: 'new-password', autoConnect: true });
    await api.wifi.update('Depot', { password: null });
    await api.wifi.reorder(['Depot', 'Café/2']);
    await api.wifi.unpin();
    await api.wifi.join({ ssid: 'Hidden', password: null, hidden: true });
    expect(calls.slice(1).map((call) => [call.method, call.path, call.body])).toEqual([
      ['PATCH', '/network/wifi/networks/Depot', { password: 'new-password', auto_connect: true }],
      ['PATCH', '/network/wifi/networks/Depot', { password: null }],
      ['PUT', '/network/wifi/order', { ssids: ['Depot', 'Café/2'] }],
      ['DELETE', '/network/wifi/pin', undefined],
      ['POST', '/network/wifi/networks', { ssid: 'Hidden', password: null, hidden: true }],
    ]);
  });
});

const BAND_STATS: WireRadioBandStats = {
  band: 'b_sub',
  interface: 'rf09_b',
  rx_frames: 117,
  rx_packets: 102,
  rx_bytes: 18_006,
  rx_bps: 640,
  rx_decode_errors: 15,
  tx_frames: 112,
  tx_packets: 112,
  tx_bytes: 21_107,
  tx_bps: 480,
  tx_errors: 0,
  airtime: { rx_pct: 1.5, tx_pct: 0.75 },
  last_rssi: -11,
  noise_dbm: -77,
  driver: { rx_errors: 0, rx_dropped: 0, tx_errors: 0, tx_dropped: 43 },
};

const FRAME: WireRadioFrame = {
  seq: 7,
  ts_ms: 1_748_556_506_000,
  band: 'b_sub',
  direction: 'rx',
  rssi: -71,
  len: 210,
  frequency_hz: 871_735_000,
  bandwidth_hz: 1_094_000,
  duration_ms: 1.9,
  kind: 'announce',
  hops: 1,
  destination: 'd'.repeat(32),
  destination_type: 'single',
  packet_len: 187,
  peer_id: 'a'.repeat(32),
  peer_codename: 'bench001',
};

/** What the hub answers before the VPN exists: everything off and empty. */
const VPN_OFF: WireVpnState & Record<string, unknown> = {
  enabled: false,
  status: 'stopped',
  interface: null,
  network: null,
  tunnel_ip: null,
  routes: { advertised: [], local_mappings: [], remote: [] },
  access: { allow_all_peers: false, peers: [] },
  uplink: { enabled: false, active: false, peer_id: null, routes: [], default_route: false, detail: null },
  gateway: { enabled: false, active: false, egress_interface: null, routes: [], available_interfaces: [], detail: null },
  counters: { tx_packets: 0, tx_bytes: 0, tx_bps: 0, rx_packets: 0, rx_bytes: 0, rx_bps: 0, dropped: 0 },
  peers: [],
  last_error: null,
};

describe('model mapping', () => {
  it('maps band counters, frames and the analyser backlog query', async () => {
    const { api, calls } = makeApi({ 'GET /radio/stats': { body: [BAND_STATS] }, 'GET /radio/frames?band=b_sub&limit=500': { body: [FRAME] } });
    expect(await api.radio.stats()).toEqual([
      {
        band: 'b_sub',
        interface: 'rf09_b',
        rxFrames: 117,
        rxPackets: 102,
        rxBytes: 18_006,
        rxBps: 640,
        rxDecodeErrors: 15,
        txFrames: 112,
        txPackets: 112,
        txBytes: 21_107,
        txBps: 480,
        txErrors: 0,
        airtime: { rxPct: 1.5, txPct: 0.75 },
        lastRssi: -11,
        noiseDbm: -77,
        driver: { rxErrors: 0, rxDropped: 0, txErrors: 0, txDropped: 43 },
      },
    ]);
    const [frame] = await api.radio.frames({ band: 'b_sub', limit: 500 });
    expect(calls.at(-1)!.path).toBe('/radio/frames?band=b_sub&limit=500');
    expect(frame).toMatchObject({ ts: FRAME.ts_ms, kind: 'announce', hops: 1, destinationType: 'single', packetLen: 187, peerId: 'a'.repeat(32), peer: 'bench001' });
  });

  it('maps the VPN the hub reports before it runs, and its packets', async () => {
    const { api } = makeApi({
      'GET /vpn': { body: VPN_OFF },
      'GET /vpn/packets?limit=8': { body: [{ ts_ms: 5, dir: 'tx', src: '10.20.1.1', dst: '10.20.31.7', proto: 'TCP', sport: 40_000, dport: 443, len: 60 }, { ts_ms: 4, dir: 'rx', src: '10.20.31.7', dst: '10.20.1.1', proto: 'ICMP', len: 84 }] },
    });
    expect(await api.vpn.get()).toEqual({
      enabled: false,
      status: 'stopped',
      interface: null,
      network: null,
      tunnelIp: null,
      counters: { txPackets: 0, txBytes: 0, txBps: 0, rxPackets: 0, rxBytes: 0, rxBps: 0, dropped: 0, lastTxTs: null, lastRxTs: null },
      peers: [],
      routes: { advertised: [], localMappings: [], remote: [] },
      uplink: { enabled: false, active: false, peerId: null, routes: [], defaultRoute: false, detail: null, gateways: [] },
      gateway: { enabled: false, active: false, egressInterface: null, routes: [], availableInterfaces: [], detail: null },
      settings: null,
      mtu: null,
      lastError: null,
    });
    expect(await api.vpn.packets(8)).toEqual([
      { ts: 5, direction: 'tx', src: '10.20.1.1', dst: '10.20.31.7', proto: 'TCP', sport: 40_000, dport: 443, len: 60 },
      { ts: 4, direction: 'rx', src: '10.20.31.7', dst: '10.20.1.1', proto: 'ICMP', sport: null, dport: null, len: 84 },
    ]);
  });

  it('maps VPN routes, the capture and its packets', async () => {
    const capture = { running: true, started_ts_ms: 1000, stopped_ts_ms: null, snaplen: 128, max_packets: 5000, max_secs: 600, ring: true, packets: 2, dropped: 0, bytes: 168, first_seq: 1, last_seq: 2 };
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'GET /vpn': {
        body: {
          ...VPN_OFF,
          enabled: true,
          status: 'running',
          mtu: 792,
          routes: {
            advertised: ['192.168.10.0/24'],
            local_mappings: [],
            remote: [{ network: '0.0.0.0/0', peer_id: 'ab'.repeat(16), status: 'refused', installed: false, last_seen_ts: 9, reason: 'default route' }, { network: '192.168.21.0/24', peer_id: 'cd'.repeat(16), status: 'active', installed: true, last_seen_ts: 9 }],
          },
        },
      },
      'GET /vpn/capture': { body: capture },
      'POST /vpn/capture': { body: capture },
      'POST /vpn/capture/stop': { body: { ...capture, running: false, stopped_ts_ms: 2000 } },
      'GET /vpn/capture/packets?after=0&limit=500': {
        body: [{ seq: 1, ts_us: 1_000_000_123, dir: 'tx', peer_id: null, peer_codename: null, flood: true, len: 84, data: 'RQAAVA==', verdict: 'dropped', reason: 'rate_limited' }],
      },
      'GET /vpn/capture.pcap': { text: 'PCAPDATA' },
    });
    const vpn = await api.vpn.get();
    expect(vpn.mtu).toBe(792);
    expect(vpn.routes).toEqual({
      advertised: ['192.168.10.0/24'],
      localMappings: [],
      remote: [
        { network: '0.0.0.0/0', peerId: 'ab'.repeat(16), status: 'refused', installed: false, lastSeenTs: 9, reason: 'default route' },
        { network: '192.168.21.0/24', peerId: 'cd'.repeat(16), status: 'active', installed: true, lastSeenTs: 9, reason: null },
      ],
    });
    expect(await api.vpn.capture()).toEqual({ running: true, startedTs: 1000, stoppedTs: null, snaplen: 128, maxPackets: 5000, maxSecs: 600, ring: true, packets: 2, dropped: 0, bytes: 168, firstSeq: 1, lastSeq: 2 });
    await api.vpn.startCapture({ snaplen: 256, maxPackets: 1000, ring: false });
    expect(calls.find((call) => call.method === 'POST' && call.path === '/vpn/capture')!.body).toEqual({ snaplen: 256, max_packets: 1000, ring: false });
    expect((await api.vpn.stopCapture()).running).toBe(false);
    const [packet] = await api.vpn.capturePackets(0);
    expect(packet).toEqual({ seq: 1, tsUs: 1_000_000_123, direction: 'tx', peerId: null, peerCodename: null, flood: true, len: 84, data: Uint8Array.from([0x45, 0, 0, 0x54]), verdict: 'dropped', reason: 'rate_limited' });
    const pcap = await api.vpn.capturePcap();
    expect(new TextDecoder().decode(await pcap.arrayBuffer())).toBe('PCAPDATA');
  });

  it('maps push-to-talk state, settings and sessions, and its live topics', async () => {
    const talker = { id: 'ab'.repeat(16), codename: 'emuadmin', is_admin: true, local: false, source: null };
    const settings: WirePttSettings = {
      volume: null,
      mic_gain: 60,
      capture_device: 'default',
      playback_device: 'hw:0,0',
      talk_input: 'device',
      play_on_device: true,
      rx_while_tx: false,
      auto_arm: true,
      squelch_enabled: true,
      squelch_open_dbfs: -45,
      squelch_hysteresis_db: 6,
      squelch_hangover_ms: 600,
      squelch_preroll_ms: 120,
      jitter_target_ms: 120,
      jitter_max_ms: 320,
      opus_bitrate_bps: 20000,
      opus_complexity: 5,
      opus_dtx: true,
      opus_fec: false,
      opus_packet_loss_pct: 0,
      opus_cbr: false,
      packet_frames: 4,
      packet_frames_max: 8,
      packet_align_ldpc: true,
      relay: true,
      ttl: 4,
      spectrum_enabled: true,
      spectrum_bands: 14,
    };
    const state: WirePttState = {
      status: 'running',
      detail: null,
      self: { id: 'cd'.repeat(16), is_admin: true },
      group: { name: 'all', epoch: 2, members: 3 },
      floor: { state: 'receiving', talker, since_ts_ms: 1000, level: 0.4 },
      settings,
      audio: { device: true, codec: 'opus' },
      recent: [{ talker, started_ts_ms: 900, duration_ms: 2100, frames: 105, lost_frames: 3, hops: 2, ended: 'preempted' }],
      stats: { tx_packets: 1, rx_packets: 35, relayed: 12, suppressed: 4, duplicates: 2 },
    };
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'GET /ptt': { body: state },
      'PATCH /ptt/settings': (call) => ({ body: { ...settings, ...(call.body as object) } }),
      'POST /ptt/sessions': {
        status: 201,
        body: { token: '1f2e3d4c', transport: 'udp', udp_port: 8781, format: 'pcm_s16le_mono', sample_rate_hz: 16000, frame_ms: 20, samples_per_frame: 320, keepalive_interval_ms: 1000, unkey_timeout_ms: 500 },
      },
    });
    const ptt = await api.ptt.get();
    expect(ptt.floor).toEqual({ state: 'receiving', talker: { id: 'ab'.repeat(16), codename: 'emuadmin', isAdmin: true, local: false, source: null }, sinceTs: 1000, level: 0.4 });
    expect(ptt.recent[0]).toMatchObject({ startedTs: 900, durationMs: 2100, lostFrames: 3, hops: 2, ended: 'preempted' });
    expect(ptt.self).toEqual({ id: 'cd'.repeat(16), isAdmin: true });
    expect(ptt.settings).toMatchObject({ volume: null, micGain: 60, playbackDevice: 'hw:0,0', talkInput: 'device', squelchPrerollMs: 120, opusBitrateBps: 20000, packetAlignLdpc: true, spectrumBands: 14 });
    expect(Object.keys(ptt.settings)).toHaveLength(28);
    expect(await api.ptt.updateSettings({ micGain: 80, squelchOpenDbfs: -40, volume: null })).toMatchObject({ micGain: 80, squelchOpenDbfs: -40, volume: null });
    expect(calls.find((call) => call.method === 'PATCH')!.body).toEqual({ mic_gain: 80, squelch_open_dbfs: -40, volume: null });
    expect(await api.ptt.createSession()).toMatchObject({ token: '1f2e3d4c', udpPort: 8781, samplesPerFrame: 320 });
    expect(calls.find((call) => call.path === '/ptt/sessions')!.body).toEqual({ transport: 'udp' });

    const levels: number[] = [];
    const states: string[] = [];
    api.events.subscribe('pttLevel', (level) => levels.push(level));
    api.events.subscribe('ptt', (next) => states.push(next.floor.state));
    FakeSocket.last().open();
    FakeSocket.last().event('ptt', 'ptt.level', { level: 0.7 });
    FakeSocket.last().event('ptt', 'ptt.state', { ...state, floor: { ...state.floor, state: 'idle', talker: null } });
    expect(levels).toEqual([0.7]);
    expect(states).toEqual(['idle']);
  });

  it('keys the device microphone, answers a taken floor, and runs the test tools', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'GET /ptt/devices': { body: { capture: [{ name: 'default', description: 'Default' }], playback: [{ name: 'hw:0,0', description: 'WM8960' }] } },
      'POST /ptt/key': [{ status: 204 }, { status: 409, body: { code: 'ptt_busy', message: 'emunode2 is talking.', talker: null } }],
      'POST /ptt/unkey': { status: 204 },
      'GET /ptt/test/wav': [{ body: null }, { body: { duration_ms: 2500, size_bytes: 80044, uploaded_ts: 1792000000 } }],
      'PUT /ptt/test/wav': { body: { duration_ms: 2500, size_bytes: 80044, uploaded_ts: 1792000000 } },
      'DELETE /ptt/test/wav': { status: 204 },
      'POST /ptt/test/tx': { status: 204 },
      'POST /ptt/test/tx/stop': { status: 204 },
    });
    expect(await api.ptt.devices()).toEqual({ capture: [{ name: 'default', description: 'Default' }], playback: [{ name: 'hw:0,0', description: 'WM8960' }] });
    expect(await api.ptt.key()).toEqual({ keyed: true });
    expect(await api.ptt.key()).toEqual({ keyed: false, reason: 'emunode2 is talking.' });
    await api.ptt.unkey();
    expect(await api.ptt.testWav()).toBeNull();
    expect(await api.ptt.uploadTestWav(new Blob([new Uint8Array(44)]))).toEqual({ durationMs: 2500, sizeBytes: 80044, uploadedTs: 1792000000 });
    expect(calls.find((call) => call.method === 'PUT')!.headers['Content-Type']).toBe('audio/wav');
    expect(await api.ptt.testWav()).toMatchObject({ durationMs: 2500 });
    await api.ptt.deleteTestWav();
    expect(await api.ptt.startTestTx({ source: 'tone', loop: true })).toEqual({ keyed: true });
    expect(calls.find((call) => call.path === '/ptt/test/tx')!.body).toEqual({ source: 'tone', loop: true });
    await api.ptt.stopTestTx();
  });

  it('reads the board filters and range, and sets a filter by index', async () => {
    const wire: WireRadioBand = {
      ...BAND,
      id: 'b_sub',
      range: 'sub_ghz',
      min_mhz: 390,
      max_mhz: 510,
      filter: 2,
      filters: [
        { index: 0, label: 'Wide 330–565 MHz', min_mhz: 330, max_mhz: 565 },
        { index: 1, label: '445–475 MHz', min_mhz: 445, max_mhz: 475 },
        { index: 2, label: '424–442 MHz', min_mhz: 424, max_mhz: 442 },
      ],
      active_filter: 2,
      filter_state: 'ok',
    };
    const { api, calls } = makeApi({ 'GET /auth/state': { body: AUTH }, 'PUT /radio/bands/b_sub/filter': { body: wire } });
    const band = await api.radio.setBandFilter('b_sub', 2);
    expect(calls.at(-1)!.body).toEqual({ filter: 2 });
    expect(band.boardRangeMhz).toEqual([390, 510]);
    expect(band.filters![1]).toEqual({ index: 1, label: '445–475 MHz', minMhz: 445, maxMhz: 475 });
    expect([band.filter, band.activeFilter, band.filterState]).toEqual([2, 2, 'ok']);
    // An older hub says nothing about filters; a hub without the radio daemon has no range.
    const { api: older } = makeApi({ 'GET /radio/bands': { body: [BAND, { ...BAND, min_mhz: null, max_mhz: null, filter_state: 'unavailable' }] } });
    const [plain, unavailable] = await older.radio.bands();
    expect('filters' in plain! || 'boardRangeMhz' in plain!).toBe(false);
    expect([unavailable!.boardRangeMhz, unavailable!.filterState]).toEqual([null, 'unavailable']);
  });

  it('maps radio settings both ways', async () => {
    const { api, calls } = makeApi({ 'GET /auth/state': { body: AUTH }, 'PUT /radio/bands/b_24': (call) => ({ body: { ...BAND, config: call.body } }) });
    const band = await api.radio.updateBand('b_24', {
      frequencyHz: 2_440_000_000,
      channelSpacingHz: 1_200_000,
      channel: 3,
      modulation: { kind: 'qpsk', chipRateKhz: 2000, rateMode: 4 },
      txPower: 20,
    });
    expect(calls.at(-1)!.body).toEqual({
      frequency_hz: 2_440_000_000,
      channel_spacing_hz: 1_200_000,
      channel: 3,
      modulation: { kind: 'qpsk', chip_rate_khz: 2000, rate_mode: 4 },
      tx_power: 20,
    });
    expect(band).toMatchObject({ id: 'b_24', module: 1, minHz: 2_400_000_000, usedBy: ['mesh'], config: { modulation: { kind: 'qpsk', chipRateKhz: 2000, rateMode: 4 } } });
  });

  it('maps a peer, its trust and its link', async () => {
    const { api } = makeApi({
      'GET /peers': {
        body: [
          wirePeer('dd', {
            list: 'whitelist',
            via_id: 'ee',
            hops: 2,
            tunnel_ip: '10.20.0.2',
            trust: { network: 'ours', is_admin: false, provisioning: null },
            link: { state: 'active', rtt_ms: 420, detail: null },
          }),
        ],
      },
    });
    const [peer] = await api.peers.list();
    expect(peer).toEqual<Peer>({
      id: 'dd',
      codename: 'kaondd',
      tag: '',
      online: true,
      firstSeenTs: 100,
      lastSeenTs: 200,
      list: 'whitelist',
      version: '1.0.0',
      hops: 2,
      viaId: 'ee',
      rssi: -70,
      rttMs: 420,
      tunnelIp: '10.20.0.2',
      trust: { network: 'ours', isAdmin: false, provisioning: null },
      link: { state: 'active', detail: null },
    });
  });

  it('sends setup in the hub’s words and signs in with the new token', async () => {
    const { api, calls } = makeApi({ 'POST /setup': { body: { ...AUTH, csrf_token: 'fresh' } }, 'POST /device/reboot': { status: 202 } });
    await api.auth.setup({ mode: 'admin', password: 'correct-horse', codename: 'kaon7qjt', seedPassword: 'a long enough seed phrase' });
    await api.device.reboot();
    expect(calls[0]!.body).toEqual({ mode: 'admin', password: 'correct-horse', codename: 'kaon7qjt', seed_password: 'a long enough seed phrase' });
    // The write after setup uses the token setup returned, without asking for one.
    expect(calls.map((call) => call.path)).toEqual(['/setup', '/device/reboot']);
    expect(calls[1]!.headers['X-Kaonic-CSRF']).toBe('fresh');
  });
});

describe('jobs', () => {
  it('runs a Wi-Fi scan as a job and answers with its result', async () => {
    const { api } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /network/wifi/scan': { status: 202, body: job('aaaa') },
      'GET /jobs/aaaa': [
        { body: job('aaaa', { state: 'running' }) },
        { body: job('aaaa', { state: 'done', result: { scanned_ts: 1000, networks: [{ ssid: 'Office', signal_dbm: -58, security: 'wpa2', frequency_mhz: 2437, saved: false }] } }) },
      ],
    });
    expect(await api.wifi.scan()).toEqual([{ ssid: 'Office', signalDbm: -58, security: 'wpa2', frequencyMhz: 2437, saved: false }]);
  });

  it('rejects with the job’s error when a scan fails', async () => {
    const { api } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /network/wifi/scan': { status: 202, body: job('bbbb', { state: 'failed', error: { code: 'busy', message: 'The radio is busy.' } }) },
    });
    await expect(api.wifi.scan()).rejects.toMatchObject({ message: 'The radio is busy.', reason: 'busy' });
  });

  it('starts one job per node and shows only jobs on nodes', async () => {
    const nodeJob = job('cccc', { kind: 'node_restart', node_id: 'dd', state: 'running', progress: 0.5, detail: 'Restarting' });
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /remote/jobs': { status: 202, body: { jobs: [nodeJob] } },
      'GET /jobs': { body: [job('aaaa'), nodeJob, job('eeee', { kind: 'node_update', node_id: 'ff', state: 'cancelled' })] },
    });

    const started = await api.nodes.restart(['dd']);
    expect(calls.at(-1)!.body).toEqual({ kind: 'node_restart', node_ids: ['dd'] });
    expect(started).toEqual([{ id: 'cccc', nodeId: 'dd', kind: 'restart', state: 'running', progress: 0.5, detail: 'Restarting', createdTs: 1000 }]);

    const jobs = await api.nodes.jobs();
    expect(jobs.map((item) => [item.id, item.state])).toEqual([
      ['cccc', 'running'],
      ['eeee', 'failed'],
    ]);
  });
});

describe('remote management', () => {
  it('sends talk settings to several nodes and renames one', async () => {
    const ptt = job('pppp', { kind: 'node_ptt', node_id: 'dd' });
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /remote/jobs': { status: 202, body: { jobs: [ptt] } },
      'PUT /peers/dd/remote/codename': { body: {} },
    });
    const started = await api.nodes.setPtt(['dd'], { relay: false, volume: 60 });
    expect(calls.at(-1)!.body).toEqual({ kind: 'node_ptt', node_ids: ['dd'], settings: { relay: false, volume: 60 } });
    expect(started[0]!.kind).toBe('ptt');
    await api.nodes.setCodename('dd', 'abcd1234');
    expect(calls.at(-1)!.body).toEqual({ codename: 'abcd1234' });
  });

  it('turns a node\'s uplink and gateway on over the mesh', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'PUT /peers/dd/remote/vpn/uplink': { body: { enabled: true, active: true, peer_id: 'aa', routes: ['0.0.0.0/0'], default_route: true, detail: 'Through aa.', gateways: [] } },
      'PUT /peers/ee/remote/vpn/gateway': { body: { enabled: true, active: true, egress_interface: 'wlan0', routes: ['0.0.0.0/0'], available_interfaces: ['wlan0'], detail: null } },
    });
    expect(await api.nodes.setUplink('dd', { enabled: true, peerId: 'aa', defaultRoute: true, routes: [] })).toMatchObject({ enabled: true, active: true, peerId: 'aa' });
    expect(calls.at(-1)!.body).toEqual({ enabled: true, peer_id: 'aa', default_route: true, routes: [] });
    expect(await api.nodes.setGateway('ee', { enabled: true, egressInterface: null, routes: ['0.0.0.0/0'] })).toMatchObject({ enabled: true, egressInterface: 'wlan0' });
    expect(calls.at(-1)!.body).toEqual({ enabled: true, egress_interface: null, routes: ['0.0.0.0/0'] });
  });

  it('opens a shell with a ticket bought with the password', async () => {
    const hub = fakeHub({ 'GET /auth/state': { body: AUTH }, 'POST /peers/dd/remote/shell/ticket': { body: { ticket: 'abc', expires_in_secs: 30 } } });
    const urls: string[] = [];
    const api = createHttpApi({ fetch: hub.fetch, WebSocket: FakeWebSocket, shellUrl: (id, query) => (urls.push(`${id}?${query}`), `wss://kaonic/shell`) });
    const opening = api.nodes.openShell('dd', 'secret', { cols: 90, rows: 30 }, { onOpen() {}, onOutput() {}, onClose() {} });
    await settle();
    expect(hub.calls.at(-1)!.body).toEqual({ password: 'secret' });
    expect(urls).toEqual(['dd?ticket=abc&cols=90&rows=30']);
    FakeSocket.last().open();
    await expect(opening).resolves.toBeDefined();
  });
});

describe('plugins and software', () => {
  const plugin = {
    id: 'audio-ptt',
    name: 'Push to talk',
    version: '0.3.0',
    description: 'Voice.',
    developer: 'Beechat Network',
    official: true,
    running: true,
    enabled: true,
    removable: true,
    has_icon: false,
    app_url: '/apps/audio-ptt/',
    channel: 'stable',
    url: null,
    permissions: ['audio', 'realtime'],
    service: 'kaonic-plugin-audio-ptt.service',
    installed_ts: 1000,
    highest_version: '0.3.0',
    previous_version: '0.2.1',
  } as const;

  it('maps plugins, their actions, removal with kept data and page tickets', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'GET /plugins': { body: [plugin] },
      'POST /plugins/audio-ptt/rollback': { body: { ...plugin, version: '0.2.1', previous_version: '0.3.0' } },
      'DELETE /plugins/audio-ptt?keep_data=true': { status: 204 },
      'POST /plugins/audio-ptt/open': { body: { url: '/apps/audio-ptt/~abc/', expires_in_secs: 43200 } },
    });

    expect(await api.plugins.list()).toEqual([
      {
        id: 'audio-ptt',
        name: 'Push to talk',
        version: '0.3.0',
        description: 'Voice.',
        developer: 'Beechat Network',
        official: true,
        running: true,
        enabled: true,
        removable: true,
        hasIcon: false,
        appUrl: '/apps/audio-ptt/',
        channel: 'stable',
        url: null,
        permissions: ['audio', 'realtime'],
        service: 'kaonic-plugin-audio-ptt.service',
        installedTs: 1000,
        highestVersion: '0.3.0',
        previousVersion: '0.2.1',
      },
    ]);
    expect(await api.plugins.act('audio-ptt', 'rollback')).toMatchObject({ version: '0.2.1', previousVersion: '0.3.0' });
    await api.plugins.remove('audio-ptt', true);
    expect(calls.at(-1)!.path).toBe('/plugins/audio-ptt?keep_data=true');
    expect(await api.plugins.open('audio-ptt')).toEqual({ url: '/apps/audio-ptt/~abc/', expiresInSecs: 43200 });
  });

  it('sends packages with the password and the downgrade switch', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /plugins': { body: { action: 'installed', plugin } },
      'PUT /plugins/audio-ptt/package': { status: 409, body: { code: 'downgrade', message: 'audio-ptt 0.1.0 is older than 0.3.0 installed before' } },
      'POST /plugin-check': { body: { id: 'audio-ptt', name: 'Push to talk', version: '0.4.0', developer: 'Beechat Network', description: 'Voice.', permissions: ['audio', 'root'], page: true, signed: false, installed: '0.3.0' } },
      'POST /software/hub': { status: 202, body: { id: 3, version: '1.5.0', state: 'running', message: '', started: 50, finished: null } },
    });
    const file = new File(['tar'], 'audio-ptt-0.3.0.kpkg');

    expect((await api.plugins.install(file, { password: 'pw' })).action).toBe('installed');
    expect(calls.at(-1)!.body).toEqual({ file: 'file:audio-ptt-0.3.0.kpkg', password: 'pw' });
    await expect(api.plugins.update('audio-ptt', file, { password: 'pw' })).rejects.toMatchObject({ code: 'conflict', reason: 'downgrade' });
    expect(await api.plugins.check(file)).toEqual({
      id: 'audio-ptt',
      name: 'Push to talk',
      version: '0.4.0',
      developer: 'Beechat Network',
      description: 'Voice.',
      permissions: ['audio', 'root'],
      hasPage: true,
      signed: false,
      installed: '0.3.0',
    });
    // The check needs no password.
    expect(calls.at(-1)!.body).toEqual({ file: 'file:audio-ptt-0.3.0.kpkg' });
    expect(await api.software.updateHub(file, { password: 'pw', allowDowngrade: true })).toEqual({ id: 3, version: '1.5.0', state: 'running', message: '', started: 50, finished: null });
    expect(calls.at(-1)!.body).toEqual({ file: 'file:audio-ptt-0.3.0.kpkg', password: 'pw', allow_downgrade: 'true' });
  });

  it('tells a stopped installer apart, and reads the policy, software and history', async () => {
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'GET /plugins': { status: 503, body: { code: 'installer_unavailable', message: 'The plugin installer is not running. Try again in a moment.' } },
      'GET /plugin-policy': { body: { require_signed: false, release_key: false } },
      'PUT /plugin-policy': { body: { require_signed: true } },
      'GET /software': {
        body: {
          hub: { version: '1.4.0', from_update: true },
          installer: { version: '1.0.2', reachable: true },
          core: [],
          programs: [{ id: 'kaonic-commd', name: 'Kaonic Radio Control', description: 'Drives the radios', running: true, version: '0.2.18', from_update: true }],
          hub_update: { id: 2, version: '1.5.0', state: 'failed', message: '1.5.0 did not come up; 1.4.0 is back', started: 10, finished: 140 },
          release_key: false,
        },
      },
      'GET /software/history?id=kaonic-hub&limit=5': { body: [{ time: 140, id: 'kaonic-hub', action: 'upgrade', outcome: 'rolled_back', from: '1.4.0', to: '1.5.0', signed: true, message: 'did not come up' }] },
    });

    await expect(api.plugins.list()).rejects.toMatchObject({ code: 'unavailable', reason: 'installer_unavailable' });
    expect(await api.plugins.policy()).toEqual({ requireSigned: false, releaseKey: false });
    expect(await api.plugins.setPolicy(true, 'pw')).toEqual({ requireSigned: true, releaseKey: null });
    expect(calls.at(-1)!.body).toEqual({ require_signed: true, password: 'pw' });
    expect(await api.software.state()).toEqual({
      hub: { version: '1.4.0', fromUpdate: true },
      installer: { version: '1.0.2', reachable: true },
      programs: [{ id: 'kaonic-commd', name: 'Kaonic Radio Control', description: 'Drives the radios', running: true, version: '0.2.18', fromUpdate: true }],
      hubUpdate: { id: 2, version: '1.5.0', state: 'failed', message: '1.5.0 did not come up; 1.4.0 is back', started: 10, finished: 140 },
      releaseKey: false,
    });
    expect(await api.software.history({ id: 'kaonic-hub', limit: 5 })).toEqual([
      { time: 140, id: 'kaonic-hub', action: 'upgrade', outcome: 'rolled_back', from: '1.4.0', to: '1.5.0', signed: true, actor: null, message: 'did not come up' },
    ]);
  });
});

describe('live topics', () => {
  afterEach(() => vi.useRealTimers());

  it('delivers Wi-Fi changes on the network socket topic', async () => {
    const { api } = makeApi({});
    const states: string[] = [];
    api.events.subscribe('wifi', (wifi) => states.push(wifi.client.state));
    api.events.subscribe('network', () => undefined);
    const socket = FakeSocket.last();
    socket.open();
    expect(socket.sent).toEqual([]);
    socket.event('network', 'wifi.changed', WIFI);
    socket.event('network', 'wifi.scan', { scanned_ts: 1, networks: [] });
    expect(states).toEqual(['connected']);
  });

  it('delivers band counters on the radio topic', async () => {
    const { api } = makeApi({});
    const seen: number[] = [];
    api.events.subscribe('radio', (stats) => seen.push(stats[0]!.driver.txDropped));
    const socket = FakeSocket.last();
    expect(socket.url).toBe('wss://kaonic/events?topics=radio');
    socket.open();
    socket.event('radio', 'radio.stats', [BAND_STATS]);
    socket.event('radio', 'radio.tdd', {});
    expect(seen).toEqual([43]);
  });

  it('converts single-payload events', async () => {
    const { api } = makeApi({});
    const seen: number[] = [];
    api.events.subscribe('metrics', (metrics) => seen.push(metrics.cpuPercent));
    const socket = FakeSocket.last();
    expect(socket.url).toBe('wss://kaonic/events?topics=metrics');
    socket.open();
    socket.event('metrics', 'metrics.system', { cpu_percent: 12, ram_used_mb: 1, ram_total_mb: 2, fs_free_mb: 3, fs_total_mb: 4, uptime_secs: 5, battery: null });
    socket.event('metrics', 'metrics.other', {});
    expect(seen).toEqual([12]);
  });

  it('keeps the peer list from a snapshot and per-peer events, and reads it again after a reconnect', async () => {
    vi.useFakeTimers();
    const { api, calls } = makeApi({ 'GET /peers': [{ body: [wirePeer('aa')] }, { body: [wirePeer('aa'), wirePeer('bb'), wirePeer('cc')] }] });
    const lists: string[][] = [];
    const stop = api.events.subscribe('peers', (peers) => lists.push(peers.map((peer) => peer.id)));

    const first = FakeSocket.last();
    first.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(lists.at(-1)).toEqual(['aa']);

    first.event('peers', 'peer.updated', wirePeer('bb'));
    expect(lists.at(-1)).toEqual(['aa', 'bb']);
    first.event('peers', 'peer.removed', { id: 'aa' });
    expect(lists.at(-1)).toEqual(['bb']);

    // The socket drops: events may have been missed, so the list is read again once it is back.
    first.drop();
    expect(api.events.connection()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    const second = FakeSocket.last();
    expect(second).not.toBe(first);
    second.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(lists.at(-1)).toEqual(['aa', 'bb', 'cc']);
    expect(calls.filter((call) => call.path === '/peers')).toHaveLength(2);

    stop();
  });

  it('applies events that arrive while the snapshot is loading after it', async () => {
    let answer: (() => void) | null = null;
    const slow = createHttpApi({
      fetch: () => new Promise<Response>((resolve) => (answer = () => resolve(new Response(JSON.stringify([wirePeer('aa')]))))),
      WebSocket: FakeWebSocket,
      eventsUrl: () => 'wss://x',
    });
    const lists: string[][] = [];
    slow.events.subscribe('peers', (peers) => lists.push(peers.map((peer) => peer.id)));
    const socket = FakeSocket.last();
    socket.open();
    socket.event('peers', 'peer.updated', wirePeer('bb'));
    expect(lists).toEqual([]);
    answer!();
    await settle();
    expect(lists.at(-1)).toEqual(['aa', 'bb']);
  });

  it('stops for good when the session ends, and starts again after a sign-in', async () => {
    const { api } = makeApi({ 'POST /auth/login': { body: AUTH } });
    const states: string[] = [];
    api.events.onConnectionChange((state) => states.push(state));
    api.events.subscribe('network', () => undefined);

    FakeSocket.last().open();
    FakeSocket.last().drop(4401);
    expect(api.events.connection()).toBe('closed');
    expect(FakeSocket.made).toHaveLength(1);

    await api.auth.login('correct-horse');
    expect(FakeSocket.made).toHaveLength(2);
    FakeSocket.last().open();
    expect(states).toEqual(['open', 'closed', 'connecting', 'open']);
  });
  it('sends test messages and moves the mesh radio with the hub\'s paths and names', async () => {
    const run = { running: true, sent: 0, failed: 0, bytes: 3, interval_ms: 1000, count: null, started_ts_ms: 7, last_error: null };
    const { api, calls } = makeApi({
      'GET /auth/state': { body: AUTH },
      'POST /radio/bands/a_sub/test': { body: run },
      'GET /radio/bands/b_sub/test': { body: { running: false } },
      'POST /radio/bands/a_sub/test/stop': { body: { ...run, running: false, sent: 4 } },
      'PUT /radio/mesh': { body: { module: 1, interface: 'rf09_b', restarting: true } },
    });
    expect(await api.radio.startTest('a_sub', { message: '4b414f', format: 'hex', intervalMs: 1000 })).toMatchObject({ running: true, intervalMs: 1000, startedAt: 7 });
    expect(calls.at(-1)!.body).toEqual({ message: '4b414f', format: 'hex', interval_ms: 1000 });
    expect(await api.radio.test('b_sub')).toBeNull();
    expect(await api.radio.stopTest('a_sub')).toMatchObject({ running: false, sent: 4 });
    expect(await api.radio.setMeshRadio(1)).toMatchObject({ interface: 'rf09_b', restarting: true });
    expect(calls.at(-1)!.body).toEqual({ module: 1 });
  });
});
