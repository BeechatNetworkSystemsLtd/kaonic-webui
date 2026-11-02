import { describe, expect, it, vi } from 'vitest';
import type { PttKeyResult } from '@/api';
import { createDeviceKey, RENEW_MS } from './deviceKey';
import type { TalkSnapshot } from './talkSession';

function setup(answers: Array<PttKeyResult | Error>) {
  const phases: string[] = [];
  let last: TalkSnapshot | null = null;
  const timers: Array<() => void> = [];
  const pending: Array<(result: PttKeyResult) => void> = [];
  const key = vi.fn(() => {
    const answer = answers.shift();
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer) return Promise.resolve(answer);
    return new Promise<PttKeyResult>((resolve) => pending.push(resolve));
  });
  const unkey = vi.fn(() => Promise.resolve());
  const errors: unknown[] = [];
  const deviceKey = createDeviceKey({
    key,
    unkey,
    onChange: (snapshot) => {
      last = snapshot;
      phases.push(snapshot.phase);
    },
    onError: (error) => errors.push(error),
    setInterval: (run) => {
      timers.push(run);
      return timers.length;
    },
    clearInterval: (handle) => {
      timers[(handle as number) - 1] = () => undefined;
    },
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { deviceKey, key, unkey, phases, last: () => last, timers, pending, errors, flush };
}

describe('device key', () => {
  it('keys, renews every second while held, and unkeys on release', async () => {
    const run = setup([{ keyed: true }, { keyed: true }]);
    run.deviceKey.press();
    await run.flush();
    expect(run.last()?.phase).toBe('keyed');
    expect(RENEW_MS).toBe(1000);
    run.timers[0]!();
    await run.flush();
    expect(run.key).toHaveBeenCalledTimes(2);
    run.deviceKey.release();
    expect(run.unkey).toHaveBeenCalledTimes(1);
    expect(run.phases).toEqual(['waiting', 'keyed', 'idle']);
    run.timers[0]!();
    expect(run.key).toHaveBeenCalledTimes(2);
  });

  it('says busy when the floor is taken, and needs no unkey', async () => {
    const run = setup([{ keyed: false, reason: 'emunode2 is talking.' }]);
    run.deviceKey.press();
    await run.flush();
    expect(run.last()?.phase).toBe('busy');
    run.deviceKey.release();
    expect(run.unkey).not.toHaveBeenCalled();
    expect(run.last()?.phase).toBe('idle');
  });

  it('gives the floor back when it is granted after the release', async () => {
    const run = setup([]);
    run.deviceKey.press();
    run.deviceKey.release();
    run.pending[0]!({ keyed: true });
    await run.flush();
    expect(run.unkey).toHaveBeenCalledTimes(1);
    expect(run.last()?.phase).toBe('idle');
  });

  it('a refused renewal means the admin took over', async () => {
    const run = setup([{ keyed: true }, { keyed: false, reason: 'emuadmin is talking.' }]);
    run.deviceKey.press();
    await run.flush();
    run.timers[0]!();
    await run.flush();
    expect(run.last()).toMatchObject({ phase: 'idle', cutOff: 'preempted' });
  });

  it('a failed request ends the talk and is reported', async () => {
    const run = setup([new Error('offline')]);
    run.deviceKey.press();
    await run.flush();
    expect(run.last()).toMatchObject({ phase: 'idle', cutOff: 'timeout' });
    expect(run.errors).toHaveLength(1);
  });
});
