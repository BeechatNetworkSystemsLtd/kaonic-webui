import { isApiError, type PluginPermission, type SoftwareEvent } from '@/api';

/*
 * Words for plugins and updates, shared by the Plugins and System pages.
 */

/** What each extra right lets a plugin do, in a few words. */
export const PERMISSIONS: Record<PluginPermission, { label: string; explain: string }> = {
  audio: { label: 'Sound', explain: 'uses the microphone and speaker' },
  realtime: { label: 'Realtime', explain: 'runs ahead of other programs, for steady audio' },
  mesh: { label: 'Mesh', explain: 'sends and receives over the radio mesh' },
  network: { label: 'Network', explain: 'opens its own network ports' },
  root: { label: 'Full control', explain: 'runs as the device administrator (root)' },
};

/** The device refused a package older than one installed before (`409 downgrade`): it may go in with `allowDowngrade`. */
export function isDowngradeRefusal(error: unknown): boolean {
  return isApiError(error, 'conflict') && error.reason === 'downgrade';
}

/** The installer is not running: plugins cannot be listed or changed until it is back. */
export function isInstallerDown(error: unknown): boolean {
  return isApiError(error, 'unavailable') && (error.reason === null || error.reason === 'installer_unavailable');
}

/** Compares "1.4.10" with "1.5.0" by number, part by part; negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) => version.split(/[.+-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const HUB_ID = 'kaonic-hub';
export const INSTALLER_ID = 'kaonic-hub-installer';

/** A history entry's subject: a plugin's name when it is known, "Hub" or "Installer". */
export function subjectName(id: string, names: ReadonlyMap<string, string>): string {
  if (id === HUB_ID) return 'Hub';
  if (id === INSTALLER_ID) return 'Installer';
  return names.get(id) ?? id;
}

const ACTIONS: Record<SoftwareEvent['action'], string> = {
  install: 'Installed',
  upgrade: 'Updated',
  downgrade: 'Downgraded',
  rollback: 'Rolled back',
  start: 'Started',
  stop: 'Stopped',
  restart: 'Restarted',
  remove: 'Removed',
};

export const actionText = (event: SoftwareEvent) => ACTIONS[event.action] ?? event.action;

/** "1.0.4 → 1.1.0", "→ 0.9.0", "1.0.4", or empty. */
export function versionsText(event: SoftwareEvent): string {
  if (event.from && event.to) return `${event.from} → ${event.to}`;
  if (event.to) return `→ ${event.to}`;
  return event.from ?? '';
}

/** How it ended, and its tone. */
export function outcomeOf(event: SoftwareEvent): { text: string; tone: 'ok' | 'warn' | 'danger' } {
  if (event.outcome === 'done') return { text: 'Done', tone: 'ok' };
  if (event.outcome === 'rolled_back') return { text: event.from ? `Rolled back to ${event.from}` : 'Rolled back', tone: 'warn' };
  return { text: 'Failed', tone: 'danger' };
}

/** Unix seconds → "13 Nov 2026, 14:03", local time. */
export function formatWhen(secs: number): string {
  return new Date(secs * 1000).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
