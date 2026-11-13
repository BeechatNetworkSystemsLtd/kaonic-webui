import type {
  AuthState,
  BandId,
  BootImage,
  BootJob,
  BootMode,
  BootSlotId,
  BootStaged,
  BootState,
  KernelInstallOptions,
  ConsumerId,
  Device,
  FilterChoice,
  HotspotConfig,
  HubEvents,
  HubTopic,
  NetworkState,
  NodeDetails,
  NodeJob,
  NodeList,
  Peer,
  HubUpdate,
  InstallerUpdateResult,
  PackageUpload,
  Plugin,
  PluginAction,
  PluginInstallResult,
  PluginPackageInfo,
  PluginPolicy,
  PluginTicket,
  PttDevices,
  PttKeyResult,
  PttSession,
  PttSettings,
  PttState,
  PttTalker,
  PttTestWav,
  RadioBand,
  RadioBandStats,
  RadioConfig,
  RadioFrame,
  RemotePttSettings,
  RemoteShell,
  RemoteShellHandlers,
  ServiceStatus,
  SetupInput,
  SoftwareEvent,
  SoftwareRelease,
  SoftwareState,
  SourceId,
  SystemMetrics,
  VpnCapture,
  VpnCaptureOptions,
  VpnCapturedPacket,
  VpnGateway,
  VpnGatewayInput,
  VpnPacket,
  VpnSharePatch,
  VpnState,
  VpnUplink,
  VpnUplinkInput,
  WifiConfig,
  WifiNetworkInput,
  WifiNetworkPatch,
  WifiScanEntry,
  WifiScanResults,
  ForgotMethods,
  ForgotResetInput,
} from './types';

export type ConnectionState = 'connecting' | 'open' | 'closed';

/** What the hub says on a push-to-talk audio socket. */
export type PttAudioMessage =
  | { type: 'keyed' }
  | { type: 'busy'; talker: PttTalker | null }
  | { type: 'unkeyed'; reason: 'released' | 'preempted' | 'timeout' | 'forbidden' }
  | { type: 'talker'; talker: PttTalker | null };

export interface PttAudioHandlers {
  /** One 20 ms frame of the group's audio: 320 samples, 16 kHz mono. */
  onFrame?: (frame: Int16Array) => void;
  onMessage?: (message: PttAudioMessage) => void;
  onState?: (state: ConnectionState) => void;
}

/**
 * A live audio socket: listen to the group, take the floor, send the
 * microphone. It reconnects on its own, and stops for good when the session
 * ends or `close()` is called.
 */
export interface PttAudioSocket {
  state(): ConnectionState;
  /** Starts or stops receiving the group's audio; kept across reconnects. */
  listen(on: boolean): void;
  /** Ask for the floor; the answer is a `keyed` or `busy` message. */
  key(): void;
  unkey(): void;
  /** One 20 ms frame of the microphone, 320 samples at 16 kHz. Sent only while keyed. */
  sendFrame(frame: Int16Array): void;
  close(): void;
}

/**
 * Everything the UI asks of the hub. Features depend on this interface only.
 *
 * Implementations: `http/` (the hub's REST API and events WebSocket) and
 * `mock/` (in-browser, for development and demos). `index.ts` picks one.
 *
 * Writes resolve with the updated resource so callers never have to re-fetch.
 * Every failure rejects with an `ApiError`.
 */
