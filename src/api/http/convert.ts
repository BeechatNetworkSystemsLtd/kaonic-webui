import type {
  AuthState,
  Battery,
  Device,
  MeshPacket,
  Modulation,
  RadioCapability,
  NetworkState,
  NodeDetails,
  NodeJob,
  NodeJobKind,
  Peer,
  HubUpdate,
  Plugin,
  PluginPolicy,
  SoftwareEvent,
  SoftwareState,
  PttBurst,
  PttDevices,
  PttSession,
  PttSettings,
  PttState,
  PttTalker,
  PttTestWav,
  RadioBand,
  RadioBandStats,
  RadioConfig,
  RadioFrame,
  ServiceStatus,
  SetupInput,
  SystemMetrics,
  TrafficCounters,
  TrafficSample,
  VpnCapture,
  VpnCapturedPacket,
  VpnGateway,
  VpnGatewayInput,
  VpnPacket,
  VpnPeer,
  VpnShareSettings,
  VpnSharePatch,
  VpnState,
  VpnUplink,
  VpnUplinkInput,
  WifiConfig,
  WifiScanEntry,
  WifiScanResults,
} from '../types';
import type { PttAudioMessage } from '../client';
import type {
  WireAuthState,
  WireBattery,
  WireDevice,
  WireJob,
  WireMeshPacket,
  WireModulation,
  WireNetworkState,
  WirePeer,
  WireHubJob,
  WirePlugin,
  WirePluginPolicy,
  WireSoftware,
  WireSoftwareEvent,
  WirePttAudioMessage,
  WirePttDevices,
  WirePttSession,
  WirePttSettings,
  WirePttSettingsPatch,
  WirePttState,
  WirePttTalker,
  WirePttTestWav,
  WireRadioBand,
  WireRadioBandStats,
  WireRadioConfig,
  WireRadioFrame,
  WireRemoteDevice,
  WireServiceStatus,
  WireSetupInput,
  WireSystemMetrics,
  WireTrafficCounters,
  WireTrafficSample,
  WireVpnCapture,
  WireVpnCapturedPacket,
  WireVpnPacket,
  WireVpnPeer,
  WireVpnState,
  WireWifiConfig,
  WireWifiScanEntry,
  WireWifiScanResults,
  WireVpnGateway,
  WireVpnShareSettings,
  WireVpnUplink,
} from './wire';

/*
 * Wire format ↔ the UI's model. Pure functions, one per schema. Field names
 * change case; a few shapes change where the UI wants something simpler.
 */

