import { useEffect } from 'react';
import { useMutation, useMutationState, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  api,
  type AdminSecret,
  type PhraseLength,
  type CoreProgramId,
  type BootMode,
  type BootSlotId,
  type ConsumerId,
  type KernelInstallOptions,
  type HotspotConfig,
  type HubEvents,
  type HubTopic,
  type BandId,
  type FilterChoice,
  type NetworkState,
  type NodeList,
  type Peer,
  type PackageUpload,
  type Plugin,
  type PluginAction,
  type PluginPolicy,
  type SoftwareState,
  type PttSettings,
  type VpnCaptureOptions,
  type VpnGatewayInput,
  type VpnSharePatch,
  type VpnUplinkInput,
  type PttState,
  type RadioBand,
  type RadioConfig,
  type RadioTest,
  type RadioTestRequest,
  type ModuleIndex,
  type RemotePttSettings,
  type SetupInput,
  type SourceId,
  type WifiConfig,
  type WifiNetworkInput,
  type WifiNetworkPatch,
  type WifiScanResults,
} from '@/api';

/*
 * All server state goes through here: one query key per resource, one hook per
 * read, one hook per write. Components never call `api` directly.
 */

export const keys = {
  auth: ['auth'] as const,
  bootIdentity: ['boot-identity'] as const,
  device: ['device'] as const,
  metrics: ['metrics'] as const,
  services: ['services'] as const,
  boot: ['boot'] as const,
  bootStaged: ['boot', 'staged'] as const,
  bootJob: (id: string) => ['bootJob', id] as const,
  os: ['os'] as const,
  uiPages: ['ui', 'pages'] as const,
  osJob: (id: string) => ['osJob', id] as const,
  network: ['network'] as const,
  wifi: ['wifi'] as const,
  wifiScan: ['wifi-scan'] as const,
  radio: ['radio'] as const,
  radioStats: ['radio-stats'] as const,
  radioTest: (id: string) => ['radio', 'test', id] as const,
  vpn: ['vpn'] as const,
  vpnPackets: ['vpn-packets'] as const,
  vpnCapture: ['vpn-capture'] as const,
  ptt: ['ptt'] as const,
  pttDevices: ['ptt', 'devices'] as const,
  pttTestWav: ['ptt', 'test-wav'] as const,
  peers: ['peers'] as const,
  node: (id: string) => ['node', id] as const,
  release: ['release'] as const,
  jobs: ['jobs'] as const,
  plugins: ['plugins'] as const,
  pluginPolicy: ['plugin-policy'] as const,
  pluginTicket: (id: string) => ['plugin-ticket', id] as const,
  software: ['software'] as const,
  softwareHistory: ['software-history'] as const,
};

/** Puts an item a write returned in place of its old copy in a cached list. */
function replaceById<T extends { id: string }>(client: QueryClient, key: readonly string[], updated: T) {
  client.setQueryData<T[]>(key, (items) => items?.map((item) => (item.id === updated.id ? updated : item)));
}

/** Pushed by the event stream (see `useLiveSync`): never worth a refetch of its own. */
const live = { staleTime: Infinity, refetchOnWindowFocus: false } as const;

/* ── auth ── */

export const useAuthState = () => useQuery({ queryKey: keys.auth, queryFn: api.auth.state, staleTime: Infinity });

/** After any change of session, drop everything that belonged to the old one. */
function resetSession(client: QueryClient) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.auth[0] });
  return client.invalidateQueries({ queryKey: keys.auth });
}

/** Before setup: the identity this device was born with. It never changes until a factory reset. */
export const useBootIdentity = () => useQuery({ queryKey: keys.bootIdentity, queryFn: api.auth.bootIdentity, staleTime: Infinity });

/** Before setup: works out which admin identity a seed phrase gives. An action, like a Wi-Fi scan: read `data` for the result. */
export const useDeriveIdentity = () => useMutation({ mutationFn: (secret: AdminSecret) => api.auth.deriveIdentity(secret) });

