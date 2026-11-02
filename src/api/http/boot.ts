import type { BootImage, BootJob, BootSlot, BootStaged, BootState, KernelInstallResult } from '../types';

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
