import type { HubApi } from '../client';
import { ApiError } from '../errors';
import type { HubEvents, HubTopic, NodeJob, PackageUpload, Peer, PttKeyResult, WifiScanEntry } from '../types';
import {
  fromRadioConfig,
  fromAdminSecret,
  fromSetupInput,
  toAuthState,
  toBand,
  toRadioTest,
  fromRadioTestRequest,
  toBandStats,
  toDevice,
  toFrame,
  toMetrics,
  toNetwork,
  toNodeDetails,
  toNodeJob,
  fromPttSettings,
  toPacket,
  toPeer,
  toPtt,
  toPttDevices,
  toPttSession,
  toPttSettings,
  toPttTestWav,
  toHubUpdate,
  toPlugin,
  toPluginPolicy,
  toSoftware,
  toSoftwareEvent,
  toScanEntry,
  toScanResults,
  toService,
  toTraffic,
  toVpn,
  toVpnCapture,
  toVpnCapturedPacket,
  toVpnPacket,
  toWifi,
  fromVpnGateway,
  fromVpnSharePatch,
  fromVpnUplink,
  toVpnGateway,
  toVpnUplink,
} from './convert';
import { toBootImage, toBootJob, toBootStaged, toBootState, toOsJob, toOsState, type WireBootImage, type WireBootStaged, type WireBootJob, type WireBootState, type WireOsState } from './boot';
import { createEventStream, type EventStream } from './events';
import { createPttAudioSocket } from './pttAudio';
import { createRemoteShell } from './remoteShell';
import { BASE_URL, createTransport, type Transport } from './request';
import type {
  WireAuthState,
  WireRadioTest,
  WireDevice,
  WireEvent,
  WireJob,
  WireMeshPacket,
  WireNetworkPatch,
  WireNetworkState,
  WirePeer,
  WireHubJob,
  WirePlugin,
  WirePluginCheck,
  WirePluginPolicy,
  WirePluginTicket,
  WireSoftware,
  WireSoftwareEvent,
  WirePttDevices,
  WirePttSession,
  WirePttSettings,
  WirePttState,
  WirePttTestWav,
  WireRadioBand,
  WireRadioBandStats,
  WireRadioFrame,
  WireRemoteDevice,
  WireRemoteJobsInput,
  WireServiceStatus,
  WireSetupIdentity,
  WireSystemMetrics,
  WireTopic,
  WireTrafficSample,
  WireUpdates,
  WireVpnCapture,
  WireVpnCapturedPacket,
  WireVpnPacket,
  WireVpnState,
  WireWifiConfig,
  WireWifiScanResults,
  WireVpnGateway,
  WireVpnUplink,
} from './wire';

/*
 * `HubApi` over the hub's REST API and events WebSocket
 * (`kaonic-hub/docs/api/hub-api.yaml`).
 *
 * - The CSRF token comes with the auth state and is kept in memory, never in
 *   storage. A write made before it is known fetches it first, and a write the
 *   hub refuses for a stale token is retried once with a fresh one.
 * - Live topics whose payload is a whole list (peers, jobs) are kept as a
 *   snapshot plus the hub's per-item events, and re-read after every reconnect.
 */

export interface HttpApiOptions {
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  /** Where the events socket connects; defaults to this page's host. */
  eventsUrl?: (topics: string[]) => string;
  /** Where the push-to-talk audio socket connects; defaults to this page's host. */
  pttAudioUrl?: () => string;
  /** Where a remote shell's socket connects; defaults to this page's host. */
  shellUrl?: (nodeId: string, query: string) => string;
  /** How often a Wi-Fi scan job is polled, and for how long. */
  scanPollMs?: number;
  scanTimeoutMs?: number;
}

const path = (strings: TemplateStringsArray, ...params: string[]) =>
  strings.reduce((out, part, index) => out + part + (index < params.length ? encodeURIComponent(params[index]!) : ''), '');

function defaultPttAudioUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${BASE_URL}/ptt/audio`;
}

function defaultShellUrl(nodeId: string, query: string): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${BASE_URL}${path`/peers/${nodeId}/remote/shell`}?${query}`;
}

function defaultEventsUrl(topics: string[]): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = topics.length > 0 ? `?topics=${topics.map(encodeURIComponent).join(',')}` : '';
  return `${scheme}//${location.host}${BASE_URL}/events${query}`;
}