/** Before setup: a new admin's seed phrase, made by the device. */
export const useNewSeedPhrase = () => useMutation({ mutationFn: (words: PhraseLength) => api.auth.newSeedPhrase(words) });

/** The words a seed phrase is made of. */
export const useWordlist = () => useQuery({ queryKey: ['auth', 'wordlist'], queryFn: api.auth.wordlist, staleTime: Infinity });

export function useSetup() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (input: SetupInput) => api.auth.setup(input), onSuccess: () => resetSession(client) });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (password: string) => api.auth.login(password), onSuccess: () => resetSession(client) });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.auth.logout, onSuccess: () => resetSession(client) });
}

/* ── device and system ── */

export const useDevice = () => useQuery({ queryKey: keys.device, queryFn: api.device.get });
export const useMetrics = () => useQuery({ queryKey: keys.metrics, queryFn: api.system.metrics, ...live });
/** Just the battery, so its readers re-render only when it changes, not with every metrics tick. */
export const useBattery = () => useQuery({ queryKey: keys.metrics, queryFn: api.system.metrics, ...live, select: (metrics) => metrics.battery });
export const useServices = () => useQuery({ queryKey: keys.services, queryFn: api.system.services });

export function useRestartService() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (unit: string) => api.system.restartService(unit),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.services }),
  });
}

export const useReboot = () => useMutation({ mutationFn: api.device.reboot });
/** The system report, fetched fresh each time (it is copied, not shown). */
export const useSystemReport = () => useMutation({ mutationFn: api.system.report });

/* ── boot slots and kernel install ── */

export const useBoot = () => useQuery({ queryKey: keys.boot, queryFn: () => api.system.boot() });
export const useBootStaged = () => useQuery({ queryKey: keys.bootStaged, queryFn: api.system.stagedBoot });

export function useSetBootNext() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, mode, password }: { slot: BootSlotId; mode: BootMode; password: string }) => api.system.setBootNext(slot, mode, password),
    onSuccess: (state) => client.setQueryData(keys.boot, state),
  });
}

export function useUploadBootImage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, file }: { kind: 'kernel' | 'dtb'; file: Blob }) => api.system.uploadBootImage(kind, file),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.bootStaged }),
  });
}

export function useDiscardStagedBoot() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.system.discardStagedBoot, onSuccess: () => client.invalidateQueries({ queryKey: keys.bootStaged }) });
}

/* ── the menu's pages ── */

export const useUiPages = () => useQuery({ queryKey: keys.uiPages, queryFn: api.ui.pages, staleTime: 60_000 });

export function useSetUiPages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (shown: string[] | null) => api.ui.setPages(shown),
    onMutate: (shown) => client.setQueryData(keys.uiPages, shown),
    onSettled: () => client.invalidateQueries({ queryKey: keys.uiPages }),
  });
}

/* ── OS updates ── */

/** The running image and any uploaded update; polled while the device works on one. */
export const useOs = () =>
  useQuery({
    queryKey: keys.os,
    queryFn: api.system.os,
    refetchInterval: (query) => {
      const state = query.state.data?.update?.state;
      return state === 'checking' || state === 'installing' ? 1000 : false;
    },
  });

export function useUploadOs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, onProgress }: { file: Blob; onProgress: (fraction: number) => void }) => api.system.uploadOs(file, onProgress),
    onSettled: () => client.invalidateQueries({ queryKey: keys.os }),
  });
}

export function useInstallOs() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (password: string) => api.system.installOs(password), onSettled: () => client.invalidateQueries({ queryKey: keys.os }) });
}

export function useDiscardOs() {
  const client = useQueryClient();
  return useMutation({ mutationFn: api.system.discardOs, onSettled: () => client.invalidateQueries({ queryKey: keys.os }) });
}

/** A check or install job, polled until it ends; the OS state is read again then. */
export function useOsJob(id: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.osJob(id ?? ''),
    enabled: id !== null,
    queryFn: async () => {
      const job = await api.system.osJob(id!);
      if (job.state === 'done' || job.state === 'failed') {
        void client.invalidateQueries({ queryKey: keys.os });
        void client.invalidateQueries({ queryKey: keys.boot });
      }
      return job;
    },
    refetchInterval: (query) => (query.state.data && (query.state.data.state === 'done' || query.state.data.state === 'failed') ? false : 700),
  });
}