/** `seed_password` → `seedPassword`. For the field names in validation errors. */
export function camelCase(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * The form field a validation error is about. The hub names nested fields by
 * path (`config.frequency_hz`); the UI's forms are flat, so the last part wins.
 */
export function fieldName(path: string): string {
  return camelCase(path.slice(path.lastIndexOf('.') + 1));
}

export const toAuthState = (wire: WireAuthState): AuthState => ({
  setupRequired: wire.setup_required,
  authenticated: wire.authenticated,
  role: wire.role,
});

export function fromSetupInput(input: SetupInput): WireSetupInput {
  const common = { password: input.password, codename: input.codename };
  return input.mode === 'admin' ? { mode: 'admin', ...common, seed_password: input.seedPassword } : { mode: 'member', ...common };
}

export const toDevice = (wire: WireDevice): Device => ({
  serial: wire.serial,
  codename: wire.codename,
  hostname: wire.hostname,
  model: wire.model,
  identityHash: wire.identity_hash,
  versions: { hub: wire.versions.hub, os: wire.versions.os, webui: wire.versions.webui },
  uptimeSecs: wire.uptime_secs,
  radioModules: wire.radio_modules,
  isAdmin: wire.is_admin ?? false,
});

const toBattery = (wire: WireBattery | null): Battery | null => (wire ? { percent: wire.percent, charging: wire.charging } : null);

export const toMetrics = (wire: WireSystemMetrics): SystemMetrics => ({
  cpuPercent: wire.cpu_percent,
  ramUsedMb: wire.ram_used_mb,
  ramTotalMb: wire.ram_total_mb,
  fsFreeMb: wire.fs_free_mb,
  fsTotalMb: wire.fs_total_mb,
  uptimeSecs: wire.uptime_secs,
  battery: toBattery(wire.battery),
});

export const toService = (wire: WireServiceStatus): ServiceStatus => ({ unit: wire.unit, name: wire.name, state: wire.state, version: wire.version });

export const toNetwork = (wire: WireNetworkState): NetworkState => ({
  activeSource: wire.active_source,
  sources: wire.sources.map((source) => ({ id: source.id, enabled: source.enabled, status: source.status, detail: source.detail })),
  consumers: wire.consumers.map((consumer) => ({
    id: consumer.id,
    enabled: consumer.enabled,
    status: consumer.status,
    detail: consumer.detail,
    clients: consumer.clients,
  })),
  lan: { address: wire.lan.address, subnet: wire.lan.subnet },
});

export const toWifi = (wire: WireWifiConfig): WifiConfig => ({
  client: {
    state: wire.client.state,
    ssid: wire.client.ssid,
    signalDbm: wire.client.signal_dbm,
    address: wire.client.address,
    pinned: wire.client.pinned,
    attempt: wire.client.attempt ? { ssid: wire.client.attempt.ssid, reason: wire.client.attempt.reason, ts: wire.client.attempt.ts } : null,
    scannedTs: wire.client.scanned_ts,
    fault: wire.client.fault,
  },
  saved: wire.saved.map((network) => ({
    ssid: network.ssid,
    secured: network.secured,
    autoConnect: network.auto_connect,
    inRange: network.in_range,
    signalDbm: network.signal_dbm,
    lastConnectedTs: network.last_connected_ts,
    problem: network.problem,
    retryTs: network.retry_ts,
  })),
  hotspot: { enabled: wire.hotspot.enabled, ssid: wire.hotspot.ssid, password: wire.hotspot.password, open: wire.hotspot.open },
  antenna: wire.antenna,
  antennaSupported: wire.antenna_supported,
});

export const toScanEntry = (wire: WireWifiScanEntry): WifiScanEntry => ({
  ssid: wire.ssid,
  signalDbm: wire.signal_dbm,
  security: wire.security,
  frequencyMhz: wire.frequency_mhz,
  saved: wire.saved,
});

export const toScanResults = (wire: WireWifiScanResults): WifiScanResults => ({ scannedTs: wire.scanned_ts, networks: wire.networks.map(toScanEntry) });

function toModulation(wire: WireModulation): Modulation {
  switch (wire.kind) {
    case 'ofdm':
      return { kind: 'ofdm', mcs: wire.mcs, option: wire.option };
    case 'qpsk':
      return { kind: 'qpsk', chipRateKhz: wire.chip_rate_khz, rateMode: wire.rate_mode };
    case 'fsk':
      return {
        kind: 'fsk',
        ...(wire.symbol_rate_khz !== undefined ? { symbolRateKhz: wire.symbol_rate_khz } : {}),
        ...(wire.modulation_index !== undefined ? { modulationIndex: wire.modulation_index } : {}),
        ...(wire.order !== undefined ? { order: wire.order } : {}),
        ...(wire.bt !== undefined ? { bt: wire.bt } : {}),
        ...(wire.fec !== undefined ? { fec: wire.fec } : {}),
        ...(wire.whitening !== undefined ? { whitening: wire.whitening } : {}),
        ...(wire.preamble !== undefined ? { preamble: wire.preamble } : {}),
      };
    default:
      return { kind: wire.kind };
  }
}

function fromModulation(modulation: Modulation): WireModulation {
  switch (modulation.kind) {
    case 'ofdm':
      return { kind: 'ofdm', mcs: modulation.mcs, option: modulation.option };
    case 'qpsk':
      return { kind: 'qpsk', chip_rate_khz: modulation.chipRateKhz, rate_mode: modulation.rateMode };
    case 'fsk':
      return {
        kind: 'fsk',
        ...(modulation.symbolRateKhz !== undefined ? { symbol_rate_khz: modulation.symbolRateKhz } : {}),
        ...(modulation.modulationIndex !== undefined ? { modulation_index: modulation.modulationIndex } : {}),
        ...(modulation.order !== undefined ? { order: modulation.order } : {}),
        ...(modulation.bt !== undefined ? { bt: modulation.bt } : {}),
        ...(modulation.fec !== undefined ? { fec: modulation.fec } : {}),
        ...(modulation.whitening !== undefined ? { whitening: modulation.whitening } : {}),
        ...(modulation.preamble !== undefined ? { preamble: modulation.preamble } : {}),
      };
    default:
      return { kind: modulation.kind };
  }
}

export const toRadioConfig = (wire: WireRadioConfig): RadioConfig => ({
  frequencyHz: wire.frequency_hz,
  channelSpacingHz: wire.channel_spacing_hz,
  channel: wire.channel,
  modulation: toModulation(wire.modulation),
  txPower: wire.tx_power,
  ...(wire.fcs !== undefined ? { fcs: wire.fcs } : {}),
  ...(wire.cca
    ? { cca: { enabled: wire.cca.enabled, thresholdDbm: wire.cca.threshold_dbm, listenUs: wire.cca.listen_us, retries: wire.cca.retries, backoffUs: wire.cca.backoff_us } }
    : {}),
  ...(wire.frontend ? { frontend: { agcMap: wire.frontend.agc_map, agcTarget: wire.frontend.agc_target, lnaBypass: wire.frontend.lna_bypass } } : {}),
});

export const fromRadioConfig = (config: RadioConfig): WireRadioConfig => ({
  frequency_hz: config.frequencyHz,
  channel_spacing_hz: config.channelSpacingHz,
  channel: config.channel,
  modulation: fromModulation(config.modulation),
  tx_power: config.txPower,
  ...(config.fcs !== undefined ? { fcs: config.fcs } : {}),
  ...(config.cca
    ? { cca: { enabled: config.cca.enabled, threshold_dbm: config.cca.thresholdDbm, listen_us: config.cca.listenUs, retries: config.cca.retries, backoff_us: config.cca.backoffUs } }
    : {}),
  ...(config.frontend ? { frontend: { agc_map: config.frontend.agcMap, agc_target: config.frontend.agcTarget, lna_bypass: config.frontend.lnaBypass } } : {}),
});

export const toBand = (wire: WireRadioBand): RadioBand => ({
  id: wire.id,
  module: wire.module,
  range: wire.range,
  minHz: wire.min_hz,
  maxHz: wire.max_hz,
  config: toRadioConfig(wire.config),
  usedBy: wire.used_by,
  lastRssi: wire.last_rssi,
  ...(wire.interface !== undefined ? { interface: wire.interface } : {}),
  ...(wire.state !== undefined ? { state: wire.state } : {}),
  ...(wire.ranges_hz ? { rangesHz: wire.ranges_hz } : {}),
  ...(wire.capabilities ? { capabilities: wire.capabilities as RadioCapability[] } : {}),
  ...(wire.pending_switch !== undefined
    ? { pendingSwitch: wire.pending_switch ? { at: wire.pending_switch.at_ts_ms, switched: wire.pending_switch.switched, config: toRadioConfig(wire.pending_switch.config) } : null }
    : {}),
  ...(wire.min_mhz !== undefined || wire.max_mhz !== undefined
    ? { boardRangeMhz: wire.min_mhz != null && wire.max_mhz != null ? ([wire.min_mhz, wire.max_mhz] as [number, number]) : null }
    : {}),
  ...(wire.filter !== undefined ? { filter: wire.filter } : {}),
  ...(wire.filters ? { filters: wire.filters.map((filter) => ({ index: filter.index, label: filter.label, minMhz: filter.min_mhz, maxMhz: filter.max_mhz })) } : {}),
  ...(wire.active_filter !== undefined ? { activeFilter: wire.active_filter } : {}),
  ...(wire.filter_state !== undefined ? { filterState: wire.filter_state } : {}),
});

export const toFrame = (wire: WireRadioFrame): RadioFrame => ({
  seq: wire.seq,
  ts: wire.ts_ms,
  band: wire.band,
  direction: wire.direction,
  rssi: wire.rssi,
  len: wire.len,
  frequencyHz: wire.frequency_hz,
  bandwidthHz: wire.bandwidth_hz,
  durationMs: wire.duration_ms,
  kind: wire.kind,
  hops: wire.hops,
  destination: wire.destination,
  destinationType: wire.destination_type,
  packetLen: wire.packet_len,
  peerId: wire.peer_id,
  peer: wire.peer_codename,
});

export const toBandStats = (wire: WireRadioBandStats): RadioBandStats => ({
  band: wire.band,
  interface: wire.interface,
  rxFrames: wire.rx_frames,
  rxPackets: wire.rx_packets,
  rxBytes: wire.rx_bytes,
  rxBps: wire.rx_bps,
  rxDecodeErrors: wire.rx_decode_errors,
  txFrames: wire.tx_frames,
  txPackets: wire.tx_packets,
  txBytes: wire.tx_bytes,
  txBps: wire.tx_bps,
  txErrors: wire.tx_errors,
  airtime: { rxPct: wire.airtime.rx_pct, txPct: wire.airtime.tx_pct },
  lastRssi: wire.last_rssi,
  noiseDbm: wire.noise_dbm,
  driver: { rxErrors: wire.driver.rx_errors, rxDropped: wire.driver.rx_dropped, txErrors: wire.driver.tx_errors, txDropped: wire.driver.tx_dropped },
});

const toCounters = (wire: WireTrafficCounters): TrafficCounters => ({
  txPackets: wire.tx_packets,
  txBytes: wire.tx_bytes,
  txBps: wire.tx_bps,
  rxPackets: wire.rx_packets,
  rxBytes: wire.rx_bytes,
  rxBps: wire.rx_bps,
  dropped: wire.dropped,
  lastTxTs: wire.last_tx_ts ?? null,
  lastRxTs: wire.last_rx_ts ?? null,
});

const toVpnPeer = (wire: WireVpnPeer): VpnPeer => ({
  peerId: wire.peer_id,
  codename: wire.codename,
  tag: wire.tag ?? '',
  tunnelIp: wire.tunnel_ip,
  state: wire.state,
  isGateway: wire.is_gateway,
  routes: wire.routes,
  counters: toCounters(wire.counters),
  arq: wire.arq
    ? {
        resent: wire.arq.resent ?? 0,
        fastResent: wire.arq.fast_resent ?? 0,
        givenUp: wire.arq.given_up ?? 0,
        duplicates: wire.arq.duplicates ?? 0,
        rttMs: wire.arq.rtt_ms ?? null,
      }
    : null,
  lastError: wire.last_error ?? null,
});

export const toVpn = (wire: WireVpnState): VpnState => ({
  enabled: wire.enabled,
  status: wire.status,
  interface: wire.interface ?? null,
  network: wire.network,
  tunnelIp: wire.tunnel_ip ?? null,
  counters: toCounters(wire.counters),
  peers: wire.peers.map(toVpnPeer),
  routes: {
    advertised: wire.routes?.advertised ?? [],
    localMappings: (wire.routes?.local_mappings ?? []).map((mapping) => ({ subnet: mapping.subnet, mappedSubnet: mapping.mapped_subnet, interface: mapping.interface ?? null })),
    remote: (wire.routes?.remote ?? []).map((route) => ({
      network: route.network,
      peerId: route.peer_id,
      status: route.status,
      installed: route.installed,
      lastSeenTs: route.last_seen_ts,
      reason: route.reason ?? null,
    })),
  },
  uplink: toVpnUplink(wire.uplink),
  gateway: toVpnGateway(wire.gateway),
  settings: wire.settings ? toVpnShare(wire.settings) : null,
  mtu: wire.mtu ?? null,
  lastError: wire.last_error ?? null,
});

export const toVpnUplink = (wire: WireVpnUplink | undefined): VpnUplink => ({
  enabled: wire?.enabled ?? false,
  active: wire?.active ?? false,
  peerId: wire?.peer_id ?? null,
  routes: wire?.routes ?? [],
  defaultRoute: wire?.default_route ?? true,
  detail: wire?.detail ?? null,
  gateways: (wire?.gateways ?? []).map((gateway) => ({ peerId: gateway.peer_id, codename: gateway.codename, routes: gateway.routes })),
});

export const toVpnGateway = (wire: WireVpnGateway | undefined): VpnGateway => ({
  enabled: wire?.enabled ?? false,
  active: wire?.active ?? false,
  egressInterface: wire?.egress_interface ?? null,
  routes: wire?.routes ?? [],
  availableInterfaces: wire?.available_interfaces ?? [],
  detail: wire?.detail ?? null,
});

const toVpnShare = (wire: WireVpnShareSettings): VpnShareSettings => ({
  shareLans: wire.share_lans,
  lanInterfaces: wire.lan_interfaces,
  mapLans: wire.map_lans,
  mappingPool: wire.mapping_pool,
  lanRouter: wire.lan_router,
  dnsServers: wire.dns_servers,
  advertise: wire.advertise ?? [],
});

/** The settings patch as the hub takes it: only what changed. */
export function fromVpnSharePatch(patch: VpnSharePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.shareLans !== undefined) out.share_lans = patch.shareLans;
  if (patch.lanInterfaces !== undefined) out.lan_interfaces = patch.lanInterfaces;
  if (patch.mapLans !== undefined) out.map_lans = patch.mapLans;
  if (patch.mappingPool !== undefined) out.mapping_pool = patch.mappingPool;
  if (patch.lanRouter !== undefined) out.lan_router = patch.lanRouter;
  if (patch.dnsServers !== undefined) out.dns_servers = patch.dnsServers;
  return out;
}

