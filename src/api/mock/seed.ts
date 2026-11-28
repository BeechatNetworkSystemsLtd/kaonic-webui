import type {
  ConsumerId,
  NodeNetwork,
  Peer,
  Plugin,
  SoftwareEvent,
  RadioBand,
  RadioCapability,
  RadioFilter,
  ServiceStatus,
  SourceId,
} from '../types';

/** The switches a freshly provisioned device starts with: hotspot and USB for your own devices, no internet. */
export const DEFAULT_SWITCHES: { sources: SourceId[]; consumers: ConsumerId[] } = { sources: [], consumers: ['hotspot', 'usb_computer'] };

const now = () => Math.floor(Date.now() / 1000);

const CAPABILITIES: RadioCapability[] = ['fcs', 'cca', 'frontend', 'fsk', 'qpsk', 'off'];
/** Range, limits and driver view of a band; a fresh copy for every seeded band. */
function shape(range: 'sub_ghz' | '2g4') {
  const rangesHz: [number, number][] =
    range === 'sub_ghz'
      ? [
          [389_500_000, 510_000_000],
          [779_000_000, 1_020_000_000],
        ]
      : [[2_400_000_000, 2_483_500_000]];
  return {
    range,
    minHz: rangesHz[0]![0],
    maxHz: rangesHz[rangesHz.length - 1]![1],
    rangesHz,
    capabilities: [...CAPABILITIES],
    state: 'idle',
    pendingSwitch: null,
    ...frontEnd(range),
  };
}
/** The kaonic1s r30's sub-GHz filters, in the board's order. */
export const R30_FILTERS: RadioFilter[] = [
  { index: 0, label: 'Wide 730–960 MHz', minMhz: 730, maxMhz: 960 },
  { index: 1, label: '868 MHz', minMhz: 862, maxMhz: 876 },
  { index: 2, label: '915 MHz', minMhz: 902, maxMhz: 928 },
];

/** The r30's front end: its range per band, and the filters on the sub-GHz bands. */
function frontEnd(range: 'sub_ghz' | '2g4') {
  return range === 'sub_ghz'
    ? { boardRangeMhz: [863, 928] as [number, number], filter: 'auto' as const, filters: R30_FILTERS.map((filter) => ({ ...filter })), activeFilter: null, filterState: 'ok' as const }
    : { boardRangeMhz: [2400, 2483.5] as [number, number], filter: 'auto' as const, filters: [], activeFilter: null, filterState: 'none' as const };
}

/** What the driver starts with on every band. */
const DRIVER = () => ({
  fcs: false,
  cca: { enabled: true, thresholdDbm: -80, listenUs: 0, retries: 96, backoffUs: 500 },
});

export function seedRadio(): RadioBand[] {
  return [
    {
      id: 'a_sub',
      module: 0,
      ...shape('sub_ghz'),
      interface: 'rf09_a',
      config: { frequencyHz: 869_535_000, channelSpacingHz: 200_000, channel: 11, modulation: { kind: 'ofdm', mcs: 3, option: 1 }, txPower: 25, ...DRIVER(), frontend: { agcMap: 2, agcTarget: 3, lnaBypass: false } },
      usedBy: ['mesh', 'vpn'],
      lastRssi: -71,
    },
    {
      id: 'a_24',
      module: 0,
      ...shape('2g4'),
      interface: 'rf24_a',
      config: { frequencyHz: 2_437_000_000, channelSpacingHz: 1_200_000, channel: 6, modulation: { kind: 'ofdm', mcs: 4, option: 2 }, txPower: 20, ...DRIVER(), frontend: { agcMap: 2, agcTarget: 3, lnaBypass: true } },
      usedBy: ['mesh'],
      lastRssi: -64,
    },
    {
      id: 'b_sub',
      module: 1,
      ...shape('sub_ghz'),
      interface: 'rf09_b',
      config: { frequencyHz: 915_000_000, channelSpacingHz: 200_000, channel: 0, modulation: { kind: 'off' }, txPower: 20, ...DRIVER(), frontend: { agcMap: 2, agcTarget: 3, lnaBypass: false } },
      usedBy: [],
      lastRssi: null,
    },
    {
      id: 'b_24',
      module: 1,
      ...shape('2g4'),
      interface: 'rf24_b',
      config: { frequencyHz: 2_462_000_000, channelSpacingHz: 1_200_000, channel: 11, modulation: { kind: 'qpsk', chipRateKhz: 1000, rateMode: 2 }, txPower: 18, ...DRIVER(), frontend: { agcMap: 2, agcTarget: 3, lnaBypass: true } },
      usedBy: [],
      lastRssi: -83,
    },
  ];
}