export const useInstallKernel = () => useMutation({ mutationFn: (options: KernelInstallOptions) => api.system.installKernel(options) });

/** Follows an install job once a second until it is done; then the slots and staged files are read again. */
export function useBootJob(id: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.bootJob(id ?? ''),
    enabled: id !== null,
    queryFn: async () => {
      const job = await api.system.bootJob(id!);
      if (job.state === 'done' || job.state === 'failed') {
        void client.invalidateQueries({ queryKey: keys.boot });
        void client.invalidateQueries({ queryKey: keys.bootStaged });
      }
      return job;
    },
    refetchInterval: (query) => (query.state.data && (query.state.data.state === 'done' || query.state.data.state === 'failed') ? false : 1000),
  });
}

export function useFactoryReset() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.device.factoryReset(password),
    onSuccess: () => resetSession(client),
  });
}

/* ── network ── */

export const useNetwork = () => useQuery({ queryKey: keys.network, queryFn: api.network.get, ...live });

export type NetworkToggle = { kind: 'source'; id: SourceId; enabled: boolean } | { kind: 'consumer'; id: ConsumerId; enabled: boolean };

export function useNetworkToggle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (toggle: NetworkToggle) =>
      toggle.kind === 'source' ? api.network.setSource(toggle.id, toggle.enabled) : api.network.setConsumer(toggle.id, toggle.enabled),
    onSuccess: (state) => client.setQueryData<NetworkState>(keys.network, state),
  });
}

/* ── Wi-Fi ── */

export const useWifi = () => useQuery({ queryKey: keys.wifi, queryFn: api.wifi.get, ...live });

/** The last scan's networks: the hub scans in the background, so this is usually fresh. */
export const useWifiLastScan = () => useQuery({ queryKey: keys.wifiScan, queryFn: api.wifi.lastScan, staleTime: 5_000 });

/** Every Wi-Fi write answers with the new configuration; the network picture depends on it too. */
function useWifiChange<Input>(run: (input: Input) => Promise<WifiConfig>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (config) => {
      client.setQueryData<WifiConfig>(keys.wifi, config);
      return client.invalidateQueries({ queryKey: keys.network });
    },
  });
}

export const useJoinWifi = () => useWifiChange((network: WifiNetworkInput) => api.wifi.join(network));
export const useConnectWifi = () => useWifiChange((ssid: string) => api.wifi.connect(ssid));
export const useForgetWifi = () => useWifiChange((ssid: string) => api.wifi.forget(ssid));
export const useUpdateWifi = () => useWifiChange(({ ssid, patch }: { ssid: string; patch: WifiNetworkPatch }) => api.wifi.update(ssid, patch));
export const useReorderWifi = () => useWifiChange((ssids: string[]) => api.wifi.reorder(ssids));
export const useUnpinWifi = () => useWifiChange(() => api.wifi.unpin());
export const useSetHotspot = () => useWifiChange((config: HotspotConfig) => api.wifi.setHotspot(config));

/** A scan is an action: run it on demand and read `data` for the result. The cached last scan follows. */
export function useWifiScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: api.wifi.scan,
    onSuccess: (networks) => client.setQueryData<WifiScanResults>(keys.wifiScan, { scannedTs: Math.floor(Date.now() / 1000), networks }),
  });
}

/* ── radio ── */

export const useRadioBands = () => useQuery({ queryKey: keys.radio, queryFn: api.radio.bands });

export function useUpdateRadioBand() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: BandId; config: RadioConfig }) => api.radio.updateBand(id, config),
    onSuccess: (updated) => replaceById<RadioBand>(client, keys.radio, updated),
  });
}

