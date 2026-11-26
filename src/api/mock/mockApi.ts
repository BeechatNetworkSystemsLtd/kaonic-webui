import { createMockBoot } from './mockBoot';
import { createMockCapture } from './mockVpnCapture';
import type { ConnectionState, HubApi } from '../client';
import { ApiError } from '../errors';
import type {
  AdminSecret,
  CoreProgramId,
  BootMode,
  BootSlotId,
  ConsumerId,
  HubEvents,
  HotspotConfig,
  KernelInstallOptions,
  BandId,
  HubTopic,
  MeshPacket,
  Modulation,
  NetworkConsumer,
  NetworkSource,
  NetworkState,
  NodeDetails,
  NodeSharing,
  VpnGateway,
  VpnUplink,
  NodeJob,
  NodeList,
  Peer,
  PackageUpload,
  PluginAction,
  RadioBand,
  RadioBandStats,
  RadioConfig,
  RadioFrame,
  FrameKind,
  SetupMode,
  SoftwareRelease,
  SourceId,
  SystemMetrics,
  RemotePttSettings,
  PttSettings,
  TrafficChannelId,
  TrafficSample,
  VpnPacket,
  VpnState,
  SavedWifiNetwork,
  WifiClient,
  WifiConfig,
  WifiNetworkInput,
  WifiNetworkPatch,
  WifiScanEntry,
  VpnCaptureOptions,
  VpnRemoteRoute,
  VpnGatewayInput,
  VpnShareSettings,
  VpnSharePatch,
  VpnUplinkInput,
} from '../types';
import { maxTxPower, testPayload, testProblems } from '../radioLimits';
import { checkAdvertised, checkGateway, checkSharePatch, checkUplink, type FieldErrors } from '../vpnShare';
import { createMockPtt } from './mockPtt';
import { createMockShell } from './mockShell';
import { DEFAULT_PTT_SETTINGS } from '../pttSettings';
import { createMockPlugins } from './mockPlugins';
import { DEFAULT_SWITCHES, seedPeers, seedRadio, seedServices } from './seed';
import { generatePhrase, normalisePhrase, phraseProblem, WORDS } from './phrase';

/*
 * An in-browser stand-in for the hub. It keeps enough state to walk through
 * every screen: setup, login, toggling the network, provisioning nodes, plugins.
 * It follows the hub's rules (`kaonic-hub/docs/api`), so what works here works
 * against a real device.
 *
 * Provisioning and the session survive a reload (localStorage). "Factory reset"
 * on the System page clears them, which brings the provisioning flow back.
 */

/** The part of Web Storage the mock uses, so tests can pass their own. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MockOptions {
  /** Artificial delay per call, in ms. */
  latencyMs?: number;
  storage?: KeyValueStore;
  /** Interval of the live topics, in ms. */
  tickMs?: number;
  /** False: a development device, without a release key. */
  releaseKey?: boolean;
  /** False: the plugin installer is not running. */
  installerRunning?: boolean;
  /** How long a hub update takes to restart the hub, in ms. */
  hubRestartMs?: number;
}

/** The mock device's serial number, as on its label. */
const MOCK_SERIAL = 'K1S-30-004217';

interface Persisted {
  /** Null: the UI opens without a password. */
  password: string | null;
  codename: string;
  /** Absent in state saved before provisioning modes existed: the boot identity then stands in. */
  identityHash?: string;
  /** Absent in older saved state, which then counts as an admin device. */
  mode?: SetupMode;
  loggedIn: boolean;
}

const STORAGE_KEY = 'kaonic-mock-v1';
/** The identity a fresh device generates on first boot. Kept apart from the rest, and replaced by a factory reset. */
const BOOT_IDENTITY_KEY = 'kaonic-mock-boot-identity';
const CODENAME_PATTERN = /^[a-z0-9]{8}$/;
const MIN_PASSWORD = 8;

