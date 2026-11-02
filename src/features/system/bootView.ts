import type { BootSlot, BootSlotId, BootState } from '@/api';

/* Pure wording for the boot section, kept apart so it is tested without React. */

export const slotName = (slot: BootSlotId) => `Slot ${slot.toUpperCase()}`;

export const otherSlot = (slot: BootSlotId): BootSlotId => (slot === 'a' ? 'b' : 'a');

/** One line on what a slot holds. */
export function slotSummary(slot: BootSlot): string {
  if (!slot.bootfs && !slot.rootfs) return 'Empty: no system installed.';
  if (!slot.bootable) {
    const missing = [!slot.kernel && 'kernel', !slot.dtb && 'device tree', !slot.rootfs && 'root filesystem'].filter(Boolean).join(', ');
    return `Not bootable: no ${missing}.`;
  }
  const release = slot.kernel?.version ?? slot.kernel?.name ?? 'unknown kernel';
  const modules = slot.kernel?.version && !slot.modules.includes(slot.kernel.version) ? ' (no modules for it: the radio driver will not load)' : '';
  return `Kernel ${release}${modules}.`;
}

/** What happens on the next boot, in words. */
export function nextBootText(state: BootState): string {
  if (!state.next) return 'The boot order is unknown.';
  const next = slotName(state.next);
  if (state.once) {
    const back = state.afterOnce[0] ? slotName(state.afterOnce[0]) : 'the previous slot';
    return `${next} boots once on the next restart, then ${back} again. If it fails, the board falls back by itself.`;
  }
  if (state.current && state.next !== state.current) return `${next} boots on the next restart, and stays (it falls back after 3 failed boots).`;
  return `${next} keeps booting.`;
}

/** Attempts left, as U-Boot counts them. */
export function attemptsText(slot: BootSlot): string {
  if (slot.attemptsLeft === null) return '–';
  if (slot.attemptsLeft === 0) return 'none left: skipped';
  return `${slot.attemptsLeft} of 3`;
}