/** A band's sub-GHz filter: `auto` or a filter's index. */
export function useSetRadioBandFilter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, filter }: { id: BandId; filter: FilterChoice }) => api.radio.setBandFilter(id, filter),
    onSuccess: (updated) => replaceById<RadioBand>(client, keys.radio, updated),
  });
}

/** A band's test run; read every second while `watch` (a run is open), so the count moves. */
export function useRadioTest(id: BandId, watch: boolean) {
  return useQuery({ queryKey: keys.radioTest(id), queryFn: () => api.radio.test(id), refetchInterval: watch ? 1000 : false });
}

function setRadioTest(client: QueryClient, id: BandId, test: RadioTest | null) {
  client.setQueryData(keys.radioTest(id), test);
  client.setQueryData<RadioBand[]>(keys.radio, (bands) => bands?.map((band) => (band.id === id ? { ...band, test } : band)));
}

export function useStartRadioTest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, request }: { id: BandId; request: RadioTestRequest }) => api.radio.startTest(id, request),
    onSuccess: (test, { id }) => setRadioTest(client, id, test),
  });
}

export function useStopRadioTest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: BandId) => api.radio.stopTest(id),
    onSuccess: (test, id) => setRadioTest(client, id, test),
  });
}

/** Moves the mesh to the other radio module. The hub restarts; the bands are read again after. */
export function useSetMeshRadio() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (module: ModuleIndex) => api.radio.setMeshRadio(module),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.radio }),
  });
}

/** The mesh band on every node at once; the bands are read again so the pending switch shows. */
export function useUpdateRadioBandEverywhere() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: BandId; config: RadioConfig }) => api.radio.updateBandEverywhere(id, config),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.radio }),
  });
}

/** Counters per band, kept live while a component reads them: the hub only sends them to someone watching. */
export function useRadioStats() {
  const client = useQueryClient();
  useEffect(() => api.events.subscribe('radio', (stats) => client.setQueryData(keys.radioStats, stats)), [client]);
  return useQuery({ queryKey: keys.radioStats, queryFn: api.radio.stats, ...live });
}

/* ── VPN ── */

/** The tunnel's state, kept live while a component reads it. */
export function useVpn() {
  const client = useQueryClient();
  useEffect(() => api.events.subscribe('vpn', (state) => client.setQueryData(keys.vpn, state)), [client]);
  return useQuery({ queryKey: keys.vpn, queryFn: api.vpn.get, ...live });
}

/** The tunnel's latest packets, asked for every two seconds while shown and the tab is visible. */
export const useVpnPackets = (enabled: boolean) =>
  useQuery({ queryKey: keys.vpnPackets, queryFn: () => api.vpn.packets(64), enabled, refetchInterval: 2000, refetchIntervalInBackground: false });

/** The packet capture's state: every second while it runs. Admin only, so only asked for when `enabled`. */
export const useVpnCapture = (enabled: boolean) =>
  useQuery({
    queryKey: keys.vpnCapture,
    queryFn: api.vpn.capture,
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
    refetchIntervalInBackground: false,
  });

export function useStartVpnCapture() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (options: VpnCaptureOptions) => api.vpn.startCapture(options),
    onSuccess: (capture) => client.setQueryData(keys.vpnCapture, capture),
  });
}

export function useStopVpnCapture() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.vpn.stopCapture(),
    onSuccess: (capture) => client.setQueryData(keys.vpnCapture, capture),
  });
}

/** Changes to how the VPN is shared; each one reloads the tunnel's state. */
function useVpnWrite<T, R>(write: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: write, onSuccess: () => client.invalidateQueries({ queryKey: keys.vpn }) });
}

export const useUpdateVpnSettings = () => useVpnWrite((patch: VpnSharePatch) => api.vpn.updateSettings(patch));
export const useSetVpnRoutes = () => useVpnWrite((advertised: string[]) => api.vpn.setRoutes(advertised));
export const useSetVpnUplink = () => useVpnWrite((input: VpnUplinkInput) => api.vpn.setUplink(input));
export const useSetVpnGateway = () => useVpnWrite((input: VpnGatewayInput) => api.vpn.setGateway(input));