export const fromVpnUplink = (input: VpnUplinkInput) => ({ enabled: input.enabled, peer_id: input.peerId, default_route: input.defaultRoute, routes: input.routes });

export const fromVpnGateway = (input: VpnGatewayInput) => ({ enabled: input.enabled, egress_interface: input.egressInterface, routes: input.routes });

export const toVpnCapture = (wire: WireVpnCapture): VpnCapture => ({
  running: wire.running,
  startedTs: wire.started_ts_ms,
  stoppedTs: wire.stopped_ts_ms,
  snaplen: wire.snaplen,
  maxPackets: wire.max_packets,
  maxSecs: wire.max_secs,
  ring: wire.ring,
  packets: wire.packets,
  dropped: wire.dropped,
  bytes: wire.bytes,
  firstSeq: wire.first_seq ?? null,
  lastSeq: wire.last_seq ?? null,
});

/** Base64 to bytes, without a dependency. Tolerates missing padding. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export const toVpnCapturedPacket = (wire: WireVpnCapturedPacket): VpnCapturedPacket => ({
  seq: wire.seq,
  tsUs: wire.ts_us,
  direction: wire.dir,
  peerId: wire.peer_id,
  peerCodename: wire.peer_codename,
  flood: wire.flood ?? false,
  len: wire.len,
  data: fromBase64(wire.data),
  verdict: wire.verdict,
  reason: wire.reason ?? null,
});

export const toVpnPacket = (wire: WireVpnPacket): VpnPacket => ({
  ts: wire.ts_ms,
  direction: wire.dir,
  src: wire.src,
  dst: wire.dst,
  proto: wire.proto,
  sport: wire.sport ?? null,
  dport: wire.dport ?? null,
  len: wire.len,
});

export const toPeer = (wire: WirePeer): Peer => ({
  id: wire.id,
  codename: wire.codename,
  tag: wire.tag,
  online: wire.online,
  firstSeenTs: wire.first_seen_ts,
  lastSeenTs: wire.last_seen_ts,
  list: wire.list,
  version: wire.version,
  hops: wire.hops,
  viaId: wire.via_id,
  rssi: wire.rssi,
  rttMs: wire.link.rtt_ms,
  tunnelIp: wire.tunnel_ip,
  trust: {
    network: wire.trust.network,
    isAdmin: wire.trust.is_admin,
    provisioning: wire.trust.provisioning ? { state: wire.trust.provisioning.state, detail: wire.trust.provisioning.detail } : null,
  },
  link: { state: wire.link.state, detail: wire.link.detail },
});

export const toPacket = (wire: WireMeshPacket): MeshPacket => ({ ts: wire.ts_ms, kind: wire.kind, fromId: wire.from_id, toId: wire.to_id, bytes: wire.bytes });

export const toNodeDetails = (wire: WireRemoteDevice): NodeDetails => ({
  id: wire.id,
  codename: wire.codename ?? '',
  version: wire.version,
  osVersion: wire.os_version ?? '',
  uptimeSecs: wire.uptime_secs,
  battery: toBattery(wire.battery),
  bands: wire.bands.map(toBand),
  metrics: wire.metrics ? toMetrics(wire.metrics) : null,
  ptt: wire.ptt ? toPttSettings(wire.ptt) : null,
  sharing: wire.sharing ? { uplink: toVpnUplink(wire.sharing.uplink), gateway: toVpnGateway(wire.sharing.gateway), internet: wire.sharing.internet } : null,
});

const NODE_JOB_KINDS: Record<string, NodeJobKind> = { node_update: 'update', node_radio: 'radio', node_restart: 'restart', node_ptt: 'ptt' };

/** A job on another node, or null for the hub's other jobs (scans, scripts…), which the UI follows on its own. */
export function toNodeJob(wire: WireJob): NodeJob | null {
  const kind = NODE_JOB_KINDS[wire.kind];
  if (!kind || wire.node_id === null) return null;
  return {
    id: wire.id,
    nodeId: wire.node_id,
    kind,
    // The UI has no separate state for a cancelled job: it simply did not succeed.
    state: wire.state === 'cancelled' ? 'failed' : wire.state,
    progress: wire.state === 'done' ? 1 : (wire.progress ?? 0),
    detail: wire.detail ?? wire.error?.message ?? (wire.state === 'cancelled' ? 'Cancelled' : ''),
    createdTs: wire.created_ts,
  };
}

