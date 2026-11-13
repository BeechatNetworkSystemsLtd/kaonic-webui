import { ApiError } from '../errors';
import type {
  HubUpdate,
  InstallerUpdateResult,
  PackageUpload,
  Plugin,
  PluginAction,
  PluginInstallResult,
  PluginPackageInfo,
  PluginPermission,
  PluginPolicy,
  PluginTicket,
  SoftwareAction,
  SoftwareEvent,
  SoftwareOutcome,
  SoftwareState,
} from '../types';
import { sampleAppUrl, seedPlugins, seedSoftwareHistory } from './seed';

/*
 * The mock's plugin installer: plugins with rollback, the install policy, the hub's
 * and the installer's own updates, and the history of all of it, following the rules
 * of kaonic-hub-installer. A real package is a tar with a manifest; the mock reads the
 * id and version from the file name instead (`weather-station-1.2.0.kpkg`). A name with
 * `signed` in it counts as signed, and a hub or installer package with `fail` in its
 * name does not come up, so the old one comes back.
 */

const PACKAGE_EXTENSIONS = ['.kpkg', '.tar'];
const HUB = 'kaonic-hub';
const INSTALLER = 'kaonic-hub-installer';
/** Who the history says asked: the hub names the admin by address. */
const ACTOR = 'admin (192.168.10.20)';
/** How long a ticket lasts on the hub. */
const TICKET_SECS = 12 * 60 * 60;
const KEEP_HISTORY = 1000;

export interface MockPluginsOptions {
  /** Checks the password given again; throws a field error when it is wrong. */
  checkPassword: (password: string) => void;
  /** False: a development device without a release key. */
  releaseKey?: boolean;
  /** False: the installer is not running, so plugin calls answer 503. */
  installerRunning?: boolean;
  /** How long a hub update takes to come back up, in ms. */
  hubRestartMs?: number;
}

