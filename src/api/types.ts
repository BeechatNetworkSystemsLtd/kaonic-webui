/*
 * The UI's own model of the hub.
 *
 * These types describe what the UI needs, in the UI's naming (camelCase). The
 * hub's contract is `kaonic-hub/docs/api/hub-api.yaml`; `http/convert.ts` maps
 * its wire format to these types, so a change in the API touches the transport
 * and nothing else.
 */

export type Role = 'admin' | 'viewer';

/** How a signed-out user can erase this device after forgetting its password, from this connection. */
export interface ForgotMethods {
  /** The browser is on the USB cable: the serial number and ERASE are enough. */
  usb: boolean;
  /** This is the Kaonic Admin device: its seed password proves the owner. */
  seed: boolean;
  /** False before setup: there is nothing to erase. */
  setUp: boolean;
}

export type ForgotResetInput = { method: 'usb'; serial: string; confirm: string } | { method: 'seed'; seedPassword: string; confirm: string };

export interface AuthState {
  /** True on a factory-fresh device: show the provisioning flow, not the login. */
  setupRequired: boolean;
  authenticated: boolean;
  role: Role | null;
}

/**
 * What a fresh device becomes. An admin device holds the key that manages the
 * mesh. A member keeps the identity it generated on first boot, and joins once
 * an admin device puts that identity on its whitelist.
 */
export type SetupMode = 'admin' | 'member';

/** What the provisioning flow collects. */
export type SetupInput = {
  /** Protects this UI. Separate from the seed password. */
  password: string;
  codename: string;
} & (
  | {
      mode: 'admin';
      /** The admin key is derived from it: the same seed password always gives the same key, which is how a key is recovered. */
      seedPassword: string;
    }
  | { mode: 'member' }
);

export interface Device {
  serial: string;
  codename: string;
  hostname: string;
  /** Board name, e.g. "Kaonic 1S r30". */
  model: string;
  /** 32 lowercase hex characters. */
  identityHash: string;
  versions: { hub: string; os: string; webui: string | null };
  uptimeSecs: number;
  radioModules: number;
  /** This device is the Kaonic Admin of its network. */
  isAdmin: boolean;
}

export interface SystemMetrics {
  cpuPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  fsFreeMb: number;
  fsTotalMb: number;
  uptimeSecs: number;
  /** Null when the board has no battery gauge. */
  battery: Battery | null;
}

export interface Battery {
  /** 0..100 */
  percent: number;
  charging: boolean;
}

export interface ServiceStatus {
  unit: string;
  name: string;
  state: 'active' | 'inactive' | 'failed';
  version: string | null;
}

/* ── network ── */

export type SourceId = 'wifi_client' | 'usb_phone' | 'mesh_gateway';
export type ConsumerId = 'hotspot' | 'usb_computer' | 'mesh_peers';

/** `active` carries traffic now, `standby` is ready, `waiting` is wanted but not working. */
export type PortStatus = 'active' | 'standby' | 'waiting' | 'off';

export interface NetworkSource {
  id: SourceId;
  enabled: boolean;
  status: PortStatus;
  /** One line for the card, e.g. `"Office" at -58 dBm` or `Waiting for phone`. */
  detail: string;
}

export interface NetworkConsumer {
  id: ConsumerId;
  enabled: boolean;
  status: PortStatus;
  detail: string;
  /** Devices or peers connected through it. */
  clients: number;
}

export interface NetworkState {
  /** The source that carries internet traffic now, if any. */
  activeSource: SourceId | null;
  sources: NetworkSource[];
  consumers: NetworkConsumer[];
  lan: { address: string; subnet: string };
}

/* ── Wi-Fi ── */

/** Why joining a network failed. */
export type WifiProblem = 'wrong_password' | 'not_found' | 'rejected' | 'timeout' | 'no_address';

/**
 * What the Wi-Fi client is doing. While the `wifi_client` source is on, the hub
 * keeps it on the best saved network: the first in the saved order that is in
 * range and allowed to auto-connect. It stays on a working network, moves up
 * the order only when a preferred one has been strong for two scans, and
 * stays on a network joined by hand (`pinned`) until it fails.
 */
export interface WifiClient {
  state: 'off' | 'searching' | 'connecting' | 'connected';
  /** The network it is on or joining. */
  ssid: string | null;
  signalDbm: number | null;
  /** IPv4 address with prefix, once DHCP is done. */
  address: string | null;
  /** A network joined by hand that it stays on. */
  pinned: string | null;
  /** The last failed try, until that network works or another try fails; kept while the client falls back elsewhere. */
  attempt: { ssid: string; reason: WifiProblem; ts: number } | null;
  /** When the last scan finished. Unix seconds. */
  scannedTs: number | null;
  /** Switched on but could not start (state is then `off`), and why. */
  fault: string | null;
}