/** Installs check, unpack and start the plugin and wait for it to stay up (30 s on the device). */
const SLOW_MS = 120_000;
/** An installer update waits up to two minutes for the new installer, then puts the old one back. */
const INSTALLER_UPDATE_MS = 180_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A list kept fresh from the events stream: loaded once, then changed one item
 * at a time by the hub's events, and read again whenever events may have been
 * missed. Listeners always get the whole list.
 */
function liveList<T extends { id: string }>(
  stream: EventStream,
  topic: WireTopic,
  load: () => Promise<T[]>,
  apply: (items: Map<string, T>, event: WireEvent) => boolean,
) {
  const listeners = new Set<(items: T[]) => void>();
  let items: Map<string, T> | null = null;
  let loading = 0;
  let pending: WireEvent[] = [];
  let stops: Array<() => void> = [];

  const emit = () => {
    if (!items) return;
    const list = [...items.values()];
    listeners.forEach((listener) => listener(list));
  };

  const onEvent = (event: WireEvent) => {
    if (loading > 0 || !items) {
      pending.push(event);
      return;
    }
    if (apply(items, event)) emit();
  };

  async function reload() {
    const generation = (loading += 1);
    try {
      const loaded = await load();
      if (generation !== loading) return;
      items = new Map(loaded.map((item) => [item.id, item]));
    } catch {
      // Keep what we had; the next reconnect or resync tries again.
      if (generation !== loading) return;
      items ??= new Map();
    }
    loading = 0;
    const missed = pending;
    pending = [];
    missed.forEach((event) => apply(items!, event));
    emit();
  }

  return (listener: (items: T[]) => void) => {
    listeners.add(listener);
    if (listeners.size === 1) {
      stops = [stream.subscribe(topic, onEvent), stream.onResync(() => void reload())];
      // A socket that is already open will not resync for us: read now.
      if (stream.state() === 'open') void reload();
    } else if (items) {
      listener([...items.values()]);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      stops.forEach((stop) => stop());
      stops = [];
      items = null;
      pending = [];
      loading = 0;
    };
  };
}

