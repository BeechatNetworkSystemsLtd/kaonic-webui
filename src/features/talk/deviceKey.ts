import type { PttKeyResult } from '@/api';
import type { TalkSnapshot } from './talkSession';

/*
 * Talking from the device's own microphone (talk input `device`): the page
 * only holds the key. Press asks the hub, and the key is renewed every second
 * while held, because the hub drops it 2 s after the last request; a release
 * lost on the way (a closed tab, a dropped connection) cannot leave the radio
 * keyed. A renewal that is refused means the admin took the floor. Pure: the
 * calls and the timer are passed in.
 */

export const RENEW_MS = 1000;

export interface DeviceKeyDeps {
  key(): Promise<PttKeyResult>;
  unkey(): Promise<void>;
  onChange(snapshot: TalkSnapshot): void;
  /** Why a request failed (not a refusal: the network, the session). */
  onError(error: unknown): void;
  setInterval?: (run: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export interface DeviceKey {
  press(): void;
  release(): void;
  snapshot(): TalkSnapshot;
}

export function createDeviceKey(deps: DeviceKeyDeps): DeviceKey {
  const every = deps.setInterval ?? ((run, ms) => setInterval(run, ms));
  const stop = deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  let snapshot: TalkSnapshot = { phase: 'idle', busyWith: null, cutOff: null };
  let renewal: unknown = null;
  /** Bumped on every press and release, so a late answer to an old press is ignored. */
  let press = 0;

  function set(next: Partial<TalkSnapshot>) {
    snapshot = { ...snapshot, ...next };
    deps.onChange(snapshot);
  }

  function stopRenewing() {
    if (renewal !== null) stop(renewal);
    renewal = null;
  }

  function failed(error: unknown) {
    stopRenewing();
    if (snapshot.phase !== 'idle') set({ phase: 'idle', cutOff: 'timeout' });
    deps.onError(error);
  }

  return {
    press() {
      if (snapshot.phase !== 'idle') return;
      const mine = ++press;
      set({ phase: 'waiting', busyWith: null, cutOff: null });
      deps.key().then(
        (result) => {
          if (mine !== press) {
            // Released before the answer came: give the floor straight back.
            if (result.keyed) void deps.unkey().catch(() => undefined);
            return;
          }
          if (!result.keyed) return set({ phase: 'busy' });
          set({ phase: 'keyed' });
          renewal = every(() => {
            deps.key().then((renewed) => {
              if (mine !== press || renewed.keyed) return;
              // Someone with priority took the floor while we held it.
              stopRenewing();
              set({ phase: 'idle', cutOff: 'preempted' });
            }, failed);
          }, RENEW_MS);
        },
        (error: unknown) => {
          if (mine === press) failed(error);
        },
      );
    },
    release() {
      if (snapshot.phase === 'idle') return;
      const talking = snapshot.phase === 'waiting' || snapshot.phase === 'keyed';
      const answered = snapshot.phase === 'keyed';
      press += 1;
      stopRenewing();
      set({ phase: 'idle', busyWith: null });
      // While waiting, the late answer gives it back (above); unkey now only if keyed.
      if (talking && answered) void deps.unkey().catch(deps.onError);
    },
    snapshot: () => snapshot,
  };
}