export function seedPeers(): Peer[] {
  const RIDGE = '5f1c9a0be27d4c318a66d0f4b9e3a172';
  const VEHICLE = 'c20e77b4915a4f0d93b1e8a6d5f40c2b';
  const NORTH = '9ab3d61f08c24e7fb5a2c4e19d7306f8';
  let made = 0;
  const peer: PeerFactory = (id, codename, tag, hops, viaId, rssi, kind, extra = {}) => ({
    id,
    codename,
    tag,
    online: hops !== null,
    // Each device turned up a little after the one before it; the last ones made are the newest.
    firstSeenTs: now() - 6 * 3600 + (made += 1) * 97,
    lastSeenTs: hops !== null ? now() : now() - 3 * 3600,
    // Trusted devices are on the whitelist; the rest wait for the operator to decide.
    list: kind === 'trusted' ? 'whitelist' : 'none',
    // A fleet is never all on the same release.
    version: ['0.9.6', '0.9.8', '0.9.8', '1.0.0'][made % 4]!,
    hops,
    viaId,
    rssi,
    rttMs: null,
    tunnelIp: null,
    trust: { network: NETWORK_OF[kind], isAdmin: false, provisioning: null },
    link: { state: kind === 'trusted' && hops !== null ? 'active' : 'none', detail: null },
    ...extra,
  });
  const named = [
    peer(RIDGE, 'kaon6v72', 'Ridge relay', 1, null, -68, 'trusted', { rttMs: 420, tunnelIp: '10.20.31.7' }),
    peer(VEHICLE, 'kaon3mxa', 'Vehicle 2', 2, RIDGE, -84, 'trusted', { rttMs: 1130, tunnelIp: '10.20.112.40' }),
    peer(NORTH, 'kaonq4tt', '', 1, null, -77, 'waiting'),
    peer('71c2e9d4a05b4f3e8d6a1b7c9e0f2a35', 'kaonb2ne', 'Gate', 1, null, -73, 'stranger'),
    peer('4d8a6f1e2b3c4a59978e0d1c2b3a4f5e', 'kaonw5kc', '', 2, RIDGE, -80, 'foreign'),
    peer('2e5b7c9d1f3a4b6c8d0e2f4a6b8c0d1e', 'kaonf0ra', 'Vehicle 5', 2, NORTH, -88, 'stranger'),
    peer('03e8f5a7c1b94d62a0f7e3b8c6d915a4', 'kaon8hzd', '', 3, VEHICLE, -91, 'waiting'),
    peer('e7d40b92a6f14c85b3190a7c5e2f8d61', 'kaon1pw9', 'Base camp', null, null, null, 'trusted', { tunnelIp: '10.20.8.201' }),
  ];
  const all = [...named, ...generatePeers(MOCK_PEER_COUNT - named.length, named, peer)];
  return [...all, ...farPeers(all, peer)];
}

const FAR_HOPS_KEY = 'kaonic-mock-far-hops';

/**
 * How far the test chain reaches, or 0 for none. Open the app once with
 * `?far-hops=127` in the address and the choice is remembered in this browser
 * (so it survives reloads and moving between pages); `?far-hops=0` turns it off.
 */
function farHopsWanted(): number {
  try {
    const asked = new URLSearchParams(location.search).get('far-hops');
    if (asked !== null) localStorage.setItem(FAR_HOPS_KEY, asked);
    const hops = Number(localStorage.getItem(FAR_HOPS_KEY));
    // Reticulum allows paths of up to 128 hops.
    return Number.isInteger(hops) && hops >= 2 && hops <= 128 ? hops : 0;
  } catch {
    // No address bar or no storage (tests, private windows): no chain.
    return 0;
  }
}

/**
 * A way to try the map with a very long path: a chain of relays, one device
 * per hop, from the furthest device already in the mesh out to the hop count
 * asked for. The last one is a trusted device, so traffic runs the whole chain.
 */
function farPeers(existing: Peer[], peer: PeerFactory): Peer[] {
  const hops = farHopsWanted();
  const furthest = existing.filter((candidate) => candidate.hops !== null && candidate.hops < hops).sort((a, b) => b.hops! - a.hops!)[0];
  if (hops === 0 || !furthest) return [];

  const chain: Peer[] = [];
  let via = furthest.id;
  for (let hop = furthest.hops! + 1; hop <= hops; hop += 1) {
    const last = hop === hops;
    const id = `fa50${hop.toString(16).padStart(4, '0')}${'0'.repeat(20)}${hop.toString().padStart(4, '0')}`;
    chain.push(peer(id, `relay${hop.toString().padStart(3, '0')}`, last ? 'Far outpost' : '', hop, via, -90, last ? 'trusted' : 'stranger'));
    via = id;
  }
  return chain;
}

