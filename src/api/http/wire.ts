/*
 * The hub's wire format: the schemas of `kaonic-hub/docs/api/openapi.yaml`
 * (v1) that the UI uses, as the hub sends them (snake_case). Nothing outside
 * `api/http/` sees these; `convert.ts` turns them into the UI's model.
 *
 * Keep this file in step with the spec. Fields the UI does not read are left
 * out; the hub may send more, and new optional fields never break a client.
 */

export type Hash = string;

export interface WireError {
  code: string;
  message: string;
  details?: { fields?: Record<string, string>; retry_after_secs?: number } | null;
}

/* ── setup / auth ── */

export interface WireAuthState {
  setup_required: boolean;
  authenticated: boolean;
  role: 'admin' | 'viewer' | null;
  csrf_token: string | null;
}

export interface WireSetupIdentity {
  identity_hash: Hash;
  public_identity: string;
}

export type WireSetupInput =
  | { mode: 'member'; password: string; codename: string }
  | { mode: 'admin'; password: string; codename: string; seed_password: string };

/* ── device / system ── */

export interface WireDevice {
  serial: string;
  codename: string;
  hostname: string;
  model: string;
  identity_hash: Hash;
  api_version: string;
  versions: { hub: string; os: string; webui: string | null };
  uptime_secs: number;
  radio_modules: number;
  /** Absent from hubs older than the field. */
  is_admin?: boolean;
}

export interface WireBattery {
  percent: number;
  charging: boolean;
}

export interface WireSystemMetrics {
  cpu_percent: number;
  ram_used_mb: number;
  ram_total_mb: number;
  fs_free_mb: number;
  fs_total_mb: number;
  uptime_secs: number;
  battery: WireBattery | null;
}

export interface WireServiceStatus {
  unit: string;
  name: string;
  state: 'active' | 'inactive' | 'failed';
  version: string | null;
}

/* ── network / Wi-Fi ── */

export type WireSourceId = 'wifi_client' | 'usb_phone' | 'mesh_gateway';
export type WireConsumerId = 'hotspot' | 'usb_computer' | 'mesh_peers';
export type WirePortState = 'active' | 'standby' | 'waiting' | 'off';

export interface WireNetworkState {
  active_source: WireSourceId | null;
  sources: Array<{ id: WireSourceId; enabled: boolean; status: WirePortState; detail: string }>;
  consumers: Array<{ id: WireConsumerId; enabled: boolean; status: WirePortState; detail: string; clients: number }>;
  lan: { address: string; subnet: string };
}

export interface WireNetworkPatch {
  sources?: Partial<Record<WireSourceId, boolean>>;
  consumers?: Partial<Record<WireConsumerId, boolean>>;
}

export type WireWifiProblem = 'wrong_password' | 'not_found' | 'rejected' | 'timeout' | 'no_address';

export interface WireWifiConfig {
  client: {
    state: 'off' | 'searching' | 'connecting' | 'connected';
    ssid: string | null;
    signal_dbm: number | null;
    address: string | null;
    pinned: string | null;
    attempt: { ssid: string; reason: WireWifiProblem; ts: number } | null;
    scanned_ts: number | null;
    fault: string | null;
  };
  saved: Array<{
    ssid: string;
    secured: boolean;
    auto_connect: boolean;
    in_range: boolean;
    signal_dbm: number | null;
    last_connected_ts: number | null;
    problem: WireWifiProblem | null;
    retry_ts: number | null;
  }>;
  hotspot: { enabled: boolean; ssid: string; password: string | null; open: boolean };
  antenna: 'internal' | 'external';
  antenna_supported: boolean;
}

export interface WireWifiScanEntry {
  ssid: string;
  signal_dbm: number;
  security: 'open' | 'wpa2' | 'wpa3';
  frequency_mhz: number;
  saved: boolean;
}

export interface WireWifiScanResults {
  scanned_ts: number | null;
  networks: WireWifiScanEntry[];
}