export function createHttpApi(options: HttpApiOptions = {}): HubApi {
  const transport: Transport = createTransport({ fetch: options.fetch });
  const stream = createEventStream({ url: options.eventsUrl ?? defaultEventsUrl, WebSocket: options.WebSocket });
  const scanPollMs = options.scanPollMs ?? 1000;
  const scanTimeoutMs = options.scanTimeoutMs ?? 30_000;

  const get = <T>(url: string) => transport.request<T>('GET', url);

  async function authState(): Promise<WireAuthState> {
    const state = await get<WireAuthState>('/auth/state');
    transport.setCsrfToken(state.csrf_token);
    return state;
  }

  /** A request that changes something: needs the session's CSRF token. */
  async function write<T>(method: string, url: string, body?: unknown, requestOptions?: { timeoutMs?: number }): Promise<T> {
    if (!transport.csrfToken()) await authState();
    try {
      return await transport.request<T>(method, url, body, requestOptions);
    } catch (error) {
      // Signed in again in another tab: the token rotated. Fetch it and try once more.
      if (!(error instanceof ApiError) || error.reason !== 'csrf_failed') throw error;
      await authState();
      return transport.request<T>(method, url, body, requestOptions);
    }
  }

  /** A package upload: the file, the password again, and the downgrade switch when set. */
  function packageForm(file: File, upload: PackageUpload): FormData {
    const form = new FormData();
    form.append('file', file);
    form.append('password', upload.password);
    if (upload.allowDowngrade) form.append('allow_downgrade', 'true');
    return form;
  }

  /** Keying: a taken floor (409) is an answer, not an error. */
  async function floorRequest(send: () => Promise<void>): Promise<PttKeyResult> {
    try {
      await send();
      return { keyed: true };
    } catch (error) {
      if (error instanceof ApiError && (error.code === 'conflict' || error.reason === 'ptt_busy')) return { keyed: false, reason: error.message };
      throw error;
    }
  }

  /** Signed in: remember the new token and (re)start live updates. */
  function signedIn(state: WireAuthState) {
    transport.setCsrfToken(state.csrf_token);
    stream.resume();
  }

  function signedOut() {
    transport.setCsrfToken(null);
    stream.stop();
  }

  async function waitForJob(job: WireJob): Promise<WireJob> {
    const deadline = Date.now() + scanTimeoutMs;
    let current = job;
    while (current.state === 'queued' || current.state === 'running') {
      if (Date.now() > deadline) throw new ApiError('unavailable', 'The device took too long to answer. Try again.');
      await sleep(scanPollMs);
      current = await get<WireJob>(path`/jobs/${current.id}`);
    }
    if (current.state !== 'done') {
      throw new ApiError('unavailable', current.error?.message ?? current.detail ?? 'The device could not finish this.', {}, current.error?.code ?? null);
    }
    return current;
  }

  const startJobs = async (input: WireRemoteJobsInput): Promise<NodeJob[]> => {
    const { jobs } = await write<{ jobs: WireJob[] }>('POST', '/remote/jobs', input);
    return jobs.map(toNodeJob).filter((job): job is NodeJob => job !== null);
  };
  const loadNodeJobs = async () => (await get<WireJob[]>('/jobs')).map(toNodeJob).filter((job): job is NodeJob => job !== null);

  /* ── live topics ── */

  const livePeers = liveList<Peer>(
    stream,
    'peers',
    async () => (await get<WirePeer[]>('/peers')).map(toPeer),
    (items, event) => {
      if (event.type === 'peer.updated') {
        const peer = toPeer(event.data as WirePeer);
        items.set(peer.id, peer);
        return true;
      }
      if (event.type === 'peer.removed') return items.delete((event.data as { id: string }).id);
      return false;
    },
  );

  const liveJobs = liveList<NodeJob>(stream, 'jobs', loadNodeJobs, (items, event) => {
    if (event.type !== 'job.updated') return false;
    const job = toNodeJob(event.data as WireJob);
    if (!job) return false;
    items.set(job.id, job);
    return true;
  });

  /** Topics where one event carries the whole payload. */
  const SIMPLE: { [T in Exclude<HubTopic, 'peers' | 'jobs'>]: { topic: WireTopic; type: string; convert: (data: never) => HubEvents[T] } } = {
    metrics: { topic: 'metrics', type: 'metrics.system', convert: (data: WireSystemMetrics) => toMetrics(data) },
    traffic: { topic: 'traffic', type: 'traffic.sample', convert: (data: WireTrafficSample) => toTraffic(data) },
    frames: { topic: 'frames', type: 'radio.frames', convert: (data: WireRadioFrame[]) => data.map(toFrame) },
    radio: { topic: 'radio', type: 'radio.stats', convert: (data: WireRadioBandStats[]) => data.map(toBandStats) },
    vpn: { topic: 'vpn', type: 'vpn.state', convert: (data: WireVpnState) => toVpn(data) },
    packets: { topic: 'packets', type: 'mesh.packets', convert: (data: WireMeshPacket[]) => data.map(toPacket) },
    network: { topic: 'network', type: 'network.changed', convert: (data: WireNetworkState) => toNetwork(data) },
    wifi: { topic: 'network', type: 'wifi.changed', convert: (data: WireWifiConfig) => toWifi(data) },
    ptt: { topic: 'ptt', type: 'ptt.state', convert: (data: WirePttState) => toPtt(data) },
    pttLevel: { topic: 'ptt', type: 'ptt.level', convert: (data: { level: number }) => data.level },
  };

  return {
    auth: {
      state: async () => toAuthState(await authState()),
      bootIdentity: async () => (await get<WireSetupIdentity>('/setup/identity')).identity_hash,
      deriveIdentity: async (secret) =>
        (await transport.request<{ identity_hash: string }>('POST', '/setup/derive-identity', fromAdminSecret(secret))).identity_hash,
      newSeedPhrase: async (words) => (await transport.request<{ words: string[] }>('POST', '/setup/seed-phrase', { words })).words,
      wordlist: () => get<string[]>('/setup/wordlist'),
      async setup(input) {
        signedIn(await transport.request<WireAuthState>('POST', '/setup', fromSetupInput(input)));
      },
      async login(password) {
        signedIn(await transport.request<WireAuthState>('POST', '/auth/login', { password }));
      },
      forgotMethods: async () => {
        const wire = await transport.request<{ usb: boolean; seed: boolean; set_up: boolean }>('GET', '/auth/forgot');
        return { usb: wire.usb, seed: wire.seed, setUp: wire.set_up };
      },
      async forgotReset(input) {
        const body = input.method === 'usb' ? { method: 'usb', serial: input.serial, confirm: input.confirm } : { method: 'seed', ...fromAdminSecret(input), confirm: input.confirm };
        await transport.request<void>('POST', '/auth/forgot/factory-reset', body);
      },
      async logout() {
        try {
          await write<void>('POST', '/auth/logout');
        } finally {
          signedOut();
        }
      },
    },

    device: {
      get: async () => toDevice(await get<WireDevice>('/device')),
      reboot: () => write<void>('POST', '/device/reboot', { mode: 'normal' }),
      async factoryReset(password) {
        await write<void>('POST', '/device/factory-reset', { password });
        signedOut();
      },
    },

    system: {
      report: async () => (await transport.download('/system/report')).text(),
      metrics: async () => toMetrics(await get<WireSystemMetrics>('/system/metrics')),
      services: async () => (await get<{ services: WireServiceStatus[] }>('/system/services')).services.map(toService),
      restartService: async (unit) => toService(await write<WireServiceStatus>('POST', path`/system/services/${unit}/restart`)),
      boot: async (refresh) => toBootState(await get<WireBootState>(refresh ? '/system/boot?refresh=true' : '/system/boot')),
      setBootNext: async (slot, mode, password) => toBootState(await write<WireBootState>('PUT', '/system/boot/next', { slot, mode, password })),
      uploadBootImage: async (kind, file) =>
        toBootImage(await write<WireBootImage>('POST', `/system/boot/kernel/upload?kind=${kind}`, new Blob([file], { type: 'application/octet-stream' }))),
      stagedBoot: async () => toBootStaged(await get<WireBootStaged>('/system/boot/kernel/staged')),
      discardStagedBoot: async () => {
        await write<void>('DELETE', '/system/boot/kernel/staged');
      },
      installKernel: async (installOptions) =>
        toBootJob(
          await write<WireBootJob>('POST', '/system/boot/kernel/install', {
            password: installOptions.password,
            ...(installOptions.slot ? { slot: installOptions.slot } : {}),
            prepare: installOptions.prepare ?? 'auto',
            allow_missing_modules: installOptions.allowMissingModules ?? false,
          }),
        ),
      bootJob: async (id) => toBootJob(await get<WireBootJob>(path`/jobs/${id}`)),
      os: async () => toOsState(await get<WireOsState>('/system/os')),
      uploadOs: async (file, onProgress) => {
        if (!transport.csrfToken()) await authState();
        return toOsJob(await transport.upload<WireBootJob>('/system/os/upload', file, onProgress));
      },
      discardOs: async () => {
        await write<void>('DELETE', '/system/os/upload');
      },
      installOs: async (password) => toOsJob(await write<WireBootJob>('POST', '/system/os/install', { password })),
      osJob: async (id) => toOsJob(await get<WireBootJob>(path`/jobs/${id}`)),
    },

    ui: {
      pages: async () => (await get<{ shown: string[] | null }>('/ui/pages')).shown,
      setPages: async (shown) => (await write<{ shown: string[] | null }>('PUT', '/ui/pages', { shown })).shown,
    },
    network: {
      get: async () => toNetwork(await get<WireNetworkState>('/network')),
      setSource: async (id, enabled) => toNetwork(await write<WireNetworkState>('PATCH', '/network', { sources: { [id]: enabled } } satisfies WireNetworkPatch)),
      setConsumer: async (id, enabled) =>
        toNetwork(await write<WireNetworkState>('PATCH', '/network', { consumers: { [id]: enabled } } satisfies WireNetworkPatch)),
    },

    wifi: {
      get: async () => toWifi(await get<WireWifiConfig>('/network/wifi')),
      lastScan: async () => toScanResults(await get<WireWifiScanResults>('/network/wifi/scan')),
      async scan(): Promise<WifiScanEntry[]> {
        const job = await waitForJob(await write<WireJob>('POST', '/network/wifi/scan'));
        const results = (job.result ?? { scanned_ts: null, networks: [] }) as WireWifiScanResults;
        return results.networks.map(toScanEntry);
      },
      join: async (network) =>
        toWifi(await write<WireWifiConfig>('POST', '/network/wifi/networks', { ssid: network.ssid, password: network.password, hidden: network.hidden ?? false })),
      connect: async (ssid) => toWifi(await write<WireWifiConfig>('POST', path`/network/wifi/networks/${ssid}/connect`)),
      update: async (ssid, patch) => {
        const body: { password?: string | null; auto_connect?: boolean } = {};
        if (patch.password !== undefined) body.password = patch.password;
        if (patch.autoConnect !== undefined) body.auto_connect = patch.autoConnect;
        return toWifi(await write<WireWifiConfig>('PATCH', path`/network/wifi/networks/${ssid}`, body));
      },
      forget: async (ssid) => toWifi(await write<WireWifiConfig>('DELETE', path`/network/wifi/networks/${ssid}`)),
      reorder: async (ssids) => toWifi(await write<WireWifiConfig>('PUT', '/network/wifi/order', { ssids })),
      unpin: async () => toWifi(await write<WireWifiConfig>('DELETE', '/network/wifi/pin')),
      setHotspot: async (config) => toWifi(await write<WireWifiConfig>('PUT', '/network/wifi/hotspot', { ssid: config.ssid, password: config.password })),
    },

    radio: {
      bands: async () => (await get<WireRadioBand[]>('/radio/bands')).map(toBand),
      updateBand: async (id, config) => toBand(await write<WireRadioBand>('PUT', path`/radio/bands/${id}`, fromRadioConfig(config))),
      updateBandEverywhere: async (id, config) => {
        const result = await write<{ switch_at_ts_ms: number; nodes: number }>('PUT', `${path`/radio/bands/${id}`}?scope=network`, fromRadioConfig(config));
        return { switchAt: result.switch_at_ts_ms, nodes: result.nodes };
      },
      setBandFilter: async (id, filter) => toBand(await write<WireRadioBand>('PUT', path`/radio/bands/${id}/filter`, { filter })),
      startTest: async (id, request) => {
        const test = toRadioTest(await write<WireRadioTest>('POST', path`/radio/bands/${id}/test`, fromRadioTestRequest(request)));
        if (!test) throw new ApiError('internal', 'The hub did not say how the test went.');
        return test;
      },
      test: async (id) => toRadioTest(await get<WireRadioTest>(path`/radio/bands/${id}/test`)),
      stopTest: async (id) => toRadioTest(await write<WireRadioTest>('POST', path`/radio/bands/${id}/test/stop`, {})),
      setMeshRadio: async (module) => await write<{ module: number; interface: string; restarting: boolean }>('PUT', '/radio/mesh', { module }),
      stats: async () => (await get<WireRadioBandStats[]>('/radio/stats')).map(toBandStats),
      async frames(options = {}) {
        const query = new URLSearchParams();
        if (options.band) query.set('band', options.band);
        if (options.limit !== undefined) query.set('limit', String(options.limit));
        const search = query.size > 0 ? `?${query.toString()}` : '';
        return (await get<WireRadioFrame[]>(`/radio/frames${search}`)).map(toFrame);
      },
    },

    vpn: {
      get: async () => toVpn(await get<WireVpnState>('/vpn')),
      packets: async (limit) => (await get<WireVpnPacket[]>(limit === undefined ? '/vpn/packets' : `/vpn/packets?limit=${limit}`)).map(toVpnPacket),
      capture: async () => toVpnCapture(await get<WireVpnCapture>('/vpn/capture')),
      startCapture: async (options = {}) =>
        toVpnCapture(
          await write<WireVpnCapture>('POST', '/vpn/capture', {
            ...(options.snaplen !== undefined ? { snaplen: options.snaplen } : {}),
            ...(options.maxPackets !== undefined ? { max_packets: options.maxPackets } : {}),
            ...(options.maxSecs !== undefined ? { max_secs: options.maxSecs } : {}),
            ...(options.ring !== undefined ? { ring: options.ring } : {}),
          }),
        ),
      stopCapture: async () => toVpnCapture(await write<WireVpnCapture>('POST', '/vpn/capture/stop')),
      capturePackets: async (after, limit = 500) => (await get<WireVpnCapturedPacket[]>(`/vpn/capture/packets?after=${after}&limit=${limit}`)).map(toVpnCapturedPacket),
      capturePcap: () => transport.download('/vpn/capture.pcap'),
      updateSettings: async (patch) => toVpn(await write<WireVpnState>('PATCH', '/vpn/settings', fromVpnSharePatch(patch))),
      setRoutes: async (advertised) => {
        await write<unknown>('PUT', '/vpn/routes', { advertised });
      },
      setUplink: async (input) => toVpnUplink(await write<WireVpnUplink>('PUT', '/vpn/uplink', fromVpnUplink(input))),
      setGateway: async (input) => toVpnGateway(await write<WireVpnGateway>('PUT', '/vpn/gateway', fromVpnGateway(input))),
    },

    ptt: {
      get: async () => toPtt(await get<WirePttState>('/ptt')),
      updateSettings: async (patch) => toPttSettings(await write<WirePttSettings>('PATCH', '/ptt/settings', fromPttSettings(patch))),
      testTone: async () => {
        await write<void>('POST', '/ptt/test-tone');
      },
      createSession: async () => toPttSession(await write<WirePttSession>('POST', '/ptt/sessions', { transport: 'udp' })),
      devices: async () => toPttDevices(await get<WirePttDevices>('/ptt/devices')),
      key: () => floorRequest(() => write<void>('POST', '/ptt/key')),
      unkey: async () => {
        await write<void>('POST', '/ptt/unkey');
      },
      testWav: async () => {
        const wav = await get<WirePttTestWav | null>('/ptt/test/wav');
        return wav ? toPttTestWav(wav) : null;
      },
      uploadTestWav: async (file) => toPttTestWav(await write<WirePttTestWav>('PUT', '/ptt/test/wav', file.type ? file : new Blob([file], { type: 'audio/wav' }))),
      deleteTestWav: async () => {
        await write<void>('DELETE', '/ptt/test/wav');
      },
      startTestTx: (txOptions) => floorRequest(() => write<void>('POST', '/ptt/test/tx', { source: txOptions.source, loop: txOptions.loop })),
      stopTestTx: async () => {
        await write<void>('POST', '/ptt/test/tx/stop');
      },
      audio: (audioOptions, handlers) =>
        createPttAudioSocket({ url: (options.pttAudioUrl ?? defaultPttAudioUrl)(), listen: audioOptions.listen, WebSocket: options.WebSocket }, handlers),
    },

    peers: {
      list: async () => (await get<WirePeer[]>('/peers')).map(toPeer),
      setList: async (id, list) => toPeer(await write<WirePeer>('PUT', path`/peers/${id}/list`, { list })),
    },

    nodes: {
      details: async (id) => toNodeDetails(await get<WireRemoteDevice>(path`/peers/${id}/remote/device`)),
      async release() {
        const { release } = await get<WireUpdates>('/updates');
        if (!release) throw new ApiError('not_found', 'This device holds no software release to hand out.');
        return { version: release.version, sizeBytes: release.size_bytes };
      },
      jobs: loadNodeJobs,
      updateSoftware: (ids) => startJobs({ kind: 'node_update', node_ids: ids }),
      restart: (ids) => startJobs({ kind: 'node_restart', node_ids: ids }),
      setRadio: (ids, band, config) => startJobs({ kind: 'node_radio', node_ids: ids, band, config: fromRadioConfig(config) }),
      setPtt: (ids, settings) => startJobs({ kind: 'node_ptt', node_ids: ids, settings: fromPttSettings(settings) }),
      async setCodename(id, codename) {
        await write<unknown>('PUT', path`/peers/${id}/remote/codename`, { codename });
      },
      setUplink: async (id, input) => toVpnUplink(await write<WireVpnUplink>('PUT', path`/peers/${id}/remote/vpn/uplink`, fromVpnUplink(input))),
      setGateway: async (id, input) => toVpnGateway(await write<WireVpnGateway>('PUT', path`/peers/${id}/remote/vpn/gateway`, fromVpnGateway(input))),
      async openShell(id, password, size, handlers) {
        // The password buys a one-time ticket; the socket carries it, as it cannot carry the CSRF header.
        const { ticket } = await write<{ ticket: string }>('POST', path`/peers/${id}/remote/shell/ticket`, { password });
        const query = `ticket=${encodeURIComponent(ticket)}&cols=${size.cols}&rows=${size.rows}`;
        return createRemoteShell({ url: (options.shellUrl ?? defaultShellUrl)(id, query), WebSocket: options.WebSocket }, handlers);
      },
    },

    plugins: {
      list: async () => (await get<WirePlugin[]>('/plugins')).map(toPlugin),
      act: async (id, action) => toPlugin(await write<WirePlugin>('POST', path`/plugins/${id}/${action}`)),
      async install(file, upload) {
        const result = await write<{ action: 'installed' | 'updated'; plugin: WirePlugin }>('POST', '/plugins', packageForm(file, upload), { timeoutMs: SLOW_MS });
        return { action: result.action, plugin: toPlugin(result.plugin) };
      },
      update: async (id, file, upload) => toPlugin(await write<WirePlugin>('PUT', path`/plugins/${id}/package`, packageForm(file, upload), { timeoutMs: SLOW_MS })),
      async remove(id, keepData) {
        await write<unknown>('DELETE', path`/plugins/${id}` + (keepData ? '?keep_data=true' : ''));
      },
      async open(id) {
        const ticket = await write<WirePluginTicket>('POST', path`/plugins/${id}/open`);
        return { url: ticket.url, expiresInSecs: ticket.expires_in_secs };
      },
      async check(file) {
        const form = new FormData();
        form.append('file', file);
        const info = await write<WirePluginCheck>('POST', '/plugin-check', form, { timeoutMs: SLOW_MS });
        return {
          id: info.id,
          name: info.name,
          version: info.version,
          developer: info.developer,
          description: info.description ?? '',
          permissions: info.permissions ?? [],
          hasPage: info.page,
          signed: info.signed,
          installed: info.installed ?? null,
        };
      },
      policy: async () => toPluginPolicy(await get<WirePluginPolicy>('/plugin-policy')),
      // The answer to a change does not say whether there is a release key: the caller keeps what it knew.
      setPolicy: async (requireSigned, password) => toPluginPolicy(await write<WirePluginPolicy>('PUT', '/plugin-policy', { require_signed: requireSigned, password })),
    },

    software: {
      state: async () => toSoftware(await get<WireSoftware>('/software')),
      updateHub: async (file, upload) => toHubUpdate(await write<WireHubJob>('POST', '/software/hub', packageForm(file, upload), { timeoutMs: SLOW_MS })),
      async updateInstaller(file, upload) {
        // The hub answers once the new installer is up, or the old one is back: up to two minutes.
        const record = await write<{ version?: string }>('POST', '/software/installer', packageForm(file, upload), { timeoutMs: INSTALLER_UPDATE_MS });
        return { version: record.version ?? '' };
      },
      async updateProgram(id, file, upload) {
        // The hub answers once the program runs the update, or the old one is back: up to two minutes.
        const record = await write<{ version?: string }>('POST', path`/software/core/${id}`, packageForm(file, upload), { timeoutMs: INSTALLER_UPDATE_MS });
        return { version: record.version ?? '' };
      },
      async history(filter = {}) {
        const query = new URLSearchParams();
        if (filter.id) query.set('id', filter.id);
        if (filter.limit !== undefined) query.set('limit', String(filter.limit));
        const search = query.toString();
        return (await get<WireSoftwareEvent[]>(`/software/history${search ? `?${search}` : ''}`)).map(toSoftwareEvent);
      },
    },

    events: {
      subscribe<T extends HubTopic>(topic: T, handler: (payload: HubEvents[T]) => void): () => void {
        if (topic === 'peers') return livePeers(handler as (payload: Peer[]) => void);
        if (topic === 'jobs') return liveJobs(handler as (payload: NodeJob[]) => void);
        const spec = SIMPLE[topic as keyof typeof SIMPLE];
        return stream.subscribe(spec.topic, (event) => {
          if (event.type === spec.type) handler((spec.convert as (data: unknown) => HubEvents[T])(event.data));
        });
      },
      connection: () => stream.state(),
      onConnectionChange: (handler) => stream.onStateChange(handler),
    },
  };
}