export const toPlugin = (wire: WirePlugin): Plugin => ({
  id: wire.id,
  name: wire.name,
  version: wire.version,
  description: wire.description,
  developer: wire.developer,
  official: wire.official,
  running: wire.running,
  appUrl: wire.app_url,
  enabled: wire.enabled,
  removable: wire.removable,
  hasIcon: wire.has_icon,
  channel: wire.channel ?? null,
  url: wire.url ?? null,
  permissions: wire.permissions ?? [],
  service: wire.service,
  installedTs: wire.installed_ts,
  highestVersion: wire.highest_version,
  previousVersion: wire.previous_version ?? null,
});

export const toPluginPolicy = (wire: WirePluginPolicy): PluginPolicy => ({ requireSigned: wire.require_signed, releaseKey: wire.release_key ?? null });

export const toHubUpdate = (wire: WireHubJob): HubUpdate => ({
  id: wire.id,
  version: wire.version,
  state: wire.state,
  message: wire.message,
  started: wire.started,
  finished: wire.finished ?? null,
});

export const toSoftware = (wire: WireSoftware): SoftwareState => ({
  hub: { version: wire.hub.version, fromUpdate: wire.hub.from_update },
  installer: { version: wire.installer.version ?? null, reachable: wire.installer.reachable },
  programs: (wire.programs ?? []).map((program) => ({
    id: program.id,
    name: program.name || program.id,
    description: program.description ?? '',
    running: program.running,
    version: program.version ?? null,
    fromUpdate: program.from_update,
  })),
  hubUpdate: wire.hub_update ? toHubUpdate(wire.hub_update) : null,
  releaseKey: wire.release_key ?? null,
});