/**
 * The device has one Wi-Fi radio. It can join a network as a client (STA), run
 * its own hotspot (AP), or do both at once (repeater). Which of these are on is
 * decided by the `wifi_client` source and the `hotspot` consumer; this is their
 * configuration and the client's live state.
 */
export interface WifiConfig {
  client: WifiClient;
  /** Networks the client may join, most preferred first. */
  saved: SavedWifiNetwork[];
  hotspot: Hotspot;
  antenna: 'internal' | 'external';
  antennaSupported: boolean;
}

export interface SavedWifiNetwork {
  ssid: string;
  /** False for an open network. */
  secured: boolean;
  /** May be joined without being asked. */
  autoConnect: boolean;
  /** Seen in the last scan. */
  inRange: boolean;
  signalDbm: number | null;
  lastConnectedTs: number | null;
  /** Why the last try failed; cleared by a success. */
  problem: WifiProblem | null;
  /** Not tried on its own before this time (Unix seconds). Null for a wrong password, which waits for a new one. */
  retryTs: number | null;
}

export interface Hotspot {
  enabled: boolean;
  ssid: string;
  /** Null for viewers and for an open hotspot. */
  password: string | null;
  /** No password: anyone in range can join. */
  open: boolean;
}

/** What is needed to change the hotspot. A null password makes it open. */
export interface HotspotConfig {
  ssid: string;
  password: string | null;
}

export type WifiSecurity = 'open' | 'wpa2' | 'wpa3';

export interface WifiScanEntry {
  ssid: string;
  signalDbm: number;
  security: WifiSecurity;
  frequencyMhz: number;
  /** Already among the saved networks. */
  saved: boolean;
}

export interface WifiScanResults {
  /** Unix seconds; null before the first scan. */
  scannedTs: number | null;
  networks: WifiScanEntry[];
}

/** What is needed to join a network. `password` is null for an open one. */
export interface WifiNetworkInput {
  ssid: string;
  password: string | null;
  /** The network does not broadcast its name. */
  hidden?: boolean;
}

/** A change to a saved network: a new password (null: open), or whether it is joined on its own. */
export interface WifiNetworkPatch {
  password?: string | null;
  autoConnect?: boolean;
}

/* ── radio ── */

export type ModuleIndex = 0 | 1;

export interface FskParams {
  /** kHz: 50, 100, 150, 200, 300 or 400. */
  symbolRateKhz: number;
  /** 0.375 … 2.0 */
  modulationIndex: number;
  /** 2- or 4-FSK. */
  order: 2 | 4;
  /** Gaussian filter BT: 0.5, 1, 1.5 or 2. */
  bt: number;
  fec: boolean;
  whitening: boolean;
  /** 1..1023 */
  preamble: number;
}

export type Modulation =
  | { kind: 'off' }
  | ({ kind: 'fsk' } & Partial<FskParams>)
  | { kind: 'ofdm'; mcs: number; option: number }
  | { kind: 'qpsk'; chipRateKhz: number; rateMode: number };

/** Listen before talk. */
export interface CcaConfig {
  enabled: boolean;
  /** dBm, −127..4: energy above this means the channel is busy. */
  thresholdDbm: number;
  /** 0 lets the driver use the modulation's own (max 8064). */
  listenUs: number;
  /** 0..255 */
  retries: number;
  /** 0..2000 µs */
  backoffUs: number;
}

/** Receiver front end. */
export interface FrontendConfig {
  /** 0..2 */
  agcMap: number;
  /** 0..7 */
  agcTarget: number;
  lnaBypass: boolean;
}

export interface RadioConfig {
  frequencyHz: number;
  channelSpacingHz: number;
  channel: number;
  modulation: Modulation;
  /** 0..31 */
  txPower: number;
  /** The chip appends a frame check sequence. Left out: unchanged. */
  fcs?: boolean;
  cca?: CcaConfig;
  frontend?: FrontendConfig;
}

/** Optional settings a band offers on this hub. */
export type RadioCapability = 'fcs' | 'cca' | 'frontend' | 'fsk' | 'qpsk' | 'off' | 'acceleration' | 'antenna' | 'bandwidth_filter';

/** A network-wide change of the mesh band waiting to happen, or waiting to be confirmed. */
export interface PendingSwitch {
  /** Unix milliseconds. */
  at: number;
  /** Switched; it goes back unless a node is heard within 60 s. */
  switched: boolean;
  config: RadioConfig;
}

