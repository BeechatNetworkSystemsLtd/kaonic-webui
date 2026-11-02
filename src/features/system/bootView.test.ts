import { describe, expect, it } from 'vitest';
import type { BootSlot, BootState } from '@/api';
import { attemptsText, nextBootText, otherSlot, slotSummary } from './bootView';

const running: BootSlot = {
  slot: 'a',
  attemptsLeft: 3,
  bootfs: true,
  rootfs: true,
  kernel: { file: 'uImage-6.6.129', name: 'Linux-6.6.129', version: '6.6.129', size: 9_000_000 },
  dtb: true,
  modules: ['6.6.129'],
  bootable: true,
};
const empty: BootSlot = { slot: 'b', attemptsLeft: 3, bootfs: false, rootfs: false, kernel: null, dtb: false, modules: [], bootable: false };
const state = (patch: Partial<BootState> = {}): BootState => ({
  current: 'a',
  order: ['a', 'b'],
  next: 'a',
  once: false,
  afterOnce: [],
  fdtfile: 'board.dtb',
  dryRun: false,
  slots: [running, empty],
  ...patch,
});

describe('boot wording', () => {
  it('says what a slot holds, and warns when its kernel has no modules', () => {
    expect(slotSummary(running)).toBe('Kernel 6.6.129.');
    expect(slotSummary(empty)).toMatch(/^Empty/);
    expect(slotSummary({ ...running, kernel: { ...running.kernel!, version: '6.7.0' } })).toMatch(/radio driver will not load/);
    expect(slotSummary({ ...running, dtb: false, bootable: false })).toBe('Not bootable: no device tree.');
  });

  it('describes a one-time boot, a permanent switch and no change', () => {
    expect(nextBootText(state())).toBe('Slot A keeps booting.');
    expect(nextBootText(state({ next: 'b', order: ['b', 'a'], once: true, afterOnce: ['a', 'b'] }))).toMatch(/^Slot B boots once on the next restart, then Slot A again/);
    expect(nextBootText(state({ next: 'b', order: ['b', 'a'] }))).toMatch(/stays/);
    expect(nextBootText(state({ next: null }))).toMatch(/unknown/);
  });

  it('counts attempts and pairs slots', () => {
    expect(attemptsText(running)).toBe('3 of 3');
    expect(attemptsText({ ...running, attemptsLeft: 0 })).toMatch(/skipped/);
    expect(attemptsText({ ...running, attemptsLeft: null })).toBe('–');
    expect([otherSlot('a'), otherSlot('b')]).toEqual(['b', 'a']);
  });
});