export const toSoftwareEvent = (wire: WireSoftwareEvent): SoftwareEvent => ({
  time: wire.time,
  id: wire.id,
  action: wire.action,
  outcome: wire.outcome,
  from: wire.from ?? null,
  to: wire.to ?? null,
  signed: wire.signed ?? false,
  actor: wire.actor ?? null,
  message: wire.message ?? '',
});

export const toTraffic = (wire: WireTrafficSample): TrafficSample => {
  const rate = (id: keyof WireTrafficSample['channels']) => ({ rxBps: wire.channels[id].rx_bps, txBps: wire.channels[id].tx_bps });
  return { ts: wire.ts_ms, channels: { a_sub: rate('a_sub'), a_24: rate('a_24'), b_sub: rate('b_sub'), b_24: rate('b_24'), vpn: rate('vpn') } };
};

/* ── push-to-talk ── */

export const toPttTalker = (wire: WirePttTalker): PttTalker => ({
  id: wire.id,
  codename: wire.codename,
  isAdmin: wire.is_admin,
  local: wire.local,
  source: wire.source,
});

/** Every setting's wire name: one table both ways, so a field cannot be forgotten in one direction. */
export const PTT_SETTING_WIRE = {
  volume: 'volume',
  micGain: 'mic_gain',
  captureDevice: 'capture_device',
  playbackDevice: 'playback_device',
  talkInput: 'talk_input',
  playOnDevice: 'play_on_device',
  rxWhileTx: 'rx_while_tx',
  autoArm: 'auto_arm',
  squelchEnabled: 'squelch_enabled',
  squelchOpenDbfs: 'squelch_open_dbfs',
  squelchHysteresisDb: 'squelch_hysteresis_db',
  squelchHangoverMs: 'squelch_hangover_ms',
  squelchPrerollMs: 'squelch_preroll_ms',
  jitterTargetMs: 'jitter_target_ms',
  jitterMaxMs: 'jitter_max_ms',
  opusBitrateBps: 'opus_bitrate_bps',
  opusComplexity: 'opus_complexity',
  opusDtx: 'opus_dtx',
  opusFec: 'opus_fec',
  opusPacketLossPct: 'opus_packet_loss_pct',
  opusCbr: 'opus_cbr',
  packetFrames: 'packet_frames',
  packetFramesMax: 'packet_frames_max',
  packetAlignLdpc: 'packet_align_ldpc',
  relay: 'relay',
  ttl: 'ttl',
  spectrumEnabled: 'spectrum_enabled',
  spectrumBands: 'spectrum_bands',
} as const satisfies { [K in keyof PttSettings]: keyof WirePttSettings };