/** Where a band sits in the spectrum. Each radio module has one of each. */
export type BandRange = 'sub_ghz' | '2g4';

/** The four bands: two radio modules (A, B), each with a sub-GHz and a 2.4 GHz transceiver. */
export type BandId = 'a_sub' | 'a_24' | 'b_sub' | 'b_24';

/** One of the board's sub-GHz filters, chosen by its index. */
export interface RadioFilter {
  index: number;
  label: string;
  /** Passband. */
  minMhz: number;
  maxMhz: number;
}

/** A band's filter: `auto` (the narrowest that passes the channel centre, else the wide one) or a filter's index. */
export type FilterChoice = 'auto' | number;

/** `unavailable`: the radio daemon cannot be asked (the choice is kept). `none`: nothing to choose on this band. */
export type FilterState = 'ok' | 'unavailable' | 'none';

export interface RadioBand {
  id: BandId;
  module: ModuleIndex;
  range: BandRange;
  /** Tunable limits of this band. */
  minHz: number;
  maxHz: number;
  config: RadioConfig;
  /** What rides on this band, e.g. ["mesh", "vpn"]. */
  usedBy: string[];
  lastRssi: number | null;
  /** The radio's network interface, e.g. rf09_b. Absent from older hubs. */
  interface?: string;
  /** The driver's transceiver state, or "emulated". */
  state?: string | null;
  /** Tunable ranges; the channel centre must fall in one. */
  rangesHz?: [number, number][];
  capabilities?: RadioCapability[];
  pendingSwitch?: PendingSwitch | null;
  /** What this board's front end is built for on this band, in MHz; shown, never enforced. Absent from older hubs. */
  boardRangeMhz?: [number, number] | null;
  filter?: FilterChoice;
  filters?: RadioFilter[];
  /** The index of the filter in use now. */
  activeFilter?: number | null;
  filterState?: FilterState;
}

/** One packet seen on the air, sent or received. */
export interface RadioFrame {
  /** The hub numbers frames in the order it records them, from 1 at each start. */
  seq: number;
  /** Unix milliseconds. */
  ts: number;
  band: BandId;
  direction: 'rx' | 'tx';
  /** dBm. Null for sent frames. */
  rssi: number | null;
  /** Bytes. */
  len: number;
  /** Centre frequency and occupied bandwidth. */
  frequencyHz: number;
  bandwidthHz: number;
  /** Time on air. */
  durationMs: number;
  /** What the frame carried, as far as the hub could tell. */
  kind: FrameKind;
  /** The packet's hop count, for a frame that completed a packet. */
  hops: number | null;
  /** The packet's destination hash (a link id for link traffic). */
  destination: string | null;
  destinationType: DestinationType | null;
  /** Bytes of the whole packet the frame completed. */
  packetLen: number | null;
  /** The node the destination belongs to, when known: for an announce, its sender. */
  peerId: string | null;
  /** Codename of that peer. */
  peer: string | null;
}

/**
 * A packet goes on the air as one to three frames. The frame that completes a
 * packet carries its kind; `segment` is a frame of a packet not yet complete,
 * `corrupt` a received frame that could not be decoded.
 */
export type FrameKind = 'announce' | 'data' | 'link_request' | 'proof' | 'segment' | 'corrupt';

export type DestinationType = 'single' | 'group' | 'plain' | 'link';

/** What one band did since the hub started. Rates and airtime cover the last two seconds. */
export interface RadioBandStats {
  band: BandId;
  /** The radio's network interface, e.g. "rf09_b". */
  interface: string;
  rxFrames: number;
  rxPackets: number;
  rxBytes: number;
  rxBps: number;
  /** Frames that arrived but could not be decoded or reassembled. */
  rxDecodeErrors: number;
  txFrames: number;
  txPackets: number;
  txBytes: number;
  txBps: number;
  /** Packets that could not be encoded or handed to the driver. */
  txErrors: number;
  /** Share of the last interval spent sending and receiving, 0..100. Estimated from frame sizes. */
  airtime: { rxPct: number; txPct: number };
  lastRssi: number | null;
  /** Energy on the channel when nothing is decoded: the noise floor. */
  noiseDbm: number | null;
  /** The interface's own counters. */
  driver: { rxErrors: number; rxDropped: number; txErrors: number; txDropped: number };
}

/* ── mesh ── */

/**
 * Which of the operator's lists a node is on. The whitelist is the allowlist
 * the Kaonic Admin signs: a whitelisted node is trusted. A blacklisted one is
 * shut out, and a node on neither list is simply one this device has seen and
 * nobody has decided about yet.
 */