/* ── push-to-talk ── */

/** Push-to-talk state, kept live while a component reads it: the hub sends it on every floor change. */
export function usePtt() {
  const client = useQueryClient();
  useEffect(() => api.events.subscribe('ptt', (state) => client.setQueryData(keys.ptt, state)), [client]);
  return useQuery({ queryKey: keys.ptt, queryFn: api.ptt.get, ...live });
}

export function useUpdatePttSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PttSettings>) => api.ptt.updateSettings(patch),
    onSuccess: (settings) => client.setQueryData<PttState>(keys.ptt, (state) => (state ? { ...state, settings } : state)),
  });
}

export const usePttTestTone = () => useMutation({ mutationFn: () => api.ptt.testTone() });

/** The device's sound cards; they change only when one is plugged in, so this is not polled. */
export const usePttDevices = (enabled: boolean) => useQuery({ queryKey: keys.pttDevices, queryFn: api.ptt.devices, enabled, staleTime: 60_000 });

export const usePttTestWav = () => useQuery({ queryKey: keys.pttTestWav, queryFn: api.ptt.testWav });

export function useUploadPttTestWav() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (file: Blob) => api.ptt.uploadTestWav(file), onSuccess: (wav) => client.setQueryData(keys.pttTestWav, wav) });
}

export function useDeletePttTestWav() {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => api.ptt.deleteTestWav(), onSuccess: () => client.setQueryData(keys.pttTestWav, null) });
}

export const useStartPttTestTx = () => useMutation({ mutationFn: (options: { source: 'wav' | 'tone'; loop: boolean }) => api.ptt.startTestTx(options) });

export const useStopPttTestTx = () => useMutation({ mutationFn: () => api.ptt.stopTestTx() });

/* ── mesh ── */

export const usePeers = () => useQuery({ queryKey: keys.peers, queryFn: api.peers.list, ...live });

/** Moves a node between lists. On the admin device, whitelisting a new node also provisions it. */
export function useSetNodeList() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, list }: { id: string; list: NodeList }) => api.peers.setList(id, list),
    onSuccess: (updated) => replaceById<Peer>(client, keys.peers, updated),
  });
}

/* ── managing other nodes ── */

/** What a node says about itself. A slow call over the mesh, and it fails when the node is out of reach: no automatic retries. */
export const useNodeDetails = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.node(id), queryFn: () => api.nodes.details(id), enabled, retry: false, staleTime: 60_000 });

/** What several nodes say about themselves, asked at once (each over the mesh, without retries). */
export const useNodesDetails = (ids: string[], enabled: boolean) =>
  useQueries({ queries: ids.map((id) => ({ queryKey: keys.node(id), queryFn: () => api.nodes.details(id), enabled, retry: false, staleTime: 60_000 })) });

export const useSoftwareRelease = () => useQuery({ queryKey: keys.release, queryFn: api.nodes.release, staleTime: Infinity });
export const useNodeJobs = () => useQuery({ queryKey: keys.jobs, queryFn: api.nodes.jobs, ...live });

export type NodeAction = { kind: 'update' } | { kind: 'restart' } | { kind: 'radio'; band: BandId; config: RadioConfig } | { kind: 'ptt'; settings: RemotePttSettings };

/** Starts an action on one or more nodes. The jobs it creates are followed through `useNodeJobs`. */
export function useNodeAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, action }: { ids: string[]; action: NodeAction }) => {
      if (action.kind === 'update') return api.nodes.updateSoftware(ids);
      if (action.kind === 'restart') return api.nodes.restart(ids);
      if (action.kind === 'ptt') return api.nodes.setPtt(ids, action.settings);
      return api.nodes.setRadio(ids, action.band, action.config);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.jobs }),
  });
}

/** Renames another node; its details and the node list are read again. */
export function useSetNodeCodename() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, codename }: { id: string; codename: string }) => api.nodes.setCodename(id, codename),
    onSuccess: (_, { id }) => {
      void client.invalidateQueries({ queryKey: keys.node(id) });
      void client.invalidateQueries({ queryKey: keys.peers });
    },
  });
}