/* ── radio ── */

export type WireBandId = 'a_sub' | 'a_24' | 'b_sub' | 'b_24';

export type WireModulation =
  | { kind: 'off' }
  | { kind: 'fsk'; symbol_rate_khz?: number; modulation_index?: number; order?: 2 | 4; bt?: number; fec?: boolean; whitening?: boolean; preamble?: number }
  | { kind: 'ofdm'; mcs: number; option: number }
  | { kind: 'qpsk'; chip_rate_khz: number; rate_mode: number };

export interface WireRadioConfig {
  frequency_hz: number;
  channel_spacing_hz: number;
  channel: number;
  modulation: WireModulation;
  tx_power: number;
  fcs?: boolean;
  cca?: { enabled: boolean; threshold_dbm: number; listen_us: number; retries: number; backoff_us: number };
  frontend?: { agc_map: number; agc_target: number; lna_bypass: boolean };
}

export interface WireRadioBand {
  id: WireBandId;
  module: 0 | 1;
  range: 'sub_ghz' | '2g4';
  min_hz: number;
  max_hz: number;
  config: WireRadioConfig;
  used_by: string[];
  last_rssi: number | null;
  interface?: string;
  state?: string | null;
  ranges_hz?: [number, number][];
  capabilities?: string[];
  pending_switch?: { at_ts_ms: number; switched: boolean; config: WireRadioConfig } | null;
}

export interface WireRadioFrame {
  seq: number;
  ts_ms: number;
  band: WireBandId;
  direction: 'rx' | 'tx';
  rssi: number | null;
  len: number;
  frequency_hz: number;
  bandwidth_hz: number;
  duration_ms: number;
  kind: 'announce' | 'data' | 'link_request' | 'proof' | 'segment' | 'corrupt';
  hops: number | null;
  destination: Hash | null;
  destination_type: 'single' | 'group' | 'plain' | 'link' | null;
  packet_len: number | null;
  peer_id: Hash | null;
  peer_codename: string | null;
}

export interface WireRadioBandStats {
  band: WireBandId;
  interface: string;
  rx_frames: number;
  rx_packets: number;
  rx_bytes: number;
  rx_bps: number;
  rx_decode_errors: number;
  tx_frames: number;
  tx_packets: number;
  tx_bytes: number;
  tx_bps: number;
  tx_errors: number;
  airtime: { rx_pct: number; tx_pct: number };
  last_rssi: number | null;
  noise_dbm: number | null;
  driver: { rx_errors: number; rx_dropped: number; tx_errors: number; tx_dropped: number };
}

/* ── VPN ── */

export interface WireTrafficCounters {
  tx_packets: number;
  tx_bytes: number;
  tx_bps: number;
  rx_packets: number;
  rx_bytes: number;
  rx_bps: number;
  dropped: number;
  last_tx_ts?: number | null;
  last_rx_ts?: number | null;
}

export interface WireVpnPeer {
  peer_id: Hash;
  codename: string;
  tag?: string;
  tunnel_ip: string | null;
  state: 'discovered' | 'pending' | 'active' | 'closed' | 'error';
  is_gateway: boolean;
  routes: string[];
  counters: WireTrafficCounters;
  arq?: { resent?: number; fast_resent?: number; given_up?: number; duplicates?: number; rtt_ms?: number } | null;
  last_error?: string | null;
}

export interface WireVpnRemoteRoute {
  network: string;
  peer_id: Hash;
  status: string;
  installed: boolean;
  last_seen_ts: number;
  reason?: string | null;
}

export interface WireVpnState {
  enabled: boolean;
  status: 'running' | 'stopped' | 'error';
  interface?: string | null;
  network: string | null;
  tunnel_ip?: string | null;
  counters: WireTrafficCounters;
  peers: WireVpnPeer[];
  routes?: { advertised?: string[]; local_mappings?: WireVpnLanMapping[]; remote?: WireVpnRemoteRoute[] };
  uplink?: WireVpnUplink;
  gateway?: WireVpnGateway;
  settings?: WireVpnShareSettings;
  mtu?: number | null;
  last_error?: string | null;
}