export type NodeList = 'whitelist' | 'blacklist' | 'none';

/**
 * Who certified a node. `ours`: our admin. `other`: another admin; it must be
 * factory reset before it can join us. `unprovisioned`: it waits for an admin
 * to take it. `unknown`: nothing proven yet.
 */
export type NodeNetwork = 'ours' | 'other' | 'unprovisioned' | 'unknown';

export interface PeerTrust {
  network: NodeNetwork;
  /** The node is our Kaonic Admin. */
  isAdmin: boolean;
  /** On the admin device: set while it provisions this node, and when that failed. */
  provisioning: { state: 'running' | 'failed'; detail: string } | null;
}

/** `active`: both ends proved their certificates and data flows. `refused`: the last attempt failed that check. */
export type LinkState = 'none' | 'pending' | 'active' | 'refused';

export interface Peer {
  id: string;
  codename: string;
  tag: string;
  online: boolean;
  /** When this device first heard of the node. Unix seconds. */
  firstSeenTs: number;
  lastSeenTs: number;
  list: NodeList;
  /** The software the node says it runs. */
  version: string;
  hops: number | null;
  /**
   * The neighbour this peer is reached through, for peers more than one hop
   * away. Null when the peer is a direct neighbour or the path is not known.
   */
  viaId: string | null;
  rssi: number | null;
  rttMs: number | null;
  tunnelIp: string | null;
  trust: PeerTrust;
  link: {
    state: LinkState;
    /** Why the last link was refused or dropped. */
    detail: string | null;
  };
}

/* ── managing other nodes ── */

/** What a node answers when asked about itself over the mesh. */
export interface NodeDetails {
  id: string;
  codename: string;
  version: string;
  /** The node's operating system release; empty when it did not say. */
  osVersion: string;
  uptimeSecs: number;
  battery: Battery | null;
  /** The node's own four radio bands. */
  bands: RadioBand[];
  /** CPU, memory and storage; null from a node that did not say. */
  metrics: SystemMetrics | null;
  /** Its talk settings; null where talk does not run. */
  ptt: PttSettings | null;
  /** Its part in internet sharing; null from a node too old to tell. */
  sharing: NodeSharing | null;
}

/** A node's part in internet sharing: using a gateway, being one, and whether it has internet of its own. */
export interface NodeSharing {
  uplink: VpnUplink;
  gateway: VpnGateway;
  /** It has internet of its own (not through the mesh). */
  internet: boolean;
}

/** An admin's shell on another node, over the mesh. Output arrives through `RemoteShellHandlers`. */
export interface RemoteShell {
  /** Keystrokes, as the terminal produces them. */
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface RemoteShellHandlers {
  /** The node started the shell. */
  onOpen(): void;
  onOutput(bytes: Uint8Array): void;
  /** The shell is over, and why (the node ended it, the link dropped, it was closed). */
  onClose(reason: string): void;
}

/** The talk settings an admin can set on other nodes. */
export type RemotePttSettings = Partial<Pick<PttSettings, 'volume' | 'micGain' | 'playOnDevice' | 'autoArm' | 'squelchEnabled' | 'squelchOpenDbfs' | 'relay'>>;

/** The newest software this device can hand out to other nodes. */
export interface SoftwareRelease {
  version: string;
  sizeBytes: number;
}

export type NodeJobKind = 'update' | 'radio' | 'restart' | 'ptt';

/**
 * One thing being done to one node over the mesh. Acting on several nodes
 * creates one job each, so each can succeed or fail on its own.
 */
export interface NodeJob {
  id: string;
  nodeId: string;
  kind: NodeJobKind;
  state: 'queued' | 'running' | 'done' | 'failed';
  /** 0..1. Only an update moves gradually; the rest jump from 0 to 1. */
  progress: number;
  /** What is happening, or what went wrong. */
  detail: string;
  /** Unix seconds. */
  createdTs: number;
}

/**
 * One packet on the mesh that this device knows about.
 *
 * - `data`: sent by this device or addressed to it.
 * - `announce`: a peer's periodic announce reaching this device.
 * - `relayed`: between two peers, forwarded by this device.
 * - `overheard`: between two other devices, heard on the radio but not ours to carry.
 *
 * A null end is this device. The hub knows the ends and its own neighbour on
 * the way; the UI draws the rest of the route from the mesh it has been told about.
 */
export interface MeshPacket {
  /** Unix milliseconds. */
  ts: number;
  kind: 'data' | 'announce' | 'relayed' | 'overheard';
  fromId: string | null;
  toId: string | null;
  bytes: number;
}

/* ── plugins ── */

/** Extra rights a plugin was installed with, beyond its own folder and its page. */
export type PluginPermission = 'audio' | 'realtime' | 'mesh' | 'network' | 'root';

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  developer: string;
  /** Signed by a Beechat release key, as the installer checked. */
  official: boolean;
  running: boolean;
  /** Its page inside the hub (`/apps/<id>/`); null if it has none. Open it through `plugins.open`. */
  appUrl: string | null;
  /** Started when the device starts (turned on). */
  enabled: boolean;
  removable: boolean;
  hasIcon: boolean;
  channel: string | null;
  /** The developer's page for it. */
  url: string | null;
  permissions: PluginPermission[];
  /** Its systemd unit. */
  service: string;
  installedTs: number;
  /** The highest version ever installed; a lower one needs `allowDowngrade`. */
  highestVersion: string;
  /** The version a rollback goes back to; null if there is none. */
  previousVersion: string | null;
}

