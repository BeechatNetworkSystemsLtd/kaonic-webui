import type { BootImage, BootJob, BootMode, BootSlot, BootSlotId, BootStaged, BootState, KernelInstallOptions } from '../types';
import { ApiError } from '../errors';

/*
 * The mock's boot slots: slot A runs kernel 6.6.129 and slot B is empty from the factory,
 * like a fresh board. Uploads are checked like the hub does (uImage or device tree magic);
 * an install takes a few seconds and fills slot B; the boot switch follows the same rules.
 */

const RUNNING_RELEASE = '6.6.129-g548f960c059b-dirty';
const KERNEL_MAX = 24 * 1024 * 1024;
const DTB_MAX = 1024 * 1024;

const be32 = (bytes: Uint8Array, at: number) => ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0;

/** What the hub would say about an uploaded file. Throws like the hub on a bad one. */
export function inspectImage(kind: 'kernel' | 'dtb', bytes: Uint8Array): BootImage {
  const refuse = (why: string) => new ApiError('validation_failed', 'Check the highlighted fields.', { file: `This file cannot be installed: ${why}.` });
  if (kind === 'kernel') {
    if (bytes.length > KERNEL_MAX) throw refuse('it is larger than 24 MiB');
    if (bytes.length < 64 || be32(bytes, 0) !== 0x27051956) throw refuse('it is not a U-Boot uImage (a zImage or FIT image must be wrapped as the board\'s uImage)');
    if (bytes[29] !== 2) throw refuse('it is not for ARM (the board is a 32-bit ARM Cortex-A7)');
    const name = new TextDecoder().decode(bytes.slice(32, 64)).replace(/\0+$/, '').trim();
    return {
      kind,
      format: 'uimage',
      size: bytes.length,
      name: name || null,
      version: name.startsWith('Linux-') ? name.slice(6) || null : null,
      loadAddress: `0x${be32(bytes, 16).toString(16).padStart(8, '0')}`,
      entryAddress: `0x${be32(bytes, 20).toString(16).padStart(8, '0')}`,
      builtTs: be32(bytes, 8),
    };
  }
  if (bytes.length > DTB_MAX) throw refuse('it is larger than 1024 KiB');
  if (bytes.length < 40 || be32(bytes, 0) !== 0xd00dfeed) throw refuse('it is not a device tree blob (.dtb)');
  if (be32(bytes, 4) !== bytes.length) throw refuse('its size does not match its header');
  return { kind, format: 'fdt', size: bytes.length, name: null, version: null, loadAddress: null, entryAddress: null, builtTs: null };
}

/** The full release a (possibly 32-byte-truncated) uImage name implies, among a slot's module directories. */
export function resolveRelease(name: string | null, version: string | null, modules: string[]): string | null {
  if (version === null) return null;
  if (modules.includes(version)) return version;
  const candidates = modules.filter((release) => release.startsWith(version));
  return (name?.length ?? 0) >= 32 && candidates.length === 1 ? candidates[0]! : version;
}