export interface WireVpnLanMapping {
  subnet: string;
  mapped_subnet: string;
  interface?: string | null;
}

export interface WireVpnUplink {
  enabled: boolean;
  active: boolean;
  peer_id?: string | null;
  routes: string[];
  default_route: boolean;
  detail?: string | null;
  gateways?: Array<{ peer_id: string; codename: string; routes: string[] }>;
}

export interface WireVpnGateway {
  enabled: boolean;
  active: boolean;
  egress_interface?: string | null;
  routes: string[];
  available_interfaces: string[];
  detail?: string | null;
}

export interface WireVpnShareSettings {
  share_lans: boolean;
  lan_interfaces: string[];
  map_lans: boolean;
  mapping_pool: string;
  lan_router: 'auto' | 'always' | 'never';
  dns_servers: string[];
  advertise?: string[];
}

export interface WireVpnCapture {
  running: boolean;
  started_ts_ms: number | null;
  stopped_ts_ms: number | null;
  snaplen: number;
  max_packets: number;
  max_secs: number;
  ring: boolean;
  packets: number;
  dropped: number;
  bytes: number;
  first_seq?: number | null;
  last_seq?: number | null;
}

export interface WireVpnCapturedPacket {
  seq: number;
  ts_us: number;
  dir: 'tx' | 'rx';
  peer_id: Hash | null;
  peer_codename: string | null;
  flood?: boolean;
  len: number;
  /** Base64. */
  data: string;
  verdict: 'sent' | 'delivered' | 'dropped';
  reason?: string | null;
}

export interface WireVpnPacket {
  ts_ms: number;
  dir: 'tx' | 'rx';
  src: string;
  dst: string;
  proto: string;
  sport?: number | null;
  dport?: number | null;
  len: number;
}

/* ── mesh / peers ── */

export interface WirePeer {
  id: Hash;
  codename: string;
  tag: string;
  version: string;
  online: boolean;
  first_seen_ts: number;
  last_seen_ts: number;
  hops: number | null;
  via_id: Hash | null;
  rssi: number | null;
  list: 'whitelist' | 'blacklist' | 'none';
  trust: {
    network: 'ours' | 'other' | 'unprovisioned' | 'unknown';
    is_admin: boolean;
    provisioning: { state: 'running' | 'failed'; detail: string; updated_ts: number } | null;
  };
  link: { state: 'none' | 'pending' | 'active' | 'refused'; rtt_ms: number | null; detail: string | null };
  tunnel_ip: string | null;
}

export interface WireMeshPacket {
  ts_ms: number;
  kind: 'data' | 'announce' | 'relayed' | 'overheard';
  from_id: Hash | null;
  to_id: Hash | null;
  bytes: number;
}

export interface WireRemoteDevice {
  id: Hash;
  codename?: string;
  version: string;
  os_version?: string;
  uptime_secs: number;
  battery: WireBattery | null;
  bands: WireRadioBand[];
  metrics?: WireSystemMetrics | null;
  ptt?: WirePttSettings | null;
}

export type WireRemoteJobsInput =
  | { kind: 'node_update' | 'node_restart'; node_ids: Hash[] }
  | { kind: 'node_radio'; node_ids: Hash[]; band: WireBandId; config: WireRadioConfig }
  | { kind: 'node_ptt'; node_ids: Hash[]; settings: WirePttSettingsPatch };

/* ── plugins / updates / jobs ── */

export interface WirePlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  developer: string;
  official: boolean;
  running: boolean;
  app_url: string | null;
  enabled?: boolean;
  has_icon?: boolean;
  webview?: { port: number; tls: boolean } | null;
  channel?: string | null;
  adopted?: boolean;
}