export type PluginAction = 'start' | 'stop' | 'restart' | 'rollback';

/** What installing a package did: a new plugin, or a newer version of one already installed. */
export interface PluginInstallResult {
  action: 'installed' | 'updated';
  plugin: Plugin;
}

/** A package upload: the password again, and whether a version older than one installed before may go in. */
export interface PackageUpload {
  password: string;
  allowDowngrade?: boolean;
}

/** What the installer accepts. */
export interface PluginPolicy {
  requireSigned: boolean;
  /** False on a development device: no release key, so packages install unsigned and signed-only cannot be turned on. Null when not known. */
  releaseKey: boolean | null;
}

/** What a package is and asks for, as the installer read it, before it is installed. */
export interface PluginPackageInfo {
  id: string;
  name: string;
  version: string;
  developer: string;
  description: string;
  permissions: PluginPermission[];
  /** It has a web page. */
  hasPage: boolean;
  signed: boolean;
  /** The version installed now, if any. */
  installed: string | null;
}

/** A ticket URL for a plugin's page, good for a limited time. */
export interface PluginTicket {
  url: string;
  expiresInSecs: number;
}

/* ── software (the hub, the installer, and their history) ── */

export type SoftwareAction = 'install' | 'upgrade' | 'downgrade' | 'rollback' | 'start' | 'stop' | 'restart' | 'remove';
export type SoftwareOutcome = 'done' | 'rolled_back' | 'failed';

/** One entry in the installer's history: a plugin, the hub (`kaonic-hub`) or the installer (`kaonic-hub-installer`). */
export interface SoftwareEvent {
  /** Unix seconds. */
  time: number;
  id: string;
  action: SoftwareAction;
  outcome: SoftwareOutcome;
  from: string | null;
  to: string | null;
  signed: boolean;
  /** Who asked, e.g. "admin (192.168.10.20)", or "boot". */
  actor: string | null;
  message: string;
}

/** The last update of the hub, run by the installer. */
export interface HubUpdate {
  id: number;
  version: string;
  state: 'running' | 'done' | 'failed';
  message: string;
  /** Unix seconds. */
  started: number;
  finished: number | null;
}

export interface SoftwareState {
  hub: {
    version: string;
    /** Runs the updated copy, not the one in the system image. */
    fromUpdate: boolean;
  };
  installer: { version: string | null; reachable: boolean };
  /** commd and the factory server, updated by the hub. Empty from a hub too old to tell. */
  programs: CoreProgram[];
  hubUpdate: HubUpdate | null;
  /** False on a development device: updates and plugins install unsigned. Null when the installer cannot say. */
  releaseKey: boolean | null;
}

export interface InstallerUpdateResult {
  version: string;
}

/** A core program's id, e.g. `kaonic-commd`. */
export type CoreProgramId = string;

/** A core program the hub updates besides the installer (commd, the factory server): named by its own manifest. */
export interface CoreProgram {
  id: CoreProgramId;
  name: string;
  description: string;
  running: boolean;
  /** Null when the image's copy does not say. */
  version: string | null;
  /** Runs the updated copy, not the one in the system image. */
  fromUpdate: boolean;
}

/* ── live data ── */

/* ── VPN ── */

export interface TrafficCounters {
  txPackets: number;
  txBytes: number;
  txBps: number;
  rxPackets: number;
  rxBytes: number;
  rxBps: number;
  dropped: number;
  /** Unix seconds. */
  lastTxTs: number | null;
  lastRxTs: number | null;
}

export type VpnPeerState = 'discovered' | 'pending' | 'active' | 'closed' | 'error';

