import { describe, expect, it } from 'vitest';
import { toBootJob, toBootState } from './boot';

describe('boot wire conversion', () => {
  it('maps the state and an install job', () => {
    const state = toBootState({
      current: 'a',
      order: ['b', 'a'],
      next: 'b',
      once: true,
      after_once: ['a', 'b'],
      fdtfile: 'board.dtb',
      dry_run: false,
      slots: [{ slot: 'a', attempts_left: 3, bootfs: true, rootfs: true, kernel: null, dtb: true, modules: [], bootable: false }],
    });
    expect([state.next, state.afterOnce, state.slots[0]!.attemptsLeft]).toEqual(['b', ['a', 'b'], 3]);
    const done = toBootJob({
      id: 'j1',
      kind: 'kernel_install',
      state: 'done',
      progress: 1,
      detail: null,
      result: { slot: 'b', prepared: true, kernel_file: 'uImage-6.6.129', dtb_file: null, modules_present: true },
      error: null,
    });
    expect(done.result).toEqual({ slot: 'b', prepared: true, kernelFile: 'uImage-6.6.129', dtbFile: null, modulesPresent: true });
    const failed = toBootJob({ id: 'j2', kind: 'kernel_install', state: 'failed', progress: null, detail: 'x', result: null, error: { code: 'install_failed', message: 'No modules.' } });
    expect([failed.progress, failed.error, failed.result]).toEqual([0, 'No modules.', null]);
  });
});