const randomIdentity = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Stands in for the hub's key derivation: the same words always give the same identity. */
async function identityFromSeed(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`kaonic-admin:${seed}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function defaultStore(): KeyValueStore {
  try {
    return globalThis.localStorage ?? memoryStore();
  } catch {
    return memoryStore();
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const jitter = (value: number, spread: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value + (Math.random() - 0.5) * spread));

export function createMockApi(options: MockOptions = {}): HubApi {
  const { latencyMs = 250, storage = defaultStore(), tickMs = 2000 } = options;
  const bootedAt = Date.now() - 4 * 3600 * 1000;

  /* ── persisted state ── */

  function load(): Persisted | null {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Persisted) : null;
    } catch {
      return null;
    }
  }
  let persisted = load();
  function save(next: Persisted | null) {
    persisted = next;
    if (next) storage.setItem(STORAGE_KEY, JSON.stringify(next));
    else storage.removeItem(STORAGE_KEY);
  }

  /** Plugins, the hub's and the installer's updates, and their history. */
  const installer = createMockPlugins({
    checkPassword(password) {
      // A wrong password here is a mistake in a form, not a lost session.
      if (persisted?.password != null && password !== persisted.password) throw new ApiError('validation_failed', 'Wrong password.', { password: 'Wrong password.' });
    },
    releaseKey: options.releaseKey,
    installerRunning: options.installerRunning,
    hubRestartMs: options.hubRestartMs,
  });

  function bootIdentity(): string {
    let identity = storage.getItem(BOOT_IDENTITY_KEY);
    if (!identity) {
      identity = randomIdentity();
      storage.setItem(BOOT_IDENTITY_KEY, identity);
    }
    return identity;
  }

  /** The seed phrase the admin keys are derived from, checked as the hub checks it. */
  async function adminSeed(secret: AdminSecret): Promise<string> {
    const problem = await phraseProblem(secret.seedPhrase);
    if (problem) throw new ApiError('validation_failed', 'Check the highlighted fields.', { seedPhrase: problem });
    return normalisePhrase(secret.seedPhrase);
  }

  async function beforeSetup() {
    await wait();
    if (persisted) throw new ApiError('conflict', 'This device is already set up.');
  }

  /* ── in-memory state ── */

  let radio = seedRadio().map(refreshFilter);

  /** What the radio daemon would do: the chosen filter, or the narrowest that passes the channel centre, else the wide one. */
  function refreshFilter(band: RadioBand): RadioBand {
    const filters = band.filters ?? [];
    const centre = band.config.frequencyHz + band.config.channel * band.config.channelSpacingHz;
    const passing = filters.filter((filter) => centre >= filter.minMhz * 1e6 && centre <= filter.maxMhz * 1e6);
    passing.sort((a, b) => a.maxMhz - a.minMhz - (b.maxMhz - b.minMhz));
    const chosen = typeof band.filter === 'number' ? band.filter : (passing[0] ?? filters[0])?.index;
    band.activeFilter = chosen ?? null;
    return band;
  }

  /** The hub's checks on a band change: the channel centre inside the band, the mesh band never off. */
  function checkBand(id: BandId, config: RadioConfig): RadioBand {
    const band = radio.find((candidate) => candidate.id === id);
    if (!band) throw new ApiError('not_found', 'Unknown radio band.');
    const centre = config.frequencyHz + config.channel * config.channelSpacingHz;
    const ranges = band.rangesHz ?? [[band.minHz, band.maxHz]];
    if (!ranges.some(([low, high]) => centre >= low && centre <= high)) {
      throw new ApiError('validation_failed', 'The radio rejected this frequency.', {
        frequencyHz: `The channel centre ${(centre / 1e6).toFixed(3)} MHz is outside this band.`,
      });
    }
    if (config.modulation.kind === 'off' && band.usedBy.includes('mesh')) {
      throw new ApiError('validation_failed', 'The mesh runs on this band.', { modulation: 'The mesh band cannot be switched off.' });
    }
    const maxPower = maxTxPower(config.modulation.kind);
    if (config.txPower > maxPower) {
      throw new ApiError('validation_failed', 'Check the highlighted fields.', { txPower: `Use 0 to ${maxPower} with this modulation.` });
    }
    if (config.modulation.kind === 'off') stopTest(band);
    return band;
  }

  /** Test message runs: the mock counts the messages it would send. */
  const testTimers = new Map<BandId, ReturnType<typeof setInterval>>();
  function stopTest(band: RadioBand) {
    clearInterval(testTimers.get(band.id));
    testTimers.delete(band.id);
    if (band.test) band.test = { ...band.test, running: false };
  }
  function bandById(id: BandId): RadioBand {
    const band = radio.find((candidate) => candidate.id === id);
    if (!band) throw new ApiError('not_found', 'There is no such band.');
    return band;
  }
  let peers = seedPeers();
  let services = seedServices();
  const enabledSources = new Set<SourceId>();
  const enabledConsumers = new Set<ConsumerId>();

  function resetSwitches() {
    enabledSources.clear();
    enabledConsumers.clear();
    DEFAULT_SWITCHES.sources.forEach((source) => enabledSources.add(source));
    DEFAULT_SWITCHES.consumers.forEach((consumer) => enabledConsumers.add(consumer));
  }
  resetSwitches();

  /* ── helpers ── */

  const wait = () => (latencyMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve());

  /** Wraps a handler: adds latency and refuses callers without a session. */
  function authed<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => Promise<R> {
    return async (...args) => {
      await wait();
      if (!persisted?.loggedIn) throw new ApiError('unauthenticated', 'Sign in to continue.');
      return clone(handler(...args));
    };
  }

  /** Like `authed`, for a call that takes the device a while (a package install). */
  function slow<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => Promise<R> {
    const handled = authed(handler);
    return async (...args) => {
      for (let step = 0; step < 3; step += 1) await wait();
      return handled(...args);
    };
  }

  function uptimeSecs() {
    return Math.floor((Date.now() - bootedAt) / 1000);
  }

  function whitelistedOnline(): Peer[] {
    return peers.filter((peer) => peer.online && peer.list === 'whitelist');
  }

  /** Only the Kaonic Admin holds the key that signs the whitelist and manages nodes. */
  function requireAdminDevice() {
    if ((persisted?.mode ?? 'admin') !== 'admin') {
      throw new ApiError('forbidden', 'Only the Kaonic Admin device can do this.', {}, 'not_admin_device');
    }
  }

  /* ── managing other nodes ── */

  const RELEASE: SoftwareRelease = { version: '1.0.1', sizeBytes: 6_400_000 };
  /** How long each kind of job takes on a node one hop away. Further nodes take longer. */
  const JOB_SECS: Record<NodeJob['kind'], number> = { update: 18, radio: 2, restart: 3, ptt: 1 };
  const JOB_TICK_MS = 500;
  const RUNNING_TEXT: Record<NodeJob['kind'], string> = { update: 'Sending the update', radio: 'Applying radio settings', restart: 'Restarting', ptt: 'Applying talk settings' };
  const DONE_TEXT: Record<NodeJob['kind'], string> = { update: 'Updated', radio: 'Radio settings applied', restart: 'Restarted', ptt: 'Talk settings applied' };
  /** Each managed node's talk settings, as the mock's nodes keep them. */
  /** Each managed node's internet sharing, as the admin set it. The first node seeded has internet of its own. */
  const nodeSharing = new Map<string, { uplink: VpnUplinkInput; gateway: VpnGatewayInput }>();
  const sharingOf = (id: string) => {
    if (!nodeSharing.has(id)) nodeSharing.set(id, { uplink: { enabled: false, peerId: null, defaultRoute: true, routes: [] }, gateway: { enabled: false, egressInterface: null, routes: ['0.0.0.0/0'] } });
    return nodeSharing.get(id)!;
  };
  const nodeSharingView = (id: string): NodeSharing => {
    const { uplink, gateway } = sharingOf(id);
    const internet = peers.find((peer) => peer.list === 'whitelist')?.id === id;
    const through = uplink.peerId === null ? undefined : peers.find((peer) => peer.id === uplink.peerId);
    return {
      uplink: { ...uplink, routes: [...uplink.routes], active: uplink.enabled, detail: uplink.enabled ? `Through ${through?.codename ?? 'this device'}.` : null, gateways: [] },
      gateway: { ...gateway, routes: [...gateway.routes], active: gateway.enabled && internet, availableInterfaces: ['wlan0'], detail: gateway.enabled ? (internet ? 'Forwarding for the mesh through wlan0.' : 'No uplink to share.') : null },
      internet,
    };
  };
  const nodePtt = new Map<string, PttSettings>();
  const pttOf = (id: string) => {
    if (!nodePtt.has(id)) nodePtt.set(id, { ...DEFAULT_PTT_SETTINGS });
    return nodePtt.get(id)!;
  };

  let jobs: NodeJob[] = [];
  let jobCounter = 0;
  let jobTimer: ReturnType<typeof setInterval> | null = null;
  /** What each job changes on its node when it succeeds. */
  const jobEffects = new Map<string, () => void>();
  /** The radio bands of other nodes, made up the first time a node is asked. */
  const remoteBands = new Map<string, RadioBand[]>();

  function bandsOf(id: string): RadioBand[] {
    let bands = remoteBands.get(id);
    if (!bands) {
      bands = seedRadio().map((band) => ({ ...band, usedBy: band.id === 'a_sub' ? ['mesh'] : [], lastRssi: null }));
      remoteBands.set(id, bands);
    }
    return bands;
  }

  /** Only nodes on the whitelist may be managed, and only from the admin device. */
  function managed(id: string): Peer {
    requireAdminDevice();
    const peer = findPeer(id);
    if (peer.list !== 'whitelist') throw new ApiError('forbidden', `${peer.codename} is not on the whitelist.`, {}, 'not_whitelisted');
    return peer;
  }

  function startJobs(ids: string[], kind: NodeJob['kind'], effect: (peer: Peer) => void): NodeJob[] {
    const created = ids.map((id) => {
      const peer = managed(id);
      // A new job on a node replaces what is left of its earlier ones of the same kind.
      jobs = jobs.filter((job) => !(job.nodeId === id && job.kind === kind && (job.state === 'done' || job.state === 'failed')));
      const job: NodeJob = { id: `job-${(jobCounter += 1)}`, nodeId: id, kind, state: 'queued', progress: 0, detail: 'Waiting', createdTs: Math.floor(Date.now() / 1000) };
      jobEffects.set(job.id, () => effect(peer));
      return job;
    });
    jobs = [...jobs, ...created];
    jobTimer ??= setInterval(jobTick, JOB_TICK_MS);
    emit('jobs', jobs);
    return created;
  }

  /** Jobs run one node at a time: the radio is a shared, slow link. */
  function jobTick() {
    const running = jobs.find((job) => job.state === 'running') ?? jobs.find((job) => job.state === 'queued');
    if (!running) {
      if (jobTimer) clearInterval(jobTimer);
      jobTimer = null;
      return;
    }
    const peer = peers.find((candidate) => candidate.id === running.nodeId);
    if (!peer || !peer.online || peer.hops === null) {
      Object.assign(running, { state: 'failed', detail: 'Could not reach the node' });
    } else {
      running.state = 'running';
      running.detail = RUNNING_TEXT[running.kind];
      running.progress = Math.min(1, running.progress + JOB_TICK_MS / 1000 / (JOB_SECS[running.kind] * Math.sqrt(peer.hops)));
      if (running.progress >= 1) {
        jobEffects.get(running.id)?.();
        Object.assign(running, { state: 'done', detail: DONE_TEXT[running.kind] });
        emit('peers', peers);
      }
    }
    if (running.state !== 'running') jobEffects.delete(running.id);
    emit('jobs', jobs);
  }

  /* ── Wi-Fi ── */

  /**
   * What a scan finds, and the password each secured network really has, so a
   * wrong one can be shown failing. The mock's surroundings never change.
   */
  const NEARBY: Array<Omit<WifiScanEntry, 'saved'> & { password: string | null }> = [
    { ssid: 'Office', signalDbm: -58, security: 'wpa2', frequencyMhz: 2437, password: 'office-password' },
    { ssid: 'CoffeeGuest', signalDbm: -66, security: 'open', frequencyMhz: 2412, password: null },
    { ssid: 'Field-HQ', signalDbm: -71, security: 'wpa2', frequencyMhz: 5180, password: 'field-hq-pass' },
    { ssid: 'Workshop-5G', signalDbm: -79, security: 'wpa3', frequencyMhz: 5745, password: 'workshop-pass' },
    { ssid: 'printer-setup', signalDbm: -84, security: 'open', frequencyMhz: 2462, password: null },
  ];
  const WIFI_PASSWORD = { min: 8, max: 63 };

  interface MockSaved {
    ssid: string;
    password: string | null;
    hidden: boolean;
    autoConnect: boolean;
    lastConnectedTs: number | null;
    problem: SavedWifiNetwork['problem'];
  }

  /** Saved networks, most preferred first, with the password each was saved with. */
  let savedWifi: MockSaved[] = [];
  let hotspot: { enabled: boolean; ssid: string; password: string | null } = { enabled: true, ssid: '', password: null };
  /** A network joined by hand: the client stays on it while it works. */
  let pinned: string | null = null;
  let attempt: WifiClient['attempt'] = null;
  let scannedTs: number | null = null;

  /** What a factory reset erases (with a password, or after a forgotten one). */
  function eraseEverything() {
    save(null);
    // A reset device is a new device: it gets a new identity on its next boot.
    storage.removeItem(BOOT_IDENTITY_KEY);
    radio.forEach(stopTest);
    radio = seedRadio().map(refreshFilter);
    peers = seedPeers();
    services = seedServices();
    installer.reset();
    resetSwitches();
    resetWifi();
    jobs = [];
    jobEffects.clear();
    remoteBands.clear();
  }

  function resetWifi() {
    const suffix = (persisted?.codename ?? '0000').slice(-4);
    savedWifi = [
      { ssid: 'Office', password: 'office-password', hidden: false, autoConnect: true, lastConnectedTs: null, problem: null },
      { ssid: 'Depot', password: 'depot-password', hidden: false, autoConnect: true, lastConnectedTs: null, problem: null },
    ];
    // Open until an admin sets a password, as a fresh device is.
    hotspot = { enabled: true, ssid: `Kaonic /${suffix.toUpperCase()}/`, password: null };
    pinned = null;
    attempt = null;
    scannedTs = null;
  }
  resetWifi();

  const nearby = (ssid: string) => NEARBY.find((entry) => entry.ssid === ssid);

  function scanEntries(): WifiScanEntry[] {
    return [...NEARBY]
      .sort((a, b) => b.signalDbm - a.signalDbm)
      .map((entry) => ({
        ssid: entry.ssid,
        signalDbm: entry.signalDbm,
        security: entry.security,
        frequencyMhz: entry.frequencyMhz,
        saved: savedWifi.some((network) => network.ssid === entry.ssid),
      }));
  }

  /** Tries a saved network the way the hub does; records a wrong password. */
  function works(network: MockSaved): boolean {
    const there = nearby(network.ssid);
    if (!there) return false;
    if (there.password !== network.password) {
      network.problem = 'wrong_password';
      attempt = { ssid: network.ssid, reason: 'wrong_password', ts: Math.floor(Date.now() / 1000) };
      return false;
    }
    network.problem = null;
    network.lastConnectedTs = Math.floor(Date.now() / 1000);
    return true;
  }

  /** The network the client is on: the pinned one if it works, else the first saved one that may auto-connect and works. */
  function joinedWifi(): (typeof NEARBY)[number] | null {
    if (!enabledSources.has('wifi_client')) return null;
    const pin = savedWifi.find((network) => network.ssid === pinned);
    if (pin && pin.problem !== 'wrong_password' && works(pin)) return nearby(pin.ssid)!;
    if (pin && pin.problem === 'wrong_password') pinned = null;
    for (const network of savedWifi) {
      if (network.autoConnect && network.problem !== 'wrong_password' && works(network)) return nearby(network.ssid)!;
    }
    return null;
  }

  function wifiConfig(): WifiConfig {
    const joined = joinedWifi();
    if (joined) attempt = attempt?.ssid === joined.ssid ? null : attempt;
    const client: WifiClient = {
      state: !enabledSources.has('wifi_client') ? 'off' : joined ? 'connected' : 'searching',
      ssid: joined?.ssid ?? null,
      signalDbm: joined?.signalDbm ?? null,
      address: joined ? '192.168.1.23/24' : null,
      pinned,
      attempt,
      scannedTs,
      fault: null,
    };
    return {
      client,
      saved: savedWifi.map((network) => ({
        ssid: network.ssid,
        secured: network.password !== null,
        autoConnect: network.autoConnect,
        inRange: nearby(network.ssid) !== undefined,
        signalDbm: nearby(network.ssid)?.signalDbm ?? null,
        lastConnectedTs: network.lastConnectedTs,
        problem: network.problem,
        retryTs: null,
      })),
      hotspot: { ...hotspot, enabled: enabledConsumers.has('hotspot'), open: hotspot.password === null },
      antenna: 'internal',
      antennaSupported: false,
    };
  }

  /** A password is 8 to 63 characters, the limits WPA sets. */
  function checkWifiPassword(password: string, field: string) {
    if (password.length < WIFI_PASSWORD.min || password.length > WIFI_PASSWORD.max) {
      throw new ApiError('validation_failed', 'Check the highlighted fields.', { [field]: `Use ${WIFI_PASSWORD.min} to ${WIFI_PASSWORD.max} characters.` });
    }
  }

  function savedNetwork(ssid: string): MockSaved {
    const network = savedWifi.find((candidate) => candidate.ssid === ssid);
    if (!network) throw new ApiError('not_found', 'This network is not saved.');
    return network;
  }

  /** After any Wi-Fi change the network picture may be different: tell whoever is watching. */
  function wifiChanged(): WifiConfig {
    const config = wifiConfig();
    emit('network', networkState());
    emit('wifi', { ...config, hotspot: { ...config.hotspot, password: null } });
    return config;
  }

  function networkState(): NetworkState {
    const gateway = whitelistedOnline()[0];
    const sourceInfo: Record<SourceId, { healthy: boolean; ready: string; waiting: string }> = {
      wifi_client: {
        healthy: joinedWifi() !== null,
        ready: joinedWifi() ? `"${joinedWifi()!.ssid}" at ${joinedWifi()!.signalDbm} dBm` : '',
        waiting: savedWifi.length === 0 ? 'No network chosen yet' : 'No saved network in range',
      },
      usb_phone: { healthy: false, ready: 'Phone connected', waiting: 'Waiting for a phone. Plug it in and turn on Ethernet tethering.' },
      mesh_gateway: {
        healthy: gateway !== undefined,
        ready: gateway ? `Through ${gateway.codename}` : '',
        waiting: 'No whitelisted device is sharing internet',
      },
    };
    const order: SourceId[] = ['wifi_client', 'usb_phone', 'mesh_gateway'];
    const activeSource = order.find((id) => enabledSources.has(id) && sourceInfo[id].healthy) ?? null;

    const sources: NetworkSource[] = order.map((id) => {
      const info = sourceInfo[id];
      if (!enabledSources.has(id)) return { id, enabled: false, status: 'off', detail: 'Off' };
      if (!info.healthy) return { id, enabled: true, status: 'waiting', detail: info.waiting };
      return { id, enabled: true, status: id === activeSource ? 'active' : 'standby', detail: info.ready };
    });

    const meshCount = whitelistedOnline().length;
    const consumerInfo: Record<ConsumerId, { clients: number; detail: string; waiting?: string }> = {
      hotspot: { clients: 3, detail: hotspot.ssid },
      usb_computer: { clients: 1, detail: 'Computer connected' },
      mesh_peers: {
        clients: meshCount,
        detail: 'Sharing this internet connection',
        waiting: activeSource ? undefined : 'No internet to share yet',
      },
    };
    const consumers: NetworkConsumer[] = (['hotspot', 'usb_computer', 'mesh_peers'] as const).map((id) => {
      const info = consumerInfo[id];
      if (!enabledConsumers.has(id)) return { id, enabled: false, status: 'off', detail: 'Off', clients: 0 };
      if (info.waiting) return { id, enabled: true, status: 'waiting', detail: info.waiting, clients: 0 };
      return { id, enabled: true, status: 'active', detail: info.detail, clients: info.clients };
    });

    return { activeSource, sources, consumers, lan: { address: '192.168.10.1', subnet: '192.168.10.0/24' } };
  }

  function findPeer(id: string): Peer {
    const peer = peers.find((candidate) => candidate.id === id);
    if (!peer) throw new ApiError('not_found', 'This device is no longer in the list.');
    return peer;
  }

  /** How long provisioning takes in the mock: a link, a CSR one way, a certificate the other. */
  const PROVISION_MS = 3000;

  function whitelist(peer: Peer) {
    peer.list = 'whitelist';
    peer.trust = { ...peer.trust, network: 'ours', provisioning: null };
    peer.link = { state: peer.online ? 'active' : 'none', detail: null };
    peer.tunnelIp ??= `10.20.${peer.id.charCodeAt(0) % 200}.${peer.id.charCodeAt(1) % 250}`;
  }

  /** The hub's rules for `PUT /peers/{id}/list` (see the API description). */
  function setList(id: string, list: NodeList): Peer {
    const peer = findPeer(id);
    if (list === peer.list) return peer;
    const changesWhitelist = list === 'whitelist' || peer.list === 'whitelist';
    if (changesWhitelist) requireAdminDevice();

    if (list === 'whitelist') {
      if (peer.trust.network === 'other') {
        throw new ApiError('conflict', `${peer.codename} belongs to another Kaonic Admin. Factory reset it first.`, {}, 'foreign_node');
      }
      if (peer.trust.network === 'ours') {
        whitelist(peer);
      } else {
        // A node nobody has certified yet: provision it first. It joins the whitelist when that is done.
        if (!peer.online) throw new ApiError('unavailable', `${peer.codename} is out of range.`, {}, 'peer_unreachable');
        if (peer.trust.provisioning?.state === 'running') return peer;
        peer.trust = { ...peer.trust, provisioning: { state: 'running', detail: 'Exchanging certificates' } };
        setTimeout(() => {
          if (peer.trust.provisioning?.state !== 'running') return;
          if (peer.online) whitelist(peer);
          else peer.trust = { ...peer.trust, provisioning: { state: 'failed', detail: 'The node went out of range' } };
          emit('peers', peers);
          emit('network', networkState());
        }, PROVISION_MS);
      }
    } else {
      // Off the whitelist: a new allowlist without it revokes it everywhere.
      if (peer.list === 'whitelist') {
        peer.link = { state: 'none', detail: 'Removed from the whitelist' };
        peer.tunnelIp = null;
      }
      peer.list = list;
      peer.trust = { ...peer.trust, provisioning: null };
    }
    emit('peers', peers);
    emit('network', networkState());
    return peer;
  }

  /* ── live topics ── */

  type Handler<T extends HubTopic> = (payload: HubEvents[T]) => void;
  const handlers: { [T in HubTopic]: Set<Handler<T>> } = {
    metrics: new Set(),
    traffic: new Set(),
    frames: new Set(),
    radio: new Set(),
    vpn: new Set(),
    packets: new Set(),
    jobs: new Set(),
    peers: new Set(),
    network: new Set(),
    wifi: new Set(),
    ptt: new Set(),
    pttLevel: new Set(),
  };
  let timer: ReturnType<typeof setInterval> | null = null;

  function emit<T extends HubTopic>(topic: T, payload: HubEvents[T]) {
    handlers[topic].forEach((handler) => handler(clone(payload)));
  }

  /* ── push-to-talk ── */

  const ptt = createMockPtt({
    peers: () => peers,
    self: () => ({
      id: persisted?.identityHash ?? bootIdentity(),
      codename: persisted?.codename ?? 'kaonic00',
      isAdmin: (persisted?.mode ?? 'admin') === 'admin',
    }),
    // The mock's devices are always part of a network once set up.
    provisioned: () => persisted !== null,
    loggedIn: () => persisted?.loggedIn === true,
    emitState: (state) => emit('ptt', state),
    emitLevel: (level) => emit('pttLevel', level),
    watched: () => handlers.ptt.size + handlers.pttLevel.size > 0,
  });

  let cpu = 18;
  let ram = 142;
  let battery = 78;
  function metrics(): SystemMetrics {
    cpu = jitter(cpu, 14, 4, 92);
    ram = jitter(ram, 6, 120, 260);
    battery = battery > 5 ? battery - 0.02 : 78;
    return {
      cpuPercent: Math.round(cpu),
      ramUsedMb: Math.round(ram),
      ramTotalMb: 427,
      fsFreeMb: 2310,
      fsTotalMb: 3520,
      uptimeSecs: uptimeSecs(),
      battery: { percent: Math.round(battery), charging: false },
    };
  }

  const rates: Record<TrafficChannelId, { rx: number; tx: number; max: number }> = {
    a_sub: { rx: 60_000, tx: 40_000, max: 200_000 },
    a_24: { rx: 240_000, tx: 120_000, max: 800_000 },
    b_sub: { rx: 20_000, tx: 10_000, max: 80_000 },
    b_24: { rx: 90_000, tx: 30_000, max: 300_000 },
    vpn: { rx: 30_000, tx: 20_000, max: 120_000 },
  };
  let lastTraffic: TrafficSample | null = null;
  function traffic(): TrafficSample {
    const channels = {} as TrafficSample['channels'];
    for (const id of Object.keys(rates) as TrafficChannelId[]) {
      const rate = rates[id];
      rate.rx = jitter(rate.rx, rate.max * 0.3, 0, rate.max);
      rate.tx = jitter(rate.tx, rate.max * 0.2, 0, rate.max);
      // A band that is switched off carries nothing.
      const silent = radio.some((band) => band.id === id && band.config.modulation.kind === 'off');
      channels[id] = silent ? { rxBps: 0, txBps: 0 } : { rxBps: Math.round(rate.rx), txBps: Math.round(rate.tx) };
    }
    lastTraffic = { ts: Date.now(), channels };
    return lastTraffic;
  }

  /** Occupied bandwidth of a modulation, roughly. Enough to draw believable frames. */
  function bandwidthHz(modulation: Modulation): number {
    if (modulation.kind === 'ofdm') return [1_200_000, 800_000, 400_000, 200_000][modulation.option - 1] ?? 200_000;
    if (modulation.kind === 'qpsk') return modulation.chipRateKhz * 1500;
    return 200_000;
  }

  /** Numbers frames like the hub does. */
  let frameSeq = 0;

  /** A burst of frames for the bands that are on: mostly heard from peers, some sent by us. */
  function frames(sinceMs: number): RadioFrame[] {
    const out: RadioFrame[] = [];
    const senders = peers.filter((peer) => peer.online && peer.rssi !== null);
    const now = Date.now();
    for (const band of radio) {
      if (band.config.modulation.kind === 'off') continue;
      // Quiet most of the time, with the odd burst.
      const count = Math.random() < 0.55 ? 0 : 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < count; i += 1) {
        const sent = Math.random() < 0.3;
        // The other end of the frame: who sent it, or who it is for.
        const sender = senders[Math.floor(Math.random() * senders.length)];
        const kind = frameKind(sent);
        const len = kind === 'announce' ? 167 + Math.floor(Math.random() * 40) : 24 + Math.floor(Math.random() * 1000);
        const complete = kind !== 'segment' && kind !== 'corrupt';
        // Link traffic is addressed to a link id, which says nothing about the node.
        const destinationType = !complete ? null : kind === 'proof' || (kind === 'data' && Math.random() < 0.5) ? 'link' : 'single';
        const known = complete && destinationType === 'single';
        out.push({
          seq: ++frameSeq,
          ts: now - Math.floor(Math.random() * sinceMs),
          band: band.id,
          direction: sent ? 'tx' : 'rx',
          rssi: sent ? null : Math.round(jitter(sender?.rssi ?? -80, 8, -105, -35)),
          len,
          frequencyHz: band.config.frequencyHz + band.config.channel * band.config.channelSpacingHz,
          bandwidthHz: bandwidthHz(band.config.modulation),
          durationMs: 30 + len * 0.25,
          kind,
          hops: complete ? (sent ? 0 : Math.max(0, (sender?.hops ?? 1) - 1)) : null,
          destination: !complete ? null : destinationType === 'link' ? linkIds[Math.floor(Math.random() * linkIds.length)]! : destinationOf(sender?.id ?? '0'),
          destinationType,
          packetLen: complete ? len + (Math.random() < 0.2 ? 1200 : 0) : null,
          peerId: known ? (sender?.id ?? null) : null,
          peer: known ? (sender?.codename ?? null) : null,
        });
        recordFrame(band.id, sent, len, kind);
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** What a frame carried: mostly data, some announces, now and then one that did not decode. */
  function frameKind(sent: boolean): FrameKind {
    const roll = Math.random();
    if (!sent && roll < 0.05) return 'corrupt';
    if (roll < 0.18) return 'segment';
    if (roll < 0.34) return 'announce';
    if (roll < 0.4) return 'link_request';
    if (roll < 0.47) return 'proof';
    return 'data';
  }

  /** A node's destination hash: made up, but the same every time. */
  const destinationOf = (id: string) => [...id].reverse().join('');
  const linkIds = Array.from({ length: 4 }, randomIdentity);

  /* ── band counters ── */

  type Counters = Omit<RadioBandStats, 'band' | 'interface' | 'rxBps' | 'txBps' | 'airtime' | 'lastRssi' | 'noiseDbm'>;
  const INTERFACES: Record<BandId, string> = { a_sub: 'rf09_a', a_24: 'rf24_a', b_sub: 'rf09_b', b_24: 'rf24_b' };
  const counters = new Map<BandId, Counters>();
  function countersOf(band: BandId): Counters {
    let entry = counters.get(band);
    if (!entry) {
      // A device that has been up a while has counted a good deal already.
      const scale = band.endsWith('24') ? 3 : 1;
      entry = {
        rxFrames: 18_400 * scale,
        rxPackets: 14_100 * scale,
        rxBytes: 2_950_000 * scale,
        rxDecodeErrors: 310 * scale,
        txFrames: 9_800 * scale,
        txPackets: 7_600 * scale,
        txBytes: 1_420_000 * scale,
        txErrors: 0,
        // One band shows what driver trouble looks like.
        driver: { rxErrors: 0, rxDropped: 0, txErrors: 0, txDropped: band === 'a_sub' ? 43 : 0 },
      };
      counters.set(band, entry);
    }
    return entry;
  }
  function recordFrame(band: BandId, sent: boolean, len: number, kind: FrameKind) {
    const entry = countersOf(band);
    if (sent) {
      entry.txFrames += 1;
      if (kind !== 'segment') entry.txPackets += 1;
      entry.txBytes += len;
    } else {
      entry.rxFrames += 1;
      if (kind === 'corrupt') entry.rxDecodeErrors += 1;
      else if (kind !== 'segment') entry.rxPackets += 1;
      entry.rxBytes += kind === 'corrupt' ? 0 : len;
    }
  }

  /** Bit rate of a modulation, roughly: for the airtime estimate. */
  function bitRate(modulation: Modulation): number {
    if (modulation.kind === 'ofdm') return [2_400_000, 1_200_000, 600_000, 300_000][modulation.option - 1] ?? 300_000;
    if (modulation.kind === 'qpsk') return modulation.chipRateKhz * 250;
    return 100_000;
  }

  let noise = -101;
  function bandStats(): RadioBandStats[] {
    const sample = lastTraffic ?? traffic();
    noise = jitter(noise, 3, -108, -92);
    return radio
      .filter((band) => band.config.modulation.kind !== 'off')
      .map((band) => {
        const rate = sample.channels[band.id];
        const entry = countersOf(band.id);
        // Rates also show in the counters, so totals keep climbing on screen.
        entry.rxBytes += Math.round((rate.rxBps * tickMs) / 8000);
        entry.txBytes += Math.round((rate.txBps * tickMs) / 8000);
        const bits = bitRate(band.config.modulation);
        return {
          band: band.id,
          interface: INTERFACES[band.id],
          ...structuredClone(entry),
          rxBps: rate.rxBps,
          txBps: rate.txBps,
          airtime: { rxPct: Math.min(100, (rate.rxBps / bits) * 130), txPct: Math.min(100, (rate.txBps / bits) * 130) },
          lastRssi: band.lastRssi,
          noiseDbm: Math.round(noise + (band.id.endsWith('24') ? 6 : 0)),
        };
      });
  }

  /* ── VPN ── */

  const vpnTotals = { rxBytes: 48_300_000, txBytes: 21_700_000, rxPackets: 61_200, txPackets: 39_800, dropped: 17 };
  // Sharing with this device's clients, as the hub keeps it.
  const vpnShare: VpnShareSettings = {
    shareLans: true,
    lanInterfaces: ['br0', 'usb0'],
    mapLans: true,
    mappingPool: '10.78.0.0/16',
    lanRouter: 'auto',
    dnsServers: ['1.1.1.1', '8.8.8.8'],
    advertise: [],
  };
  let vpnUplink: VpnUplinkInput = { enabled: false, peerId: null, defaultRoute: true, routes: [] };
  let vpnGateway: VpnGatewayInput = { enabled: false, egressInterface: null, routes: ['0.0.0.0/0'] };
  const failIf = (errors: FieldErrors) => {
    if (Object.keys(errors).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', errors);
  };
  function vpnLans() {
    if (!vpnShare.shareLans) return [];
    const lans = [
      { interface: 'br0', subnet: '192.168.10.0/24', mapped: '10.78.41.0/24' },
      { interface: 'usb0', subnet: '192.168.11.0/24', mapped: '10.78.42.0/24' },
    ].filter((lan) => vpnShare.lanInterfaces.includes(lan.interface));
    return lans.map((lan) => ({ subnet: lan.subnet, mappedSubnet: vpnShare.mapLans ? lan.mapped : lan.subnet, interface: lan.interface }));
  }
  function vpnGatewayNodes() {
    return peers.filter((peer) => peer.list === 'whitelist' && peer.tunnelIp && peer.online).slice(0, 1);
  }
  function vpnState(): VpnState {
    const rate = (lastTraffic ?? traffic()).channels.vpn;
    vpnTotals.rxBytes += Math.round((rate.rxBps * tickMs) / 8000);
    vpnTotals.txBytes += Math.round((rate.txBps * tickMs) / 8000);
    vpnTotals.rxPackets += Math.round((rate.rxBps * tickMs) / 8000 / 600);
    vpnTotals.txPackets += Math.round((rate.txBps * tickMs) / 8000 / 600);
    const now = Math.floor(Date.now() / 1000);
    const tunnelled = peers.filter((peer) => peer.list === 'whitelist' && peer.tunnelIp);
    const share = 1 / Math.max(1, tunnelled.filter((peer) => peer.online).length);
    return {
      enabled: true,
      status: 'running',
      interface: 'kaonic0',
      network: '10.20.0.0/16',
      tunnelIp: '10.20.1.1',
      counters: { ...vpnTotals, rxBps: rate.rxBps, txBps: rate.txBps, lastRxTs: now, lastTxTs: now },
      peers: tunnelled.map((peer, index) => {
        const part = peer.online ? share : 0;
        return {
          peerId: peer.id,
          codename: peer.codename,
          tag: peer.tag,
          tunnelIp: peer.tunnelIp,
          state: peer.online ? 'active' : 'closed',
          isGateway: index === 0,
          routes: index === 0 ? ['0.0.0.0/0'] : [],
          counters: {
            rxBytes: Math.round(vpnTotals.rxBytes / tunnelled.length),
            txBytes: Math.round(vpnTotals.txBytes / tunnelled.length),
            rxPackets: Math.round(vpnTotals.rxPackets / tunnelled.length),
            txPackets: Math.round(vpnTotals.txPackets / tunnelled.length),
            rxBps: Math.round(rate.rxBps * part),
            txBps: Math.round(rate.txBps * part),
            dropped: index,
            lastRxTs: peer.online ? now : peer.lastSeenTs,
            lastTxTs: peer.online ? now : peer.lastSeenTs,
          },
          arq: { resent: 40 + index * 31, fastResent: 12 + index * 7, givenUp: index, duplicates: 5 + index * 3, rttMs: peer.rttMs },
          lastError: peer.online ? null : 'The node went out of range.',
        };
      }),
      routes: {
        advertised: [...vpnLans().map((lan) => lan.mappedSubnet), ...vpnShare.advertise],
        localMappings: vpnLans(),
        remote: tunnelled.flatMap((peer, index): VpnRemoteRoute[] => {
          if (index === 0) {
            return [{ network: '0.0.0.0/0', peerId: peer.id, status: 'refused', installed: false, lastSeenTs: now, reason: 'A default route is never taken from a node.' }];
          }
          const lan = `192.168.${20 + index}.0/24`;
          const routes: VpnRemoteRoute[] = [{ network: lan, peerId: peer.id, status: 'active', installed: peer.online, lastSeenTs: peer.online ? now : peer.lastSeenTs, reason: null }];
          if (index === 2) routes.push({ network: '192.168.10.0/25', peerId: peer.id, status: 'conflict', installed: false, lastSeenTs: now, reason: 'Overlaps 192.168.10.0/24, this device\'s own LAN.' });
          return routes;
        }),
      },
      uplink: (() => {
        const gateways = vpnGatewayNodes().map((peer) => ({ peerId: peer.id, codename: peer.codename, routes: ['0.0.0.0/0'] }));
        const chosen = gateways.find((gateway) => vpnUplink.peerId === null || gateway.peerId === vpnUplink.peerId);
        const active = vpnUplink.enabled && chosen !== undefined;
        return {
          ...vpnUplink,
          peerId: vpnUplink.peerId ?? (active ? chosen!.peerId : null),
          active,
          detail: !vpnUplink.enabled ? null : active ? `Through ${chosen!.codename}.` : 'No node offers to be a gateway right now.',
          gateways,
        };
      })(),
      gateway: {
        ...vpnGateway,
        active: vpnGateway.enabled,
        egressInterface: vpnGateway.egressInterface ?? (vpnGateway.enabled ? 'wlan0' : null),
        availableInterfaces: ['wlan0', 'usb0'],
        detail: vpnGateway.enabled ? 'Sharing wlan0 with the mesh (NAT).' : null,
      },
      settings: { ...vpnShare, lanInterfaces: [...vpnShare.lanInterfaces], dnsServers: [...vpnShare.dnsServers], advertise: [...vpnShare.advertise] },
      mtu: 792,
      lastError: null,
    };
  }

  function updateVpnSettings(patch: VpnSharePatch): VpnState {
    failIf(checkSharePatch(patch));
    Object.assign(vpnShare, patch);
    return vpnState();
  }

  function setVpnRoutes(advertised: string[]) {
    failIf(checkAdvertised(advertised));
    vpnShare.advertise = [...advertised];
  }

  function setVpnUplink(input: VpnUplinkInput) {
    failIf(checkUplink(input));
    if (input.enabled && vpnGateway.enabled) failIf({ enabled: 'This node is a gateway: it cannot use another one\'s uplink at the same time.' });
    vpnUplink = { ...input, routes: [...input.routes] };
    return vpnState().uplink;
  }

  function setVpnGateway(input: VpnGatewayInput) {
    failIf(checkGateway(input));
    if (input.enabled && vpnUplink.enabled) failIf({ enabled: "This node uses another node's uplink: turn that off first." });
    vpnGateway = { ...input, routes: [...input.routes] };
    return vpnState().gateway;
  }

  const boot = createMockBoot((password) => {
    if (persisted?.password != null && password !== persisted.password) throw new ApiError('validation_failed', 'Wrong password.', { password: 'Wrong password.' });
  });
  const vpnCapture = createMockCapture('10.20.1.1', '10.20.0.0/16', () =>
    peers.filter((peer) => peer.online && peer.list === 'whitelist' && peer.tunnelIp).map((peer) => ({ id: peer.id, codename: peer.codename, ip: peer.tunnelIp! })),
  );

  let vpnPackets: VpnPacket[] = [];
  /** New tunnel packets since the last look: a little web, DNS and the odd ping. */
  function newVpnPackets(): VpnPacket[] {
    const tunnelled = peers.filter((peer) => peer.online && peer.list === 'whitelist' && peer.tunnelIp);
    if (tunnelled.length === 0) return vpnPackets;
    const now = Date.now();
    const count = Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i += 1) {
      const peer = tunnelled[Math.floor(Math.random() * tunnelled.length)]!;
      const roll = Math.random();
      const [proto, port, len] = roll < 0.55 ? ['TCP', 443, 60 + Math.floor(Math.random() * 1400)] : roll < 0.8 ? ['UDP', 53, 70 + Math.floor(Math.random() * 120)] : roll < 0.92 ? ['UDP', 5004, 172] : ['ICMP', null, 84];
      const outward = Math.random() < 0.5;
      const ephemeral = 40_000 + Math.floor(Math.random() * 20_000);
      vpnPackets.unshift({
        ts: now - Math.floor(Math.random() * 2000),
        direction: outward ? 'tx' : 'rx',
        src: outward ? '10.20.1.1' : peer.tunnelIp!,
        dst: outward ? peer.tunnelIp! : '10.20.1.1',
        proto,
        sport: port === null ? null : outward ? ephemeral : port,
        dport: port === null ? null : outward ? port : ephemeral,
        len,
      });
    }
    vpnPackets = vpnPackets.sort((a, b) => b.ts - a.ts).slice(0, 256);
    return vpnPackets;
  }

  /** The frames the hub still holds: made up once, then kept up to date by the live feed. */
  let heldFrames: RadioFrame[] | null = null;
  function framesHeld(): RadioFrame[] {
    if (!heldFrames) {
      heldFrames = [];
      // Two minutes of history, in the bursts the live feed sends.
      for (let step = 240; step > 0; step -= 1) {
        heldFrames.push(...frames(FRAME_TICK_MS).map((frame) => ({ ...frame, ts: frame.ts - step * FRAME_TICK_MS })));
      }
    }
    return heldFrames;
  }
  function holdFrames(incoming: RadioFrame[]) {
    if (heldFrames) heldFrames = [...heldFrames, ...incoming].slice(-500);
  }

  /*
   * Mesh traffic, as a real node would see it: its own requests and the replies
   * that come back a round trip later, the odd file transfer arriving as a run
   * of packets, announces from devices in range, packets it forwards between
   * two branches of the mesh, and frames between other devices it merely hears.
   */
  const PACKET_TICK_MS = 200;
  /** Events per second of each kind of traffic. */
  const RATE = { request: 0.45, transfer: 0.05, announce: 0.3, relayed: 0.25, overheard: 0.35 };
  let scheduled: Array<{ at: number; packet: Omit<MeshPacket, 'ts'> }> = [];
  let packetTimer: ReturnType<typeof setInterval> | null = null;

  function packetTick() {
    const now = Date.now();
    const inRange = peers.filter((peer) => peer.online && peer.hops !== null);
    if (inRange.length > 0) {
      const pick = <T>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];
      const happens = (perSecond: number) => Math.random() < (perSecond * PACKET_TICK_MS) / 1000;
      const later = (delayMs: number, packet: Omit<MeshPacket, 'ts'>) => scheduled.push({ at: now + delayMs, packet });
      const trusted = inRange.filter((peer) => peer.list === 'whitelist');
      /** The direct neighbour a peer sits behind. */
      const branchOf = (peer: Peer): string => {
        let current = peer;
        while (current.viaId) {
          const via = peers.find((candidate) => candidate.id === current.viaId);
          if (!via) break;
          current = via;
        }
        return current.id;
      };

      if (happens(RATE.request)) {
        // Mostly we talk to whitelisted devices. The answer takes a round trip to arrive.
        const peer = (Math.random() < 0.75 ? pick(trusted) : undefined) ?? pick(inRange)!;
        const roundTrip = peer.hops! * 2 * 750 + 250 + Math.random() * 500;
        later(0, { kind: 'data', fromId: null, toId: peer.id, bytes: 150 + Math.random() * 700 });
        later(roundTrip, { kind: 'data', fromId: peer.id, toId: null, bytes: 60 + Math.random() * 500 });
      }
      if (happens(RATE.transfer) && trusted.length > 0) {
        const peer = pick(trusted)!;
        const chunks = 6 + Math.floor(Math.random() * 8);
        for (let chunk = 0; chunk < chunks; chunk += 1) later(chunk * 280, { kind: 'data', fromId: peer.id, toId: null, bytes: 950 });
      }
      if (happens(RATE.announce)) later(0, { kind: 'announce', fromId: pick(inRange)!.id, toId: null, bytes: 167 });
      if (happens(RATE.relayed)) {
        const from = pick(inRange)!;
        const to = pick(inRange)!;
        // Only traffic between two different branches passes through this device.
        if (branchOf(from) !== branchOf(to)) later(0, { kind: 'relayed', fromId: from.id, toId: to.id, bytes: 100 + Math.random() * 800 });
      }
      if (happens(RATE.overheard)) {
        // A neighbour talking to a device behind it: we hear the neighbour's side of it.
        const behind = pick(inRange.filter((peer) => peer.hops === 2 && peer.viaId));
        if (behind?.viaId) {
          const outward = Math.random() < 0.5;
          later(0, { kind: 'overheard', fromId: outward ? behind.viaId : behind.id, toId: outward ? behind.id : behind.viaId, bytes: 100 + Math.random() * 800 });
        }
      }
    }

    const due = scheduled.filter((entry) => entry.at <= now);
    scheduled = scheduled.filter((entry) => entry.at > now);
    if (due.length > 0 && persisted?.loggedIn) emit('packets', due.map((entry) => ({ ...entry.packet, bytes: Math.round(entry.packet.bytes), ts: now })));
  }

  const FRAME_TICK_MS = 500;
  let frameTimer: ReturnType<typeof setInterval> | null = null;

  function tick() {
    if (!persisted?.loggedIn) return;
    if (handlers.metrics.size) emit('metrics', metrics());
    if (handlers.traffic.size) emit('traffic', traffic());
    if (handlers.radio.size) emit('radio', bandStats());
    if (handlers.vpn.size) emit('vpn', vpnState());
  }

  function syncTimer() {
    const wanted = handlers.metrics.size + handlers.traffic.size + handlers.radio.size + handlers.vpn.size > 0;
    if (wanted && !timer) timer = setInterval(tick, tickMs);
    if (!wanted && timer) {
      clearInterval(timer);
      timer = null;
    }
    const framesWanted = handlers.frames.size > 0;
    if (framesWanted && !frameTimer) {
      frameTimer = setInterval(() => {
        if (!persisted?.loggedIn) return;
        const burst = frames(FRAME_TICK_MS);
        holdFrames(burst);
        emit('frames', burst);
      }, FRAME_TICK_MS);
    }
    if (!framesWanted && frameTimer) {
      clearInterval(frameTimer);
      frameTimer = null;
    }
    const packetsWanted = handlers.packets.size > 0;
    if (packetsWanted && !packetTimer) packetTimer = setInterval(packetTick, PACKET_TICK_MS);
    if (!packetsWanted && packetTimer) {
      clearInterval(packetTimer);
      packetTimer = null;
      scheduled = [];
    }
  }

  /* ── the API ── */

  return {
    auth: {
      async forgotMethods() {
        await wait();
        // In the mock every browser counts as being on the USB cable.
        return { usb: persisted !== null, seed: persisted !== null && (persisted.mode ?? 'admin') === 'admin', setUp: persisted !== null };
      },
      async forgotReset(input) {
        await wait();
        if (persisted === null) throw new ApiError('conflict', 'This device is not set up: there is nothing to reset.');
        if (input.confirm !== 'ERASE') throw new ApiError('validation_failed', 'Check the highlighted fields.', { confirm: 'Type ERASE to confirm.' });
        if (input.method === 'usb') {
          if (input.serial.trim() !== MOCK_SERIAL) {
            throw new ApiError('validation_failed', 'Check the highlighted fields.', { serial: "This is not this device's serial number (on its label and on the System page)." });
          }
        } else {
          if ((persisted.mode ?? 'admin') !== 'admin') {
            throw new ApiError('forbidden', 'Only the Kaonic Admin device is reset with a seed phrase. Connect a computer by USB cable to reset this device.', {}, 'seed_unavailable');
          }
          if ((await identityFromSeed(await adminSeed(input))) !== persisted.identityHash) {
            throw new ApiError('validation_failed', 'Check the highlighted fields.', { seedPhrase: "This is not the seed phrase of this device's admin." });
          }
        }
        eraseEverything();
      },
      async state() {
        await wait();
        // Without a password, opening the UI signs in, as the hub does.
        if (persisted && persisted.password === null && !persisted.loggedIn) save({ ...persisted, loggedIn: true });
        const authenticated = persisted?.loggedIn ?? false;
        return { setupRequired: persisted === null, passwordSet: persisted?.password != null, authenticated, role: authenticated ? 'admin' : null };
      },
      async bootIdentity() {
        await beforeSetup();
        return bootIdentity();
      },
      async deriveIdentity(secret) {
        await beforeSetup();
        return identityFromSeed(await adminSeed(secret));
      },
      async newSeedPhrase(words) {
        await beforeSetup();
        return generatePhrase(words);
      },
      async wordlist() {
        await wait();
        return [...WORDS];
      },
      async setup(input) {
        await beforeSetup();
        const fields: Record<string, string> = {};
        const password = input.password || null;
        if (password !== null && password.length < MIN_PASSWORD) fields.password = `Use at least ${MIN_PASSWORD} characters.`;
        if (!CODENAME_PATTERN.test(input.codename)) fields.codename = 'Use exactly 8 lowercase letters or digits.';
        let seed: string | null = null;
        if (input.mode === 'admin') {
          try {
            seed = await adminSeed(input);
          } catch (error) {
            if (error instanceof ApiError) Object.assign(fields, error.fields);
            else throw error;
          }
        }
        if (Object.keys(fields).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', fields);
        const identityHash = seed !== null ? await identityFromSeed(seed) : bootIdentity();
        save({ password, codename: input.codename, identityHash, mode: input.mode, loggedIn: true });
        resetSwitches();
        resetWifi();
      },
      async login(password) {
        await wait();
        if (!persisted) throw new ApiError('conflict', 'This device is not set up yet.');
        if (persisted.password !== null && password !== persisted.password) throw new ApiError('unauthenticated', 'Wrong password.');
        save({ ...persisted, loggedIn: true });
      },
      async logout() {
        await wait();
        if (persisted) save({ ...persisted, loggedIn: false });
      },
    },

    device: {
      get: authed(() => ({
        serial: MOCK_SERIAL,
        codename: persisted!.codename,
        hostname: `kaonic-${persisted!.codename.slice(-4)}`,
        model: 'Kaonic 1S r30',
        identityHash: persisted!.identityHash ?? bootIdentity(),
        versions: { hub: installer.hubVersion(), os: 'kaonic-os 2026.09', webui: '0.1.0' },
        uptimeSecs: uptimeSecs(),
        radioModules: 2,
        isAdmin: (persisted!.mode ?? 'admin') === 'admin',
      })),
      reboot: authed(() => undefined),
      factoryReset: authed((password: string) => {
        // A wrong password here is a mistake in a form, not a lost session.
        if (persisted!.password !== null && password !== persisted!.password) throw new ApiError('validation_failed', 'Wrong password.', { password: 'Wrong password.' });
        eraseEverything();
      }),
    },

    system: {
      // The mock is always the admin once signed in.
      report: authed(() =>
        [
          'Kaonic system report',
          `  ${'Generated'.padEnd(30)} ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
          '',
          'Device',
          `  ${'Model'.padEnd(30)} Kaonic 1S r30`,
          `  ${'Serial'.padEnd(30)} ${MOCK_SERIAL}`,
          `  ${'Codename'.padEnd(30)} ${persisted!.codename}`,
          '',
          'Kaonic software',
          `  ${'Hub'.padEnd(30)} ${installer.hubVersion()} (system image)`,
          `  ${'Web UI'.padEnd(30)} 0.1.0`,
          '',
          'OS',
          `  ${'OS version'.padEnd(30)} kaonic-os 2026.09`,
          '',
          'Plugins',
          ...installer.plugins.list().map((plugin) => `  ${plugin.id.padEnd(30)} ${plugin.version} ${plugin.official ? 'signed' : 'unsigned'}`),
          '',
        ].join('\n'),
      ),
      metrics: authed(metrics),
      services: authed(() => services),
      restartService: authed((unit: string) => {
        const service = services.find((candidate) => candidate.unit === unit);
        if (!service) throw new ApiError('not_found', 'Unknown service.');
        service.state = 'active';
        return service;
      }),
      boot: authed(() => boot.state()),
      setBootNext: authed((slot: BootSlotId, mode: BootMode, password: string) => boot.setNext(slot, mode, password)),
      uploadBootImage: async (kind: 'kernel' | 'dtb', file: Blob) => {
        await authed(() => undefined)();
        return boot.upload(kind, file);
      },
      stagedBoot: authed(() => boot.staged()),
      discardStagedBoot: authed(() => boot.discard()),
      installKernel: authed((options: KernelInstallOptions) => boot.install(options)),
      bootJob: authed((id: string) => boot.job(id)),
    },

    network: {
      get: authed(networkState),
      setSource: authed((id: SourceId, enabled: boolean) => {
        if (enabled) {
          enabledSources.add(id);
          // The single USB port is either a computer or a phone.
          if (id === 'usb_phone') enabledConsumers.delete('usb_computer');
          // A device cannot take internet from the mesh and give it back.
          if (id === 'mesh_gateway') enabledConsumers.delete('mesh_peers');
        } else {
          enabledSources.delete(id);
        }
        return networkState();
      }),
      setConsumer: authed((id: ConsumerId, enabled: boolean) => {
        if (enabled) {
          enabledConsumers.add(id);
          if (id === 'usb_computer') enabledSources.delete('usb_phone');
          if (id === 'mesh_peers') enabledSources.delete('mesh_gateway');
        } else {
          enabledConsumers.delete(id);
        }
        return networkState();
      }),
    },

    wifi: {
      get: authed(wifiConfig),
      lastScan: authed(() => ({ scannedTs, networks: scannedTs === null ? [] : scanEntries() })),
      async scan() {
        await wait();
        if (!persisted?.loggedIn) throw new ApiError('unauthenticated', 'Sign in to continue.');
        if (!enabledSources.has('wifi_client')) throw new ApiError('unavailable', 'Switch on the Wi-Fi network to scan.');
        // A real scan sweeps the channels; make it feel like one.
        if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, 1600));
        scannedTs = Math.floor(Date.now() / 1000);
        return clone(scanEntries());
      },
      join: authed((network: WifiNetworkInput) => {
        const ssid = network.ssid.trim();
        if (ssid.length === 0 || ssid.length > 32) throw new ApiError('validation_failed', 'Check the highlighted fields.', { ssid: 'Use 1 to 32 characters.' });
        if (network.password !== null) checkWifiPassword(network.password, 'password');
        const previous = savedWifi.find((saved) => saved.ssid === ssid);
        const entry: MockSaved = { ssid, password: network.password, hidden: network.hidden ?? false, autoConnect: previous?.autoConnect ?? true, lastConnectedTs: previous?.lastConnectedTs ?? null, problem: null };
        savedWifi = [entry, ...savedWifi.filter((saved) => saved.ssid !== ssid)];
        pinned = ssid;
        attempt = nearby(ssid) ? null : { ssid, reason: 'not_found', ts: Math.floor(Date.now() / 1000) };
        return wifiChanged();
      }),
      connect: authed((ssid: string) => {
        const network = savedNetwork(ssid);
        network.problem = null;
        pinned = ssid;
        if (!nearby(ssid)) attempt = { ssid, reason: 'not_found', ts: Math.floor(Date.now() / 1000) };
        return wifiChanged();
      }),
      update: authed((ssid: string, patch: WifiNetworkPatch) => {
        const network = savedNetwork(ssid);
        if (patch.password !== undefined) {
          if (patch.password !== null) checkWifiPassword(patch.password, 'password');
          network.password = patch.password;
          network.problem = null;
        }
        if (patch.autoConnect !== undefined) network.autoConnect = patch.autoConnect;
        return wifiChanged();
      }),
      forget: authed((ssid: string) => {
        savedNetwork(ssid);
        savedWifi = savedWifi.filter((network) => network.ssid !== ssid);
        if (pinned === ssid) pinned = null;
        return wifiChanged();
      }),
      reorder: authed((ssids: string[]) => {
        const known = new Set(savedWifi.map((network) => network.ssid));
        if (ssids.length !== known.size || new Set(ssids).size !== ssids.length || ssids.some((ssid) => !known.has(ssid))) {
          throw new ApiError('validation_failed', 'List every saved network exactly once.', { ssids: 'List every saved network exactly once.' });
        }
        savedWifi = ssids.map((ssid) => savedWifi.find((network) => network.ssid === ssid)!);
        return wifiChanged();
      }),
      unpin: authed(() => {
        pinned = null;
        return wifiChanged();
      }),
      setHotspot: authed((config: HotspotConfig) => {
        const ssid = config.ssid.trim();
        if (ssid.length === 0 || ssid.length > 32) throw new ApiError('validation_failed', 'Check the highlighted fields.', { ssid: 'Use 1 to 32 characters.' });
        if (config.password !== null) checkWifiPassword(config.password, 'password');
        hotspot = { ...hotspot, ssid, password: config.password };
        return wifiChanged();
      }),
    },

    radio: {
      bands: authed(() => radio),
      updateBand: authed((id, config) => {
        const band = checkBand(id, config);
        band.config = { ...band.config, ...config };
        return refreshFilter(band);
      }),
      setBandFilter: authed((id, filter) => {
        const band = radio.find((candidate) => candidate.id === id);
        if (!band) throw new ApiError('not_found', 'Unknown radio band.');
        const count = band.filters?.length ?? 0;
        if (filter !== 'auto' && !(Number.isInteger(filter) && filter >= 0 && filter < count)) {
          throw new ApiError('validation_failed', 'Check the fields.', {
            filter: count ? `This radio has filters 0 to ${count - 1}, or auto.` : 'This band has no filter to choose; use auto.',
          });
        }
        band.filter = filter;
        return refreshFilter(band);
      }),
      updateBandEverywhere: authed((id, config) => {
        const band = checkBand(id, config);
        if (!band.usedBy.includes('mesh')) {
          throw new ApiError('validation_failed', 'Only the mesh band is changed on every node.', { scope: 'Set other bands per node.' });
        }
        const switchAt = Date.now() + 10_000;
        band.pendingSwitch = { at: switchAt, switched: false, config };
        // The mock switches on time and hears the other nodes straight away.
        setTimeout(() => {
          band.config = { ...band.config, ...config };
          band.pendingSwitch = null;
          refreshFilter(band);
        }, 10_000);
        return { switchAt, nodes: peers.filter((peer) => peer.trust.network === 'ours').length };
      }),
      startTest: authed((id, request) => {
        const band = bandById(id);
        if (band.config.modulation.kind === 'off') throw new ApiError('conflict', 'This band is switched off. Choose a modulation to turn it on first.');
        const problems = testProblems(request);
        if (Object.keys(problems).length) throw new ApiError('validation_failed', 'Check the highlighted fields.', problems);
        stopTest(band);
        const payload = testPayload(request.message, request.format);
        const bytes = 'bytes' in payload ? payload.bytes.length : 0;
        const repeat = request.intervalMs !== undefined;
        const test = { running: repeat, sent: repeat ? 0 : 1, failed: 0, bytes, intervalMs: request.intervalMs ?? null, count: request.count ?? null, startedAt: Date.now(), lastError: null };
        band.test = test;
        if (repeat) {
          const send = () => {
            if (!band.test?.running) return;
            const sent = band.test.sent + 1;
            const done = band.test.count !== null && sent >= band.test.count;
            band.test = { ...band.test, sent, running: !done };
            if (done) stopTest(band);
          };
          testTimers.set(band.id, setInterval(send, request.intervalMs));
          send();
        }
        return band.test;
      }),
      test: authed((id) => bandById(id).test ?? null),
      stopTest: authed((id) => {
        const band = bandById(id);
        stopTest(band);
        return band.test ?? null;
      }),
      setMeshRadio: authed((module) => {
        const from = radio.find((band) => band.usedBy.includes('mesh'));
        if (!from) throw new ApiError('unavailable', 'The mesh is not running on this hub, so there is nothing to move.');
        const to = radio.find((band) => band.module === module && band.range === from.range);
        if (!to) throw new ApiError('validation_failed', 'Check the fields.', { module: 'Use 0 (radio A) or 1 (radio B).' });
        if (to === from) return { interface: to.interface ?? to.id, restarting: false };
        stopTest(to);
        to.config = { ...from.config };
        to.filter = from.filter ?? 'auto';
        to.usedBy = from.usedBy;
        from.usedBy = [];
        refreshFilter(to);
        return { interface: to.interface ?? to.id, restarting: true };
      }),
      stats: authed(bandStats),
      frames: authed((options: { band?: BandId; limit?: number } = {}) => {
        const limit = Math.min(500, Math.max(1, options.limit ?? 100));
        return framesHeld()
          .filter((frame) => !options.band || frame.band === options.band)
          .slice(-limit);
      }),
    },

    ptt: {
      get: authed(() => ptt.api.get()),
      updateSettings: authed((patch: Parameters<HubApi['ptt']['updateSettings']>[0]) => ptt.api.updateSettings(patch)),
      testTone: authed(() => ptt.api.testTone()),
      createSession: authed(() => ptt.api.createSession()),
      devices: authed(() => ptt.api.devices()),
      key: authed(() => ptt.api.key()),
      unkey: authed(() => ptt.api.unkey()),
      testWav: authed(() => ptt.api.testWav()),
      // The header is read first: `authed` clones what it returns, so it cannot wait on the file.
      uploadTestWav: async (file: Blob) => {
        const header = await file.slice(0, 4096).arrayBuffer();
        return authed(() => ptt.api.uploadTestWav(header, file.size))();
      },
      deleteTestWav: authed(() => ptt.api.deleteTestWav()),
      startTestTx: authed((options: { source: 'wav' | 'tone'; loop: boolean }) => ptt.api.startTestTx(options)),
      stopTestTx: authed(() => ptt.api.stopTestTx()),
      audio(options, audioHandlers) {
        if (!persisted?.loggedIn) {
          // As the hub does when the session has ended: closed, for good.
          setTimeout(() => audioHandlers.onState?.('closed'), 0);
          return { state: () => 'closed', listen: () => undefined, key: () => undefined, unkey: () => undefined, sendFrame: () => undefined, close: () => undefined };
        }
        return ptt.api.audio(options, audioHandlers);
      },
    },

    vpn: {
      get: authed(vpnState),
      packets: authed((limit: number = 64) => newVpnPackets().slice(0, Math.min(256, Math.max(1, limit)))),
      capture: authed(() => vpnCapture.state()),
      startCapture: authed((options?: VpnCaptureOptions) => vpnCapture.start(options)),
      stopCapture: authed(() => vpnCapture.stop()),
      capturePackets: authed((after: number, limit?: number) => vpnCapture.packets(after, limit)),
      capturePcap: async () => {
        await wait();
        if (!persisted?.loggedIn) throw new ApiError('unauthenticated', 'Sign in to continue.');
        return vpnCapture.pcap();
      },
      updateSettings: authed(updateVpnSettings),
      setRoutes: authed(setVpnRoutes),
      setUplink: authed(setVpnUplink),
      setGateway: authed(setVpnGateway),
    },

    peers: {
      list: authed(() => peers),
      setList: authed(setList),
    },

    nodes: {
      details: authed((id: string): NodeDetails => {
        const peer = managed(id);
        if (!peer.online) throw new ApiError('unavailable', `${peer.codename} is out of range.`);
        const uptimeSecs = 3600 * (2 + (peer.codename.charCodeAt(4) % 40));
        const battery = { percent: 35 + (peer.codename.charCodeAt(5) % 60), charging: false };
        return {
          id,
          codename: peer.codename,
          version: peer.version,
          osVersion: 'Kaonic OS 1.4.0',
          uptimeSecs,
          battery,
          bands: bandsOf(id),
          metrics: { cpuPercent: 12 + (peer.codename.charCodeAt(3) % 30), ramUsedMb: 150, ramTotalMb: 427, fsFreeMb: 2310, fsTotalMb: 3520, uptimeSecs, battery },
          ptt: { ...pttOf(id) },
          sharing: nodeSharingView(id),
        };
      }),
      release: authed(() => RELEASE),
      jobs: authed(() => jobs),
      updateSoftware: authed((ids: string[]) => startJobs(ids, 'update', (peer) => void (peer.version = RELEASE.version))),
      setRadio: authed((ids: string[], band: BandId, config: RadioConfig) => {
        const limits = seedRadio().find((candidate) => candidate.id === band)!;
        if (config.modulation.kind !== 'off' && (config.frequencyHz < limits.minHz || config.frequencyHz > limits.maxHz)) {
          throw new ApiError('validation_failed', 'The radio would reject this frequency.', { frequencyHz: `Use a frequency between ${limits.minHz / 1e6} and ${limits.maxHz / 1e6} MHz.` });
        }
        return startJobs(ids, 'radio', (peer) => {
          const target = bandsOf(peer.id).find((candidate) => candidate.id === band);
          if (target) target.config = clone(config);
        });
      }),
      restart: authed((ids: string[]) => startJobs(ids, 'restart', () => undefined)),
      setPtt: authed((ids: string[], settings: RemotePttSettings) => startJobs(ids, 'ptt', (peer) => void nodePtt.set(peer.id, { ...pttOf(peer.id), ...settings }))),
      setCodename: authed((id: string, codename: string) => {
        if (!/^[a-z0-9]{8}$/.test(codename)) throw new ApiError('validation_failed', 'Check the highlighted fields.', { codename: 'Use exactly 8 lowercase letters or digits.' });
        const peer = managed(id);
        if (!peer.online) throw new ApiError('unavailable', `${peer.codename} is out of range.`);
        peer.codename = codename;
        emit('peers', peers);
      }),
      setUplink: authed((id: string, input: VpnUplinkInput): VpnUplink => {
        const peer = managed(id);
        if (!peer.online) throw new ApiError('unavailable', `${peer.codename} is out of range.`);
        failIf(checkUplink(input));
        if (input.enabled && sharingOf(id).gateway.enabled) failIf({ enabled: "This node is a gateway: it cannot use another one's uplink at the same time." });
        sharingOf(id).uplink = { ...input, routes: [...input.routes] };
        return nodeSharingView(id).uplink;
      }),
      setGateway: authed((id: string, input: VpnGatewayInput): VpnGateway => {
        const peer = managed(id);
        if (!peer.online) throw new ApiError('unavailable', `${peer.codename} is out of range.`);
        failIf(checkGateway(input));
        if (input.enabled && sharingOf(id).uplink.enabled) failIf({ enabled: "This node uses another node's uplink: turn that off first." });
        sharingOf(id).gateway = { ...input, routes: [...input.routes] };
        return nodeSharingView(id).gateway;
      }),
      async openShell(id, password, _size, handlers) {
        await wait();
        if (!persisted?.loggedIn) throw new ApiError('unauthenticated', 'Sign in to continue.');
        if (password !== persisted.password) throw new ApiError('validation_failed', 'Check the highlighted fields.', { password: 'This is not the password.' });
        const peer = managed(id);
        if (!peer.online) throw new ApiError('unavailable', `${peer.codename} is out of range.`);
        return createMockShell(peer.codename, handlers);
      },
    },
    plugins: {
      list: authed(() => installer.plugins.list()),
      act: authed((id: string, action: PluginAction) => installer.plugins.act(id, action)),
      // Checking, unpacking and starting take the installer a moment.
      install: slow((file: File, upload: PackageUpload) => installer.plugins.install(file, upload)),
      check: slow((file: File) => installer.plugins.check(file)),
      update: slow((id: string, file: File, upload: PackageUpload) => installer.plugins.update(id, file, upload)),
      remove: authed((id: string, keepData: boolean) => installer.plugins.remove(id, keepData)),
      open: authed((id: string) => installer.plugins.open(id)),
      policy: authed(() => installer.plugins.policy()),
      setPolicy: authed((requireSigned: boolean, password: string) => installer.plugins.setPolicy(requireSigned, password)),
    },

    software: {
      state: authed(() => installer.software.state()),
      updateHub: slow((file: File, upload: PackageUpload) => installer.software.updateHub(file, upload)),
      updateInstaller: slow((file: File, upload: PackageUpload) => installer.software.updateInstaller(file, upload)),
      updateProgram: slow((id: CoreProgramId, file: File, upload: PackageUpload) => installer.software.updateProgram(id, file, upload)),
      history: authed((filter?: { id?: string; limit?: number }) => installer.software.history(filter)),
    },

    events: {
      subscribe(topic, handler) {
        handlers[topic].add(handler);
        syncTimer();
        ptt.sync();
        return () => {
          handlers[topic].delete(handler);
          syncTimer();
          ptt.sync();
        };
      },
      connection: (): ConnectionState => 'open',
      onConnectionChange: () => () => undefined,
    },
  };
}