export interface VpnPeer {
  peerId: string;
  codename: string;
  tag: string;
  tunnelIp: string | null;
  state: VpnPeerState;
  isGateway: boolean;
  routes: string[];
  counters: TrafficCounters;
  /** The tunnel's retransmission counters, when it keeps them. */
  arq: { resent: number; fastResent: number; givenUp: number; duplicates: number; rttMs: number | null } | null;
  lastError: string | null;
}

/** A prefix another node offers on the VPN, and what this hub did with it. */
export interface VpnRemoteRoute {
  network: string;
  peerId: string;
  /** `active`, `conflict`, `refused`, or another status the hub reports. */
  status: string;
  /** In this device's routing table. */
  installed: boolean;
  /** Unix seconds. */
  lastSeenTs: number;
  /** Why it is not used, when the hub says. */
  reason: string | null;
}

export interface VpnRoutes {
  /** Our own prefixes, offered to the other nodes. */
  advertised: string[];
  /** This device's client networks and the network each appears as on the mesh. */
  localMappings: VpnLanMapping[];
  remote: VpnRemoteRoute[];
}

/** A client network of this device (hotspot, LAN, USB) as the other nodes see it. */
export interface VpnLanMapping {
  /** The network as its clients know it. */
  subnet: string;
  /** What other nodes see; equal to `subnet` when it is not mapped. */
  mappedSubnet: string;
  interface: string | null;
}

/** Router (and DNS) pushed to DHCP clients: `auto` only while this node shares an internet route. */
export type VpnLanRouter = 'auto' | 'always' | 'never';

/** How the VPN is shared with this device's clients. */
export interface VpnShareSettings {
  shareLans: boolean;
  lanInterfaces: string[];
  mapLans: boolean;
  mappingPool: string;
  lanRouter: VpnLanRouter;
  dnsServers: string[];
  /** Extra prefixes advertised as they are. */
  advertise: string[];
}

export type VpnSharePatch = Partial<Omit<VpnShareSettings, 'advertise'>>;

/** Using another node as the internet gateway. */
export interface VpnUplink {
  enabled: boolean;
  active: boolean;
  peerId: string | null;
  routes: string[];
  /** Everything goes through the gateway, this device's own traffic too. */
  defaultRoute: boolean;
  detail: string | null;
  /** Nodes offering to be a gateway. */
  gateways: Array<{ peerId: string; codename: string; routes: string[] }>;
}

export interface VpnUplinkInput {
  enabled: boolean;
  /** Null: the first node offering. */
  peerId: string | null;
  defaultRoute: boolean;
  routes: string[];
}

/** This device sharing its own uplink (NAT) with the mesh. */
export interface VpnGateway {
  enabled: boolean;
  active: boolean;
  egressInterface: string | null;
  routes: string[];
  availableInterfaces: string[];
  detail: string | null;
}

export interface VpnGatewayInput {
  enabled: boolean;
  /** Null: the interface of the default route. */
  egressInterface: string | null;
  routes: string[];
}

export interface VpnState {
  enabled: boolean;
  status: 'running' | 'stopped' | 'error';
  /** The tunnel's network interface, e.g. "kaonic0". */
  interface: string | null;
  /** The mesh VPN's address range, e.g. "10.20.0.0/16". Null until the VPN is configured. */
  network: string | null;
  tunnelIp: string | null;
  counters: TrafficCounters;
  peers: VpnPeer[];
  routes: VpnRoutes;
  uplink: VpnUplink;
  gateway: VpnGateway;
  /** Sharing with clients; null from hubs that do not report it. */
  settings: VpnShareSettings | null;
  /** The tunnel's MTU, when the hub reports it. */
  mtu: number | null;
  lastError: string | null;
}

/** One packet through the tunnel. Headers only. */
export interface VpnPacket {
  /** Unix milliseconds. */
  ts: number;
  direction: 'rx' | 'tx';
  src: string;
  dst: string;
  proto: string;
  sport: number | null;
  dport: number | null;
  len: number;
}

/** The tunnel packet capture behind the VPN page. Admin only. */
export interface VpnCapture {
  running: boolean;
  /** Unix milliseconds. */
  startedTs: number | null;
  stoppedTs: number | null;
  snaplen: number;
  maxPackets: number;
  maxSecs: number;
  /** Keep the newest packets when full, rather than stopping. */
  ring: boolean;
  /** Packets held now. */
  packets: number;
  /** Pushed out of the ring, or not taken once full. */
  dropped: number;
  bytes: number;
  firstSeq: number | null;
  lastSeq: number | null;
}

export interface VpnCaptureOptions {
  snaplen?: number;
  maxPackets?: number;
  maxSecs?: number;
  ring?: boolean;
}

