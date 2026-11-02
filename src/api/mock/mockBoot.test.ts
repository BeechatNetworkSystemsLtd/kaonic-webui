import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../errors';
import { createMockBoot, inspectImage, resolveRelease } from './mockBoot';

/** A uImage header (CRCs not checked by the mock) around `payload`. */
function uimage(name: string, arch = 2): Uint8Array {
  const bytes = new Uint8Array(64 + 16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x27051956);
  view.setUint32(12, 16);
  view.setUint32(16, 0xc2008000);
  bytes[28] = 5;
  bytes[29] = arch;
  bytes[30] = 2;
  bytes.set(new TextEncoder().encode(name).slice(0, 32), 32);
  return bytes;
}

const check = (password: string) => {
  if (password !== 'secret') throw new ApiError('validation_failed', 'Wrong password.', { password: 'Wrong password.' });
};

describe('mock boot slots', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads uploaded images like the hub and refuses others', () => {
    // The name field holds 32 bytes: the board's own kernel name arrives cut short.
    const info = inspectImage('kernel', uimage('Linux-6.6.129-g548f960c059b-dirty'));
    expect(info.version).toBe('6.6.129-g548f960c059b-dirt');
    expect(resolveRelease(info.name, info.version, ['6.6.129-g548f960c059b-dirty'])).toBe('6.6.129-g548f960c059b-dirty');
    expect(resolveRelease('Linux-6.6', '6.6', ['6.6.129'])).toBe('6.6');
    expect(() => inspectImage('kernel', uimage('Linux-6.6.129', 22))).toThrow(ApiError);
    const refusal = (() => {
      try {
        inspectImage('kernel', new Uint8Array(80));
      } catch (error) {
        return error as ApiError;
      }
      return null;
    })();
    expect(refusal?.fields.file).toMatch(/uImage/);
    expect(() => inspectImage('dtb', new Uint8Array(80))).toThrow();
  });

  it('refuses to boot the empty slot, installs into it, then switches once', async () => {
    const boot = createMockBoot(check);
    expect(() => boot.setNext('b', 'once', 'secret')).toThrow(/no system/);
    await boot.upload('kernel', new Blob([uimage('Linux-6.6.129-g548f960c059b-dirty').slice()]));
    expect(() => boot.install({ password: 'wrong' })).toThrow(/Wrong password/);
    const job = boot.install({ password: 'secret' });
    expect(job.state).toBe('running');
    await vi.advanceTimersByTimeAsync(10_000);
    const done = boot.job(job.id);
    expect(done.state).toBe('done');
    expect(done.result?.prepared).toBe(true);
    expect(boot.staged().kernel).toBeNull();
    const state = boot.setNext('b', 'once', 'secret');
    expect([state.next, state.once, state.afterOnce]).toEqual(['b', true, ['a', 'b']]);
    expect(boot.setNext('b', 'permanent', 'secret').once).toBe(false);
  });

  it('fails an install whose kernel has no modules unless confirmed', async () => {
    const boot = createMockBoot(check);
    await boot.upload('kernel', new Blob([uimage('Linux-6.7.0').slice()]));
    const job = boot.install({ password: 'secret' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(boot.job(job.id).error).toMatch(/modules/);
    const confirmed = boot.install({ password: 'secret', allowMissingModules: true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(boot.job(confirmed.id).state).toBe('done');
  });
});