export function createMockBoot(checkPassword: (password: string) => void) {
  const slots: Record<BootSlotId, BootSlot> = {
    a: {
      slot: 'a',
      attemptsLeft: 3,
      bootfs: true,
      rootfs: true,
      kernel: { file: `uImage-${RUNNING_RELEASE}`, name: `Linux-${RUNNING_RELEASE}`, version: RUNNING_RELEASE, size: 9_014_960 },
      dtb: true,
      modules: [RUNNING_RELEASE],
      bootable: true,
    },
    b: { slot: 'b', attemptsLeft: 3, bootfs: false, rootfs: false, kernel: null, dtb: false, modules: [], bootable: false },
  };
  let order: BootSlotId[] = ['a', 'b'];
  let afterOnce: BootSlotId[] = [];
  const staged: BootStaged = { kernel: null, dtb: null };
  const jobs = new Map<string, BootJob>();
  let installing = false;

  const state = (): BootState => ({
    current: 'a',
    order: [...order],
    next: order[0] ?? null,
    once: afterOnce.length > 0,
    afterOnce: [...afterOnce],
    fdtfile: 'stm32mp151a-kaonic1s-r24-mx.dtb',
    dryRun: false,
    slots: [structuredClone(slots.a), structuredClone(slots.b)],
  });

  return {
    state,

    setNext(slot: BootSlotId, mode: BootMode, password: string): BootState {
      if (slot !== 'a' && slot !== 'b') throw new ApiError('validation_failed', 'Check the highlighted fields.', { slot: 'Use a or b.' });
      checkPassword(password);
      if (!slots[slot].bootable) {
        throw new ApiError('conflict', `Slot ${slot.toUpperCase()} has no system to boot. Install a kernel into it first.`, {}, 'slot_not_bootable');
      }
      const other: BootSlotId = slot === 'a' ? 'b' : 'a';
      const previous = order[0] === slot ? [other, slot] : [...order];
      order = [slot, other];
      if (mode === 'once') {
        slots[slot].attemptsLeft = 1;
        afterOnce = previous;
      } else {
        slots[slot].attemptsLeft = 3;
        afterOnce = [];
      }
      return state();
    },

    async upload(kind: 'kernel' | 'dtb', file: Blob): Promise<BootImage> {
      if (kind !== 'kernel' && kind !== 'dtb') throw new ApiError('validation_failed', 'Check the highlighted fields.', { kind: 'Use kernel or dtb.' });
      const info = inspectImage(kind, new Uint8Array(await file.arrayBuffer()));
      staged[kind] = { info, uploadedTs: Math.floor(Date.now() / 1000) };
      return info;
    },

    staged: (): BootStaged => structuredClone(staged),

    discard() {
      staged.kernel = null;
      staged.dtb = null;
    },

    install(options: KernelInstallOptions): BootJob {
      checkPassword(options.password);
      if (!staged.kernel && !staged.dtb) throw new ApiError('conflict', 'Upload a kernel or a device tree first.');
      if (installing) throw new ApiError('conflict', 'An install is already running.');
      const target = options.slot ?? 'b';
      if (target === 'a') throw new ApiError('conflict', 'The running slot is never written. Install into the other slot.');
      const kernel = staged.kernel?.info ?? null;
      const id = Math.random().toString(16).slice(2, 18);
      const job: BootJob = { id, state: 'running', progress: 0, detail: 'Starting', result: null, error: null };
      jobs.set(id, job);
      installing = true;
      const prepare = options.prepare === 'always' || (options.prepare !== 'never' && !slots.b.bootable);
      const targetModules = prepare ? slots.a.modules : slots.b.modules;
      const release = kernel ? resolveRelease(kernel.name, kernel.version, targetModules) : null;
      const modulesThere = release !== null && targetModules.includes(release);
      const steps: Array<[number, string]> = prepare
        ? [[0.05, 'Formatting the other slot'], [0.15, 'Copying the running boot files'], [0.3, 'Copying the running system (a few minutes)'], [0.85, 'Writing the kernel'], [0.97, 'Syncing']]
        : [[0.85, 'Writing the kernel'], [0.97, 'Syncing']];
      steps.forEach(([progress, detail], index) => {
        setTimeout(() => {
          job.progress = progress;
          job.detail = detail;
        }, 600 * (index + 1));
      });
      setTimeout(() => {
        installing = false;
        if (kernel && !modulesThere && !options.allowMissingModules) {
          job.state = 'failed';
          job.error = `Slot B has no modules for kernel ${release ?? 'custom'} (/lib/modules/${release ?? 'custom'}): the radio driver would not load. Install them, or confirm to boot without them.`;
          job.detail = job.error;
          return;
        }
        const version = release ?? 'custom';
        slots.b = {
          slot: 'b',
          attemptsLeft: slots.b.attemptsLeft,
          bootfs: true,
          rootfs: true,
          kernel: kernel ? { file: `uImage-${version}`, name: kernel.name, version, size: kernel.size } : prepare ? structuredClone(slots.a.kernel) : slots.b.kernel,
          dtb: true,
          modules: prepare ? [...slots.a.modules] : slots.b.modules,
          bootable: true,
        };
        job.state = 'done';
        job.progress = 1;
        job.detail = null;
        job.result = { slot: 'b', prepared: prepare, kernelFile: kernel ? `uImage-${version}` : null, dtbFile: staged.dtb ? 'stm32mp151a-kaonic1s-r24-mx.dtb' : null, modulesPresent: kernel ? modulesThere : null };
        staged.kernel = null;
        staged.dtb = null;
      }, 600 * (steps.length + 1));
      return structuredClone(job);
    },

    job(id: string): BootJob {
      const job = jobs.get(id);
      if (!job) throw new ApiError('not_found', 'No such job.');
      return structuredClone(job);
    },
  };
}