type SettingKey = keyof typeof PTT_SETTING_WIRE;

export function toPttSettings(wire: WirePttSettings): PttSettings {
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(PTT_SETTING_WIRE) as SettingKey[]) settings[key] = wire[PTT_SETTING_WIRE[key]];
  return settings as unknown as PttSettings;
}

/** Only the fields being changed: the hub refuses an empty or unknown field. */
export function fromPttSettings(patch: Partial<PttSettings>): WirePttSettingsPatch {
  const wire: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as SettingKey[]) {
    if (key in PTT_SETTING_WIRE && patch[key] !== undefined) wire[PTT_SETTING_WIRE[key]] = patch[key];
  }
  return wire as WirePttSettingsPatch;
}

export const toPttDevices = (wire: WirePttDevices): PttDevices => ({
  capture: wire.capture.map(({ name, description }) => ({ name, description })),
  playback: wire.playback.map(({ name, description }) => ({ name, description })),
});

export const toPttTestWav = (wire: WirePttTestWav): PttTestWav => ({
  durationMs: wire.duration_ms,
  sizeBytes: wire.size_bytes,
  uploadedTs: wire.uploaded_ts,
});

export const toPtt = (wire: WirePttState): PttState => ({
  status: wire.status,
  detail: wire.detail,
  self: { id: wire.self.id, isAdmin: wire.self.is_admin },
  group: { name: wire.group.name, epoch: wire.group.epoch, members: wire.group.members },
  floor: {
    state: wire.floor.state,
    talker: wire.floor.talker ? toPttTalker(wire.floor.talker) : null,
    sinceTs: wire.floor.since_ts_ms,
    level: wire.floor.level,
  },
  settings: toPttSettings(wire.settings),
  audio: { device: wire.audio.device, codec: wire.audio.codec },
  recent: wire.recent.map(
    (burst): PttBurst => ({
      talker: toPttTalker(burst.talker),
      startedTs: burst.started_ts_ms,
      durationMs: burst.duration_ms,
      frames: burst.frames,
      lostFrames: burst.lost_frames,
      hops: burst.hops,
      ended: burst.ended,
    }),
  ),
  stats: {
    txPackets: wire.stats.tx_packets,
    rxPackets: wire.stats.rx_packets,
    relayed: wire.stats.relayed,
    suppressed: wire.stats.suppressed,
    duplicates: wire.stats.duplicates,
  },
});

export const toPttSession = (wire: WirePttSession): PttSession => ({
  token: wire.token,
  udpPort: wire.udp_port,
  sampleRateHz: wire.sample_rate_hz,
  frameMs: wire.frame_ms,
  samplesPerFrame: wire.samples_per_frame,
  keepaliveIntervalMs: wire.keepalive_interval_ms,
  unkeyTimeoutMs: wire.unkey_timeout_ms,
});

export function toPttAudioMessage(wire: WirePttAudioMessage): PttAudioMessage {
  switch (wire.type) {
    case 'busy':
    case 'talker':
      return { type: wire.type, talker: wire.talker ? toPttTalker(wire.talker) : null };
    case 'unkeyed':
      return { type: 'unkeyed', reason: wire.reason };
    default:
      return { type: 'keyed' };
  }
}
