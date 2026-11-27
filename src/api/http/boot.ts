import type { BootImage, BootJob, BootSlot, BootStaged, BootState, KernelInstallResult, OsJob, OsState } from '../types';

/* Wire shapes of /system/boot* (snake_case), and their conversion. */

export interface WireBootImage {
  kind: 'kernel' | 'dtb';
  format: 'uimage' | 'fdt';
  size: number;
  name: string | null;
  version: string | null;
  load_address: string | null;
  entry_address: string | null;
  built_ts: number | null;
}

export interface WireBootSlot {
  slot: 'a' | 'b';
  attempts_left: number | null;
  bootfs: boolean;
  rootfs: boolean;
  kernel: { file: string | null; name: string | null; version: string | null; size: number | null } | null;
  dtb: boolean;
  modules: string[];
  bootable: boolean;
}

export interface WireBootState {
  current: 'a' | 'b' | null;
  order: Array<'a' | 'b'>;
  next: 'a' | 'b' | null;
  once: boolean;
  after_once: Array<'a' | 'b'>;
  fdtfile: string | null;
  dry_run: boolean;
  slots: WireBootSlot[];
}

export interface WireBootStaged {
  kernel: { info: WireBootImage; uploaded_ts: number } | null;
  dtb: { info: WireBootImage; uploaded_ts: number } | null;
}

export interface WireInstallReport {
  slot: 'a' | 'b';
  prepared: boolean;
  kernel_file: string | null;
  dtb_file: string | null;
  modules_present: boolean | null;
}

export interface WireBootJob {
  id: string;
  kind: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  progress: number | null;
  detail: string | null;
  result: unknown;
  error: { code?: string; message?: string } | null;
}

export const toBootImage = (wire: WireBootImage): BootImage => ({
  kind: wire.kind,
  format: wire.format,
  size: wire.size,
  name: wire.name,
  version: wire.version,
  loadAddress: wire.load_address,
  entryAddress: wire.entry_address,
  builtTs: wire.built_ts,
});

const toBootSlot = (wire: WireBootSlot): BootSlot => ({
  slot: wire.slot,
  attemptsLeft: wire.attempts_left,
  bootfs: wire.bootfs,
  rootfs: wire.rootfs,
  kernel: wire.kernel,
  dtb: wire.dtb,
  modules: wire.modules,
  bootable: wire.bootable,
});

export const toBootState = (wire: WireBootState): BootState => ({
  current: wire.current,
  order: wire.order,
  next: wire.next,
  once: wire.once,
  afterOnce: wire.after_once,
  fdtfile: wire.fdtfile,
  dryRun: wire.dry_run,
  slots: wire.slots.map(toBootSlot),
});

export const toBootStaged = (wire: WireBootStaged): BootStaged => ({
  kernel: wire.kernel ? { info: toBootImage(wire.kernel.info), uploadedTs: wire.kernel.uploaded_ts } : null,
  dtb: wire.dtb ? { info: toBootImage(wire.dtb.info), uploadedTs: wire.dtb.uploaded_ts } : null,
});

const toInstallResult = (wire: WireInstallReport): KernelInstallResult => ({
  slot: wire.slot,
  prepared: wire.prepared,
  kernelFile: wire.kernel_file,
  dtbFile: wire.dtb_file,
  modulesPresent: wire.modules_present,
});

export const toBootJob = (wire: WireBootJob): BootJob => ({
  id: wire.id,
  state: wire.state,
  progress: wire.progress ?? 0,
  detail: wire.detail,
  result: wire.state === 'done' && wire.result ? toInstallResult(wire.result as WireInstallReport) : null,
  error: wire.error ? (wire.error.message ?? 'The install failed.') : null,
});

/* /system/os */

export interface WireOsUpdate {
  state: 'uploading' | 'checking' | 'ready' | 'invalid' | 'installing' | 'installed';
  size: number;
  uploaded_ts: number;
  job_id: string | null;
  version: string | null;
  built: string | null;
  compared: 'newer' | 'same' | 'older' | null;
  error: string | null;
  slot: 'a' | 'b' | null;
}

export interface WireOsState {
  version: string | null;
  os: string;
  machine: string | null;
  /** Absent from hubs older than the field, which took eMMC bundles only. */
  storage?: 'emmc' | 'sdcard';
  slot: 'a' | 'b' | null;
  update: WireOsUpdate | null;
}

export const toOsState = (wire: WireOsState): OsState => ({
  version: wire.version,
  os: wire.os,
  machine: wire.machine,
  storage: wire.storage ?? 'emmc',
  slot: wire.slot,
  update: wire.update
    ? {
        state: wire.update.state,
        size: wire.update.size,
        uploadedTs: wire.update.uploaded_ts,
        jobId: wire.update.job_id,
        version: wire.update.version,
        built: wire.update.built,
        compared: wire.update.compared,
        error: wire.update.error,
        slot: wire.update.slot,
      }
    : null,
});

export const toOsJob = (wire: WireBootJob): OsJob => ({
  id: wire.id,
  state: wire.state,
  progress: wire.progress ?? 0,
  detail: wire.detail,
  error: wire.state === 'failed' ? (wire.error?.message ?? wire.detail ?? 'It did not complete.') : null,
});