export type VpnVerdict = 'sent' | 'delivered' | 'dropped';

/** One packet that crossed the tunnel interface, as captured. */
export interface VpnCapturedPacket {
  /** From 1 in each capture: the "No." column. */
  seq: number;
  /** Unix microseconds, in the hub's clock. */
  tsUs: number;
  /** `tx`: from this node's side into the tunnel; `rx`: from a peer. */
  direction: 'rx' | 'tx';
  peerId: string | null;
  peerCodename: string | null;
  /** Sent to every node (broadcast or multicast). */
  flood: boolean;
  /** Original length. */
  len: number;
  /** The IPv4 packet, cut to the capture's snaplen. */
  data: Uint8Array;
  verdict: VpnVerdict;
  /** Why it was dropped. */
  reason: string | null;
}

/* ── push-to-talk ── */

/** Where this device's own talk comes from. */
/** `squelch`: the device microphone keyed by sound, e.g. the Kaonic hardware PTT button unmuting it. */
export type PttSource = 'device' | 'browser' | 'udp' | 'squelch' | 'test';

export interface PttTalker {
  id: string;
  codename: string;
  /** A signed admin burst: it has priority over everyone else. */
  isAdmin: boolean;
  /** This device is the one talking. */
  local: boolean;
  /** For local talk: where it comes from. Null for a remote talker. */
  source: PttSource | null;
}

/** One stretch of talk, after the fact. Audio is never recorded. */
export interface PttBurst {
  talker: PttTalker;
  /** Unix milliseconds. */
  startedTs: number;
  durationMs: number;
  /** 20 ms frames played (or sent, for our own talk). */
  frames: number;
  /** Frames concealed because they never arrived. */
  lostFrames: number;
  /** Fewest relays the burst came through; null for our own. */
  hops: number | null;
  /** The talker let go, the admin took the floor, or it went silent. */
  ended: 'released' | 'preempted' | 'timeout';
}

/** The kaonic-audio-ptt plugin's settings, with its names and defaults. */
export interface PttSettings {
  /** Speaker volume, % of the sound card's playback control; null leaves the card as the system set it. */
  volume: number | null;
  /** Microphone gain, % of the card's Capture control; null leaves it. */
  micGain: number | null;
  /** ALSA devices (see `ptt.devices()`). */
  captureDevice: string;
  playbackDevice: string;
  /** What the Talk button keys: this device's microphone, or the browser's. */
  talkInput: 'device' | 'browser';
  /** Play the group on this device's speaker. */
  playOnDevice: boolean;
  /** Keep playing received audio on the device while it talks (no echo canceller between speaker and mic). */
  rxWhileTx: boolean;
  /** Keep the device microphone armed so the squelch keys it: how the hardware PTT button works. */
  autoArm: boolean;
  /** Key only while the device microphone hears sound. */
  squelchEnabled: boolean;
  /** -90..0 dBFS */
  squelchOpenDbfs: number;
  /** 0..30 dB */
  squelchHysteresisDb: number;
  /** 0..5000 ms */
  squelchHangoverMs: number;
  /** 0..1000 ms */
  squelchPrerollMs: number;
  /** 20..1000 ms */
  jitterTargetMs: number;
  /** 20..2000 ms, at least jitterTargetMs. */
  jitterMaxMs: number;
  /** 6000..64000 */
  opusBitrateBps: number;
  /** 0..10 */
  opusComplexity: number;
  opusDtx: boolean;
  opusFec: boolean;
  /** 0..100 */
  opusPacketLossPct: number;
  opusCbr: boolean;
  /** 1..8 frames before a packet is sent. */
  packetFrames: number;
  /** 1..16, at least packetFrames: the packet may grow while frames fit the radio frame already paid for. */
  packetFramesMax: number;
  packetAlignLdpc: boolean;
  /** Re-send voice heard from others so it reaches further nodes. */
  relay: boolean;
  /** Relays a burst may cross, 1-8. */
  ttl: number;
  /** The level animation above the Talk button. */
  spectrumEnabled: boolean;
  /** 4..64 bars. */
  spectrumBands: number;
}

export interface PttAudioDevice {
  name: string;
  description: string;
}

export interface PttDevices {
  capture: PttAudioDevice[];
  playback: PttAudioDevice[];
}

/** The uploaded test recording. */
export interface PttTestWav {
  durationMs: number;
  sizeBytes: number;
  /** Unix seconds. */
  uploadedTs: number;
}

/** The answer to keying the device microphone. */
export type PttKeyResult = { keyed: true } | { keyed: false; reason: string };