/** How many devices the mock mesh has. Raise it to see how the map copes with a crowd. */
const MOCK_PEER_COUNT = 32;
/** The share of generated devices that are direct (1 hop) neighbours. */
const NEIGHBOUR_SHARE = 0.45;
/** Nothing in the mock is further away than this. */
const MAX_HOPS = 4;

/** A small repeatable random generator, so the mock mesh looks the same on every load. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Fills the mesh with made-up devices, each hanging off one that is already there. */
function generatePeers(count: number, existing: Peer[], peer: (...args: Parameters<PeerFactory>) => Peer): Peer[] {
  const random = seededRandom(7);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const hex = (length: number) => Array.from({ length }, () => pick('0123456789abcdef'.split(''))).join('');
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789'.split('');
  const all = [...existing];
  const made: Peer[] = [];

  for (let index = 0; index < count; index += 1) {
    const codename = `kaon${Array.from({ length: 4 }, () => pick(letters)).join('')}`;
    // One in ten is out of range; close to half of the rest are direct neighbours.
    const parents = all.filter((candidate) => candidate.hops !== null && candidate.hops < MAX_HOPS);
    const parent = random() < NEIGHBOUR_SHARE ? null : pick(parents);
    const lost = random() < 0.1;
    const hops = lost ? null : parent ? parent.hops! + 1 : 1;
    const created = peer(
      hex(32),
      codename,
      random() < 0.25 ? `Unit ${index + 1}` : '',
      hops,
      hops !== null && hops > 1 ? (parent?.id ?? null) : null,
      hops !== null ? Math.round(-58 - hops * 8 - random() * 10) : null,
      kindFor(random()),
    );
    // A few have been shut out.
    if (created.list === 'none' && random() < 0.12) created.list = 'blacklist';
    all.push(created);
    made.push(created);
  }
  return made;
}

/**
 * What the mock makes of a device: `trusted` is whitelisted and certified by our
 * admin, `waiting` announces that it waits for an admin, `foreign` belongs to
 * another admin, and a `stranger` has proven nothing yet.
 */
type PeerKind = 'trusted' | 'waiting' | 'foreign' | 'stranger';

const NETWORK_OF: Record<PeerKind, NodeNetwork> = { trusted: 'ours', waiting: 'unprovisioned', foreign: 'other', stranger: 'unknown' };

/** One roll of the dice decides a generated device's kind, so the mock mesh stays the same from load to load. */
function kindFor(roll: number): PeerKind {
  if (roll < 0.15) return 'trusted';
  if (roll < 0.27) return 'waiting';
  if (roll < 0.33) return 'foreign';
  return 'stranger';
}

type PeerFactory = (id: string, codename: string, tag: string, hops: number | null, viaId: string | null, rssi: number | null, kind: PeerKind, extra?: Partial<Peer>) => Peer;

export function seedServices(): ServiceStatus[] {
  return [
    { unit: 'kaonic-hub.service', name: 'Hub', state: 'active', version: '1.0.0-dev' },
    { unit: 'kaonic-commd.service', name: 'Radio control', state: 'active', version: '0.9.4' },
    { unit: 'kaonic-hub-installer.service', name: 'Plugin installer', state: 'active', version: null },
    { unit: 'kaonic-factory.service', name: 'Factory server', state: 'active', version: null },
  ];
}

/** A stand-in for a plugin's own web UI, so the embedded view has something to show. */
const SAMPLE_APP = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 24px; font: 15px/1.5 system-ui, sans-serif; background: var(--bg, #16171b); color: var(--text, #eee); }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: var(--text-muted, #a3a5ab); max-width: 60ch; margin: 0 0 12px; }
  code { color: var(--accent, #f2ca43); }
</style></head>
<body>
  <h1>Sample plugin page</h1>
  <p>This page is served by the plugin, not by the Kaonic UI. It runs in a sandboxed frame.</p>
  <p>Theme received from the host: <code id="theme">waiting…</code></p>
  <script>
    addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'kaonic:theme') return;
      for (const [name, value] of Object.entries(event.data.tokens)) document.documentElement.style.setProperty(name, value);
      document.getElementById('theme').textContent = Object.keys(event.data.tokens).length + ' tokens';
    });
    parent.postMessage({ type: 'kaonic:ready' }, '*');
  </script>