/* ── plugins ── */

export const usePlugins = () => useQuery({ queryKey: keys.plugins, queryFn: api.plugins.list });

const PLUGIN_CHANGING = ['plugins', 'changing'] as const;

/** Start, stop, restart or roll back a plugin; the list shows it as it is after. */
export function usePluginAction() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: PLUGIN_CHANGING,
    mutationFn: ({ id, action }: { id: string; action: PluginAction }) => api.plugins.act(id, action),
    onSuccess: (updated) => replaceById<Plugin>(client, keys.plugins, updated),
    onSettled: () => client.invalidateQueries({ queryKey: keys.softwareHistory }),
  });
}

/** Installs or updates a plugin from its package; the list then shows it in place. */
export function useInstallPlugin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, upload }: { file: File; upload: PackageUpload }) => api.plugins.install(file, upload),
    onSuccess: ({ plugin }) =>
      client.setQueryData<Plugin[]>(keys.plugins, (plugins) =>
        plugins?.some((item) => item.id === plugin.id)
          ? plugins.map((item) => (item.id === plugin.id ? plugin : item))
          : [...(plugins ?? []), plugin].sort((a, b) => a.id.localeCompare(b.id)),
      ),
    onSettled: () => client.invalidateQueries({ queryKey: keys.softwareHistory }),
  });
}

/** Reads what a package is and asks for, before the password is asked for. */
export const useCheckPluginPackage = () => useMutation({ mutationFn: (file: File) => api.plugins.check(file) });

/** Updates one plugin from a package of that plugin only. */
export function useUpdatePlugin() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: PLUGIN_CHANGING,
    mutationFn: ({ id, file, upload }: { id: string; file: File; upload: PackageUpload }) => api.plugins.update(id, file, upload),
    onSuccess: (updated) => replaceById<Plugin>(client, keys.plugins, updated),
    onSettled: () => client.invalidateQueries({ queryKey: keys.softwareHistory }),
  });
}

/** Removes a plugin, with its data unless `keepData`; the list drops it. */
export function useRemovePlugin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, keepData }: { id: string; keepData: boolean }) => api.plugins.remove(id, keepData),
    onSuccess: (_, { id }) => client.setQueryData<Plugin[]>(keys.plugins, (plugins) => plugins?.filter((plugin) => plugin.id !== id)),
    onSettled: () => client.invalidateQueries({ queryKey: keys.softwareHistory }),
  });
}

/** The plugins being started, stopped, restarted, rolled back or updated right now, so each one shows its own progress. */
export const usePluginsChanging = () =>
  useMutationState({
    filters: { mutationKey: PLUGIN_CHANGING, status: 'pending' },
    select: (mutation) => {
      const variables = mutation.state.variables as { id: string; action?: PluginAction };
      return { id: variables.id, action: variables.action ?? 'update' } as const;
    },
  });

export const usePluginPolicy = () => useQuery({ queryKey: keys.pluginPolicy, queryFn: api.plugins.policy });

export function useSetPluginPolicy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ requireSigned, password }: { requireSigned: boolean; password: string }) => api.plugins.setPolicy(requireSigned, password),
    // The answer does not say whether there is a release key: keep what the policy said before.
    onSuccess: (policy) => client.setQueryData<PluginPolicy>(keys.pluginPolicy, (known) => ({ ...policy, releaseKey: policy.releaseKey ?? known?.releaseKey ?? null })),
  });
}

/** How long before a page ticket ends it is replaced. */
const TICKET_MARGIN_MS = 60_000;

/**
 * A ticket URL for a plugin's page. Never cached past the page: every visit asks for
 * a fresh one, and a page kept open is given a new one shortly before it ends.
 */
export const usePluginTicket = (id: string) =>
  useQuery({
    queryKey: keys.pluginTicket(id),
    queryFn: () => api.plugins.open(id),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const secs = query.state.data?.expiresInSecs;
      return secs ? Math.max(TICKET_MARGIN_MS, secs * 1000 - TICKET_MARGIN_MS) : false;
    },
  });