export type PttFloorState = 'idle' | 'talking' | 'receiving';

export interface PttState {
  /** `unprovisioned`: the device has no group key yet. */
  status: 'running' | 'unprovisioned' | 'error';
  detail: string | null;
  /** This device. The Kaonic Admin's talk has priority. */
  self: { id: string; isAdmin: boolean };
  group: { name: string; epoch: number | null; members: number };
  floor: {
    state: PttFloorState;
    talker: PttTalker | null;
    /** Unix milliseconds. */
    sinceTs: number | null;
    /** 0..1 */
    level: number;
  };
  settings: PttSettings;
  audio: {
    /** The device has a microphone and speaker the hub can use. */
    device: boolean;
    /** Null when the codec library is missing on the device. */
    codec: string | null;
  };
  /** Newest first. */
  recent: PttBurst[];
  stats: { txPackets: number; rxPackets: number; relayed: number; suppressed: number; duplicates: number };
}

/** A UDP audio session for a native client (the plugin's protocol, unchanged). */
export interface PttSession {
  token: string;
  udpPort: number;
  sampleRateHz: number;
  frameMs: number;
  samplesPerFrame: number;
  keepaliveIntervalMs: number;
  unkeyTimeoutMs: number;
}

export type TrafficChannelId = BandId | 'vpn';

export interface TrafficRate {
  rxBps: number;
  txBps: number;
}

export interface TrafficSample {
  /** Unix milliseconds. */
  ts: number;
  channels: Record<TrafficChannelId, TrafficRate>;
}

/** Topic → payload of the hub's live event stream. */
export interface HubEvents {
  metrics: SystemMetrics;
  traffic: TrafficSample;
  /** New frames since the last event, any band. */
  frames: RadioFrame[];
  /** Every band's counters, every two seconds. */
  radio: RadioBandStats[];
  vpn: VpnState;
  /** New mesh packets since the last event. */
  packets: MeshPacket[];
  /** Every job, whenever one of them changes. */
  jobs: NodeJob[];
  peers: Peer[];
  network: NetworkState;
  wifi: WifiConfig;
  /** Push-to-talk: on every floor change. */
  ptt: PttState;
  /** Push-to-talk loudness, 0..1, four times a second while someone talks. */
  pttLevel: number;
}

export type HubTopic = keyof HubEvents;

/* ── boot slots and kernel install ── */

/** A/B system slot. */
export type BootSlotId = 'a' | 'b';
export type BootMode = 'once' | 'permanent';

/** What an uploaded kernel or device tree turned out to be. */
export interface BootImage {
  kind: 'kernel' | 'dtb';
  format: 'uimage' | 'fdt';
  size: number;
  /** The uImage name (e.g. "Linux-6.6.129-…"), or the device tree's model. */
  name: string | null;
  /** Kernel release (the /lib/modules directory it needs). */
  version: string | null;
  loadAddress: string | null;
  entryAddress: string | null;
  /** Unix seconds. */
  builtTs: number | null;
}

export interface BootSlot {
  slot: BootSlotId;
  /** Boots it may still fail before U-Boot falls back; 3 when healthy. */
  attemptsLeft: number | null;
  bootfs: boolean;
  rootfs: boolean;
  kernel: { file: string | null; name: string | null; version: string | null; size: number | null } | null;
  dtb: boolean;
  /** Kernel releases with modules in its root filesystem. */
  modules: string[];
  bootable: boolean;
}

export interface BootState {
  /** The running slot; null when unknown (not on a board). */
  current: BootSlotId | null;
  order: BootSlotId[];
  next: BootSlotId | null;
  /** A one-time boot is pending. */
  once: boolean;
  afterOnce: BootSlotId[];
  fdtfile: string | null;
  /** The hub only logs boot commands. */
  dryRun: boolean;
  slots: BootSlot[];
}

export interface BootStagedFile {
  info: BootImage;
  /** Unix seconds. */
  uploadedTs: number;
}

export interface BootStaged {
  kernel: BootStagedFile | null;
  dtb: BootStagedFile | null;
}

export interface KernelInstallOptions {
  password: string;
  /** Defaults to the slot that is not running. */
  slot?: BootSlotId;
  prepare?: 'auto' | 'always' | 'never';
  allowMissingModules?: boolean;
}

export interface KernelInstallResult {
  slot: BootSlotId;
  prepared: boolean;
  kernelFile: string | null;
  dtbFile: string | null;
  modulesPresent: boolean | null;
}

export interface BootJob {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  /** 0..1 */
  progress: number;
  detail: string | null;
  result: KernelInstallResult | null;
  error: string | null;
}