export interface WireUpdates {
  release: { version: string; size_bytes: number } | null;
}

export interface WireJob {
  id: string;
  kind: string;
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  node_id: Hash | null;
  progress: number | null;
  detail: string | null;
  result?: unknown;
  error?: WireError | null;
  created_ts: number;
  updated_ts: number;
}

/* ── push-to-talk ── */

export interface WirePttTalker {
  id: Hash;
  codename: string;
  is_admin: boolean;
  local: boolean;
  source: 'device' | 'browser' | 'udp' | 'squelch' | 'test' | null;
}

export interface WirePttBurst {
  talker: WirePttTalker;
  started_ts_ms: number;
  duration_ms: number;
  frames: number;
  lost_frames: number;
  hops: number | null;
  ended: 'released' | 'preempted' | 'timeout';
}

export interface WirePttSettings {
  volume: number | null;
  mic_gain: number | null;
  capture_device: string;
  playback_device: string;
  talk_input: 'device' | 'browser';
  play_on_device: boolean;
  rx_while_tx: boolean;
  auto_arm: boolean;
  squelch_enabled: boolean;
  squelch_open_dbfs: number;
  squelch_hysteresis_db: number;
  squelch_hangover_ms: number;
  squelch_preroll_ms: number;
  jitter_target_ms: number;
  jitter_max_ms: number;
  opus_bitrate_bps: number;
  opus_complexity: number;
  opus_dtx: boolean;
  opus_fec: boolean;
  opus_packet_loss_pct: number;
  opus_cbr: boolean;
  packet_frames: number;
  packet_frames_max: number;
  packet_align_ldpc: boolean;
  relay: boolean;
  ttl: number;
  spectrum_enabled: boolean;
  spectrum_bands: number;
}

export interface WirePttDevices {
  capture: Array<{ name: string; description: string }>;
  playback: Array<{ name: string; description: string }>;
}

export interface WirePttTestWav {
  duration_ms: number;
  size_bytes: number;
  uploaded_ts: number;
}

export type WirePttSettingsPatch = Partial<WirePttSettings>;

export interface WirePttState {
  status: 'running' | 'unprovisioned' | 'error';
  detail: string | null;
  self: { id: Hash; is_admin: boolean };
  group: { name: string; epoch: number | null; members: number };
  floor: { state: 'idle' | 'talking' | 'receiving'; talker: WirePttTalker | null; since_ts_ms: number | null; level: number };
  settings: WirePttSettings;
  audio: { device: boolean; codec: string | null };
  recent: WirePttBurst[];
  stats: { tx_packets: number; rx_packets: number; relayed: number; suppressed: number; duplicates: number };
}

export interface WirePttSession {
  token: string;
  transport: 'udp';
  udp_port: number;
  format: 'pcm_s16le_mono';
  sample_rate_hz: number;
  frame_ms: number;
  samples_per_frame: number;
  keepalive_interval_ms: number;
  unkey_timeout_ms: number;
}

/** Control messages on the `/ptt/audio` socket, hub → client. */
export type WirePttAudioMessage =
  | { type: 'keyed' }
  | { type: 'busy'; talker: WirePttTalker | null }
  | { type: 'unkeyed'; reason: 'released' | 'preempted' | 'timeout' | 'forbidden' }
  | { type: 'talker'; talker: WirePttTalker | null };

/* ── events ── */

export interface WireTrafficSample {
  ts_ms: number;
  channels: Record<WireBandId | 'vpn', { rx_bps: number; tx_bps: number }>;
}

/** A topic of the events WebSocket, as listed in the API README. */
export type WireTopic = 'metrics' | 'traffic' | 'frames' | 'radio' | 'vpn' | 'packets' | 'peers' | 'jobs' | 'network' | 'ptt' | 'system';

export interface WireEvent {
  topic: string;
  type: string;
  ts_ms: number;
  data?: unknown;
}