/* ── software (the hub and the installer) ── */

/** How often the hub update's outcome is asked for while it runs. */
const HUB_UPDATE_POLL_MS = 3000;

/**
 * Versions and the last hub update. Read again every few seconds while a hub update
 * runs, and, for `following` (the update this page started), until the hub is back
 * and reports how it ended: it is away while it restarts.
 */
export const useSoftware = (following: number | null = null) =>
  useQuery({
    queryKey: keys.software,
    queryFn: api.software.state,
    retry: false,
    refetchInterval: (query) => {
      const job = query.state.data?.hubUpdate;
      return job?.state === 'running' || (following !== null && job?.id !== following) ? HUB_UPDATE_POLL_MS : false;
    },
  });

/** Starts a hub update. The hub restarts with it; the outcome comes from `useSoftware`. */
export function useUpdateHub() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, upload }: { file: File; upload: PackageUpload }) => api.software.updateHub(file, upload),
    onSuccess: (job) =>
      client.setQueryData<SoftwareState>(keys.software, (state) => (state ? { ...state, hubUpdate: job } : state)),
  });
}

export function useUpdateInstaller() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, upload }: { file: File; upload: PackageUpload }) => api.software.updateInstaller(file, upload),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.software });
      void client.invalidateQueries({ queryKey: keys.softwareHistory });
    },
  });
}

/** Updates commd or the factory server; resolves once it runs the update (or the old one is back). */
export function useUpdateProgram(id: CoreProgramId) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, upload }: { file: File; upload: PackageUpload }) => api.software.updateProgram(id, file, upload),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: keys.software });
      void client.invalidateQueries({ queryKey: keys.softwareHistory });
    },
  });
}

/** What the installer did, newest first; `id` narrows it to one plugin, the hub or the installer. Admin only. */
export const useSoftwareHistory = (id: string | null, enabled = true) =>
  useQuery({ queryKey: [...keys.softwareHistory, id ?? ''], queryFn: () => api.software.history(id ? { id } : {}), enabled });

/* ── live updates ── */

/** Topics whose payload is a whole resource: the event simply replaces the cached copy. */
const LIVE_RESOURCES = [
  ['metrics', keys.metrics],
  ['peers', keys.peers],
  ['network', keys.network],
  ['jobs', keys.jobs],
] as const satisfies ReadonlyArray<readonly [HubTopic, readonly string[]]>;

/** Calls `handler` with each event of a live topic while the calling component is mounted. Pass a stable function. */
export function useHubStream<T extends HubTopic>(topic: T, handler: (payload: HubEvents[T]) => void) {
  useEffect(() => api.events.subscribe(topic, handler), [topic, handler]);
}

/** Keeps cached resources fresh from the event stream while the app shell is mounted. */
export function useLiveSync() {
  const client = useQueryClient();
  useEffect(() => {
    const stops = LIVE_RESOURCES.map(([topic, key]) => api.events.subscribe(topic, (payload) => client.setQueryData(key, payload)));
    // Wi-Fi events reach viewers too, so they never carry the hotspot password: keep the one already known.
    stops.push(
      api.events.subscribe('wifi', (config) =>
        client.setQueryData<WifiConfig>(keys.wifi, (known) => {
          const keep = !config.hotspot.open && config.hotspot.password === null && known?.hotspot.ssid === config.hotspot.ssid;
          return keep ? { ...config, hotspot: { ...config.hotspot, password: known.hotspot.password } } : config;
        }),
      ),
    );
    // A job that just finished may have changed the node it ran on: what it told us before is out of date.
    const finished = new Set<string>();
    stops.push(
      api.events.subscribe('jobs', (jobs) => {
        for (const job of jobs) {
          if (job.state !== 'done' || finished.has(job.id)) continue;
          finished.add(job.id);
          void client.invalidateQueries({ queryKey: keys.node(job.nodeId) });
        }
      }),
    );
    return () => stops.forEach((stop) => stop());
  }, [client]);
}