/** "1.4.10" → [1, 4, 10]; missing parts are 0. */
function versionParts(version: string): number[] {
  return version.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** What the mock reads from a package's file name: its id, version and whether it is signed. */
export function readPackageName(name: string): { id: string; version: string | null; signed: boolean; failing: boolean } {
  const lower = name.toLowerCase();
  const extension = PACKAGE_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  if (!extension) throw new ApiError('validation_failed', 'This is not a package.', { file: 'Choose a .kpkg package.' });
  const stem = lower.slice(0, -extension.length).replace(/[-_](signed|fail)\b/g, '');
  const match = /^(.*?)[-_]v?(\d+(?:\.\d+){0,2})$/.exec(stem);
  const base = match ? match[1]! : stem;
  const id = base.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plugin';
  return { id, version: match ? match[2]! : null, signed: lower.includes('signed'), failing: lower.includes('fail') };
}

const bump = (version: string) => {
  const [major = 0, minor = 0] = versionParts(version);
  return `${major}.${minor + 1}.0`;
};

/** A plugin name made up from its id: "weather-station" → "Weather station". */
const nameOf = (id: string) => id.replace(/-+/g, ' ').replace(/^\w/, (first) => first.toUpperCase());

/** What a made-up plugin asks for, so the permissions show something. */
function permissionsOf(id: string): PluginPermission[] {
  const asks: PluginPermission[] = [];
  if (/audio|ptt|voice/.test(id)) asks.push('audio', 'realtime');
  if (/mesh|chat|beacon/.test(id)) asks.push('mesh');
  if (/bridge|sensor|gateway/.test(id)) asks.push('network');
  return asks;
}

const jobView = (job: HubUpdate): HubUpdate => ({ id: job.id, version: job.version, state: job.state, message: job.message, started: job.started, finished: job.finished });

/** Ids the installer keeps for itself. */
const RESERVED = /^(kaonic-hub|kaonic-commd|system)/;

export function createMockPlugins(options: MockPluginsOptions) {
  const releaseKey = options.releaseKey ?? true;
  const hubRestartMs = options.hubRestartMs ?? 8000;
  let installerRunning = options.installerRunning ?? true;

  let plugins: Plugin[] = seedPlugins();
  let requireSigned = false;
  let history: SoftwareEvent[] = seedSoftwareHistory();
  /** Data kept by a removal with `keepData`, by plugin id. */
  const keptData = new Set<string>();

  let hub = { version: '1.0.0-dev', highest: '1.0.0-dev', fromUpdate: false };
  let installer = { version: '1.0.0', highest: '1.0.0' };
  let hubUpdate: (HubUpdate & { doneAt: number; failing: boolean; from: string; signed: boolean }) | null = null;
  let jobIds = 0;

  function reset() {
    plugins = seedPlugins();
    requireSigned = false;
    history = seedSoftwareHistory();
    keptData.clear();
    hub = { version: '1.0.0-dev', highest: '1.0.0-dev', fromUpdate: false };
    installer = { version: '1.0.0', highest: '1.0.0' };
    hubUpdate = null;
  }

  function record(id: string, action: SoftwareAction, outcome: SoftwareOutcome, extra: Partial<SoftwareEvent> = {}) {
    const event: SoftwareEvent = { time: Math.floor(Date.now() / 1000), id, action, outcome, from: null, to: null, signed: false, actor: ACTOR, message: '', ...extra };
    history = [event, ...history].slice(0, KEEP_HISTORY);
  }

  function requireInstaller() {
    if (!installerRunning) throw new ApiError('unavailable', 'The plugin installer is not running. Try again in a moment.', {}, 'installer_unavailable');
  }

  function find(id: string): Plugin {
    requireInstaller();
    const plugin = plugins.find((candidate) => candidate.id === id);
    if (!plugin) throw new ApiError('not_found', 'No plugin with that id is installed.');
    return plugin;
  }

  /** The checks every package goes through before it is installed. */
  function checkPackage(file: File, upload: PackageUpload, highest: string | null) {
    const read = readPackageName(file.name);
    if (file.size === 0) throw new ApiError('validation_failed', 'This package is empty.', { file: 'The file is empty. Download the package again.' });
    options.checkPassword(upload.password);
    if (requireSigned && !read.signed) {
      throw new ApiError('forbidden', 'This package is not signed, and this device installs signed packages only.', {}, 'refused');
    }
    const version = read.version ?? (highest ? bump(highest) : '0.1.0');
    if (highest && compareVersions(version, highest) < 0 && !upload.allowDowngrade) {
      throw new ApiError('conflict', `${read.id} ${version} is older than ${highest} installed before; allow a downgrade to install it`, {}, 'downgrade');
    }
    return { ...read, version };
  }

  /** A package for one thing only: the hub reads its id before anything else. */
  function expectId(file: File, id: string, what: string) {
    const read = readPackageName(file.name);
    if (read.id !== id) throw new ApiError('validation_failed', 'Check the highlighted fields.', { file: `This package is ${read.id}, not ${what}.` });
  }

  /** Finishes a hub update once its restart time has passed. */
  function settleHubUpdate() {
    if (!hubUpdate || hubUpdate.state !== 'running' || Date.now() < hubUpdate.doneAt) return;
    hubUpdate.finished = Math.floor(Date.now() / 1000);
    const action: SoftwareAction = compareVersions(hubUpdate.version, hubUpdate.from) < 0 ? 'downgrade' : 'upgrade';
    if (hubUpdate.failing) {
      hubUpdate.state = 'failed';
      hubUpdate.message = `${hubUpdate.version} did not come up; ${hubUpdate.from} is back`;
      record(HUB, action, 'rolled_back', { from: hubUpdate.from, to: hubUpdate.version, signed: hubUpdate.signed, message: hubUpdate.message });
    } else {
      hubUpdate.state = 'done';
      hub = { version: hubUpdate.version, highest: compareVersions(hubUpdate.version, hub.highest) > 0 ? hubUpdate.version : hub.highest, fromUpdate: true };
      record(HUB, action, 'done', { from: hubUpdate.from, to: hubUpdate.version, signed: hubUpdate.signed });
    }
  }

  const api = {
    list: (): Plugin[] => {
      requireInstaller();
      return plugins;
    },

    act(id: string, action: PluginAction): Plugin {
      const plugin = find(id);
      if (action === 'rollback') {
        if (!plugin.previousVersion) throw new ApiError('conflict', `${id} has no previous version to go back to`);
        const from = plugin.version;
        plugin.version = plugin.previousVersion;
        plugin.previousVersion = from;
        plugin.running = plugin.enabled;
        record(id, 'rollback', 'done', { from, to: plugin.version, signed: plugin.official });
        return plugin;
      }
      if (action === 'start' || action === 'stop') {
        plugin.running = action === 'start';
        plugin.enabled = action === 'start';
      } else {
        plugin.running = true;
      }
      record(id, action, 'done');
      return plugin;
    },

    install(file: File, upload: PackageUpload): PluginInstallResult {
      requireInstaller();
      const read = readPackageName(file.name);
      if (RESERVED.test(read.id)) throw new ApiError('validation_failed', 'Check the highlighted fields.', { file: `${read.id} is a name the device keeps for itself, not a plugin.` });
      const existing = plugins.find((candidate) => candidate.id === read.id);
      const checked = checkPackage(file, upload, existing?.highestVersion ?? null);
      if (existing) return { action: 'updated', plugin: upgrade(existing, checked) };
      const plugin: Plugin = {
        id: checked.id,
        name: nameOf(checked.id),
        version: checked.version,
        description: `Installed from ${file.name}.`,
        developer: 'Unknown developer',
        official: checked.signed,
        running: true,
        enabled: true,
        removable: true,
        hasIcon: false,
        appUrl: null,
        channel: null,
        url: null,
        permissions: permissionsOf(checked.id),
        service: `kaonic-plugin-${checked.id}.service`,
        installedTs: Math.floor(Date.now() / 1000),
        highestVersion: checked.version,
        previousVersion: null,
      };
      keptData.delete(checked.id);
      plugins = [...plugins, plugin].sort((a, b) => a.id.localeCompare(b.id));
      record(checked.id, 'install', 'done', { to: checked.version, signed: checked.signed });
      return { action: 'installed', plugin };
    },

    update(id: string, file: File, upload: PackageUpload): Plugin {
      const plugin = find(id);
      expectId(file, id, `the plugin ${id}`);
      return upgrade(plugin, checkPackage(file, upload, plugin.highestVersion));
    },

    remove(id: string, keepData: boolean) {
      const plugin = find(id);
      plugins = plugins.filter((candidate) => candidate !== plugin);
      if (keepData) keptData.add(id);
      record(id, 'remove', 'done', { from: plugin.version, message: keepData ? 'data kept' : '' });
    },

    open(id: string): PluginTicket {
      const plugin = find(id);
      if (!plugin.appUrl) throw new ApiError('not_found', 'This plugin has no page.');
      const url = sampleAppUrl();
      if (!url) throw new ApiError('not_found', 'This plugin has no page.');
      return { url, expiresInSecs: TICKET_SECS };
    },

    policy(): PluginPolicy {
      requireInstaller();
      return { requireSigned, releaseKey };
    },

    check(file: File): PluginPackageInfo {
      requireInstaller();
      const read = readPackageName(file.name);
      if (file.size === 0) throw new ApiError('validation_failed', 'This package is empty.', { file: 'The file is empty. Download the package again.' });
      if (RESERVED.test(read.id)) throw new ApiError('validation_failed', 'Check the highlighted fields.', { file: `${read.id} is a name the device keeps for itself, not a plugin.` });
      const existing = plugins.find((candidate) => candidate.id === read.id);
      return {
        id: read.id,
        name: existing?.name ?? nameOf(read.id),
        version: read.version ?? (existing ? bump(existing.highestVersion) : '0.1.0'),
        developer: existing?.developer ?? 'Unknown developer',
        description: existing?.description ?? `Read from ${file.name}.`,
        permissions: existing?.permissions ?? permissionsOf(read.id),
        hasPage: existing ? existing.appUrl !== null : false,
        signed: read.signed,
        installed: existing?.version ?? null,
      };
    },

    setPolicy(wanted: boolean, password: string): PluginPolicy {
      options.checkPassword(password);
      requireInstaller();
      if (wanted && !releaseKey) throw new ApiError('conflict', 'this device has no release key, so it cannot require signed packages');
      requireSigned = wanted;
      // Like the hub, the answer to a change does not say whether there is a release key.
      return { requireSigned, releaseKey: null };
    },
  };

  function upgrade(plugin: Plugin, checked: { version: string; signed: boolean; failing: boolean }): Plugin {
    const from = plugin.version;
    const action: SoftwareAction = compareVersions(checked.version, from) < 0 ? 'downgrade' : 'upgrade';
    if (checked.failing) {
      record(plugin.id, action, 'rolled_back', { from, to: checked.version, signed: checked.signed, message: `${plugin.id} ${checked.version} did not stay running; ${from} is back` });
      throw new ApiError('internal', `${plugin.id} ${checked.version} did not stay running, so ${from} is back.`, {}, 'plugin_failed');
    }
    plugin.previousVersion = from;
    plugin.version = checked.version;
    plugin.official = checked.signed;
    if (compareVersions(checked.version, plugin.highestVersion) > 0) plugin.highestVersion = checked.version;
    record(plugin.id, action, 'done', { from, to: checked.version, signed: checked.signed });
    return plugin;
  }

  const software = {
    state(): SoftwareState {
      settleHubUpdate();
      return {
        hub: { version: hub.version, fromUpdate: hub.fromUpdate },
        installer: { version: installerRunning ? installer.version : null, reachable: installerRunning },
        hubUpdate: hubUpdate ? jobView(hubUpdate) : null,
        releaseKey: installerRunning ? releaseKey : null,
      };
    },

    updateHub(file: File, upload: PackageUpload): HubUpdate {
      requireInstaller();
      settleHubUpdate();
      expectId(file, HUB, 'a hub package');
      const checked = checkPackage(file, upload, hub.highest);
      if (hubUpdate?.state === 'running') throw new ApiError('conflict', 'a hub update is already running');
      jobIds += 1;
      hubUpdate = {
        id: jobIds,
        version: checked.version,
        state: 'running',
        message: '',
        started: Math.floor(Date.now() / 1000),
        finished: null,
        doneAt: Date.now() + hubRestartMs,
        failing: checked.failing,
        from: hub.version,
        signed: checked.signed,
      };
      return jobView(hubUpdate);
    },

    updateInstaller(file: File, upload: PackageUpload): InstallerUpdateResult {
      requireInstaller();
      expectId(file, INSTALLER, 'an installer package');
      const checked = checkPackage(file, upload, installer.highest);
      const from = installer.version;
      const action: SoftwareAction = compareVersions(checked.version, from) < 0 ? 'downgrade' : 'upgrade';
      if (checked.failing) {
        const message = `${INSTALLER} ${checked.version} did not answer; ${from} is back`;
        record(INSTALLER, action, 'rolled_back', { from, to: checked.version, signed: checked.signed, message });
        throw new ApiError('internal', message, {}, 'update_failed');
      }
      installer = { version: checked.version, highest: compareVersions(checked.version, installer.highest) > 0 ? checked.version : installer.highest };
      record(INSTALLER, action, 'done', { from, to: checked.version, signed: checked.signed });
      return { version: checked.version };
    },

    history(filter: { id?: string; limit?: number } = {}): SoftwareEvent[] {
      requireInstaller();
      const limit = Math.min(filter.limit ?? 100, KEEP_HISTORY);
      return history.filter((event) => !filter.id || event.id === filter.id).slice(0, limit);
    },
  };

  return {
    plugins: api,
    software,
    reset,
    hubVersion: () => hub.version,
    /** Stops or starts the installer, to see how the UI copes. */
    setInstallerRunning(running: boolean) {
      installerRunning = running;
    },
  };
}