</body></html>`;

let sampleApp: string | null = null;

/** The page every mock plugin serves; made once, as the browser keeps it until the tab closes. */
export function sampleAppUrl(): string | null {
  if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  sampleApp ??= URL.createObjectURL(new Blob([SAMPLE_APP], { type: 'text/html' }));
  return sampleApp;
}

const DAY = 24 * 60 * 60;

export function seedPlugins(): Plugin[] {
  const now = Math.floor(Date.now() / 1000);
  const plugin = (fields: Pick<Plugin, 'id' | 'name' | 'version' | 'description' | 'developer' | 'official' | 'running' | 'permissions'> & Partial<Plugin>): Plugin => ({
    enabled: fields.running,
    removable: true,
    hasIcon: false,
    appUrl: null,
    channel: 'stable',
    url: null,
    service: `kaonic-plugin-${fields.id}.service`,
    installedTs: now - 12 * DAY,
    highestVersion: fields.version,
    previousVersion: null,
    ...fields,
  });
  return [
    plugin({
      id: 'atak-bridge',
      name: 'ATAK Bridge',
      version: '0.3.0',
      description: 'Carries ATAK position and chat messages across the mesh.',
      developer: 'Beechat Network',
      official: true,
      running: true,
      appUrl: '/apps/atak-bridge/',
      permissions: ['mesh', 'network'],
    }),
    plugin({
      id: 'audio-ptt',
      name: 'Push to talk',
      version: '0.2.1',
      description: 'Voice channels between whitelisted devices.',
      developer: 'Beechat Network',
      official: true,
      running: false,
      permissions: ['audio', 'realtime', 'mesh'],
    }),
    plugin({
      id: 'field-sensors',
      name: 'Field sensors',
      version: '0.9.0',
      description: 'Logs temperature and humidity from sensors on the USB port and shares the readings.',
      developer: 'Openfield Labs',
      official: false,
      running: false,
      channel: 'experimental',
      url: 'https://openfield.example/sensors',
      permissions: ['network'],
      installedTs: now - 2 * DAY,
    }),
    plugin({
      id: 'mesh-chat',
      name: 'Mesh chat',
      version: '1.1.0',
      description: 'Text rooms for everyone on the mesh, kept on each device so they work without internet.',
      developer: 'Beechat Network',
      official: true,
      running: true,
      appUrl: '/apps/mesh-chat/',
      permissions: ['mesh'],
      installedTs: now - DAY,
      previousVersion: '1.0.4',
    }),
    plugin({
      id: 'position-beacon',
      name: 'Position beacon',
      version: '0.4.2',
      description: 'Sends this device’s GPS position to whitelisted devices every minute.',
      developer: 'Beechat Network',
      official: true,
      running: false,
      appUrl: '/apps/position-beacon/',
      permissions: ['mesh'],
    }),
  ];
}

/** What the installer did before the mock started, newest first. */
export function seedSoftwareHistory(): SoftwareEvent[] {
  const now = Math.floor(Date.now() / 1000);
  const event = (ago: number, fields: Pick<SoftwareEvent, 'id' | 'action' | 'outcome'> & Partial<SoftwareEvent>): SoftwareEvent => ({
    time: now - ago,
    from: null,
    to: null,
    signed: true,
    actor: 'admin (192.168.10.20)',
    message: '',
    ...fields,
  });
  return [
    event(DAY, { id: 'mesh-chat', action: 'upgrade', outcome: 'done', from: '1.0.4', to: '1.1.0' }),
    event(DAY + 600, { id: 'mesh-chat', action: 'upgrade', outcome: 'rolled_back', from: '1.0.4', to: '1.0.5', message: 'mesh-chat 1.0.5 did not stay running; 1.0.4 is back' }),
    event(2 * DAY, { id: 'field-sensors', action: 'install', outcome: 'done', to: '0.9.0', signed: false }),
    event(3 * DAY, { id: 'audio-ptt', action: 'stop', outcome: 'done' }),
    event(5 * DAY, { id: 'atak-bridge', action: 'start', outcome: 'failed', message: 'kaonic-plugin-atak-bridge.service did not start', actor: 'boot' }),
    event(12 * DAY, { id: 'atak-bridge', action: 'install', outcome: 'done', to: '0.3.0' }),
  ];
}