export interface HubApi {
  auth: {
    state(): Promise<AuthState>;
    /** Before setup only: the identity this device generated on first boot. A member keeps it. */
    bootIdentity(): Promise<string>;
    /** Before setup only: the admin identity a seed password derives, so a recovery can be checked before it is applied. Changes nothing. */
    deriveIdentity(seedPassword: string): Promise<string>;
    setup(input: SetupInput): Promise<void>;
    login(password: string): Promise<void>;
    logout(): Promise<void>;
    /** Signed out: which ways to erase the device without its password this connection has. */
    forgotMethods(): Promise<ForgotMethods>;
    /** Signed out: erase the device after a forgotten password. It restarts in setup. */
    forgotReset(input: ForgotResetInput): Promise<void>;
  };
  device: {
    get(): Promise<Device>;
    reboot(): Promise<void>;
    /** Needs the password again. The device returns to the provisioning flow. */
    factoryReset(password: string): Promise<void>;
  };
  system: {
    /** Everything about this device's Kaonic software and OS, as plain text to paste into a support request. Admin only. */
    report(): Promise<string>;
    metrics(): Promise<SystemMetrics>;
    services(): Promise<ServiceStatus[]>;
    restartService(unit: string): Promise<ServiceStatus>;
    /** The A/B boot slots. Reading them is cached on the hub for a minute unless `refresh`. */
    boot(refresh?: boolean): Promise<BootState>;
    /** The boot switch: which slot boots next. Needs the password again. */
    setBootNext(slot: BootSlotId, mode: BootMode, password: string): Promise<BootState>;
    /** Upload a kernel (uImage) or device tree; it is checked and kept until installed. */
    uploadBootImage(kind: 'kernel' | 'dtb', file: Blob): Promise<BootImage>;
    stagedBoot(): Promise<BootStaged>;
    discardStagedBoot(): Promise<void>;
    /** Installs the uploaded files into the slot that is not running; follow the job with `bootJob`. */
    installKernel(options: KernelInstallOptions): Promise<BootJob>;
    bootJob(id: string): Promise<BootJob>;
  };
  network: {
    get(): Promise<NetworkState>;
    setSource(id: SourceId, enabled: boolean): Promise<NetworkState>;
    setConsumer(id: ConsumerId, enabled: boolean): Promise<NetworkState>;
  };
  wifi: {
    get(): Promise<WifiConfig>;
    /** The networks the last scan found, without scanning. The hub scans in the background. */
    lastScan(): Promise<WifiScanResults>;
    /** Looks for networks in range now. Takes a few seconds. Needs the Wi-Fi client on. */
    scan(): Promise<WifiScanEntry[]>;
    /** Saves a network (or replaces its password), puts it first and joins it now. */
    join(network: WifiNetworkInput): Promise<WifiConfig>;
    /** Joins a saved network now and stays on it. */
    connect(ssid: string): Promise<WifiConfig>;
    /** A new password, or whether the network is joined on its own. */
    update(ssid: string, patch: WifiNetworkPatch): Promise<WifiConfig>;
    forget(ssid: string): Promise<WifiConfig>;
    /** Every saved network, most preferred first. */
    reorder(ssids: string[]): Promise<WifiConfig>;
    /** Lets the client choose among saved networks again after a manual join. */
    unpin(): Promise<WifiConfig>;
    setHotspot(config: HotspotConfig): Promise<WifiConfig>;
  };
  radio: {
    bands(): Promise<RadioBand[]>;
    updateBand(id: BandId, config: RadioConfig): Promise<RadioBand>;
    /**
     * The mesh band on every node at once (admin device only): sent to every linked node,
     * all switch at `switchAt`; a node that hears nobody within 60 s goes back.
     */
    updateBandEverywhere(id: BandId, config: RadioConfig): Promise<{ switchAt: number; nodes: number }>;
    /** The band's sub-GHz filter, applied straight away for the frequency the band runs now. */
    setBandFilter(id: BandId, filter: FilterChoice): Promise<RadioBand>;
    /** Every band's counters since the hub started. */
    stats(): Promise<RadioBandStats[]>;
    /** The frames the hub still holds, oldest first: the analyser's start before the live feed. */
    frames(options?: { band?: BandId; limit?: number }): Promise<RadioFrame[]>;
  };
  vpn: {
    get(): Promise<VpnState>;
    /** The tunnel's latest packets, newest first. */
    packets(limit?: number): Promise<VpnPacket[]>;
    /** The packet capture's state. Admin only, like everything about the capture. */
    capture(): Promise<VpnCapture>;
    /** Starts a capture; the previous one's packets are dropped. */
    startCapture(options?: VpnCaptureOptions): Promise<VpnCapture>;
    stopCapture(): Promise<VpnCapture>;
    /** Captured packets with a seq above `after`, oldest first. */
    capturePackets(after: number, limit?: number): Promise<VpnCapturedPacket[]>;
    /** The whole capture as a pcap file, for Wireshark. */
    capturePcap(): Promise<Blob>;
    /** Sharing with this device's clients. Admin only. */
    updateSettings(patch: VpnSharePatch): Promise<VpnState>;
    /** Extra prefixes this device advertises as they are. Admin only. */
    setRoutes(advertised: string[]): Promise<void>;
    /** Use another node as the internet gateway. Admin only. */
    setUplink(input: VpnUplinkInput): Promise<VpnUplink>;
    /** Share this device's own uplink with the mesh. Admin only. */
    setGateway(input: VpnGatewayInput): Promise<VpnGateway>;
  };
  ptt: {
    get(): Promise<PttState>;
    updateSettings(patch: Partial<PttSettings>): Promise<PttSettings>;
    /** A one-second tone on the device's speaker; nothing goes on the air. */
    testTone(): Promise<void>;
    /** A UDP session for a phone app or ATAK plugin. */
    createSession(): Promise<PttSession>;
    /** The device's ALSA capture and playback devices. */
    devices(): Promise<PttDevices>;
    /** Key the device's own microphone. Repeat at least every second while held: the hub unkeys 2 s after the last. */
    key(): Promise<PttKeyResult>;
    /** Release the device microphone, or stop a test transmission. */
    unkey(): Promise<void>;
    /** The uploaded test recording, or null. */
    testWav(): Promise<PttTestWav | null>;
    /** Upload a WAV (≤ 32 MiB) to transmit as a test; the hub keeps it as 16 kHz mono. */
    uploadTestWav(file: Blob): Promise<PttTestWav>;
    deleteTestWav(): Promise<void>;
    /** Transmit the test recording or a 1 kHz tone to every node, once or until stopped. */
    startTestTx(options: { source: 'wav' | 'tone'; loop: boolean }): Promise<PttKeyResult>;
    stopTestTx(): Promise<void>;
    /** Opens the audio socket. While listening (`listen`, or `socket.listen(true)`), the group's audio arrives on `onFrame`. */
    audio(options: { listen: boolean }, handlers: PttAudioHandlers): PttAudioSocket;
  };
  peers: {
    list(): Promise<Peer[]>;
    /**
     * Moves a node to the whitelist or the blacklist, or takes it off both with
     * `none`. Only the admin device can change the whitelist: whitelisting a
     * node that waits for an admin provisions it first (watch `trust.provisioning`),
     * and taking a node off the whitelist revokes it across the mesh.
     */
    setList(id: string, list: NodeList): Promise<Peer>;
  };
  /**
   * Managing other nodes over the mesh, from the admin device. Only whitelisted
   * nodes can be managed. The actions take a list of nodes and answer with one
   * job per node; progress arrives on the `jobs` topic.
   */
  nodes: {
    /** Asks the node about itself. Fails if it cannot be reached. */
    details(id: string): Promise<NodeDetails>;
    release(): Promise<SoftwareRelease>;
    jobs(): Promise<NodeJob[]>;
    updateSoftware(ids: string[]): Promise<NodeJob[]>;
    setRadio(ids: string[], band: BandId, config: RadioConfig): Promise<NodeJob[]>;
    restart(ids: string[]): Promise<NodeJob[]>;
    /** Sets the talk basics on each node. */
    setPtt(ids: string[], settings: RemotePttSettings): Promise<NodeJob[]>;
    /** Renames one node; answers with its details as they are now. */
    setCodename(id: string, codename: string): Promise<void>;
    /**
     * Opens a shell on the node, after the admin's password again. Resolves once the
     * socket is open; `onOpen` follows when the node has started the shell.
     */
    openShell(id: string, password: string, size: { cols: number; rows: number }, handlers: RemoteShellHandlers): Promise<RemoteShell>;
  };
  /**
   * Plugins, installed and run by the plugin installer through the hub. `list` fails
   * with `unavailable` (reason `installer_unavailable`) while the installer is not running.
   */
  plugins: {
    list(): Promise<Plugin[]>;
    /** Start (and turn on at boot), stop (and turn off), restart, or go back to the version kept before the last upgrade. */
    act(id: string, action: PluginAction): Promise<Plugin>;
    /**
     * Installs a plugin from its package, or upgrades it when it is already installed.
     * A version older than one installed before is refused (`conflict`, reason `downgrade`) unless `allowDowngrade`.
     */
    install(file: File, upload: PackageUpload): Promise<PluginInstallResult>;
    /** What a package is and asks for, without installing it (admin; no password). Rejects an invalid package as a `file` field error. */
    check(file: File): Promise<PluginPackageInfo>;
    /** Upgrades this plugin only: a package of another plugin is refused. */
    update(id: string, file: File, upload: PackageUpload): Promise<Plugin>;
    /** Stops and removes a plugin; its data goes too unless `keepData`. */
    remove(id: string, keepData: boolean): Promise<void>;
    /** A ticket URL for the plugin's page. `not_found` when it has none. */
    open(id: string): Promise<PluginTicket>;
    policy(): Promise<PluginPolicy>;
    setPolicy(requireSigned: boolean, password: string): Promise<PluginPolicy>;
  };
  /** The hub's and the installer's own updates, and what the installer did. */
  software: {
    state(): Promise<SoftwareState>;
    /** Starts a hub update and resolves once the package is checked; the hub then restarts. Read the outcome from `state().hubUpdate`. */
    updateHub(file: File, upload: PackageUpload): Promise<HubUpdate>;
    /** Updates the installer and waits for it (up to two minutes). Rejects with the reason if the old one had to come back. */
    updateInstaller(file: File, upload: PackageUpload): Promise<InstallerUpdateResult>;
    /** Newest first. `id` narrows it to one plugin, `kaonic-hub` or `kaonic-hub-installer`. */
    history(filter?: { id?: string; limit?: number }): Promise<SoftwareEvent[]>;
  };
  events: {
    /** Starts delivery of a topic. Returns the function that stops it. */
    subscribe<T extends HubTopic>(topic: T, handler: (payload: HubEvents[T]) => void): () => void;
    connection(): ConnectionState;
    onConnectionChange(handler: (state: ConnectionState) => void): () => void;
  };
}
